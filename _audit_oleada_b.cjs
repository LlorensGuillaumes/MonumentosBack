require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // 1. Religion: ver lista completa para detectar ruido
  console.log('=== RELIGION — TODOS los valores únicos ===');
  const rel = await pool.query(`
    SELECT value, COUNT(*) as n FROM (
      SELECT TRIM(unnest(string_to_array(religion, '|'))) as value FROM wikidata
      WHERE religion IS NOT NULL AND religion != ''
    ) x WHERE value <> '' GROUP BY value ORDER BY n DESC
  `);
  rel.rows.forEach(r => console.log(`  ${String(r.n).padStart(5)}  "${r.value}"`));

  // 2. Propietarios con QIDs sin resolver
  console.log('\n=== PROPIETARIOS con QID raw (Q + dígitos) ===');
  const qids = await pool.query(`
    SELECT value, COUNT(*) as n FROM (
      SELECT TRIM(unnest(string_to_array(propietario, '|'))) as value FROM wikidata
      WHERE propietario IS NOT NULL AND propietario != ''
    ) x WHERE value ~ '^Q[0-9]+$' GROUP BY value ORDER BY n DESC LIMIT 20
  `);
  qids.rows.forEach(r => console.log(`  ${r.n}  ${r.value}`));

  // 3. Valores con primera letra minúscula vs mayúscula (inconsistencia)
  console.log('\n=== PROPIETARIO: muestra de inconsistencia mayúscula/minúscula ===');
  const cap = await pool.query(`
    SELECT value FROM (
      SELECT DISTINCT TRIM(unnest(string_to_array(propietario, '|'))) as value FROM wikidata
      WHERE propietario IS NOT NULL AND propietario != ''
    ) x WHERE value <> '' AND substr(value, 1, 1) ~ '[a-z]' LIMIT 10
  `);
  cap.rows.forEach(r => console.log(`  "${r.value}"`));

  // 4. Buscar "Vittorio Cini" y "Fundación Cini" — son entidades distintas?
  console.log('\n=== Búsqueda "Cini" en propietarios ===');
  const cini = await pool.query(`
    SELECT value, COUNT(*) as n FROM (
      SELECT TRIM(unnest(string_to_array(propietario, '|'))) as value FROM wikidata
      WHERE propietario IS NOT NULL AND propietario != ''
    ) x WHERE LOWER(value) LIKE '%cini%' GROUP BY value ORDER BY n DESC
  `);
  cini.rows.forEach(r => console.log(`  ${r.n}  "${r.value}"`));

  await pool.end();
})();
