// Contar items REALES disponibles en Wikidata por CCAA (sin LIMIT, con COUNT)
// para detectar dónde necesitamos paginación.
require('dotenv').config();

const CCAA = [
  { nom: 'Castilla-La Mancha',     qid: 'Q5748'      },
  { nom: 'Illes Balears',          qid: 'Q107356467' },
  { nom: 'Comunidad de Madrid',    qid: 'Q5756'      },
  { nom: 'Castilla y León',        qid: 'Q5739'      },
  { nom: 'Aragón',                 qid: 'Q4040'      },
  { nom: 'Galicia',                qid: 'Q3908'      },
  { nom: 'Región de Murcia',       qid: 'Q5772'      },
  { nom: 'Canarias',               qid: 'Q5813'      },
  { nom: 'Asturias',               qid: 'Q3934'      },
  { nom: 'Extremadura',            qid: 'Q5777'      },
  { nom: 'Cantabria',              qid: 'Q3946'      },
  { nom: 'La Rioja',               qid: 'Q5727'      },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'PatrimonioEuropeoBot/1.0 (count check)',
      },
    });
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      await sleep(3000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`SPARQL ${res.status}: ${(await res.text()).slice(0,200)}`);
    return res.json();
  }
  throw new Error('SPARQL max retries');
}

// COUNT total
function countQuery(qid) {
  return `
    SELECT (COUNT(DISTINCT ?item) AS ?n) WHERE {
      ?item wdt:P131* wd:${qid} .
      ?item wdt:P625 ?coord .
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
    }
  `;
}

(async () => {
  console.log('=== Conteo REAL Wikidata por CCAA (COUNT DISTINCT) ===\n');
  console.log('CCAA                       Total WD');
  console.log('─'.repeat(45));
  let total = 0;
  for (const r of CCAA) {
    try {
      const data = await sparql(countQuery(r.qid));
      const n = parseInt(data.results.bindings[0]?.n?.value || '0', 10);
      total += n;
      const marker = n > 3000 ? ' ⚠ PAGINAR' : '';
      console.log(`${r.nom.padEnd(26)} ${String(n).padStart(6)}${marker}`);
      await sleep(1500);
    } catch (e) {
      console.log(`${r.nom.padEnd(26)} ERROR ${e.message}`);
    }
  }
  console.log('─'.repeat(45));
  console.log(`TOTAL Wikidata (12 CCAA):  ${total}`);
})().catch(e => { console.error(e); process.exit(1); });
