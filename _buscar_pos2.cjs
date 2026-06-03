require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });

(async () => {
  const patterns = [
    "^A l['’]oest",       // catalán
    "^A l['’]est",
    "^A nord d",          // italiano
    "^A sud d",
    "^A est d",
    "^A ovest d",
    "^A poniente",
    "^A parte d",         // portugués
    "^A oeste d",
    "^A leste d",
    "^A norte d",
    "^A sul d",
    "^A nord-",
    "^A sud-",
    "^A poucos metros",
    "^Cerca d",
    "^Al lado d",
    "^Al oeste d",
    "^Al este d",
  ];

  const seen = new Set();
  for (const p of patterns) {
    const r = await pool.query(
      `SELECT id, denominacion, municipio, tipo_monumento, pais FROM bienes WHERE denominacion ~* $1`,
      [p]
    );
    if (r.rows.length > 0) {
      console.log('\nPatrón "' + p + '": ' + r.rows.length);
      for (const row of r.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        console.log('  [' + row.id + '] ' + row.denominacion + ' | ' + row.municipio + ' (' + row.pais + ') | ' + (row.tipo_monumento || '-'));
      }
    }
  }
  console.log('\nTotal único: ' + seen.size);
  await pool.end();
})();
