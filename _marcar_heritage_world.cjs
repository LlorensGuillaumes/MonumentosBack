/**
 * Marca bienes con heritage_world según UNESCO WHC + European Heritage Label.
 *
 * Valores: 'unesco', 'european', 'both'
 *
 * Uso:
 *   node _marcar_heritage_world.cjs           # dry-run
 *   node _marcar_heritage_world.cjs --apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PE/1.0 (heritage)' },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);
  return res.json();
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  // UNESCO WHC en ES, IT, FR, PT
  console.log('Consultando UNESCO WHC...');
  const unescoQ = `
    SELECT DISTINCT ?s WHERE {
      ?s wdt:P1435 wd:Q9259 .
      ?s wdt:P17 ?country .
      FILTER(?country IN (wd:Q29, wd:Q38, wd:Q142, wd:Q45))
    }
  `;
  const unescoData = await sparql(unescoQ);
  const unescoQids = new Set(unescoData.results.bindings.map(b => b.s.value.replace('http://www.wikidata.org/entity/', '')));
  console.log(`  UNESCO WHC en ES/IT/FR/PT: ${unescoQids.size}`);

  // European Heritage Label (todos los países)
  console.log('Consultando European Heritage Label...');
  const ehlQ = `
    SELECT DISTINCT ?s WHERE {
      { ?s wdt:P1435 wd:Q1378113 } UNION { ?s wdt:P166 wd:Q1378113 } UNION { ?s wdt:P361 wd:Q1378113 }
    }
  `;
  const ehlData = await sparql(ehlQ);
  const ehlQids = new Set(ehlData.results.bindings.map(b => b.s.value.replace('http://www.wikidata.org/entity/', '')));
  console.log(`  European Heritage Label: ${ehlQids.size}`);

  // QIDs que están en ambos
  const both = new Set([...unescoQids].filter(q => ehlQids.has(q)));
  const onlyUnesco = new Set([...unescoQids].filter(q => !both.has(q)));
  const onlyEhl = new Set([...ehlQids].filter(q => !both.has(q)));
  console.log(`  En ambos: ${both.size}`);
  console.log(`  Solo UNESCO: ${onlyUnesco.size}`);
  console.log(`  Solo EHL: ${onlyEhl.size}`);

  // Cruce con BD
  const allQids = new Set([...unescoQids, ...ehlQids]);
  const r = await pool.query(
    'SELECT bien_id, qid FROM wikidata WHERE qid = ANY($1)',
    [[...allQids]]
  );
  console.log(`\nEn BD (con QID match): ${r.rows.length} / ${allQids.size}`);

  const enBD = new Map(); // qid → bien_id
  r.rows.forEach(row => enBD.set(row.qid, row.bien_id));

  // Construir updates
  const updates = []; // { bien_id, status }
  let nUnesco = 0, nEhl = 0, nBoth = 0;
  for (const qid of allQids) {
    if (!enBD.has(qid)) continue;
    const isUnesco = unescoQids.has(qid);
    const isEhl = ehlQids.has(qid);
    let status = null;
    if (isUnesco && isEhl) { status = 'both'; nBoth++; }
    else if (isUnesco) { status = 'unesco'; nUnesco++; }
    else if (isEhl) { status = 'european'; nEhl++; }
    if (status) updates.push({ bien_id: enBD.get(qid), status, qid });
  }
  console.log(`\nA marcar:`);
  console.log(`  unesco: ${nUnesco}`);
  console.log(`  european: ${nEhl}`);
  console.log(`  both: ${nBoth}`);

  // Faltantes
  const faltantes = [...allQids].filter(q => !enBD.has(q));
  console.log(`\nQIDs reconocidos como heritage pero NO en BD: ${faltantes.length}`);

  // Mostrar muestra de faltantes con label
  if (faltantes.length > 0 && faltantes.length <= 100) {
    console.log('Faltantes (muestra):');
    faltantes.slice(0, 30).forEach(q => console.log(`  ${q}`));
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Sin escribir.');
    await pool.end();
    return;
  }

  // Aplicar
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const u of updates) {
      await client.query('UPDATE bienes SET heritage_world=$1 WHERE id=$2', [u.status, u.bien_id]);
      n++;
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${n} UPDATEs aplicados`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
  }

  // Verificación
  const v = await pool.query('SELECT heritage_world, COUNT(*)::int n FROM bienes WHERE heritage_world IS NOT NULL GROUP BY heritage_world');
  console.log('\nEstado final:');
  v.rows.forEach(x => console.log(`  ${x.heritage_world}: ${x.n}`));

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
