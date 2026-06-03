// Identificar y limpiar matches a bienes cuyo "municipio" es realmente una CCAA/region/provincia
require('dotenv').config();
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');

const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });

(async () => {
  // Detectar bienes donde el municipio coincide con una CCAA o provincia
  // (signo claro de mala etiqueta)
  const bad = await p.query(`
    SELECT DISTINCT b.id, b.denominacion, b.municipio, b.provincia, b.comunidad_autonoma, b.pais
    FROM bienes b
    JOIN eventos_monumento em ON em.bien_id = b.id
    WHERE em.fuente = 'wikidata-match-v2'
      AND (
        EXISTS (SELECT 1 FROM bienes b2 WHERE b2.comunidad_autonoma = b.municipio LIMIT 1)
        OR EXISTS (SELECT 1 FROM bienes b2 WHERE b2.provincia = b.municipio AND b2.provincia != b.municipio LIMIT 1)
        OR b.municipio ILIKE 'provincia de %'
      )
  `);
  console.log(`Bienes con municipio = CCAA/provincia: ${bad.rows.length}`);
  bad.rows.slice(0, 30).forEach(r => console.log(' ', r.id, '|', r.denominacion, '| muni:', r.municipio, '| ccaa:', r.comunidad_autonoma));

  // Cuántos eventos_monumento se generaron a estos bienes
  const cnt = await p.query(`
    SELECT COUNT(*) FROM eventos_monumento em
    WHERE em.fuente = 'wikidata-match-v2'
      AND em.bien_id IN (
        SELECT b.id FROM bienes b WHERE
          EXISTS (SELECT 1 FROM bienes b2 WHERE b2.comunidad_autonoma = b.municipio LIMIT 1)
          OR EXISTS (SELECT 1 FROM bienes b2 WHERE b2.provincia = b.municipio AND b2.provincia != b.municipio LIMIT 1)
          OR b.municipio ILIKE 'provincia de %'
      )
  `);
  console.log(`\nEventos_monumento (wikidata-match-v2) a borrar: ${cnt.rows[0].count}`);

  if (!APPLY) { await p.end(); return; }

  console.log('\nBorrando...');
  const r = await p.query(`
    DELETE FROM eventos_monumento
    WHERE fuente = 'wikidata-match-v2'
      AND bien_id IN (
        SELECT b.id FROM bienes b WHERE
          EXISTS (SELECT 1 FROM bienes b2 WHERE b2.comunidad_autonoma = b.municipio LIMIT 1)
          OR EXISTS (SELECT 1 FROM bienes b2 WHERE b2.provincia = b.municipio AND b2.provincia != b.municipio LIMIT 1)
          OR b.municipio ILIKE 'provincia de %'
      )
  `);
  console.log(`Borrados: ${r.rowCount}`);
  await p.end();
})();
