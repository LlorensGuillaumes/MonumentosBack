require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const RELIGION_MACRO_MAP = (() => {
  const m = new Map();
  const add = (cat, ...labels) => labels.forEach(l => m.set(l.toLowerCase().trim(), cat));
  add('Catolicismo','catolicismo','iglesia católica','católico latino','católico','iglesia latina','catolicismo tradicionalista','iglesia católica en francia','rito romano','rito ambrosiano','catolicismo n° 140, agosto de 1962','orden de san agustín','orden de la inmaculada concepción','orden del císter','iglesia católica armenia');
  add('Cristianismo ortodoxo','cristianismo ortodoxo','iglesia ortodoxa','iglesia ortodoxa rumana','iglesia ortodoxa rusa','iglesia ortodoxa copta','iglesia apostólica armenia','iglesia greco-católica ucraniana','iglesia greco-católica melquita','rito bizantino');
  add('Protestantismo','protestantismo','luteranismo','anglicanismo','calvinismo','presbiterianismo','iglesia de inglaterra','iglesia episcopal en los estados unidos','iglesia protestante unida de francia','iglesia española reformada episcopal','iglesia evangélica española','la iglesia de jesucristo de los santos de los últimos días','protestant church of augsburg confession of alsace and lorraine','evangelical lutheran church – synod of france and belgium','església reformada suissa');
  add('Cristianismo','cristianismo','cristianismo primitivo');
  add('Judaísmo','judaísmo');
  add('Islam','islam');
  add('Hinduismo','hinduismo');
  add('Budismo','budismo','budismo tibetano');
  add('Sijismo','sijismo','sijismo en españa');
  add('Bahaísmo','bahaísmo');
  add('Religiones antiguas','mitraísmo','politeismo celta','religión de la antigua roma');
  return m;
})();

function normalizarReligiones(rawRows) {
  const agrupados = {};
  for (const row of rawRows) {
    const key = (row.value || '').toLowerCase().trim();
    const macro = RELIGION_MACRO_MAP.get(key) || (row.value.charAt(0).toUpperCase() + row.value.slice(1));
    if (!agrupados[macro]) agrupados[macro] = 0;
    agrupados[macro] += parseInt(row.count, 10) || 0;
  }
  return Object.entries(agrupados).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

(async () => {
  // 1. Religion normalizada
  const rel = await pool.query(`
    SELECT value, COUNT(*) as count FROM (
      SELECT TRIM(unnest(string_to_array(w.religion, '|'))) as value
      FROM wikidata w JOIN bienes b ON w.bien_id = b.id
      WHERE w.religion IS NOT NULL AND w.religion != '' AND 1=1
    ) sub WHERE value <> '' AND value !~ '^Q[0-9]+$' GROUP BY value ORDER BY count DESC
  `);
  console.log('=== RELIGION NORMALIZADA ===');
  normalizarReligiones(rel.rows).forEach(r => console.log(`  ${String(r.count).padStart(6)}  ${r.value}`));

  // 2. Test cascada: si religion=Catolicismo, parte_de excluye las paganas
  console.log('\n=== CASCADA: religion=catolicismo → parte_de top 10 ===');
  const cascade = await pool.query(`
    SELECT value, COUNT(*) as count FROM (
      SELECT TRIM(unnest(string_to_array(w.parte_de, '|'))) as value
      FROM wikidata w JOIN bienes b ON w.bien_id = b.id
      WHERE w.parte_de IS NOT NULL AND w.parte_de != '' AND 1=1
        AND (w.religion = 'catolicismo' OR w.religion LIKE 'catolicismo|%' OR w.religion LIKE '%|catolicismo|%' OR w.religion LIKE '%|catolicismo')
    ) sub WHERE value <> '' AND value !~ '^Q[0-9]+$' GROUP BY value ORDER BY count DESC LIMIT 10
  `);
  cascade.rows.forEach(r => console.log(`  ${String(r.count).padStart(5)}  ${r.value}`));

  // 3. Test capitalización propietarios
  console.log('\n=== PROPIETARIOS top 10 (sin QIDs, capitalizados aplicado en backend) ===');
  const prop = await pool.query(`
    SELECT value, COUNT(*) as count FROM (
      SELECT TRIM(unnest(string_to_array(w.propietario, '|'))) as value
      FROM wikidata w JOIN bienes b ON w.bien_id = b.id
      WHERE w.propietario IS NOT NULL AND w.propietario != '' AND 1=1
    ) sub WHERE value <> '' AND value !~ '^Q[0-9]+$' GROUP BY value ORDER BY count DESC LIMIT 10
  `);
  prop.rows.forEach(r => {
    const cap = r.value.charAt(0).toUpperCase() + r.value.slice(1);
    console.log(`  ${String(r.count).padStart(4)}  ${cap}`);
  });

  await pool.end();
})();
