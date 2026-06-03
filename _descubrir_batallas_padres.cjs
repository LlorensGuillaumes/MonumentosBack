// Para cada categoría padre, listar todos los sub-eventos (batallas/asedios) y su location
async function sparql(q) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': 'PatrimonioBot/1.0 (j.llorens@uniogestio.com)', 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).results.bindings;
}

const PADRES = {
  'Q10859': 'Guerra Civil Española',
  'Q152499': 'Guerra de Independencia Española',
  'Q150701': 'Guerra de Sucesión Española',
  'Q79791': 'Reconquista',
  'Q1178424': 'Guerras Carlistas',
  'Q1501724': 'Guerra de Restauración portuguesa',
  'Q2105495': 'Crisis de 1383-1385 (Portugal)',
  'Q164432': 'Guerra de los Ochenta Años',
  'Q51657': 'Cruzada albigense',
  'Q78994': 'Guerras Napoleónicas',
  'Q362': 'Segunda Guerra Mundial',
};

(async () => {
  const out = {};
  for (const [qidPadre, nombre] of Object.entries(PADRES)) {
    // P361 = part_of, P276 = location, P31 = instance of
    const q = `SELECT ?ev ?evLabel ?loc ?locLabel WHERE {
      ?ev wdt:P361 wd:${qidPadre}.
      OPTIONAL { ?ev wdt:P276 ?loc. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    } LIMIT 500`;
    try {
      const rows = await sparql(q);
      const eventos = {};
      for (const r of rows) {
        const eqid = r.ev.value.split('/').pop();
        if (!eventos[eqid]) eventos[eqid] = { qid: eqid, label: r.evLabel?.value || eqid, locations: [] };
        if (r.loc) eventos[eqid].locations.push({ qid: r.loc.value.split('/').pop(), label: r.locLabel?.value || '' });
      }
      out[qidPadre] = { nombre, eventos: Object.values(eventos) };
      console.log(`${qidPadre} ${nombre}: ${Object.keys(eventos).length} eventos sub-categoría`);
    } catch(e) {
      console.log(`${qidPadre} ${nombre}: ERR ${e.message}`);
      out[qidPadre] = { nombre, error: e.message };
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  require('fs').writeFileSync('_batallas_descubiertas.json', JSON.stringify(out, null, 2));
  console.log('\n→ _batallas_descubiertas.json');
})();
