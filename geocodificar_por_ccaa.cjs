/**
 * Geocodifica items sin coordenadas usando municipio + CCAA
 * Para items que tienen municipio pero no provincia
 */

const axios = require('axios');
const db = require('./db.cjs');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DELAY_MS = 1100;

const CCAA_NOMBRES = {
    'Illes Balears': 'Islas Baleares',
    'Pais Vasco': 'País Vasco',
    'Region de Murcia': 'Región de Murcia',
    'Comunitat Valenciana': 'Comunidad Valenciana',
};

async function ejecutar() {
    console.log('=== GEOCODIFICAR POR MUNICIPIO + CCAA ===\n');

    // Obtener items sin coords que tienen municipio pero no provincia
    const sinCoords = (await db.query(`
        SELECT DISTINCT municipio, comunidad_autonoma
        FROM bienes
        WHERE latitud IS NULL
          AND municipio IS NOT NULL
          AND (provincia IS NULL OR provincia = '')
        ORDER BY comunidad_autonoma
    `)).rows;

    console.log(`Municipios únicos a geocodificar: ${sinCoords.length}\n`);

    if (sinCoords.length === 0) {
        console.log('Nada que geocodificar.');
        await db.cerrar();
        return;
    }

    // Agrupar por municipio+CCAA
    const porMunicipio = new Map();
    for (const item of sinCoords) {
        const key = `${item.municipio}|${item.comunidad_autonoma}`;
        if (!porMunicipio.has(key)) {
            porMunicipio.set(key, {
                municipio: item.municipio,
                ccaa: item.comunidad_autonoma
            });
        }
    }

    console.log(`Combinaciones únicas municipio+CCAA: ${porMunicipio.size}\n`);

    let geocodificados = 0;
    let noEncontrados = 0;
    let bienesActualizados = 0;
    let i = 0;

    for (const [key, data] of porMunicipio) {
        i++;
        if (i % 25 === 0 || i === 1) {
            console.log(`[${i}/${porMunicipio.size}] ${data.municipio} (${data.ccaa})...`);
        }

        const ccaaNombre = CCAA_NOMBRES[data.ccaa] || data.ccaa;
        const searchQuery = `${data.municipio}, ${ccaaNombre}, España`;

        try {
            const response = await axios.get(NOMINATIM_URL, {
                params: {
                    q: searchQuery,
                    format: 'json',
                    limit: 1,
                    countrycodes: 'es'
                },
                headers: {
                    'User-Agent': 'PatrimonioEspanaBot/1.0 (heritage data project)'
                },
                timeout: 10000
            });

            if (response.data && response.data.length > 0) {
                const result = response.data[0];
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);

                // Verificar que las coords son razonables para España
                if (lat >= 27 && lat <= 44 && lon >= -19 && lon <= 5) {
                    const changes = await db.query(
                        'UPDATE bienes SET latitud = ?, longitud = ? WHERE municipio = ? AND comunidad_autonoma = ? AND latitud IS NULL',
                        [lat, lon, data.municipio, data.ccaa]
                    );
                    bienesActualizados += changes.rowCount;
                    geocodificados++;
                } else {
                    noEncontrados++;
                }
            } else {
                noEncontrados++;
            }
        } catch (err) {
            noEncontrados++;
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nResultado:`);
    console.log(`  - Municipios geocodificados: ${geocodificados}`);
    console.log(`  - Municipios no encontrados: ${noEncontrados}`);
    console.log(`  - Bienes actualizados: ${bienesActualizados}`);

    // Stats finales
    const totalConCoords = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL')).rows[0].n;
    const totalBienes = (await db.query('SELECT COUNT(*) as n FROM bienes')).rows[0].n;
    console.log(`\nTotal con coordenadas: ${totalConCoords}/${totalBienes} (${(100*totalConCoords/totalBienes).toFixed(1)}%)`);

    await db.cerrar();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
