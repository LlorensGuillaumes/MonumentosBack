// Probar batch SPARQL P793: pasar 50 QIDs en una sola query con VALUES
require('dotenv').config();
const { Pool } = require('pg');

async function sparql(q) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': 'PatrimonioBot/1.0 (j.llorens@uniogestio.com)' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).results.bindings;
}

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  const r = await p.query("SELECT qid FROM wikidata WHERE qid IS NOT NULL LIMIT 50");
  await p.end();

  const qids = r.rows.map(x => `wd:${x.qid}`).join(' ');
  const q = `SELECT ?b ?ev ?evLabel WHERE { VALUES ?b { ${qids} } ?b wdt:P793 ?ev. SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". } }`;

  const t0 = Date.now();
  const rows = await sparql(q);
  console.log(`Query con 50 QIDs: ${rows.length} eventos en ${Date.now()-t0}ms`);
  rows.slice(0,15).forEach(x => console.log(' ', x.b.value.split('/').pop(), '→', x.ev.value.split('/').pop(), x.evLabel?.value));
})();
