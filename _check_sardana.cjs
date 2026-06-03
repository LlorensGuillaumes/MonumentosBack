require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // Estructura tabla wikidata
  const cols = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='wikidata' ORDER BY ordinal_position
  `);
  console.log('Columnas wikidata:');
  cols.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));

  // Estado actual fila #296609
  const r = await pool.query(`SELECT * FROM wikidata WHERE bien_id = 296609`);
  console.log('\nFila wikidata #296609:');
  console.log(JSON.stringify(r.rows[0], null, 2));

  // ¿Cuántas filas wikidata tienen wikipedia_url no nulo y de qué idiomas?
  const langs = await pool.query(`
    SELECT split_part(split_part(wikipedia_url, '//', 2), '.', 1) AS lang_subdomain, COUNT(*) as n
    FROM wikidata
    WHERE wikipedia_url IS NOT NULL
    GROUP BY lang_subdomain
    ORDER BY n DESC
    LIMIT 15
  `);
  console.log('\nDistribución idiomas wikipedia_url existentes:');
  langs.rows.forEach(r => console.log(`  ${r.lang_subdomain}: ${r.n}`));

  await pool.end();
})();
