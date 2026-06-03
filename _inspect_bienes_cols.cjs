require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='bienes' ORDER BY ordinal_position");
  console.log('Cols bienes:'); r.rows.forEach(x => console.log(' ', x.column_name));

  const c = await p.query("SELECT COUNT(*) FROM bienes WHERE qid IS NOT NULL");
  console.log('Bienes con qid:', c.rows[0].count);

  const t = await p.query("SELECT COUNT(*) FROM bienes");
  console.log('Total bienes:', t.rows[0].count);

  // ¿Cuántos bienes en municipios potencialmente Guerra Civil?
  const gc = await p.query(`SELECT COUNT(*) FROM bienes WHERE municipio ILIKE ANY (ARRAY['Belchite','Brunete','Teruel','Guernica','Gernika%','Brihuega'])`);
  console.log('Bienes en municipios Guerra Civil de muestra:', gc.rows[0].count);

  await p.end();
})();
