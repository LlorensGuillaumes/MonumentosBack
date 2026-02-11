/**
 * Fase 1: Descarga de patrimonio de Navarra via Wikidata
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'Accept': 'application/sparql-results+json',
    'User-Agent': 'PatrimonioEspanaBot/1.0'
};

async function ejecutar() {
    console.log('=== FASE 1 NAVARRA: Descarga via Wikidata ===\n');

    const existentes = (await db.obtenerBienesPorRegion('Navarra')).length;
    if (existentes > 0) {
        console.log(`Limpiando ${existentes} registros anteriores de Navarra...`);
        await db.limpiarBienesPorRegion('Navarra');
    }

    const query = `
SELECT DISTINCT ?item ?itemLabel ?itemDescription ?coord ?image ?heritageLabel
       ?municipioLabel ?inception ?commonsCategory ?articleEs ?estiloLabel
WHERE {
    {
        ?item wdt:P1435 ?heritage .
        ?item wdt:P131 ?loc .
        ?loc wdt:P131 wd:Q4018 .
    } UNION {
        ?item wdt:P1435 ?heritage .
        ?item wdt:P131 wd:Q4018 .
    }
    OPTIONAL { ?item wdt:P625 ?coord }
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P571 ?inception }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P149 ?estilo }
    OPTIONAL {
        ?articleEs schema:about ?item ;
                   schema:isPartOf <https://es.wikipedia.org/> .
    }
    OPTIONAL { ?item wdt:P131 ?municipio }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "es,eu,en".
        ?item rdfs:label ?itemLabel.
        ?item schema:description ?itemDescription.
        ?heritage rdfs:label ?heritageLabel.
        ?municipio rdfs:label ?municipioLabel.
        ?estilo rdfs:label ?estiloLabel.
    }
}
LIMIT 10000
`;

    console.log('Descargando patrimonio de Navarra...');

    const response = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 120000,
    });

    const itemsMap = new Map();

    for (const r of response.data.results.bindings) {
        const itemQid = r.item?.value?.split('/').pop();
        if (!itemQid) continue;
        if (itemsMap.has(itemQid)) continue;

        const denominacion = r.itemLabel?.value;
        if (!denominacion || denominacion === itemQid) continue;

        let lat = null, lon = null;
        if (r.coord?.value) {
            const match = r.coord.value.match(/Point\(([^ ]+) ([^)]+)\)/);
            if (match) {
                lon = parseFloat(match[1]);
                lat = parseFloat(match[2]);
            }
        }

        itemsMap.set(itemQid, {
            denominacion: denominacion,
            tipo: null,
            clase: null,
            categoria: r.heritageLabel?.value || 'BIC',
            provincia: 'Navarra',
            comarca: null,
            municipio: r.municipioLabel?.value || null,
            localidad: null,
            latitud: lat,
            longitud: lon,
            situacion: null,
            resolucion: null,
            publicacion: null,
            fuente_opendata: 0,
            comunidad_autonoma: 'Navarra',
            codigo_fuente: itemQid,
            pais: 'España',
        });
    }

    const bienes = [...itemsMap.values()];
    console.log(`Obtenidos: ${bienes.length} bienes únicos`);

    if (bienes.length > 0) {
        await db.upsertBienes(bienes);

        // Insertar wikidata
        for (const r of response.data.results.bindings) {
            const itemQid = r.item?.value?.split('/').pop();
            if (!itemQid) continue;

            const bienId = (await db.query(
                'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                [itemQid, 'Navarra']
            )).rows[0];

            if (bienId) {
                const existe = (await db.query(
                    'SELECT id FROM wikidata WHERE bien_id = ?',
                    [bienId.id]
                )).rows[0];
                if (!existe) {
                    await db.insertarWikidata({
                        bien_id: bienId.id,
                        qid: itemQid,
                        descripcion: r.itemDescription?.value || null,
                        imagen_url: r.image?.value || null,
                        arquitecto: null,
                        estilo: r.estiloLabel?.value || null,
                        material: null,
                        altura: null,
                        superficie: null,
                        inception: r.inception?.value || null,
                        heritage_label: r.heritageLabel?.value || null,
                        wikipedia_url: r.articleEs?.value || null,
                        commons_category: r.commonsCategory?.value || null,
                        sipca_code: null,
                        raw_json: null,
                    });
                }
            }
        }
    }

    const stats = await db.estadisticas();
    console.log(`\nFase 1 Navarra completada:`);
    console.log(`  - Bienes insertados: ${bienes.length}`);
    console.log(`  - Total en BD: ${stats.bienes}`);

    await db.cerrar();
}

module.exports = { ejecutar };

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
