/**
 * Migra bien_aliases de BD primaria a BD de búsqueda (PatrimonioEuropeo-Search).
 *
 * Fases:
 *   1. Crea schema en BD search (pg_trgm + tabla + índices)
 *   2. Importa filas desde backup local JSON
 *   3. (Opcional con --drop-source) DROP tabla en primaria + VACUUM FULL
 *
 * Uso:
 *   node _migrate_aliases_to_search_db.cjs               # solo importa
 *   node _migrate_aliases_to_search_db.cjs --drop-source # importa + dropea primaria
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const ARG_DROP = process.argv.includes('--drop-source');

const urlPri = process.env.DATABASE_URL.replace(/\s+/g, '');
const urlSearch = (process.env.DATABASE_URL_SEARCH || '').replace(/^'|'$/g, '').replace(/\s+/g, '');
if (!urlSearch) { console.error('Falta DATABASE_URL_SEARCH en .env'); process.exit(1); }

const poolPri = new Pool({ connectionString: urlPri, ssl: { rejectUnauthorized: false } });
const poolSearch = new Pool({ connectionString: urlSearch, ssl: { rejectUnauthorized: false } });

const BACKUP = 'C:/Users/usuario/Desktop/node2/bien_aliases_backup.json';

(async () => {
  // 1. Schema
  console.log('=== Fase 1: schema en BD search ===');
  try { await poolSearch.query('CREATE EXTENSION IF NOT EXISTS pg_trgm'); console.log('  pg_trgm OK'); }
  catch (e) { console.log('  pg_trgm:', e.message); }

  await poolSearch.query(`
    CREATE TABLE IF NOT EXISTS bien_aliases (
      bien_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      lang VARCHAR(8) NOT NULL,
      es_principal BOOLEAN DEFAULT FALSE,
      PRIMARY KEY (bien_id, alias, lang)
    )
  `);
  await poolSearch.query(`CREATE INDEX IF NOT EXISTS ix_ba_bien ON bien_aliases(bien_id)`);
  await poolSearch.query(`CREATE INDEX IF NOT EXISTS ix_ba_alias_trgm ON bien_aliases USING gin (alias gin_trgm_ops)`);
  console.log('  Tabla + índices creados');

  // 2. Importar desde backup
  console.log('\n=== Fase 2: importar desde backup ===');
  if (!fs.existsSync(BACKUP)) { console.error(`No existe ${BACKUP}`); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(BACKUP, 'utf-8'));
  console.log(`  Leídas ${data.length} filas del backup`);

  const BATCH = 500;
  let imported = 0;
  for (let i = 0; i < data.length; i += BATCH) {
    const slice = data.slice(i, i + BATCH);
    const values = [];
    const params = [];
    let p = 1;
    for (const row of slice) {
      values.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
      params.push(row.bien_id, row.alias, row.lang, row.es_principal);
    }
    await poolSearch.query(
      `INSERT INTO bien_aliases (bien_id, alias, lang, es_principal) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`,
      params
    );
    imported += slice.length;
    if (imported % 10000 === 0 || imported === data.length) {
      process.stdout.write(`  [${imported}/${data.length}]\n`);
    }
  }
  console.log(`  ${imported} filas importadas`);

  const verify = await poolSearch.query(`SELECT COUNT(*) AS n FROM bien_aliases`);
  console.log(`  Verificación: ${verify.rows[0].n} filas en BD search`);

  // 3. Drop primaria + VACUUM FULL
  if (ARG_DROP) {
    console.log('\n=== Fase 3: DROP en primaria + VACUUM FULL ===');
    const before = await poolPri.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS db`);
    console.log(`  BD primaria antes: ${before.rows[0].db}`);
    await poolPri.query(`DROP TABLE IF EXISTS bien_aliases CASCADE`);
    console.log(`  Tabla dropeada. Ejecutando VACUUM FULL...`);
    await poolPri.query(`VACUUM FULL`);
    const after = await poolPri.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS db`);
    console.log(`  BD primaria después: ${after.rows[0].db}`);
  } else {
    console.log('\n(modo sin DROP — añade --drop-source para liberar primaria)');
  }

  await poolPri.end();
  await poolSearch.end();
})();
