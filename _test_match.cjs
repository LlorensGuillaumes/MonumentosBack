const axios = require('axios');
const removeAccents = require('remove-accents');
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = { Accept: 'application/sparql-results+json', 'User-Agent': 'PatrimonioEspanaBot/1.0' };

function normalizarTexto(texto) {
    if (!texto) return '';
    return removeAccents(texto.toLowerCase()).replace(/[^a-z0-9 ]/g, '').trim();
}

async function test() {
    // Test SPARQL for Campins
    const sparql = `SELECT ?item ?itemLabel ?itemAltLabel WHERE {
  ?item wdt:P1435 ?heritage .
  ?item wdt:P131 ?loc .
  ?loc rdfs:label "Campins"@ca .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ca,es,en". }
}`;

    const resp = await axios.get(WIKIDATA_SPARQL, {
        params: { query: sparql, format: 'json' },
        headers: HEADERS,
        timeout: 30000,
    });

    const results = resp.data.results.bindings;
    console.log('SPARQL items per Campins:', results.length);

    // Dedup and build wdMap like the script does
    const seen = new Set();
    const wdItems = [];
    for (const r of results) {
        const qid = r.item.value.split('/').pop();
        if (seen.has(qid)) continue;
        seen.add(qid);
        wdItems.push({
            qid,
            label: r.itemLabel?.value || '',
            altLabels: r.itemAltLabel?.value || '',
        });
    }

    console.log('Unique Wikidata items:', wdItems.length);

    // Build wdMap
    const wdMap = new Map();
    for (const wd of wdItems) {
        const normLabel = normalizarTexto(wd.label);
        console.log(`  ${wd.qid} | label: "${wd.label}" -> norm: "${normLabel}" | altLabels: "${wd.altLabels}"`);
        if (normLabel) {
            if (!wdMap.has(normLabel)) wdMap.set(normLabel, []);
            wdMap.get(normLabel).push(wd);
        }
        if (wd.altLabels) {
            for (const alt of wd.altLabels.split(',')) {
                const normAlt = normalizarTexto(alt);
                if (normAlt) {
                    if (!wdMap.has(normAlt)) wdMap.set(normAlt, []);
                    wdMap.get(normAlt).push(wd);
                }
            }
        }
    }

    // Check: does 'el pis' match anything?
    const normTarget = normalizarTexto('El Pis');
    console.log('\nLooking for normalized "' + normTarget + '" in wdMap:', wdMap.has(normTarget));
    if (wdMap.has(normTarget)) {
        console.log('  Candidates:', JSON.stringify(wdMap.get(normTarget).map(c => c.qid + '=' + c.label)));
    }

    // Print all wdMap keys
    console.log('\nAll wdMap keys:');
    for (const [key, vals] of wdMap) {
        console.log(`  "${key}" -> ${vals.map(v => v.qid).join(', ')}`);
    }
}

test().catch(e => console.error(e.message));
