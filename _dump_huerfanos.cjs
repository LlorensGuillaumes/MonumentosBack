require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query(`SELECT qid_evento as qid, MIN(evento) label, COUNT(DISTINCT bien_id) n FROM eventos_monumento WHERE qid_evento_padre IS NULL GROUP BY qid_evento ORDER BY n DESC, qid_evento`);
  fs.writeFileSync('_huerfanos.json', JSON.stringify(r.rows, null, 2));
  console.log(`Dumped ${r.rows.length} qids to _huerfanos.json`);
  await p.end();
})();
