/**
 * Enriquece galería histórica con Europeana Search API.
 *
 * Selecciona bienes "famosos" (heritage_world IS NOT NULL OR alta relevancia),
 * busca imágenes históricas en Europeana y las inserta en `imagenes` con
 * fuente='europeana' y metadata JSONB (provider, year, rights, edmIsShownAt).
 *
 * Estrategia:
 *  - Query: "<denominacion> <municipio>"
 *  - Filtro: TYPE:IMAGE
 *  - rows: hasta 6 por bien (suficiente para galería)
 *  - Skip si el bien ya tiene imágenes con fuente='europeana'
 *
 * Uso:
 *   node _enriquecer_europeana.cjs                 # dry-run, solo UNESCO/EHL
 *   node _enriquecer_europeana.cjs --apply
 *   node _enriquecer_europeana.cjs --all --apply   # todos los famosos
 *   node _enriquecer_europeana.cjs --limit=50      # limitar items procesados
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const ALL = args.includes('--all');
const COMPLETAR = args.includes('--completar'); // items con QID sin imagen, sin entrar en --all
const ccaaFilter = (args.find(a => a.startsWith('--ccaa=')) || '').split('=')[1] || null;
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=0').split('=')[1], 10);
const MAX_PER_BIEN = 6;
const KEY = process.env.EUROPEANA_APIKEY;

if (!KEY) {
  console.error('ERROR: EUROPEANA_APIKEY no encontrada en .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function europeanaSearch(query) {
  const url = `https://api.europeana.eu/record/v2/search.json?wskey=${KEY}&query=${encodeURIComponent(query)}&qf=TYPE:IMAGE&rows=${MAX_PER_BIEN}&profile=rich`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url);
    if (res.status === 429) { await sleep(2000 * (i + 1)); continue; }
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };
    const d = await res.json();
    if (!d.success) return { items: [], error: d.error || 'unknown' };
    return { items: d.items || [] };
  }
  return { items: [], error: 'max retries' };
}

function extractFields(it) {
  const firstThumb = it.edmPreview?.[0];
  // edmPreview viene como "https://api.europeana.eu/thumbnail/v2/url.json?uri=..." — ya es el thumbnail directo
  if (!firstThumb) return null;
  const title = (it.title?.[0] || it.dcTitleLangAware?.es?.[0] || it.dcTitleLangAware?.en?.[0] || 'Sin título').slice(0, 250);
  const provider = it.dataProvider?.[0] || it.provider?.[0] || null;
  const year = it.year?.[0] || null;
  const rights = it.rights?.[0] || null;
  const link = it.edmIsShownAt?.[0] || it.guid || null;
  return {
    url: firstThumb,
    titulo: title,
    autor: provider,
    metadata: { year, rights, link, source: 'europeana' },
  };
}

(async () => {
  const scope = COMPLETAR ? 'COMPLETAR (sin imagen, no en --all)' : (ALL ? 'TODOS famosos' : 'UNESCO/EHL solo');
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'} | scope: ${scope}${ccaaFilter ? ` | CCAA=${ccaaFilter}` : ''}${LIMIT ? ` | LIMIT ${LIMIT}` : ''}`);
  console.log(`Key: ${KEY.slice(0, 4)}***\n`);

  let where;
  if (COMPLETAR) {
    where = `(b.heritage_world IS NULL AND b.periodo IS NULL)`;
  } else if (ALL) {
    where = `(b.heritage_world IS NOT NULL OR b.periodo IS NOT NULL)`;
  } else {
    where = `b.heritage_world IS NOT NULL`;
  }
  if (ccaaFilter) {
    where += ` AND b.comunidad_autonoma = '${ccaaFilter.replace(/'/g, "''")}'`;
  }
  const limClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';

  const r = await pool.query(`
    SELECT b.id, b.denominacion, b.municipio, b.provincia
    FROM bienes b
    WHERE ${where}
      AND b.denominacion IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM imagenes WHERE bien_id=b.id AND fuente='europeana')
    ORDER BY
      CASE WHEN b.heritage_world IS NOT NULL THEN 0 ELSE 1 END,
      b.id
    ${limClause}
  `);
  console.log(`Bienes a procesar: ${r.rows.length}\n`);
  if (r.rows.length === 0) { await pool.end(); return; }

  let conImagenes = 0, sinImagenes = 0, totalImgsInsertadas = 0;
  const updates = []; // { bien_id, items: [...] }

  for (let i = 0; i < r.rows.length; i++) {
    const b = r.rows[i];
    const q = `${b.denominacion} ${b.municipio || ''}`.trim();
    const { items, error } = await europeanaSearch(q);
    if (error) {
      console.log(`  ⚠ #${b.id} "${q.slice(0,40)}" - ${error}`);
      sinImagenes++;
    } else if (items.length === 0) {
      sinImagenes++;
    } else {
      const parsed = items.map(extractFields).filter(Boolean);
      if (parsed.length > 0) {
        updates.push({ bien_id: b.id, items: parsed });
        totalImgsInsertadas += parsed.length;
        conImagenes++;
      } else {
        sinImagenes++;
      }
    }
    if ((i + 1) % 10 === 0) {
      process.stdout.write(`  [${i+1}/${r.rows.length}] con=${conImagenes} sin=${sinImagenes} imgs=${totalImgsInsertadas}\r`);
    }
    await sleep(600); // respetuoso con Europeana
  }
  console.log();
  console.log(`\nResumen:`);
  console.log(`  Bienes con imágenes encontradas: ${conImagenes}`);
  console.log(`  Bienes sin resultado:            ${sinImagenes}`);
  console.log(`  Total imágenes a insertar:       ${totalImgsInsertadas}`);

  // Muestra
  console.log('\nPreview primeros 3 con imágenes:');
  updates.slice(0, 3).forEach(u => {
    console.log(`  bien #${u.bien_id}:`);
    u.items.slice(0, 3).forEach(it =>
      console.log(`    - ${it.titulo.slice(0,50)}  [${it.autor || '?'} ${it.metadata.year || ''}]`)
    );
  });

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Sin escribir.');
    await pool.end();
    return;
  }

  // Insertar
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      for (const it of u.items) {
        await client.query(
          `INSERT INTO imagenes (bien_id, url, titulo, autor, fuente, metadata)
           VALUES ($1, $2, $3, $4, 'europeana', $5)
           ON CONFLICT DO NOTHING`,
          [u.bien_id, it.url, it.titulo, it.autor, JSON.stringify(it.metadata)]
        );
        inserted++;
      }
      if (inserted % 200 === 0) console.log(`  [${inserted} insertados]`);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${inserted} imágenes insertadas`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
