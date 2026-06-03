require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  // 1. Cuneo en BD
  console.log('=== Cuneo ===');
  const c = await p.query(`SELECT pais, comunidad_autonoma, provincia, COUNT(*) FROM bienes WHERE provincia ILIKE '%cuneo%' GROUP BY pais, comunidad_autonoma, provincia`);
  c.rows.forEach(x => console.log(' ', x));

  // 2. Bienes en pais=España, region Catalunya, provincia Cuneo (debería ser 0)
  const c2 = await p.query(`SELECT pais, comunidad_autonoma, provincia, COUNT(*) FROM bienes WHERE pais='España' AND comunidad_autonoma='Catalunya' GROUP BY pais, comunidad_autonoma, provincia ORDER BY 3`);
  console.log('\n=== Provincias en España/Catalunya ===');
  c2.rows.forEach(x => console.log(' ', x.provincia, '|', x.count));

  // 3. ¿Cómo se llama region en el filtro? Catalunya o Cataluña?
  const r = await p.query(`SELECT DISTINCT comunidad_autonoma FROM bienes WHERE pais='España' AND comunidad_autonoma ILIKE '%catalu%'`);
  console.log('\n=== Region match Catalu* ===');
  r.rows.forEach(x => console.log(' ', x.comunidad_autonoma));

  // 4. Evento "Calzadas romanas"
  console.log('\n=== Calzadas romanas ===');
  const ev = await p.query(`SELECT qid_evento, qid_evento_padre, evento, COUNT(DISTINCT bien_id) FROM eventos_monumento WHERE evento ILIKE '%calzada%' OR evento ILIKE '%itinerario%' GROUP BY 1,2,3`);
  ev.rows.forEach(x => console.log(' ', x));

  // 5. Eventos con padre Q10859 GC
  const ev2 = await p.query(`SELECT em.qid_evento, em.evento, COUNT(DISTINCT em.bien_id) FROM eventos_monumento em WHERE em.qid_evento_padre = 'Q10859' GROUP BY 1,2 ORDER BY 3 DESC`);
  console.log('\n=== Eventos con padre Q10859 GC ===');
  ev2.rows.forEach(x => console.log(' ', x.qid_evento, '|', x.evento, '|', x.count));

  await p.end();
})();
