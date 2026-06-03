/**
 * Extrae personas asociadas a bienes (architect, creator, author, designer, manufacturer, chairperson)
 * via SPARQL Wikidata y las guarda en bien_personas.
 *
 * Uso:
 *   node _enriquecer_personas_sparql.cjs --apply
 *   node _enriquecer_personas_sparql.cjs --apply --limit=100
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

const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

// Map P-id → rol
const ROLES = {
  architect: 'P84',
  creator:   'P170',
  author:    'P50',
  designer:  'P287',
  manufacturer: 'P176',
  chairperson:  'P488',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildSparql(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  // OPTIONAL para cada propiedad + label en español/inglés fallback
  const optionals = Object.entries(ROLES).map(([rol, prop]) => `
    OPTIONAL {
      ?qid wdt:${prop} ?${rol}.
      ?${rol} rdfs:label ?${rol}Label.
      FILTER(LANG(?${rol}Label) IN ("es","en","ca","fr","it","pt"))
    }`).join('\n');

  return `
    SELECT ?qid ?${Object.keys(ROLES).join(' ?')}
           ?${Object.keys(ROLES).map(r => r + 'Label').join(' ?')}
    WHERE {
      VALUES ?qid { ${values} }
      ${optionals}
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
  console.log(`Batch: ${BATCH_SIZE} | Sleep: ${SLEEP_MS}ms`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);

  // Candidatos: bienes con QID que NO tienen entry en bien_personas
  const r = await pool.query(`
    SELECT w.bien_id, w.qid
    FROM wikidata w
    WHERE w.qid IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM bien_personas bp WHERE bp.bien_id = w.bien_id)
    ORDER BY w.bien_id
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `);
  console.log(`Candidatos: ${r.rows.length}\n`);
  if (r.rows.length === 0) { await pool.end(); return; }

  // Build map qid → bien_id (puede haber QID con varios bien_ids — improbable pero posible)
  const qidToBienIds = new Map();
  for (const row of r.rows) {
    if (!qidToBienIds.has(row.qid)) qidToBienIds.set(row.qid, []);
    qidToBienIds.get(row.qid).push(row.bien_id);
  }
  const uniqueQids = Array.from(qidToBienIds.keys());

  let processed = 0, inserted = 0, errors = 0, conPersonas = 0;
  const roleCount = Object.fromEntries(Object.keys(ROLES).map(r => [r, 0]));

  for (let i = 0; i < uniqueQids.length; i += BATCH_SIZE) {
    const batch = uniqueQids.slice(i, i + BATCH_SIZE);
    const { data, error } = await fetchSparql(batch);
    if (error) {
      errors += batch.length;
      console.log(`  ⚠ Batch ${i}-${i + batch.length} ERROR: ${error}`);
      await sleep(SLEEP_MS);
      continue;
    }

    // Agregar resultados por QID (varias filas posibles por OPTIONAL combinatorias)
    const byQid = new Map(); // qid → Map(rol → Set([qid_persona, label]))
    for (const binding of data.results?.bindings || []) {
      const qid = binding.qid?.value?.split('/').pop();
      if (!qid) continue;
      if (!byQid.has(qid)) {
        const init = {};
        for (const rol of Object.keys(ROLES)) init[rol] = new Map();
        byQid.set(qid, init);
      }
      const rec = byQid.get(qid);
      for (const rol of Object.keys(ROLES)) {
        const personaUri = binding[rol]?.value;
        const personaLabel = binding[rol + 'Label']?.value;
        if (personaUri && personaLabel) {
          const personaQid = personaUri.split('/').pop();
          // Mantener solo un label por persona (prioridad por orden de respuesta)
          if (!rec[rol].has(personaQid)) rec[rol].set(personaQid, personaLabel);
        }
      }
    }

    // Insertar
    for (const qid of batch) {
      const rec = byQid.get(qid);
      processed++;
      if (!rec) continue;
      const bienIds = qidToBienIds.get(qid) || [];
      let bienConPersona = false;
      for (const rol of Object.keys(ROLES)) {
        for (const [personaQid, label] of rec[rol].entries()) {
          for (const bienId of bienIds) {
            if (!DRY_RUN) {
              await pool.query(`
                INSERT INTO bien_personas (bien_id, qid_persona, nombre, rol)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT DO NOTHING
              `, [bienId, personaQid, label, rol]);
            }
            inserted++;
          }
          roleCount[rol]++;
          bienConPersona = true;
        }
      }
      if (bienConPersona) conPersonas++;
    }

    if ((i + BATCH_SIZE) % 1000 < BATCH_SIZE) {
      process.stdout.write(
        `  [${i + BATCH_SIZE}/${uniqueQids.length}] proc=${processed} con_persona=${conPersonas} ins=${inserted} err=${errors}` +
        ` (arch=${roleCount.architect} cre=${roleCount.creator} aut=${roleCount.author} des=${roleCount.designer})\n`
      );
    }
    await sleep(SLEEP_MS);
  }

  console.log('\n=== Resumen ===');
  console.log(`  Procesadas (qids):  ${processed}`);
  console.log(`  Bienes con persona: ${conPersonas}`);
  console.log(`  Filas insertadas:   ${inserted}`);
  console.log(`  Errores:            ${errors}`);
  console.log(`  Por rol:`);
  for (const [rol, n] of Object.entries(roleCount)) console.log(`    ${rol.padEnd(13)} ${n}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
