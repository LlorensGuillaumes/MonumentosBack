/**
 * Enriquece imágenes (P18) para bienes sin imagen pero con QID.
 *
 * Uso:
 *   node _enriquecer_imagenes_sparql.cjs           # dry-run Andalucía
 *   node _enriquecer_imagenes_sparql.cjs --apply
 *   node _enriquecer_imagenes_sparql.cjs --ccaa=Castilla-La Mancha --apply
 *   node _enriquecer_imagenes_sparql.cjs --all --apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const ALL = args.includes('--all');
const ccaaFilter = (args.find(a => a.startsWith('--ccaa=')) || '--ccaa=Andalucía').split('=')[1];
const BATCH_SIZE = 100;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

const COMMONS = (filename) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'PatrimonioEuropeoBot/1.0 (image enrichment)',
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
    SELECT ?item ?image WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P18 ?image .
    }
  `;
}

async function procesarCcaa(ccaa) {
  console.log(`\n══ ${ccaa} ══`);
  // Bienes con QID, SIN entrada w.imagen_url, SIN ninguna imagen en tabla imagenes
  const r = await pool.query(`
    SELECT b.id, w.qid, b.denominacion FROM bienes b
    INNER JOIN wikidata w ON w.bien_id=b.id
    WHERE b.pais='España' AND b.comunidad_autonoma=$1
      AND w.qid IS NOT NULL
      AND (w.imagen_url IS NULL)
      AND NOT EXISTS (SELECT 1 FROM imagenes WHERE bien_id=b.id)
    ORDER BY b.id
  `, [ccaa]);

  console.log(`Bienes sin imagen con QID: ${r.rows.length}`);
  if (r.rows.length === 0) return { intentados: 0, resueltos: 0 };

  const resolved = new Map(); // bienId → image_url
  const denoms = new Map();
  r.rows.forEach(b => denoms.set(b.id, b.denominacion));

  for (let i = 0; i < r.rows.length; i += BATCH_SIZE) {
    const batch = r.rows.slice(i, i + BATCH_SIZE);
    const qids = [...new Set(batch.map(b => b.qid))];
    try {
      const data = await sparql(buildBatchQuery(qids));
      const imgMap = new Map();
      for (const b of data.results.bindings) {
        const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
        if (!imgMap.has(qid)) imgMap.set(qid, b.image.value);
      }
      for (const it of batch) {
        const img = imgMap.get(it.qid);
        if (img) resolved.set(it.id, img);
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
      for (const [id, img] of resolved) {
        // Insertar en wikidata.imagen_url (puede que ya exista la fila, hago UPDATE)
        await client.query('UPDATE wikidata SET imagen_url=$1 WHERE bien_id=$2', [img, id]);
        // Insertar también en imagenes para ser consistentes con el resto del flujo
        await client.query(
          'INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1, $2, $3, $4)',
          [id, img, denoms.get(id) || null, 'Wikimedia Commons']
        );
      }
      await client.query('COMMIT');
      console.log(`✓ ${resolved.size} imágenes aplicadas`);
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
      WHERE b.pais='España' AND w.qid IS NOT NULL
        AND (w.imagen_url IS NULL)
        AND NOT EXISTS (SELECT 1 FROM imagenes WHERE bien_id=b.id)
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
