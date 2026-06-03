require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const ARG_APPLY_DROP = process.argv.includes('--drop');

(async () => {
  // 1. Export a JSON gzipeable (más eficiente que CSV)
  console.log('Exportando bien_aliases...');
  const r = await pool.query(`SELECT bien_id, alias, lang, es_principal FROM bien_aliases`);
  console.log(`  ${r.rows.length} filas`);

  const backupPath = 'C:/Users/usuario/Desktop/node2/bien_aliases_backup.json';
  fs.writeFileSync(backupPath, JSON.stringify(r.rows));
  const sizeMB = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(1);
  console.log(`  Backup: ${backupPath} (${sizeMB} MB)`);

  // 2. Verificar tamaño actual
  const s1 = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS db`);
  console.log(`\nBD antes: ${s1.rows[0].db}`);

  if (ARG_APPLY_DROP) {
    console.log('Dropeando bien_aliases...');
    await pool.query(`DROP TABLE IF EXISTS bien_aliases CASCADE`);
    // Forzar reclamación de espacio
    await pool.query(`VACUUM FULL`);
    const s2 = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS db`);
    console.log(`BD después VACUUM FULL: ${s2.rows[0].db}`);
  } else {
    console.log('\n(modo dry-run — añade --drop para ejecutar DROP + VACUUM FULL)');
  }

  await pool.end();
})();
