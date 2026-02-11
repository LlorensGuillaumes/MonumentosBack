/**
 * Comprova patrimoni català a Wikidata per coordenades (bounding boxes)
 */
const axios = require('axios');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

// Bounding boxes aproximats de les províncies
const PROVINCIES = {
    'Girona': { minLat: 41.7, maxLat: 42.5, minLon: 1.7, maxLon: 3.3 },
    'Lleida': { minLat: 41.3, maxLat: 42.9, minLon: 0.3, maxLon: 1.8 },
    'Tarragona': { minLat: 40.5, maxLat: 41.5, minLon: 0.2, maxLon: 1.5 }
};

async function searchByBbox(provinceName, bbox) {
    const query = `
        SELECT ?item ?itemLabel ?coord WHERE {
            ?item wdt:P1435 ?heritage ;
                  wdt:P625 ?coord .

            # Filter by bounding box
            FILTER(
                geof:latitude(?coord) >= ${bbox.minLat} &&
                geof:latitude(?coord) <= ${bbox.maxLat} &&
                geof:longitude(?coord) >= ${bbox.minLon} &&
                geof:longitude(?coord) <= ${bbox.maxLon}
            )

            SERVICE wikibase:label { bd:serviceParam wikibase:language "ca,es,en". }
        }
        LIMIT 100
    `;

    try {
        const response = await axios.get(WIKIDATA_SPARQL, {
            params: { query, format: 'json' },
            headers: { 'User-Agent': 'PatrimonioBot/1.0' },
            timeout: 120000
        });

        return response.data.results.bindings;
    } catch (err) {
        console.error(`Error per ${provinceName}:`, err.message);
        return [];
    }
}

async function main() {
    console.log('Cerca de patrimoni per coordenades:\n');

    for (const [prov, bbox] of Object.entries(PROVINCIES)) {
        console.log(`${prov} (bbox: ${bbox.minLat}-${bbox.maxLat}, ${bbox.minLon}-${bbox.maxLon}):`);
        const items = await searchByBbox(prov, bbox);
        console.log(`  Trobats: ${items.length} ítems`);

        if (items.length > 0) {
            console.log('  Exemples:');
            items.slice(0, 5).forEach(r => {
                console.log(`    - ${r.itemLabel?.value}`);
            });
        }
        console.log();
    }
}

main();
