require('dotenv').config();
const { Pool } = require('pg');
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });
  for (const t of ['La Calahorra', 'Calahorra (La)', 'La Peza', 'Peza (La)', 'Los Guájares', 'Guájares (Los)', 'El Pinar', 'Pinar (El)', 'El Valle', 'Valle (El)']) {
    const r = await p.query("SELECT COUNT(*) AS n FROM bienes WHERE municipio = $1", [t]);
    console.log(`  "${t}".padEnd(25) → ${r.rows[0].n}`);
  }
  await p.end();
})();
