/**
 * Re-enriquece wikidata.* (heritage_label, wikipedia_url, arquitecto, estilo,
 * inception, commons_category) para bienes "famosos" con QID pero campos vacíos.
 *
 * Uso:
 *   node _enriquecer_wikidata_famosos.cjs                    # dry-run, solo UNESCO/EHL
 *   node _enriquecer_wikidata_famosos.cjs --apply
 *   node _enriquecer_wikidata_famosos.cjs --all --apply      # también periodo IS NOT NULL
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const ALL = args.includes('--all');
const BATCH_SIZE = 60;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PE/1.0 (enrich famous)' },
    });
    if ([429,502,503,504].includes(res.status)) { await sleep(3000*(i+1)); continue; }
    if (!res.ok) throw new Error(`SPARQL ${res.status}: ${(await res.text()).slice(0,200)}`);
    return res.json();
  }
  throw new Error('max retries');
}

function buildBatchQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  return `
    SELECT ?item
      (SAMPLE(?img) as ?imagen)
      (SAMPLE(?wp) as ?wiki)
      (SAMPLE(?archLabel) as ?arquitecto)
      (SAMPLE(?styleLabel) as ?estilo)
      (SAMPLE(?inception) as ?inception)
      (SAMPLE(?hLabel) as ?heritage)
      (SAMPLE(?commons) as ?commons)
    WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?item wdt:P18 ?img }
      OPTIONAL { ?wp schema:about ?item ; schema:isPartOf <https://es.wikipedia.org/> }
      OPTIONAL { ?item wdt:P84 ?arch . ?arch rdfs:label ?archLabel FILTER(LANG(?archLabel)='es') }
      OPTIONAL { ?item wdt:P149 ?style . ?style rdfs:label ?styleLabel FILTER(LANG(?styleLabel)='es') }
      OPTIONAL { ?item wdt:P571 ?inception }
      OPTIONAL { ?item wdt:P1435 ?h . ?h rdfs:label ?hLabel FILTER(LANG(?hLabel)='es') }
      OPTIONAL { ?item wdt:P373 ?commons }
    } GROUP BY ?item
  `;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'} | scope: ${ALL ? 'TODOS famosos' : 'solo UNESCO/EHL'}`);

  const where = ALL
    ? `(b.heritage_world IS NOT NULL OR b.periodo IS NOT NULL)`
    : `b.heritage_world IS NOT NULL`;

  const r = await pool.query(`
    SELECT b.id, w.qid,
      (w.heritage_label IS NULL) as need_hl,
      (w.wikipedia_url IS NULL) as need_wp,
      (w.arquitecto IS NULL) as need_arq,
      (w.estilo IS NULL) as need_est,
      (w.inception IS NULL) as need_inc,
      (w.commons_category IS NULL) as need_com
    FROM bienes b INNER JOIN wikidata w ON w.bien_id=b.id
    WHERE w.qid IS NOT NULL AND ${where}
      AND (w.heritage_label IS NULL OR w.wikipedia_url IS NULL OR w.arquitecto IS NULL
           OR w.estilo IS NULL OR w.inception IS NULL OR w.commons_category IS NULL)
    ORDER BY b.id
  `);
  console.log(`Items a procesar: ${r.rows.length}\n`);
  if (r.rows.length === 0) { await pool.end(); return; }

  const qidToBien = new Map(); // qid → {id, needs}
  r.rows.forEach(x => {
    if (!qidToBien.has(x.qid)) qidToBien.set(x.qid, { id: x.id, ...x });
  });

  const updates = []; // {bien_id, fields}
  let okBatches = 0, failBatches = 0;

  const qids = [...qidToBien.keys()];
  for (let i = 0; i < qids.length; i += BATCH_SIZE) {
    const batch = qids.slice(i, i + BATCH_SIZE);
    try {
      const data = await sparql(buildBatchQuery(batch));
      for (const b of data.results.bindings) {
        const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
        const info = qidToBien.get(qid);
        if (!info) continue;
        const fields = {};
        if (info.need_hl  && b.heritage?.value)   fields.heritage_label = b.heritage.value;
        if (info.need_wp  && b.wiki?.value)       fields.wikipedia_url  = b.wiki.value;
        if (info.need_arq && b.arquitecto?.value) fields.arquitecto     = b.arquitecto.value;
        if (info.need_est && b.estilo?.value)     fields.estilo         = b.estilo.value;
        if (info.need_inc && b.inception?.value)  fields.inception      = b.inception.value;
        if (info.need_com && b.commons?.value)    fields.commons_category = b.commons.value;
        if (Object.keys(fields).length > 0) updates.push({ bien_id: info.id, fields });
      }
      okBatches++;
      process.stdout.write(`  [${Math.min(i+BATCH_SIZE, qids.length)}/${qids.length}] updates:${updates.length}\r`);
    } catch (e) {
      failBatches++;
      console.log(`\n  ⚠ batch ${i}: ${e.message.slice(0,80)}`);
    }
    await sleep(1200);
  }
  console.log();
  console.log(`Batches OK/FAIL: ${okBatches}/${failBatches}`);
  console.log(`UPDATEs preparados: ${updates.length}`);

  // Tally por campo
  const tally = {};
  updates.forEach(u => Object.keys(u.fields).forEach(k => tally[k] = (tally[k]||0)+1));
  console.log('Por campo a actualizar:');
  Object.entries(tally).sort((a,b)=>b[1]-a[1]).forEach(([k,n]) => console.log(`  ${String(n).padStart(6)}  ${k}`));

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Sin escribir.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let done = 0;
    for (const u of updates) {
      const sets = [];
      const params = [];
      let pi = 1;
      for (const [k, v] of Object.entries(u.fields)) {
        sets.push(`${k}=$${pi++}`);
        params.push(v);
      }
      params.push(u.bien_id);
      await client.query(`UPDATE wikidata SET ${sets.join(', ')} WHERE bien_id=$${pi}`, params);
      done++;
      if (done % 500 === 0) console.log(`  [${done}/${updates.length}]`);
    }
    await client.query('COMMIT');
    console.log(`✓ ${done} UPDATEs aplicados`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
