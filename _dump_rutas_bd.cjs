require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query(`SELECT id, nombre, descripcion FROM rutas_culturales ORDER BY id`);
  fs.writeFileSync('_rutas_bd_para_traducir.json', JSON.stringify(r.rows, null, 2));
  console.log(`Dumped ${r.rows.length} rutas → _rutas_bd_para_traducir.json`);
  await p.end();
})();
