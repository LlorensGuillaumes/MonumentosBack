/**
 * Infiere periodo para bienes con QID sin periodo:
 *  - P149 (estilo arquitectónico) → mapea QID estilo a periodo
 *  - P571 (inception/fecha construcción) → mapea por siglo a periodo
 *
 * Uso:
 *   node _inferir_periodo_sparql.cjs           # dry-run
 *   node _inferir_periodo_sparql.cjs --apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const BATCH_SIZE = 100;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Mapeo QID de estilo → periodo BD
const ESTILO_QID_A_PERIODO = {
  'Q176483':  'Gótico',           // arquitectura gótica
  'Q46261':   'Románico',         // arquitectura románica
  'Q236122':  'Renacimiento',     // arquitectura del Renacimiento
  'Q840829':  'Barroco',          // arquitectura barroca
  'Q54111':   'Neoclásico',       // arquitectura neoclásica
  'Q9159129': 'Prerrománico',     // arquitectura prerrománica
  'Q52713635':'Mozárabe',         // arquitectura mozárabe
  'Q4692':    'Renacimiento',     // Renaissance (genérico)
  'Q35197':   'Gótico',           // Gothic (genérico)
  'Q132137':  'Románico',         // Romanesque
  'Q199436':  'Visigodo',         // Visigothic art
  'Q179050':  'Mudéjar',          // Mudejar
  'Q188043':  'Art Decó',         // Art Deco
  'Q173782':  'Modernismo',       // modernismo (style)
  'Q41311':   'Modernismo',       // Art Nouveau
  'Q104451':  'Modernismo',       // Catalan Modernism
  'Q5783':    'Antiguo / Romano', // Roman architecture
  'Q133156':  'Antiguo / Romano', // Ancient Roman architecture
  'Q205049':  'Antiguo / Romano', // Roman
};

// Periodo por siglo (siglo = floor(year/100) + 1)
function periodoPorAnio(year) {
  if (year == null || isNaN(year)) return null;
  if (year < -1000) return 'Prehistoria';
  if (year < 500)   return 'Antiguo / Romano';
  if (year < 1000)  return 'Prerrománico';
  if (year < 1250)  return 'Románico';
  if (year < 1500)  return 'Gótico';
  if (year < 1620)  return 'Renacimiento';
  if (year < 1770)  return 'Barroco';
  if (year < 1870)  return 'Neoclásico';
  if (year < 1925)  return 'Modernismo';
  return 'Contemporáneo';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PE/1.0 (periodo)' },
    });
    if ([429,502,503,504].includes(res.status)) { await sleep(3000*(i+1)); continue; }
    if (!res.ok) throw new Error(`SPARQL ${res.status}`);
    return res.json();
  }
  throw new Error('max retries');
}

function buildBatchQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  return `
    SELECT ?item ?style ?inception WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?item wdt:P149 ?style }
      OPTIONAL { ?item wdt:P571 ?inception }
    }
  `;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  const r = await pool.query(`
    SELECT b.id, w.qid FROM bienes b
    INNER JOIN wikidata w ON w.bien_id=b.id
    WHERE b.pais='España' AND b.periodo IS NULL AND w.qid IS NOT NULL
    ORDER BY b.id
  `);
  console.log(`Bienes sin periodo con QID: ${r.rows.length}`);
  if (r.rows.length === 0) { await pool.end(); return; }

  const resolved = new Map(); // bienId → periodo
  const fuente = { estilo: 0, inception: 0 };
  let porTipo = new Map();

  for (let i = 0; i < r.rows.length; i += BATCH_SIZE) {
    const batch = r.rows.slice(i, i + BATCH_SIZE);
    const qids = [...new Set(batch.map(b => b.qid))];
    try {
      const data = await sparql(buildBatchQuery(qids));
      // Agrupar por QID (puede tener varios estilos / fechas)
      const styleMap = new Map(); // qid → Set(styleQid)
      const inceptionMap = new Map(); // qid → year
      for (const b of data.results.bindings) {
        const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
        if (b.style) {
          const sq = b.style.value.replace('http://www.wikidata.org/entity/', '');
          if (!styleMap.has(qid)) styleMap.set(qid, new Set());
          styleMap.get(qid).add(sq);
        }
        if (b.inception && !inceptionMap.has(qid)) {
          const m = b.inception.value.match(/^(-?)(\d+)-/);
          if (m) {
            const year = parseInt(m[2], 10) * (m[1] === '-' ? -1 : 1);
            inceptionMap.set(qid, year);
          }
        }
      }
      for (const it of batch) {
        if (resolved.has(it.id)) continue;
        // Prioridad 1: estilo
        const styles = styleMap.get(it.qid);
        if (styles) {
          for (const sq of styles) {
            if (ESTILO_QID_A_PERIODO[sq]) {
              resolved.set(it.id, ESTILO_QID_A_PERIODO[sq]);
              fuente.estilo++;
              break;
            }
          }
        }
        if (resolved.has(it.id)) continue;
        // Prioridad 2: inception → siglo
        const year = inceptionMap.get(it.qid);
        if (year != null) {
          const p = periodoPorAnio(year);
          if (p) {
            resolved.set(it.id, p);
            fuente.inception++;
          }
        }
      }
      process.stdout.write(`  [${Math.min(i+BATCH_SIZE, r.rows.length)}/${r.rows.length}] resueltos:${resolved.size}\r`);
    } catch (e) {
      console.log(`\n  ⚠ batch fallido: ${e.message.slice(0,80)}`);
    }
    await sleep(1000);
  }
  console.log();
  for (const v of resolved.values()) porTipo.set(v, (porTipo.get(v) || 0) + 1);
  console.log(`Resueltos: ${resolved.size}/${r.rows.length}`);
  console.log(`  Por estilo (P149): ${fuente.estilo}`);
  console.log(`  Por inception (P571): ${fuente.inception}`);
  console.log(`\nDistribución por periodo:`);
  [...porTipo.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,n])=>console.log(`  ${String(n).padStart(6)}  ${k}`));

  if (!DRY_RUN && resolved.size > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let done = 0;
      for (const [id, periodo] of resolved) {
        await client.query('UPDATE bienes SET periodo=$1 WHERE id=$2', [periodo, id]);
        done++;
        if (done % 1000 === 0) console.log(`  [${done}/${resolved.size}]`);
      }
      await client.query('COMMIT');
      console.log(`\n✓ ${done} UPDATEs aplicados`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('ROLLBACK:', e.message);
    } finally {
      client.release();
    }
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
