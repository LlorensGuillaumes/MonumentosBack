require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const t = await p.query(`SELECT COUNT(*) FROM eventos_monumento WHERE evento IS NULL OR evento = ''`);
  const tot = await p.query(`SELECT COUNT(*) FROM eventos_monumento`);
  console.log('Total:', tot.rows[0].count, '| Sin evento (label):', t.rows[0].count);

  // Sample QIDs sin label
  const s = await p.query(`SELECT DISTINCT qid_evento, COUNT(*) n FROM eventos_monumento WHERE evento IS NULL OR evento = '' GROUP BY qid_evento ORDER BY n DESC LIMIT 15`);
  console.log('\nQIDs sin label, top 15:');
  s.rows.forEach(x => console.log('  ', x.qid_evento, '|', x.n, 'monumentos'));

  // Cuántos qids unicos tienen evento NULL
  const u = await p.query(`SELECT COUNT(DISTINCT qid_evento) FROM eventos_monumento WHERE evento IS NULL OR evento = ''`);
  console.log('\nQIDs únicos sin label:', u.rows[0].count);

  await p.end();
})();
