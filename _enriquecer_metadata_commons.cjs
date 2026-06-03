/**
 * Enriquece metadata de imágenes de Wikimedia Commons.
 *
 * Para cada imagen con fuente IN ('wikidata','Wikimedia Commons','commons')
 * y metadata IS NULL, llama a la API Commons en batch de 50 títulos y guarda:
 *   - width, height (resolución)
 *   - mime, size
 *   - license (corta)
 *   - description (corta)
 *   - badges: featured, quality, valued (booleanos)
 *   - score (entero calculado a partir de badges + resolución)
 *
 * Uso:
 *   node _enriquecer_metadata_commons.cjs --apply
 *   node _enriquecer_metadata_commons.cjs --apply --limit=500
 *   node _enriquecer_metadata_commons.cjs --apply --bien-id=296609
 *
 * Resume automático: salta imágenes con metadata ya presente.
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=0').split('=')[1], 10);
const BIEN_ID = parseInt((args.find(a => a.startsWith('--bien-id=')) || '--bien-id=0').split('=')[1], 10);
const SLEEP_MS = 500;
const BATCH_SIZE = 50;
const RETRIES = 5;
const FETCH_TIMEOUT_MS = 15000;

const urlPri = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: urlPri, ssl: { rejectUnauthorized: false } });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractFilename(url) {
  const m = url.match(/Special:FilePath\/(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/_/g, ' ');
  } catch {
    return m[1].replace(/_/g, ' ');
  }
}

function detectBadges(extmetadata, categories) {
  const cats = (categories || []).map(c => (c.title || '').toLowerCase());
  const catStr = cats.join('|');
  return {
    featured: /featured\s+pictures/i.test(catStr),
    quality: /quality\s+images/i.test(catStr),
    valued: /valued\s+images/i.test(catStr),
  };
}

function computeScore(width, height, badges) {
  let s = 0;
  if (badges.featured) s += 1000;
  if (badges.quality) s += 500;
  if (badges.valued) s += 250;
  // Resolución (megapíxels normalizados, máx 100 puntos)
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
    prop: 'imageinfo|categories',
    iiprop: 'size|mime|extmetadata',
    cllimit: '50',
    // NO usar clshow=!hidden — los badges Featured/Quality/Valued son HIDDEN
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

function parsePage(page) {
  const ii = page.imageinfo?.[0] || {};
  const ext = ii.extmetadata || {};
  const badges = detectBadges(ext, page.categories);
  const license = ext.LicenseShortName?.value || null;
  const desc = ext.ImageDescription?.value || null;
  return {
    width: ii.width || null,
    height: ii.height || null,
    size: ii.size || null,
    mime: ii.mime || null,
    license,
    description: desc ? desc.substring(0, 500) : null,
    badges,
    score: computeScore(ii.width, ii.height, badges),
  };
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY RUN (sin escribir)' : 'APPLY'}`);
  console.log(`Batch size: ${BATCH_SIZE} | Sleep: ${SLEEP_MS}ms`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);
  if (BIEN_ID) console.log(`Bien específico: ${BIEN_ID}`);

  let where = `LOWER(fuente) IN ('wikidata','wikimedia commons','commons')
    AND metadata IS NULL
    AND url LIKE '%Special:FilePath/%'`;
  if (BIEN_ID) where += ` AND bien_id = ${BIEN_ID}`;
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';

  const r = await pool.query(`
    SELECT id, bien_id, url FROM imagenes
    WHERE ${where}
    ORDER BY id
    ${limitClause}
  `);
  console.log(`Candidatos: ${r.rows.length}\n`);
  if (r.rows.length === 0) { await pool.end(); return; }

  let processed = 0, withScore = 0, errors = 0, featured = 0, quality = 0, valued = 0;

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

    // Mapear título → metadata
    const pages = data.query?.pages || {};
    const normalized = data.query?.normalized || [];
    const redirects = data.query?.redirects || [];
    const titleAliasMap = {};
    normalized.forEach(n => { titleAliasMap[n.from] = n.to; });
    redirects.forEach(rd => { titleAliasMap[rd.from] = rd.to; });

    const metaByTitle = {};
    for (const pageId of Object.keys(pages)) {
      const p = pages[pageId];
      if (p.missing) continue;
      metaByTitle[p.title] = parsePage(p);
    }

    for (const row of slice) {
      const fname = extractFilename(row.url);
      if (!fname) continue;
      let title = `File:${fname}`;
      while (titleAliasMap[title]) title = titleAliasMap[title];
      const meta = metaByTitle[title];
      if (!meta) { errors++; continue; }

      if (meta.badges.featured) featured++;
      if (meta.badges.quality) quality++;
      if (meta.badges.valued) valued++;
      if (meta.score > 0) withScore++;
      processed++;

      if (!DRY_RUN) {
        await pool.query(`UPDATE imagenes SET metadata = $1 WHERE id = $2`, [meta, row.id]);
      }
    }

    if ((i + BATCH_SIZE) % 500 < BATCH_SIZE) {
      process.stdout.write(
        `  [${i + BATCH_SIZE}/${r.rows.length}] proc=${processed} feat=${featured} qual=${quality} val=${valued} err=${errors}\n`
      );
    }
    await sleep(SLEEP_MS);
  }

  console.log('\n=== Resumen ===');
  console.log(`  Procesadas:  ${processed}`);
  console.log(`  Featured:    ${featured}`);
  console.log(`  Quality:     ${quality}`);
  console.log(`  Valued:      ${valued}`);
  console.log(`  Con score:   ${withScore}`);
  console.log(`  Errores:     ${errors}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
