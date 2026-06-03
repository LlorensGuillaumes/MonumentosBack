/**
 * Limpieza de los 10 QIDs duplicados en tabla wikidata.
 *
 * Estrategia:
 *  - Fase 1: 3 duplicados REALES (mismo monumento) → merge (mover imagen, borrar duplicado).
 *  - Fase 2: 7 errores de asignación → SPARQL para coords reales del QID, dejar wikidata
 *    solo en el bien más cercano, borrar wikidata de los demás. Bienes intactos.
 *
 * Uso:
 *   node _limpiar_duplicados_qid.cjs          # dry-run
 *   node _limpiar_duplicados_qid.cjs --apply  # ejecuta cambios
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Fase 1: duplicados reales (mismo monumento). Conservamos el bien_id MENOR, borramos mayor.
const DUPLICADOS_REALES = [
  { qid: 'Q986344',   conservar: 123449, borrar: 130846 },
  { qid: 'Q99243435', conservar: 72851,  borrar: 72865 },
  { qid: 'Q995023',   conservar: 111810, borrar: 132636 },
];

// Fase 2: QIDs mal asignados — necesitamos SPARQL para resolver
const QIDS_AMBIGUOS = [
  'Q98501841', 'Q98501845', 'Q98501854', 'Q98502391', 'Q98502527',
  'Q98503343', 'Q98504346', 'Q98505027', 'Q99399197', 'Q99461292',
  'Q99529342',
];

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PE/1.0' },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);
  return res.json();
}

async function getWdInfo(qid) {
  const query = `
    SELECT ?itemLabel ?lat ?lng WHERE {
      VALUES ?item { wd:${qid} }
      OPTIONAL {
        ?item p:P625 ?cs .
        ?cs psv:P625 ?cv .
        ?cv wikibase:geoLatitude ?lat .
        ?cv wikibase:geoLongitude ?lng .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,fr,it,ca" }
    } LIMIT 1
  `;
  const data = await sparql(query);
  const b = data.results.bindings[0];
  if (!b) return null;
  return {
    label: b.itemLabel?.value || null,
    lat: b.lat ? parseFloat(b.lat.value) : null,
    lng: b.lng ? parseFloat(b.lng.value) : null,
  };
}

function distancia(la1, lo1, la2, lo2) {
  // Haversine simplificado en km
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(la2 - la1);
  const dLng = toRad(lo2 - lo1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(la1))*Math.cos(toRad(la2))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);
  const client = await pool.connect();

  try {
    // ========== FASE 1: duplicados reales ==========
    console.log('═══ FASE 1: 3 duplicados reales (merge) ═══\n');
    for (const d of DUPLICADOS_REALES) {
      console.log(`${d.qid}: conservar bien #${d.conservar}, borrar bien #${d.borrar}`);

      // 1.1 Mover imagenes del bien_id a borrar al de conservar (solo si conservar no las tiene ya)
      const imgsBorrar = await client.query(
        'SELECT id, url FROM imagenes WHERE bien_id=$1', [d.borrar]
      );
      const imgsConservar = await client.query(
        'SELECT url FROM imagenes WHERE bien_id=$1', [d.conservar]
      );
      const urlsExistentes = new Set(imgsConservar.rows.map(r => r.url));
      const aMover = imgsBorrar.rows.filter(r => !urlsExistentes.has(r.url));
      console.log(`  imágenes a mover: ${aMover.length} (de ${imgsBorrar.rows.length}, ${imgsBorrar.rows.length - aMover.length} ya existen en destino)`);

      if (!DRY_RUN) {
        if (aMover.length > 0) {
          await client.query(
            `UPDATE imagenes SET bien_id=$1 WHERE id = ANY($2)`,
            [d.conservar, aMover.map(r => r.id)]
          );
        }
        // Borrar el resto de imagenes (ya duplicadas), wikidata y bien
        await client.query('DELETE FROM imagenes WHERE bien_id=$1', [d.borrar]);
        await client.query('DELETE FROM wikidata WHERE bien_id=$1', [d.borrar]);
        await client.query('DELETE FROM bienes WHERE id=$1', [d.borrar]);
        console.log(`  ✓ merge aplicado`);
      } else {
        console.log(`  [DRY-RUN] se borrarían: ${imgsBorrar.rows.length - aMover.length} imgs duplicadas + bien #${d.borrar}`);
      }
    }

    // ========== FASE 2: QIDs ambiguos ==========
    console.log('\n═══ FASE 2: 11 QIDs ambiguos (match por distancia) ═══\n');
    for (const qid of QIDS_AMBIGUOS) {
      const wdInfo = await getWdInfo(qid);
      if (!wdInfo) {
        console.log(`${qid}: no encontrado en Wikidata, omitiendo`);
        continue;
      }
      const bienes = await client.query(
        `SELECT b.id, b.denominacion, b.latitud, b.longitud, b.comunidad_autonoma
         FROM wikidata w JOIN bienes b ON b.id=w.bien_id
         WHERE w.qid=$1`, [qid]
      );
      console.log(`${qid}  "${wdInfo.label}"  WD coords: ${wdInfo.lat?.toFixed(4)},${wdInfo.lng?.toFixed(4)}`);
      const conDist = bienes.rows.map(b => ({
        ...b,
        dist: (wdInfo.lat && b.latitud)
          ? distancia(wdInfo.lat, wdInfo.lng, parseFloat(b.latitud), parseFloat(b.longitud))
          : Infinity,
      })).sort((a, b) => a.dist - b.dist);

      conDist.forEach(b => {
        console.log(`  #${b.id}  ${b.denominacion.slice(0,50).padEnd(50)} ${b.latitud?.toFixed?.(4) || '?'},${b.longitud?.toFixed?.(4) || '?'}  dist=${b.dist === Infinity ? '?' : b.dist.toFixed(2)+'km'}`);
      });

      // El más cercano (dist < 1km y label match) lo conservamos. Si no hay match razonable, borramos TODOS los wikidata (QID no aplica a ninguno).
      const mejor = conDist[0];
      const restantes = conDist.slice(1);

      if (mejor.dist <= 1) {
        // Conservar wikidata solo en el mejor
        console.log(`  → conservar wikidata en #${mejor.id} (más cercano: ${mejor.dist.toFixed(2)}km)`);
        if (!DRY_RUN) {
          for (const r of restantes) {
            await client.query('DELETE FROM wikidata WHERE bien_id=$1 AND qid=$2', [r.id, qid]);
          }
          console.log(`  ✓ borradas ${restantes.length} entradas wikidata erróneas`);
        }
      } else {
        // Ningún bien está realmente cerca del QID — borrar TODOS los wikidata para este QID
        console.log(`  → NINGÚN bien coincide (mejor dist=${mejor.dist === Infinity ? '?' : mejor.dist.toFixed(2)+'km'}). Borrar TODOS los wikidata.`);
        if (!DRY_RUN) {
          await client.query('DELETE FROM wikidata WHERE qid=$1', [qid]);
          console.log(`  ✓ borradas ${conDist.length} entradas wikidata erróneas`);
        }
      }
      await new Promise(r => setTimeout(r, 700));
    }

    // Verificación final
    console.log('\n═══ Verificación post-limpieza ═══');
    const dup = await client.query(`
      SELECT qid, COUNT(*)::int as n FROM wikidata
      GROUP BY qid HAVING COUNT(*) > 1
    `);
    console.log(`QIDs aún duplicados: ${dup.rows.length}`);
    dup.rows.forEach(r => console.log(`  ${r.qid}: ${r.n}`));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
