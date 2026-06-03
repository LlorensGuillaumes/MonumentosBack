// Crear tabla satélite rutas_culturales_traducciones
require('dotenv').config();
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  const sql = `
    CREATE TABLE IF NOT EXISTS rutas_culturales_traducciones (
      ruta_id INTEGER NOT NULL REFERENCES rutas_culturales(id) ON DELETE CASCADE,
      lang TEXT NOT NULL,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (ruta_id, lang)
    );
    CREATE INDEX IF NOT EXISTS idx_rct_lang ON rutas_culturales_traducciones(lang);
  `;
  if (APPLY) {
    await p.query(sql);
    console.log('✓ Tabla creada');
  } else {
    console.log('DRY-RUN. SQL:\n' + sql + '\nEjecutar con --apply');
  }
  await p.end();
})();
