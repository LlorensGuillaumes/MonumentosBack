/**
 * Investigar para cada qid_evento de eventos_monumento:
 * - P361 (parte de) → evento padre
 * - P31 (instancia de) → tipo de evento
 *
 * Output: ranking de "padres" más comunes para diseñar agrupación.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(qids) {
    const values = qids.map(q => 'wd:' + q).join(' ');
    const query = `
        SELECT ?item ?itemLabel ?parent ?parentLabel ?type ?typeLabel WHERE {
            VALUES ?item { ${values} }
            OPTIONAL { ?item wdt:P361 ?parent }
            OPTIONAL { ?item wdt:P31 ?type }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" }
        }
    `;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    let retries = 0;
    while (retries < 4) {
        try {
            const res = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PatrimonioBot/1.0' } });
            if (res.status === 429 || res.status === 502 || res.status === 503) {
                retries++;
                await sleep(2000 * retries);
                continue;
            }
            if (!res.ok) throw new Error('SPARQL ' + res.status);
            return res.json();
        } catch (e) {
            retries++;
            if (retries >= 4) throw e;
            await sleep(2000 * retries);
        }
    }
    return { results: { bindings: [] } };
}

(async () => {
    // Coger todos los qid_evento únicos con su nº de monumentos
    const r = await pool.query(`
        SELECT qid_evento, COUNT(DISTINCT bien_id) as n
        FROM eventos_monumento
        WHERE qid_evento IS NOT NULL
        GROUP BY qid_evento
        ORDER BY n DESC
    `);
    console.log('Total eventos únicos: ' + r.rows.length);

    const qids = r.rows.map(row => row.qid_evento);
    const counts = Object.fromEntries(r.rows.map(row => [row.qid_evento, parseInt(row.n)]));

    const eventLabels = {};   // qid → label
    const parents = {};       // qid → [{parent, parentLabel}]
    const types = {};         // qid → [{type, typeLabel}]

    const BATCH = 30;
    for (let i = 0; i < qids.length; i += BATCH) {
        const batch = qids.slice(i, i + BATCH);
        try {
            const data = await sparql(batch);
            for (const b of (data.results?.bindings || [])) {
                const qid = b.item.value.split('/').pop();
                if (!eventLabels[qid]) eventLabels[qid] = b.itemLabel?.value || qid;
                if (b.parent) {
                    const parentQid = b.parent.value.split('/').pop();
                    const parentLabel = b.parentLabel?.value || parentQid;
                    if (!parents[qid]) parents[qid] = [];
                    if (!parents[qid].find(p => p.qid === parentQid)) {
                        parents[qid].push({ qid: parentQid, label: parentLabel });
                    }
                }
                if (b.type) {
                    const typeQid = b.type.value.split('/').pop();
                    const typeLabel = b.typeLabel?.value || typeQid;
                    if (!types[qid]) types[qid] = [];
                    if (!types[qid].find(t => t.qid === typeQid)) {
                        types[qid].push({ qid: typeQid, label: typeLabel });
                    }
                }
            }
            console.log('  ' + Math.min(i + BATCH, qids.length) + '/' + qids.length);
        } catch (e) {
            console.error('  Error batch ' + i + ': ' + e.message);
        }
        await sleep(300);
    }

    // Agrupar por padre
    const parentCounts = {}; // parentQid → {label, totalMonumentos, eventos: []}
    for (const qid of qids) {
        const monumentos = counts[qid];
        const parentList = parents[qid] || [];
        for (const p of parentList) {
            if (!parentCounts[p.qid]) parentCounts[p.qid] = { label: p.label, totalMonumentos: 0, eventos: [] };
            parentCounts[p.qid].totalMonumentos += monumentos;
            parentCounts[p.qid].eventos.push({ qid, label: eventLabels[qid] || qid, n: monumentos });
        }
    }

    // Ordenar por total monumentos
    const sortedParents = Object.entries(parentCounts).sort((a, b) => b[1].totalMonumentos - a[1].totalMonumentos);

    console.log('\n========== TOP PADRES (P361) ==========');
    for (const [qid, info] of sortedParents.slice(0, 30)) {
        console.log('  ' + qid + ' "' + info.label + '" — ' + info.totalMonumentos + ' monumentos en ' + info.eventos.length + ' eventos hijos');
        for (const e of info.eventos.slice(0, 5)) {
            console.log('    └ ' + e.qid + ' "' + e.label + '" (' + e.n + ')');
        }
        if (info.eventos.length > 5) console.log('    └ ... y ' + (info.eventos.length - 5) + ' más');
    }

    // Eventos sin padre
    const sinPadre = qids.filter(q => !parents[q] || parents[q].length === 0);
    console.log('\n========== EVENTOS SIN PADRE: ' + sinPadre.length + ' ==========');
    for (const q of sinPadre.slice(0, 30)) {
        const tlist = (types[q] || []).map(t => t.label).join(', ');
        console.log('  ' + q + ' "' + (eventLabels[q] || q) + '" (' + counts[q] + 'm) — tipo: ' + (tlist || '?'));
    }

    // Guardar JSON completo para análisis
    const output = { eventLabels, parents, types, counts, sortedParents: sortedParents.map(([qid, info]) => ({ qid, ...info })) };
    fs.writeFileSync('C:\\Users\\usuario\\Desktop\\node2\\_eventos_analisis.json', JSON.stringify(output, null, 2));
    console.log('\nGuardado en _eventos_analisis.json');

    await pool.end();
})();
