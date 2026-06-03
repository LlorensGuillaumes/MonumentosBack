// Verificación final tras toda la sesión: imports + limpieza duplicados
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  console.log('═══ VERIFICACIÓN FINAL SESIÓN ═══\n');

  // 1. Total bienes
  const r1 = await pool.query('SELECT COUNT(*)::int as n FROM bienes');
  const r1e = await pool.query("SELECT COUNT(*)::int as n FROM bienes WHERE pais='España'");
  console.log(`Total bienes BD:       ${r1.rows[0].n}`);
  console.log(`Total bienes España:   ${r1e.rows[0].n}`);

  // 2. Bienes con wikidata
  const r2 = await pool.query(`
    SELECT COUNT(*)::int as n FROM bienes b
    INNER JOIN wikidata w ON w.bien_id = b.id
  `);
  const r2e = await pool.query(`
    SELECT COUNT(*)::int as n FROM bienes b
    INNER JOIN wikidata w ON w.bien_id = b.id
    WHERE b.pais='España'
  `);
  console.log(`Con wikidata total:    ${r2.rows[0].n}`);
  console.log(`Con wikidata España:   ${r2e.rows[0].n}`);

  // 3. Bienes con imagen
  const r3 = await pool.query(`
    SELECT COUNT(DISTINCT b.id)::int as n FROM bienes b
    INNER JOIN imagenes i ON i.bien_id = b.id
    WHERE b.pais='España'
  `);
  console.log(`Con imagen España:     ${r3.rows[0].n}`);

  // 4. QIDs duplicados restantes
  const r4 = await pool.query(`
    SELECT COUNT(*)::int as n FROM (
      SELECT qid FROM wikidata GROUP BY qid HAVING COUNT(*) > 1
    ) x
  `);
  console.log(`QIDs aún duplicados:   ${r4.rows[0].n}`);

  // 5. Coverage CCAA España
  const r5 = await pool.query(`
    SELECT comunidad_autonoma, COUNT(*)::int as n FROM bienes
    WHERE pais='España'
    GROUP BY comunidad_autonoma ORDER BY n DESC
  `);
  console.log('\n=== Cobertura por CCAA España ===');
  r5.rows.forEach(r => console.log(`  ${String(r.n).padStart(6)}  ${r.comunidad_autonoma || 'NULL'}`));

  // 6. Huérfanos / integridad
  const r6 = await pool.query(`
    SELECT COUNT(*)::int as n FROM bienes b
    LEFT JOIN wikidata w ON w.bien_id = b.id
    WHERE b.pais='España' AND w.bien_id IS NULL
  `);
  console.log(`\nBienes España SIN wikidata: ${r6.rows[0].n}`);

  // 7. Resumen sesión
  console.log('\n═══ Cambios sesión ═══');
  console.log('  +21.658 monumentos nuevos (12 CCAA)');
  console.log('  -2.265 bienes duplicados eliminados (1938+327)');
  console.log('  324 imágenes consolidadas');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
