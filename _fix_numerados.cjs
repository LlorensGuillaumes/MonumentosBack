require('dotenv').config();
const { Pool } = require('pg');

async function fix(connConfig, label) {
  const pool = new Pool(connConfig);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) BORNES DE LA FORÊT D'ECOUVES (12 entradas) - añadir municipio entre paréntesis
    const bornes = await client.query(`
      SELECT id, municipio FROM bienes
      WHERE denominacion ILIKE $1 AND pais=$2
    `, ['%80 bornes de la forêt%', 'Francia']);

    let bornesUpdated = 0;
    for (const b of bornes.rows) {
      await client.query(
        'UPDATE bienes SET denominacion = $1 WHERE id = $2',
        [`80 bornes de la forêt d'Ecouves (${b.municipio})`, b.id]
      );
      bornesUpdated++;
    }
    console.log(`${label}: ${bornesUpdated} bornes renombradas con municipio`);

    // 2) PAÍS VASCO numerados (Oñate, Santurce, Aracaldo) - mover número al final
    const numerados = await client.query(`
      SELECT id, denominacion FROM bienes
      WHERE denominacion ~ '^[1-9]\\.? '
        AND municipio IN ('Oñate', 'Santurce', 'Aracaldo')
    `);

    let pvUpdated = 0;
    for (const n of numerados.rows) {
      // Capturar número y resto
      const match = n.denominacion.match(/^([1-9])\.?\s+(.+)$/);
      if (match) {
        const num = match[1];
        const resto = match[2];
        const nuevoNombre = `${resto} (${num})`;
        await client.query('UPDATE bienes SET denominacion = $1 WHERE id = $2', [nuevoNombre, n.id]);
        pvUpdated++;
      }
    }
    console.log(`${label}: ${pvUpdated} numerados País Vasco renombrados`);

    await client.query('COMMIT');
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
  // Local: solo si Docker está activo
  try {
    await fix({ host: 'localhost', port: 5433, user: 'patrimonio', password: 'patrimonio2026', database: 'patrimonio' }, 'LOCAL');
  } catch(e) { console.log('LOCAL: skipped (' + e.message + ')'); }
})();
