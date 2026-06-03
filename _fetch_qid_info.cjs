async function fetchQid(qid) {
    const sparql = `
        SELECT ?itemLabel ?itemDesc ?lat ?lng ?image ?inception ?country ?countryLabel
               ?admin ?adminLabel ?admin2 ?admin2Label ?admin3 ?admin3Label
               ?style ?styleLabel ?heritage ?heritageLabel ?type ?typeLabel
               ?commonsCat ?merimee
        WHERE {
            BIND(wd:${qid} AS ?item)
            OPTIONAL { ?item wdt:P625 ?coords . BIND(geof:latitude(?coords) AS ?lat) BIND(geof:longitude(?coords) AS ?lng) }
            OPTIONAL { ?item wdt:P18 ?image }
            OPTIONAL { ?item wdt:P571 ?inception }
            OPTIONAL { ?item wdt:P17 ?country }
            OPTIONAL { ?item wdt:P131 ?admin . OPTIONAL { ?admin wdt:P131 ?admin2 . OPTIONAL { ?admin2 wdt:P131 ?admin3 } } }
            OPTIONAL { ?item wdt:P149 ?style }
            OPTIONAL { ?item wdt:P1435 ?heritage }
            OPTIONAL { ?item wdt:P31 ?type }
            OPTIONAL { ?item wdt:P373 ?commonsCat }
            OPTIONAL { ?item wdt:P380 ?merimee }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,fr,pt,en,it,de" }
        }
    `;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'PatrimonioBot/1.0', 'Accept': 'application/sparql-results+json' } });
    if (!r.ok) { console.log('HTTP ' + r.status); return null; }
    const data = await r.json();
    const bindings = data.results?.bindings || [];
    if (bindings.length === 0) { console.log(qid + ': sin datos'); return null; }

    // Coalesce
    const merged = { qid };
    for (const b of bindings) {
        for (const k of Object.keys(b)) {
            if (!merged[k]) merged[k] = b[k].value;
        }
    }
    return merged;
}

(async () => {
    for (const qid of ['Q126488453', 'Q771935']) {
        console.log('\n=== ' + qid + ' ===');
        const info = await fetchQid(qid);
        if (!info) continue;
        console.log('Label:    ' + (info.itemLabel || ''));
        console.log('Desc:     ' + (info.itemDesc || ''));
        console.log('Coords:   ' + (info.lat || '') + ',' + (info.lng || ''));
        console.log('Image:    ' + (info.image || ''));
        console.log('Inception:' + (info.inception || ''));
        console.log('Country:  ' + (info.countryLabel || ''));
        console.log('Admin:    ' + (info.adminLabel || '') + ' / ' + (info.admin2Label || '') + ' / ' + (info.admin3Label || ''));
        console.log('Style:    ' + (info.styleLabel || ''));
        console.log('Heritage: ' + (info.heritageLabel || ''));
        console.log('Type:     ' + (info.typeLabel || ''));
        console.log('Commons:  ' + (info.commonsCat || ''));
        console.log('Merimee:  ' + (info.merimee || ''));
        await new Promise(r => setTimeout(r, 500));
    }
})();
