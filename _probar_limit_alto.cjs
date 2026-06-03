// Probar si Wikidata aguanta LIMIT 10000 en la query mayor (Galicia, 6973 items)
require('dotenv').config();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'PatrimonioEuropeoBot/1.0 (limit test)',
    },
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SPARQL ${res.status} (${ms}ms): ${txt.slice(0,300)}`);
  }
  const data = await res.json();
  return { data, ms };
}

const QUERY_GALICIA = `
  SELECT DISTINCT ?item ?itemLabel ?lat ?lng ?image ?municipioLabel WHERE {
    ?item wdt:P131* wd:Q3908 .
    ?item p:P625 ?coordStatement .
    ?coordStatement psv:P625 ?coordValue .
    ?coordValue wikibase:geoLatitude ?lat .
    ?coordValue wikibase:geoLongitude ?lng .
    OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?item wdt:P131 ?municipio }
    {
      ?item wdt:P1435 wd:Q23712 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q24398318 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q23413 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q839954 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q33506 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q4989906 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q16970 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q44613 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q16560 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q12518 .
    }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" }
  }
  LIMIT 10000
`;

(async () => {
  console.log('Probando query Galicia con LIMIT 10000...\n');
  try {
    const { data, ms } = await sparql(QUERY_GALICIA);
    console.log(`✓ OK en ${ms}ms`);
    console.log(`  Filas devueltas: ${data.results.bindings.length}`);
    const uniqueQids = new Set(data.results.bindings.map(b => b.item.value));
    console.log(`  QIDs únicos: ${uniqueQids.size}`);
  } catch (e) {
    console.log(`✗ FALLO: ${e.message}`);
  }
})();
