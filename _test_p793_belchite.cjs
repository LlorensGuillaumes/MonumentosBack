// Probar SPARQL P793 (significant event) sobre QIDs Belchite
// Node 22 has global fetch

const QIDS = ['Q11057930','Q43079001','Q55431143','Q55499432','Q67914316'];

async function sparql(q) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
  const r = await (await fetch(url, { headers: { 'User-Agent': 'PatrimonioBot/1.0' } })).json();
  return r.results.bindings;
}

(async () => {
  // 1. P793 directo sobre cada QID
  for (const qid of QIDS) {
    const q = `SELECT ?ev ?evLabel WHERE { wd:${qid} wdt:P793 ?ev. SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". } }`;
    try {
      const rows = await sparql(q);
      console.log(`${qid}: ${rows.length} eventos →`, rows.map(r => `${r.ev.value.split('/').pop()} ${r.evLabel?.value || ''}`).join(' | '));
    } catch(e) { console.log(qid, 'ERR', e.message); }
  }

  // 2. Buscar eventos cuya ubicación sea Belchite (Q1019498 = Belchite municipio)
  console.log('\nBuscando QID municipio Belchite...');
  const munQ = `SELECT ?m ?mLabel WHERE { ?m wdt:P31/wdt:P279* wd:Q2074737. ?m rdfs:label "Belchite"@es. SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". } } LIMIT 5`;
  const m = await sparql(munQ);
  console.log('Municipios:', m.map(r => `${r.m.value.split('/').pop()} ${r.mLabel?.value}`).join(', '));

  // 3. Eventos en location Belchite
  for (const mun of m) {
    const munQid = mun.m.value.split('/').pop();
    const q = `SELECT ?ev ?evLabel ?cls ?clsLabel WHERE { ?ev wdt:P276 wd:${munQid}. ?ev wdt:P31 ?cls. SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". } } LIMIT 30`;
    const rows = await sparql(q);
    console.log(`\nEventos con location ${munQid}: ${rows.length}`);
    rows.forEach(r => console.log(' ', r.ev.value.split('/').pop(), '/', r.evLabel?.value, '→', r.clsLabel?.value));
  }

  // 4. Tambien P710 (participant) con Belchite
  // 5. Y P706 (located on terrain) - skip
})();
