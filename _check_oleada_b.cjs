require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // 1. Cobertura general
  const cov = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE propietario IS NOT NULL AND propietario <> '') AS con_propietario,
      COUNT(*) FILTER (WHERE religion IS NOT NULL AND religion <> '') AS con_religion,
      COUNT(*) FILTER (WHERE dedicado_a IS NOT NULL AND dedicado_a <> '') AS con_dedicado_a,
      COUNT(*) FILTER (WHERE parte_de IS NOT NULL AND parte_de <> '') AS con_parte_de,
      COUNT(*) AS total_wikidata_rows
    FROM wikidata
  `);
  console.log('=== Cobertura Oleada B en wikidata ===');
  console.log(JSON.stringify(cov.rows[0], null, 2));

  // 2. ¿Cuántos bienes únicos tienen al menos 1 prop?
  const bienes = await pool.query(`
    SELECT
      COUNT(DISTINCT bien_id) FILTER (WHERE propietario IS NOT NULL AND propietario <> '') AS con_prop,
      COUNT(DISTINCT bien_id) FILTER (WHERE religion IS NOT NULL AND religion <> '') AS con_rel,
      COUNT(DISTINCT bien_id) FILTER (WHERE dedicado_a IS NOT NULL AND dedicado_a <> '') AS con_ded,
      COUNT(DISTINCT bien_id) FILTER (WHERE parte_de IS NOT NULL AND parte_de <> '') AS con_parte,
      COUNT(DISTINCT bien_id) FILTER (WHERE
        (propietario IS NOT NULL AND propietario <> '')
        OR (religion IS NOT NULL AND religion <> '')
        OR (dedicado_a IS NOT NULL AND dedicado_a <> '')
        OR (parte_de IS NOT NULL AND parte_de <> '')
      ) AS al_menos_uno
    FROM wikidata
  `);
  console.log('\n=== Bienes únicos con prop ===');
  console.log(JSON.stringify(bienes.rows[0], null, 2));

  // 3. Top valores en cada filtro
  console.log('\n=== TOP propietario ===');
  const tp = await pool.query(`
    SELECT v, COUNT(*) AS n FROM (
      SELECT UNNEST(STRING_TO_ARRAY(propietario, ' | ')) AS v
      FROM wikidata WHERE propietario IS NOT NULL AND propietario <> ''
    ) x GROUP BY v ORDER BY n DESC LIMIT 12
  `);
  tp.rows.forEach(r => console.log(`  ${String(r.n).padStart(4)}  ${r.v}`));

  console.log('\n=== TOP religion ===');
  const tr = await pool.query(`
    SELECT v, COUNT(*) AS n FROM (
      SELECT UNNEST(STRING_TO_ARRAY(religion, ' | ')) AS v
      FROM wikidata WHERE religion IS NOT NULL AND religion <> ''
    ) x GROUP BY v ORDER BY n DESC LIMIT 12
  `);
  tr.rows.forEach(r => console.log(`  ${String(r.n).padStart(5)}  ${r.v}`));

  console.log('\n=== TOP dedicado_a ===');
  const td = await pool.query(`
    SELECT v, COUNT(*) AS n FROM (
      SELECT UNNEST(STRING_TO_ARRAY(dedicado_a, ' | ')) AS v
      FROM wikidata WHERE dedicado_a IS NOT NULL AND dedicado_a <> ''
    ) x GROUP BY v ORDER BY n DESC LIMIT 15
  `);
  td.rows.forEach(r => console.log(`  ${String(r.n).padStart(4)}  ${r.v}`));

  console.log('\n=== TOP parte_de ===');
  const tparte = await pool.query(`
    SELECT v, COUNT(*) AS n FROM (
      SELECT UNNEST(STRING_TO_ARRAY(parte_de, ' | ')) AS v
      FROM wikidata WHERE parte_de IS NOT NULL AND parte_de <> ''
    ) x GROUP BY v ORDER BY n DESC LIMIT 15
  `);
  tparte.rows.forEach(r => console.log(`  ${String(r.n).padStart(5)}  ${r.v}`));

  // 4. Diversidad: valores únicos por filtro
  const div = await pool.query(`
    SELECT
      (SELECT COUNT(DISTINCT v) FROM (SELECT UNNEST(STRING_TO_ARRAY(propietario,' | ')) v FROM wikidata WHERE propietario IS NOT NULL AND propietario <> '') x) AS uniq_prop,
      (SELECT COUNT(DISTINCT v) FROM (SELECT UNNEST(STRING_TO_ARRAY(religion,' | ')) v FROM wikidata WHERE religion IS NOT NULL AND religion <> '') x) AS uniq_rel,
      (SELECT COUNT(DISTINCT v) FROM (SELECT UNNEST(STRING_TO_ARRAY(dedicado_a,' | ')) v FROM wikidata WHERE dedicado_a IS NOT NULL AND dedicado_a <> '') x) AS uniq_ded,
      (SELECT COUNT(DISTINCT v) FROM (SELECT UNNEST(STRING_TO_ARRAY(parte_de,' | ')) v FROM wikidata WHERE parte_de IS NOT NULL AND parte_de <> '') x) AS uniq_parte
  `);
  console.log('\n=== Valores únicos por filtro ===');
  console.log(JSON.stringify(div.rows[0], null, 2));

  await pool.end();
})();
