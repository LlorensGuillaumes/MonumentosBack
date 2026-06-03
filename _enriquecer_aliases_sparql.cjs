/**
 * Extrae aliases (skos:altLabel) en 8 idiomas de Wikidata y los guarda en bien_aliases.
 * También extrae los labels principales (rdfs:label) por si difieren de la denominación en BD.
 *
 * Uso:
 *   node _enriquecer_aliases_sparql.cjs --apply
 *   node _enriquecer_aliases_sparql.cjs --apply --limit=100
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=0').split('=')[1], 10);
const BATCH_SIZE = 50;
const SLEEP_MS = 600;
const RETRIES = 5;
const FETCH_TIMEOUT_MS = 30000;

const LANGS = ['es', 'ca', 'en', 'fr', 'it', 'pt', 'eu', 'gl'];

// La tabla bien_aliases vive en DATABASE_URL_SEARCH (BD separada).
// Para leer wikidata.qid + bienes.id necesitamos también primaria.
const urlPri = process.env.DATABASE_URL.replace(/\s+/g, '');
const urlSearch = (process.env.DATABASE_URL_SEARCH || '').replace(/^'|'$/g, '').replace(/\s+/g, '');
if (!urlSearch) { console.error('Falta DATABASE_URL_SEARCH en .env'); process.exit(1); }
const poolPri = new Pool({ connectionString: urlPri, ssl: { rejectUnauthorized: false } });
const poolSearch = new Pool({ connectionString: urlSearch, ssl: { rejectUnauthorized: false } });
// Alias para mantener mínimas cambios en el resto del script
const pool = poolPri;

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildSparql(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  const langFilter = LANGS.map(l => `"${l}"`).join(',');
  return `
    SELECT ?qid ?lang ?label ?alias
    WHERE {
      VALUES ?qid { ${values} }
      {
        ?qid rdfs:label ?label.
        BIND(LANG(?label) AS ?lang)
        FILTER(?lang IN (${langFilter}))
      } UNION {
        ?qid skos:altLabel ?alias.
        BIND(LANG(?alias) AS ?lang)
        FILTER(?lang IN (${langFilter}))
      }
    }
  `;
}

async function fetchSparql(qids) {
  const query = buildSparql(qids);
  for (let i = 0; i < RETRIES; i++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(SPARQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/sparql-results+json',
          'User-Agent': 'PatrimonioEuropeo/1.0 (contact@patrimonio-europeo.netlify.app)',
        },
        body: 'query=' + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (res.status === 429 || res.status === 503 || res.status === 504) {
        await sleep(Math.pow(2, i + 1) * 1000);
        continue;
      }
      if (res.status >= 400) return { error: `HTTP ${res.status}` };
      const data = await res.json();
      return { data };
    } catch (e) {
      clearTimeout(tid);
      if (i === RETRIES - 1) return { error: `${e.code || 'EXC'}: ${e.message}` };
      await sleep(Math.pow(2, i + 1) * 1000);
    }
  }
  return { error: 'max retries' };
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Batch: ${BATCH_SIZE} | Sleep: ${SLEEP_MS}ms | Langs: ${LANGS.join(',')}`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);

  // Bienes con QID que aún NO tienen alias guardado (alias vive en BD search)
  const yaConAlias = new Set();
  const rSearch = await poolSearch.query(`SELECT DISTINCT bien_id FROM bien_aliases`);
  for (const row of rSearch.rows) yaConAlias.add(row.bien_id);
  console.log(`  Ya con alias en BD search: ${yaConAlias.size}`);

  const r = await poolPri.query(`
    SELECT w.bien_id, w.qid
    FROM wikidata w
    WHERE w.qid IS NOT NULL
    ORDER BY w.bien_id
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `);
  r.rows = r.rows.filter(row => !yaConAlias.has(row.bien_id));
  console.log(`Candidatos: ${r.rows.length}\n`);
  if (r.rows.length === 0) { await pool.end(); return; }

  const qidToBienIds = new Map();
  for (const row of r.rows) {
    if (!qidToBienIds.has(row.qid)) qidToBienIds.set(row.qid, []);
    qidToBienIds.get(row.qid).push(row.bien_id);
  }
  const uniqueQids = Array.from(qidToBienIds.keys());

  let processed = 0, insertedLabels = 0, insertedAliases = 0, errors = 0, conAlguno = 0;

  for (let i = 0; i < uniqueQids.length; i += BATCH_SIZE) {
    const batch = uniqueQids.slice(i, i + BATCH_SIZE);
    const { data, error } = await fetchSparql(batch);
    if (error) {
      errors += batch.length;
      console.log(`  ⚠ Batch ${i}-${i + batch.length} ERROR: ${error}`);
      await sleep(SLEEP_MS);
      continue;
    }

    // Agrupar por qid
    const byQid = new Map();
    for (const binding of data.results?.bindings || []) {
      const qid = binding.qid?.value?.split('/').pop();
      if (!qid) continue;
      if (!byQid.has(qid)) byQid.set(qid, { labels: new Map(), aliases: [] });
      const rec = byQid.get(qid);
      const lang = binding.lang?.value;
      if (!lang) continue;
      if (binding.label) {
        rec.labels.set(lang, binding.label.value);
      } else if (binding.alias) {
        rec.aliases.push({ lang, alias: binding.alias.value });
      }
    }

    for (const qid of batch) {
      processed++;
      const rec = byQid.get(qid);
      if (!rec) continue;
      const bienIds = qidToBienIds.get(qid) || [];
      let tuvoAlgo = false;

      // Insertar labels principales (es_principal=true)
      for (const [lang, label] of rec.labels.entries()) {
        for (const bienId of bienIds) {
          if (!DRY_RUN) {
            await poolSearch.query(`
              INSERT INTO bien_aliases (bien_id, alias, lang, es_principal)
              VALUES ($1, $2, $3, TRUE)
              ON CONFLICT (bien_id, alias, lang) DO UPDATE SET es_principal = TRUE
            `, [bienId, label, lang]);
          }
          insertedLabels++;
        }
        tuvoAlgo = true;
      }
      // Insertar aliases
      for (const { lang, alias } of rec.aliases) {
        for (const bienId of bienIds) {
          if (!DRY_RUN) {
            await poolSearch.query(`
              INSERT INTO bien_aliases (bien_id, alias, lang, es_principal)
              VALUES ($1, $2, $3, FALSE)
              ON CONFLICT DO NOTHING
            `, [bienId, alias, lang]);
          }
          insertedAliases++;
        }
        tuvoAlgo = true;
      }
      if (tuvoAlgo) conAlguno++;
    }

    if ((i + BATCH_SIZE) % 1000 < BATCH_SIZE) {
      process.stdout.write(
        `  [${i + BATCH_SIZE}/${uniqueQids.length}] proc=${processed} con_alias=${conAlguno} labels=${insertedLabels} aliases=${insertedAliases} err=${errors}\n`
      );
    }
    await sleep(SLEEP_MS);
  }

  console.log('\n=== Resumen ===');
  console.log(`  Procesadas (qids):  ${processed}`);
  console.log(`  Bienes con dato:    ${conAlguno}`);
  console.log(`  Labels principales: ${insertedLabels}`);
  console.log(`  Aliases secundarios:${insertedAliases}`);
  console.log(`  Errores:            ${errors}`);

  await poolPri.end();
  await poolSearch.end();
}

main().catch(e => { console.error(e); process.exit(1); });
