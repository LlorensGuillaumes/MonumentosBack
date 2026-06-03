// Verifica QIDs correctos de las CCAA cuyo análisis salió 0
require('dotenv').config();

const NOMS = [
  'Aragon', 'Aragón', 'Illes Balears', 'Islas Baleares', 'Balearic Islands',
  'Extremadura', 'Castilla y León', 'Castile and León',
];

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PE/1.0' },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);
  return res.json();
}

(async () => {
  // Buscar CCAA: las CCAA tienen P31 = Q10742 (autonomous community of Spain)
  const query = `
    SELECT ?item ?itemLabel WHERE {
      ?item wdt:P31 wd:Q10742 .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" }
    }
    ORDER BY ?itemLabel
  `;
  const data = await sparql(query);
  console.log('=== CCAA España (P31=Q5852411, P17=Q29) ===');
  data.results.bindings.forEach(b => {
    const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
    console.log(`  ${qid.padEnd(10)} ${b.itemLabel.value}`);
  });
})().catch(e => { console.error(e); process.exit(1); });
