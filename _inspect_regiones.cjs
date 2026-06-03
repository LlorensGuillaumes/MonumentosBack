require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query(`SELECT comunidad_autonoma, COUNT(*) n, COUNT(DISTINCT provincia) provs FROM bienes WHERE pais='España' GROUP BY comunidad_autonoma ORDER BY LOWER(comunidad_autonoma)`);
  console.log('Regiones en pais=España:');
  r.rows.forEach(x => console.log(`  ${(x.comunidad_autonoma||'(null)').padEnd(40)} ${x.n.padStart(7)} bienes  | ${x.provs} provs distintas`));

  // Para cada region "rara", muestrear provincias
  for (const region of r.rows) {
    if (region.n < 50) continue;
    const provs = await p.query(`SELECT DISTINCT provincia, COUNT(*) n FROM bienes WHERE pais='España' AND comunidad_autonoma=$1 GROUP BY provincia ORDER BY n DESC LIMIT 5`, [region.comunidad_autonoma]);
    console.log(`\n  ${region.comunidad_autonoma}:`);
    provs.rows.forEach(x => console.log(`    ${x.provincia} (${x.n})`));
  }
  await p.end();
})();
