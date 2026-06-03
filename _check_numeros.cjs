require('dotenv').config();
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });

  const r = await pool.query(`
    SELECT b.id, b.denominacion, b.codigo_fuente, b.municipio, b.pais
    FROM bienes b
    WHERE b.denominacion ~ '^[0-9]'
    ORDER BY b.denominacion
    LIMIT 200
  `);
  console.log('Primeros 200 con denominación empezando por número:\n');
  for (const row of r.rows) {
    console.log('[' + row.id + '] "' + row.denominacion.substring(0, 80) + '" | ' + (row.municipio || '') + ' | ' + row.pais);
  }

  const total = await pool.query("SELECT COUNT(*) as n FROM bienes WHERE denominacion ~ '^[0-9]'");
  console.log('\nTotal con denominación empezando por número: ' + total.rows[0].n);

  // Patrón: ID-blanco/guion (tipo "1234 algo" o "1234-algo")
  const idLike = await pool.query("SELECT COUNT(*) as n FROM bienes WHERE denominacion ~ '^[0-9]+[ _/-]'");
  console.log('Empiezan con número + separador (probable ID): ' + idLike.rows[0].n);

  // Solo número al principio, sin más
  const onlyNum = await pool.query("SELECT COUNT(*) as n FROM bienes WHERE denominacion ~ '^[0-9]+$'");
  console.log('Solo número, sin más texto: ' + onlyNum.rows[0].n);

  await pool.end();
})();
