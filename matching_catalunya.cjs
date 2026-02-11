const axios = require('axios');
const removeAccents = require('remove-accents');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = { Accept: 'application/sparql-results+json', 'User-Agent': 'PatrimonioBot/1.0' };

async function main() {
    console.log('=== MATCHING CATALUNYA ===\n');

    // Query para Barcelona provincia
    const query = `
SELECT DISTINCT ?item ?itemLabel ?municipioLabel ?image WHERE {
    ?item wdt:P1435 ?heritage .
    ?item wdt:P131 ?loc .
    ?loc wdt:P131 wd:Q81949 .
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P131 ?municipio }
    SERVICE wikibase:label {
        bd:serviceParam wikibase:language "es,ca,en".
        ?item rdfs:label ?itemLabel.
        ?municipio rdfs:label ?municipioLabel.
    }
}
LIMIT 20000
`;

    console.log('Descargando items de Barcelona provincia...');
    const res = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 120000,
    });

    const items = new Map();
    for (const r of res.data.results.bindings) {
        const qid = r.item?.value?.split('/').pop();
        if (!qid || items.has(qid)) continue;
        items.set(qid, {
            qid,
            label: r.itemLabel?.value || '',
            municipio: r.municipioLabel?.value || null,
            image: r.image?.value || null,
        });
    }

    console.log(`Items obtenidos: ${items.size}`);

    // Crear index por nombre normalizado
    const indexNorm = new Map();
    for (const [qid, item] of items) {
        const norm = removeAccents(item.label.toLowerCase()).replace(/[^a-z0-9 ]/g, ' ').trim();
        if (!indexNorm.has(norm)) indexNorm.set(norm, []);
        indexNorm.get(norm).push(item);
    }

    // Obtener bienes Catalunya sin QID
    const bienes = (await db.query(`
        SELECT b.id, b.denominacion, b.municipio
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.comunidad_autonoma = 'Catalunya' AND w.qid IS NULL
    `)).rows;

    console.log(`Bienes Catalunya sin QID: ${bienes.length}`);

    let matches = 0;
    for (const bien of bienes) {
        const norm = removeAccents(bien.denominacion.toLowerCase()).replace(/[^a-z0-9 ]/g, ' ').trim();
        const candidates = indexNorm.get(norm);

        if (candidates && candidates.length > 0) {
            const muniNorm = bien.municipio ? removeAccents(bien.municipio.toLowerCase()) : null;
            let match = candidates[0];

            // Si hay varios candidatos, buscar por municipio
            if (candidates.length > 1 && muniNorm) {
                const found = candidates.find(c =>
                    c.municipio && removeAccents(c.municipio.toLowerCase()).includes(muniNorm)
                );
                if (found) match = found;
            }

            const existe = (await db.query('SELECT id FROM wikidata WHERE bien_id = ?', [bien.id])).rows[0];
            if (existe) {
                await db.query('UPDATE wikidata SET qid = ?, imagen_url = ? WHERE bien_id = ?',
                    [match.qid, match.image, bien.id]);
            } else {
                await db.query('INSERT INTO wikidata (bien_id, qid, imagen_url) VALUES (?, ?, ?) ON CONFLICT (bien_id) DO NOTHING',
                    [bien.id, match.qid, match.image]);
            }
            matches++;
        }
    }

    console.log(`Nuevos matches Catalunya: ${matches}`);

    const total = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL')).rows[0].n;
    const totalBienes = (await db.query('SELECT COUNT(*) as n FROM bienes')).rows[0].n;
    console.log(`Total con QID: ${total}/${totalBienes} (${(100*total/totalBienes).toFixed(1)}%)`);

    await db.cerrar();
}

main().catch(async err => {
    console.error('Error:', err.message);
    await db.cerrar();
    process.exit(1);
});
