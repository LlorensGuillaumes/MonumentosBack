require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // Simular el nuevo query del endpoint para #296609
  const bien = await pool.query(`SELECT imagen_url FROM wikidata WHERE bien_id = 296609`);
  const wikiImg = bien.rows[0]?.imagen_url || null;
  console.log('wikidata.imagen_url:', wikiImg);

  const imgs = await pool.query(`
    SELECT DISTINCT ON (url) url, titulo, autor, fuente, metadata
    FROM imagenes
    WHERE bien_id = $1 AND url <> COALESCE($2, '')
    ORDER BY url, id
  `, [296609, wikiImg]);
  console.log(`\nImágenes después del dedupe (era 1, ahora ${imgs.rows.length}):`);
  imgs.rows.forEach(r => console.log(`  ${r.url} | ${r.titulo}`));

  // Probar también con otro bien que tenga galería real (más de 1 imagen)
  const multi = await pool.query(`
    SELECT bien_id, COUNT(*) AS n FROM imagenes GROUP BY bien_id HAVING COUNT(*) > 3 LIMIT 1
  `);
  if (multi.rows.length > 0) {
    const testBien = multi.rows[0].bien_id;
    console.log(`\n=== Test con bien #${testBien} (${multi.rows[0].n} imágenes en tabla) ===`);
    const b2 = await pool.query(`SELECT imagen_url FROM wikidata WHERE bien_id = $1`, [testBien]);
    const wiki2 = b2.rows[0]?.imagen_url || null;
    console.log('wikidata.imagen_url:', wiki2);
    const imgs2 = await pool.query(`
      SELECT DISTINCT ON (url) url FROM imagenes
      WHERE bien_id = $1 AND url <> COALESCE($2, '')
      ORDER BY url, id
    `, [testBien, wiki2]);
    console.log(`Después del dedupe: ${imgs2.rows.length} imágenes únicas en galería`);
  }

  await pool.end();
})();
