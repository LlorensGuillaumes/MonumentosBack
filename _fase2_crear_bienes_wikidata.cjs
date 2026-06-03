/**
 * _fase2_crear_bienes_wikidata.cjs
 *
 * Fase 2: Para cada parada sin bien_id en las rutas curadas,
 * busca el monumento en Wikidata, crea el bien y lo vincula.
 *
 * Uso:
 *   node _fase2_crear_bienes_wikidata.cjs                  # dry-run
 *   node _fase2_crear_bienes_wikidata.cjs --apply           # apply
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

// ============== WIKIDATA SPARQL ==============

async function sparqlQuery(query) {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    let retries = 0;
    while (retries < 4) {
        const res = await fetch(url, {
            headers: {
                'Accept': 'application/sparql-results+json',
                'User-Agent': 'PatrimonioEuropeoBot/1.0 (fase2 crear bienes)',
            },
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

/**
 * Busca un monumento en Wikidata directamente por QID.
 */
async function fetchByQid(qid, centerLat, centerLng) {
    const sparql = `
        SELECT ?item ?itemLabel ?itemDesc ?lat ?lng ?image ?inception WHERE {
            BIND(wd:${qid} AS ?item)
            ?item wdt:P625 ?coords .
            BIND(geof:latitude(?coords) AS ?lat)
            BIND(geof:longitude(?coords) AS ?lng)
            OPTIONAL { ?item wdt:P18 ?image }
            OPTIONAL { ?item wdt:P571 ?inception }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,fr,pt,en" }
        } LIMIT 1
    `;
    try {
        const data = await sparqlQuery(sparql);
        const results = data.results?.bindings || [];
        if (results.length > 0) {
            const r = results[0];
            const lat = parseFloat(r.lat?.value);
            const lng = parseFloat(r.lng?.value);
            const dist = haversineKm(centerLat, centerLng, lat, lng);
            return formatResult(r, dist);
        }
    } catch (e) {
        console.log(`    QID fetch warn: ${e.message}`);
    }
    return null;
}

/**
 * Busca un monumento en Wikidata por nombre y proximidad geográfica.
 * Devuelve { qid, label, description, lat, lng, image, inception, instanceOf } o null.
 */
async function searchWikidata(name, centerLat, centerLng, country) {
    // Determinar idioma según país
    const lang = country === 'Francia' ? 'fr' : country === 'Portugal' ? 'pt' : 'es';
    const altLang = lang === 'es' ? 'ca' : lang; // para catalán

    // Estrategia 1: búsqueda por label exacto + proximidad
    const variants = [name];
    // Normalizar acentos para búsqueda alternativa
    const norm = name.replace(/ü/g, 'u').replace(/à/g, 'a').replace(/è/g, 'e').replace(/ò/g, 'o');
    if (norm !== name) variants.push(norm);

    for (const searchName of variants) {
        const sparql = `
            SELECT ?item ?itemLabel ?itemDesc ?lat ?lng ?image ?inception WHERE {
                ?item rdfs:label "${searchName.replace(/"/g, '\\"')}"@${lang} .
                ?item wdt:P625 ?coords .
                BIND(geof:latitude(?coords) AS ?lat)
                BIND(geof:longitude(?coords) AS ?lng)
                OPTIONAL { ?item wdt:P18 ?image }
                OPTIONAL { ?item wdt:P571 ?inception }
                SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},${altLang},en" }
            } LIMIT 5
        `;

        try {
            const data = await sparqlQuery(sparql);
            const results = data.results?.bindings || [];
            if (results.length > 0) {
                // Elegir el más cercano al center
                let best = null, bestDist = Infinity;
                for (const r of results) {
                    const lat = parseFloat(r.lat?.value);
                    const lng = parseFloat(r.lng?.value);
                    if (isNaN(lat)) continue;
                    const dist = haversineKm(centerLat, centerLng, lat, lng);
                    if (dist < bestDist) { bestDist = dist; best = r; }
                }
                if (best && bestDist < 500) {
                    return formatResult(best, bestDist);
                }
            }
        } catch (e) {
            if (!e.message.includes('max retries')) console.log(`    SPARQL warn: ${e.message}`);
        }

        // Si es catalán, intentar con @ca
        if (lang === 'es' && /^(Sant |Santa |Sagrada|Palau|Parc|Casa )/.test(searchName)) {
            try {
                const sparqlCa = sparql.replace(new RegExp(`@${lang}`, 'g'), '@ca');
                const data = await sparqlQuery(sparqlCa);
                const results = data.results?.bindings || [];
                if (results.length > 0) {
                    let best = null, bestDist = Infinity;
                    for (const r of results) {
                        const lat = parseFloat(r.lat?.value);
                        const lng = parseFloat(r.lng?.value);
                        if (isNaN(lat)) continue;
                        const dist = haversineKm(centerLat, centerLng, lat, lng);
                        if (dist < bestDist) { bestDist = dist; best = r; }
                    }
                    if (best && bestDist < 500) return formatResult(best, bestDist);
                }
            } catch (e) { /* skip */ }
        }

        await sleep(300);
    }

    // Estrategia 2: wbsearchentities API (más robusto que SPARQL mwapi)
    const allSearchTerms = [name, ...(ALT_SEARCHES[name] || [])];
    const searchLangs = lang === 'es' ? ['es', 'ca'] : lang === 'pt' ? ['pt'] : ['fr'];

    for (const searchTerm of allSearchTerms) {
        for (const sLang of searchLangs) {
            try {
                const apiUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchTerm)}&language=${sLang}&limit=10&format=json`;
                const apiRes = await fetch(apiUrl, { headers: { 'User-Agent': 'PatrimonioEuropeoBot/1.0' } });
                if (!apiRes.ok) continue;
                const apiData = await apiRes.json();
                const qids = (apiData.search || []).map(s => s.id);
                if (qids.length === 0) continue;

                // Fetch coords para los candidatos
                const values = qids.map(q => `wd:${q}`).join(' ');
                const detailSparql = `
                    SELECT ?item ?itemLabel ?itemDesc ?lat ?lng ?image WHERE {
                        VALUES ?item { ${values} }
                        ?item wdt:P625 ?coords .
                        BIND(geof:latitude(?coords) AS ?lat)
                        BIND(geof:longitude(?coords) AS ?lng)
                        OPTIONAL { ?item wdt:P18 ?image }
                        SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},${altLang},en" }
                    }
                `;
                const data = await sparqlQuery(detailSparql);
                const results = data.results?.bindings || [];
                let best = null, bestDist = Infinity;
                for (const r of results) {
                    const lat = parseFloat(r.lat?.value);
                    const lng = parseFloat(r.lng?.value);
                    if (isNaN(lat)) continue;
                    const dist = haversineKm(centerLat, centerLng, lat, lng);
                    if (dist < bestDist) { bestDist = dist; best = r; }
                }
                if (best && bestDist < 500) return formatResult(best, bestDist);
            } catch (e) { /* skip */ }
            await sleep(300);
        }
    }

    return null;
}

function formatResult(binding, dist) {
    return {
        qid: binding.item.value.split('/').pop(),
        label: binding.itemLabel?.value || '',
        description: binding.itemDesc?.value || '',
        lat: parseFloat(binding.lat.value),
        lng: parseFloat(binding.lng.value),
        image: binding.image?.value || null,
        inception: binding.inception?.value?.substring(0, 10) || null,
        dist,
    };
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============== KNOWN QIDs ==============
// Monumentos famosos que el EntitySearch no encuentra por encoding issues
const KNOWN_QIDS = {
    'San Miguel de San Esteban': 'USE_MANUAL',
};

// Datos manuales con coordenadas (bypassa SPARQL P625)
const MANUAL_DATA = {
    'Nativitat de la Mare de Déu de Durro': { qid: 'Q977148', label: 'Iglesia de la Nativitat de Durro', lat: 42.4981, lng: 0.8208, pais: 'España' },
    "Santa Maria de l'Assumpció de Coll": { qid: 'Q11682913', label: "Iglesia de Santa Maria de l'Assumpció de Coll", lat: 42.4500, lng: 0.7453, pais: 'España' },
    'San Pedro de Moarves': { qid: 'Q5911108', label: 'Iglesia de San Pedro de Moarves de Ojeda', lat: 42.7042, lng: -4.4106, pais: 'España' },
    'Santa María de Bareyo': { qid: 'Q5911654', label: 'Iglesia de Santa María de Bareyo', lat: 43.4725, lng: -3.5961, pais: 'España' },
    'Torres de Teruel': { qid: 'Q3533604', label: 'Torre del Salvador de Teruel', lat: 40.3425, lng: -1.1089, pais: 'España' },
    'Mont-Louis': { qid: 'Q6635', label: 'Citadelle de Mont-Louis', lat: 42.5092, lng: 2.1222, pais: 'Francia' },
    'Santa Eulalia de Toledo': { qid: 'Q21522067', label: 'Iglesia de Santa Eulalia de Toledo', lat: 39.8606, lng: -4.0286, pais: 'España' },
    'Castillo del Gaià': { qid: 'Q17389816', label: 'Castell de Santa Coloma de Queralt', lat: 41.5328, lng: 1.3839, pais: 'España' },
    'Talleres artesanales': { qid: 'Q6034114', label: 'Museo Ruiz de Luna (Talavera de la Reina)', lat: 39.9572, lng: -4.8278, pais: 'España' },
    'San Miguel de San Esteban': { qid: 'Q5910904', label: 'Iglesia de San Miguel (San Esteban de Gormaz)', lat: 41.575833, lng: -3.206667, pais: 'España' },
};

// Búsquedas alternativas para nombres que fallan en SPARQL
const ALT_SEARCHES = {
    'Catedral de Jaca': ['Catedral de San Pedro de Jaca', 'Catedral Jaca'],
    'San Martín de Frómista': ['Iglesia de San Martín de Frómista', 'San Martin Fromista'],
    'Nativitat de la Mare de Déu de Durro': ['Natividad de Durro', 'iglesia Durro'],
    "Santa Maria de l'Assumpció de Coll": ['iglesia de Coll Barruera', 'Santa Maria Coll'],
    'San Pedro de Moarves': ['San Pedro Moarves', 'iglesia Moarves'],
    'Santa María de Bareyo': ['iglesia Bareyo'],
    'Santo Domingo de Soria': ['iglesia Santo Domingo Soria'],
    'Catedral de Valencia': ['Catedral Santa Maria Valencia', 'Seu Valencia'],
    'Aljafería': ['Palacio de la Aljafería'],
    'Aljafería de Zaragoza': ['Palacio de la Aljafería'],
    'Torres de Teruel': ['Torre del Salvador Teruel', 'torre mudejar Teruel'],
    'Sacra Capilla del Salvador': ['Capilla del Salvador Ubeda'],
    'Catedral de Baeza': ['Catedral Natividad Nuestra Señora Baeza'],
    'Convento de Cristo de Tomar': ['Convento de Cristo Tomar'],
    'Mont Saint-Michel': ['abbaye Mont-Saint-Michel'],
    'Murallas de Badajoz': ['Alcazaba Badajoz'],
    'Santa Eulalia de Toledo': ['iglesia Santa Eulalia Toledo'],
    'Menhir da Meada': ['Menhir Meada Castelo de Vide'],
    'Mont-Louis': ['citadelle Mont-Louis'],
    'Monasterio de Ripoll': ['Monestir de Santa Maria de Ripoll'],
    'Castillo del Gaià': ['Castell Gaia'],
    'Palau de la Música': ['Palau de la Música Catalana'],
};

// ============== PAÍS MAPPING ==============
const PAIS_MAP = { 'España': 'España', 'Francia': 'Francia', 'Portugal': 'Portugal' };

// ============== MAIN ==============

async function main() {
    console.log(`=== Fase 2: Crear bienes desde Wikidata ${DRY_RUN ? '[DRY-RUN]' : '[APPLY]'} ===`);
    console.log(`Base de datos: ${DB_LABEL}\n`);

    // Obtener paradas sin bien_id de rutas curadas (slug en CURATED_SLUGS)
    const result = await pool.query(`
        SELECT p.id AS parada_id, p.nombre, p.orden, p.ruta_id,
               rc.slug, rc.nombre AS ruta_nombre, rc.pais, rc.centro_lat, rc.centro_lng
        FROM rutas_culturales_paradas p
        JOIN rutas_culturales rc ON rc.id = p.ruta_id
        WHERE p.bien_id IS NULL
          AND rc.slug NOT IN ('retablos-este-leon','via-degli-dei','sentiero-del-viandante',
              'levada-das-25-fontes','caminho-real-do-paul-do-mar','via-mercatorum',
              'ruta-del-cares','chemin-cremont','via-spluga','via-dell-amore',
              'caminito-del-rey','sentiero-dei-fiori','percurso-dos-sete-vales-suspensos',
              'sentiero-rilke','sentiero-delle-ripe','sentiero-dei-grandi-alberi',
              'chemin-sortie-vallee-blanche')
        ORDER BY rc.id, p.orden
    `);

    console.log(`Paradas sin bien_id: ${result.rows.length}\n`);

    let found = 0, notFound = 0;
    const notFoundList = [];

    for (const row of result.rows) {
        const pais = PAIS_MAP[row.pais] || 'España';
        console.log(`  [${row.slug}] "${row.nombre}"...`);

        let wd = null;

        // Primero: excluidos
        if (row.nombre in KNOWN_QIDS && KNOWN_QIDS[row.nombre] === null) {
            console.log(`    ✗ Excluido`);
            notFound++;
            notFoundList.push(`${row.slug}: "${row.nombre}" (excluido)`);
            await sleep(100);
            continue;
        }

        // Segundo: datos manuales (QID + coords proporcionadas)
        const manual = MANUAL_DATA[row.nombre];
        if (manual) {
            wd = {
                qid: manual.qid,
                label: manual.label,
                description: '',
                lat: manual.lat,
                lng: manual.lng,
                image: null,
                inception: null,
                dist: haversineKm(row.centro_lat, row.centro_lng, manual.lat, manual.lng),
            };
            // Intentar obtener imagen de Wikidata
            try {
                const imgData = await fetchByQid(manual.qid, manual.lat, manual.lng);
                if (imgData?.image) wd.image = imgData.image;
                if (imgData?.description) wd.description = imgData.description;
            } catch (e) { /* skip */ }
        }

        // Tercero: buscar en Wikidata por nombre
        if (!wd) {
            wd = await searchWikidata(row.nombre, row.centro_lat, row.centro_lng, row.pais);
        }

        if (wd) {
            found++;
            console.log(`    ✓ ${wd.qid} "${wd.label}" (${wd.dist.toFixed(1)}km) ${wd.image ? '📷' : ''}`);

            if (!DRY_RUN) {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    // Crear bien
                    const codigoFuente = `wikidata-${wd.qid}`;
                    const bienRes = await client.query(`
                        INSERT INTO bienes (denominacion, latitud, longitud, pais, codigo_fuente, tipo_monumento)
                        VALUES ($1, $2, $3, $4, $5, NULL)
                        ON CONFLICT (pais, comunidad_autonoma, codigo_fuente) DO UPDATE
                            SET denominacion = EXCLUDED.denominacion,
                                latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
                                updated_at = NOW()
                        RETURNING id
                    `, [wd.label, wd.lat, wd.lng, pais, codigoFuente]);
                    const bienId = bienRes.rows[0].id;

                    // Crear/actualizar wikidata
                    const existingWd = await client.query('SELECT id FROM wikidata WHERE bien_id = $1', [bienId]);
                    if (existingWd.rows.length > 0) {
                        await client.query(`
                            UPDATE wikidata SET qid = $1, descripcion = $2, imagen_url = $3 WHERE bien_id = $4
                        `, [wd.qid, wd.description, wd.image, bienId]);
                    } else {
                        await client.query(`
                            INSERT INTO wikidata (bien_id, qid, descripcion, imagen_url)
                            VALUES ($1, $2, $3, $4)
                        `, [bienId, wd.qid, wd.description, wd.image]);
                    }

                    // Imagen
                    if (wd.image) {
                        await client.query(`
                            INSERT INTO imagenes (bien_id, url, titulo, fuente)
                            VALUES ($1, $2, $3, 'wikidata')
                            ON CONFLICT DO NOTHING
                        `, [bienId, wd.image, wd.label]);
                    }

                    // Vincular parada
                    await client.query(`
                        UPDATE rutas_culturales_paradas
                        SET bien_id = $1, latitud = $2, longitud = $3, localidad = $4
                        WHERE id = $5
                    `, [bienId, wd.lat, wd.lng, wd.label, row.parada_id]);

                    await client.query('COMMIT');
                    console.log(`    → bien_id=${bienId} vinculado a parada ${row.parada_id}`);
                } catch (err) {
                    await client.query('ROLLBACK');
                    console.error(`    ERROR: ${err.message}`);
                } finally {
                    client.release();
                }
            }
        } else {
            notFound++;
            notFoundList.push(`${row.slug}: "${row.nombre}"`);
            console.log(`    ✗ NO encontrado en Wikidata`);
        }

        await sleep(400);
    }

    console.log(`\n========== RESUMEN ==========`);
    console.log(`  Encontrados en Wikidata: ${found}`);
    console.log(`  No encontrados:          ${notFound}`);

    if (notFoundList.length > 0) {
        console.log(`\n--- Sin resultado Wikidata (${notFoundList.length}) ---`);
        for (const n of notFoundList) console.log(`  ${n}`);
    }

    if (DRY_RUN) console.log(`\n[DRY-RUN] No se ha modificado nada. Usa --apply para aplicar.`);

    await pool.end();
}

main().catch(err => {
    console.error('Error fatal:', err);
    pool.end();
    process.exit(1);
});
