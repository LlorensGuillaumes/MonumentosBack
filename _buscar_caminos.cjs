const axios = require('axios');
const fs = require('fs');

const SPARQL = 'https://query.wikidata.org/sparql';
const HEAD = { 'User-Agent': 'PatrimonioEuropeo/1.0', 'Accept': 'application/sparql-results+json' };

async function sparql(q) {
    const r = await axios.get(SPARQL, { params: { query: q, format: 'json' }, headers: HEAD, timeout: 90000 });
    return r.data.results.bindings;
}

(async () => {
    // 1. Buscar el QID raíz "Way of Saint James"
    console.log('=== Buscando ítems "Way of Saint James" ===');
    const search = await sparql(`
        SELECT ?item ?itemLabel ?desc WHERE {
          ?item rdfs:label "Way of Saint James"@en .
          OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc)="en") }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        } LIMIT 5
    `);
    search.forEach(r => console.log('  ' + r.item.value.split('/').pop() + ' - ' + r.itemLabel?.value + ' :: ' + (r.desc?.value||'')));

    // 2. Buscar todos los ítems que sean subclase o instancia de Camino de Santiago Q12101
    console.log('\n=== Subclases/instancias de Q12101 (Way of St James) ===');
    const subs = await sparql(`
        SELECT ?item ?itemLabel ?desc ?country ?countryLabel ?length ?img WHERE {
          { ?item wdt:P31 wd:Q12101 . } UNION { ?item wdt:P31/wdt:P279* wd:Q12101 . }
          OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) IN ("es","en","fr","it","pt")) }
          OPTIONAL { ?item wdt:P17 ?country . }
          OPTIONAL { ?item wdt:P2043 ?length . }
          OPTIONAL { ?item wdt:P18 ?img . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,fr,it,pt". }
        } LIMIT 200
    `);
    console.log('  ' + subs.length + ' resultados');
    subs.slice(0, 30).forEach(r => {
        const km = r.length ? (parseFloat(r.length.value)/1000).toFixed(0)+'km' : '';
        const img = r.img ? '🖼' : '';
        const c = r.countryLabel?.value || '';
        console.log('  ' + r.item.value.split('/').pop().padEnd(11) + ' [' + c.padEnd(8) + '] ' + (r.itemLabel?.value||'?').substring(0,55).padEnd(55) + ' ' + km + img);
        if (r.desc) console.log('              ' + r.desc.value.substring(0,100));
    });

    fs.writeFileSync('./tmp_caminos.json', JSON.stringify(subs, null, 2));
    console.log('\n  → ' + subs.length + ' guardadas en tmp_caminos.json');

    // 3. Probar enfoque alternativo: items en P361 (part of) Q12101
    console.log('\n=== Items "part of" Q12101 (Camino de Santiago) ===');
    const partOf = await sparql(`
        SELECT ?item ?itemLabel ?desc ?country ?countryLabel ?length ?img WHERE {
          ?item wdt:P361 wd:Q12101 .
          OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) IN ("es","en","fr","it","pt")) }
          OPTIONAL { ?item wdt:P17 ?country . }
          OPTIONAL { ?item wdt:P2043 ?length . }
          OPTIONAL { ?item wdt:P18 ?img . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
        } LIMIT 100
    `);
    console.log('  ' + partOf.length + ' resultados');
    partOf.forEach(r => {
        const km = r.length ? (parseFloat(r.length.value)/1000).toFixed(0)+'km' : '';
        const img = r.img ? '🖼' : '';
        const c = r.countryLabel?.value || '';
        console.log('  ' + r.item.value.split('/').pop().padEnd(11) + ' [' + c.padEnd(8) + '] ' + (r.itemLabel?.value||'?').substring(0,55).padEnd(55) + ' ' + km + img);
    });
})().catch(e => { console.error(e.message); process.exit(1); });
