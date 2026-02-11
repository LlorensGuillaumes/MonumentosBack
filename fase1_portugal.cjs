/**
 * Fase 1: Descarga de patrimonio de Portugal via Wikidata SPARQL
 * Query: heritage items (P1435) en Portugal (P17 = Q45)
 * ~13,000 registros esperados con coords, municipio, distrito, imagen, inception
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'Accept': 'application/sparql-results+json',
    'User-Agent': 'PatrimonioEuropaBot/1.0 (heritage data project)'
};
const DELAY_MS = 2000;

// Distritos de Portugal con sus QIDs
const DISTRITOS = [
    { nombre: 'Lisboa', qid: 'Q80931' },
    { nombre: 'Porto', qid: 'Q36433' },
    { nombre: 'Braga', qid: 'Q45424' },
    { nombre: 'Setúbal', qid: 'Q208148' },
    { nombre: 'Aveiro', qid: 'Q193513' },
    { nombre: 'Faro', qid: 'Q180874' },
    { nombre: 'Leiria', qid: 'Q189507' },
    { nombre: 'Coimbra', qid: 'Q193074' },
    { nombre: 'Santarém', qid: 'Q190740' },
    { nombre: 'Viseu', qid: 'Q193458' },
    { nombre: 'Viana do Castelo', qid: 'Q203283' },
    { nombre: 'Vila Real', qid: 'Q189559' },
    { nombre: 'Évora', qid: 'Q208250' },
    { nombre: 'Castelo Branco', qid: 'Q190103' },
    { nombre: 'Guarda', qid: 'Q203204' },
    { nombre: 'Beja', qid: 'Q203166' },
    { nombre: 'Bragança', qid: 'Q189580' },
    { nombre: 'Portalegre', qid: 'Q201439' },
    // Regiões autónomas
    { nombre: 'Açores', qid: 'Q25263' },
    { nombre: 'Madeira', qid: 'Q26253' },
];

async function ejecutar() {
    console.log('=== FASE 1: Descarga patrimonio Portugal (Wikidata SPARQL) ===\n');

    // Verificar si ya tenemos datos de Portugal
    const existentes = (await db.query(
        "SELECT COUNT(*) as n FROM bienes WHERE pais = 'Portugal'"
    )).rows[0].n;
    if (existentes > 0) {
        console.log(`Ya existen ${existentes} registros de Portugal. Se actualizarán con upsert.\n`);
    }

    // Query principal: todos los heritage items de Portugal
    console.log('Descargando heritage items de Portugal...');
    const items = await descargarPatrimonioPortugal();
    console.log(`  Obtenidos: ${items.length} bienes únicos\n`);

    if (items.length === 0) {
        console.log('No se obtuvieron datos. Saliendo.');
        await db.cerrar();
        return;
    }

    // Insertar en batches
    let insertados = 0;
    const batchSize = 1000;
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await db.upsertBienes(batch);
        insertados += batch.length;
        process.stdout.write(`\r  Insertados: ${insertados}/${items.length}`);
    }

    // También insertar en tabla wikidata para los que tienen QID
    console.log('\n\nInsertando datos Wikidata...');
    let wikidataCount = 0;
    for (const item of items) {
        if (item.qid) {
            const bienRow = (await db.query(
                'SELECT id FROM bienes WHERE codigo_fuente = ? AND pais = ?',
                [item.codigo_fuente, 'Portugal']
            )).rows[0];

            if (bienRow) {
                try {
                    await db.insertarWikidata({
                        bien_id: bienRow.id,
                        qid: item.qid,
                        descripcion: item._descripcion || null,
                        imagen_url: item._imagen || null,
                        arquitecto: null,
                        estilo: item._estilo || null,
                        material: null,
                        altura: null,
                        superficie: null,
                        inception: item._inception || null,
                        heritage_label: item._heritage_label || null,
                        wikipedia_url: item._wikipedia_url || null,
                        commons_category: item._commons_category || null,
                        sipca_code: null,
                        raw_json: null,
                    });
                    wikidataCount++;
                } catch (err) {
                    // Ignorar duplicados
                }
            }
        }
    }

    const totalPT = (await db.query(
        "SELECT COUNT(*) as n FROM bienes WHERE pais = 'Portugal'"
    )).rows[0].n;
    const conCoords = (await db.query(
        "SELECT COUNT(*) as n FROM bienes WHERE pais = 'Portugal' AND latitud IS NOT NULL"
    )).rows[0].n;

    console.log(`\nFase 1 Portugal completada:`);
    console.log(`  - Bienes insertados: ${insertados}`);
    console.log(`  - Total en BD (Portugal): ${totalPT}`);
    console.log(`  - Con coordenadas: ${conCoords}`);
    console.log(`  - Con datos Wikidata: ${wikidataCount}`);

    // Distribución por distrito
    const porDistrito = (await db.query(
        "SELECT provincia, COUNT(*) as n FROM bienes WHERE pais = 'Portugal' AND provincia IS NOT NULL GROUP BY provincia ORDER BY n DESC"
    )).rows;
    console.log('  - Por distrito:');
    porDistrito.forEach(r => console.log(`      ${r.provincia}: ${r.n}`));

    await db.cerrar();
}

async function descargarPatrimonioPortugal() {
    const itemsMap = new Map();

    // Query en batches por distrito para evitar timeouts
    for (const distrito of DISTRITOS) {
        console.log(`  Descargando ${distrito.nombre} (${distrito.qid})...`);
        try {
            await descargarPorDistrito(itemsMap, distrito);
            console.log(`    -> ${itemsMap.size} items acumulados`);
        } catch (err) {
            console.error(`    Error: ${err.message}`);
        }
        await sleep(DELAY_MS);
    }

    // Query complementaria: items directamente en Portugal sin distrito
    console.log('  Descargando items sin distrito específico...');
    try {
        await descargarDirectoPortugal(itemsMap);
        console.log(`    -> ${itemsMap.size} items total`);
    } catch (err) {
        console.error(`    Error: ${err.message}`);
    }

    return [...itemsMap.values()];
}

async function descargarPorDistrito(itemsMap, distrito) {
    const query = `
SELECT DISTINCT ?item ?itemLabel ?itemDescription ?municipioLabel ?coord ?image
       ?heritageLabel ?inception ?commonsCategory ?articlePt ?articleEs
       ?estiloLabel ?distritoLabel
WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P17 wd:Q45 .

    # Items en municipios del distrito
    {
        ?item wdt:P131 ?loc .
        ?loc wdt:P131 wd:${distrito.qid} .
    } UNION {
        ?item wdt:P131 ?loc .
        ?loc wdt:P131/wdt:P131 wd:${distrito.qid} .
    } UNION {
        ?item wdt:P131 wd:${distrito.qid} .
    }

    OPTIONAL { ?item wdt:P625 ?coord }
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P571 ?inception }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P149 ?estilo }
    OPTIONAL {
        ?articlePt schema:about ?item ;
                   schema:isPartOf <https://pt.wikipedia.org/> .
    }
    OPTIONAL {
        ?articleEs schema:about ?item ;
                   schema:isPartOf <https://es.wikipedia.org/> .
    }
    OPTIONAL { ?item wdt:P131 ?municipio }

    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "pt,es,en".
        ?item rdfs:label ?itemLabel.
        ?item schema:description ?itemDescription.
        ?heritage rdfs:label ?heritageLabel.
        ?municipio rdfs:label ?municipioLabel.
        ?estilo rdfs:label ?estiloLabel.
    }
}
LIMIT 10000
`;

    const response = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 120000,
    });

    procesarResultados(itemsMap, response.data.results.bindings, distrito.nombre);
}

async function descargarDirectoPortugal(itemsMap) {
    const query = `
SELECT DISTINCT ?item ?itemLabel ?itemDescription ?municipioLabel ?coord ?image
       ?heritageLabel ?inception ?commonsCategory ?articlePt ?articleEs
       ?estiloLabel
WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P17 wd:Q45 .
    ?item wdt:P625 ?coord .

    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P571 ?inception }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P149 ?estilo }
    OPTIONAL {
        ?articlePt schema:about ?item ;
                   schema:isPartOf <https://pt.wikipedia.org/> .
    }
    OPTIONAL {
        ?articleEs schema:about ?item ;
                   schema:isPartOf <https://es.wikipedia.org/> .
    }
    OPTIONAL { ?item wdt:P131 ?municipio }

    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "pt,es,en".
        ?item rdfs:label ?itemLabel.
        ?item schema:description ?itemDescription.
        ?heritage rdfs:label ?heritageLabel.
        ?municipio rdfs:label ?municipioLabel.
        ?estilo rdfs:label ?estiloLabel.
    }
}
LIMIT 20000
`;

    const response = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 120000,
    });

    procesarResultados(itemsMap, response.data.results.bindings, null);
}

function procesarResultados(itemsMap, bindings, distritoNombre) {
    for (const r of bindings) {
        const itemQid = r.item?.value?.split('/').pop();
        if (!itemQid) continue;

        // Evitar duplicados
        if (itemsMap.has(itemQid)) continue;

        const denominacion = r.itemLabel?.value;
        if (!denominacion || denominacion === itemQid) continue;

        // Parsear coordenadas
        let lat = null, lon = null;
        if (r.coord?.value) {
            const match = r.coord.value.match(/Point\(([^ ]+) ([^)]+)\)/);
            if (match) {
                lon = parseFloat(match[1]);
                lat = parseFloat(match[2]);
            }
        }

        // Wikipedia URL (preferir pt, luego es)
        const wikipedia_url = r.articlePt?.value || r.articleEs?.value || null;

        itemsMap.set(itemQid, {
            denominacion,
            tipo: null,
            clase: null,
            categoria: r.heritageLabel?.value || null,
            provincia: distritoNombre || null,
            comarca: null,
            municipio: r.municipioLabel?.value || null,
            localidad: null,
            latitud: lat,
            longitud: lon,
            situacion: null,
            resolucion: null,
            publicacion: null,
            fuente_opendata: 0,
            comunidad_autonoma: distritoNombre || null,
            codigo_fuente: itemQid,
            pais: 'Portugal',
            // Extras para wikidata (prefixed with _ to avoid DB column conflict)
            qid: itemQid,
            _descripcion: r.itemDescription?.value || null,
            _imagen: r.image?.value || null,
            _estilo: r.estiloLabel?.value || null,
            _inception: r.inception?.value || null,
            _heritage_label: r.heritageLabel?.value || null,
            _wikipedia_url: wikipedia_url,
            _commons_category: r.commonsCategory?.value || null,
        });
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { ejecutar };

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error en Fase 1 Portugal:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
