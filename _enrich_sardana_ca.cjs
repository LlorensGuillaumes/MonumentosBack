require('dotenv').config();
const { Pool } = require('pg');
const urlCa = (process.env.DATABASE_URL_ENRICHMENT_CA || '').replace(/^'|'$/g, '').replace(/\s+/g, '');
if (!urlCa) { console.error('Falta DATABASE_URL_ENRICHMENT_CA'); process.exit(1); }
const pool = new Pool({ connectionString: urlCa, ssl: { rejectUnauthorized: false } });

const BIEN_ID = 296609;
const QID = 'Q99455699';
const LANG = 'ca';
const TITLE = 'Monument a la Sardana (Barcelona)';
const SOURCE_URL = 'https://ca.wikipedia.org/wiki/Monument_a_la_Sardana_(Barcelona)';
const MAX_FULL_TEXT = 10000;

async function fetchExtract() {
  const params = new URLSearchParams({
    action: 'query', format: 'json', prop: 'extracts',
    titles: TITLE, exlimit: '1', exsectionformat: 'wiki', explaintext: '1', redirects: '1',
  });
  const res = await fetch(`https://${LANG}.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'PatrimonioEuropeo/1.0' }
  });
  const d = await res.json();
  const first = Object.values(d.query?.pages || {})[0];
  return first?.extract || '';
}

function cleanFullText(text) {
  if (!text) return '';
  // Cortar meta-secciones
  const stopMarkers = [
    '\nReferències', '\nReferencias', '\nReferences',
    '\nVegeu també', '\nVéase también', '\nSee also',
    '\nBibliografia', '\nBibliografía', '\nBibliography',
    '\nEnllaços externs', '\nEnlaces externos', '\nExternal links',
    '\nNotes', '\nNotas',
  ];
  let cut = text.length;
  for (const m of stopMarkers) {
    const i = text.indexOf(m);
    if (i > 0 && i < cut) cut = i;
  }
  let cleaned = text.substring(0, cut).trim();
  if (cleaned.length > MAX_FULL_TEXT) {
    const idealEnd = MAX_FULL_TEXT;
    const lastNewline = cleaned.lastIndexOf('\n', idealEnd);
    cleaned = cleaned.substring(0, lastNewline > 0 ? lastNewline : idealEnd);
  }
  return cleaned;
}

function getIntro(text) {
  if (!text) return '';
  // Intro = todo hasta el primer salto doble o primer "==" sección
  const stopAtSection = text.indexOf('\n\n\n');
  const stopAtHeader = text.search(/\n[A-ZÀ-Úa-zà-ú][^\n]*\n\n/);
  let stop = text.length;
  if (stopAtSection > 0) stop = Math.min(stop, stopAtSection);
  if (stopAtHeader > 0) stop = Math.min(stop, stopAtHeader);
  return text.substring(0, Math.min(stop, 1500)).trim();
}

(async () => {
  console.log(`Fetching ${TITLE} from ca.wikipedia.org...`);
  const rawExtract = await fetchExtract();
  if (!rawExtract) { console.error('Sin extract'); process.exit(1); }

  const fullText = cleanFullText(rawExtract);
  const intro = getIntro(rawExtract);

  console.log(`  intro: ${intro.length}c`);
  console.log(`  full_text: ${fullText.length}c`);
  console.log(`  preview intro: ${intro.substring(0, 200)}...`);

  // UPSERT
  const r = await pool.query(`
    INSERT INTO wikipedia_extracts (bien_id, qid, lang, extract, full_text, source_url, fetched_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT (bien_id) DO UPDATE SET
      qid = EXCLUDED.qid,
      lang = EXCLUDED.lang,
      extract = EXCLUDED.extract,
      full_text = EXCLUDED.full_text,
      source_url = EXCLUDED.source_url,
      updated_at = NOW()
    RETURNING bien_id, lang, LENGTH(extract) AS intro_len, LENGTH(full_text) AS full_len
  `, [BIEN_ID, QID, LANG, intro, fullText, SOURCE_URL]);

  console.log('\nInsertado/actualizado:');
  console.log(JSON.stringify(r.rows[0], null, 2));

  await pool.end();
})();
