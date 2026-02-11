/**
 * Fase 1: Descarga de patrimonio de CCAA faltantes via Wikidata
 * Obtiene bienes culturales de regiones sin datos abiertos propios
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'Accept': 'application/sparql-results+json',
    'User-Agent': 'PatrimonioEspanaBot/1.0 (heritage data project)'
};
const DELAY_MS = 2000;

// CCAA faltantes con sus QIDs en Wikidata
const CCAA_FALTANTES = [
    { nombre: 'Pais Vasco', qid: 'Q47588', langs: 'es,eu,en' },
    { nombre: 'Castilla-La Mancha', qid: 'Q5765', langs: 'es,en' },
    { nombre: 'Castilla y Leon', qid: 'Q5765', langs: 'es,en' },  // Q5765 is wrong, need to fix
    { nombre: 'Comunidad de Madrid', qid: 'Q5756', langs: 'es,en' },
    { nombre: 'Galicia', qid: 'Q3908', langs: 'es,gl,en' },
    { nombre: 'Asturias', qid: 'Q3934', langs: 'es,ast,en' },
    { nombre: 'Cantabria', qid: 'Q3946', langs: 'es,en' },
    { nombre: 'Navarra', qid: 'Q4018', langs: 'es,eu,en' },
    { nombre: 'La Rioja', qid: 'Q5765', langs: 'es,en' },  // Need correct QID
    { nombre: 'Region de Murcia', qid: 'Q5765', langs: 'es,en' },  // Need correct QID
    { nombre: 'Extremadura', qid: 'Q5765', langs: 'es,en' },  // Need correct QID
    { nombre: 'Illes Balears', qid: 'Q5765', langs: 'es,ca,en' },  // Need correct QID
    { nombre: 'Canarias', qid: 'Q5765', langs: 'es,en' },  // Need correct QID
];

// QIDs correctos para cada CCAA
const CCAA_QIDS = {
    'Pais Vasco': 'Q47588',
    'Castilla-La Mancha': 'Q5765',
    'Castilla y Leon': 'Q5778',
    'Comunidad de Madrid': 'Q5756',
    'Galicia': 'Q3908',
    'Asturias': 'Q3934',
    'Cantabria': 'Q3946',
    'Navarra': 'Q4018',
    'La Rioja': 'Q5765',
    'Region de Murcia': 'Q5765',
    'Extremadura': 'Q5765',
    'Illes Balears': 'Q5765',
    'Canarias': 'Q5765',
};

async function ejecutar() {
    console.log('=== FASE 1 WIKIDATA: Descarga patrimonio CCAA faltantes ===\n');

    // Primero obtener los QIDs correctos de cada CCAA
    console.log('Obteniendo QIDs de CCAA...');
    const ccaaQids = await obtenerQidsCCAA();
    console.log(`  Encontradas ${Object.keys(ccaaQids).length} CCAA\n`);

    let totalInsertados = 0;

    for (const [nombre, qid] of Object.entries(ccaaQids)) {
        // Verificar si ya tenemos datos de Wikidata para esta CCAA
        // (no contar items de fuentes propias como DIBA, IAPH, etc.)
        const existentesWd = (await db.query(
            "SELECT COUNT(*) as n FROM bienes WHERE comunidad_autonoma = ? AND codigo_fuente LIKE 'Q%'",
            [nombre]
        )).rows[0];
        if (existentesWd.n > 0) {
            console.log(`${nombre}: Ya tiene ${existentesWd.n} registros de Wikidata, saltando...`);
            continue;
        }

        console.log(`\n--- ${nombre} (${qid}) ---`);

        try {
            const items = await descargarPatrimonioCCAA(nombre, qid);
            console.log(`  Obtenidos: ${items.length} bienes`);

            if (items.length > 0) {
                await db.upsertBienes(items);
                totalInsertados += items.length;

                // También insertar en tabla wikidata
                for (const item of items) {
                    if (item.qid) {
                        const bienId = (await db.query(
                            'SELECT id FROM bienes WHERE codigo_fuente = ? AND comunidad_autonoma = ?',
                            [item.codigo_fuente, nombre]
                        )).rows[0];

                        if (bienId) {
                            await db.insertarWikidata({
                                bien_id: bienId.id,
                                qid: item.qid,
                                descripcion: item.descripcion || null,
                                imagen_url: item.imagen || null,
                                arquitecto: null,
                                estilo: item.estilo || null,
                                material: null,
                                altura: null,
                                superficie: null,
                                inception: item.inception || null,
                                heritage_label: item.heritage_label || null,
                                wikipedia_url: item.wikipedia_url || null,
                                commons_category: item.commons_category || null,
                                sipca_code: null,
                                raw_json: null,
                            });
                        }
                    }
                }
            }
        } catch (err) {
            console.error(`  Error: ${err.message}`);
        }

        await sleep(DELAY_MS);
    }

    const stats = await db.estadisticas();
    console.log(`\n=== Fase 1 Wikidata CCAA completada ===`);
    console.log(`  - Nuevos bienes insertados: ${totalInsertados}`);
    console.log(`  - Total en BD: ${stats.bienes}`);

    // Mostrar distribución por CCAA
    console.log('\nDistribución por CCAA:');
    const porCCAA = (await db.query(
        'SELECT comunidad_autonoma, COUNT(*) as n FROM bienes GROUP BY comunidad_autonoma ORDER BY n DESC'
    )).rows;
    porCCAA.forEach(r => console.log(`  ${r.comunidad_autonoma}: ${r.n.toLocaleString()}`));

    await db.cerrar();
}

async function obtenerQidsCCAA() {
    const query = `
SELECT ?ccaa ?ccaaLabel WHERE {
    ?ccaa wdt:P31 wd:Q10742.  # instancia de comunidad autónoma de España
    SERVICE wikibase:label { bd:serviceParam wikibase:language "es". }
}
`;

    const response = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 30000,
    });

    const ccaaMap = {};
    for (const r of response.data.results.bindings) {
        const qid = r.ccaa.value.split('/').pop();
        const nombre = r.ccaaLabel.value;
        // Normalizar nombre
        const nombreNorm = normalizarNombreCCAA(nombre);
        if (nombreNorm) {
            ccaaMap[nombreNorm] = qid;
        }
    }

    return ccaaMap;
}

function normalizarNombreCCAA(nombre) {
    const mapping = {
        'País Vasco': 'Pais Vasco',
        'Euskadi': 'Pais Vasco',
        'Castilla-La Mancha': 'Castilla-La Mancha',
        'Castilla y León': 'Castilla y Leon',
        'Comunidad de Madrid': 'Comunidad de Madrid',
        'Galicia': 'Galicia',
        'Principado de Asturias': 'Asturias',
        'Asturias': 'Asturias',
        'Cantabria': 'Cantabria',
        'Comunidad Foral de Navarra': 'Navarra',
        'Navarra': 'Navarra',
        'La Rioja': 'La Rioja',
        'Región de Murcia': 'Region de Murcia',
        'Murcia': 'Region de Murcia',
        'Extremadura': 'Extremadura',
        'Islas Baleares': 'Illes Balears',
        'Illes Balears': 'Illes Balears',
        'Canarias': 'Canarias',
        'Ceuta': 'Ceuta',
        'Melilla': 'Melilla',
        // Ya tenemos estos (fuentes propias)
        'Aragón': null,
        'Andalucía': null,
        'Cataluña': 'Catalunya',  // Solo descargar Girona/Lleida/Tarragona (Barcelona via DIBA)
        'Comunidad Valenciana': null,
        'Comunitat Valenciana': null,
    };

    return mapping[nombre] !== undefined ? mapping[nombre] : nombre;
}

async function descargarPatrimonioCCAA(nombre, qid) {
    // Para Catalunya, excluir Barcelona provincia (ya cubierta por DIBA)
    const excluirBarcelona = nombre === 'Catalunya';
    const filtroExcluir = excluirBarcelona ? `
    # Excluir Barcelona provincia (Q81949) - ya cubierta por DIBA
    FILTER NOT EXISTS { ?item wdt:P131/wdt:P131 wd:Q81949 }
    FILTER NOT EXISTS { ?item wdt:P131 wd:Q81949 }` : '';

    // Query para obtener heritage items de la CCAA
    const query = `
SELECT DISTINCT ?item ?itemLabel ?itemDescription ?municipioLabel ?coord ?image
       ?heritageLabel ?inception ?commonsCategory ?articleEs ?estilo ?estiloLabel
       ?provinciaLabel
WHERE {
    # Heritage items en la CCAA (2 niveles de P131)
    {
        ?item wdt:P1435 ?heritage .
        ?item wdt:P131 ?loc .
        ?loc wdt:P131/wdt:P131 wd:${qid} .
    } UNION {
        ?item wdt:P1435 ?heritage .
        ?item wdt:P131 ?loc .
        ?loc wdt:P131 wd:${qid} .
    } UNION {
        ?item wdt:P1435 ?heritage .
        ?item wdt:P131 wd:${qid} .
    }
    ${filtroExcluir}

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
    # Obtener provincia
    OPTIONAL {
        ?item wdt:P131 ?mun .
        ?mun wdt:P131 ?provincia .
        ?provincia wdt:P31 wd:Q162620 .
    }

    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "es,ca,en".
        ?item rdfs:label ?itemLabel.
        ?item schema:description ?itemDescription.
        ?heritage rdfs:label ?heritageLabel.
        ?municipio rdfs:label ?municipioLabel.
        ?estilo rdfs:label ?estiloLabel.
        ?provincia rdfs:label ?provinciaLabel.
    }
}
LIMIT 10000
`;

    const response = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 120000,
    });

    const itemsMap = new Map();

    for (const r of response.data.results.bindings) {
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

        itemsMap.set(itemQid, {
            denominacion: denominacion,
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
            comunidad_autonoma: nombre,
            codigo_fuente: itemQid,
            pais: 'España',
            // Extras para wikidata
            qid: itemQid,
            descripcion: r.itemDescription?.value || null,
            imagen: r.image?.value || null,
            estilo: r.estiloLabel?.value || null,
            inception: r.inception?.value || null,
            heritage_label: r.heritageLabel?.value || null,
            wikipedia_url: r.articleEs?.value || null,
            commons_category: r.commonsCategory?.value || null,
        });
    }

    return [...itemsMap.values()];
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
