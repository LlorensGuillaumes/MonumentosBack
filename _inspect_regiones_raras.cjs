require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
const RARAS = [
  'Alto Alentejo','Alto Pirineo y Arán','Andalucía','Aragón','Barcelona','Barcelonés',
  'Campo de Tarragona','Castilla y León','Cataluña Central','Comarcas gerundenses',
  'España','Hesse','Médio Tejo','Occitania','Países Bajos','Zahedan'
];
(async () => {
  for (const r of RARAS) {
    const rows = (await p.query(`SELECT id, denominacion, municipio, provincia, comunidad_autonoma, pais FROM bienes WHERE pais='España' AND comunidad_autonoma=$1 LIMIT 10`, [r])).rows;
    console.log(`\n=== ${r} (${rows.length}) ===`);
    rows.forEach(x => console.log(`  ${x.id} | ${x.denominacion} | muni=${x.municipio} | prov=${x.provincia}`));
  }
  // Provincia "provincia de X"
  console.log('\n=== Provincias con prefijo "provincia de" ===');
  const provs = (await p.query(`SELECT provincia, comunidad_autonoma, pais, COUNT(*) n FROM bienes WHERE provincia ILIKE 'provincia de %' GROUP BY 1,2,3 ORDER BY n DESC`)).rows;
  provs.forEach(x => console.log(`  ${x.provincia} | ${x.comunidad_autonoma} | ${x.pais} | ${x.n}`));
  // Provincias bilingues
  console.log('\n=== Provincias bilingues / con / ===');
  const bil = (await p.query(`SELECT provincia, comunidad_autonoma, pais, COUNT(*) n FROM bienes WHERE provincia LIKE '%/%' GROUP BY 1,2,3 ORDER BY n DESC`)).rows;
  bil.forEach(x => console.log(`  ${x.provincia} | ${x.comunidad_autonoma} | ${x.pais} | ${x.n}`));
  // "Leon" sin tilde, "Castellon" sin tilde
  console.log('\n=== Provincias sin tildes ===');
  const sin = (await p.query(`SELECT DISTINCT provincia, comunidad_autonoma, pais, COUNT(*) n FROM bienes WHERE pais='España' AND provincia IN ('Leon','Castellon','Cadiz','Cordoba','Almeria','Caceres','Malaga','Jaen','Alcala','Alava','Guipuzcoa','Vizcaya') GROUP BY 1,2,3 ORDER BY n DESC`)).rows;
  sin.forEach(x => console.log(`  ${x.provincia} | ${x.comunidad_autonoma} | ${x.pais} | ${x.n}`));
  await p.end();
})();
