require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  const wikiUrl = 'https://ca.wikipedia.org/wiki/Monument_a_la_Sardana_(Barcelona)';
  const r = await pool.query(
    `UPDATE wikidata SET wikipedia_url = $1 WHERE bien_id = 296609 RETURNING bien_id, qid, wikipedia_url`,
    [wikiUrl]
  );
  console.log('Actualizado:');
  console.log(JSON.stringify(r.rows[0], null, 2));
  console.log(`\nFilas afectadas: ${r.rowCount}`);

  await pool.end();
})();
