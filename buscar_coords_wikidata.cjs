const axios = require('axios');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const DELAY_MS = 100; // Rate limiting

async function ejecutar() {
    console.log('=== BUSCAR COORDENADAS EN WIKIDATA ===\n');

    // Obtener items con QID pero sin coordenadas
    const items = (await db.query(`
        SELECT b.id, b.denominacion, w.qid
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid IS NOT NULL AND (b.latitud IS NULL OR b.longitud IS NULL)
    `)).rows;

    console.log(`Items con QID sin coordenadas: ${items.length}\n`);

    if (items.length === 0) {
        console.log('Nada que hacer.');
        await db.cerrar();
        return;
    }

    // Procesar en batches de 50 QIDs
    const BATCH_SIZE = 50;
    let actualizados = 0;
    let sinCoords = 0;
    let errores = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const qids = batch.map(b => `wd:${b.qid}`).join(' ');

        console.log(`[${i + 1}-${Math.min(i + BATCH_SIZE, items.length)}/${items.length}] Consultando Wikidata...`);

        const query = `
            SELECT ?item ?lat ?lon WHERE {
                VALUES ?item { ${qids} }
                ?item wdt:P625 ?coords .
                BIND(geof:latitude(?coords) AS ?lat)
                BIND(geof:longitude(?coords) AS ?lon)
            }
        `;

        try {
            const response = await axios.get(WIKIDATA_SPARQL, {
                params: { query, format: 'json' },
                headers: { 'User-Agent': 'PatrimonioBot/1.0' },
                timeout: 30000,
            });

            const results = response.data.results.bindings;
            const coordsMap = new Map();

            for (const r of results) {
                const qid = r.item.value.split('/').pop();
                coordsMap.set(qid, {
                    lat: parseFloat(r.lat.value),
                    lon: parseFloat(r.lon.value),
                });
            }

            // Actualizar base de datos
            for (const item of batch) {
                const coords = coordsMap.get(item.qid);
                if (coords) {
                    await db.query('UPDATE bienes SET latitud = ?, longitud = ? WHERE id = ?', [coords.lat, coords.lon, item.id]);
                    actualizados++;
                } else {
                    sinCoords++;
                }
            }

            console.log(`  -> ${coordsMap.size} con coords, ${batch.length - coordsMap.size} sin coords`);

        } catch (err) {
            console.error(`  -> Error: ${err.message}`);
            errores += batch.length;
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nResultado:`);
    console.log(`  - Actualizados con coords: ${actualizados}`);
    console.log(`  - Sin coords en Wikidata: ${sinCoords}`);
    console.log(`  - Errores: ${errores}`);

    // Verificar total con coords ahora
    const totalConCoords = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL')).rows[0].n;
    console.log(`  - Total con coordenadas ahora: ${totalConCoords}`);

    await db.cerrar();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

ejecutar().catch(async err => {
    console.error('Error:', err.message);
    await db.cerrar();
    process.exit(1);
});
