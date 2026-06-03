/**
 * Analiza el potencial de enriquecimiento de cada CCAA débil/media:
 *  - Consulta Wikidata por items patrimoniales con coords en cada CCAA
 *  - Compara con QIDs que ya tenemos en tabla wikidata
 *  - Reporta gap = items potenciales nuevos
 *
 * No escribe nada (modo análisis). Ejecutar: node _analisis_potencial_ccaa.cjs
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// CCAA con QID + nombre real en BD
const CCAA = [
  // Medio (QIDs verificados con P31=Q10742)
  { nom: 'Castilla-La Mancha',     qid: 'Q5748',      nDB: 2901 },
  { nom: 'Illes Balears',          qid: 'Q107356467', nDB: 2800 },
  { nom: 'Comunidad de Madrid',    qid: 'Q5756',      nDB: 2655 },
  { nom: 'Castilla y León',        qid: 'Q5739',      nDB: 2577 },
  { nom: 'Aragón',                 qid: 'Q4040',      nDB: 2507 },
  // Bajo
  { nom: 'Galicia',                qid: 'Q3908',      nDB: 1073 },
  { nom: 'Región de Murcia',       qid: 'Q5772',      nDB: 481 },
  { nom: 'Canarias',               qid: 'Q5813',      nDB: 474 },
  { nom: 'Asturias',               qid: 'Q3934',      nDB: 398 },
  { nom: 'Extremadura',            qid: 'Q5777',      nDB: 374 },
  { nom: 'Cantabria',              qid: 'Q3946',      nDB: 332 },
  { nom: 'La Rioja',               qid: 'Q5727',      nDB: 267 },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'PatrimonioEuropeoBot/1.0 (CCAA gap analysis)',
      },
    });
    if (res.status === 429 || res.status === 502 || res.status === 503) {
      await sleep(2500 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`SPARQL ${res.status}`);
    return res.json();
  }
  throw new Error('SPARQL max retries');
}

function buildQuery(ccaaQid) {
  return `
    SELECT DISTINCT ?item WHERE {
      ?item wdt:P131* wd:${ccaaQid} .
      ?item wdt:P625 ?coord .
      {
        ?item wdt:P1435 wd:Q23712 .         # BIC España
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q24398318 . # iglesia
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q23413 .  # castillo
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q839954 . # yacimiento
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q33506 .  # museo
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q4989906 . # monumento
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q16970 .  # ermita
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q44613 .  # monasterio
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q16560 .  # palacio
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q12518 .  # torre
      }
    }
    LIMIT 3000
  `;
}

async function main() {
  console.log('=== Análisis de potencial Wikidata por CCAA ===\n');
  console.log('CCAA                       En BD   En WD  Ya en BD   Nuevos  Cobertura');
  console.log('─'.repeat(78));

  // Cargar todos los QIDs que ya tenemos
  const existing = await pool.query('SELECT qid FROM wikidata');
  const existSet = new Set(existing.rows.map(r => r.qid));
  console.log(`\n(QIDs ya en BD totales: ${existSet.size})\n`);

  const results = [];
  for (const r of CCAA) {
    try {
      const data = await sparql(buildQuery(r.qid));
      const qids = data.results.bindings.map(b =>
        b.item.value.replace('http://www.wikidata.org/entity/', '')
      );
      const yaTenemos = qids.filter(q => existSet.has(q)).length;
      const nuevos = qids.length - yaTenemos;
      const cobertura = qids.length > 0 ? ((yaTenemos / qids.length) * 100).toFixed(0) : '—';

      results.push({ ...r, wd: qids.length, ya: yaTenemos, nuevos, cob: cobertura });

      console.log(
        `${r.nom.padEnd(26)} ${String(r.nDB).padStart(6)}  ${String(qids.length).padStart(6)}    ${String(yaTenemos).padStart(6)}   ${String(nuevos).padStart(6)}      ${cobertura}%`
      );
      await sleep(800); // educación con WDQS
    } catch (e) {
      console.log(`${r.nom.padEnd(26)} ERROR: ${e.message}`);
    }
  }

  // Ranking por "rentabilidad" (nuevos potenciales descendente)
  console.log('\n=== Ranking por nuevos potenciales (mayor → menor) ===');
  results
    .sort((a, b) => b.nuevos - a.nuevos)
    .forEach(r =>
      console.log(`  ${String(r.nuevos).padStart(5)} nuevos  →  ${r.nom} (cobertura ${r.cob}%)`)
    );

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
