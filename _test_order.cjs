require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // Buscar bien con MEZCLA wikidata + europeana
  const bienes = await pool.query(`
    SELECT bien_id FROM imagenes
    WHERE bien_id IN (
      SELECT bien_id FROM imagenes WHERE LOWER(fuente)='europeana'
      INTERSECT
      SELECT bien_id FROM imagenes WHERE LOWER(fuente) IN ('wikidata','wikimedia commons','commons')
    )
    GROUP BY bien_id
    HAVING COUNT(*) BETWEEN 5 AND 15
    LIMIT 3
  `);

  for (const b of bienes.rows) {
    console.log(`\n--- Bien #${b.bien_id} ---`);
    const w = await pool.query(`SELECT imagen_url FROM wikidata WHERE bien_id = $1`, [b.bien_id]);
    const wImg = w.rows[0]?.imagen_url || null;

    const r = await pool.query(`
      SELECT url, fuente FROM (
        SELECT DISTINCT ON (url) url, titulo, autor, fuente, metadata, id
        FROM imagenes
        WHERE bien_id = $1 AND url <> COALESCE($2, '')
        ORDER BY url, id
      ) sub
      ORDER BY
        CASE LOWER(COALESCE(fuente, ''))
          WHEN 'wikidata' THEN 1
          WHEN 'wikimedia commons' THEN 1
          WHEN 'commons' THEN 1
          WHEN 'sipca' THEN 2
          WHEN 'diba' THEN 3
          WHEN 'europeana' THEN 4
          ELSE 5
        END, id
    `, [b.bien_id, wImg]);
    r.rows.forEach((x, i) => console.log(`  ${i + 1}. [${x.fuente}] ${x.url.substring(0, 80)}...`));
  }

  await pool.end();
})();
