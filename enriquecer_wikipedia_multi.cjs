/**
 * Enriquiment multi-Wikipedia: busca articles i imatges a totes les Wikipedies
 * (es, ca, eu, gl, ast, en) per als ítems que tenen QID però els falta info.
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'Accept': 'application/sparql-results+json',
    'User-Agent': 'PatrimonioEspanaBot/1.0 (heritage enrichment)'
};
const DELAY_MS = 1500;
const BATCH_SIZE = 80;

// Wikipedies a consultar per ordre de preferència
// Peninsulars: es, ca, eu, gl, ast, an, oc, ext, pt, lad + en
const WIKIPEDIAS = ['es', 'fr', 'ca', 'eu', 'gl', 'ast', 'an', 'oc', 'ext', 'pt', 'lad', 'en'];

async function ejecutar() {
    const args = process.argv.slice(2);

    // Items amb QID que els falta wikipedia_url real (no wikidata.org) o imagen_url
    let sqlQuery = `
        SELECT w.id, w.bien_id, w.qid, w.wikipedia_url, w.imagen_url, w.descripcion,
               b.denominacion, b.comunidad_autonoma
        FROM wikidata w
        JOIN bienes b ON w.bien_id = b.id
        WHERE w.qid IS NOT NULL
          AND (
            w.wikipedia_url IS NULL
            OR w.wikipedia_url LIKE '%wikidata.org%'
            OR w.imagen_url IS NULL
          )
    `;

    if (args.includes('--region')) {
        const region = args[args.indexOf('--region') + 1];
        sqlQuery += ` AND b.comunidad_autonoma = '${region}'`;
    }

    // Si --solo-sin-imagen, només buscar els que no tenen imatge
    if (args.includes('--solo-sin-imagen')) {
        sqlQuery = `
            SELECT w.id, w.bien_id, w.qid, w.wikipedia_url, w.imagen_url, w.descripcion,
                   b.denominacion, b.comunidad_autonoma
            FROM wikidata w
            JOIN bienes b ON w.bien_id = b.id
            WHERE w.qid IS NOT NULL AND w.imagen_url IS NULL
        `;
    }

    const pendientes = (await db.query(sqlQuery)).rows;
    console.log(`=== Enriquiment multi-Wikipedia ===`);
    console.log(`Items pendents: ${pendientes.length}\n`);

    if (pendientes.length === 0) {
        console.log('Tot actualitzat!');
        await db.cerrar();
        return;
    }

    // Processar en lots
    let totalWiki = 0;
    let totalImg = 0;
    let totalDesc = 0;

    for (let i = 0; i < pendientes.length; i += BATCH_SIZE) {
        const batch = pendientes.slice(i, i + BATCH_SIZE);
        const qids = batch.map(b => b.qid);
        const progress = `[${i + 1}-${Math.min(i + BATCH_SIZE, pendientes.length)}/${pendientes.length}]`;

        console.log(`${progress} Consultant ${qids.length} items...`);

        try {
            const results = await consultarBatch(qids);

            for (const item of batch) {
                const data = results.get(item.qid);
                if (!data) continue;

                const updates = {};

                // Wikipedia URL: preferir article real sobre wikidata.org
                if (!item.wikipedia_url || item.wikipedia_url.includes('wikidata.org')) {
                    if (data.wikipedia_url) {
                        updates.wikipedia_url = data.wikipedia_url;
                        totalWiki++;
                    }
                }

                // Imatge
                if (!item.imagen_url && data.imagen_url) {
                    updates.imagen_url = data.imagen_url;
                    totalImg++;

                    // Insertar a la taula d'imatges
                    await db.insertarImagen({
                        bien_id: item.bien_id,
                        url: data.imagen_url,
                        titulo: item.denominacion,
                        autor: null,
                        fuente: 'wikidata',
                    });
                }

                // Descripció
                if (!item.descripcion && data.descripcion) {
                    updates.descripcion = data.descripcion;
                    totalDesc++;
                }

                if (Object.keys(updates).length > 0) {
                    const keys = Object.keys(updates);
                    const setClauses = keys.map((k, idx) => `${k} = $${idx + 1}`).join(', ');
                    const values = [...Object.values(updates), item.id];
                    await db.query(`UPDATE wikidata SET ${setClauses} WHERE id = $${keys.length + 1}`, values);
                }
            }
        } catch (err) {
            console.error(`  Error: ${err.message}`);
        }

        await sleep(DELAY_MS);
    }

    console.log(`\n=== Resultats ===`);
    console.log(`  Nous articles Wikipedia: ${totalWiki}`);
    console.log(`  Noves imatges: ${totalImg}`);
    console.log(`  Noves descripcions: ${totalDesc}`);

    // Stats finals
    const stats = {
        total: (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL')).rows[0].n,
        wikiReal: (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE wikipedia_url IS NOT NULL AND wikipedia_url NOT LIKE '%wikidata.org%'")).rows[0].n,
        wikidata: (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE wikipedia_url LIKE '%wikidata.org%'")).rows[0].n,
        img: (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE imagen_url IS NOT NULL')).rows[0].n,
    };
    console.log(`\n  Total amb QID: ${stats.total}`);
    console.log(`  Amb Wikipedia real: ${stats.wikiReal}`);
    console.log(`  Només Wikidata link: ${stats.wikidata}`);
    console.log(`  Amb imatge: ${stats.img}`);

    await db.cerrar();
}

async function consultarBatch(qids) {
    const valuesClause = qids.map(q => `wd:${q}`).join(' ');

    const query = `
SELECT ?item ?image ?description
       ${WIKIPEDIAS.map(w => `?article_${w}`).join(' ')}
WHERE {
    VALUES ?item { ${valuesClause} }

    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item schema:description ?description FILTER(LANG(?description) = "es") }

    ${WIKIPEDIAS.map(w => `
    OPTIONAL {
        ?article_${w} schema:about ?item ;
                      schema:isPartOf <https://${w}.wikipedia.org/> .
    }`).join('\n')}
}
`;

    const res = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 60000,
    });

    const results = new Map();
    for (const r of res.data.results.bindings) {
        const qid = r.item?.value?.split('/').pop();
        if (!qid || results.has(qid)) continue;

        // Triar millor article de Wikipedia (per ordre de preferència)
        let wikipedia_url = null;
        for (const w of WIKIPEDIAS) {
            const article = r[`article_${w}`]?.value;
            if (article) {
                wikipedia_url = article;
                break;
            }
        }

        results.set(qid, {
            imagen_url: r.image?.value || null,
            wikipedia_url,
            descripcion: r.description?.value || null,
        });
    }

    return results;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

ejecutar().catch(async err => {
    console.error('Error fatal:', err.message);
    await db.cerrar();
    process.exit(1);
});
