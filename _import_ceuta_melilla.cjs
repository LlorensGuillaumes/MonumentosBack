/**
 * Importa monumentos patrimoniales de Ceuta y Melilla desde Wikidata.
 *
 * Estrategia:
 *  1. SPARQL — buscar items en (Ceuta Q5823) o (Melilla Q5826) que:
 *     - tengan coords (P625) y
 *     - sean BIC (P1435 = Q23712) O sean monumento/iglesia/castillo/yacimiento.
 *  2. Comparar con QIDs ya existentes en tabla wikidata para evitar duplicados.
 *  3. INSERT bienes + wikidata + imágenes (transaccional).
 *
 * Uso:
 *   node _import_ceuta_melilla.cjs            # dry-run
 *   node _import_ceuta_melilla.cjs --apply    # ejecuta inserts
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

const COMMONS = (filename) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'PatrimonioEuropeoBot/1.0 (Ceuta+Melilla import)',
      },
    });
    if (res.status === 429 || res.status === 502 || res.status === 503) {
      await sleep(2000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`SPARQL ${res.status}: ${await res.text()}`);
    return res.json();
  }
  throw new Error('SPARQL max retries');
}

// Query: items con coords + (BIC O instancia de tipo patrimonial) + ubicados en Ceuta/Melilla
function buildQuery(ccaaQid) {
  return `
    SELECT DISTINCT ?item ?itemLabel ?lat ?lng ?image ?tipoLabel ?municipioLabel WHERE {
      ?item wdt:P131* wd:${ccaaQid} .
      ?item p:P625 ?coordStatement .
      ?coordStatement psv:P625 ?coordValue .
      ?coordValue wikibase:geoLatitude ?lat .
      ?coordValue wikibase:geoLongitude ?lng .
      OPTIONAL { ?item wdt:P18 ?image }
      OPTIONAL { ?item wdt:P31 ?tipo }
      OPTIONAL { ?item wdt:P131 ?municipio }
      {
        ?item wdt:P1435 wd:Q23712 .         # BIC
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q24398318 . # iglesia / catedral
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q23413 .  # castillo
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q839954 . # yacimiento arqueológico
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q33506 .  # museo
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q4989906 . # monumento
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q41176 .  # edificio
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" }
    }
    LIMIT 200
  `;
}

// Categorizar tipo legible
function categorize(label) {
  if (!label) return null;
  const l = label.toLowerCase();
  if (/iglesia|catedral|capilla|ermita|basílica|parroquia|santuario|monasterio|convento/.test(l)) return 'Iglesia / Ermita';
  if (/castillo|fortaleza|alcazaba|murall|torre|fuerte|baluart|ciudadela|fortific/.test(l)) return 'Castillo / Fortaleza';
  if (/yacimiento|arqueol|ruinas|necrópolis|dolmen/.test(l)) return 'Yacimiento arqueológico';
  if (/museo|museu/.test(l)) return 'Museo';
  if (/palacio|palau|mansión|residencia/.test(l)) return 'Palacio';
  if (/puente|aqüeducto|acueducto/.test(l)) return 'Ingeniería / Puente';
  if (/teatro|cine|auditorio/.test(l)) return 'Teatro';
  return 'Edificio histórico';
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY (escribirá en BD)'}\n`);

  const regions = [
    // Q5823 = Ceuta (verificado); Q5831 = Melilla (Q5826 era Xi'an, China — corregido)
    { ccaa: 'Ceuta',   qid: 'Q5823' },
    { ccaa: 'Melilla', qid: 'Q5831' },
  ];

  const all = [];
  for (const r of regions) {
    console.log(`\n=== Buscando en ${r.ccaa} (${r.qid}) ===`);
    const data = await sparql(buildQuery(r.qid));
    const items = data.results.bindings.map(b => ({
      qid: b.item.value.replace('http://www.wikidata.org/entity/', ''),
      nom: b.itemLabel?.value || null,
      lat: parseFloat(b.lat.value),
      lng: parseFloat(b.lng.value),
      img: b.image?.value || null,
      tipo: b.tipoLabel?.value || null,
      municipio: b.municipioLabel?.value || null,
      ccaa: r.ccaa,
    }));
    console.log(`  Items encontrados: ${items.length}`);
    all.push(...items);
  }

  // Dedup por QID dentro de results (mismo item puede salir varias veces si tiene varias categorías)
  const seen = new Set();
  const unique = all.filter(i => {
    if (seen.has(i.qid)) return false;
    seen.add(i.qid);
    return true;
  });
  console.log(`\nTotal único (deduplicado): ${unique.length}`);

  // Filtrar los que ya existen en BD
  const client = await pool.connect();
  let nuevos = [];
  try {
    const qids = unique.map(u => u.qid);
    if (qids.length > 0) {
      const existing = await client.query(
        'SELECT qid FROM wikidata WHERE qid = ANY($1)',
        [qids]
      );
      const existSet = new Set(existing.rows.map(r => r.qid));
      nuevos = unique.filter(u => !existSet.has(u.qid));
      console.log(`Ya existían en BD: ${existing.rows.length}`);
      console.log(`A insertar nuevos: ${nuevos.length}`);
    }

    if (nuevos.length === 0) {
      console.log('\nNada nuevo que insertar.');
      return;
    }

    // Vista previa
    console.log('\nPreview (max 20):');
    nuevos.slice(0, 20).forEach(n =>
      console.log(`  ${n.qid}  ${n.ccaa.padEnd(8)} ${(n.nom || '???').slice(0, 50).padEnd(50)} ${n.municipio || ''}  ${n.tipo || ''}  ${n.img ? '🖼' : ' '}`)
    );

    if (DRY_RUN) {
      console.log('\n[DRY-RUN] Sin escribir. Lanza con --apply para insertar.');
      return;
    }

    // Insertar
    console.log('\n=== Insertando en BD ===');
    await client.query('BEGIN');
    let inserted = 0, imagesIns = 0;
    for (const n of nuevos) {
      const r = await client.query(
        `INSERT INTO bienes (denominacion, tipo_monumento, municipio,
          comunidad_autonoma, pais, latitud, longitud, fuente_opendata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [n.nom || `Sin nombre ${n.qid}`, categorize(n.tipo || n.nom), n.municipio || n.ccaa, n.ccaa, 'España', n.lat, n.lng, 0]
      );
      const bienId = r.rows[0].id;

      const imageUrl = n.img || null;
      await client.query(
        'INSERT INTO wikidata (bien_id, qid, imagen_url) VALUES ($1, $2, $3)',
        [bienId, n.qid, imageUrl]
      );

      if (imageUrl) {
        await client.query(
          'INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1, $2, $3, $4)',
          [bienId, imageUrl, n.nom || n.qid, 'Wikimedia Commons']
        );
        imagesIns++;
      }
      inserted++;
      console.log(`  OK ${n.qid} (#${bienId}) ${n.nom?.slice(0, 60)}`);
    }
    await client.query('COMMIT');
    console.log(`\nInsertados: ${inserted} bienes (${imagesIns} con imagen)`);

    // Verificación
    const v = await client.query(
      `SELECT comunidad_autonoma, COUNT(*)::int as n FROM bienes
       WHERE pais='España' AND comunidad_autonoma IN ('Ceuta','Melilla')
       GROUP BY comunidad_autonoma`
    );
    console.log('\nEstado final:');
    v.rows.forEach(r => console.log(`  ${r.comunidad_autonoma}: ${r.n}`));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERROR — rollback:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
