require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const sin = await p.query(`SELECT qid_evento, MIN(evento) label, COUNT(DISTINCT bien_id) n FROM eventos_monumento WHERE qid_evento_padre IS NULL GROUP BY qid_evento ORDER BY n DESC`);
  console.log(`Eventos sin padre: ${sin.rows.length} qids únicos\n`);
  console.log('Top 50 (qid | label | nº monumentos):');
  sin.rows.slice(0, 50).forEach(r => console.log(`  ${r.qid_evento.padEnd(15)} ${(r.label||'').slice(0,55).padEnd(55)} ${r.n}`));

  const tot = await p.query(`SELECT COUNT(DISTINCT bien_id) FROM eventos_monumento WHERE qid_evento_padre IS NULL`);
  console.log(`\nTotal monumentos afectados: ${tot.rows[0].count}`);

  await p.end();
})();
