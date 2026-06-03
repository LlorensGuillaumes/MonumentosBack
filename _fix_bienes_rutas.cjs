/**
 * _fix_bienes_rutas.cjs
 *
 * Limpieza de bienes creados por scripts de rutas:
 * 1. Buscar bien original en BD (por nombre + proximidad) → redirigir parada
 * 2. Si no hay original → verificar/corregir QID vía Wikidata
 * 3. Rellenar municipio, provincia, comunidad_autonoma desde Wikidata P131
 * 4. Corregir imagen si QID era incorrecto
 *
 * Uso:
 *   node _fix_bienes_rutas.cjs              # dry-run
 *   node _fix_bienes_rutas.cjs --apply       # apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');

const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } })
    : new Pool({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'patrimonio',
        password: process.env.PGPASSWORD || 'patrimonio2026',
        database: process.env.PGDATABASE || 'patrimonio',
    });

const DB_LABEL = process.env.DATABASE_URL ? 'NEON' : 'LOCAL';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============== WIKIDATA HELPERS ==============

async function sparqlQuery(query) {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    let retries = 0;
    while (retries < 4) {
        const res = await fetch(url, {
            headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PatrimonioEuropeoBot/1.0' },
        });
        if (res.status === 429 || res.status === 502 || res.status === 503) {
            retries++;
            await sleep(2000 * retries);
            continue;
        }
        if (!res.ok) throw new Error(`SPARQL ${res.status}`);
        return res.json();
    }
    throw new Error('SPARQL max retries');
}

// Verificar si un QID es un monumento/edificio/lugar (no persona/empresa)
const VALID_P31 = new Set([
    'Q41176', 'Q12280', 'Q16560', 'Q23413', 'Q16970', 'Q33506', 'Q839954',
    'Q57821', 'Q5107', 'Q3947', 'Q44613', 'Q2977', 'Q34627', 'Q24354',
    'Q131596', 'Q15661340', 'Q839954', 'Q16748868', 'Q1248784', 'Q17813453',
    'Q811979', 'Q3957', 'Q1081138', 'Q12518', 'Q32815', 'Q317557', 'Q160742',
    'Q9842', 'Q515', 'Q532', 'Q5119', 'Q486972', 'Q1549591', 'Q1357964',
    'Q751876', 'Q4989906', 'Q2319498', 'Q2065736', 'Q210272', 'Q1802963',
    'Q15303838', 'Q23397', 'Q1066446', 'Q179700', 'Q35600', 'Q39614',
    'Q483453', 'Q44494', 'Q39715', 'Q1497375', 'Q54050', 'Q35112127',
    'Q11707', 'Q3914', 'Q188913', 'Q15127012', 'Q3010369', 'Q570116',
    'Q1030034', 'Q1244442', 'Q174782', 'Q16917', 'Q3469', 'Q46831',
]);

async function verifyQid(qid) {
    try {
        const sparql = `
            SELECT ?type ?image ?itemLabel ?itemDesc WHERE {
                wd:${qid} wdt:P31 ?type .
                OPTIONAL { wd:${qid} wdt:P18 ?image }
                SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,fr,pt,en,it,de" }
            } LIMIT 20
        `;
        const data = await sparqlQuery(sparql);
        const bindings = data.results?.bindings || [];
        if (bindings.length === 0) return { valid: false };

        const types = bindings.map(b => b.type.value.split('/').pop());
        const isValid = types.some(t => VALID_P31.has(t));
        const image = bindings.find(b => b.image)?.image?.value || null;
        const label = bindings[0]?.itemLabel?.value || '';
        const desc = bindings[0]?.itemDesc?.value || '';

        return { valid: isValid, types, image, label, desc };
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

// Buscar QID correcto para un monumento via wbsearchentities + filtro P31
async function findCorrectQid(name, lat, lng, pais) {
    const lang = pais === 'Francia' ? 'fr' : pais === 'Portugal' ? 'pt' : pais === 'Italia' ? 'it' : pais === 'Alemania' ? 'de' : 'es';
    const searchTerms = [name];
    // Variantes sin paréntesis
    const sinParen = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (sinParen !== name) searchTerms.push(sinParen);

    for (const term of searchTerms) {
        for (const sLang of [lang, 'es', 'en']) {
            try {
                const apiUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(term)}&language=${sLang}&limit=10&format=json`;
                const apiRes = await fetch(apiUrl, { headers: { 'User-Agent': 'PatrimonioEuropeoBot/1.0' } });
                if (!apiRes.ok) continue;
                const apiData = await apiRes.json();
                const candidates = (apiData.search || []).map(s => s.id);
                if (candidates.length === 0) continue;

                // Verificar cada candidato
                const values = candidates.map(q => `wd:${q}`).join(' ');
                const sparql = `
                    SELECT ?item ?itemLabel ?lat ?lng ?image ?type WHERE {
                        VALUES ?item { ${values} }
                        ?item wdt:P31 ?type .
                        OPTIONAL { ?item wdt:P625 ?coords . BIND(geof:latitude(?coords) AS ?lat) BIND(geof:longitude(?coords) AS ?lng) }
                        OPTIONAL { ?item wdt:P18 ?image }
                        SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},es,en" }
                    }
                `;
                const data = await sparqlQuery(sparql);
                const results = data.results?.bindings || [];

                // Agrupar por QID
                const byQid = {};
                for (const r of results) {
                    const qid = r.item.value.split('/').pop();
                    if (!byQid[qid]) byQid[qid] = { types: [], label: r.itemLabel?.value, lat: r.lat?.value, lng: r.lng?.value, image: r.image?.value };
                    byQid[qid].types.push(r.type.value.split('/').pop());
                }

                // Filtrar por P31 válido + proximidad
                let best = null, bestDist = Infinity;
                for (const [qid, info] of Object.entries(byQid)) {
                    if (!info.types.some(t => VALID_P31.has(t))) continue;
                    if (info.lat) {
                        const dist = haversineKm(lat, lng, parseFloat(info.lat), parseFloat(info.lng));
                        if (dist < bestDist) { bestDist = dist; best = { qid, ...info, dist }; }
                    } else {
                        // Sin coords pero tipo válido
                        if (!best) best = { qid, ...info, dist: 999 };
                    }
                }

                if (best && best.dist < 200) return best;
            } catch (e) { /* skip */ }
            await sleep(300);
        }
    }
    return null;
}

// Obtener ubicación administrativa desde Wikidata P131
async function getLocation(qid, pais) {
    try {
        const sparql = `
            SELECT ?admin ?adminLabel ?admin2 ?admin2Label ?admin3 ?admin3Label WHERE {
                wd:${qid} wdt:P131 ?admin .
                OPTIONAL { ?admin wdt:P131 ?admin2 . OPTIONAL { ?admin2 wdt:P131 ?admin3 } }
                SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,fr,pt,en,it,de" }
            } LIMIT 5
        `;
        const data = await sparqlQuery(sparql);
        const b = data.results?.bindings?.[0];
        if (!b) return null;

        // La jerarquía varía: admin = municipio, admin2 = provincia/comarca, admin3 = CA/región
        return {
            municipio: b.adminLabel?.value || null,
            provincia: b.admin2Label?.value || null,
            comunidad_autonoma: b.admin3Label?.value || null,
        };
    } catch (e) {
        return null;
    }
}

// ============== MAIN ==============

async function main() {
    console.log(`=== Fix bienes rutas ${DRY_RUN ? '[DRY-RUN]' : '[APPLY]'} ===`);
    console.log(`Base de datos: ${DB_LABEL}\n`);

    // Get all bienes created by our scripts
    const result = await pool.query(`
        SELECT b.id, b.denominacion, b.latitud, b.longitud, b.pais, b.municipio, b.provincia, b.comunidad_autonoma,
               b.codigo_fuente, w.qid, w.imagen_url
        FROM bienes b
        LEFT JOIN wikidata w ON w.bien_id = b.id
        WHERE b.codigo_fuente LIKE 'wikidata-%'
        ORDER BY b.id
    `);

    console.log(`Bienes a revisar: ${result.rows.length}\n`);

    let redirected = 0, qidFixed = 0, locationFixed = 0, imageFixed = 0, noFix = 0;

    for (const bien of result.rows) {
        const lat = parseFloat(bien.latitud);
        const lng = parseFloat(bien.longitud);
        if (!lat || !lng) continue;

        process.stdout.write(`  [${bien.id}] ${bien.denominacion}...`);

        // Step 1: Try to find original bien in DB
        // Extract significant keywords (>3 chars, no articles/prepositions)
        const STOP_WORDS = new Set(['de','del','des','las','los','les','the','der','una','uno','la','le','el','al','da','do','dos','das','den','von','van','san','sant','santa','saint','für','sur','con','por','para','que','als','und']);
        const keywords = bien.denominacion
            .replace(/\([^)]*\)/g, '') // remove parentheses
            .split(/[\s\-–,.']+/)
            .filter(w => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
            .map(w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

        let bestOrig = null;
        if (keywords.length > 0) {
            // Build ILIKE conditions: denomination must contain at least the main keyword
            // Use the most specific keyword (longest, not a common place name)
            const mainKeyword = keywords.reduce((a, b) => a.length >= b.length ? a : b);
            const origResult = await pool.query(`
                SELECT id, denominacion, municipio, provincia, comunidad_autonoma,
                       (6371 * acos(LEAST(1, cos(radians($1)) * cos(radians(latitud)) * cos(radians(longitud) - radians($2))
                       + sin(radians($1)) * sin(radians(latitud))))) AS dist_km
                FROM bienes
                WHERE id != $3
                  AND pais = $4
                  AND latitud IS NOT NULL
                  AND codigo_fuente NOT LIKE 'wikidata-%'
                  AND denominacion ILIKE $5
                ORDER BY dist_km ASC LIMIT 5
            `, [lat, lng, bien.id, bien.pais, `%${mainKeyword}%`]);

            // Score candidates: how many keywords match in the denomination?
            for (const orig of origResult.rows) {
                if (orig.dist_km > 20) continue;
                const origNorm = orig.denominacion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const matchCount = keywords.filter(kw => origNorm.includes(kw)).length;
                const matchRatio = matchCount / keywords.length;

                // Require at least 50% keyword match AND the main keyword
                if (matchRatio >= 0.5 && origNorm.includes(mainKeyword)) {
                    if (!bestOrig || matchCount > bestOrig.matchCount || (matchCount === bestOrig.matchCount && orig.dist_km < bestOrig.dist_km)) {
                        bestOrig = { ...orig, matchCount, matchRatio };
                    }
                }
            }
        }

        if (bestOrig) {
            redirected++;
            console.log(` → REDIRIGIR a [${bestOrig.id}] "${bestOrig.denominacion}" (${bestOrig.dist_km.toFixed(1)}km, ${(bestOrig.matchRatio * 100).toFixed(0)}% match)`);

            if (!DRY_RUN) {
                await pool.query('UPDATE rutas_culturales_paradas SET bien_id = $1 WHERE bien_id = $2', [bestOrig.id, bien.id]);
            }
            continue;
        }

        // Step 2: Verify current QID
        let needsQidFix = false;
        if (bien.qid) {
            const verify = await verifyQid(bien.qid);
            if (!verify.valid) {
                needsQidFix = true;
                console.log(` QID ${bien.qid} INVÁLIDO (${verify.types?.join(',') || 'sin P31'})`);
            }
            await sleep(200);
        }

        // Step 3: Fix QID if needed
        if (needsQidFix || !bien.qid) {
            const correct = await findCorrectQid(bien.denominacion, lat, lng, bien.pais);
            if (correct) {
                qidFixed++;
                console.log(` → QID corregido: ${correct.qid} "${correct.label}" (${correct.dist?.toFixed(1)}km)`);

                if (!DRY_RUN) {
                    await pool.query('UPDATE wikidata SET qid = $1, descripcion = $2, imagen_url = $3 WHERE bien_id = $4',
                        [correct.qid, '', correct.image, bien.id]);
                    if (correct.image) {
                        await pool.query('DELETE FROM imagenes WHERE bien_id = $1 AND fuente = $2', [bien.id, 'wikidata']);
                        await pool.query('INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                            [bien.id, correct.image, bien.denominacion, 'wikidata']);
                        imageFixed++;
                    }
                }
                bien.qid = correct.qid; // for location step
            } else {
                noFix++;
                console.log(` → No se encontró QID correcto`);
            }
            await sleep(300);
        } else {
            // QID is valid, but check if image is missing/wrong
            const verify = await verifyQid(bien.qid);
            if (verify.image && verify.image !== bien.imagen_url) {
                if (!DRY_RUN) {
                    await pool.query('UPDATE wikidata SET imagen_url = $1 WHERE bien_id = $2', [verify.image, bien.id]);
                    await pool.query('DELETE FROM imagenes WHERE bien_id = $1 AND fuente = $2', [bien.id, 'wikidata']);
                    await pool.query('INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                        [bien.id, verify.image, bien.denominacion, 'wikidata']);
                }
                imageFixed++;
            }
            console.log(` QID OK`);
        }

        // Step 4: Fix location if missing
        if (!bien.municipio && bien.qid) {
            const loc = await getLocation(bien.qid, bien.pais);
            if (loc && loc.municipio) {
                locationFixed++;
                if (!DRY_RUN) {
                    await pool.query(
                        'UPDATE bienes SET municipio = $1, provincia = $2, comunidad_autonoma = $3 WHERE id = $4',
                        [loc.municipio, loc.provincia, loc.comunidad_autonoma, bien.id]
                    );
                }
                console.log(`    Ubicación: ${[loc.municipio, loc.provincia, loc.comunidad_autonoma].filter(Boolean).join(', ')}`);
            }
            await sleep(200);
        }
    }

    console.log(`\n========== RESUMEN ==========`);
    console.log(`  Redirigidos a original: ${redirected}`);
    console.log(`  QIDs corregidos:        ${qidFixed}`);
    console.log(`  Ubicaciones rellenadas: ${locationFixed}`);
    console.log(`  Imágenes corregidas:    ${imageFixed}`);
    console.log(`  Sin fix posible:        ${noFix}`);

    if (DRY_RUN) console.log(`\n[DRY-RUN] No se ha modificado nada. Usa --apply para aplicar.`);

    await pool.end();
}

main().catch(err => { console.error('Error fatal:', err); pool.end(); process.exit(1); });
