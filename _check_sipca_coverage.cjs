require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const t = await p.query(`SELECT COUNT(*) total, COUNT(descripcion_completa) con_desc, COUNT(sintesis_historica) con_sintesis FROM sipca`);
  console.log('SIPCA:', t.rows[0]);
  const r = await p.query(`SELECT bien_id, sipca_id, LENGTH(descripcion_completa) len_desc, LENGTH(sintesis_historica) len_sint FROM sipca WHERE descripcion_completa IS NOT NULL LIMIT 3`);
  console.log('Sample:'); r.rows.forEach(x => console.log(' ', x));
  await p.end();
})();
