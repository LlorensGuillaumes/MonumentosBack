// Buscar las 4 provincias de Galicia por nombre
const names = ['A Coruña', 'Lugo', 'Ourense', 'Pontevedra'];

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PE/1.0' },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);
  return res.json();
}

(async () => {
  // Provincias en Galicia con sus QIDs
  const query = `
    SELECT ?prov ?provLabel ?tipoLabel WHERE {
      ?prov wdt:P31 wd:Q24732 .
      ?prov wdt:P131 wd:Q3908 .
      OPTIONAL { ?prov wdt:P31 ?tipo }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" }
    }
  `;
  const data = await sparql(query);
  console.log('Provincias Galicia (P31=Q24732, P131=Q3908):');
  data.results.bindings.forEach(b => {
    const qid = b.prov.value.replace('http://www.wikidata.org/entity/', '');
    console.log(`  ${qid.padEnd(11)} ${b.provLabel.value}`);
  });

  // Si no encuentra nada, otro intento con P150 (subdivision)
  console.log('\nIntento 2 — P150 (subdivisiones administrativas de Galicia):');
  const query2 = `
    SELECT ?prov ?provLabel WHERE {
      wd:Q3908 wdt:P150 ?prov .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" }
    }
  `;
  const data2 = await sparql(query2);
  data2.results.bindings.forEach(b => {
    const qid = b.prov.value.replace('http://www.wikidata.org/entity/', '');
    console.log(`  ${qid.padEnd(11)} ${b.provLabel.value}`);
  });
})().catch(e => { console.error(e); process.exit(1); });
