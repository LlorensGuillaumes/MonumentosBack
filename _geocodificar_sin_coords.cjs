/**
 * Geocodifica bienes sin coords obteniendo lat/lng desde Wikidata (P625).
 * Por defecto procesa Comunitat Valenciana, pero --ccaa=X cambia el filtro.
 *
 * Uso:
 *   node _geocodificar_sin_coords.cjs           # dry-run C. Valenciana
 *   node _geocodificar_sin_coords.cjs --apply   # aplica
 *   node _geocodificar_sin_coords.cjs --ccaa=Andalucía --apply
 *   node _geocodificar_sin_coords.cjs --all --apply   # todas las CCAA con bienes sin coords
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const ALL = args.includes('--all');
const ccaaFilter = (args.find(a => a.startsWith('--ccaa=')) || '--ccaa=Comunitat Valenciana').split('=')[1];
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
        'User-Agent': 'PatrimonioEuropeoBot/1.0 (geocoding)',
      },
    });
    if ([429, 502, 503, 504].includes(res.status)) {
      await sleep(3000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`SPARQL ${res.status}`);
    return res.json();
  }
  throw new Error('SPARQL max retries');
}

function buildBatchQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  return `
    SELECT ?item ?lat ?lng WHERE {
      VALUES ?item { ${values} }
      ?item p:P625 ?cs .
      ?cs psv:P625 ?cv .
      ?cv wikibase:geoLatitude ?lat .
      ?cv wikibase:geoLongitude ?lng .
    }
  `;
}

async function procesarCcaa(ccaa) {
  console.log(`\n══ ${ccaa} ══`);
  const r = await pool.query(`
    SELECT b.id, w.qid FROM bienes b
    INNER JOIN wikidata w ON w.bien_id=b.id
    WHERE b.pais='España' AND b.comunidad_autonoma=$1
      AND b.latitud IS NULL AND w.qid IS NOT NULL
    ORDER BY b.id
  `, [ccaa]);

  console.log(`Bienes sin coords con QID: ${r.rows.length}`);
  if (r.rows.length === 0) return { intentados: 0, resueltos: 0 };

  const resolved = new Map(); // bienId → {lat, lng}
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
        if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) resolved.set(it.id, c);
      }
      process.stdout.write(`  [${Math.min(i + BATCH_SIZE, r.rows.length)}/${r.rows.length}]\r`);
    } catch (e) {
      console.log(`\n  ⚠ batch fallido: ${e.message.slice(0, 80)}`);
    }
    await sleep(1200);
  }
  console.log();
  console.log(`Resueltos: ${resolved.size}/${r.rows.length}`);

  if (!DRY_RUN && resolved.size > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let done = 0;
      for (const [id, c] of resolved) {
        await client.query('UPDATE bienes SET latitud=$1, longitud=$2 WHERE id=$3', [c.lat, c.lng, id]);
        done++;
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
  return { intentados: r.rows.length, resueltos: resolved.size };
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}${ALL ? ' | ALL CCAA' : ` | ${ccaaFilter}`}\n`);

  let lista = [ccaaFilter];
  if (ALL) {
    const r = await pool.query(`
      SELECT DISTINCT b.comunidad_autonoma FROM bienes b
      INNER JOIN wikidata w ON w.bien_id=b.id
      WHERE b.pais='España' AND b.latitud IS NULL AND w.qid IS NOT NULL
      ORDER BY b.comunidad_autonoma
    `);
    lista = r.rows.map(x => x.comunidad_autonoma);
  }

  let totalI = 0, totalR = 0;
  for (const ccaa of lista) {
    const { intentados, resueltos } = await procesarCcaa(ccaa);
    totalI += intentados; totalR += resueltos;
  }
  console.log(`\n═══ TOTAL ═══   Intentados: ${totalI}   Resueltos: ${totalR}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
