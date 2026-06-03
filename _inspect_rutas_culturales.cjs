require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const c = await p.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='rutas_culturales' ORDER BY ordinal_position`);
  console.log('Cols rutas_culturales:'); c.rows.forEach(x => console.log(' ', x.column_name, x.data_type));
  const t = await p.query(`SELECT COUNT(*) FROM rutas_culturales`);
  console.log('Total rutas:', t.rows[0].count);
  const s = await p.query(`SELECT id, slug, nombre, pais, tema, num_paradas FROM rutas_culturales ORDER BY id LIMIT 5`);
  console.log('Sample:'); s.rows.forEach(x => console.log(' ', x));
  await p.end();
})();
