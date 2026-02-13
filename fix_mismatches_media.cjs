/**
 * Corrige monumentos con datos cruzados de Wikidata - CONFIANZA MEDIA.
 * Estos tienen URL con disambiguación que no coincide con la ubicación,
 * pero la descripción no confirma explícitamente el cruce.
 *
 * Estrategia más conservadora: solo re-enlazar si encontramos match seguro,
 * limpiar si la descripción menciona otra ciudad diferente.
 *
 * Uso: node fix_mismatches_media.cjs [startFrom]
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const HEADERS = { 'User-Agent': 'PatrimonioEuropeo/1.0 (data-fix-media)' };
const DELAY = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const START_FROM = parseInt(process.argv[2]) || 0;

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function tokensMatch(a, b) {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  if (na.includes(nb) || nb.includes(na)) return true;
  const tokA = na.split(/\s+/).filter(t => t.length > 2);
  const tokB = nb.split(/\s+/).filter(t => t.length > 2);
  const overlap = tokA.filter(t => tokB.includes(t));
  return overlap.length >= Math.min(tokA.length, tokB.length, 2);
}

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) {
        const wait = 5000 * attempt;
        console.log(`    [Rate limit] Esperando ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`    [Retry ${attempt}/${retries}] ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
}

async function searchWikidata(query, lang = 'es') {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=${lang}&limit=5&format=json`;
  const d = await fetchWithRetry(url);
  return d.search || [];
}

async function getEntityDetails(qid) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|descriptions|claims|sitelinks&languages=es|ca|fr|pt|it|en&format=json`;
  const d = await fetchWithRetry(url);
  return d.entities?.[qid];
}

function getClaimValue(entity, prop) {
  const claims = entity?.claims?.[prop];
  if (!claims || claims.length === 0) return null;
  const snak = claims[0].mainsnak;
  if (snak?.datavalue?.type === 'wikibase-entityid') return snak.datavalue.value.id;
  if (snak?.datavalue?.type === 'string') return snak.datavalue.value;
  if (snak?.datavalue?.type === 'time') return snak.datavalue.value.time;
  return null;
}

function getImageUrl(entity) {
  const img = getClaimValue(entity, 'P18');
  if (!img) return null;
  return `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img.replace(/ /g, '_'))}`;
}

function getWikipediaUrl(entity) {
  const sitelinks = entity?.sitelinks;
  for (const lang of ['eswiki', 'cawiki', 'frwiki', 'ptwiki', 'itwiki', 'enwiki']) {
    if (sitelinks?.[lang]) {
      const prefix = lang.replace('wiki', '');
      return `https://${prefix}.wikipedia.org/wiki/${encodeURIComponent(sitelinks[lang].title.replace(/ /g, '_'))}`;
    }
  }
  return null;
}

function getDescription(entity) {
  for (const lang of ['es', 'ca', 'fr', 'pt', 'it', 'en']) {
    if (entity?.descriptions?.[lang]?.value) return entity.descriptions[lang].value;
  }
  return null;
}

function getCommonsCategory(entity) {
  return getClaimValue(entity, 'P373');
}

function getLabel(entity) {
  for (const lang of ['es', 'ca', 'fr', 'pt', 'it', 'en']) {
    if (entity?.labels?.[lang]?.value) return entity.labels[lang].value;
  }
  return null;
}

async function verifyLocation(entity, municipio, provincia) {
  const p131 = getClaimValue(entity, 'P131');
  if (!p131) return false;

  const locEntity = await getEntityDetails(p131);
  await sleep(DELAY);
  const locLabel = getLabel(locEntity);

  if (tokensMatch(locLabel, municipio) || tokensMatch(locLabel, provincia)) return true;

  const p131up = getClaimValue(locEntity, 'P131');
  if (p131up) {
    const upEntity = await getEntityDetails(p131up);
    await sleep(DELAY);
    const upLabel = getLabel(upEntity);
    if (tokensMatch(upLabel, municipio) || tokensMatch(upLabel, provincia)) return true;
  }

  return false;
}

(async () => {
  const r = await pool.query(`
    SELECT b.id, b.denominacion, b.municipio, b.provincia, b.comunidad_autonoma, b.pais,
           w.qid, w.wikipedia_url, w.descripcion
    FROM bienes b
    JOIN wikidata w ON b.id = w.bien_id
    WHERE w.wikipedia_url IS NOT NULL
  `);

  // Detect MEDIUM confidence mismatches only
  const mismatches = [];
  for (const row of r.rows) {
    const url = decodeURIComponent(row.wikipedia_url);
    const match = url.match(/\(([^)]+)\)\s*$/);
    if (!match) continue;

    const disambig = match[1].replace(/_/g, ' ');
    const locationFields = [row.municipio, row.provincia, row.comunidad_autonoma, row.pais];
    const anyLocationMatch = locationFields.some(loc => tokensMatch(loc, disambig));
    const denomMatch = tokensMatch(row.denominacion, disambig);

    if (!anyLocationMatch && !denomMatch && disambig.length > 2) {
      const desc = normalize(row.descripcion || '');
      const descMentionsDisambig = desc.includes(normalize(disambig));
      const descMentionsLocation = locationFields.some(loc => loc && desc.includes(normalize(loc)));

      // MEDIUM: NOT high confidence (description doesn't confirm the mismatch)
      const isHighConfidence = descMentionsDisambig && !descMentionsLocation;
      if (!isHighConfidence) {
        mismatches.push({ ...row, disambig });
      }
    }
  }

  console.log(`Errores confianza MEDIA: ${mismatches.length} | Empezando desde: ${START_FROM}\n`);

  let fixed = 0, cleaned = 0, skipped = 0, errors = 0;

  for (let i = START_FROM; i < mismatches.length; i++) {
    const m = mismatches[i];
    const progress = `[${i + 1}/${mismatches.length}]`;

    try {
      const searches = [];
      if (m.municipio) searches.push(`${m.denominacion} ${m.municipio}`);
      searches.push(m.denominacion);
      if (m.provincia) searches.push(`${m.denominacion} ${m.provincia}`);

      let foundQid = null;
      let foundEntity = null;

      for (const query of searches) {
        if (foundQid) break;

        const results = await searchWikidata(query);
        await sleep(DELAY);

        for (const result of results) {
          if (result.id === m.qid) continue;

          const entity = await getEntityDetails(result.id);
          await sleep(DELAY);
          if (!entity) continue;

          const label = getLabel(entity);
          if (!tokensMatch(label, m.denominacion)) continue;

          if (m.municipio) {
            const locationOk = await verifyLocation(entity, m.municipio, m.provincia);
            await sleep(DELAY);
            if (locationOk) {
              foundQid = result.id;
              foundEntity = entity;
              break;
            }
          } else if (m.provincia) {
            const desc = getDescription(entity);
            if (desc && normalize(desc).includes(normalize(m.provincia))) {
              foundQid = result.id;
              foundEntity = entity;
              break;
            }
          }
        }
      }

      if (foundQid && foundEntity) {
        const imgUrl = getImageUrl(foundEntity);
        const wikiUrl = getWikipediaUrl(foundEntity);
        const desc = getDescription(foundEntity);
        const commons = getCommonsCategory(foundEntity);

        await pool.query(
          `UPDATE wikidata SET qid = $1, descripcion = $2, imagen_url = $3, wikipedia_url = $4, commons_category = $5
           WHERE bien_id = $6`,
          [foundQid, desc, imgUrl, wikiUrl, commons, m.id]
        );

        console.log(`${progress} CORREGIDO ID=${m.id} "${m.denominacion}" | ${m.qid} -> ${foundQid}`);
        fixed++;
      } else {
        // Medium confidence: limpiar también (la URL apunta a otro sitio)
        await pool.query(
          `UPDATE wikidata SET qid = NULL, descripcion = NULL, imagen_url = NULL, wikipedia_url = NULL, commons_category = NULL
           WHERE bien_id = $1`,
          [m.id]
        );
        console.log(`${progress} LIMPIADO  ID=${m.id} "${m.denominacion}" (${m.municipio || '?'}, ${m.disambig}) | sin match`);
        cleaned++;
      }
    } catch (err) {
      console.error(`${progress} ERROR     ID=${m.id} "${m.denominacion}" | ${err.message}`);
      errors++;
      await sleep(3000);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`RESULTADO:`);
  console.log(`  Corregidos: ${fixed}`);
  console.log(`  Limpiados:  ${cleaned}`);
  console.log(`  Errores:    ${errors}`);
  console.log(`  Total:      ${fixed + cleaned + errors}`);

  await pool.end();
})();
