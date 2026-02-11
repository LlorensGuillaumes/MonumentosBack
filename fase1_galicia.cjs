/**
 * Fase 1: Descarga de patrimonio de Galicia
 * Fuente: ficheiros-web.xunta.gal (ODS) y WMS de IDEG
 */

const axios = require('axios');
const db = require('./db.cjs');

// URL del archivo ODS de BIC de Galicia
const ODS_URL = 'https://ficheiros-web.xunta.gal/patrimonio/bic/relacion_bics.ods';
// Alternativa: CSV desde abertos.xunta.gal
const CSV_URL = 'https://abertos.xunta.gal/catalogo/administracion-publica/-/dataset/0375/bens-interese-cultural-bic/001/descarga-directa-ficheiro.csv';

const DELAY_MS = 500;

async function ejecutar() {
    console.log('=== FASE 1 GALICIA: Descarga patrimonio Galicia ===\n');

    // Verificar datos existentes
    const existentes = (await db.obtenerBienesPorRegion('Galicia')).length;
    console.log(`Registros existentes de Galicia: ${existentes}\n`);

    let totalInsertados = 0;

    // Intentar descargar el archivo
    console.log('--- Descargando datos de Galicia ---');

    try {
        // Primero intentamos con el endpoint de abertos.xunta.gal
        const items = await descargarDatosGalicia();
        console.log(`  Obtenidos: ${items.length} BIC`);

        for (const item of items) {
            const existe = (await db.query(
                'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                [item.codigo_fuente, 'Galicia']
            )).rows[0];

            if (!existe) {
                await db.upsertBienes([item]);
                totalInsertados++;

                // Insertar wikidata vacío para matching posterior
                const bienId = (await db.query(
                    'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                    [item.codigo_fuente, 'Galicia']
                )).rows[0];

                if (bienId) {
                    const wikiExiste = (await db.query('SELECT id FROM wikidata WHERE bien_id = ?', [bienId.id])).rows[0];
                    if (!wikiExiste) {
                        await db.insertarWikidata({
                            bien_id: bienId.id,
                            qid: null,
                            descripcion: null,
                            imagen_url: null,
                            arquitecto: null,
                            estilo: null,
                            material: null,
                            altura: null,
                            superficie: null,
                            inception: null,
                            heritage_label: item.categoria || 'BIC',
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
        console.error(`  Error: ${err.message}`);

        // Fallback: intentar obtener desde Wikidata con más detalle
        console.log('\n  Intentando complementar con Wikidata...');
        try {
            const wikiItems = await descargarDesdeWikidata();
            console.log(`  Obtenidos de Wikidata: ${wikiItems.length} items`);

            for (const item of wikiItems) {
                const existe = (await db.query(
                    'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                    [item.codigo_fuente, 'Galicia']
                )).rows[0];

                if (!existe) {
                    await db.upsertBienes([item]);
                    totalInsertados++;
                }
            }
        } catch (wikiErr) {
            console.error(`  Error Wikidata: ${wikiErr.message}`);
        }
    }

    const stats = await db.estadisticas();
    console.log(`\n=== Fase 1 Galicia completada ===`);
    console.log(`  - Nuevos bienes insertados: ${totalInsertados}`);
    console.log(`  - Total Galicia: ${(await db.obtenerBienesPorRegion('Galicia')).length}`);
    console.log(`  - Total en BD: ${stats.bienes}`);

    await db.cerrar();
}

async function descargarDatosGalicia() {
    // Intentar con diferentes formatos
    const urls = [
        { url: 'https://abertos.xunta.gal/catalogo/cultura-ocio-deporte/-/dataset/0375/bens-interese-cultural-bic/001/descarga-directa-ficheiro.json', format: 'json' },
        { url: 'https://abertos.xunta.gal/catalogo/cultura-ocio-deporte/-/dataset/0375/bens-interese-cultural-bic/001/descarga-directa-ficheiro.csv', format: 'csv' },
    ];

    for (const { url, format } of urls) {
        try {
            console.log(`  Intentando ${format.toUpperCase()}...`);
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'PatrimonioEspanaBot/1.0',
                    'Accept': format === 'json' ? 'application/json' : 'text/csv'
                },
                timeout: 30000,
                maxRedirects: 5
            });

            if (format === 'json' && response.data) {
                return parsearJSON(response.data);
            } else if (format === 'csv' && response.data) {
                return parsearCSV(response.data);
            }
        } catch (err) {
            console.log(`    ${format.toUpperCase()} falló: ${err.message}`);
        }
    }

    throw new Error('No se pudo descargar datos de ninguna fuente');
}

function parsearJSON(data) {
    const items = [];
    const records = Array.isArray(data) ? data : (data.records || data.results || []);

    for (const record of records) {
        items.push({
            denominacion: record.denominacion || record.nombre || record.DENOMINACION || 'Sin nombre',
            tipo: record.tipo || record.TIPO || null,
            clase: record.clase || record.CLASE || null,
            categoria: record.categoria || record.CATEGORIA || 'BIC',
            provincia: record.provincia || record.PROVINCIA || null,
            comarca: record.comarca || record.COMARCA || null,
            municipio: record.municipio || record.MUNICIPIO || record.concello || null,
            localidad: record.localidad || record.parroquia || null,
            latitud: record.latitud || record.lat || null,
            longitud: record.longitud || record.lon || record.lng || null,
            situacion: null,
            resolucion: record.disposicion || record.declaracion || null,
            publicacion: null,
            fuente_opendata: 1,
            comunidad_autonoma: 'Galicia',
            codigo_fuente: `GAL-${record.id || record.codigo || items.length}`,
            pais: 'España',
        });
    }

    return items;
}

function parsearCSV(data) {
    const items = [];
    const lines = data.split('\n');

    if (lines.length < 2) return items;

    // Parsear cabecera
    const header = lines[0].split(';').map(h => h.trim().toLowerCase().replace(/"/g, ''));

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split(';').map(v => v.trim().replace(/"/g, ''));
        const record = {};

        header.forEach((h, idx) => {
            record[h] = values[idx] || null;
        });

        if (!record.denominacion && !record.nombre && !record.ben) continue;

        items.push({
            denominacion: record.denominacion || record.nombre || record.ben || 'Sin nombre',
            tipo: record.tipo || record.tipoloxia || null,
            clase: record.clase || null,
            categoria: record.categoria || record.proteccion || 'BIC',
            provincia: record.provincia || null,
            comarca: record.comarca || null,
            municipio: record.municipio || record.concello || null,
            localidad: record.parroquia || null,
            latitud: record.latitud ? parseFloat(record.latitud) : null,
            longitud: record.longitud ? parseFloat(record.longitud) : null,
            situacion: null,
            resolucion: record.disposicion || null,
            publicacion: null,
            fuente_opendata: 1,
            comunidad_autonoma: 'Galicia',
            codigo_fuente: `GAL-${record.id || record.codigo || i}`,
            pais: 'España',
        });
    }

    return items;
}

async function descargarDesdeWikidata() {
    const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

    // Query más amplia para Galicia
    const query = `
SELECT DISTINCT ?item ?itemLabel ?itemDescription ?municipioLabel ?provinciaLabel ?coord ?image ?heritageLabel
WHERE {
    ?item wdt:P1435 ?heritage .
    {
        ?item wdt:P131 ?loc .
        ?loc wdt:P131/wdt:P131 wd:Q3908 .
    } UNION {
        ?item wdt:P131 ?loc .
        ?loc wdt:P131 wd:Q3908 .
    } UNION {
        ?item wdt:P131 wd:Q3908 .
    }
    OPTIONAL { ?item wdt:P625 ?coord }
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P131 ?municipio }
    OPTIONAL { ?municipio wdt:P131 ?provincia }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "es,gl,en".
        ?item rdfs:label ?itemLabel.
        ?item schema:description ?itemDescription.
        ?heritage rdfs:label ?heritageLabel.
        ?municipio rdfs:label ?municipioLabel.
        ?provincia rdfs:label ?provinciaLabel.
    }
}
LIMIT 5000
`;

    const response = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: {
            'Accept': 'application/sparql-results+json',
            'User-Agent': 'PatrimonioEspanaBot/1.0'
        },
        timeout: 120000
    });

    const items = [];
    const seen = new Set();

    for (const r of response.data.results.bindings) {
        const qid = r.item?.value?.split('/').pop();
        if (!qid || seen.has(qid)) continue;
        seen.add(qid);

        const denominacion = r.itemLabel?.value;
        if (!denominacion || denominacion === qid) continue;

        let lat = null, lon = null;
        if (r.coord?.value) {
            const match = r.coord.value.match(/Point\(([^ ]+) ([^)]+)\)/);
            if (match) {
                lon = parseFloat(match[1]);
                lat = parseFloat(match[2]);
            }
        }

        items.push({
            denominacion,
            tipo: null,
            clase: null,
            categoria: r.heritageLabel?.value || 'BIC',
            provincia: r.provinciaLabel?.value || null,
            comarca: null,
            municipio: r.municipioLabel?.value || null,
            localidad: null,
            latitud: lat,
            longitud: lon,
            situacion: null,
            resolucion: null,
            publicacion: null,
            fuente_opendata: 0,
            comunidad_autonoma: 'Galicia',
            codigo_fuente: qid,
            pais: 'España',
        });
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
