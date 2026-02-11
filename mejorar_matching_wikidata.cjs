/**
 * Script para mejorar el matching de Wikidata con fuzzy matching
 * y mejor normalizacion de nombres
 */

const axios = require('axios');
const removeAccents = require('remove-accents');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = { Accept: 'application/sparql-results+json', 'User-Agent': 'PatrimonioEspanaBot/1.0' };
const DELAY_MS = 100;

// Configuracion por region - ampliada con mas QIDs
const REGIONES = {
    'Aragon': {
        qids: ['Q4040'], // CCAA Aragon
        langs: 'es,en,ca'
    },
    'Andalucia': {
        qids: ['Q5783'], // CCAA Andalucia
        langs: 'es,en'
    },
    'Catalunya': {
        qids: ['Q81949', 'Q5765', 'Q5765', 'Q12325'], // Barcelona prov, Girona, Lleida, Tarragona
        langs: 'es,ca,en'
    },
    'Comunitat Valenciana': {
        qids: ['Q5720'], // CCAA Valencia
        langs: 'es,ca,en'
    },
};

// Prefijos comunes a eliminar para matching
const PREFIJOS = [
    'iglesia de', 'iglesia parroquial de', 'parroquia de',
    'ermita de', 'capilla de', 'basilica de', 'catedral de',
    'castillo de', 'torre de', 'fortaleza de', 'alcazaba de',
    'palacio de', 'casa de', 'casa del', 'casa de la',
    'convento de', 'monasterio de', 'abadia de',
    'puente de', 'fuente de', 'acueducto de',
    'conjunto historico de', 'centro historico de', 'casco antiguo de',
    'yacimiento de', 'cueva de', 'abrigo de',
    'sant ', 'santa ', 'san ', 'santo ',
    "esglesia de", "esglesia parroquial de", "capella de",
    "castell de", "torre de", "palau de", "pont de",
    "monestir de", "convent de",
];

async function ejecutar() {
    console.log('=== MEJORAR MATCHING WIKIDATA ===\n');

    // Obtener items sin QID
    const sinQid = (await db.query(`
        SELECT b.id, b.denominacion, b.municipio, b.comunidad_autonoma
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid IS NULL OR w.id IS NULL
    `)).rows;

    console.log(`Items sin QID: ${sinQid.length}\n`);

    // Agrupar por region
    const porRegion = {};
    for (const item of sinQid) {
        const region = item.comunidad_autonoma;
        if (!porRegion[region]) porRegion[region] = [];
        porRegion[region].push(item);
    }

    let totalNuevosMatches = 0;

    for (const [region, items] of Object.entries(porRegion)) {
        if (!REGIONES[region]) continue;
        console.log(`--- ${region}: ${items.length} items pendientes ---\n`);

        // Descargar items de Wikidata para esta region
        console.log('Descargando items de Wikidata...');
        const wikidataItems = await descargarWikidataRegion(region);
        console.log(`  Obtenidos: ${wikidataItems.length} items\n`);

        if (wikidataItems.length === 0) continue;

        // Crear indices para busqueda
        const indexNombreExacto = new Map();
        const indexNombreNorm = new Map();
        const indexPalabras = new Map();

        for (const witem of wikidataItems) {
            const nombreExacto = witem.label.toLowerCase();
            const nombreNorm = normalizarNombre(witem.label);
            const palabras = extraerPalabrasSignificativas(witem.label);

            // Index exacto
            if (!indexNombreExacto.has(nombreExacto)) indexNombreExacto.set(nombreExacto, []);
            indexNombreExacto.get(nombreExacto).push(witem);

            // Index normalizado
            if (!indexNombreNorm.has(nombreNorm)) indexNombreNorm.set(nombreNorm, []);
            indexNombreNorm.get(nombreNorm).push(witem);

            // Index por palabras clave
            for (const palabra of palabras) {
                if (palabra.length < 4) continue;
                if (!indexPalabras.has(palabra)) indexPalabras.set(palabra, []);
                indexPalabras.get(palabra).push(witem);
            }
        }

        // Intentar matching
        console.log('Aplicando matching mejorado...');
        let nuevosMatches = 0;

        for (const item of items) {
            const match = buscarMejorMatch(item, indexNombreExacto, indexNombreNorm, indexPalabras);

            if (match) {
                // Actualizar o insertar wikidata
                const existe = (await db.query('SELECT id FROM wikidata WHERE bien_id = ?', [item.id])).rows[0];
                if (existe) {
                    await db.query('UPDATE wikidata SET qid = ?, imagen_url = ?, heritage_label = ?, commons_category = ? WHERE bien_id = ?',
                        [match.qid, match.image, match.heritage, match.commons, item.id]);
                } else {
                    await db.insertarWikidata({
                        bien_id: item.id,
                        qid: match.qid,
                        descripcion: null,
                        imagen_url: match.image || null,
                        arquitecto: null, estilo: null, material: null,
                        altura: null, superficie: null, inception: null,
                        heritage_label: match.heritage || null,
                        wikipedia_url: null,
                        commons_category: match.commons || null,
                        sipca_code: null, raw_json: null,
                    });
                }
                nuevosMatches++;
            }
        }

        console.log(`  Nuevos matches: ${nuevosMatches}\n`);
        totalNuevosMatches += nuevosMatches;
    }

    // Estadisticas finales
    const conQidFinal = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL')).rows[0].n;
    const totalBienes = (await db.query('SELECT COUNT(*) as n FROM bienes')).rows[0].n;

    console.log(`\n=== RESULTADO ===`);
    console.log(`Nuevos matches totales: ${totalNuevosMatches}`);
    console.log(`Total con QID: ${conQidFinal}/${totalBienes} (${(100*conQidFinal/totalBienes).toFixed(1)}%)`);

    await db.cerrar();
}

async function descargarWikidataRegion(region) {
    const config = REGIONES[region];
    const items = [];

    for (const qid of config.qids) {
        // Query amplia para heritage items
        const query = `
SELECT DISTINCT ?item ?itemLabel ?municipioLabel ?image ?heritageLabel ?commonsCategory WHERE {
    {
        ?item wdt:P1435 ?heritage .
        ?item wdt:P131+ wd:${qid} .
    } UNION {
        ?item wdt:P1435 ?heritage .
        ?item wdt:P131 ?loc .
        ?loc wdt:P131 wd:${qid} .
    } UNION {
        ?item wdt:P1435 ?heritage .
        ?item wdt:P131 ?loc .
        ?loc wdt:P131/wdt:P131 wd:${qid} .
    }
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P131 ?municipio }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "${config.langs}".
        ?item rdfs:label ?itemLabel.
        ?heritage rdfs:label ?heritageLabel.
        ?municipio rdfs:label ?municipioLabel.
    }
}
LIMIT 50000
`;

        try {
            const res = await axios.get(WIKIDATA_SPARQL, {
                params: { query, format: 'json' },
                headers: HEADERS,
                timeout: 180000,
            });

            for (const r of res.data.results.bindings) {
                const itemQid = r.item?.value?.split('/').pop();
                if (!itemQid) continue;

                items.push({
                    qid: itemQid,
                    label: r.itemLabel?.value || '',
                    municipio: r.municipioLabel?.value || null,
                    image: r.image?.value || null,
                    heritage: r.heritageLabel?.value || null,
                    commons: r.commonsCategory?.value || null,
                });
            }
        } catch (err) {
            console.error(`  Error en query ${qid}: ${err.message}`);
        }

        await sleep(DELAY_MS);
    }

    // Deduplicar por QID
    const byQid = new Map();
    for (const item of items) {
        if (!byQid.has(item.qid)) {
            byQid.set(item.qid, item);
        }
    }

    return [...byQid.values()];
}

function buscarMejorMatch(item, indexExacto, indexNorm, indexPalabras) {
    const nombreOrig = item.denominacion.toLowerCase();
    const nombreNorm = normalizarNombre(item.denominacion);
    const muniNorm = item.municipio ? normalizarNombre(item.municipio) : null;

    // 1. Match exacto (lowercase)
    let candidates = indexExacto.get(nombreOrig);
    if (candidates && candidates.length === 1) return candidates[0];
    if (candidates && muniNorm) {
        const found = candidates.find(c => c.municipio && normalizarNombre(c.municipio) === muniNorm);
        if (found) return found;
    }

    // 2. Match normalizado
    candidates = indexNorm.get(nombreNorm);
    if (candidates && candidates.length === 1) return candidates[0];
    if (candidates && muniNorm) {
        const found = candidates.find(c => c.municipio && normalizarNombre(c.municipio) === muniNorm);
        if (found) return found;
    }

    // 3. Match por palabras significativas
    const palabras = extraerPalabrasSignificativas(item.denominacion);
    if (palabras.length >= 2) {
        const candidatosCount = new Map();

        for (const palabra of palabras) {
            if (palabra.length < 4) continue;
            const matches = indexPalabras.get(palabra) || [];
            for (const match of matches) {
                const count = candidatosCount.get(match.qid) || 0;
                candidatosCount.set(match.qid, count + 1);
            }
        }

        // Encontrar el que tiene mas palabras en comun
        let mejorMatch = null;
        let mejorCount = 0;

        for (const [qid, count] of candidatosCount) {
            if (count > mejorCount && count >= 2) {
                const candidato = [...indexNorm.values()].flat().find(c => c.qid === qid);
                if (candidato) {
                    // Verificar municipio si existe
                    if (muniNorm && candidato.municipio) {
                        if (normalizarNombre(candidato.municipio) === muniNorm) {
                            mejorMatch = candidato;
                            mejorCount = count;
                        }
                    } else if (count >= 3) {
                        mejorMatch = candidato;
                        mejorCount = count;
                    }
                }
            }
        }

        if (mejorMatch) return mejorMatch;
    }

    // 4. Fuzzy matching con Levenshtein (solo para nombres cortos)
    if (nombreNorm.length >= 5 && nombreNorm.length <= 50) {
        let mejorMatch = null;
        let mejorDistancia = 4; // max 3 ediciones

        for (const [key, candidates] of indexNorm) {
            if (Math.abs(key.length - nombreNorm.length) > 3) continue;
            const dist = levenshtein(nombreNorm, key);
            if (dist < mejorDistancia) {
                if (candidates.length === 1) {
                    mejorMatch = candidates[0];
                    mejorDistancia = dist;
                } else if (muniNorm) {
                    const found = candidates.find(c => c.municipio && normalizarNombre(c.municipio) === muniNorm);
                    if (found) {
                        mejorMatch = found;
                        mejorDistancia = dist;
                    }
                }
            }
        }

        if (mejorMatch) return mejorMatch;
    }

    return null;
}

function normalizarNombre(texto) {
    if (!texto) return '';
    let norm = removeAccents(texto.toLowerCase());

    // Eliminar prefijos comunes
    for (const prefijo of PREFIJOS) {
        if (norm.startsWith(prefijo)) {
            norm = norm.substring(prefijo.length);
            break;
        }
    }

    // Eliminar caracteres especiales y espacios extra
    return norm.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extraerPalabrasSignificativas(texto) {
    if (!texto) return [];
    const norm = removeAccents(texto.toLowerCase());
    const palabras = norm.split(/[^a-z]+/).filter(p => p.length >= 3);

    // Eliminar palabras comunes
    const stopwords = new Set([
        'del', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
        'que', 'con', 'por', 'para', 'sobre', 'entre', 'hasta', 'desde',
        'san', 'sant', 'santa', 'santo', 'nuestra', 'nuestro', 'senora', 'senor',
        'iglesia', 'ermita', 'capilla', 'parroquia', 'basilica', 'catedral',
        'castillo', 'torre', 'palacio', 'casa', 'convento', 'monasterio',
        'puente', 'fuente', 'conjunto', 'centro', 'historico', 'artistico',
        'antiguo', 'viejo', 'nuevo', 'mayor', 'menor', 'grande', 'chico',
    ]);

    return palabras.filter(p => !stopwords.has(p));
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

ejecutar().catch(async err => {
    console.error('Error:', err.message);
    await db.cerrar();
    process.exit(1);
});
