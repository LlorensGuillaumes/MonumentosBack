/**
 * Arregla CCAA de los items importados OSM. Asignación por SPARQL P131* → CCAA España.
 *
 * Uso:
 *   node _arreglar_ccaa_osm.cjs           # dry-run
 *   node _arreglar_ccaa_osm.cjs --apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const BATCH_SIZE = 100;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// QIDs CCAA España (verificados antes)
const CCAA_QIDS = {
  'Q5783':      'Andalucía',
  'Q4040':      'Aragón',
  'Q3934':      'Asturias',
  'Q107356467': 'Illes Balears',
  'Q5813':      'Canarias',
  'Q3946':      'Cantabria',
  'Q5739':      'Castilla y León',
  'Q5748':      'Castilla-La Mancha',
  'Q5705':      'Catalunya',
  'Q5720':      'Comunitat Valenciana',
  'Q5777':      'Extremadura',
  'Q3908':      'Galicia',
  'Q5727':      'La Rioja',
  'Q5756':      'Comunidad de Madrid',
  'Q5772':      'Región de Murcia',
  'Q5773':      'Navarra',
  'Q3995':      'País Vasco',
  'Q5823':      'Ceuta',
  'Q5831':      'Melilla',
};
const CCAA_QID_SET = new Set(Object.keys(CCAA_QIDS));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PE/1.0' },
    });
    if ([429,502,503,504].includes(res.status)) { await sleep(3000*(i+1)); continue; }
    if (!res.ok) throw new Error(`SPARQL ${res.status}`);
    return res.json();
  }
  throw new Error('max retries');
}

function buildQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  return `
    SELECT ?item ?ccaa WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P131* ?ccaa .
      VALUES ?ccaa { ${Object.keys(CCAA_QIDS).map(q => 'wd:' + q).join(' ')} }
    }
  `;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  // Items con CCAA="Aragon" recientes (los OSM importados)
  const r = await pool.query(`
    SELECT b.id, w.qid FROM bienes b INNER JOIN wikidata w ON w.bien_id=b.id
    WHERE b.pais='España' AND b.comunidad_autonoma='Aragon' AND b.fuente_opendata=0
    ORDER BY b.id DESC
  `);
  console.log(`Items con CCAA="Aragon" sospechoso: ${r.rows.length}`);
  if (r.rows.length === 0) { await pool.end(); return; }

  const qidToBien = new Map();
  r.rows.forEach(x => qidToBien.set(x.qid, x.id));

  const updates = new Map(); // bien_id → ccaa_label
  const qids = [...qidToBien.keys()];

  for (let i = 0; i < qids.length; i += BATCH_SIZE) {
    const batch = qids.slice(i, i + BATCH_SIZE);
    try {
      const data = await sparql(buildQuery(batch));
      for (const b of data.results.bindings) {
        const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
        const ccaaQid = b.ccaa.value.replace('http://www.wikidata.org/entity/', '');
        const ccaa = CCAA_QIDS[ccaaQid];
        if (!ccaa) continue;
        const bienId = qidToBien.get(qid);
        if (bienId && !updates.has(bienId)) updates.set(bienId, ccaa);
      }
      process.stdout.write(`  [${Math.min(i+BATCH_SIZE, qids.length)}/${qids.length}] resueltos:${updates.size}\r`);
    } catch (e) {
      console.log(`\n  ⚠ batch ${i}: ${e.message.slice(0,80)}`);
    }
    await sleep(1000);
  }
  console.log();

  // Distribución
  const dist = new Map();
  for (const v of updates.values()) dist.set(v, (dist.get(v) || 0) + 1);
  console.log('Distribución por CCAA:');
  [...dist.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

  console.log(`\nSin CCAA resuelta: ${qids.length - updates.size}`);

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Sin escribir.');
    await pool.end();
    return;
  }

  // Aplicar UPDATEs
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const [id, ccaa] of updates) {
      await client.query('UPDATE bienes SET comunidad_autonoma=$1 WHERE id=$2', [ccaa, id]);
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
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
