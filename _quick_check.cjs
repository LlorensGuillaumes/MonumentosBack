require('dotenv').config();
const { Pool } = require('pg');
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });
  const tables = await p.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%ruta%' OR table_name ILIKE '%culturale%')`);
  console.log('Tablas ruta/culturales:', tables.rows.map(r=>r.table_name).join(', '));
  for (const t of tables.rows) {
    const c = await p.query(`SELECT COUNT(*) AS n FROM ${t.table_name}`);
    console.log(`  ${t.table_name}: ${c.rows[0].n}`);
  }
  await p.end();
})();
