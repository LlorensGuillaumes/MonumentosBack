// Simular query del backend /api/filtros con pais=España, region=Catalunya
require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  // Test provincias con pais=España AND region=Catalunya
  let provWhere = 'provincia IS NOT NULL';
  let provParams = ['España', 'Catalunya'];
  provWhere += ` AND pais = $1 AND comunidad_autonoma = $2`;
  const r = await p.query(`SELECT provincia as value, comunidad_autonoma as region, pais, COUNT(*) as count FROM bienes WHERE ${provWhere} GROUP BY provincia, comunidad_autonoma, pais ORDER BY LOWER(provincia)`, provParams);
  console.log('Provincias con pais=España AND region=Catalunya:');
  r.rows.forEach(x => console.log(' ', x.value, '|', x.region, '|', x.pais, '|', x.count));

  // 2. Eventos con pais=España, region=Catalunya, evento_padre=Q10859
  console.log('\n=== Eventos GC con pais=España AND region=Catalunya ===');
  const ev = await p.query(`
    SELECT em.qid_evento as value, COUNT(DISTINCT em.bien_id) as count
    FROM eventos_monumento em
    JOIN bienes b ON em.bien_id = b.id
    WHERE em.qid_evento IS NOT NULL AND em.qid_evento_padre = $1
      AND b.pais = $2 AND b.comunidad_autonoma = $3
    GROUP BY em.qid_evento ORDER BY count DESC
  `, ['Q10859', 'España', 'Catalunya']);
  ev.rows.forEach(x => console.log(' ', x.value, '|', x.count));

  // 3. ¿Hay bienes en Catalunya con qid_evento_padre Q10859?
  console.log('\n=== Bienes Catalunya con padre Q10859 ===');
  const b = await p.query(`
    SELECT em.evento, em.qid_evento, b.denominacion, b.municipio
    FROM eventos_monumento em
    JOIN bienes b ON em.bien_id = b.id
    WHERE em.qid_evento_padre = 'Q10859' AND b.pais='España' AND b.comunidad_autonoma='Catalunya'
    LIMIT 20
  `);
  b.rows.forEach(x => console.log(' ', x));

  await p.end();
})();
