const axios = require('axios');
const SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = { Accept: 'application/sparql-results+json', 'User-Agent': 'PatrimonioBot/1.0' };

async function main() {
    // Approach: get all Portuguese municipalities and their district via P131
    // Portuguese municipalities (concelhos) are instance of Q13217644
    // They should have P131 pointing to district
    const query = `
SELECT ?mun ?munLabel ?distrito ?distritoLabel WHERE {
    ?mun wdt:P31 wd:Q13217644 .
    ?mun wdt:P131 ?distrito .
    ?distrito wdt:P31 wd:Q766106 .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
`;
    console.log('Querying Portuguese municipalities → districts...');
    const res = await axios.get(SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 120000,
    });

    const mapping = {};
    for (const r of res.data.results.bindings) {
        const munName = r.munLabel?.value;
        const distName = r.distritoLabel?.value;
        const distQid = r.distrito.value.split('/').pop();
        if (munName && distName) {
            mapping[munName] = { distrito: distName, qid: distQid };
        }
    }

    console.log(`Found ${Object.keys(mapping).length} municipality → district mappings`);
    console.log('Sample:', Object.entries(mapping).slice(0, 10));
}

main().catch(e => console.error('Error:', e.message));
