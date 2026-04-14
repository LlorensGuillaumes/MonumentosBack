const axios = require('axios');
const fs = require('fs');

const q = `
SELECT ?item ?itemLabel ?desc ?country ?countryLabel ?length ?img ?web WHERE {
  { ?item wdt:P31 wd:Q41150 . } UNION
  { ?item wdt:P31/wdt:P279* wd:Q41150 . } UNION
  { ?item wdt:P361 wd:Q41150 . } UNION
  { ?item wdt:P361/wdt:P361* wd:Q41150 . }
  OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) IN ("es","en","fr","it","pt")) }
  OPTIONAL { ?item wdt:P17 ?country . }
  OPTIONAL { ?item wdt:P2043 ?length . }
  OPTIONAL { ?item wdt:P18 ?img . }
  OPTIONAL { ?item wdt:P856 ?web . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,fr,it,pt". }
} LIMIT 300
`;

axios.get('https://query.wikidata.org/sparql', {
    params: { query: q, format: 'json' },
    headers: { 'User-Agent': 'PatrimonioEuropeo/1.0', 'Accept': 'application/sparql-results+json' },
    timeout: 90000
}).then(r => {
    const rows = r.data.results.bindings;
    console.log('Total:', rows.length);
    const porPais = {};
    rows.forEach(x => { const c = x.countryLabel?.value || '?'; porPais[c] = (porPais[c] || 0) + 1; });
    console.log('Por país:', porPais);
    console.log('---');
    rows.sort((a, b) => ((b.length ? 1 : 0) + (b.img ? 1 : 0)) - ((a.length ? 1 : 0) + (a.img ? 1 : 0)));
    rows.forEach(x => {
        const km = x.length ? (parseFloat(x.length.value) / 1000).toFixed(0) + 'km' : '';
        const img = x.img ? '🖼' : '';
        const w = x.web ? '🌐' : '';
        const c = (x.countryLabel?.value || '').padEnd(10);
        console.log('  ' + x.item.value.split('/').pop().padEnd(11) + ' [' + c + '] ' + (x.itemLabel?.value || '?').substring(0, 60).padEnd(60) + ' ' + km + ' ' + img + w);
        if (x.desc) console.log('             ' + x.desc.value.substring(0, 110));
    });
    fs.writeFileSync('./tmp_caminos.json', JSON.stringify(rows, null, 2));
}).catch(e => { console.error(e.message); process.exit(1); });
