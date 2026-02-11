const axios = require('axios');
const db = require('./db.cjs');

// Nominatim API (OpenStreetMap) - free geocoding
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DELAY_MS = 1100; // Nominatim requires 1 req/sec max

async function ejecutar() {
    console.log('=== GEOCODIFICAR POR MUNICIPIO ===\n');

    // Obtener municipios únicos sin coordenadas
    const municipios = (await db.query(`
        SELECT DISTINCT b.municipio, b.provincia, b.comunidad_autonoma,
               COUNT(*) as count
        FROM bienes b
        WHERE (b.latitud IS NULL OR b.longitud IS NULL)
          AND b.municipio IS NOT NULL
        GROUP BY b.municipio, b.provincia
        ORDER BY count DESC
    `)).rows;

    console.log(`Municipios a geocodificar: ${municipios.length}\n`);

    if (municipios.length === 0) {
        console.log('Nada que hacer.');
        await db.cerrar();
        return;
    }

    // Cache de coords por municipio
    const coordsCache = new Map();
    let geocodificados = 0;
    let noEncontrados = 0;
    let bienesActualizados = 0;

    for (let i = 0; i < municipios.length; i++) {
        const mun = municipios[i];
        const searchQuery = `${mun.municipio}, ${mun.provincia}, España`;

        if ((i + 1) % 50 === 0 || i === 0) {
            console.log(`[${i + 1}/${municipios.length}] ${mun.municipio} (${mun.count} bienes)...`);
        }

        try {
            const response = await axios.get(NOMINATIM_URL, {
                params: {
                    q: searchQuery,
                    format: 'json',
                    limit: 1,
                    countrycodes: 'es',
                },
                headers: {
                    'User-Agent': 'PatrimonioBot/1.0 (heritage data project)',
                },
                timeout: 10000,
            });

            if (response.data && response.data.length > 0) {
                const result = response.data[0];
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);

                // Actualizar todos los bienes de este municipio
                const changes = await db.query(
                    'UPDATE bienes SET latitud = ?, longitud = ? WHERE municipio = ? AND provincia = ? AND latitud IS NULL',
                    [lat, lon, mun.municipio, mun.provincia]
                );
                bienesActualizados += changes.rowCount;
                geocodificados++;
            } else {
                noEncontrados++;
            }
        } catch (err) {
            // Silently skip errors
            noEncontrados++;
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nResultado:`);
    console.log(`  - Municipios geocodificados: ${geocodificados}`);
    console.log(`  - Municipios no encontrados: ${noEncontrados}`);
    console.log(`  - Bienes actualizados: ${bienesActualizados}`);

    // Verificar total con coords ahora
    const totalConCoords = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL')).rows[0].n;
    const totalBienes = (await db.query('SELECT COUNT(*) as n FROM bienes')).rows[0].n;
    console.log(`  - Total con coordenadas: ${totalConCoords}/${totalBienes} (${(100*totalConCoords/totalBienes).toFixed(1)}%)`);

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
