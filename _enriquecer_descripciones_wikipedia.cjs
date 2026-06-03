/**
 * Enriquece BD secundaria por idioma con contenido de Wikipedia.
 *
 * Modos:
 *  - SIN --target-lang: usa la URL guardada en wikidata.wikipedia_url (suele ser
 *    "es"), escribe en DATABASE_URL_ENRICHMENT_ES (o legacy DATABASE_URL_ENRICHMENT)
 *  - CON --target-lang=ca/en/fr/...: usa Wikidata sitelinks (vía QID) para
 *    encontrar el título en ese idioma, escribe en DATABASE_URL_ENRICHMENT_<LANG>
 *
 * Resume automático: salta bienes ya enriquecidos en esa BD (PK bien_id).
 *
 * Uso:
 *   node _enriquecer_descripciones_wikipedia.cjs --apply --solo-famosos
 *   node _enriquecer_descripciones_wikipedia.cjs --apply --con-periodo
 *   node _enriquecer_descripciones_wikipedia.cjs --apply --target-lang=ca --con-periodo
 *   node _enriquecer_descripciones_wikipedia.cjs --apply --target-lang=en --solo-famosos
 *   node _enriquecer_descripciones_wikipedia.cjs --apply --limit=100
 *   node _enriquecer_descripciones_wikipedia.cjs --apply --ccaa='Catalunya'
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const SOLO_FAMOSOS = args.includes('--solo-famosos');
const CON_PERIODO = args.includes('--con-periodo');
const ccaaFilter = (args.find(a => a.startsWith('--ccaa=')) || '').split('=')[1] || null;
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=0').split('=')[1], 10);
const TARGET_LANG = ((args.find(a => a.startsWith('--target-lang=')) || '').split('=')[1] || '').toLowerCase();
const SLEEP_MS = 600;
const MAX_FULL_TEXT = 10000;
const SITELINKS_BATCH = 50; // wbgetentities admite hasta 50 IDs por request

const urlPri = process.env.DATABASE_URL.replace(/\s+/g, '');
const secEnvKey = TARGET_LANG ? `DATABASE_URL_ENRICHMENT_${TARGET_LANG.toUpperCase()}` : 'DATABASE_URL_ENRICHMENT_ES';
const urlSec = (process.env[secEnvKey] || process.env.DATABASE_URL_ENRICHMENT || '').replace(/^'|'$/g, '').replace(/\s+/g, '');
if (!urlSec) {
  console.error(`ERROR: ${secEnvKey} no encontrada en .env`);
  process.exit(1);
}

const poolPri = new Pool({ connectionString: urlPri, ssl: { rejectUnauthorized: false } });
const poolSec = new Pool({ connectionString: urlSec, ssl: { rejectUnauthorized: false } });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseUrl(wikipediaUrl) {
  const m = wikipediaUrl.match(/^https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/(.+)$/i);
  if (!m) return null;
  return { lang: m[1].toLowerCase(), title: decodeURIComponent(m[2].replace(/_/g, ' ')) };
}

const RETRIES = 5;
const FETCH_TIMEOUT_MS = 15000;

async function fetchExtract(lang, title) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', prop: 'extracts',
    titles: title, exlimit: '1', exsectionformat: 'wiki', explaintext: '1',
    redirects: '1',
  });
  const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;

  for (let i = 0; i < RETRIES; i++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'PatrimonioEuropeo/1.0 (contact@patrimonio-europeo.netlify.app)' },
        signal: ctrl.signal,
      });
      clearTimeout(tid);

      // Server-side transitorios → backoff exponencial 2s,4s,8s,16s,32s
      if (res.status === 429 || res.status === 503 || res.status === 504) {
        await sleep(Math.pow(2, i + 1) * 1000);
        continue;
      }
      // 4xx no-recuperables (404, 400, etc.) → error final inmediato
      if (res.status >= 400 && res.status < 500) {
        return { error: `HTTP ${res.status}` };
      }
      if (!res.ok) return { error: `HTTP ${res.status}` };

      const d = await res.json();
      const pages = d.query?.pages || {};
      const first = Object.values(pages)[0];
      if (!first || first.missing) return { error: 'missing' };
      return { extract: first.extract || '' };
    } catch (e) {
      clearTimeout(tid);
      const isNetErr = e.name === 'AbortError' ||
                       e.code === 'ECONNRESET' ||
                       e.code === 'ETIMEDOUT' ||
                       e.code === 'ENOTFOUND' ||
                       e.code === 'EAI_AGAIN' ||
                       (e.message && e.message.includes('fetch failed'));
      if (i === RETRIES - 1) return { error: `${e.code || 'EXC'}: ${e.message}` };
      // Backoff más agresivo para network errors
      const wait = isNetErr ? Math.pow(2, i + 1) * 1000 : Math.pow(2, i) * 1500;
      await sleep(wait);
    }
  }
  return { error: 'max retries exhausted' };
}

const META_SECTIONS = [
  'bibliografia', 'bibliografía', 'bibliografia utilizada', 'bibliografía utilizada',
  'enlaces externos', 'enllaços externs', 'external links', 'liens externes',
  'notas', 'notes', 'références', 'referencias', 'references',
  'véase también', 'vease tambien', 'veja també', 'vegeu també', 'see also',
  'webgrafia', 'webgrafía',
  'galeria', 'galería', 'gallery',
  'fuentes', 'fonts',
];

function normSection(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Consulta Wikidata sitelinks en batch para encontrar el título del artículo
 * en un idioma específico. Devuelve Map<qid, title> (solo entries que tienen
 * sitelink en ese idioma).
 */
async function getSitelinksBatch(qids, lang) {
  if (qids.length === 0) return new Map();
  const idsParam = qids.join('|');
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${idsParam}&props=sitelinks&sitefilter=${lang}wiki&format=json`;
  for (let i = 0; i < RETRIES; i++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'PatrimonioEuropeo/1.0 (contact@patrimonio-europeo.netlify.app)' },
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (res.status === 429 || res.status === 503 || res.status === 504) {
        await sleep(Math.pow(2, i + 1) * 1000);
        continue;
      }
      if (!res.ok) return new Map();
      const data = await res.json();
      const result = new Map();
      for (const [qid, entity] of Object.entries(data.entities || {})) {
        const sitelink = entity?.sitelinks?.[`${lang}wiki`];
        if (sitelink?.title) result.set(qid, sitelink.title);
      }
      return result;
    } catch (e) {
      clearTimeout(tid);
      if (i === RETRIES - 1) return new Map();
      await sleep(Math.pow(2, i + 1) * 1000);
    }
  }
  return new Map();
}

/**
 * Devuelve { intro, fullText }
 *   intro: texto antes del primer header (intro Wikipedia)
 *   fullText: intro + secciones no-meta concatenadas con sus títulos, truncado a MAX_FULL_TEXT
 */
function parseExtract(text) {
  if (!text) return { intro: '', fullText: '' };
  const lines = text.split(/\r?\n/);
  const headerRe = /^(={2,6})\s*(.+?)\s*\1\s*$/;

  const sections = [];
  let current = { name: null, level: 0, body: [] };
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      sections.push(current);
      current = { name: m[2].trim(), level: m[1].length, body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);

  const intro = sections[0].body.join('\n').trim();

  const parts = [intro];
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i];
    const n = normSection(s.name);
    if (META_SECTIONS.includes(n)) continue;
    // Skip si todos sus ancestros nivel-2 son meta (corta toda la rama)
    // (simplificación: solo filtramos por nombre directo, suficiente para meta-secciones típicas)
    const body = s.body.join('\n').trim();
    if (body.length > 0) {
      parts.push('\n' + s.name + '\n' + body);
    }
  }
  let fullText = parts.join('\n').trim();
  if (fullText.length > MAX_FULL_TEXT) {
    // Truncar limpiamente en fin de párrafo más cercano
    const cut = fullText.lastIndexOf('\n', MAX_FULL_TEXT);
    fullText = fullText.slice(0, cut > MAX_FULL_TEXT * 0.8 ? cut : MAX_FULL_TEXT) + '\n[...]';
  }
  return { intro, fullText };
}

(async () => {
  let scope;
  if (SOLO_FAMOSOS) scope = 'famosos (heritage_world IS NOT NULL)';
  else if (CON_PERIODO) scope = 'con periodo (heritage_world OR periodo)';
  else scope = 'todos con wikipedia_url';
  const targetInfo = TARGET_LANG ? ` | target-lang=${TARGET_LANG} (vía Wikidata sitelinks)` : '';
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'} | scope: ${scope}${targetInfo}${ccaaFilter ? ` | CCAA=${ccaaFilter}` : ''}${LIMIT ? ` | LIMIT=${LIMIT}` : ''}`);
  console.log(`BD secundaria: ${secEnvKey}`);
  console.log(`Cap full_text: ${MAX_FULL_TEXT} chars\n`);

  console.log('Cargando bien_ids ya enriquecidos en la secundaria...');
  const done = await poolSec.query('SELECT bien_id FROM wikipedia_extracts');
  const doneSet = new Set(done.rows.map(r => r.bien_id));
  console.log(`Ya enriquecidos: ${doneSet.size}`);

  const whereParts = [`w.wikipedia_url IS NOT NULL`];
  if (TARGET_LANG) whereParts.push(`w.qid IS NOT NULL`); // necesario para sitelinks
  if (SOLO_FAMOSOS) whereParts.push(`b.heritage_world IS NOT NULL`);
  else if (CON_PERIODO) whereParts.push(`(b.heritage_world IS NOT NULL OR b.periodo IS NOT NULL)`);
  if (ccaaFilter) whereParts.push(`b.comunidad_autonoma = '${ccaaFilter.replace(/'/g, "''")}'`);
  const limClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';

  const r = await poolPri.query(`
    SELECT b.id AS bien_id, w.qid, w.wikipedia_url
    FROM bienes b
    INNER JOIN wikidata w ON w.bien_id = b.id
    WHERE ${whereParts.join(' AND ')}
    ORDER BY
      CASE WHEN b.heritage_world IS NOT NULL THEN 0 ELSE 1 END,
      b.id
    ${limClause}
  `);
  const candidates = r.rows.filter(c => !doneSet.has(c.bien_id));
  console.log(`Candidatos a procesar (sin los ya hechos): ${candidates.length}\n`);
  if (candidates.length === 0) { await poolPri.end(); await poolSec.end(); return; }

  // Resolver títulos en TARGET_LANG vía Wikidata sitelinks (batch 50)
  // Solo cuando se pide explícitamente un idioma distinto al de la URL
  const titleByBienId = new Map(); // bien_id → { lang, title }
  if (TARGET_LANG) {
    console.log(`Resolviendo títulos ${TARGET_LANG} vía Wikidata sitelinks (batches de ${SITELINKS_BATCH})...`);
    for (let i = 0; i < candidates.length; i += SITELINKS_BATCH) {
      const batch = candidates.slice(i, i + SITELINKS_BATCH);
      const qids = batch.map(c => c.qid).filter(Boolean);
      const titlesMap = await getSitelinksBatch(qids, TARGET_LANG);
      for (const c of batch) {
        const t = titlesMap.get(c.qid);
        if (t) titleByBienId.set(c.bien_id, { lang: TARGET_LANG, title: t });
      }
      if ((i + SITELINKS_BATCH) % 500 === 0 || i + SITELINKS_BATCH >= candidates.length) {
        process.stdout.write(`  sitelinks [${Math.min(i + SITELINKS_BATCH, candidates.length)}/${candidates.length}] con-articulo=${titleByBienId.size}\r`);
      }
      await sleep(200); // Wikidata API rate-friendly
    }
    console.log(`\n  → ${titleByBienId.size} bienes con artículo en ${TARGET_LANG}.\n`);
  }

  let okIntro = 0, okFull = 0, errores = 0, missing = 0, sinArticuloEnLang = 0, urlInvalida = 0;
  let totalFullChars = 0;
  const preview = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];

    // Determinar lang+title para el fetch:
    let lang, title;
    if (TARGET_LANG) {
      const resolved = titleByBienId.get(c.bien_id);
      if (!resolved) { sinArticuloEnLang++; continue; } // No hay artículo en target_lang
      lang = resolved.lang;
      title = resolved.title;
    } else {
      const parsed = parseUrl(c.wikipedia_url);
      if (!parsed) { urlInvalida++; continue; } // URLs no-wikipedia (típicamente wikidata.org)
      lang = parsed.lang;
      title = parsed.title;
    }

    const { extract, error } = await fetchExtract(lang, title);
    if (error === 'missing') { missing++; }
    else if (error) { errores++; }
    else {
      const { intro, fullText } = parseExtract(extract);
      const hasIntro = intro && intro.length > 50;
      const hasFull = fullText && fullText.length > 200;
      if (hasIntro) okIntro++;
      if (hasFull) { okFull++; totalFullChars += fullText.length; }

      if (preview.length < 3 && hasFull) preview.push({
        bien_id: c.bien_id, lang, title,
        intro_len: intro.length, full_len: fullText.length,
        intro_preview: intro.slice(0, 140),
      });

      if (!DRY_RUN && (hasIntro || hasFull)) {
        try {
          await poolSec.query(`
            INSERT INTO wikipedia_extracts (bien_id, qid, lang, extract, full_text, source_url, fetched_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            ON CONFLICT (bien_id) DO UPDATE SET
              qid=EXCLUDED.qid, lang=EXCLUDED.lang, extract=EXCLUDED.extract,
              full_text=EXCLUDED.full_text, source_url=EXCLUDED.source_url, updated_at=NOW()
          `, [
            c.bien_id, c.qid, lang,
            hasIntro ? intro : null,
            hasFull ? fullText : null,
            c.wikipedia_url,
          ]);
        } catch (e) {
          errores++;
          if (errores < 5) console.error(`  ⚠ #${c.bien_id} INSERT: ${e.message}`);
        }
      }
    }

    if ((i + 1) % 25 === 0) {
      const avg = okFull > 0 ? Math.round(totalFullChars / okFull) : 0;
      const extra = TARGET_LANG
        ? ` sinLang=${sinArticuloEnLang}`
        : ` urlInv=${urlInvalida}`;
      process.stdout.write(`  [${i+1}/${candidates.length}] intro=${okIntro} full=${okFull} (avg ${avg}c) miss=${missing} err=${errores}${extra}\r`);
    }
    await sleep(SLEEP_MS);
  }

  console.log('\n\nResumen:');
  console.log(`  Procesados:           ${candidates.length}`);
  console.log(`  Con intro útil:       ${okIntro}`);
  console.log(`  Con full_text:        ${okFull}`);
  console.log(`  Avg full_text:        ${okFull > 0 ? Math.round(totalFullChars / okFull) : 0} chars`);
  console.log(`  Missing Wikipedia:    ${missing}`);
  if (TARGET_LANG) console.log(`  Sin artículo en ${TARGET_LANG}:   ${sinArticuloEnLang}`);
  else console.log(`  URLs no-wikipedia:    ${urlInvalida} (típicamente wikidata.org)`);
  console.log(`  Fetch errors reales:  ${errores}`);

  console.log('\nPreview primeros 3 con full_text:');
  preview.forEach(p => {
    console.log(`  #${p.bien_id} [${p.lang}] ${p.title.slice(0, 50)}`);
    console.log(`    intro: ${p.intro_len}c | full: ${p.full_len}c`);
    console.log(`    intro_preview: ${p.intro_preview}...`);
  });

  if (DRY_RUN) console.log('\n[DRY-RUN] Sin escribir en la BD secundaria.');

  await poolPri.end();
  await poolSec.end();
})().catch(e => { console.error(e); process.exit(1); });
