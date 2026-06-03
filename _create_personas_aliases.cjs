require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  // Estado espacio BD
  const size = await pool.query(`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
           pg_size_pretty(pg_total_relation_size('bienes')) AS bienes_size,
           pg_size_pretty(pg_total_relation_size('wikidata')) AS wikidata_size,
           pg_size_pretty(pg_total_relation_size('imagenes')) AS imagenes_size
  `);
  console.log('Tamaños actuales:', JSON.stringify(size.rows[0], null, 2));

  // Bienes con QID
  const qids = await pool.query(`SELECT COUNT(*) AS n FROM wikidata WHERE qid IS NOT NULL`);
  console.log(`\nBienes con QID a procesar: ${qids.rows[0].n}`);

  // Crear tablas
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bien_personas (
      bien_id INTEGER NOT NULL,
      qid_persona TEXT NOT NULL,
      nombre TEXT,
      rol TEXT NOT NULL,
      PRIMARY KEY (bien_id, qid_persona, rol)
    )
  `);
  console.log('Tabla bien_personas creada/verificada');

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ix_bp_qid ON bien_personas(qid_persona)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ix_bp_rol ON bien_personas(rol)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ix_bp_bien ON bien_personas(bien_id)
  `);

  // Aliases
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bien_aliases (
      bien_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      lang VARCHAR(8) NOT NULL,
      es_principal BOOLEAN DEFAULT FALSE,
      PRIMARY KEY (bien_id, alias, lang)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_ba_bien ON bien_aliases(bien_id)`);

  // Para fuzzy search con trigram (requiere pg_trgm)
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS ix_bp_nombre_trgm ON bien_personas USING gin (nombre gin_trgm_ops)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS ix_ba_alias_trgm ON bien_aliases USING gin (alias gin_trgm_ops)
    `);
    console.log('pg_trgm habilitado + índices GIN trigram creados');
  } catch (e) {
    console.log('pg_trgm no disponible:', e.message);
  }

  // Verificar
  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('bien_personas','bien_aliases')
  `);
  console.log('\nTablas existentes:', tables.rows.map(r => r.table_name).join(', '));

  await pool.end();
})();
