/**
 * buscar_wikipedia_extra.cjs
 * Cerca articles de Wikipedia en idiomes addicionals de la Península Ibèrica
 * per als ítems que tenen QID.
 *
 * Idiomes nous: oc (occità/aranès), an (aragonès), ext (extremeny),
 *               lad (judeoespanyol), pt (portuguès)
 *
 * Ús:
 *   node buscar_wikipedia_extra.cjs              # Escanejar tots els QID
 *   node buscar_wikipedia_extra.cjs --actualizar  # Escanejar i actualitzar DB
 *   node buscar_wikipedia_extra.cjs --region Catalunya
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'Accept': 'application/sparql-results+json',
    'User-Agent': 'PatrimonioEspanaBot/1.0 (heritage Wikipedia search)'
};
const DELAY_MS = 1500;
const BATCH_SIZE = 80;

// Tots els idiomes peninsulars (existents + nous)
const TOTS_IDIOMES = ['es', 'fr', 'it', 'ca', 'eu', 'gl', 'ast', 'en', 'oc', 'an', 'ext', 'lad', 'pt'];
// Només els nous que no estaven al script original
const IDIOMES_NOUS = ['fr', 'it', 'oc', 'an', 'ext', 'lad', 'pt'];
// Ordre de preferència complet per escollir wikipedia_url
const PREFERENCIA = ['es', 'it', 'fr', 'ca', 'eu', 'gl', 'ast', 'an', 'oc', 'ext', 'pt', 'lad', 'en'];

const NOMS_IDIOMES = {
    es: 'Español', fr: 'Français', it: 'Italiano', ca: 'Català', eu: 'Euskara', gl: 'Galego',
    ast: 'Asturianu', en: 'English', oc: 'Occitan/Aranès',
    an: 'Aragonés', ext: 'Estremeñu', lad: 'Ladino', pt: 'Português',
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Consulta un lot de QIDs per trobar sitelinks en tots els idiomes
 */
async function consultarBatch(qids) {
    const valuesClause = qids.map(q => `wd:${q}`).join(' ');

    const query = `
SELECT ?item ?image ?descEs
       ${TOTS_IDIOMES.map(w => `?article_${w}`).join(' ')}
       ${IDIOMES_NOUS.map(w => `?desc_${w}`).join(' ')}
WHERE {
    VALUES ?item { ${valuesClause} }

    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item schema:description ?descEs FILTER(LANG(?descEs) = "es") }

    ${TOTS_IDIOMES.map(w => `
    OPTIONAL {
        ?article_${w} schema:about ?item ;
                      schema:isPartOf <https://${w}.wikipedia.org/> .
    }`).join('\n')}

    ${IDIOMES_NOUS.map(w => `
    OPTIONAL { ?item schema:description ?desc_${w} FILTER(LANG(?desc_${w}) = "${w}") }
    `).join('\n')}
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

        const articles = {};
        for (const w of TOTS_IDIOMES) {
            const url = r[`article_${w}`]?.value;
            if (url) articles[w] = url;
        }

        // Escollir millor URL per preferència
        let bestUrl = null;
        for (const w of PREFERENCIA) {
            if (articles[w]) { bestUrl = articles[w]; break; }
        }

        // Descripcions: preferir es, després noves
        let descripcion = r.descEs?.value || null;
        if (!descripcion) {
            for (const w of IDIOMES_NOUS) {
                const d = r[`desc_${w}`]?.value;
                if (d) { descripcion = d; break; }
            }
        }

        results.set(qid, {
            articles,
            bestUrl,
            imagen_url: r.image?.value || null,
            descripcion,
        });
    }

    return results;
}

async function main() {
    const args = process.argv.slice(2);
    const actualizar = args.includes('--actualizar');
    const regionIdx = args.indexOf('--region');
    const regionArg = regionIdx !== -1 ? args[regionIdx + 1] : null;
    const paisIdx = args.indexOf('--pais');
    const paisArg = paisIdx !== -1 ? args[paisIdx + 1] : null;

    console.log('=== Cerca Wikipedia en idiomes peninsulars ===');
    console.log(`Idiomes: ${TOTS_IDIOMES.map(w => `${w} (${NOMS_IDIOMES[w]})`).join(', ')}`);
    console.log(`Mode: ${actualizar ? 'ESCANEJAR + ACTUALITZAR DB' : 'ESCANEJAR (dry run)'}\n`);

    // Obtenir tots els items amb QID
    let sqlQuery = `
        SELECT w.id, w.bien_id, w.qid, w.wikipedia_url, w.imagen_url, w.descripcion,
               b.denominacion, b.comunidad_autonoma
        FROM wikidata w
        JOIN bienes b ON w.bien_id = b.id
        WHERE w.qid IS NOT NULL
    `;
    const params = [];
    if (regionArg) {
        sqlQuery += ` AND b.comunidad_autonoma = ?`;
        params.push(regionArg);
        console.log(`Regió: ${regionArg}`);
    }
    if (paisArg) {
        sqlQuery += ` AND b.pais = ?`;
        params.push(paisArg);
        console.log(`País: ${paisArg}`);
    }

    const items = (await db.query(sqlQuery, params)).rows;
    console.log(`Items amb QID a escanejar: ${items.length}\n`);

    // Estadístiques globals
    const statsPerIdioma = {};
    for (const w of TOTS_IDIOMES) statsPerIdioma[w] = 0;
    let itemsAmbArticleNou = 0;  // items que no tenien wikipedia_url i ara en tenen
    let itemsAmbDescNova = 0;
    let itemsAmbImgNova = 0;
    let totalArticlesTrobats = 0;

    // Processar en lots
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const qids = batch.map(b => b.qid);
        const progress = `[${i + 1}-${Math.min(i + BATCH_SIZE, items.length)}/${items.length}]`;

        process.stdout.write(`${progress} Consultant ${qids.length} QIDs... `);

        try {
            const results = await consultarBatch(qids);

            let batchArticles = 0;
            for (const item of batch) {
                const data = results.get(item.qid);
                if (!data) continue;

                // Comptar articles per idioma
                for (const [lang, url] of Object.entries(data.articles)) {
                    statsPerIdioma[lang]++;
                    batchArticles++;
                }

                if (actualizar) {
                    const updates = {};

                    // Wikipedia URL: actualitzar si no en té o només té wikidata.org
                    const teWikiReal = item.wikipedia_url && !item.wikipedia_url.includes('wikidata.org');
                    if (!teWikiReal && data.bestUrl) {
                        updates.wikipedia_url = data.bestUrl;
                        itemsAmbArticleNou++;
                    }

                    // Imatge
                    if (!item.imagen_url && data.imagen_url) {
                        updates.imagen_url = data.imagen_url;
                        itemsAmbImgNova++;
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
                        itemsAmbDescNova++;
                    }

                    if (Object.keys(updates).length > 0) {
                        const keys = Object.keys(updates);
                        const setClauses = keys.map((k, idx) => `${k} = $${idx + 1}`).join(', ');
                        const values = [...Object.values(updates), item.id];
                        await db.query(`UPDATE wikidata SET ${setClauses} WHERE id = $${keys.length + 1}`, values);
                    }
                }
            }
            totalArticlesTrobats += batchArticles;
            console.log(`${batchArticles} articles`);
        } catch (err) {
            if (err.response?.status === 429) {
                console.log('Rate limited, esperant 15s...');
                await sleep(15000);
                i -= BATCH_SIZE; // reintentar
                continue;
            }
            console.log(`Error: ${err.message}`);
        }

        await sleep(DELAY_MS);
    }

    // Resultats
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║   ARTICLES PER IDIOMA (SITELINKS)   ║');
    console.log('╠══════════════════════════════════════╣');
    for (const w of TOTS_IDIOMES) {
        const count = statsPerIdioma[w];
        const bar = '█'.repeat(Math.round(count / Math.max(...Object.values(statsPerIdioma)) * 30));
        const isNew = IDIOMES_NOUS.includes(w) ? ' *NOU*' : '';
        console.log(`║ ${w.padEnd(4)} ${NOMS_IDIOMES[w].padEnd(14)} ${String(count).padStart(6)} ${bar}${isNew}`);
    }
    console.log('╚══════════════════════════════════════╝');
    console.log(`\nTotal sitelinks trobats: ${totalArticlesTrobats}`);

    if (actualizar) {
        console.log(`\n=== Actualitzacions ===`);
        console.log(`  Nous articles Wikipedia: ${itemsAmbArticleNou}`);
        console.log(`  Noves imatges: ${itemsAmbImgNova}`);
        console.log(`  Noves descripcions: ${itemsAmbDescNova}`);
    }

    // Stats finals
    const finalStats = {
        total: (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL')).rows[0].n,
        wikiReal: (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE wikipedia_url IS NOT NULL AND wikipedia_url NOT LIKE '%wikidata.org%'")).rows[0].n,
        senseWiki: (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL AND (wikipedia_url IS NULL OR wikipedia_url LIKE '%wikidata.org%')")).rows[0].n,
    };
    console.log(`\n  Total amb QID: ${finalStats.total}`);
    console.log(`  Amb Wikipedia real: ${finalStats.wikiReal}`);
    console.log(`  Sense Wikipedia: ${finalStats.senseWiki}`);

    if (!actualizar && itemsAmbArticleNou === 0) {
        // En mode dry run, comptar quants podrien beneficiar-se
        // (items sense wikipedia_url que tenen algun article en idiomes nous)
        console.log(`\nPer actualitzar la DB, executa: node buscar_wikipedia_extra.cjs --actualizar`);
    }

    await db.cerrar();
}

main().catch(async err => {
    console.error('Error fatal:', err.message);
    await db.cerrar();
    process.exit(1);
});
