require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const total = await p.query(`SELECT pg_size_pretty(pg_database_size(current_database())) as size, pg_database_size(current_database()) as bytes`);
  console.log(`\n=== Tamaño total BD: ${total.rows[0].size} (${(total.rows[0].bytes / 1024 / 1024).toFixed(1)} MB) ===\n`);

  const tables = await p.query(`
    SELECT
      schemaname || '.' || tablename AS tabla,
      pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS tamano,
      pg_total_relation_size(schemaname || '.' || tablename) AS bytes,
      (SELECT n_live_tup FROM pg_stat_all_tables WHERE relname = tablename) AS filas
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
  `);
  console.log('Por tabla (ordenadas por tamaño):');
  console.log('  ' + 'Tabla'.padEnd(45) + 'Tamaño'.padEnd(15) + 'Filas');
  console.log('  ' + '-'.repeat(70));
  for (const r of tables.rows) {
    console.log(`  ${r.tabla.padEnd(45)}${r.tamano.padEnd(15)}${(r.filas || 0).toLocaleString()}`);
  }

  await p.end();
})();
