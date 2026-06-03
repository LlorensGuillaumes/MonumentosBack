/**
 * Setup schema en la BD secundaria de enriquecimiento (PatrimonioEuropeo-Enrichment).
 *
 * Tabla wikipedia_extracts almacena contenido de Wikipedia por bien (introducción,
 * secciones Historia/Arquitectura) en el idioma original del artículo. Se enlaza por
 * bien_id (PK referenciando la BD primaria — NO hay FK porque son BDs distintas;
 * se mantiene consistencia a nivel de aplicación).
 *
 * Idempotente: re-ejecutar es seguro (CREATE TABLE IF NOT EXISTS).
 *
 * Uso:
 *   node _setup_enrichment_db.cjs
 */
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_URL_ENRICHMENT?.replace(/^'|'$/g, '').replace(/\s+/g, '');
if (!url) {
  console.error('ERROR: DATABASE_URL_ENRICHMENT no encontrada en .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wikipedia_extracts (
  bien_id     INTEGER PRIMARY KEY,
  qid         TEXT,
  lang        VARCHAR(8),
  extract     TEXT,
  historia    TEXT,
  arquitectura TEXT,
  source_url  TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_wikipedia_extracts_qid ON wikipedia_extracts (qid);
CREATE INDEX IF NOT EXISTS ix_wikipedia_extracts_fetched_at ON wikipedia_extracts (fetched_at);
`;

(async () => {
  const client = await pool.connect();
  try {
    console.log('Aplicando schema...');
    await client.query(SCHEMA);
    console.log('Schema aplicado OK.');

    const r = await client.query(`
      SELECT
        column_name,
        data_type,
        character_maximum_length AS maxlen,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = 'wikipedia_extracts'
      ORDER BY ordinal_position
    `);
    console.log('\nTabla wikipedia_extracts:');
    r.rows.forEach(c => console.log(`  ${c.column_name.padEnd(15)} ${c.data_type}${c.maxlen ? '('+c.maxlen+')' : ''}  ${c.is_nullable === 'YES' ? '' : 'NOT NULL'}`));

    const i = await client.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'wikipedia_extracts'
    `);
    console.log('\nÍndices:');
    i.rows.forEach(r => console.log(`  ${r.indexname}`));

    console.log('\n✓ Setup completado.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
