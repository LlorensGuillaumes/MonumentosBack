require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const tablas = ['bienes','wikidata','imagenes','eventos_monumento','notas_monumento','valoraciones_monumento','rutas_culturales_paradas','rutas_paradas','propuestas_monumentos','sipca'];
  for (const t of tablas) {
    const r = await p.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
    if (!r.rows.length) continue;
    console.log(`\n=== ${t} ===`);
    r.rows.forEach(c => console.log(`  ${c.column_name.padEnd(28)} ${c.data_type.padEnd(28)} ${c.is_nullable === 'NO' ? 'NOT NULL' : ''}`));
  }
  await p.end();
})();
