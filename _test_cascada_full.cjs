require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // Test 1: clasificacion=religiosa → tipos_monumento debe reducirse a solo religiosos
  console.log('=== Test1: clasificacion=religiosa → top tipo_monumento ===');
  const t1 = await pool.query(`
    SELECT b.tipo_monumento as value, COUNT(*) as count FROM bienes b
    WHERE b.tipo_monumento IS NOT NULL AND b.id IN (
      SELECT DISTINCT b.id FROM bienes b WHERE
        b.tipo_monumento IN ('Iglesia / Ermita','Catedral','Monasterio / Convento','Arte religioso','Mezquita / Sinagoga','Cruz / Crucero','Cementerio')
    )
    GROUP BY b.tipo_monumento ORDER BY count DESC LIMIT 10
  `);
  t1.rows.forEach(r => console.log(`  ${String(r.count).padStart(6)}  ${r.value}`));

  // Test 2: religion=catolicismo → periodos debe ser cristiano-medieval
  console.log('\n=== Test2: religion=catolicismo → top periodos ===');
  const t2 = await pool.query(`
    SELECT b.periodo as value, COUNT(*) as count FROM bienes b
    WHERE b.periodo IS NOT NULL AND b.id IN (
      SELECT DISTINCT b.id FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id
      WHERE (LOWER(w.religion) = 'catolicismo' OR LOWER(w.religion) LIKE 'catolicismo|%' OR LOWER(w.religion) LIKE '%|catolicismo%')
    )
    GROUP BY b.periodo ORDER BY count DESC LIMIT 8
  `);
  t2.rows.forEach(r => console.log(`  ${String(r.count).padStart(6)}  ${r.value}`));

  // Test 3: tipo=Castillo / Fortaleza → religion top
  console.log('\n=== Test3: tipo=Castillo / Fortaleza → top religiones ===');
  const t3 = await pool.query(`
    SELECT value, COUNT(*) as count FROM (
      SELECT TRIM(unnest(string_to_array(w.religion, '|'))) as value
      FROM wikidata w JOIN bienes b ON w.bien_id = b.id
      WHERE w.religion IS NOT NULL AND w.religion != '' AND b.id IN (
        SELECT DISTINCT b.id FROM bienes b WHERE b.tipo_monumento = 'Castillo / Fortaleza'
      )
    ) sub WHERE value <> '' AND value !~ '^Q[0-9]+$'
    GROUP BY value ORDER BY count DESC LIMIT 5
  `);
  t3.rows.forEach(r => console.log(`  ${String(r.count).padStart(4)}  ${r.value}`));

  await pool.end();
})();
