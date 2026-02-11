/**
 * Corrige nombres de municipios mal escritos en Baleares
 * y geocodifica los restantes
 */

const axios = require('axios');
const db = require('./db.cjs');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DELAY_MS = 1100;

// Correcciones conocidas de nombres de municipios
const CORRECCIONES = {
    // Baleares
    'Felanich': 'Felanitx',
    'San Lorenzo del Cardezar': 'Sant Llorenc des Cardassar',
    'Palma de Mallorca': 'Palma',
    'Ciudadela de Menorca': 'Ciutadella de Menorca',
    'Mahon': 'Mao',
    'San Antonio Abad': 'Sant Antoni de Portmany',
    'Santa Eulalia del Rio': 'Santa Eularia des Riu',
    'San Juan Bautista': 'Sant Joan de Labritja',
    'San Jose': 'Sant Josep de sa Talaia',
    'San Juan': 'Sant Joan',
    'San Francisco Javier': 'Sant Francesc Xavier',
    'Alayor': 'Alaior',
    'Mercadal': 'Es Mercadal',
    'Santa Margarita': 'Santa Margalida',
    'Santani': 'Santanyi',
    'Fornaluch': 'Fornalutx',
    // Galicia
    'Los Nogales': 'As Nogais',
    'Valle de Oro': 'O Valadouro',
    'La Peroja': 'A Peroxa',
    'Puenteceso': 'Ponteceso',
    'Villanueva de Arosa': 'Vilanova de Arousa',
    'Cotobad': 'Cotobade',
    'Catoria': 'Cuntis', // o posiblemente Catoira
    'Puentecaldelas': 'Ponte Caldelas',
    'Poyo': 'Poio',
    'Salvatierra de Mino': 'Salvaterra de Mino',
    'Villa de Cruces': 'Vila de Cruces',
    'Caldas de Reyes': 'Caldas de Reis',
    'Puertomarin': 'Portomarin',
    // Otras
    'San Cristobal de la Laguna': 'San Cristobal de La Laguna'
};

async function ejecutar() {
    console.log('=== CORREGIR Y GEOCODIFICAR MUNICIPIOS ===\n');

    // Obtener municipios unicos de Baleares sin coords
    const sinCoords = (await db.query(`
        SELECT DISTINCT municipio
        FROM bienes
        WHERE comunidad_autonoma = 'Illes Balears'
          AND latitud IS NULL
          AND municipio IS NOT NULL
    `)).rows;

    console.log(`Municipios Baleares sin coords: ${sinCoords.length}\n`);

    let geocodificados = 0;
    let noEncontrados = 0;
    let bienesActualizados = 0;

    for (const item of sinCoords) {
        const munOriginal = item.municipio;
        const munCorregido = CORRECCIONES[munOriginal] || munOriginal;

        console.log(`  Buscando: ${munCorregido} (original: ${munOriginal})`);

        try {
            const response = await axios.get(NOMINATIM_URL, {
                params: {
                    q: `${munCorregido}, Islas Baleares, Espana`,
                    format: 'json',
                    limit: 1,
                    countrycodes: 'es'
                },
                headers: {
                    'User-Agent': 'PatrimonioEspanaBot/1.0'
                },
                timeout: 10000
            });

            if (response.data && response.data.length > 0) {
                const result = response.data[0];
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);

                // Verificar coords razonables para Baleares
                if (lat >= 38 && lat <= 40.5 && lon >= 1 && lon <= 5) {
                    const changes = await db.query(`
                        UPDATE bienes
                        SET latitud = ?, longitud = ?
                        WHERE municipio = ? AND comunidad_autonoma = 'Illes Balears' AND latitud IS NULL
                    `, [lat, lon, munOriginal]);
                    bienesActualizados += changes.rowCount;
                    geocodificados++;
                    console.log(`    OK ${lat.toFixed(4)}, ${lon.toFixed(4)} (${changes.rowCount} items)`);
                } else {
                    console.log(`    X Coords fuera de rango: ${lat}, ${lon}`);
                    noEncontrados++;
                }
            } else {
                console.log(`    X No encontrado`);
                noEncontrados++;
            }
        } catch (err) {
            console.log(`    X Error: ${err.message}`);
            noEncontrados++;
        }

        await sleep(DELAY_MS);
    }

    // Ahora intentar con Galicia
    console.log('\n--- GALICIA ---\n');
    const sinCoordsGalicia = (await db.query(`
        SELECT DISTINCT municipio
        FROM bienes
        WHERE comunidad_autonoma = 'Galicia'
          AND latitud IS NULL
          AND municipio IS NOT NULL
        LIMIT 20
    `)).rows;

    for (const item of sinCoordsGalicia) {
        console.log(`  Buscando: ${item.municipio}`);

        try {
            const response = await axios.get(NOMINATIM_URL, {
                params: {
                    q: `${item.municipio}, Galicia, Espana`,
                    format: 'json',
                    limit: 1,
                    countrycodes: 'es'
                },
                headers: {
                    'User-Agent': 'PatrimonioEspanaBot/1.0'
                },
                timeout: 10000
            });

            if (response.data && response.data.length > 0) {
                const result = response.data[0];
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);

                // Verificar coords razonables para Galicia
                if (lat >= 41 && lat <= 44 && lon >= -10 && lon <= -6) {
                    const changes = await db.query(`
                        UPDATE bienes
                        SET latitud = ?, longitud = ?
                        WHERE municipio = ? AND comunidad_autonoma = 'Galicia' AND latitud IS NULL
                    `, [lat, lon, item.municipio]);
                    bienesActualizados += changes.rowCount;
                    geocodificados++;
                    console.log(`    OK ${lat.toFixed(4)}, ${lon.toFixed(4)} (${changes.rowCount} items)`);
                } else {
                    console.log(`    X Coords fuera de rango: ${lat}, ${lon}`);
                    noEncontrados++;
                }
            } else {
                console.log(`    X No encontrado`);
                noEncontrados++;
            }
        } catch (err) {
            console.log(`    X Error: ${err.message}`);
            noEncontrados++;
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nResultado total:`);
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

ejecutar().catch(async err => {
    console.error('Error:', err.message);
    await db.cerrar();
    process.exit(1);
});
