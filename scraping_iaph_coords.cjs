/**
 * Scraping de IAPH para obtener coordenadas de items de Andalucia
 * que tienen codigo fuente (ID IAPH) pero no coordenadas
 */

const axios = require('axios');
const db = require('./db.cjs');

// API de detalle de IAPH
const IAPH_DETAIL_URL = 'https://www.juntadeandalucia.es/datosabiertos/portal/iaph/dataset/bien/inmueble';
const DELAY_MS = 300;
const BATCH_SIZE = 100;

async function ejecutar() {
    console.log('=== SCRAPING IAPH: Obtener coordenadas Andalucia ===\n');

    // Obtener items de Andalucia sin coordenadas que tienen codigo IAPH
    const sinCoords = (await db.query(`
        SELECT id, denominacion, codigo_fuente, municipio
        FROM bienes
        WHERE comunidad_autonoma = 'Andalucia'
          AND latitud IS NULL
          AND codigo_fuente IS NOT NULL
          AND codigo_fuente NOT LIKE 'Q%'
        ORDER BY codigo_fuente
    `)).rows;

    console.log(`Items sin coordenadas con ID IAPH: ${sinCoords.length}\n`);

    if (sinCoords.length === 0) {
        console.log('Nada que hacer.');
        await db.cerrar();
        return;
    }

    let actualizados = 0;
    let sinDatos = 0;
    let errores = 0;

    for (let i = 0; i < sinCoords.length; i++) {
        const item = sinCoords[i];

        if (i % 100 === 0) {
            console.log(`[${i}/${sinCoords.length}] Procesando... (${actualizados} actualizados)`);
        }

        try {
            const detalle = await obtenerDetalleIAPH(item.codigo_fuente);

            if (detalle && detalle.latitud && detalle.longitud) {
                await db.query(
                    'UPDATE bienes SET latitud = ?, longitud = ?, municipio = COALESCE(municipio, ?) WHERE id = ?',
                    [detalle.latitud, detalle.longitud, detalle.municipio, item.id]
                );
                actualizados++;
            } else {
                sinDatos++;
            }
        } catch (err) {
            errores++;
            if (errores <= 5) {
                console.error(`  Error en ${item.codigo_fuente}: ${err.message}`);
            }
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nResultado:`);
    console.log(`  - Actualizados: ${actualizados}`);
    console.log(`  - Sin datos: ${sinDatos}`);
    console.log(`  - Errores: ${errores}`);

    // Stats finales
    const totalConCoords = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL')).rows[0].n;
    const totalBienes = (await db.query('SELECT COUNT(*) as n FROM bienes')).rows[0].n;
    console.log(`\nTotal con coordenadas: ${totalConCoords}/${totalBienes} (${(100*totalConCoords/totalBienes).toFixed(1)}%)`);

    await db.cerrar();
}

async function obtenerDetalleIAPH(codigo) {
    // Formato del endpoint de detalle
    const url = `${IAPH_DETAIL_URL}/${codigo}`;

    try {
        const response = await axios.get(url, {
            params: { format: 'json' },
            headers: {
                'User-Agent': 'PatrimonioEspanaBot/1.0 (heritage data project)',
                'Accept': 'application/json'
            },
            timeout: 10000
        });

        const data = response.data;

        if (!data) return null;

        // La API de IAPH tiene coordenadas invertidas
        // longitud_s contiene la latitud real y latitud_s la longitud
        let lat = null, lon = null;

        if (data.longitud_s && data.latitud_s) {
            // Invertido: longitud_s = lat, latitud_s = lon
            lat = parseFloat(data.longitud_s);
            lon = parseFloat(data.latitud_s);

            // Validar que las coords son para Andalucia
            if (lat < 35 || lat > 39 || lon < -8 || lon > -1.5) {
                // Si no son validas, intentar sin invertir
                const lat2 = parseFloat(data.latitud_s);
                const lon2 = parseFloat(data.longitud_s);
                if (lat2 >= 35 && lat2 <= 39 && lon2 >= -8 && lon2 <= -1.5) {
                    lat = lat2;
                    lon = lon2;
                } else {
                    lat = null;
                    lon = null;
                }
            }
        } else if (data.coordenadas_utm_x && data.coordenadas_utm_y) {
            // TODO: convertir UTM a WGS84 si es necesario
            lat = null;
            lon = null;
        }

        return {
            latitud: lat,
            longitud: lon,
            municipio: data.municipio || data.termino_municipal || null
        };
    } catch (err) {
        if (err.response && err.response.status === 404) {
            return null;
        }
        throw err;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { ejecutar };

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
