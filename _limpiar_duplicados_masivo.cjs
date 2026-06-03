/**
 * Limpieza masiva de duplicados QID en BD usando score combinado (sin SPARQL).
 *
 * Para cada QID con >1 bien_id, calcula score entre pares de bienes:
 *   - Denominación normalizada idéntica:  3 pts
 *   - Denominación similar (Levenshtein normalizado ≥ 0.85): 2 pts
 *   - Coordenadas <0.1km:                  2 pts
 *   - Mismo país:                          1 pt
 *   - Misma comunidad_autonoma:            1 pt
 *   - Mismo municipio:                     1 pt
 *   - Mismo tipo_monumento:                1 pt
 *
 * Si score ≥ 5 → duplicado real. Conservar bien con ID MENOR, merge imágenes únicas, borrar el otro.
 *
 * Uso:
 *   node _limpiar_duplicados_masivo.cjs            # dry-run
 *   node _limpiar_duplicados_masivo.cjs --apply    # ejecuta cambios
 *   node _limpiar_duplicados_masivo.cjs --threshold=4   # ajustar umbral
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const THRESHOLD = parseInt((args.find(a => a.startsWith('--threshold=')) || '--threshold=5').split('=')[1], 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sin acentos
    .replace(/[^a-z0-9\s]/g, ' ')                     // sin puntuación
    .replace(/\s+/g, ' ').trim();                     // espacios normalizados
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+cost);
    }
  }
  return m[a.length][b.length];
}

function similitud(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  const dist = levenshtein(na, nb);
  return 1 - dist / maxLen;
}

function distKm(la1, lo1, la2, lo2) {
  if (la1 == null || lo1 == null || la2 == null || lo2 == null) return Infinity;
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(la2 - la1);
  const dLng = toRad(lo2 - lo1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(la1))*Math.cos(toRad(la2))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function score(a, b) {
  let s = 0;
  const reasons = [];

  const na = normalize(a.denominacion);
  const nb = normalize(b.denominacion);
  if (na && nb) {
    if (na === nb) { s += 3; reasons.push('denom-idéntica'); }
    else {
      const sim = similitud(a.denominacion, b.denominacion);
      if (sim >= 0.85) { s += 2; reasons.push(`denom-similar-${sim.toFixed(2)}`); }
    }
  }

  const d = distKm(parseFloat(a.latitud), parseFloat(a.longitud), parseFloat(b.latitud), parseFloat(b.longitud));
  if (d < 0.1) { s += 2; reasons.push(`coords-${(d*1000).toFixed(0)}m`); }

  if (a.pais && b.pais && a.pais === b.pais) { s += 1; reasons.push('mismo-país'); }
  if (a.comunidad_autonoma && b.comunidad_autonoma && a.comunidad_autonoma === b.comunidad_autonoma) {
    s += 1; reasons.push('misma-CCAA');
  }
  if (a.municipio && b.municipio && normalize(a.municipio) === normalize(b.municipio)) {
    s += 1; reasons.push('mismo-municipio');
  }
  if (a.tipo_monumento && b.tipo_monumento && a.tipo_monumento === b.tipo_monumento) {
    s += 1; reasons.push('mismo-tipo');
  }

  return { s, reasons };
}

async function mergeBienes(client, conservar, borrar) {
  // 1. IMAGENES — mover únicas por URL
  const imgsBorrar = await client.query(
    'SELECT id, url FROM imagenes WHERE bien_id=$1', [borrar]
  );
  const imgsConservar = await client.query(
    'SELECT url FROM imagenes WHERE bien_id=$1', [conservar]
  );
  const urlsExistentes = new Set(imgsConservar.rows.map(r => r.url));
  const aMover = imgsBorrar.rows.filter(r => !urlsExistentes.has(r.url));
  if (aMover.length > 0) {
    await client.query(
      'UPDATE imagenes SET bien_id=$1 WHERE id = ANY($2)',
      [conservar, aMover.map(r => r.id)]
    );
  }
  await client.query('DELETE FROM imagenes WHERE bien_id=$1', [borrar]);

  // 2. WIKIDATA — borrar duplicado
  await client.query('DELETE FROM wikidata WHERE bien_id=$1', [borrar]);

  // 3. Tablas con posible UNIQUE (usuario_id + bien_id): borrar conflictos primero, luego UPDATE
  // favoritos
  await client.query(`
    DELETE FROM favoritos WHERE bien_id=$1 AND usuario_id IN (
      SELECT usuario_id FROM favoritos WHERE bien_id=$2
    )`, [borrar, conservar]);
  await client.query('UPDATE favoritos SET bien_id=$1 WHERE bien_id=$2', [conservar, borrar]);

  // notas_monumento
  await client.query(`
    DELETE FROM notas_monumento WHERE bien_id=$1 AND usuario_id IN (
      SELECT usuario_id FROM notas_monumento WHERE bien_id=$2
    )`, [borrar, conservar]);
  await client.query('UPDATE notas_monumento SET bien_id=$1 WHERE bien_id=$2', [conservar, borrar]);

  // valoraciones_monumento
  await client.query(`
    DELETE FROM valoraciones_monumento WHERE bien_id=$1 AND usuario_id IN (
      SELECT usuario_id FROM valoraciones_monumento WHERE bien_id=$2
    )`, [borrar, conservar]);
  await client.query('UPDATE valoraciones_monumento SET bien_id=$1 WHERE bien_id=$2', [conservar, borrar]);

  // 4. Tablas sin UNIQUE por usuario: UPDATE simple
  await client.query('UPDATE rutas_paradas SET bien_id=$1 WHERE bien_id=$2', [conservar, borrar]);
  await client.query('UPDATE rutas_culturales_paradas SET bien_id=$1 WHERE bien_id=$2', [conservar, borrar]);
  await client.query('UPDATE propuestas_monumentos SET bien_id=$1 WHERE bien_id=$2', [conservar, borrar]);
  await client.query('UPDATE eventos_monumento SET bien_id=$1 WHERE bien_id=$2', [conservar, borrar]);

  // sipca: si conservar ya tiene fila, mantenemos la de conservar y borramos la otra
  await client.query(`
    DELETE FROM sipca WHERE bien_id=$1 AND EXISTS (SELECT 1 FROM sipca WHERE bien_id=$2)`,
    [borrar, conservar]);
  await client.query('UPDATE sipca SET bien_id=$1 WHERE bien_id=$2', [conservar, borrar]);

  // social_history: posible UNIQUE en (bien_id, platform) — borrar conflictos primero
  await client.query(`
    DELETE FROM social_history WHERE bien_id=$1 AND platform IN (
      SELECT platform FROM social_history WHERE bien_id=$2
    )`, [borrar, conservar]);
  await client.query('UPDATE social_history SET bien_id=$1 WHERE bien_id=$2', [conservar, borrar]);
  // analytics_events: ON DELETE SET NULL — no es necesario UPDATE

  // 5. Finalmente borrar el bien
  await client.query('DELETE FROM bienes WHERE id=$1', [borrar]);
  return aMover.length;
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}  |  Umbral score: ≥${THRESHOLD}\n`);
  const client = await pool.connect();

  try {
    // 1. Obtener todos los QIDs duplicados
    const rDup = await client.query(`
      SELECT qid FROM wikidata GROUP BY qid HAVING COUNT(*) > 1
    `);
    console.log(`QIDs con duplicados: ${rDup.rows.length}\n`);

    // 2. Cargar los bienes asociados a esos QIDs en un solo query
    const qids = rDup.rows.map(r => r.qid);
    const rBienes = await client.query(`
      SELECT w.qid, b.id, b.denominacion, b.tipo_monumento, b.municipio,
             b.comunidad_autonoma, b.pais, b.latitud, b.longitud
      FROM wikidata w JOIN bienes b ON b.id=w.bien_id
      WHERE w.qid = ANY($1)
      ORDER BY w.qid, b.id
    `, [qids]);

    // Agrupar por QID
    const porQid = new Map();
    for (const r of rBienes.rows) {
      if (!porQid.has(r.qid)) porQid.set(r.qid, []);
      porQid.get(r.qid).push(r);
    }

    // 3. Analizar cada grupo
    // CRITERIO REFINADO: aceptar como duplicado si score >= THRESHOLD
    // Y además contiene al menos una señal FUERTE (denom-idéntica O coords-<100m)
    let totalDup = 0, totalNoDup = 0, totalAmbig = 0;
    const merges = [];
    const ambiguos = [];

    const tieneSenalFuerte = (reasons) =>
      reasons.some(r => r === 'denom-idéntica' || /^coords-\d+m$/.test(r));

    for (const [qid, bienes] of porQid) {
      bienes.sort((a, b) => a.id - b.id);
      const conservar = bienes[0];
      for (const otro of bienes.slice(1)) {
        const { s, reasons } = score(conservar, otro);
        if (s >= THRESHOLD && tieneSenalFuerte(reasons)) {
          merges.push({ qid, conservar: conservar.id, borrar: otro.id, score: s, reasons,
            denomA: conservar.denominacion, denomB: otro.denominacion });
          totalDup++;
        } else if (s >= 3) {
          ambiguos.push({ qid, a: conservar.id, b: otro.id, score: s, reasons,
            denomA: conservar.denominacion, denomB: otro.denominacion });
          totalAmbig++;
        } else {
          totalNoDup++;
        }
      }
    }

    console.log(`Resultado análisis:`);
    console.log(`  Duplicados claros (≥${THRESHOLD}): ${totalDup}`);
    console.log(`  Ambiguos (3-${THRESHOLD-1}):           ${totalAmbig}`);
    console.log(`  NO duplicados (<3):           ${totalNoDup}\n`);

    // Preview duplicados claros
    console.log('Preview duplicados claros (primeros 20):');
    merges.slice(0, 20).forEach(m =>
      console.log(`  ${m.qid}  conservar #${m.conservar}, borrar #${m.borrar}  [${m.score}pts: ${m.reasons.join(', ')}]\n    "${m.denomA}" ≈ "${m.denomB}"`)
    );

    if (ambiguos.length > 0) {
      console.log('\nPreview ambiguos (primeros 10, requerirían inspección manual):');
      ambiguos.slice(0, 10).forEach(m =>
        console.log(`  ${m.qid}  #${m.a} vs #${m.b}  [${m.score}pts: ${m.reasons.join(', ')}]\n    "${m.denomA}" ?= "${m.denomB}"`)
      );
    }

    if (DRY_RUN) {
      console.log(`\n[DRY-RUN] Sin escribir. Para aplicar: --apply`);
      return;
    }

    // 4. Ejecutar merges
    console.log(`\n═══ Aplicando ${merges.length} merges ═══`);
    await client.query('BEGIN');
    let done = 0, imgsMovidas = 0;
    try {
      for (const m of merges) {
        const n = await mergeBienes(client, m.conservar, m.borrar);
        imgsMovidas += n;
        done++;
        if (done % 100 === 0) console.log(`  [${done}/${merges.length}]`);
      }
      await client.query('COMMIT');
      console.log(`\n✓ Merges aplicados: ${done}  (imágenes movidas: ${imgsMovidas})`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('ROLLBACK:', e.message);
      throw e;
    }

    // Verificación
    const rPost = await client.query(`
      SELECT COUNT(*)::int as n FROM (
        SELECT qid FROM wikidata GROUP BY qid HAVING COUNT(*) > 1
      ) x
    `);
    console.log(`\nQIDs aún duplicados: ${rPost.rows[0].n}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
