require('dotenv').config();
const { Pool } = require('pg');
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });
  // 1. Variantes de comarcas en BD
  const c = await p.query(`SELECT comarca, COUNT(*) AS n FROM bienes WHERE comarca ILIKE '%penede%' OR comarca ILIKE '%garraf%' GROUP BY comarca ORDER BY n DESC`);
  console.log('Comarcas en BD:');
  for (const r of c.rows) console.log(`  "${r.comarca}" → ${r.n}`);
  // 2. Total combinado
  const t = await p.query(`SELECT COUNT(*) AS n FROM bienes WHERE comarca ILIKE '%alt penede%' OR comarca ILIKE '%baix penede%' OR comarca ILIKE '%garraf%'`);
  console.log(`\nTOTAL Alt Penedès + Baix Penedès + Garraf: ${t.rows[0].n}`);
  // 3. Desglose por comarca normalizada
  const d = await p.query(`
    SELECT
      CASE
        WHEN comarca ILIKE '%alt penede%' THEN 'Alt Penedès'
        WHEN comarca ILIKE '%baix penede%' THEN 'Baix Penedès'
        WHEN comarca ILIKE '%garraf%' THEN 'Garraf'
      END AS zona,
      COUNT(*) AS n
    FROM bienes
    WHERE comarca ILIKE '%alt penede%' OR comarca ILIKE '%baix penede%' OR comarca ILIKE '%garraf%'
    GROUP BY zona ORDER BY n DESC
  `);
  console.log('\nDesglose:');
  for (const r of d.rows) console.log(`  ${r.zona}: ${r.n}`);
  await p.end();
})();
