require('dotenv').config();
const { Pool } = require('pg');
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });
  // Variantes "X (La)" o "X (El)" en provincias relacionadas con Granada
  const r = await p.query(
    `SELECT DISTINCT municipio, COUNT(*) AS n FROM bienes
     WHERE comunidad_autonoma ILIKE 'Andalu%'
     AND (municipio LIKE '%(La)%' OR municipio LIKE '%(El)%' OR municipio LIKE '%(Los)%' OR municipio LIKE '%(Las)%')
     GROUP BY municipio ORDER BY n DESC LIMIT 50`
  );
  console.log(`Municipios con sufijo (La/El/Los/Las):`);
  for (const row of r.rows) console.log(`  ${row.municipio.padEnd(30)} ${row.n}`);
  await p.end();
})();
