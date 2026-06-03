require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL.replace(/\s+/g,''),ssl:{rejectUnauthorized:false}});
(async()=>{
  const r=await p.query(`
    SELECT conrelid::regclass::text AS tabla, conname, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    WHERE contype='f' AND confrelid='bienes'::regclass
    ORDER BY tabla
  `);
  console.log('FKs apuntando a bienes:');
  r.rows.forEach(r=>console.log('  '+r.tabla+'  '+r.def));
  await p.end();
})();
