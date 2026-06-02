/**
 * Enriquece bienes.comarca via Wikidata SPARQL.
 *
 * Para cada bien con QID + sin comarca + en CCAA con comarcas (Cataluña, Valencia, Aragón, Galicia):
 *   ?qid wdt:P131* ?comarca. ?comarca wdt:P31/wdt:P279* wd:Q937876.
 *
 * Uso:
 *   node _enriquecer_comarca_sparql.cjs --apply --ccaa=Catalunya
 *   node _enriquecer_comarca_sparql.cjs --apply --ccaa="Comunitat Valenciana"
 *   node _enriquecer_comarca_sparql.cjs --apply --limit=100
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const CCAA = (args.find(a => a.startsWith('--ccaa=')) || '').split('=')[1] || null;
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=0').split('=')[1], 10);
const BATCH_SIZE = 50;
const SLEEP_MS = 600;
const RETRIES = 5;
const FETCH_TIMEOUT_MS = 30000;

const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildSparql(qids) {
    const values = qids.map(q => `wd:${q}`).join(' ');
    return `
        SELECT ?qid ?comarca ?comarcaLabel WHERE {
            VALUES ?qid { ${values} }
            ?qid wdt:P131 ?lugar.
            ?lugar wdt:P131* ?comarca.
            ?comarca wdt:P31/wdt:P279* wd:Q937876.
            SERVICE wikibase:label { bd:serviceParam wikibase:language "ca,es,gl,eu,en". }
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
            return { data: await res.json() };
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
    if (CCAA) console.log(`CCAA: ${CCAA}`);
    if (LIMIT) console.log(`Limit: ${LIMIT}`);

    const ccaaCondition = CCAA ? `AND b.comunidad_autonoma = '${CCAA.replace(/'/g, "''")}'` : '';
    const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';

    const r = await pool.query(`
        SELECT b.id AS bien_id, w.qid
        FROM bienes b JOIN wikidata w ON w.bien_id = b.id
        WHERE w.qid IS NOT NULL AND b.comarca IS NULL ${ccaaCondition}
        ORDER BY b.id ${limitClause}
    `);
    console.log(`Candidatos: ${r.rows.length}\n`);
    if (r.rows.length === 0) { await pool.end(); return; }

    const qidToBienIds = new Map();
    for (const row of r.rows) {
        if (!qidToBienIds.has(row.qid)) qidToBienIds.set(row.qid, []);
        qidToBienIds.get(row.qid).push(row.bien_id);
    }
    const uniqueQids = Array.from(qidToBienIds.keys());

    let processed = 0, conComarca = 0, updates = 0, errors = 0;
    const comarcaCount = new Map();

    for (let i = 0; i < uniqueQids.length; i += BATCH_SIZE) {
        const batch = uniqueQids.slice(i, i + BATCH_SIZE);
        const { data, error } = await fetchSparql(batch);
        if (error) {
            errors += batch.length;
            console.log(`  ⚠ Batch ${i}-${i + batch.length} ERROR: ${error}`);
            await sleep(SLEEP_MS);
            continue;
        }

        // Map qid → comarca label (puede haber varias; nos quedamos con la primera)
        const comarcaByQid = new Map();
        for (const binding of data.results?.bindings || []) {
            const qid = binding.qid?.value?.split('/').pop();
            const label = binding.comarcaLabel?.value;
            if (qid && label && !comarcaByQid.has(qid)) comarcaByQid.set(qid, label);
        }

        for (const qid of batch) {
            processed++;
            const comarca = comarcaByQid.get(qid);
            if (!comarca) continue;
            conComarca++;
            comarcaCount.set(comarca, (comarcaCount.get(comarca) || 0) + 1);
            const bienIds = qidToBienIds.get(qid) || [];
            for (const bienId of bienIds) {
                if (!DRY_RUN) {
                    await pool.query(`UPDATE bienes SET comarca = $1 WHERE id = $2`, [comarca, bienId]);
                }
                updates++;
            }
        }

        if ((i + BATCH_SIZE) % 500 < BATCH_SIZE) {
            process.stdout.write(
                `  [${i + BATCH_SIZE}/${uniqueQids.length}] proc=${processed} con_comarca=${conComarca} upd=${updates} err=${errors}\n`
            );
        }
        await sleep(SLEEP_MS);
    }

    console.log('\n=== Resumen ===');
    console.log(`  QIDs procesados:    ${processed}`);
    console.log(`  Con comarca:        ${conComarca}`);
    console.log(`  Filas updateadas:   ${updates}`);
    console.log(`  Errores:            ${errors}`);
    console.log(`\nTop 15 comarcas:`);
    [...comarcaCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([c, n]) =>
        console.log(`  ${String(n).padStart(5)}  ${c}`)
    );

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
