/**
 * Test de SPARQL queries para diagnosticar el 0 resultados.
 */
const https = require('https');

function sparqlQuery(q) {
  return new Promise((resolve, reject) => {
    const data = 'query=' + encodeURIComponent(q);
    const req = https.request(
      {
        hostname: 'query.wikidata.org',
        path: '/sparql?format=json',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'PatrimonioEuropeo/1.0 Node',
          'Accept': 'application/sparql-results+json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200)
            return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  // Test 1: encontrar Lanjarón
  console.log('\n=== Test 1: QID de Lanjarón ===');
  const q1 = `
    SELECT ?mun ?munLabel WHERE {
      ?mun wdt:P31 wd:Q2074737 .
      ?mun rdfs:label "Lanjarón"@es .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    } LIMIT 5
  `;
  const r1 = await sparqlQuery(q1);
  for (const b of r1.results.bindings) {
    console.log(`  ${b.mun.value} | ${b.munLabel?.value}`);
  }

  // Test 2: monumentos en Lanjarón sin filtros restrictivos
  console.log('\n=== Test 2: monumentos en Lanjarón (sin filtro tipo) ===');
  const q2 = `
    SELECT DISTINCT ?item ?itemLabel ?typeLabel WHERE {
      ?mun wdt:P31 wd:Q2074737 .
      ?mun rdfs:label "Lanjarón"@es .
      ?item wdt:P131 ?mun .
      ?item wdt:P31 ?type .
      ?item wdt:P625 ?coords .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    } LIMIT 50
  `;
  const r2 = await sparqlQuery(q2);
  console.log(`  Resultados: ${r2.results.bindings.length}`);
  for (const b of r2.results.bindings.slice(0, 20)) {
    console.log(`  ${b.item.value.split('/').pop()} | ${b.itemLabel?.value} | ${b.typeLabel?.value}`);
  }

  // Test 3: misma query con la lista completa de municipios target
  console.log('\n=== Test 3: monumentos en municipios target ===');
  const q3 = `
    SELECT DISTINCT ?item ?itemLabel ?munLabel ?typeLabel WHERE {
      ?mun wdt:P31 wd:Q2074737 .
      ?mun rdfs:label ?munLabelRaw .
      FILTER(LANG(?munLabelRaw) = "es")
      BIND(STR(?munLabelRaw) AS ?munLabel)
      FILTER(?munLabel IN ("Los Guájares", "Lentegí", "Ítrabo", "Jete", "Rubite", "Molvízar", "Lanjarón"))
      ?item wdt:P131 ?mun .
      ?item wdt:P31 ?type .
      ?item wdt:P625 ?coords .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    } LIMIT 200
  `;
  const r3 = await sparqlQuery(q3);
  console.log(`  Resultados: ${r3.results.bindings.length}`);
  for (const b of r3.results.bindings.slice(0, 30)) {
    console.log(`  [${b.munLabel.value}] ${b.item.value.split('/').pop()} | ${b.itemLabel?.value} | ${b.typeLabel?.value}`);
  }
})();
