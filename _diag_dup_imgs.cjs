require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // ¿Cuántos duplicados (imagenes.url == wikidata.imagen_url) tienen metadata útil?
  const r1 = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(i.metadata) AS con_metadata,
      COUNT(i.titulo) AS con_titulo,
      COUNT(i.autor) AS con_autor
    FROM imagenes i
    JOIN wikidata w ON w.bien_id = i.bien_id
    WHERE w.imagen_url = i.url
  `);
  console.log('Filas duplicadas (imagenes.url == wikidata.imagen_url):');
  console.log(JSON.stringify(r1.rows[0], null, 2));

  // Sample de las que SÍ tienen metadata para ver qué se perdería
  const r2 = await pool.query(`
    SELECT i.id, i.bien_id, i.titulo, i.autor, i.fuente, i.metadata
    FROM imagenes i
    JOIN wikidata w ON w.bien_id = i.bien_id
    WHERE w.imagen_url = i.url AND i.metadata IS NOT NULL
    LIMIT 3
  `);
  console.log('\nSample con metadata (qué se perdería):');
  r2.rows.forEach(r => console.log(JSON.stringify(r, null, 2)));

  await pool.end();
})();
