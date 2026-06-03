require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log('=== tipos_monumento alfabético ===');
  const tm = await pool.query(`
    SELECT b.tipo_monumento as value, COUNT(*) as count
    FROM bienes b WHERE b.tipo_monumento IS NOT NULL AND 1=1
    GROUP BY b.tipo_monumento ORDER BY LOWER(b.tipo_monumento) LIMIT 10
  `);
  tm.rows.forEach(r => console.log(`  ${r.value}`));

  console.log('\n=== periodos alfabético ===');
  const p = await pool.query(`
    SELECT b.periodo as value, COUNT(*) as count
    FROM bienes b WHERE b.periodo IS NOT NULL AND 1=1
    GROUP BY b.periodo ORDER BY LOWER(b.periodo) LIMIT 10
  `);
  p.rows.forEach(r => console.log(`  ${r.value}`));

  await pool.end();
})();
