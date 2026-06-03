require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // 1. Cobertura general arquitecto
  const cov = await pool.query(`
    SELECT
      COUNT(*) AS total_wikidata_rows,
      COUNT(*) FILTER (WHERE arquitecto IS NOT NULL AND arquitecto <> '') AS con_arquitecto
    FROM wikidata
  `);
  console.log('=== Cobertura wikidata.arquitecto ===');
  console.log(JSON.stringify(cov.rows[0], null, 2));

  // 2. Bienes únicos con arquitecto vs total catálogo
  const bienes = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM bienes) AS total_catalogo,
      (SELECT COUNT(DISTINCT bien_id) FROM wikidata WHERE arquitecto IS NOT NULL AND arquitecto <> '') AS bienes_con_arquitecto
  `);
  console.log('\n=== Cobertura sobre catálogo ===');
  console.log(JSON.stringify(bienes.rows[0], null, 2));

  // 3. Top autores
  const top = await pool.query(`
    SELECT value, COUNT(*) AS n FROM (
      SELECT TRIM(unnest(string_to_array(arquitecto, '|'))) AS value
      FROM wikidata WHERE arquitecto IS NOT NULL AND arquitecto <> ''
    ) x WHERE value <> '' AND value !~ '^Q[0-9]+$'
    GROUP BY value ORDER BY n DESC LIMIT 20
  `);
  console.log('\n=== TOP 20 autores/arquitectos ===');
  top.rows.forEach(r => console.log(`  ${String(r.n).padStart(4)}  ${r.value}`));

  // 4. Diversidad (cuántos autores únicos)
  const div = await pool.query(`
    SELECT COUNT(DISTINCT value) AS n FROM (
      SELECT TRIM(unnest(string_to_array(arquitecto, '|'))) AS value
      FROM wikidata WHERE arquitecto IS NOT NULL AND arquitecto <> ''
    ) x WHERE value <> '' AND value !~ '^Q[0-9]+$'
  `);
  console.log('\n=== Autores únicos ===');
  console.log(JSON.stringify(div.rows[0], null, 2));

  // 5. Buscar Cañas específicamente
  const canas = await pool.query(`
    SELECT b.id, b.denominacion, b.municipio, w.arquitecto
    FROM wikidata w JOIN bienes b ON w.bien_id = b.id
    WHERE LOWER(w.arquitecto) LIKE '%cañas%' OR LOWER(w.arquitecto) LIKE '%canyas%'
    LIMIT 10
  `);
  console.log(`\n=== Bienes con "Cañas/Canyas" en arquitecto: ${canas.rows.length} ===`);
  canas.rows.forEach(r => console.log(`  #${r.id} ${r.denominacion} (${r.municipio}) → "${r.arquitecto}"`));

  await pool.end();
})();
