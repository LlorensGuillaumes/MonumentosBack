/**
 * Oleada B — Enriquece tabla `wikidata` con 4 propiedades estructuradas:
 *   - P127 owner       → propietario
 *   - P140 religion    → religion
 *   - P825 dedicated to→ dedicado_a
 *   - P361 part of     → parte_de
 *
 * Estrategia:
 *   - SPARQL batch de 50 QIDs por query (límite WDQS razonable)
 *   - Si una propiedad tiene múltiples valores, se concatenan con " | "
 *   - Labels en es, fallback ca/en si no hay
 *   - Resume automático: salta bienes con las 4 columnas ya pobladas O sin
 *     ninguna propiedad encontrada (marcados con NO_PROPS)
 *
 * Uso:
 *   node _enriquecer_wikidata_props.cjs                  # dry-run, --solo-famosos
 *   node _enriquecer_wikidata_props.cjs --apply --solo-famosos
 *   node _enriquecer_wikidata_props.cjs --apply --con-periodo
 *   node _enriquecer_wikidata_props.cjs --apply          # todos los 224k
 *   node _enriquecer_wikidata_props.cjs --apply --limit=100
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const SOLO_FAMOSOS = args.includes('--solo-famosos');
const CON_PERIODO = args.includes('--con-periodo');
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=0').split('=')[1], 10);
const SPARQL_BATCH = 50;
const SLEEP_MS = 400;
const RETRIES = 5;
const FETCH_TIMEOUT_MS = 30000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparqlQuery(qids) {
    const values = qids.map(q => `wd:${q}`).join(' ');
    const query = `
SELECT ?qid ?propietarioLabel ?religionLabel ?dedicado_aLabel ?parte_deLabel WHERE {
  VALUES ?qid { ${values} }
  OPTIONAL { ?qid wdt:P127 ?propietario. }
  OPTIONAL { ?qid wdt:P140 ?religion. }
  OPTIONAL { ?qid wdt:P825 ?dedicado_a. }
  OPTIONAL { ?qid wdt:P361 ?parte_de. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,en". }
}`;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;

    for (let i = 0; i < RETRIES; i++) {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'PatrimonioEuropeo/1.0 (https://patrimonio-europeo.netlify.app)',
                    'Accept': 'application/sparql-results+json',
                },
                signal: ctrl.signal,
            });
            clearTimeout(tid);
            if (res.status === 429 || res.status === 503 || res.status === 504) {
                await sleep(Math.pow(2, i + 1) * 1000);
                continue;
            }
            if (!res.ok) return { error: `HTTP ${res.status}` };
            const data = await res.json();
            return { bindings: data.results.bindings };
        } catch (e) {
            clearTimeout(tid);
            if (i === RETRIES - 1) return { error: e.message };
            await sleep(Math.pow(2, i + 1) * 1000);
        }
    }
    return { error: 'max retries' };
}

/**
 * Procesa bindings SPARQL y agrega por QID, devolviendo Map<qid, {propietario, religion, dedicado_a, parte_de}>.
 * Cada propiedad puede tener múltiples valores (e.g., dedicado a 2 santos) → join con " | ".
 */
function aggregateBindings(bindings) {
    const byQid = new Map();
    for (const row of bindings) {
        const qidUri = row.qid?.value || '';
        const qid = qidUri.replace('http://www.wikidata.org/entity/', '');
        if (!qid) continue;
        if (!byQid.has(qid)) {
            byQid.set(qid, { propietario: new Set(), religion: new Set(), dedicado_a: new Set(), parte_de: new Set() });
        }
        const v = byQid.get(qid);
        const props = ['propietario', 'religion', 'dedicado_a', 'parte_de'];
        for (const p of props) {
            const label = row[`${p}Label`]?.value;
            if (label && label.length < 250) v[p].add(label);
        }
    }
    const result = new Map();
    for (const [qid, sets] of byQid.entries()) {
        result.set(qid, {
            propietario: Array.from(sets.propietario).join(' | ') || null,
            religion: Array.from(sets.religion).join(' | ') || null,
            dedicado_a: Array.from(sets.dedicado_a).join(' | ') || null,
            parte_de: Array.from(sets.parte_de).join(' | ') || null,
        });
    }
    return result;
}

(async () => {
    let scope;
    if (SOLO_FAMOSOS) scope = 'famosos (heritage_world IS NOT NULL)';
    else if (CON_PERIODO) scope = 'con periodo (heritage_world OR periodo)';
    else scope = 'todos con qid';
    console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'} | scope: ${scope}${LIMIT ? ` | LIMIT=${LIMIT}` : ''}`);
    console.log(`Batch SPARQL: ${SPARQL_BATCH} QIDs | sleep entre batches: ${SLEEP_MS}ms\n`);

    const whereParts = [`w.qid IS NOT NULL`, `(w.propietario IS NULL AND w.religion IS NULL AND w.dedicado_a IS NULL AND w.parte_de IS NULL)`];
    if (SOLO_FAMOSOS) whereParts.push(`b.heritage_world IS NOT NULL`);
    else if (CON_PERIODO) whereParts.push(`(b.heritage_world IS NOT NULL OR b.periodo IS NOT NULL)`);
    const limClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';

    const r = await pool.query(`
      SELECT b.id AS bien_id, w.qid
      FROM bienes b
      INNER JOIN wikidata w ON w.bien_id = b.id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY
        CASE WHEN b.heritage_world IS NOT NULL THEN 0 ELSE 1 END,
        b.id
      ${limClause}
    `);
    const candidates = r.rows;
    console.log(`Candidatos a procesar: ${candidates.length}\n`);
    if (candidates.length === 0) { await pool.end(); return; }

    let okCount = 0, withProp = 0, errores = 0;
    let propietarios = 0, religiones = 0, dedicaciones = 0, partes = 0;
    const preview = [];

    for (let i = 0; i < candidates.length; i += SPARQL_BATCH) {
        const batch = candidates.slice(i, i + SPARQL_BATCH);
        const qidToBienId = new Map(batch.map(c => [c.qid, c.bien_id]));
        const qids = batch.map(c => c.qid);

        const { bindings, error } = await sparqlQuery(qids);
        if (error) {
            errores += batch.length;
            console.error(`\n  ⚠ Batch ${i}-${i + batch.length} ERROR: ${error}`);
            await sleep(SLEEP_MS);
            continue;
        }

        const agg = aggregateBindings(bindings);

        for (const c of batch) {
            const v = agg.get(c.qid) || { propietario: null, religion: null, dedicado_a: null, parte_de: null };
            const hasAny = v.propietario || v.religion || v.dedicado_a || v.parte_de;
            if (hasAny) {
                withProp++;
                if (v.propietario) propietarios++;
                if (v.religion) religiones++;
                if (v.dedicado_a) dedicaciones++;
                if (v.parte_de) partes++;
                if (preview.length < 5) preview.push({ bien_id: c.bien_id, qid: c.qid, ...v });
            }

            if (!DRY_RUN) {
                try {
                    await pool.query(`
                      UPDATE wikidata SET
                        propietario = COALESCE($1, propietario),
                        religion = COALESCE($2, religion),
                        dedicado_a = COALESCE($3, dedicado_a),
                        parte_de = COALESCE($4, parte_de)
                      WHERE bien_id = $5
                    `, [v.propietario, v.religion, v.dedicado_a, v.parte_de, c.bien_id]);
                    okCount++;
                } catch (e) {
                    errores++;
                    if (errores < 5) console.error(`  ⚠ UPDATE #${c.bien_id}: ${e.message}`);
                }
            }
        }

        if (((i / SPARQL_BATCH) + 1) % 5 === 0 || i + SPARQL_BATCH >= candidates.length) {
            process.stdout.write(`  [${Math.min(i + SPARQL_BATCH, candidates.length)}/${candidates.length}] withProp=${withProp} (prop=${propietarios} rel=${religiones} ded=${dedicaciones} parte=${partes}) err=${errores}\r`);
        }
        await sleep(SLEEP_MS);
    }

    console.log('\n\nResumen:');
    console.log(`  Procesados:           ${candidates.length}`);
    console.log(`  Con al menos 1 prop:  ${withProp}  (${(withProp / candidates.length * 100).toFixed(1)}%)`);
    console.log(`  Con propietario:      ${propietarios}`);
    console.log(`  Con religion:         ${religiones}`);
    console.log(`  Con dedicado_a:       ${dedicaciones}`);
    console.log(`  Con parte_de:         ${partes}`);
    console.log(`  Errores:              ${errores}`);

    console.log('\nPreview 5 primeros con propiedades:');
    preview.forEach(p => {
        console.log(`  #${p.bien_id} [${p.qid}]`);
        if (p.propietario) console.log(`    propietario: ${p.propietario}`);
        if (p.religion) console.log(`    religion:    ${p.religion}`);
        if (p.dedicado_a) console.log(`    dedicado_a:  ${p.dedicado_a}`);
        if (p.parte_de) console.log(`    parte_de:    ${p.parte_de}`);
    });

    if (DRY_RUN) console.log('\n[DRY-RUN] Sin escribir.');
    await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
