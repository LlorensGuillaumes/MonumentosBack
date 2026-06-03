/**
 * Descarga labels multilingue de Wikidata para todos los QIDs de eventos
 * (qid_evento + qid_evento_padre) y actualiza los 8 JSON i18n.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = 'C:\\Users\\usuario\\Desktop\\MonumentosFront\\src\\i18n\\locales';
const LOCALES = ['es','ca','en','eu','fr','gl','it','pt'];
const BATCH = 100;

async function sparql(qids, langs) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  const langFilter = langs.map(l => `"${l}"`).join(',');
  const q = `
    SELECT ?qid ?lang ?label WHERE {
      VALUES ?qid { ${values} }
      ?qid rdfs:label ?label.
      FILTER(LANG(?label) IN (${langFilter}))
      BIND(LANG(?label) as ?lang)
    }`;
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': 'PatrimonioBot/1.0', 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).results.bindings;
}

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });

  const r = await p.query(`
    SELECT DISTINCT q FROM (
      SELECT qid_evento as q FROM eventos_monumento WHERE qid_evento IS NOT NULL
      UNION
      SELECT qid_evento_padre as q FROM eventos_monumento WHERE qid_evento_padre IS NOT NULL
    ) t WHERE q IS NOT NULL
  `);
  await p.end();
  const qids = r.rows.map(x => x.q);
  console.log(`QIDs únicos: ${qids.length}`);

  // Bulk SPARQL
  const labels = {}; // labels[qid][lang] = label
  for (let i = 0; i < qids.length; i += BATCH) {
    const batch = qids.slice(i, i + BATCH);
    try {
      const rows = await sparql(batch, LOCALES);
      for (const row of rows) {
        const qid = row.qid.value.split('/').pop();
        const lang = row.lang.value;
        if (!labels[qid]) labels[qid] = {};
        labels[qid][lang] = row.label.value;
      }
      console.log(`  Batch ${i / BATCH + 1}/${Math.ceil(qids.length / BATCH)}: ${rows.length} labels`);
    } catch(e) {
      console.log(`  Batch ${i / BATCH + 1} ERR:`, e.message);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  // Actualizar locales
  for (const lng of LOCALES) {
    const file = path.join(LOCALES_DIR, `${lng}.json`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    json.filters = json.filters || {};
    json.filters.events = json.filters.events || {};
    let updated = 0;
    for (const qid of qids) {
      const label = labels[qid]?.[lng];
      if (label && json.filters.events[qid] !== label) {
        json.filters.events[qid] = label;
        updated++;
      }
    }
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`${lng}.json: ${updated} labels actualizados`);
  }

  fs.writeFileSync('_eventos_labels_wikidata.json', JSON.stringify(labels, null, 2));
})();
