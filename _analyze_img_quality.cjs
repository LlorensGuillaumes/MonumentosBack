require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // 1. Fuentes que aparecen en imagenes
  const fuentes = await pool.query(`
    SELECT fuente, COUNT(*) AS n FROM imagenes GROUP BY fuente ORDER BY n DESC LIMIT 10
  `);
  console.log('=== Fuentes en tabla imagenes ===');
  fuentes.rows.forEach(r => console.log(`  ${r.fuente}: ${r.n}`));

  // 2. ¿Cuántas tienen metadata útil? (excluyendo los duplicados que ya sabemos que es null)
  const meta = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE metadata IS NOT NULL) AS con_metadata,
      COUNT(*) FILTER (WHERE titulo IS NOT NULL AND titulo <> '') AS con_titulo,
      COUNT(*) FILTER (WHERE autor IS NOT NULL AND autor <> '') AS con_autor,
      COUNT(*) AS total
    FROM imagenes
  `);
  console.log('\n=== Cobertura de campos en imagenes (totales) ===');
  console.log(JSON.stringify(meta.rows[0], null, 2));

  // 3. Sample de imagenes con metadata
  const sample = await pool.query(`
    SELECT bien_id, url, titulo, autor, fuente, metadata
    FROM imagenes
    WHERE metadata IS NOT NULL
    LIMIT 3
  `);
  console.log('\n=== Sample con metadata ===');
  sample.rows.forEach(r => console.log(JSON.stringify(r, null, 2)));

  // 4. Sample de imagenes SIN metadata pero con título o autor
  const sample2 = await pool.query(`
    SELECT bien_id, url, titulo, autor, fuente
    FROM imagenes
    WHERE (titulo IS NOT NULL OR autor IS NOT NULL) AND metadata IS NULL
    LIMIT 5
  `);
  console.log('\n=== Sample sin metadata pero con título/autor ===');
  sample2.rows.forEach(r => console.log(JSON.stringify(r, null, 2)));

  // 5. Bienes con muchas imágenes (caso interesante para priorizar)
  const multi = await pool.query(`
    SELECT b.id, b.denominacion, COUNT(i.id) AS n_imgs
    FROM bienes b
    JOIN imagenes i ON i.bien_id = b.id
    GROUP BY b.id, b.denominacion
    HAVING COUNT(i.id) >= 10
    ORDER BY n_imgs DESC
    LIMIT 5
  `);
  console.log('\n=== Bienes con más imágenes (galerías grandes) ===');
  multi.rows.forEach(r => console.log(`  #${r.id} ${r.denominacion}: ${r.n_imgs} imágenes`));

  await pool.end();
})();
