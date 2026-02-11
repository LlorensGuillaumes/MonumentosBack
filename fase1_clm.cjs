/**
 * Fase 1: Descarga de patrimonio de Castilla-La Mancha
 * Fuente: ArcGIS REST API de geoservicios.castillalamancha.es
 */

const axios = require('axios');
const db = require('./db.cjs');

const BASE_URL = 'https://geoservicios.castillalamancha.es/arcgis/rest/services/Vector/Patrimonio_Cultural/MapServer';
const LAYERS = [
    { id: 1, nombre: 'BIC' },
    { id: 2, nombre: 'BIP' },
    { id: 3, nombre: 'EIP' }
];
const PAGE_SIZE = 1000;
const DELAY_MS = 500;

async function ejecutar() {
    console.log('=== FASE 1 CLM: Descarga patrimonio Castilla-La Mancha ===\n');

    // Verificar datos existentes
    const existentes = (await db.obtenerBienesPorRegion('Castilla-La Mancha')).length;
    console.log(`Registros existentes de CLM: ${existentes}\n`);

    let totalInsertados = 0;
    let totalImagenes = 0;

    for (const layer of LAYERS) {
        console.log(`\n--- Descargando capa ${layer.id}: ${layer.nombre} ---`);

        try {
            const items = await descargarCapa(layer.id);
            console.log(`  Obtenidos: ${items.length} items`);

            if (items.length > 0) {
                // Insertar bienes
                for (const item of items) {
                    // Verificar si ya existe
                    const existe = (await db.query(
                        'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                        [item.codigo_fuente, 'Castilla-La Mancha']
                    )).rows[0];

                    if (!existe) {
                        await db.upsertBienes([item]);
                        totalInsertados++;

                        // Insertar en wikidata (vacío para matching posterior)
                        const bienId = (await db.query(
                            'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                            [item.codigo_fuente, 'Castilla-La Mancha']
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
                                    heritage_label: layer.nombre,
                                    wikipedia_url: null,
                                    commons_category: null,
                                    sipca_code: null,
                                    raw_json: null,
                                });
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error(`  Error en capa ${layer.id}: ${err.message}`);
        }

        await sleep(DELAY_MS);
    }

    const stats = await db.estadisticas();
    console.log(`\n=== Fase 1 CLM completada ===`);
    console.log(`  - Nuevos bienes insertados: ${totalInsertados}`);
    console.log(`  - Total en BD: ${stats.bienes}`);

    // Mostrar distribución CLM
    const clmStats = (await db.query(`
        SELECT categoria, COUNT(*) as n
        FROM bienes
        WHERE comunidad_autonoma = 'Castilla-La Mancha'
        GROUP BY categoria
        ORDER BY n DESC
    `)).rows;
    console.log('\nDistribución CLM por categoría:');
    clmStats.forEach(r => console.log(`  ${r.categoria || '(sin)'}: ${r.n}`));

    await db.cerrar();
}

async function descargarCapa(layerId) {
    const items = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const url = `${BASE_URL}/${layerId}/query`;
        const params = {
            where: '1=1',
            outFields: '*',
            returnGeometry: true,
            outSR: 4326,  // WGS84
            f: 'json',
            resultOffset: offset,
            resultRecordCount: PAGE_SIZE
        };

        const response = await axios.get(url, {
            params,
            headers: { 'User-Agent': 'PatrimonioEspanaBot/1.0' },
            timeout: 60000
        });

        if (!response.data.features || response.data.features.length === 0) {
            hasMore = false;
            break;
        }

        for (const feature of response.data.features) {
            const attrs = feature.attributes || {};
            const geom = feature.geometry;

            // Calcular centroide si es polígono
            let lat = null, lon = null;
            if (geom) {
                if (geom.x && geom.y) {
                    lon = geom.x;
                    lat = geom.y;
                } else if (geom.rings && geom.rings.length > 0) {
                    // Centroide del polígono
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

            // Validar coordenadas para España
            if (lat && lon && (lat < 35 || lat > 44 || lon < -10 || lon > 5)) {
                lat = null;
                lon = null;
            }

            items.push({
                denominacion: attrs.Nombre || attrs.NOMBRE || 'Sin nombre',
                tipo: attrs.Tipo || attrs.TIPO || null,
                clase: attrs.Tipologia || attrs.TIPOLOGIA || null,
                categoria: attrs.Categoria || attrs.CATEGORIA || 'BIC',
                provincia: attrs.Provincia || attrs.PROVINCIA || null,
                comarca: null,
                municipio: attrs.Municipio || attrs.MUNICIPIO || null,
                localidad: null,
                latitud: lat,
                longitud: lon,
                situacion: attrs.Cronologia || attrs.CRONOLOGIA || null,
                resolucion: null,
                publicacion: null,
                fuente_opendata: 1,
                comunidad_autonoma: 'Castilla-La Mancha',
                codigo_fuente: attrs.Codigo || attrs.CODIGO || `CLM-${attrs.OBJECTID || offset}`,
                pais: 'España',
                descripcion: [attrs.Descripc_1, attrs.Descripc_2, attrs.Descripc_3].filter(Boolean).join(' ') || null,
            });
        }

        offset += response.data.features.length;

        if (response.data.features.length < PAGE_SIZE) {
            hasMore = false;
        }

        if (offset % 2000 === 0) {
            console.log(`    Descargados: ${offset}...`);
        }

        await sleep(DELAY_MS);
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
