require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL.replace(/\s+/g,''),ssl:{rejectUnauthorized:false}});
(async()=>{
  const tablas=['favoritos','notas_monumento','valoraciones_monumento','rutas_paradas','rutas_culturales_paradas','sipca','propuestas_monumentos','eventos_monumento','social_history'];
  for(const t of tablas){
    const r=await p.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position",
      [t]
    );
    console.log('\n'+t+': '+r.rows.map(c=>c.column_name).join(', '));
  }
  await p.end();
})();
