// Buscar monumentos de Vilanova i la Geltrú en Wikidata
async function sparql(q) {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'PatrimonioBot/1.0', 'Accept': 'application/sparql-results+json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
}

(async () => {
    // Q11939 = Vilanova i la Geltrú
    const query = `
        SELECT ?item ?itemLabel ?itemDesc ?lat ?lng ?image ?type ?typeLabel WHERE {
            ?item wdt:P131* wd:Q15553 .
            ?item wdt:P31 ?type .
            ?item wdt:P625 ?coords .
            BIND(geof:latitude(?coords) AS ?lat)
            BIND(geof:longitude(?coords) AS ?lng)
            OPTIONAL { ?item wdt:P18 ?image }
            FILTER (?type IN (
                wd:Q16560, wd:Q23413, wd:Q16970, wd:Q33506, wd:Q839954,
                wd:Q12518, wd:Q41176, wd:Q570116, wd:Q44613, wd:Q3947,
                wd:Q1248784, wd:Q4989906, wd:Q317557, wd:Q22698, wd:Q5107,
                wd:Q1810691, wd:Q108325, wd:Q160742, wd:Q11707, wd:Q3957
            ))
            SERVICE wikibase:label { bd:serviceParam wikibase:language "ca,es,en" }
        } LIMIT 200
    `;
    try {
        const data = await sparql(query);
        const results = data.results?.bindings || [];
        console.log('Resultados: ' + results.length + '\n');

        const seen = new Set();
        for (const b of results) {
            const qid = b.item.value.split('/').pop();
            if (seen.has(qid)) continue;
            seen.add(qid);
            const lat = parseFloat(b.lat.value).toFixed(5);
            const lng = parseFloat(b.lng.value).toFixed(5);
            const img = b.image ? '📷' : '  ';
            console.log(`  ${qid}\t${img} ${b.itemLabel.value} (${b.typeLabel.value}) [${lat},${lng}]`);
        }
    } catch (e) { console.error(e.message); }
})();
