/**
 * Enriquece items que tienen QID pero no tienen detalles descargados
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'Accept': 'application/sparql-results+json',
    'User-Agent': 'PatrimonioEspanaBot/1.0'
};
const DELAY_MS = 100;
const BATCH_SIZE = 50;

async function ejecutar() {
    console.log('=== ENRIQUECER WIKIDATA PENDIENTES ===\n');

    // Obtener items con QID pero sin raw_json
    const pendientes = (await db.query(`
        SELECT w.id, w.bien_id, w.qid, b.denominacion, b.comunidad_autonoma
        FROM wikidata w
        JOIN bienes b ON w.bien_id = b.id
        WHERE w.qid IS NOT NULL AND w.raw_json IS NULL
        ORDER BY b.comunidad_autonoma
    `)).rows;

    console.log(`Items pendientes de enriquecer: ${pendientes.length}\n`);

    if (pendientes.length === 0) {
        console.log('Nada que hacer.');
        await db.cerrar();
        return;
    }

    let enriquecidos = 0;
    let errores = 0;
    let imagenesNuevas = 0;

    // Procesar en lotes
    for (let i = 0; i < pendientes.length; i += BATCH_SIZE) {
        const batch = pendientes.slice(i, i + BATCH_SIZE);
        const qids = batch.map(p => p.qid);

        if ((i / BATCH_SIZE) % 10 === 0) {
            console.log(`[${i}/${pendientes.length}] Procesando lote...`);
        }

        try {
            const detalles = await consultarLoteQIDs(qids);

            for (const item of batch) {
                const detalle = detalles.get(item.qid);
                if (detalle) {
                    await db.query(`
                        UPDATE wikidata SET
                            descripcion = COALESCE(descripcion, $1),
                            imagen_url = COALESCE(imagen_url, $2),
                            arquitecto = COALESCE(arquitecto, $3),
                            estilo = COALESCE(estilo, $4),
                            material = COALESCE(material, $5),
                            altura = COALESCE(altura, $6),
                            superficie = COALESCE(superficie, $7),
                            inception = COALESCE(inception, $8),
                            heritage_label = COALESCE(heritage_label, $9),
                            wikipedia_url = COALESCE(wikipedia_url, $10),
                            commons_category = COALESCE(commons_category, $11),
                            raw_json = $12
                        WHERE id = $13
                    `, [
                        detalle.descripcion,
                        detalle.imagen_url,
                        detalle.arquitecto,
                        detalle.estilo,
                        detalle.material,
                        detalle.altura,
                        detalle.superficie,
                        detalle.inception,
                        detalle.heritage_label,
                        detalle.wikipedia_url,
                        detalle.commons_category,
                        JSON.stringify(detalle),
                        item.id
                    ]);

                    // Añadir imagen si existe y no la tenemos
                    if (detalle.imagen_url) {
                        const existe = (await db.query(
                            'SELECT id FROM imagenes WHERE bien_id = ? AND url = ?',
                            [item.bien_id, detalle.imagen_url]
                        )).rows[0];

                        if (!existe) {
                            await db.insertarImagen({
                                bien_id: item.bien_id,
                                url: detalle.imagen_url,
                                titulo: item.denominacion,
                                autor: null,
                                fuente: 'wikidata',
                            });
                            imagenesNuevas++;
                        }
                    }

                    enriquecidos++;
                }
            }
        } catch (err) {
            errores++;
            console.error(`  Error en lote: ${err.message}`);
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nResultado:`);
    console.log(`  - Enriquecidos: ${enriquecidos}`);
    console.log(`  - Imágenes nuevas: ${imagenesNuevas}`);
    console.log(`  - Errores: ${errores}`);

    // Stats finales
    const totalImg = (await db.query('SELECT COUNT(*) as n FROM imagenes')).rows[0].n;
    const conDesc = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE descripcion IS NOT NULL')).rows[0].n;
    console.log(`\nEstadísticas:`);
    console.log(`  - Total imágenes: ${totalImg}`);
    console.log(`  - Items con descripción: ${conDesc}`);

    await db.cerrar();
}

async function consultarLoteQIDs(qids) {
    const qidValues = qids.map(q => `wd:${q}`).join(' ');

    const query = `
SELECT ?item ?itemDescription ?image ?coord ?inception
       ?architectLabel ?architecturalStyleLabel
       ?height ?area ?mainMaterialLabel
       ?heritageLabel ?commonsCategory
       ?articleEs
WHERE {
    VALUES ?item { ${qidValues} }
    OPTIONAL { ?item schema:description ?itemDescription FILTER(LANG(?itemDescription) = "es") }
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P625 ?coord }
    OPTIONAL { ?item wdt:P571 ?inception }
    OPTIONAL { ?item wdt:P84 ?architect }
    OPTIONAL { ?item wdt:P149 ?architecturalStyle }
    OPTIONAL { ?item wdt:P2044 ?height }
    OPTIONAL { ?item wdt:P2049 ?area }
    OPTIONAL { ?item wdt:P186 ?mainMaterial }
    OPTIONAL { ?item wdt:P1435 ?heritage }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL {
        ?articleEs schema:about ?item ;
                   schema:isPartOf <https://es.wikipedia.org/> .
    }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "es,en".
        ?architect rdfs:label ?architectLabel.
        ?architecturalStyle rdfs:label ?architecturalStyleLabel.
        ?mainMaterial rdfs:label ?mainMaterialLabel.
        ?heritage rdfs:label ?heritageLabel.
    }
}
`;

    const response = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 60000,
    });

    const resultMap = new Map();

    for (const r of response.data.results.bindings) {
        const qid = r.item?.value?.split('/').pop();
        if (!qid || resultMap.has(qid)) continue;

        // Parsear coordenadas
        let lat = null, lon = null;
        if (r.coord?.value) {
            const match = r.coord.value.match(/Point\(([^ ]+) ([^)]+)\)/);
            if (match) {
                lon = parseFloat(match[1]);
                lat = parseFloat(match[2]);
            }
        }

        resultMap.set(qid, {
            descripcion: r.itemDescription?.value || null,
            imagen_url: r.image?.value || null,
            arquitecto: r.architectLabel?.value || null,
            estilo: r.architecturalStyleLabel?.value || null,
            material: r.mainMaterialLabel?.value || null,
            altura: r.height ? parseFloat(r.height.value) : null,
            superficie: r.area ? parseFloat(r.area.value) : null,
            inception: r.inception?.value || null,
            heritage_label: r.heritageLabel?.value || null,
            wikipedia_url: r.articleEs?.value || null,
            commons_category: r.commonsCategory?.value || null,
            latitud: lat,
            longitud: lon,
        });
    }

    return resultMap;
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
