/**
 * Asigna coords del CENTROIDE DEL MUNICIPIO a bienes sin coords.
 * SPARQL: para cada QID, P131 → coords del municipio.
 *
 * Uso:
 *   node _coords_centroide_municipio.cjs           # dry-run
 *   node _coords_centroide_municipio.cjs --apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const BATCH_SIZE = 100;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'PatrimonioEuropeoBot/1.0 (municipio centroid)',
      },
    });
    if ([429, 502, 503, 504].includes(res.status)) { await sleep(3000 * (i + 1)); continue; }
    if (!res.ok) throw new Error(`SPARQL ${res.status}`);
    return res.json();
  }
  throw new Error('max retries');
}

function buildBatchQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  return `
    SELECT ?item ?lat ?lng WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P131 ?mun .
      ?mun p:P625 ?cs .
      ?cs psv:P625 ?cv .
      ?cv wikibase:geoLatitude ?lat .
      ?cv wikibase:geoLongitude ?lng .
    }
  `;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  const r = await pool.query(`
    SELECT b.id, w.qid FROM bienes b
    INNER JOIN wikidata w ON w.bien_id=b.id
    WHERE b.pais='España' AND b.latitud IS NULL AND w.qid IS NOT NULL
    ORDER BY b.id
  `);
  console.log(`Bienes sin coords con QID: ${r.rows.length}`);
  if (r.rows.length === 0) { await pool.end(); return; }

  const resolved = new Map(); // bienId → {lat, lng}
  let resueltos = 0;

  for (let i = 0; i < r.rows.length; i += BATCH_SIZE) {
    const batch = r.rows.slice(i, i + BATCH_SIZE);
    const qids = [...new Set(batch.map(b => b.qid))];
    try {
      const data = await sparql(buildBatchQuery(qids));
      const coordsMap = new Map();
      for (const b of data.results.bindings) {
        const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
        if (!coordsMap.has(qid)) {
          coordsMap.set(qid, { lat: parseFloat(b.lat.value), lng: parseFloat(b.lng.value) });
        }
      }
      for (const it of batch) {
        const c = coordsMap.get(it.qid);
        if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
          resolved.set(it.id, c);
          resueltos++;
        }
      }
      process.stdout.write(`  [${Math.min(i + BATCH_SIZE, r.rows.length)}/${r.rows.length}] resueltos:${resueltos}\r`);
    } catch (e) {
      console.log(`\n  ⚠ batch fallido: ${e.message.slice(0, 80)}`);
    }
    await sleep(1000);
  }
  console.log();
  console.log(`Resueltos: ${resolved.size}/${r.rows.length}`);

  if (!DRY_RUN && resolved.size > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let done = 0;
      for (const [id, c] of resolved) {
        // Marcamos como coord aproximada poniendo precisión baja (opcional con metadata)
        await client.query(
          "UPDATE bienes SET latitud=$1, longitud=$2, coords_precision='municipio' WHERE id=$3",
          [c.lat, c.lng, id]
        );
        done++;
        if (done % 1000 === 0) console.log(`  [${done}/${resolved.size}]`);
      }
      await client.query('COMMIT');
      console.log(`✓ ${done} UPDATEs aplicados`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('ROLLBACK:', e.message);
    } finally {
      client.release();
    }
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
