require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // 1. Comparar wikidata.imagen_url vs imagenes.url para #296609
  const r = await pool.query(`
    SELECT
      w.imagen_url AS wikidata_imagen,
      i.url AS imagenes_url,
      i.fuente,
      w.imagen_url = i.url AS son_iguales
    FROM wikidata w
    LEFT JOIN imagenes i ON i.bien_id = w.bien_id
    WHERE w.bien_id = 296609
  `);
  console.log('=== #296609: wikidata.imagen_url vs imagenes.url ===');
  console.log(JSON.stringify(r.rows, null, 2));

  // 2. Escala del problema: cuántos bienes tienen wikidata.imagen_url == imagenes.url (duplicados)
  const dupes = await pool.query(`
    SELECT COUNT(DISTINCT w.bien_id) AS bienes_con_duplicado
    FROM wikidata w
    JOIN imagenes i ON i.bien_id = w.bien_id
    WHERE w.imagen_url IS NOT NULL
      AND w.imagen_url = i.url
  `);
  console.log('\nBienes con imagen wikidata.imagen_url = imagenes.url:', dupes.rows[0].bienes_con_duplicado);

  // 3. Cuántos bienes tienen wikidata.imagen_url no nulo
  const wd = await pool.query(`SELECT COUNT(*) AS n FROM wikidata WHERE imagen_url IS NOT NULL`);
  console.log('Total bienes con wikidata.imagen_url no nulo:', wd.rows[0].n);

  // 4. Cuántos bienes tienen entradas en imagenes
  const ti = await pool.query(`SELECT COUNT(DISTINCT bien_id) AS n FROM imagenes`);
  console.log('Total bienes con al menos 1 entrada en imagenes:', ti.rows[0].n);

  // 5. Duplicados dentro de la tabla imagenes (misma URL repetida para mismo bien)
  const dupInside = await pool.query(`
    SELECT COUNT(*) AS n FROM (
      SELECT bien_id, url FROM imagenes
      GROUP BY bien_id, url
      HAVING COUNT(*) > 1
    ) x
  `);
  console.log('Duplicados intra-tabla imagenes (mismo bien_id+url): ', dupInside.rows[0].n);

  await pool.end();
})();
