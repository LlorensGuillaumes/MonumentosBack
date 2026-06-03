// Match eventos descubiertos contra municipios en BD via label textual
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const PADRES = {
  'Q10859': 'Guerra Civil Española',
  'Q152499': 'Guerra de Independencia Española',
  'Q150701': 'Guerra de Sucesión Española',
  'Q79791': 'Reconquista',
  'Q1178424': 'Guerras Carlistas',
  'Q1501724': 'Guerra de Restauración portuguesa',
  'Q2105495': 'Crisis de 1383-1385 (Portugal)',
  'Q164432': 'Guerra de los Ochenta Años',
  'Q51657': 'Cruzada albigense',
  'Q78994': 'Guerras Napoleónicas',
  'Q362': 'Segunda Guerra Mundial',
};

const data = JSON.parse(fs.readFileSync('_batallas_descubiertas.json', 'utf8'));

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });

  // Cargar todos los municipios distintos de bienes
  const muniRows = (await p.query(`SELECT DISTINCT LOWER(TRIM(municipio)) as m FROM bienes WHERE municipio IS NOT NULL AND municipio != ''`)).rows;
  const muniSet = new Set(muniRows.map(r => r.m));
  console.log('Municipios distintos en BD:', muniSet.size);

  // Para cada evento con location, comprobar si match
  let totalEventos = 0;
  let eventosConLocation = 0;
  let eventosMatch = 0;
  let totalBienesMatcheados = 0;
  const matches = []; // { qidPadre, padreNombre, qidEvento, eventoLabel, locationLabel, municipioBD, nBienes }

  for (const [qidPadre, info] of Object.entries(data)) {
    if (!info.eventos) continue;
    for (const ev of info.eventos) {
      totalEventos++;
      if (!ev.locations.length) continue;
      eventosConLocation++;
      let matched = false;
      for (const loc of ev.locations) {
        const locLower = loc.label?.toLowerCase().trim();
        if (!locLower) continue;
        // Match exacto, o quitando "(provincia X)" del label
        const cleanLoc = locLower.replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (muniSet.has(cleanLoc) || muniSet.has(locLower)) {
          // Cuántos bienes tiene este municipio
          const r = await p.query(`SELECT COUNT(*) FROM bienes WHERE LOWER(TRIM(municipio)) IN ($1, $2)`, [cleanLoc, locLower]);
          const n = parseInt(r.rows[0].count, 10);
          if (n > 0) {
            matches.push({
              qidPadre, padreNombre: PADRES[qidPadre],
              qidEvento: ev.qid, eventoLabel: ev.label,
              locationLabel: loc.label, locQid: loc.qid,
              municipioMatch: cleanLoc, nBienes: n,
            });
            totalBienesMatcheados += n;
            matched = true;
          }
        }
      }
      if (matched) eventosMatch++;
    }
  }

  console.log(`\nResumen:`);
  console.log(`  Eventos totales: ${totalEventos}`);
  console.log(`  Con location: ${eventosConLocation}`);
  console.log(`  Con match en BD: ${eventosMatch}`);
  console.log(`  Total bienes potenciales (con dups por evento): ${totalBienesMatcheados}`);
  console.log(`  Bienes únicos: por verificar`);

  fs.writeFileSync('_eventos_match_municipios.json', JSON.stringify(matches, null, 2));
  console.log(`\n→ _eventos_match_municipios.json (${matches.length} matches)`);

  // Sample
  console.log('\nMuestra (primeros 20):');
  matches.slice(0, 20).forEach(m => console.log(`  [${m.padreNombre}] ${m.qidEvento} ${m.eventoLabel} → ${m.municipioMatch} (${m.nBienes} bienes)`));

  // Resumen por padre
  console.log('\nPor categoría padre:');
  for (const qp of Object.keys(PADRES)) {
    const c = matches.filter(m => m.qidPadre === qp);
    const bienes = c.reduce((s, m) => s + m.nBienes, 0);
    console.log(`  ${qp} ${PADRES[qp]}: ${c.length} eventos match, ${bienes} bienes`);
  }

  await p.end();
})();
