/**
 * Fase 1: Descarga de patrimonio de Comunidad de Madrid
 * Fuente: datos.madrid.es (monumentos) + SIGMAS REST API (BIC/BIP)
 */

const axios = require('axios');
const db = require('./db.cjs');

const MONUMENTOS_URL = 'https://datos.madrid.es/egob/catalogo/300356-0-monumentos-ciudad-madrid.json';
const SIGMAS_URL = 'https://sigma.madrid.es/hosted/rest/services/DESARROLLO_URBANO_ACTUALIZADO/BIC/MapServer/3/query';
const DELAY_MS = 500;

async function ejecutar() {
    console.log('=== FASE 1 MADRID: Descarga patrimonio Comunidad de Madrid ===\n');

    // Verificar datos existentes
    const existentes = (await db.obtenerBienesPorRegion('Comunidad de Madrid')).length;
    console.log(`Registros existentes de Madrid: ${existentes}\n`);

    let totalInsertados = 0;

    // 1. Descargar monumentos de datos.madrid.es
    console.log('--- Descargando monumentos de datos.madrid.es ---');
    try {
        const monumentos = await descargarMonumentos();
        console.log(`  Obtenidos: ${monumentos.length} monumentos`);

        for (const item of monumentos) {
            const existe = (await db.query(
                'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                [item.codigo_fuente, 'Comunidad de Madrid']
            )).rows[0];

            if (!existe) {
                await db.upsertBienes([item]);
                totalInsertados++;

                // Insertar wikidata vacío
                const bienId = (await db.query(
                    'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                    [item.codigo_fuente, 'Comunidad de Madrid']
                )).rows[0];

                if (bienId) {
                    const wikiExiste = (await db.query('SELECT id FROM wikidata WHERE bien_id = ?', [bienId.id])).rows[0];
                    if (!wikiExiste) {
                        await db.insertarWikidata({
                            bien_id: bienId.id,
                            qid: null,
                            descripcion: item.descripcion || null,
                            imagen_url: null,
                            arquitecto: null,
                            estilo: null,
                            material: null,
                            altura: null,
                            superficie: null,
                            inception: null,
                            heritage_label: 'Monumento',
                            wikipedia_url: null,
                            commons_category: null,
                            sipca_code: null,
                            raw_json: null,
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error(`  Error en monumentos: ${err.message}`);
    }

    // 2. Descargar BIC/BIP de SIGMAS
    console.log('\n--- Descargando BIC/BIP de SIGMAS ---');
    try {
        const bics = await descargarSIGMAS();
        console.log(`  Obtenidos: ${bics.length} BIC/BIP`);

        for (const item of bics) {
            const existe = (await db.query(
                'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                [item.codigo_fuente, 'Comunidad de Madrid']
            )).rows[0];

            if (!existe) {
                await db.upsertBienes([item]);
                totalInsertados++;

                const bienId = (await db.query(
                    'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                    [item.codigo_fuente, 'Comunidad de Madrid']
                )).rows[0];

                if (bienId) {
                    const wikiExiste = (await db.query('SELECT id FROM wikidata WHERE bien_id = ?', [bienId.id])).rows[0];
                    if (!wikiExiste) {
                        await db.insertarWikidata({
                            bien_id: bienId.id,
                            qid: null,
                            descripcion: item.descripcion || null,
                            imagen_url: null,
                            arquitecto: null,
                            estilo: null,
                            material: null,
                            altura: null,
                            superficie: null,
                            inception: null,
                            heritage_label: 'BIC',
                            wikipedia_url: null,
                            commons_category: null,
                            sipca_code: null,
                            raw_json: null,
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error(`  Error en SIGMAS: ${err.message}`);
    }

    const stats = await db.estadisticas();
    console.log(`\n=== Fase 1 Madrid completada ===`);
    console.log(`  - Nuevos bienes insertados: ${totalInsertados}`);
    console.log(`  - Total en BD: ${stats.bienes}`);

    await db.cerrar();
}

async function descargarMonumentos() {
    const response = await axios.get(MONUMENTOS_URL, {
        headers: { 'User-Agent': 'PatrimonioEspanaBot/1.0' },
        timeout: 30000
    });

    const items = [];
    const data = response.data['@graph'] || response.data;

    if (Array.isArray(data)) {
        for (const mon of data) {
            let lat = null, lon = null;

            if (mon.location && mon.location.latitude && mon.location.longitude) {
                lat = parseFloat(mon.location.latitude);
                lon = parseFloat(mon.location.longitude);
            } else if (mon.latitud && mon.longitud) {
                lat = parseFloat(mon.latitud);
                lon = parseFloat(mon.longitud);
            }

            items.push({
                denominacion: mon.title || mon.nombre || 'Sin nombre',
                tipo: mon['@type'] || 'Monumento',
                clase: null,
                categoria: 'Monumento',
                provincia: 'Madrid',
                comarca: null,
                municipio: mon.address?.locality || 'Madrid',
                localidad: mon.address?.['street-address'] || null,
                latitud: lat,
                longitud: lon,
                situacion: null,
                resolucion: null,
                publicacion: null,
                fuente_opendata: 1,
                comunidad_autonoma: 'Comunidad de Madrid',
                codigo_fuente: `MAD-MON-${mon.id || mon['@id']?.split('/').pop() || items.length}`,
                pais: 'España',
                descripcion: mon.organization?.['organization-desc'] || mon.description || null,
            });
        }
    }

    return items;
}

async function descargarSIGMAS() {
    const items = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
        try {
            const response = await axios.get(SIGMAS_URL, {
                params: {
                    where: '1=1',
                    outFields: '*',
                    returnGeometry: true,
                    outSR: 4326,
                    f: 'json',
                    resultOffset: offset,
                    resultRecordCount: pageSize
                },
                headers: { 'User-Agent': 'PatrimonioEspanaBot/1.0' },
                timeout: 60000
            });

            if (!response.data.features || response.data.features.length === 0) {
                break;
            }

            for (const feature of response.data.features) {
                const attrs = feature.attributes || {};
                const geom = feature.geometry;

                let lat = null, lon = null;
                if (geom) {
                    if (geom.x && geom.y) {
                        lon = geom.x;
                        lat = geom.y;
                    } else if (geom.rings && geom.rings.length > 0) {
                        const ring = geom.rings[0];
                        let sumX = 0, sumY = 0;
                        for (const [x, y] of ring) {
                            sumX += x;
                            sumY += y;
                        }
                        lon = sumX / ring.length;
                        lat = sumY / ring.length;
                    }
                }

                items.push({
                    denominacion: attrs.BPH_TX_DESCRIPCION || attrs.DENOMINACION || 'Sin nombre',
                    tipo: attrs.CTG_TX_DESCRIPCION || null,
                    clase: null,
                    categoria: attrs.CATEGORIA || 'BIC',
                    provincia: 'Madrid',
                    comarca: null,
                    municipio: attrs.MUNICIPIO || 'Madrid',
                    localidad: null,
                    latitud: lat,
                    longitud: lon,
                    situacion: null,
                    resolucion: attrs.BPH_TX_DECLARACION || null,
                    publicacion: attrs.BPH_TX_INCOACION || null,
                    fuente_opendata: 1,
                    comunidad_autonoma: 'Comunidad de Madrid',
                    codigo_fuente: `MAD-BIC-${attrs.BPH_ID || attrs.OBJECTID || offset}`,
                    pais: 'España',
                    descripcion: attrs.BPH_TX_DESCRIPCION || null,
                });
            }

            offset += response.data.features.length;

            if (response.data.features.length < pageSize) {
                break;
            }

            await sleep(DELAY_MS);
        } catch (err) {
            console.error(`  Error en offset ${offset}: ${err.message}`);
            break;
        }
    }

    return items;
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
