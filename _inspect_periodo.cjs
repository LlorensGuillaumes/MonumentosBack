require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const t = await p.query("SELECT COUNT(*) FROM bienes WHERE periodo IS NOT NULL AND periodo != ''");
  console.log('Bienes con periodo:', t.rows[0].count);
  const dist = await p.query("SELECT periodo, COUNT(*) n FROM bienes WHERE periodo IS NOT NULL AND periodo != '' GROUP BY periodo ORDER BY n DESC LIMIT 30");
  console.log('Top periodos:'); dist.rows.forEach(x => console.log(' ', x.periodo, '|', x.n));
  await p.end();
})();
