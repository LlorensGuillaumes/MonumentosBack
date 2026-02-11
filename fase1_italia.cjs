/**
 * Fase 1: Descarga de patrimonio de Italia via Wikidata SPARQL
 * Query: heritage items (P1435) en Italia (P17 = Q38)
 * ~74,000 registros esperados, ~82% con coordenadas
 * Consulta por las 20 regioni italianas
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'Accept': 'application/sparql-results+json',
    'User-Agent': 'PatrimonioEuropaBot/1.0 (heritage data project)'
};
const DELAY_MS = 3000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 10000;

// 20 Regioni d'Italia con sus QIDs (P31 = Q16110)
const REGIONI = [
    { nombre: 'Abruzzo', qid: 'Q1284' },
    { nombre: 'Basilicata', qid: 'Q1452' },
    { nombre: 'Calabria', qid: 'Q1458' },
    { nombre: 'Campania', qid: 'Q1438' },
    { nombre: 'Emilia-Romagna', qid: 'Q1263' },
    { nombre: 'Friuli-Venezia Giulia', qid: 'Q1250' },
    { nombre: 'Lazio', qid: 'Q1282' },
    { nombre: 'Liguria', qid: 'Q1256' },
    { nombre: 'Lombardia', qid: 'Q1210' },
    { nombre: 'Marche', qid: 'Q1279' },
    { nombre: 'Molise', qid: 'Q1443' },
    { nombre: 'Piemonte', qid: 'Q1216' },
    { nombre: 'Puglia', qid: 'Q1447' },
    { nombre: 'Sardegna', qid: 'Q1462' },
    { nombre: 'Sicilia', qid: 'Q1460' },
    { nombre: 'Toscana', qid: 'Q1273' },
    { nombre: 'Trentino-Alto Adige', qid: 'Q1237' },
    { nombre: 'Umbria', qid: 'Q1280' },
    { nombre: "Valle d'Aosta", qid: 'Q1222' },
    { nombre: 'Veneto', qid: 'Q1243' },
];

async function ejecutar() {
    console.log('=== FASE 1: Descarga patrimonio Italia (Wikidata SPARQL) ===\n');

    // Verificar si ya tenemos datos de Italia
    const existentes = (await db.query(
        "SELECT COUNT(*) as n FROM bienes WHERE pais = 'Italia'"
    )).rows[0].n;
    if (existentes > 0) {
        console.log(`Ya existen ${existentes} registros de Italia. Se actualizarán con upsert.\n`);
    }

    // Query principal: todos los heritage items de Italia por regione
    console.log('Descargando heritage items de Italia...');
    const items = await descargarPatrimonioItalia();
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
                [item.codigo_fuente, 'Italia']
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

    const totalIT = (await db.query(
        "SELECT COUNT(*) as n FROM bienes WHERE pais = 'Italia'"
    )).rows[0].n;
    const conCoords = (await db.query(
        "SELECT COUNT(*) as n FROM bienes WHERE pais = 'Italia' AND latitud IS NOT NULL"
    )).rows[0].n;

    console.log(`\nFase 1 Italia completada:`);
    console.log(`  - Bienes insertados: ${insertados}`);
    console.log(`  - Total en BD (Italia): ${totalIT}`);
    console.log(`  - Con coordenadas: ${conCoords}`);
    console.log(`  - Con datos Wikidata: ${wikidataCount}`);

    // Distribución por regione
    const porRegione = (await db.query(
        "SELECT comunidad_autonoma, COUNT(*) as n FROM bienes WHERE pais = 'Italia' AND comunidad_autonoma IS NOT NULL GROUP BY comunidad_autonoma ORDER BY n DESC"
    )).rows;
    console.log('  - Por regione:');
    porRegione.forEach(r => console.log(`      ${r.comunidad_autonoma}: ${r.n}`));

    await db.cerrar();
}

async function descargarPatrimonioItalia() {
    const itemsMap = new Map();

    // Query en batches por regione para evitar timeouts
    for (const regione of REGIONI) {
        console.log(`  Descargando ${regione.nombre} (${regione.qid})...`);
        try {
            await descargarPorRegione(itemsMap, regione);
            console.log(`    -> ${itemsMap.size} items acumulados`);
        } catch (err) {
            console.error(`    Error en ${regione.nombre}: ${err.message}`);
        }
        await sleep(DELAY_MS);
    }

    // Query complementaria: items directamente en Italia sin regione asignada
    console.log('  Descargando items sin regione específica...');
    try {
        await descargarDirectoItalia(itemsMap);
        console.log(`    -> ${itemsMap.size} items total`);
    } catch (err) {
        console.error(`    Error: ${err.message}`);
    }

    return [...itemsMap.values()];
}

async function descargarPorRegione(itemsMap, regione) {
    // Cadena P131 italiana: item → comune → provincia → regione (hasta 3 saltos)
    const query = `
SELECT DISTINCT ?item ?itemLabel ?itemDescription ?municipioLabel ?coord ?image
       ?heritageLabel ?inception ?commonsCategory ?articleIt ?articleEs
       ?estiloLabel ?provinciaLabel
WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P17 wd:Q38 .

    # Items en la cadena administrativa de la regione (1-3 saltos P131)
    {
        ?item wdt:P131 ?loc .
        ?loc wdt:P131 wd:${regione.qid} .
    } UNION {
        ?item wdt:P131 ?loc .
        ?loc wdt:P131/wdt:P131 wd:${regione.qid} .
    } UNION {
        ?item wdt:P131 wd:${regione.qid} .
    }

    OPTIONAL { ?item wdt:P625 ?coord }
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P571 ?inception }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P149 ?estilo }
    OPTIONAL {
        ?articleIt schema:about ?item ;
                   schema:isPartOf <https://it.wikipedia.org/> .
    }
    OPTIONAL {
        ?articleEs schema:about ?item ;
                   schema:isPartOf <https://es.wikipedia.org/> .
    }
    OPTIONAL { ?item wdt:P131 ?municipio }
    OPTIONAL {
        ?item wdt:P131/wdt:P131 ?provincia .
        ?provincia wdt:P31/wdt:P279* wd:Q15089 .
    }

    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "it,es,en".
        ?item rdfs:label ?itemLabel.
        ?item schema:description ?itemDescription.
        ?heritage rdfs:label ?heritageLabel.
        ?municipio rdfs:label ?municipioLabel.
        ?estilo rdfs:label ?estiloLabel.
        ?provincia rdfs:label ?provinciaLabel.
    }
}
LIMIT 15000
`;

    const data = await ejecutarSparql(query);
    procesarResultados(itemsMap, data.results.bindings, regione.nombre);
}

async function descargarDirectoItalia(itemsMap) {
    const query = `
SELECT DISTINCT ?item ?itemLabel ?itemDescription ?municipioLabel ?coord ?image
       ?heritageLabel ?inception ?commonsCategory ?articleIt ?articleEs
       ?estiloLabel
WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P17 wd:Q38 .
    ?item wdt:P625 ?coord .

    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P571 ?inception }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P149 ?estilo }
    OPTIONAL {
        ?articleIt schema:about ?item ;
                   schema:isPartOf <https://it.wikipedia.org/> .
    }
    OPTIONAL {
        ?articleEs schema:about ?item ;
                   schema:isPartOf <https://es.wikipedia.org/> .
    }
    OPTIONAL { ?item wdt:P131 ?municipio }

    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "it,es,en".
        ?item rdfs:label ?itemLabel.
        ?item schema:description ?itemDescription.
        ?heritage rdfs:label ?heritageLabel.
        ?municipio rdfs:label ?municipioLabel.
        ?estilo rdfs:label ?estiloLabel.
    }
}
LIMIT 80000
`;

    const data = await ejecutarSparql(query);
    procesarResultados(itemsMap, data.results.bindings, null);
}

async function ejecutarSparql(query) {
    let lastError;
    for (let intento = 0; intento < MAX_RETRIES; intento++) {
        try {
            const response = await axios.get(WIKIDATA_SPARQL, {
                params: { query, format: 'json' },
                headers: HEADERS,
                timeout: 180000,
            });
            return response.data;
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            if (status === 429 || status === 503 || status >= 500) {
                const backoff = INITIAL_BACKOFF_MS * Math.pow(2, intento);
                console.warn(`    Retry ${intento + 1}/${MAX_RETRIES} tras error ${status}, esperando ${backoff / 1000}s...`);
                await sleep(backoff);
            } else {
                throw err;
            }
        }
    }
    throw lastError;
}

function procesarResultados(itemsMap, bindings, regioneNombre) {
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

        // Wikipedia URL (preferir it, luego es)
        const wikipedia_url = r.articleIt?.value || r.articleEs?.value || null;

        // Provincia (si se pudo extraer)
        const provincia = r.provinciaLabel?.value || null;

        itemsMap.set(itemQid, {
            denominacion,
            tipo: null,
            clase: null,
            categoria: r.heritageLabel?.value || null,
            provincia: provincia,
            comarca: null,
            municipio: r.municipioLabel?.value || null,
            localidad: null,
            latitud: lat,
            longitud: lon,
            situacion: null,
            resolucion: null,
            publicacion: null,
            fuente_opendata: 0,
            comunidad_autonoma: regioneNombre || null,
            codigo_fuente: itemQid,
            pais: 'Italia',
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
        console.error('Error en Fase 1 Italia:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
