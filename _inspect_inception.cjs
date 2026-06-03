require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const t = await p.query("SELECT COUNT(*) FROM wikidata WHERE inception IS NOT NULL AND inception != ''");
  console.log('Bienes con inception:', t.rows[0].count);

  const tot = await p.query("SELECT COUNT(*) FROM wikidata");
  console.log('Total wikidata:', tot.rows[0].count);

  // Sample formato
  const s = await p.query("SELECT qid, inception FROM wikidata WHERE inception IS NOT NULL AND inception != '' LIMIT 20");
  console.log('Sample inception:'); s.rows.forEach(x => console.log(' ', x.qid, '→', x.inception));

  // Coverage en bienes Madrid (ejemplo de ciudad grande)
  const m = await p.query(`SELECT COUNT(*) FILTER (WHERE w.inception IS NOT NULL AND w.inception != '') as con_inc, COUNT(*) as total
    FROM bienes b LEFT JOIN wikidata w ON w.bien_id = b.id
    WHERE LOWER(b.municipio) = 'madrid'`);
  console.log('Madrid:', m.rows[0]);

  await p.end();
})();
