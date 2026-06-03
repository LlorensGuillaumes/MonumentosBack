require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // 1. ¿Poblet en BD?
  const r1 = await pool.query(`
    SELECT id, denominacion, municipio, provincia, comarca FROM bienes
    WHERE LOWER(denominacion) LIKE '%poblet%'
    LIMIT 5
  `);
  console.log('=== Poblet en BD ===');
  r1.rows.forEach(r => console.log(`  #${r.id} ${r.denominacion} | mun=${r.municipio} | prov=${r.provincia} | comarca=${r.comarca}`));

  // 2. ¿Hay comarca "Conca de Barberà"?
  const r2 = await pool.query(`
    SELECT comarca, COUNT(*) AS n FROM bienes
    WHERE LOWER(comarca) LIKE '%conca%' OR LOWER(comarca) LIKE '%barberà%' OR LOWER(comarca) LIKE '%barbera%'
    GROUP BY comarca ORDER BY n DESC
  `);
  console.log('\n=== Comarcas con conca/barberà ===');
  r2.rows.forEach(r => console.log(`  ${r.n}  "${r.comarca}"`));

  // 3. Top comarcas pobladas
  const r3 = await pool.query(`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE comarca IS NOT NULL) AS con_comarca FROM bienes
  `);
  console.log('\n=== Cobertura comarca ===');
  console.log(JSON.stringify(r3.rows[0], null, 2));

  await pool.end();
})();
