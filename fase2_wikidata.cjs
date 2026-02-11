const axios = require('axios');
const removeAccents = require('remove-accents');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = { Accept: 'application/sparql-results+json', 'User-Agent': 'PatrimonioEuropeoBot/1.0 (heritage data enrichment)' };
const DELAY_MS = 2000;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 120000;
const CONSECUTIVE_FAIL_PAUSE_MS = 60000; // pausa larga tras 5 fallos seguidos
const CONSECUTIVE_FAIL_THRESHOLD = 5;

// Configuracion por region
// tipo: 'ccaa' = comunidad autonoma (2 saltos P131: municipio->provincia->CCAA)
// tipo: 'provincia' = provincia (1 salto P131: municipio->provincia)
const REGIONES = {
    // España
    'Aragon':               { qid: 'Q4040',  langs: 'es,en,ca', tipo: 'ccaa', sipca: true, pais: 'España' },
    'Andalucia':            { qid: 'Q5783',  langs: 'es,en',    tipo: 'ccaa', sipca: false, pais: 'España' },
    'Catalunya':            { qid: 'Q81949', langs: 'es,ca,en', tipo: 'provincia', sipca: false, pais: 'España' },
    'Comunitat Valenciana': { qid: 'Q5720',  langs: 'es,ca,en', tipo: 'ccaa', sipca: false, pais: 'España' },

    // Portugal - por distritos principales
    'Lisboa':              { qid: 'Q80931',  langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Porto':               { qid: 'Q36433',  langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Braga':               { qid: 'Q45424',  langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Setúbal':             { qid: 'Q208148', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Aveiro':              { qid: 'Q193513', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Faro':                { qid: 'Q180874', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Leiria':              { qid: 'Q189507', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Coimbra':             { qid: 'Q193074', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Santarém':            { qid: 'Q190740', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Viseu':               { qid: 'Q193458', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Évora':               { qid: 'Q208250', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Guarda':              { qid: 'Q203204', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Beja':                { qid: 'Q203166', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Bragança':            { qid: 'Q189580', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Vila Real':           { qid: 'Q189559', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Viana do Castelo':    { qid: 'Q203283', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Castelo Branco':      { qid: 'Q190103', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },
    'Portalegre':          { qid: 'Q201439', langs: 'pt,es,en', tipo: 'provincia', sipca: false, pais: 'Portugal' },

    // Francia - por regiones
    'Île-de-France':              { qid: 'Q13917',  langs: 'fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Nouvelle-Aquitaine':         { qid: 'Q18678082', langs: 'fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Auvergne-Rhône-Alpes':       { qid: 'Q18338206', langs: 'fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Occitanie':                  { qid: 'Q18678265', langs: 'fr,oc,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Grand Est':                  { qid: 'Q18677983', langs: 'fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Hauts-de-France':            { qid: 'Q18677767', langs: 'fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Bretagne':                   { qid: 'Q12549',  langs: 'fr,br,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Bourgogne-Franche-Comté':    { qid: 'Q18578267', langs: 'fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Normandie':                  { qid: 'Q18677875', langs: 'fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Pays de la Loire':           { qid: 'Q16748',  langs: 'fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Centre-Val de Loire':        { qid: 'Q13947',  langs: 'fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Provence-Alpes-Côte d\'Azur': { qid: 'Q15104',  langs: 'fr,oc,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },
    'Corse':                      { qid: 'Q14112',  langs: 'fr,co,es,en', tipo: 'ccaa', sipca: false, pais: 'Francia' },

    // Italia - por regioni
    'Abruzzo':                    { qid: 'Q1284',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Basilicata':                 { qid: 'Q1452',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Calabria':                   { qid: 'Q1458',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Campania':                   { qid: 'Q1438',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Emilia-Romagna':             { qid: 'Q1263',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Friuli-Venezia Giulia':      { qid: 'Q1250',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Lazio':                      { qid: 'Q1282',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Liguria':                    { qid: 'Q1256',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Lombardia':                  { qid: 'Q1210',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Marche':                     { qid: 'Q1279',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Molise':                     { qid: 'Q1443',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Piemonte':                   { qid: 'Q1216',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Puglia':                     { qid: 'Q1447',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Sardegna':                   { qid: 'Q1462',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Sicilia':                    { qid: 'Q1460',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Toscana':                    { qid: 'Q1273',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Trentino-Alto Adige':        { qid: 'Q1237',  langs: 'it,de,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Umbria':                     { qid: 'Q1280',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    "Valle d'Aosta":              { qid: 'Q1222',  langs: 'it,fr,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
    'Veneto':                     { qid: 'Q1243',  langs: 'it,es,en', tipo: 'ccaa', sipca: false, pais: 'Italia' },
};

async function ejecutar() {
    // Parsear argumentos --region y --pais
    const args = process.argv.slice(2);
    const regionIdx = args.indexOf('--region');
    const regionArg = regionIdx !== -1 ? args[regionIdx + 1] : null;
    const paisIdx = args.indexOf('--pais');
    const paisArg = paisIdx !== -1 ? args[paisIdx + 1] : null;

    let regionesAProcesar;
    if (regionArg) {
        regionesAProcesar = [regionArg];
    } else if (paisArg) {
        // Filtrar regiones por país
        regionesAProcesar = Object.keys(REGIONES).filter(r => REGIONES[r].pais === paisArg);
        if (regionesAProcesar.length === 0) {
            console.error(`No hay regiones configuradas para el país: ${paisArg}`);
            console.error(`Países disponibles: ${[...new Set(Object.values(REGIONES).map(r => r.pais))].join(', ')}`);
            process.exit(1);
        }
    } else {
        regionesAProcesar = Object.keys(REGIONES);
    }

    // Validar
    for (const r of regionesAProcesar) {
        if (!REGIONES[r]) {
            console.error(`Region desconocida: ${r}`);
            console.error(`Regiones disponibles: ${Object.keys(REGIONES).join(', ')}`);
            process.exit(1);
        }
    }

    console.log('=== FASE 2: Enriquecimiento con Wikidata ===\n');
    console.log(`Regiones a procesar: ${regionesAProcesar.join(', ')}\n`);

    let totalMatched = 0;
    let totalNoMatch = 0;
    let totalEnriched = 0;

    for (const regionNombre of regionesAProcesar) {
        const config = REGIONES[regionNombre];
        console.log(`--- Region: ${regionNombre} (${config.qid}) ---\n`);

        // Paso 1: Descarga masiva desde Wikidata
        console.log(`Paso 1: Descargando bienes patrimoniales de ${regionNombre} desde Wikidata...`);
        const wikidataItems = await descargarItemsRegion(regionNombre, config);
        console.log(`  Obtenidos ${wikidataItems.size} items unicos de Wikidata.\n`);

        // Paso 2: Matching con la BD local
        console.log('Paso 2: Cruzando con la base de datos local...');
        const bienes = await db.obtenerSinWikidataPorRegion(regionNombre);
        console.log(`  Bienes pendientes de ${regionNombre}: ${bienes.length}`);

        if (bienes.length === 0) {
            console.log(`  No hay bienes pendientes para ${regionNombre}, saltando.\n`);
            continue;
        }

        // Indexar Wikidata por nombre normalizado y por municipio+nombre
        const indexNombre = new Map();
        const indexMuniNombre = new Map();
        for (const [qid, item] of wikidataItems) {
            const nombre = normalizarTexto(item.label);
            if (!indexNombre.has(nombre)) indexNombre.set(nombre, []);
            indexNombre.get(nombre).push(item);

            if (item.municipio) {
                const key = normalizarTexto(item.municipio) + '|' + nombre;
                if (!indexMuniNombre.has(key)) indexMuniNombre.set(key, []);
                indexMuniNombre.get(key).push(item);
            }
        }

        let matched = 0;
        let noMatch = 0;

        for (const bien of bienes) {
            const nombreNorm = normalizarTexto(bien.denominacion);
            const muniNorm = bien.municipio ? normalizarTexto(bien.municipio) : null;

            let match = buscarMatch(nombreNorm, muniNorm, indexNombre, indexMuniNombre);

            if (match) {
                await guardarWikidata(bien.id, match);
                matched++;
            } else {
                await db.insertarWikidata({
                    bien_id: bien.id,
                    qid: null, descripcion: null, imagen_url: null,
                    arquitecto: null, estilo: null, material: null,
                    altura: null, superficie: null, inception: null,
                    heritage_label: null, wikipedia_url: null,
                    commons_category: null, sipca_code: null, raw_json: null,
                });
                noMatch++;
            }
        }

        console.log(`  Matching completado: ${matched} matches, ${noMatch} sin match.\n`);
        totalMatched += matched;
        totalNoMatch += noMatch;

        // Paso 3: Enriquecer los que tienen QID con datos detallados
        console.log('Paso 3: Enriqueciendo con datos detallados por QID...');
        const conQid = (await db.query(`
            SELECT w.id, w.bien_id, w.qid, b.denominacion FROM wikidata w
            JOIN bienes b ON w.bien_id = b.id
            WHERE w.qid IS NOT NULL AND w.raw_json IS NULL AND b.comunidad_autonoma = ?
        `, [regionNombre])).rows;

        console.log(`  Items con QID pendientes: ${conQid.length}`);
        let enriched = 0;
        let consecutiveFails = 0;

        for (let i = 0; i < conQid.length; i++) {
            const w = conQid[i];
            console.log(`  [${i + 1}/${conQid.length}] ${w.denominacion} (${w.qid})...`);
            try {
                const detalle = await consultarPorQID(w.qid, config.langs);
                consecutiveFails = 0; // reset on success
                if (detalle) {
                    await db.query(`
                        UPDATE wikidata SET
                            descripcion = ?, imagen_url = ?, arquitecto = ?, estilo = ?,
                            material = ?, altura = ?, superficie = ?, inception = ?,
                            heritage_label = ?, wikipedia_url = ?, commons_category = ?,
                            sipca_code = ?, raw_json = ?
                        WHERE id = ?
                    `, [
                        detalle.descripcion, detalle.imagen_url, detalle.arquitecto, detalle.estilo,
                        detalle.material, detalle.altura, detalle.superficie, detalle.inception,
                        detalle.heritage_label, detalle.wikipedia_url, detalle.commons_category,
                        detalle.sipca_code, JSON.stringify(detalle.raw),
                        w.id
                    ]);

                    if (detalle.imagen_url) {
                        await db.insertarImagen({
                            bien_id: w.bien_id,
                            url: detalle.imagen_url,
                            titulo: w.denominacion,
                            autor: null,
                            fuente: 'wikidata',
                        });
                    }
                    enriched++;
                    console.log(`    -> OK${detalle.estilo ? ' estilo=' + detalle.estilo : ''}${detalle.imagen_url ? ' (con imagen)' : ''}`);
                }
            } catch (err) {
                consecutiveFails++;
                console.error(`    -> Error: ${err.message} (fallos seguidos: ${consecutiveFails})`);
                if (consecutiveFails >= CONSECUTIVE_FAIL_THRESHOLD) {
                    console.warn(`  *** ${consecutiveFails} fallos consecutivos — pausa larga de ${CONSECUTIVE_FAIL_PAUSE_MS / 1000}s para dejar respirar a Wikidata...`);
                    await sleep(CONSECUTIVE_FAIL_PAUSE_MS);
                    consecutiveFails = 0; // reset after long pause
                }
            }
            await sleep(DELAY_MS);
        }

        totalEnriched += enriched;
        console.log(`  ${regionNombre}: ${enriched} enriquecidos.\n`);
    }

    const stats = await db.estadisticas();
    console.log(`\nFase 2 completada:`);
    console.log(`  - Match directo total: ${totalMatched}`);
    console.log(`  - Enriquecidos por QID: ${totalEnriched}`);
    console.log(`  - Sin match total: ${totalNoMatch}`);
    console.log(`  - Total con wikidata: ${stats.con_wikidata}`);
    console.log(`  - Imagenes: ${stats.imagenes}`);
    if (stats.por_ccaa) {
        console.log(`  - Por CCAA:`);
        stats.por_ccaa.forEach(c => console.log(`      ${c.comunidad_autonoma}: ${c.n}`));
    }

    await db.cerrar();
}

async function descargarItemsRegion(regionNombre, config) {
    const byQid = new Map();
    const { qid, langs, tipo, sipca } = config;

    // Query A: Items con codigo SIPCA (solo para Aragon)
    if (sipca) {
        console.log('  A) Items con codigo SIPCA...');
        await ejecutarQueryMasiva(byQid, `
SELECT ?item ?itemLabel ?municipioLabel ?image ?sipca ?heritageLabel ?commonsCategory WHERE {
    ?item wdt:P3580 ?sipca .
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P1435 ?heritage }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P131 ?municipio }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "${langs}".
        ?item rdfs:label ?itemLabel. ?heritage rdfs:label ?heritageLabel. ?municipio rdfs:label ?municipioLabel.
    }
}
`);
        console.log(`    -> ${byQid.size} items`);
    }

    // Query B: Heritage items en subdivisiones de la region
    if (tipo === 'ccaa') {
        // CCAA: 2 saltos (municipio -> provincia -> CCAA)
        console.log(`  B) Heritage items en municipios (2 saltos P131 -> ${qid})...`);
        await ejecutarQueryMasiva(byQid, `
SELECT ?item ?itemLabel ?municipioLabel ?image ?heritageLabel ?commonsCategory WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P131 ?loc .
    ?loc wdt:P131/wdt:P131 wd:${qid} .
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P131 ?municipio }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "${langs}".
        ?item rdfs:label ?itemLabel. ?heritage rdfs:label ?heritageLabel. ?municipio rdfs:label ?municipioLabel.
    }
}
`);
        console.log(`    -> ${byQid.size} items total`);

        // Also 1 salto (municipio -> CCAA directamente, para capitales de provincia)
        console.log(`  B2) Heritage items (1 salto P131 -> ${qid})...`);
        await ejecutarQueryMasiva(byQid, `
SELECT ?item ?itemLabel ?municipioLabel ?image ?heritageLabel ?commonsCategory WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P131 ?loc .
    ?loc wdt:P131 wd:${qid} .
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P131 ?municipio }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "${langs}".
        ?item rdfs:label ?itemLabel. ?heritage rdfs:label ?heritageLabel. ?municipio rdfs:label ?municipioLabel.
    }
}
`);
        console.log(`    -> ${byQid.size} items total`);
    } else if (tipo === 'provincia') {
        // Provincia: 1 salto (municipio -> provincia)
        console.log(`  B) Heritage items en municipios (1 salto P131 -> ${qid})...`);
        await ejecutarQueryMasiva(byQid, `
SELECT ?item ?itemLabel ?municipioLabel ?image ?heritageLabel ?commonsCategory WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P131 ?loc .
    ?loc wdt:P131 wd:${qid} .
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P131 ?municipio }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "${langs}".
        ?item rdfs:label ?itemLabel. ?heritage rdfs:label ?heritageLabel. ?municipio rdfs:label ?municipioLabel.
    }
}
`);
        console.log(`    -> ${byQid.size} items total`);
    }

    // Query C: Heritage items directamente en la region
    console.log(`  C) Heritage items directamente en ${regionNombre}...`);
    await ejecutarQueryMasiva(byQid, `
SELECT ?item ?itemLabel ?municipioLabel ?image ?heritageLabel ?commonsCategory WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P131 wd:${qid} .
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P373 ?commonsCategory }
    OPTIONAL { ?item wdt:P131 ?municipio }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "${langs}".
        ?item rdfs:label ?itemLabel. ?heritage rdfs:label ?heritageLabel. ?municipio rdfs:label ?municipioLabel.
    }
}
`);
    console.log(`    -> ${byQid.size} items total`);

    return byQid;
}

async function ejecutarQueryMasiva(byQid, query) {
    for (let intento = 1; intento <= MAX_RETRIES; intento++) {
        let res;
        try {
            res = await axios.get(WIKIDATA_SPARQL, {
                params: { query, format: 'json' },
                headers: HEADERS,
                timeout: 180000, // 3 min para queries masivas
            });
        } catch (err) {
            const backoff = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, intento - 1), MAX_BACKOFF_MS);
            const isRetryable = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
                err.code === 'ECONNABORTED' || err.code === 'EPIPE' || err.code === 'EAI_AGAIN' ||
                (err.response && (err.response.status === 429 || err.response.status === 503 || err.response.status >= 500));
            if (isRetryable && intento < MAX_RETRIES) {
                const reason = err.response ? `HTTP ${err.response.status}` : err.code || err.message;
                console.warn(`    SPARQL error (${reason}), reintento ${intento}/${MAX_RETRIES} en ${backoff / 1000}s...`);
                await sleep(backoff);
                continue;
            }
            console.error(`    SPARQL error tras ${intento} intentos: ${err.message}`);
            return;
        }

        if (!res.data?.results?.bindings) {
            if (intento < MAX_RETRIES) {
                const backoff = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, intento - 1), MAX_BACKOFF_MS);
                console.warn(`    SPARQL sin resultados (posible timeout servidor), reintento ${intento}/${MAX_RETRIES} en ${backoff / 1000}s...`);
                await sleep(backoff);
                continue;
            }
            console.error('    SPARQL query sin resultados tras todos los reintentos');
            return;
        }

        for (const r of res.data.results.bindings) {
            const qid = r.item?.value?.split('/').pop();
            if (!qid) continue;

            if (!byQid.has(qid)) {
                byQid.set(qid, {
                    qid,
                    label: r.itemLabel?.value || '',
                    municipio: r.municipioLabel?.value || null,
                    image: r.image?.value || null,
                    sipca: r.sipca?.value || null,
                    heritage: r.heritageLabel?.value || null,
                    commons: r.commonsCategory?.value || null,
                });
            } else {
                const existing = byQid.get(qid);
                if (!existing.image && r.image) existing.image = r.image.value;
                if (!existing.sipca && r.sipca) existing.sipca = r.sipca.value;
                if (!existing.municipio && r.municipioLabel) existing.municipio = r.municipioLabel.value;
            }
        }
        return; // éxito, salir del loop de reintentos
    }
}

function buscarMatch(nombreNorm, muniNorm, indexNombre, indexMuniNombre) {
    // 1. Buscar por municipio+nombre exacto
    if (muniNorm) {
        const key = muniNorm + '|' + nombreNorm;
        const candidates = indexMuniNombre.get(key);
        if (candidates && candidates.length > 0) return candidates[0];
    }

    // 2. Buscar por nombre exacto
    const candidates = indexNombre.get(nombreNorm);
    if (candidates) {
        if (candidates.length === 1) return candidates[0];
        if (muniNorm) {
            const found = candidates.find(c => c.municipio && normalizarTexto(c.municipio) === muniNorm);
            if (found) return found;
        }
    }

    // 3. Busqueda parcial SOLO con municipio (evita falsos positivos)
    // Solo matchea si ambos nombres son suficientemente largos y coincide el municipio
    if (muniNorm && nombreNorm.length >= 10) {
        for (const [key, items] of indexNombre) {
            if (key.length < 10) continue;
            if (key.includes(nombreNorm) || nombreNorm.includes(key)) {
                const found = items.find(c => c.municipio && normalizarTexto(c.municipio) === muniNorm);
                if (found) return found;
            }
        }
    }

    return null;
}

async function guardarWikidata(bienId, item) {
    await db.insertarWikidata({
        bien_id: bienId,
        qid: item.qid,
        descripcion: null,
        imagen_url: item.image || null,
        arquitecto: null,
        estilo: null,
        material: null,
        altura: null,
        superficie: null,
        inception: null,
        heritage_label: item.heritage || null,
        wikipedia_url: null,
        commons_category: item.commons || null,
        sipca_code: item.sipca || null,
        raw_json: null,
    });
}

async function consultarPorQID(qid, langs) {
    langs = langs || 'es,en,ca';
    const query = `
SELECT ?item ?itemLabel ?description
       ?image ?coord ?inception
       ?architectLabel ?architecturalStyleLabel
       ?height ?area ?mainMaterialLabel
       ?heritageLabel ?commonsCategory ?sipca
       ?articleEs
WHERE {
    VALUES ?item { wd:${qid} }
    OPTIONAL { ?item schema:description ?description FILTER(LANG(?description) = "es") }
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
    OPTIONAL { ?item wdt:P3580 ?sipca }
    OPTIONAL {
        ?articleEs schema:about ?item ;
                   schema:isPartOf <https://es.wikipedia.org/> .
    }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "${langs}".
        ?item rdfs:label ?itemLabel.
        ?architect rdfs:label ?architectLabel.
        ?architecturalStyle rdfs:label ?architecturalStyleLabel.
        ?mainMaterial rdfs:label ?mainMaterialLabel.
        ?heritage rdfs:label ?heritageLabel.
    }
}
LIMIT 1
`;

    for (let intento = 1; intento <= MAX_RETRIES; intento++) {
        try {
            const res = await axios.get(WIKIDATA_SPARQL, {
                params: { query, format: 'json' },
                headers: HEADERS,
                timeout: 30000,
            });

            const results = res.data.results.bindings;
            if (results.length === 0) return null;

            return parsearResultadoSPARQL(results[0]);
        } catch (err) {
            const isRetryable = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
                err.code === 'ECONNABORTED' || err.code === 'EPIPE' || err.code === 'EAI_AGAIN' ||
                (err.response && (err.response.status === 429 || err.response.status === 503 || err.response.status >= 500));
            if (isRetryable && intento < MAX_RETRIES) {
                const backoff = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, intento - 1), MAX_BACKOFF_MS);
                const reason = err.response ? `HTTP ${err.response.status}` : err.code || err.message;
                console.warn(`    Retry ${intento}/${MAX_RETRIES} (${reason}), esperando ${backoff / 1000}s...`);
                await sleep(backoff);
                continue;
            }
            throw err; // no retryable o agotados los reintentos
        }
    }
}

function parsearResultadoSPARQL(r) {
    const val = (field) => r[field]?.value || null;

    const qidUrl = val('item');
    const qid = qidUrl ? qidUrl.split('/').pop() : null;
    const articleEs = val('articleEs');
    const wikipedia_url = articleEs || (qid ? `https://www.wikidata.org/wiki/${qid}` : null);

    return {
        qid,
        descripcion: val('description'),
        imagen_url: val('image'),
        arquitecto: val('architectLabel'),
        estilo: val('architecturalStyleLabel'),
        material: val('mainMaterialLabel'),
        altura: r.height ? parseFloat(r.height.value) : null,
        superficie: r.area ? parseFloat(r.area.value) : null,
        inception: val('inception'),
        heritage_label: val('heritageLabel'),
        wikipedia_url,
        commons_category: val('commonsCategory'),
        sipca_code: val('sipca'),
        raw: r,
    };
}

function normalizarTexto(texto) {
    if (!texto) return '';
    return removeAccents(texto.toLowerCase()).replace(/[^a-z0-9 ]/g, '').trim();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { ejecutar, REGIONES };

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error en Fase 2:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
