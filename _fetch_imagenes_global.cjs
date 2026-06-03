/**
 * Fetch imágenes (P18) de Wikidata para TODOS los bienes con QID sin imagen.
 * No solo paradas de rutas culturales.
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');

const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } })
    : new Pool({ host: 'localhost', port: 5433, user: 'patrimonio', password: 'patrimonio2026', database: 'patrimonio' });

const DB = process.env.DATABASE_URL ? 'NEON' : 'LOCAL';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparqlBatch(qids) {
    const values = qids.map(q => 'wd:' + q).join(' ');
    const sparql = `SELECT ?item ?image WHERE { VALUES ?item { ${values} } ?item wdt:P18 ?image . }`;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    let retries = 0;
    while (retries < 5) {
        try {
            const res = await fetch(url, {
                headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PatrimonioEuropeoBot/1.0' },
            });
            if (res.status === 429 || res.status === 502 || res.status === 503) {
                retries++;
                await sleep(3000 * retries);
                continue;
            }
            if (!res.ok) throw new Error(`SPARQL ${res.status}`);
            const data = await res.json();
            const map = {};
            for (const b of (data.results?.bindings || [])) {
                const qid = b.item.value.split('/').pop();
                if (!map[qid]) map[qid] = b.image.value;
            }
            return map;
        } catch (e) {
            retries++;
            if (retries >= 5) throw e;
            await sleep(3000 * retries);
        }
    }
    return {};
}

async function main() {
    console.log(`=== Fetch imágenes globales ${DRY_RUN ? '[DRY-RUN]' : '[APPLY]'} ===`);
    console.log(`DB: ${DB}\n`);

    const result = await pool.query(`
        SELECT b.id, b.denominacion, w.qid
        FROM bienes b
        JOIN wikidata w ON w.bien_id = b.id
        WHERE w.qid IS NOT NULL
          AND (w.imagen_url IS NULL OR w.imagen_url = '')
          AND NOT EXISTS (SELECT 1 FROM imagenes WHERE bien_id = b.id)
        ORDER BY b.id
    `);

    console.log(`Bienes a procesar: ${result.rows.length}\n`);
    if (result.rows.length === 0) { await pool.end(); return; }

    const BATCH = 50;
    let found = 0, notFound = 0, processed = 0;
    const startTime = Date.now();

    for (let i = 0; i < result.rows.length; i += BATCH) {
        const batch = result.rows.slice(i, i + BATCH);
        const qidToBienes = {};
        for (const r of batch) {
            if (!qidToBienes[r.qid]) qidToBienes[r.qid] = [];
            qidToBienes[r.qid].push(r);
        }

        const uniqueQids = Object.keys(qidToBienes);
        try {
            const imageMap = await sparqlBatch(uniqueQids);

            for (const [qid, bienes] of Object.entries(qidToBienes)) {
                const imageUrl = imageMap[qid];
                if (imageUrl) {
                    found += bienes.length;
                    if (!DRY_RUN) {
                        for (const b of bienes) {
                            await pool.query('UPDATE wikidata SET imagen_url = $1 WHERE bien_id = $2', [imageUrl, b.id]);
                            await pool.query(
                                'INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                                [b.id, imageUrl, b.denominacion, 'wikidata']
                            );
                        }
                    }
                } else {
                    notFound += bienes.length;
                }
            }
        } catch (e) {
            console.log(`  Error batch ${i}: ${e.message}`);
            notFound += batch.length;
        }

        processed += batch.length;
        if ((i / BATCH) % 20 === 19) {
            const pct = (processed / result.rows.length * 100).toFixed(1);
            const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
            const rate = processed / ((Date.now() - startTime) / 1000);
            const eta = ((result.rows.length - processed) / rate / 60).toFixed(1);
            console.log(`  ${processed}/${result.rows.length} (${pct}%) — found=${found}, notFound=${notFound} — ${elapsed}min, ETA ${eta}min`);
        }

        await sleep(200);
    }

    console.log(`\n========== RESUMEN ==========`);
    console.log(`  Procesados: ${processed}`);
    console.log(`  Con imagen encontrada: ${found}`);
    console.log(`  Sin imagen Wikidata:   ${notFound}`);
    console.log(`  Tiempo total: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} min`);

    if (DRY_RUN) console.log(`\n[DRY-RUN] No se ha modificado nada. Usa --apply para aplicar.`);

    await pool.end();
}

main().catch(err => { console.error('Error fatal:', err); pool.end(); process.exit(1); });
