/**
 * Re-chequea badges (Featured/Quality/Valued) en imágenes ya enriquecidas con metadata.
 * El script original _enriquecer_metadata_commons.cjs usaba clshow=!hidden que excluía
 * las categorías de calidad (son hidden en Commons). Este script re-pide solo categorías
 * sin filtro y actualiza metadata.badges + metadata.score.
 *
 * Uso:
 *   node _recheck_badges_commons.cjs --apply
 *   node _recheck_badges_commons.cjs --apply --limit=100
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=0').split('=')[1], 10);
const SLEEP_MS = 500;
const BATCH_SIZE = 50;
const RETRIES = 5;
const FETCH_TIMEOUT_MS = 15000;

const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractFilename(url) {
  const m = url.match(/Special:FilePath\/(.+)$/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).replace(/_/g, ' '); }
  catch { return m[1].replace(/_/g, ' '); }
}

function detectBadges(categories) {
  const cats = (categories || []).map(c => (c.title || '').toLowerCase());
  const catStr = cats.join('|');
  return {
    featured: /featured\s+pictures/i.test(catStr),
    quality: /quality\s+images/i.test(catStr),
    valued: /valued\s+images/i.test(catStr),
  };
}

function recomputeScore(width, height, badges) {
  let s = 0;
  if (badges.featured) s += 1000;
  if (badges.quality) s += 500;
  if (badges.valued) s += 250;
  if (width && height) {
    const mp = (width * height) / 1_000_000;
    s += Math.min(100, Math.round(mp * 10));
  }
  return s;
}

async function fetchBatch(filenames) {
  const titles = filenames.map(f => `File:${f}`).join('|');
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'categories',
    cllimit: '50',
    // SIN clshow=!hidden — los badges son categorías hidden
    titles,
    redirects: '1',
  });

  for (let i = 0; i < RETRIES; i++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
        headers: { 'User-Agent': 'PatrimonioEuropeo/1.0 (contact@patrimonio-europeo.netlify.app)' },
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (res.status === 429 || res.status === 503 || res.status === 504) {
        await sleep(Math.pow(2, i + 1) * 1000);
        continue;
      }
      if (res.status >= 400) return { error: `HTTP ${res.status}` };
      const data = await res.json();
      return { data };
    } catch (e) {
      clearTimeout(tid);
      if (i === RETRIES - 1) return { error: `${e.code || 'EXC'}: ${e.message}` };
      await sleep(Math.pow(2, i + 1) * 1000);
    }
  }
  return { error: 'max retries' };
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);

  let where = `LOWER(fuente) IN ('wikidata','wikimedia commons','commons')
    AND metadata IS NOT NULL
    AND url LIKE '%Special:FilePath/%'`;
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';

  const r = await pool.query(`
    SELECT id, bien_id, url, metadata FROM imagenes
    WHERE ${where}
    ORDER BY id
    ${limitClause}
  `);
  console.log(`Candidatos: ${r.rows.length}\n`);
  if (r.rows.length === 0) { await pool.end(); return; }

  let processed = 0, featured = 0, quality = 0, valued = 0, updated = 0, errors = 0;

  for (let i = 0; i < r.rows.length; i += BATCH_SIZE) {
    const slice = r.rows.slice(i, i + BATCH_SIZE);
    const filenames = slice.map(row => extractFilename(row.url)).filter(Boolean);
    if (filenames.length === 0) continue;

    const { data, error } = await fetchBatch(filenames);
    if (error) {
      errors += slice.length;
      console.log(`  ⚠ Batch ${i}-${i + slice.length} ERROR: ${error}`);
      await sleep(SLEEP_MS);
      continue;
    }

    const pages = data.query?.pages || {};
    const titleAliasMap = {};
    (data.query?.normalized || []).forEach(n => { titleAliasMap[n.from] = n.to; });
    (data.query?.redirects || []).forEach(rd => { titleAliasMap[rd.from] = rd.to; });

    const catsByTitle = {};
    for (const pageId of Object.keys(pages)) {
      const p = pages[pageId];
      if (!p.missing) catsByTitle[p.title] = p.categories || [];
    }

    for (const row of slice) {
      const fname = extractFilename(row.url);
      if (!fname) continue;
      let title = `File:${fname}`;
      while (titleAliasMap[title]) title = titleAliasMap[title];
      const cats = catsByTitle[title];
      if (cats === undefined) { errors++; continue; }

      const badges = detectBadges(cats);
      const meta = row.metadata || {};
      const newMeta = { ...meta, badges, score: recomputeScore(meta.width, meta.height, badges) };

      if (badges.featured) featured++;
      if (badges.quality) quality++;
      if (badges.valued) valued++;
      processed++;
      const hasAnyBadge = badges.featured || badges.quality || badges.valued;
      if (hasAnyBadge && !DRY_RUN) {
        await pool.query(`UPDATE imagenes SET metadata = $1 WHERE id = $2`, [newMeta, row.id]);
        updated++;
      } else if (!DRY_RUN) {
        // Update igualmente para que badges:{false,false,false} quede explícito
        await pool.query(`UPDATE imagenes SET metadata = $1 WHERE id = $2`, [newMeta, row.id]);
        updated++;
      }
    }

    if ((i + BATCH_SIZE) % 500 < BATCH_SIZE) {
      process.stdout.write(
        `  [${i + BATCH_SIZE}/${r.rows.length}] feat=${featured} qual=${quality} val=${valued} upd=${updated} err=${errors}\n`
      );
    }
    await sleep(SLEEP_MS);
  }

  console.log('\n=== Resumen ===');
  console.log(`  Procesadas: ${processed}`);
  console.log(`  Featured:   ${featured}`);
  console.log(`  Quality:    ${quality}`);
  console.log(`  Valued:     ${valued}`);
  console.log(`  Updated:    ${updated}`);
  console.log(`  Errores:    ${errors}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
