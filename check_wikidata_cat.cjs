/**
 * Comprova quants ítems de patrimoni hi ha a Wikidata per les províncies catalanes
 */
const axios = require('axios');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

// QIDs de les províncies catalanes
const PROVINCIES = {
    'Barcelona': 'Q81949',
    'Girona': 'Q7105',
    'Lleida': 'Q15083',
    'Tarragona': 'Q15085'
};

async function countByProvince(provinceName, qid) {
    const query = `
        SELECT (COUNT(DISTINCT ?item) as ?total) WHERE {
            ?item wdt:P1435 ?heritage ;
                  wdt:P131 ?loc .
            ?loc wdt:P131* wd:${qid} .
        }
    `;

    try {
        const response = await axios.get(WIKIDATA_SPARQL, {
            params: { query, format: 'json' },
            headers: { 'User-Agent': 'PatrimonioBot/1.0' },
            timeout: 60000
        });

        const total = response.data.results.bindings[0]?.total?.value || 0;
        return parseInt(total);
    } catch (err) {
        console.error(`Error per ${provinceName}:`, err.message);
        return 0;
    }
}

async function main() {
    console.log('Patrimoni a Wikidata per província catalana:\n');

    let totalCat = 0;
    for (const [prov, qid] of Object.entries(PROVINCIES)) {
        const count = await countByProvince(prov, qid);
        console.log(`  ${prov}: ${count} ítems`);
        totalCat += count;
    }

    console.log(`\nTotal Catalunya: ${totalCat} ítems a Wikidata`);
    console.log('\nNota: Barcelona ja la tenim via DIBA (41,564 ítems)');
    console.log('Les altres 3 províncies es podrien afegir des de Wikidata.');
}

main();
