/**
 * VACUUM FULL en Neon — ejecuta de noche para no bloquear tráfico.
 * Loguea progreso a _vacuum_log.txt junto al script.
 *
 * IMPORTANTE: VACUUM FULL bloquea las tablas durante minutos.
 * No correr durante horas activas.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '_vacuum_log.txt');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line);
}

(async () => {
  log('============================================');
  log('VACUUM FULL Neon — inicio');
  log('============================================');

  // Importante: usar conexión directa, no la pooled (pgbouncer no soporta VACUUM FULL bien)
  const cs = process.env.DATABASE_URL.replace(/\s+/g, '');
  const p = new Pool({
    connectionString: cs,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 0, // sin timeout, VACUUM puede tardar
  });

  let client;
  try {
    client = await p.connect();

    const sizeBefore = await client.query(
      'SELECT pg_size_pretty(pg_database_size(current_database())) as size, pg_database_size(current_database()) as bytes'
    );
    log(`Tamaño antes: ${sizeBefore.rows[0].size}`);
    const bytesBefore = parseInt(sizeBefore.rows[0].bytes, 10);

    // 1) Borrar wikidata.raw_json (16 MB no usados)
    log('--- Borrando wikidata.raw_json ---');
    const updRes = await client.query('UPDATE wikidata SET raw_json = NULL WHERE raw_json IS NOT NULL');
    log(`raw_json borrado en ${updRes.rowCount} filas`);

    // 2) VACUUM FULL en tablas grandes (orden por tamaño descendente)
    const tables = [
      'bienes',
      'wikidata',
      'imagenes',
      'contactos_municipios',
      'sipca',
      'eventos_monumento',
      'rutas_culturales_paradas',
      'rutas_culturales_traducciones',
    ];

    for (const t of tables) {
      log(`--- VACUUM FULL ${t} ---`);
      const start = Date.now();
      try {
        await client.query(`VACUUM FULL ${t}`);
        log(`${t}: completado en ${((Date.now() - start) / 1000).toFixed(1)}s`);
      } catch (e) {
        log(`${t}: ERROR — ${e.message}`);
      }
    }

    const sizeAfter = await client.query(
      'SELECT pg_size_pretty(pg_database_size(current_database())) as size, pg_database_size(current_database()) as bytes'
    );
    const bytesAfter = parseInt(sizeAfter.rows[0].bytes, 10);
    log(`Tamaño después: ${sizeAfter.rows[0].size}`);
    log(`Liberado: ${((bytesBefore - bytesAfter) / 1024 / 1024).toFixed(1)} MB`);
    log('============================================');
    log('VACUUM FULL completado OK');
    log('============================================');
  } catch (err) {
    log(`ERROR FATAL: ${err.message}`);
    log(err.stack || '');
  } finally {
    if (client) client.release();
    await p.end();
  }
})();
