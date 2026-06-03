require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query(`SELECT tipo_monumento, COUNT(*) n FROM bienes WHERE tipo_monumento IS NOT NULL AND tipo_monumento != '' GROUP BY tipo_monumento ORDER BY n DESC`);
  console.log('Tipos de monumento (' + r.rows.length + '):');
  r.rows.forEach(x => console.log(`  ${x.tipo_monumento.padEnd(50)} ${x.n}`));
  await p.end();
})();
