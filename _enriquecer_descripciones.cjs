/**
 * Enriquece descripciones (schema:description) en wikidata para bienes con QID
 * sin descripción. Usa SPARQL batch.
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const BATCH_SIZE = 100;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'PatrimonioEuropeoBot/1.0 (description enrichment)',
      },
    });
    if ([429, 502, 503, 504].includes(res.status)) { await sleep(3000 * (i + 1)); continue; }
    if (!res.ok) throw new Error(`SPARQL ${res.status}`);
    return res.json();
  }
  throw new Error('max retries');
}

function buildBatchQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  return `
    SELECT ?item ?descEs ?descCa ?descEn WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?item schema:description ?descEs FILTER(LANG(?descEs)='es') }
      OPTIONAL { ?item schema:description ?descCa FILTER(LANG(?descCa)='ca') }
      OPTIONAL { ?item schema:description ?descEn FILTER(LANG(?descEn)='en') }
    }
  `;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  const r = await pool.query(`
    SELECT b.id, w.qid FROM bienes b
    INNER JOIN wikidata w ON w.bien_id=b.id
    WHERE b.pais='España' AND w.qid IS NOT NULL AND (w.descripcion IS NULL OR w.descripcion='')
    ORDER BY b.id
  `);
  console.log(`Bienes a procesar: ${r.rows.length}`);
  if (r.rows.length === 0) { await pool.end(); return; }

  const resolved = new Map(); // bienId → desc
  let resueltos = 0;

  for (let i = 0; i < r.rows.length; i += BATCH_SIZE) {
    const batch = r.rows.slice(i, i + BATCH_SIZE);
    const qids = [...new Set(batch.map(b => b.qid))];
    try {
      const data = await sparql(buildBatchQuery(qids));
      const descMap = new Map();
      for (const b of data.results.bindings) {
        const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
        if (descMap.has(qid)) continue;
        const desc = b.descEs?.value || b.descCa?.value || b.descEn?.value;
        if (desc) descMap.set(qid, desc);
      }
      for (const it of batch) {
        const d = descMap.get(it.qid);
        if (d) { resolved.set(it.id, d); resueltos++; }
      }
      process.stdout.write(`  [${Math.min(i + BATCH_SIZE, r.rows.length)}/${r.rows.length}] resueltos:${resueltos}\r`);
    } catch (e) {
      console.log(`\n  ⚠ batch fallido: ${e.message.slice(0,80)}`);
    }
    await sleep(800);
  }
  console.log();
  console.log(`Resueltos: ${resolved.size}/${r.rows.length}`);

  if (!DRY_RUN && resolved.size > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let done = 0;
      for (const [id, desc] of resolved) {
        await client.query('UPDATE wikidata SET descripcion=$1 WHERE bien_id=$2', [desc, id]);
        done++;
        if (done % 1000 === 0) console.log(`  [${done}/${resolved.size}]`);
      }
      await client.query('COMMIT');
      console.log(`✓ ${done} UPDATEs aplicados`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('ROLLBACK:', e.message);
    } finally {
      client.release();
    }
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
