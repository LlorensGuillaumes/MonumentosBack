// Obtiene provincias de las CCAA grandes de España
const CCAA_GRANDES = [
  { nom: 'Galicia',            qid: 'Q3908' },
  { nom: 'Castilla y León',    qid: 'Q5739' },
  { nom: 'Aragón',             qid: 'Q4040' },
  { nom: 'Castilla-La Mancha', qid: 'Q5748' },
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
  for (const c of CCAA_GRANDES) {
    // Buscar todas las "provincia of Spain" Q24732 ubicadas en la CCAA
    const query = `
      SELECT ?prov ?provLabel ?tipoLabel WHERE {
        ?prov wdt:P131 wd:${c.qid} .
        ?prov wdt:P31 ?tipo .
        FILTER(?tipo IN (wd:Q24732, wd:Q83116, wd:Q83037, wd:Q3032, wd:Q10864048))
        SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" }
      } ORDER BY ?provLabel
    `;
    const data = await sparql(query);
    console.log(`\n${c.nom} (${c.qid}) — ${data.results.bindings.length} provincias:`);
    data.results.bindings.forEach(b => {
      const qid = b.prov.value.replace('http://www.wikidata.org/entity/', '');
      console.log(`  ${qid.padEnd(11)} ${b.provLabel.value}`);
    });
    await new Promise(r => setTimeout(r, 800));
  }
})().catch(e => { console.error(e); process.exit(1); });
