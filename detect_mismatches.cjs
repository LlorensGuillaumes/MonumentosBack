/**
 * Detecta monumentos con datos cruzados de Wikidata.
 * Estrategias:
 * 1. URL de Wikipedia con disambiguación que no coincide con ubicación
 * 2. Descripción de Wikidata menciona ciudad distinta
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, "'")
    .trim();
}

function tokensMatch(a, b) {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  if (na.includes(nb) || nb.includes(na)) return true;
  // Check token overlap: "Ejea de los Caballeros" vs "Ejea_de_los_Caballeros"
  const tokA = na.split(/\s+/).filter(t => t.length > 2);
  const tokB = nb.split(/\s+/).filter(t => t.length > 2);
  const overlap = tokA.filter(t => tokB.includes(t));
  return overlap.length >= Math.min(tokA.length, tokB.length, 2);
}

(async () => {
  const r = await pool.query(`
    SELECT b.id, b.denominacion, b.municipio, b.provincia, b.comunidad_autonoma, b.pais,
           w.qid, w.wikipedia_url, w.descripcion
    FROM bienes b
    JOIN wikidata w ON b.id = w.bien_id
    WHERE w.wikipedia_url IS NOT NULL
  `);

  console.log(`Total monumentos con Wikipedia URL: ${r.rows.length}\n`);

  const confirmed = [];

  for (const row of r.rows) {
    const url = decodeURIComponent(row.wikipedia_url);
    const match = url.match(/\(([^)]+)\)\s*$/);
    if (!match) continue;

    const disambig = match[1].replace(/_/g, ' ');
    const locationFields = [row.municipio, row.provincia, row.comunidad_autonoma, row.pais];

    // Check if disambig matches any location field
    const anyLocationMatch = locationFields.some(loc => tokensMatch(loc, disambig));

    // Also check against monument name itself
    const denomMatch = tokensMatch(row.denominacion, disambig);

    if (!anyLocationMatch && !denomMatch && disambig.length > 2) {
      // Extra validation: check if description also mentions a different place
      const desc = normalize(row.descripcion || '');
      const descMentionsDisambig = desc.includes(normalize(disambig));
      const descMentionsLocation = locationFields.some(loc =>
        loc && desc.includes(normalize(loc))
      );

      // High confidence: description confirms the mismatch
      const confidence = descMentionsDisambig && !descMentionsLocation ? 'ALTA' : 'media';

      confirmed.push({
        id: row.id,
        nombre: row.denominacion,
        municipio: row.municipio,
        provincia: row.provincia,
        disambig,
        desc: (row.descripcion || '').substring(0, 100),
        confidence,
        qid: row.qid,
      });
    }
  }

  // Sort: high confidence first
  confirmed.sort((a, b) => {
    if (a.confidence === 'ALTA' && b.confidence !== 'ALTA') return -1;
    if (b.confidence === 'ALTA' && a.confidence !== 'ALTA') return 1;
    return a.id - b.id;
  });

  const alta = confirmed.filter(s => s.confidence === 'ALTA');
  const media = confirmed.filter(s => s.confidence === 'media');

  console.log(`CONFIANZA ALTA (descripción confirma cruce): ${alta.length}`);
  console.log(`CONFIANZA MEDIA (sospechoso por URL): ${media.length}`);
  console.log(`TOTAL: ${confirmed.length}\n`);

  console.log('=' .repeat(120));
  console.log('CONFIANZA ALTA - Cruces casi seguros:');
  console.log('='.repeat(120));
  for (const s of alta) {
    console.log(`ID=${s.id} | QID=${s.qid}`);
    console.log(`  Monumento: ${s.nombre}`);
    console.log(`  Ubicación real: ${s.municipio}, ${s.provincia}`);
    console.log(`  URL apunta a: (${s.disambig})`);
    console.log(`  Descripción: ${s.desc}`);
    console.log('-'.repeat(120));
  }

  if (media.length > 0) {
    console.log('\n' + '='.repeat(120));
    console.log(`CONFIANZA MEDIA - ${media.length} sospechosos (mostrando primeros 50):`);
    console.log('='.repeat(120));
    for (const s of media.slice(0, 50)) {
      console.log(`ID=${s.id} | ${s.nombre} | Ubic: ${s.municipio}, ${s.provincia} | URL: (${s.disambig}) | Desc: ${s.desc || '-'}`);
    }
  }

  await pool.end();
})();
