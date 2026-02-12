/**
 * mejorar_matching.cjs
 * Mejora el matching de Wikidata para España y Francia.
 *
 * Francia: matching por código Mérimée (P380) - matching directo y fiable.
 * España: matching por coordenadas + matching textual mejorado.
 *
 * Uso:
 *   node mejorar_matching.cjs                    # Todo (dry run)
 *   node mejorar_matching.cjs --actualizar       # Aplicar cambios
 *   node mejorar_matching.cjs --pais Francia     # Solo Francia
 *   node mejorar_matching.cjs --pais España      # Solo España
 */

const axios = require('axios');
const removeAccents = require('remove-accents');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'Accept': 'application/sparql-results+json',
    'User-Agent': 'PatrimonioEuropeoBot/1.0 (heritage matching improvement)',
};
const DELAY_MS = 2000;
const MAX_RETRIES = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizarTexto(texto) {
    if (!texto) return '';
    return removeAccents(texto.toLowerCase()).replace(/[^a-z0-9 ]/g, '').trim();
}

async function sparqlQuery(query, retries = MAX_RETRIES) {
    for (let i = 1; i <= retries; i++) {
        try {
            const res = await axios.get(WIKIDATA_SPARQL, {
                params: { query, format: 'json' },
                headers: HEADERS,
                timeout: 180000,
            });
            return res.data.results.bindings;
        } catch (err) {
            const backoff = Math.min(5000 * Math.pow(2, i - 1), 120000);
            const isRetryable = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
                err.code === 'ECONNABORTED' || (err.response && err.response.status >= 429);
            if (isRetryable && i < retries) {
                console.log(`  SPARQL error (${err.response?.status || err.code}), retry ${i}/${retries} en ${backoff/1000}s...`);
                await sleep(backoff);
                continue;
            }
            throw err;
        }
    }
}

// ============================================================
// FRANCIA: Matching por código Mérimée (P380)
// ============================================================
async function matchFranciaMerimee(actualizar) {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║  FRANCIA: Matching por Mérimée (P380)    ║');
    console.log('╚══════════════════════════════════════════╝\n');

    // Obtener items franceses sin QID
    const sinQid = (await db.query(`
        SELECT b.id, b.codigo_fuente, b.denominacion, b.municipio, b.provincia
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.pais = ? AND (w.qid IS NULL OR w.id IS NULL)
    `, ['Francia'])).rows;

    console.log(`Items franceses sin QID: ${sinQid.length}`);
    if (sinQid.length === 0) return 0;

    // Crear index por codigo_fuente (Mérimée)
    const porMerimee = new Map();
    for (const item of sinQid) {
        if (item.codigo_fuente) {
            porMerimee.set(item.codigo_fuente, item);
        }
    }
    console.log(`Con código Mérimée: ${porMerimee.size}`);

    // Descargar TODOS los items con P380 de Wikidata (en lotes por offset)
    console.log('\nDescargando items con P380 de Wikidata...');
    const wikidataItems = new Map();
    let offset = 0;
    const BATCH = 10000;

    while (true) {
        const query = `
SELECT ?item ?merimee ?itemLabel ?image ?commonsCategory ?heritageLabel WHERE {
    ?item wdt:P380 ?merimee .
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P1435 ?heritage }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "fr,es,en".
        ?item rdfs:label ?itemLabel.
        ?heritage rdfs:label ?heritageLabel.
    }
}
LIMIT ${BATCH} OFFSET ${offset}
`;
        process.stdout.write(`  Descargando offset ${offset}...`);
        try {
            const results = await sparqlQuery(query);
            if (!results || results.length === 0) {
                console.log(' fin.');
                break;
            }
            for (const r of results) {
                const qid = r.item?.value?.split('/').pop();
                const merimee = r.merimee?.value;
                if (qid && merimee && !wikidataItems.has(merimee)) {
                    wikidataItems.set(merimee, {
                        qid,
                        label: r.itemLabel?.value || '',
                        image: r.image?.value || null,
                        commons: r.commonsCategory?.value || null,
                        heritage: r.heritageLabel?.value || null,
                    });
                }
            }
            console.log(` ${results.length} resultados (total: ${wikidataItems.size})`);
            if (results.length < BATCH) break;
            offset += BATCH;
            await sleep(DELAY_MS);
        } catch (err) {
            console.log(` Error: ${err.message}`);
            break;
        }
    }

    console.log(`\nTotal items Wikidata con P380: ${wikidataItems.size}`);

    // Matching
    let matched = 0;
    let noMatch = 0;

    for (const [merimee, item] of porMerimee) {
        const wdItem = wikidataItems.get(merimee);
        if (wdItem) {
            matched++;
            if (actualizar) {
                // Verificar si ya tiene entrada wikidata
                const existing = (await db.query(
                    'SELECT id FROM wikidata WHERE bien_id = ?', [item.id]
                )).rows[0];

                if (existing) {
                    await db.query('UPDATE wikidata SET qid = ?, imagen_url = COALESCE(imagen_url, ?), heritage_label = COALESCE(heritage_label, ?), commons_category = COALESCE(commons_category, ?) WHERE id = ?',
                        [wdItem.qid, wdItem.image, wdItem.heritage, wdItem.commons, existing.id]);
                } else {
                    await db.insertarWikidata({
                        bien_id: item.id,
                        qid: wdItem.qid,
                        descripcion: null,
                        imagen_url: wdItem.image || null,
                        arquitecto: null, estilo: null, material: null,
                        altura: null, superficie: null, inception: null,
                        heritage_label: wdItem.heritage || null,
                        wikipedia_url: null,
                        commons_category: wdItem.commons || null,
                        sipca_code: null, raw_json: null,
                    });
                }
                if (wdItem.image) {
                    await db.insertarImagen({
                        bien_id: item.id,
                        url: wdItem.image,
                        titulo: item.denominacion,
                        autor: null,
                        fuente: 'wikidata',
                    });
                }
            }
        } else {
            noMatch++;
        }
    }

    console.log(`\nResultado Francia Mérimée:`);
    console.log(`  Matched: ${matched}`);
    console.log(`  Sin match: ${noMatch}`);
    return matched;
}

// ============================================================
// ESPAÑA: Matching mejorado por coordenadas + texto
// ============================================================
async function matchEspana(actualizar) {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║  ESPAÑA: Matching mejorado               ║');
    console.log('╚══════════════════════════════════════════╝\n');

    // Las CCAA con más items sin QID
    const ccaaConfig = {
        'Andalucia':            { qid: 'Q5783',   hops: 2 },
        'Catalunya':            { qid: 'Q5765',   hops: 2 }, // Catalunya CCAA (no Barcelona provincia)
        'Comunidad de Madrid':  { qid: 'Q5756',   hops: 2 },
        'Castilla-La Mancha':   { qid: 'Q5765',   hops: 2 },
        'Aragon':               { qid: 'Q4040',   hops: 2 },
        'Comunitat Valenciana': { qid: 'Q5720',   hops: 2 },
    };

    // Corregir QIDs
    ccaaConfig['Catalunya'] = { qid: 'Q5765', hops: 2 }; // CCAA
    ccaaConfig['Castilla-La Mancha'] = { qid: 'Q5765', hops: 2 };

    // Obtener items españoles sin QID que tienen coordenadas
    const sinQid = (await db.query(`
        SELECT b.id, b.denominacion, b.municipio, b.provincia,
               b.comunidad_autonoma, b.latitud, b.longitud, b.codigo_fuente
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.pais = ? AND (w.qid IS NULL OR w.id IS NULL)
        ORDER BY b.comunidad_autonoma
    `, ['España'])).rows;

    console.log(`Items españoles sin QID: ${sinQid.length}`);

    // Descargar heritage items de Wikidata para toda España
    console.log('\nDescargando heritage items de España desde Wikidata...');
    const wikidataItems = new Map();

    // Query amplia: todos los heritage items en España
    const queries = [
        // 3 saltos P131 (captura más items)
        `SELECT ?item ?itemLabel ?municipioLabel ?image ?coord ?heritageLabel ?commonsCategory WHERE {
            ?item wdt:P1435 ?heritage .
            ?item wdt:P17 wd:Q29 .
            OPTIONAL { ?item wdt:P18 ?image }
            OPTIONAL { ?item wdt:P625 ?coord }
            OPTIONAL { ?item wdt:P373 ?commonsCategory }
            OPTIONAL { ?item wdt:P131 ?municipio }
            SERVICE wikibase:label {
                bd:serviceParam wikibase:language "es,ca,eu,gl,en".
                ?item rdfs:label ?itemLabel.
                ?heritage rdfs:label ?heritageLabel.
                ?municipio rdfs:label ?municipioLabel.
            }
        }`,
    ];

    for (let qi = 0; qi < queries.length; qi++) {
        process.stdout.write(`  Query ${qi + 1}/${queries.length}...`);
        try {
            const results = await sparqlQuery(queries[qi]);
            for (const r of results) {
                const qid = r.item?.value?.split('/').pop();
                if (!qid || wikidataItems.has(qid)) continue;

                let lat = null, lon = null;
                if (r.coord?.value) {
                    const m = r.coord.value.match(/Point\(([^ ]+) ([^ ]+)\)/);
                    if (m) { lon = parseFloat(m[1]); lat = parseFloat(m[2]); }
                }

                wikidataItems.set(qid, {
                    qid,
                    label: r.itemLabel?.value || '',
                    municipio: r.municipioLabel?.value || null,
                    image: r.image?.value || null,
                    heritage: r.heritageLabel?.value || null,
                    commons: r.commonsCategory?.value || null,
                    lat, lon,
                });
            }
            console.log(` ${results.length} resultados (total únicos: ${wikidataItems.size})`);
        } catch (err) {
            console.log(` Error: ${err.message}`);
        }
        await sleep(DELAY_MS);
    }

    // Excluir QIDs ya usados
    const qidsUsados = new Set(
        (await db.query('SELECT qid FROM wikidata WHERE qid IS NOT NULL')).rows.map(r => r.qid)
    );
    const disponibles = new Map();
    for (const [qid, item] of wikidataItems) {
        if (!qidsUsados.has(qid)) disponibles.set(qid, item);
    }
    console.log(`Items Wikidata disponibles (no usados): ${disponibles.size}`);

    // Indexar por nombre normalizado y por municipio+nombre
    const indexNombre = new Map();
    const indexMuniNombre = new Map();
    const indexCoords = []; // para matching por coordenadas

    for (const [qid, item] of disponibles) {
        const nombre = normalizarTexto(item.label);
        if (nombre) {
            if (!indexNombre.has(nombre)) indexNombre.set(nombre, []);
            indexNombre.get(nombre).push(item);
        }
        if (item.municipio) {
            const key = normalizarTexto(item.municipio) + '|' + nombre;
            if (!indexMuniNombre.has(key)) indexMuniNombre.set(key, []);
            indexMuniNombre.get(key).push(item);
        }
        if (item.lat && item.lon) {
            indexCoords.push(item);
        }
    }

    // Matching mejorado
    let matched = 0;
    let matchedByName = 0;
    let matchedByCoords = 0;
    let noMatch = 0;
    const usedQids = new Set();

    for (const item of sinQid) {
        const nombreNorm = normalizarTexto(item.denominacion);
        const muniNorm = item.municipio ? normalizarTexto(item.municipio) : null;
        let match = null;

        // 1. Municipio+nombre exacto
        if (muniNorm) {
            const key = muniNorm + '|' + nombreNorm;
            const candidates = indexMuniNombre.get(key);
            if (candidates) {
                match = candidates.find(c => !usedQids.has(c.qid));
            }
        }

        // 2. Nombre exacto (único o con municipio)
        if (!match) {
            const candidates = indexNombre.get(nombreNorm);
            if (candidates) {
                const unused = candidates.filter(c => !usedQids.has(c.qid));
                if (unused.length === 1) {
                    match = unused[0];
                } else if (muniNorm && unused.length > 0) {
                    match = unused.find(c => c.municipio && normalizarTexto(c.municipio) === muniNorm);
                }
            }
        }

        // 3. Matching parcial con municipio (prefijos/sufijos comunes)
        if (!match && muniNorm && nombreNorm.length >= 6) {
            for (const [key, items] of indexNombre) {
                if (key.length < 6) continue;
                if (key.includes(nombreNorm) || nombreNorm.includes(key)) {
                    const found = items.find(c => !usedQids.has(c.qid) && c.municipio && normalizarTexto(c.municipio) === muniNorm);
                    if (found) { match = found; break; }
                }
            }
        }

        // 4. Matching por variaciones comunes del nombre
        if (!match && muniNorm) {
            const variaciones = generarVariaciones(nombreNorm, muniNorm);
            for (const v of variaciones) {
                const candidates = indexNombre.get(v);
                if (candidates) {
                    const found = candidates.find(c => !usedQids.has(c.qid) && c.municipio && normalizarTexto(c.municipio) === muniNorm);
                    if (found) { match = found; break; }
                }
            }
        }

        // 5. Matching por coordenadas (radio de 100m) + nombre similar
        if (!match && item.latitud && item.longitud && nombreNorm.length >= 5) {
            const RADIO_KM = 0.1; // 100 metros
            for (const wd of indexCoords) {
                if (usedQids.has(wd.qid)) continue;
                const dist = haversine(item.latitud, item.longitud, wd.lat, wd.lon);
                if (dist <= RADIO_KM) {
                    const wdNorm = normalizarTexto(wd.label);
                    // Verificar similitud de nombre (al menos una palabra significativa en comun)
                    if (tienenPalabraEnComun(nombreNorm, wdNorm)) {
                        match = wd;
                        matchedByCoords++;
                        break;
                    }
                }
            }
        }

        if (match) {
            usedQids.add(match.qid);
            matched++;
            if (!matchedByCoords || match !== null) matchedByName++;

            if (actualizar) {
                const existing = (await db.query(
                    'SELECT id FROM wikidata WHERE bien_id = ?', [item.id]
                )).rows[0];

                if (existing) {
                    await db.query('UPDATE wikidata SET qid = ?, imagen_url = COALESCE(imagen_url, ?), heritage_label = COALESCE(heritage_label, ?), commons_category = COALESCE(commons_category, ?) WHERE id = ?',
                        [match.qid, match.image, match.heritage, match.commons, existing.id]);
                } else {
                    await db.insertarWikidata({
                        bien_id: item.id, qid: match.qid,
                        descripcion: null, imagen_url: match.image || null,
                        arquitecto: null, estilo: null, material: null,
                        altura: null, superficie: null, inception: null,
                        heritage_label: match.heritage || null,
                        wikipedia_url: null, commons_category: match.commons || null,
                        sipca_code: null, raw_json: null,
                    });
                }
                if (match.image) {
                    await db.insertarImagen({
                        bien_id: item.id, url: match.image,
                        titulo: item.denominacion, autor: null, fuente: 'wikidata',
                    });
                }
            }
        } else {
            noMatch++;
        }
    }

    console.log(`\nResultado España:`);
    console.log(`  Matched total: ${matched}`);
    console.log(`    Por nombre: ${matchedByName - matchedByCoords}`);
    console.log(`    Por coordenadas: ${matchedByCoords}`);
    console.log(`  Sin match: ${noMatch}`);
    return matched;
}

// ============================================================
// FRANCIA: Matching adicional por nombre para ítems sin Mérimée en Wikidata
// ============================================================
async function matchFranciaNombre(actualizar) {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║  FRANCIA: Matching por nombre + coordenadas  ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    // Items franceses que siguen sin QID después del Mérimée match
    const sinQid = (await db.query(`
        SELECT b.id, b.denominacion, b.municipio, b.provincia, b.latitud, b.longitud, b.codigo_fuente
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.pais = ? AND (w.qid IS NULL OR w.id IS NULL)
    `, ['Francia'])).rows;

    if (sinQid.length === 0) {
        console.log('No quedan items franceses sin QID.');
        return 0;
    }

    console.log(`Items franceses sin QID tras Mérimée: ${sinQid.length}`);

    // Descargar heritage items de Francia desde Wikidata (sin P380)
    console.log('Descargando heritage items de Francia desde Wikidata...');
    const wikidataItems = new Map();

    const query = `
SELECT ?item ?itemLabel ?municipioLabel ?image ?coord ?heritageLabel ?commonsCategory ?merimee WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P17 wd:Q142 .
    FILTER NOT EXISTS { ?item wdt:P380 ?merimee }
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P625 ?coord }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P131 ?municipio }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "fr,es,en".
        ?item rdfs:label ?itemLabel.
        ?heritage rdfs:label ?heritageLabel.
        ?municipio rdfs:label ?municipioLabel.
    }
}`;

    try {
        process.stdout.write('  Descargando...');
        const results = await sparqlQuery(query);
        for (const r of results) {
            const qid = r.item?.value?.split('/').pop();
            if (!qid || wikidataItems.has(qid)) continue;
            let lat = null, lon = null;
            if (r.coord?.value) {
                const m = r.coord.value.match(/Point\(([^ ]+) ([^ ]+)\)/);
                if (m) { lon = parseFloat(m[1]); lat = parseFloat(m[2]); }
            }
            wikidataItems.set(qid, {
                qid,
                label: r.itemLabel?.value || '',
                municipio: r.municipioLabel?.value || null,
                image: r.image?.value || null,
                heritage: r.heritageLabel?.value || null,
                commons: r.commonsCategory?.value || null,
                lat, lon,
            });
        }
        console.log(` ${wikidataItems.size} items`);
    } catch (err) {
        console.log(` Error: ${err.message}`);
        return 0;
    }

    // Excluir QIDs ya usados
    const qidsUsados = new Set(
        (await db.query('SELECT qid FROM wikidata WHERE qid IS NOT NULL')).rows.map(r => r.qid)
    );

    const indexNombre = new Map();
    const indexCoords = [];
    for (const [qid, item] of wikidataItems) {
        if (qidsUsados.has(qid)) continue;
        const nombre = normalizarTexto(item.label);
        if (nombre) {
            if (!indexNombre.has(nombre)) indexNombre.set(nombre, []);
            indexNombre.get(nombre).push(item);
        }
        if (item.lat && item.lon) indexCoords.push(item);
    }

    let matched = 0;
    const usedQids = new Set();

    for (const item of sinQid) {
        const nombreNorm = normalizarTexto(item.denominacion);
        const muniNorm = item.municipio ? normalizarTexto(item.municipio) : null;
        let match = null;

        // Match por municipio+nombre
        if (muniNorm && nombreNorm) {
            const candidates = indexNombre.get(nombreNorm);
            if (candidates) {
                match = candidates.find(c => !usedQids.has(c.qid) && c.municipio && normalizarTexto(c.municipio) === muniNorm);
                if (!match && candidates.length === 1 && !usedQids.has(candidates[0].qid)) {
                    match = candidates[0];
                }
            }
        }

        // Match por coordenadas + nombre
        if (!match && item.latitud && item.longitud && nombreNorm.length >= 5) {
            for (const wd of indexCoords) {
                if (usedQids.has(wd.qid)) continue;
                const dist = haversine(item.latitud, item.longitud, wd.lat, wd.lon);
                if (dist <= 0.1 && tienenPalabraEnComun(nombreNorm, normalizarTexto(wd.label))) {
                    match = wd;
                    break;
                }
            }
        }

        if (match) {
            usedQids.add(match.qid);
            matched++;
            if (actualizar) {
                const existing = (await db.query('SELECT id FROM wikidata WHERE bien_id = ?', [item.id])).rows[0];
                if (existing) {
                    await db.query('UPDATE wikidata SET qid = ?, imagen_url = COALESCE(imagen_url, ?), heritage_label = COALESCE(heritage_label, ?), commons_category = COALESCE(commons_category, ?) WHERE id = ?',
                        [match.qid, match.image, match.heritage, match.commons, existing.id]);
                } else {
                    await db.insertarWikidata({
                        bien_id: item.id, qid: match.qid, descripcion: null,
                        imagen_url: match.image || null, arquitecto: null, estilo: null,
                        material: null, altura: null, superficie: null, inception: null,
                        heritage_label: match.heritage || null, wikipedia_url: null,
                        commons_category: match.commons || null, sipca_code: null, raw_json: null,
                    });
                }
            }
        }
    }

    console.log(`\nResultado Francia nombre+coords: ${matched} matched`);
    return matched;
}

// ============================================================
// Utilidades
// ============================================================

function generarVariaciones(nombre, municipio) {
    const variaciones = [];

    // "Iglesia de San Pedro" <-> "Iglesia parroquial de San Pedro"
    const prefijos = [
        ['iglesia', 'iglesia parroquial'],
        ['iglesia parroquial', 'iglesia'],
        ['ermita', 'capilla'],
        ['capilla', 'ermita'],
        ['castillo', 'castillo de'],
        ['torre', 'torre de'],
        ['puente', 'puente de'],
        ['palacio', 'palacio de'],
        ['convento', 'convento de'],
        ['monasterio', 'monasterio de'],
    ];

    for (const [a, b] of prefijos) {
        if (nombre.startsWith(a + ' ')) {
            variaciones.push(b + ' ' + nombre.slice(a.length + 1));
        }
    }

    // "Castillo" -> "Castillo de Municipio"
    const genericos = ['castillo', 'iglesia', 'ermita', 'torre', 'puente', 'palacio', 'convento', 'catedral', 'muralla'];
    if (genericos.includes(nombre) && municipio) {
        variaciones.push(nombre + ' de ' + municipio);
    }

    // "Iglesia de San Pedro de Municipio" -> "Iglesia de San Pedro"
    if (municipio && nombre.endsWith(' de ' + municipio)) {
        variaciones.push(nombre.slice(0, -((' de ' + municipio).length)));
    }
    if (municipio && nombre.endsWith(' ' + municipio)) {
        variaciones.push(nombre.slice(0, -((' ' + municipio).length)));
    }

    return variaciones;
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function tienenPalabraEnComun(a, b) {
    const stopWords = new Set(['de', 'del', 'la', 'el', 'las', 'los', 'le', 'les', 'du', 'des', 'en', 'a', 'y', 'e', 'i', 'o', 'un', 'una', 'di', 'da']);
    const wordsA = a.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w)));
    return wordsA.some(w => wordsB.has(w));
}

// ============================================================
// Main
// ============================================================
async function main() {
    const args = process.argv.slice(2);
    const actualizar = args.includes('--actualizar');
    const paisIdx = args.indexOf('--pais');
    const paisArg = paisIdx !== -1 ? args[paisIdx + 1] : null;

    console.log('=== Mejora de Matching Wikidata ===');
    console.log(`Mode: ${actualizar ? 'ACTUALIZAR DB' : 'DRY RUN (simulación)'}`);
    if (paisArg) console.log(`País: ${paisArg}`);

    // Stats iniciales
    const before = (await db.query('SELECT b.pais, COUNT(w.qid) as con_qid FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id GROUP BY b.pais ORDER BY b.pais')).rows;
    console.log('\nEstado inicial:');
    for (const r of before) console.log(`  ${r.pais}: ${r.con_qid} con QID`);

    let totalMatched = 0;

    if (!paisArg || paisArg === 'Francia') {
        totalMatched += await matchFranciaMerimee(actualizar);
        totalMatched += await matchFranciaNombre(actualizar);
    }

    if (!paisArg || paisArg === 'España') {
        totalMatched += await matchEspana(actualizar);
    }

    // Stats finales
    const after = (await db.query('SELECT b.pais, COUNT(w.qid) as con_qid FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id GROUP BY b.pais ORDER BY b.pais')).rows;
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║         RESULTADO FINAL              ║');
    console.log('╠══════════════════════════════════════╣');
    for (const r of after) {
        const prev = before.find(b => b.pais === r.pais);
        const diff = parseInt(r.con_qid) - parseInt(prev?.con_qid || 0);
        console.log(`║ ${r.pais.padEnd(10)} ${String(r.con_qid).padStart(7)} con QID ${diff > 0 ? `(+${diff})` : ''}`);
    }
    console.log('╚══════════════════════════════════════╝');
    console.log(`\nTotal nuevos matches: ${totalMatched}`);

    if (!actualizar && totalMatched > 0) {
        console.log(`\nPara aplicar: node mejorar_matching.cjs --actualizar`);
    }

    await db.cerrar();
}

main().catch(async err => {
    console.error('Error:', err.message);
    await db.cerrar();
    process.exit(1);
});
