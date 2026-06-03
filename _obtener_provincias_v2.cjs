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
    const query = `
      SELECT ?prov ?provLabel WHERE {
        wd:${c.qid} wdt:P150 ?prov .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" }
      } ORDER BY ?provLabel
    `;
    const data = await sparql(query);
    console.log(`\n${c.nom}:`);
    const provs = data.results.bindings.map(b => ({
      qid: b.prov.value.replace('http://www.wikidata.org/entity/', ''),
      label: b.provLabel.value,
    }));
    provs.forEach(p => console.log(`  { qid: '${p.qid}', label: '${p.label}' },`));
    await new Promise(r => setTimeout(r, 800));
  }
})().catch(e => { console.error(e); process.exit(1); });
