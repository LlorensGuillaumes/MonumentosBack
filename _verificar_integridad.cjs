// Verifica integridad: bienes ↔ wikidata ↔ imagenes
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  // 1. Total bienes España
  const r1 = await pool.query("SELECT COUNT(*)::int as n FROM bienes WHERE pais='España'");
  console.log(`Total bienes España: ${r1.rows[0].n}`);

  // 2. Bienes España con entrada en wikidata
  const r2 = await pool.query(`
    SELECT COUNT(*)::int as n FROM bienes b
    INNER JOIN wikidata w ON w.bien_id = b.id
    WHERE b.pais='España'
  `);
  console.log(`Bienes España con wikidata: ${r2.rows[0].n}`);

  // 3. Bienes España con imagen
  const r3 = await pool.query(`
    SELECT COUNT(DISTINCT b.id)::int as n FROM bienes b
    INNER JOIN imagenes i ON i.bien_id = b.id
    WHERE b.pais='España'
  `);
  console.log(`Bienes España con imagen: ${r3.rows[0].n}`);

  // 4. Bienes huérfanos (sin wikidata ni opendata declarado)
  const r4 = await pool.query(`
    SELECT COUNT(*)::int as n FROM bienes b
    LEFT JOIN wikidata w ON w.bien_id = b.id
    WHERE b.pais='España' AND w.bien_id IS NULL
  `);
  console.log(`Bienes España SIN wikidata: ${r4.rows[0].n} (de open data o manuales)`);

  // 5. QIDs duplicados (no debería haber)
  const r5 = await pool.query(`
    SELECT qid, COUNT(*)::int as n FROM wikidata
    GROUP BY qid HAVING COUNT(*) > 1
    LIMIT 10
  `);
  console.log(`\nQIDs duplicados en wikidata: ${r5.rows.length}`);
  r5.rows.forEach(r => console.log(`  ${r.qid}: ${r.n} veces`));

  // 6. Inserts recientes (últimos en sesión)
  const r6 = await pool.query(`
    SELECT comunidad_autonoma, COUNT(*)::int as n FROM bienes
    WHERE pais='España' AND id >= 265730
    GROUP BY comunidad_autonoma ORDER BY n DESC
  `);
  console.log(`\nInserts recientes (id >= 265730) por CCAA:`);
  let total = 0;
  r6.rows.forEach(r => { console.log(`  ${String(r.n).padStart(5)}  ${r.comunidad_autonoma}`); total += r.n; });
  console.log(`  TOTAL recientes: ${total}`);

  // 7. Tipos de monumento en últimos inserts
  const r7 = await pool.query(`
    SELECT tipo_monumento, COUNT(*)::int as n FROM bienes
    WHERE pais='España' AND id >= 265730
    GROUP BY tipo_monumento ORDER BY n DESC
  `);
  console.log(`\nTipos de monumento en inserts recientes:`);
  r7.rows.forEach(r => console.log(`  ${String(r.n).padStart(5)}  ${r.tipo_monumento || 'NULL'}`));

  // 8. Verificación final cobertura
  const r8 = await pool.query("SELECT COUNT(*)::int as n FROM bienes WHERE pais='España' AND latitud IS NOT NULL AND longitud IS NOT NULL");
  console.log(`\nBienes España con coords: ${r8.rows[0].n} (deben ser ≥ inserts recientes)`);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
