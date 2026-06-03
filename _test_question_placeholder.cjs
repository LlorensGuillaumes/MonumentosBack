require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await p.query(`SELECT comunidad_autonoma as value, pais, COUNT(*) as count FROM bienes WHERE comunidad_autonoma IS NOT NULL AND pais = ? GROUP BY comunidad_autonoma, pais ORDER BY LOWER(comunidad_autonoma) LIMIT 5`, ['España']);
    console.log('Resultado con ?:', r.rows);
  } catch(e) { console.log('Error con ?:', e.message); }

  try {
    const r = await p.query(`SELECT comunidad_autonoma as value, pais, COUNT(*) as count FROM bienes WHERE comunidad_autonoma IS NOT NULL AND pais = $1 GROUP BY comunidad_autonoma, pais ORDER BY LOWER(comunidad_autonoma) LIMIT 5`, ['España']);
    console.log('Resultado con $1:', r.rows);
  } catch(e) { console.log('Error con $1:', e.message); }
  await p.end();
})();
