/**
 * Añadir columna qid_evento_padre a eventos_monumento y rellenarla
 * basándose en el análisis previo (_eventos_analisis.json) y categorías padre definidas.
 *
 * Solo se aplican padres que tienen al menos 1 monumento en la BD (categorías vacías
 * documentadas para más adelante: Revolución Francesa Q6534, Industrial Q66344,
 * Risorgimento Q166713).
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const PARENT_CATEGORIES = {
  'Q10859': 'Guerra Civil Española',
  'Q152499': 'Guerra de Independencia Española',
  'Q150701': 'Guerra de Sucesión Española',
  'Q79791': 'Reconquista',
  'Q1178424': 'Guerras Carlistas',
  'Q1200506': 'Desamortización española',
  'Q1501724': 'Guerra de Restauración portuguesa',
  'Q2105495': 'Crisis de 1383-1385 (Portugal)',
  'Q164432': 'Guerra de los Ochenta Años',
  'Q51657': 'Cruzada albigense',
  'Q78994': 'Guerras Napoleónicas',
  'Q362': 'Segunda Guerra Mundial',
};

const ANALYSIS = JSON.parse(fs.readFileSync('C:\\Users\\usuario\\Desktop\\node2\\_eventos_analisis.json', 'utf8'));

async function fix(connConfig, label) {
  const pool = new Pool(connConfig);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Añadir columna si no existe
    await client.query(`
      ALTER TABLE eventos_monumento
      ADD COLUMN IF NOT EXISTS qid_evento_padre TEXT
    `);

    // 2) Para cada qid_evento, decidir qué padre asignar (de los definidos)
    // Usar el análisis previo: parents[qid] = [{qid, label}, ...]
    let updates = 0;
    const skipped = [];

    for (const [qidEvento, parents] of Object.entries(ANALYSIS.parents)) {
      // Buscar si alguno de sus padres está en nuestra lista
      let padreElegido = null;
      for (const p of parents) {
        if (PARENT_CATEGORIES[p.qid]) {
          padreElegido = p.qid;
          break;
        }
      }

      // Si el evento ES uno de los padres directamente, asignarse a sí mismo
      if (PARENT_CATEGORIES[qidEvento]) {
        padreElegido = qidEvento;
      }

      if (padreElegido) {
        const r = await client.query(
          'UPDATE eventos_monumento SET qid_evento_padre = $1 WHERE qid_evento = $2',
          [padreElegido, qidEvento]
        );
        updates += r.rowCount;
      } else {
        skipped.push(qidEvento);
      }
    }

    // 3) Asignación cruzada: eventos que SON nuestros padres directos (también)
    for (const qidPadre of Object.keys(PARENT_CATEGORIES)) {
      const r = await client.query(
        'UPDATE eventos_monumento SET qid_evento_padre = $1 WHERE qid_evento = $1 AND qid_evento_padre IS NULL',
        [qidPadre]
      );
      if (r.rowCount > 0) updates += r.rowCount;
    }

    await client.query('COMMIT');

    // Resumen por categoría
    const stats = await client.query(`
      SELECT qid_evento_padre, COUNT(DISTINCT bien_id) as n
      FROM eventos_monumento
      WHERE qid_evento_padre IS NOT NULL
      GROUP BY qid_evento_padre
      ORDER BY n DESC
    `);
    console.log(`\n${label}: ${updates} filas actualizadas\n`);
    console.log('Categorías padre (con monumentos):');
    for (const row of stats.rows) {
      const name = PARENT_CATEGORIES[row.qid_evento_padre] || row.qid_evento_padre;
      console.log(`  ${row.qid_evento_padre} "${name}": ${row.n} monumentos`);
    }
    console.log(`\nEventos sin padre asignado (genéricos sueltos): ${skipped.length}`);
  } catch(e) {
    await client.query('ROLLBACK');
    console.error(label + ' ERR:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

(async () => {
  await fix({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } }, 'NEON');
  try { await fix({ host: 'localhost', port: 5433, user: 'patrimonio', password: 'patrimonio2026', database: 'patrimonio' }, 'LOCAL'); } catch(e) { console.log('LOCAL: skipped'); }
})();
