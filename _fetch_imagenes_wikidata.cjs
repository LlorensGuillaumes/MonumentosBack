/**
 * _fetch_imagenes_wikidata.cjs
 *
 * Busca imágenes (P18) en Wikidata para paradas que no tienen imagen.
 * Actualiza wikidata.imagen_url e inserta en imagenes.
 *
 * Uso:
 *   node _fetch_imagenes_wikidata.cjs              # dry-run
 *   node _fetch_imagenes_wikidata.cjs --apply       # apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');

const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } })
    : new Pool({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'patrimonio',
        password: process.env.PGPASSWORD || 'patrimonio2026',
        database: process.env.PGDATABASE || 'patrimonio',
    });

const DB_LABEL = process.env.DATABASE_URL ? 'NEON' : 'LOCAL';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparqlBatch(qids) {
    const values = qids.map(q => 'wd:' + q).join(' ');
    const sparql = `SELECT ?item ?image WHERE { VALUES ?item { ${values} } ?item wdt:P18 ?image . }`;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    let retries = 0;
    while (retries < 4) {
        const res = await fetch(url, {
            headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PatrimonioEuropeoBot/1.0' },
        });
        if (res.status === 429 || res.status === 502 || res.status === 503) {
            retries++;
            await sleep(2000 * retries);
            continue;
        }
        if (!res.ok) throw new Error(`SPARQL ${res.status}`);
        const data = await res.json();
        const map = {};
        for (const b of (data.results?.bindings || [])) {
            const qid = b.item.value.split('/').pop();
            if (!map[qid]) map[qid] = b.image.value; // primera imagen
        }
        return map;
    }
    throw new Error('SPARQL max retries');
}

async function main() {
    console.log(`=== Fetch imágenes Wikidata ${DRY_RUN ? '[DRY-RUN]' : '[APPLY]'} ===`);
    console.log(`Base de datos: ${DB_LABEL}\n`);

    // Buscar paradas sin imagen que tienen QID
    const result = await pool.query(`
        SELECT DISTINCT p.bien_id, w.qid, b.denominacion
        FROM rutas_culturales_paradas p
        JOIN rutas_culturales rc ON rc.id = p.ruta_id
        JOIN bienes b ON b.id = p.bien_id
        JOIN wikidata w ON w.bien_id = p.bien_id
        WHERE rc.activa = true
          AND w.qid IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM imagenes i WHERE i.bien_id = p.bien_id)
          AND (w.imagen_url IS NULL OR w.imagen_url = '')
          AND NOT EXISTS (SELECT 1 FROM rutas_culturales_fotos f WHERE f.parada_id = p.id)
        ORDER BY p.bien_id
    `);

    console.log(`Paradas sin imagen con QID: ${result.rows.length}\n`);

    const BATCH = 50;
    let found = 0, notFound = 0;

    for (let i = 0; i < result.rows.length; i += BATCH) {
        const batch = result.rows.slice(i, i + BATCH);
        const qidToRows = {};
        for (const r of batch) {
            if (!qidToRows[r.qid]) qidToRows[r.qid] = [];
            qidToRows[r.qid].push(r);
        }

        const uniqueQids = Object.keys(qidToRows);
        try {
            const imageMap = await sparqlBatch(uniqueQids);

            for (const [qid, rows] of Object.entries(qidToRows)) {
                const imageUrl = imageMap[qid];
                if (imageUrl) {
                    found += rows.length;
                    for (const r of rows) {
                        if (!DRY_RUN) {
                            await pool.query('UPDATE wikidata SET imagen_url = $1 WHERE bien_id = $2', [imageUrl, r.bien_id]);
                            await pool.query(
                                'INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                                [r.bien_id, imageUrl, r.denominacion, 'wikidata']
                            );
                        }
                    }
                    if (rows.length === 1) {
                        console.log(`  ✓ ${qid} → ${rows[0].denominacion}`);
                    } else {
                        console.log(`  ✓ ${qid} → ${rows.length} bienes`);
                    }
                } else {
                    notFound += rows.length;
                }
            }
        } catch (e) {
            console.log(`  Error batch ${i}: ${e.message}`);
        }

        if ((i / BATCH) % 5 === 4) {
            console.log(`  Progreso: ${Math.min(i + BATCH, result.rows.length)}/${result.rows.length} (found=${found}, notFound=${notFound})`);
        }

        await sleep(300);
    }

    console.log(`\n========== RESUMEN ==========`);
    console.log(`  Con imagen encontrada:  ${found}`);
    console.log(`  Sin imagen en Wikidata: ${notFound}`);

    if (DRY_RUN) console.log(`\n[DRY-RUN] No se ha modificado nada. Usa --apply para aplicar.`);

    await pool.end();
}

main().catch(err => { console.error('Error fatal:', err); pool.end(); process.exit(1); });
