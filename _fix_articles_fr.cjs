require('dotenv').config();
const { Pool } = require('pg');

async function fix(connConfig, label) {
  const pool = new Pool(connConfig);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const r = await client.query(`SELECT id, denominacion FROM bienes WHERE denominacion ILIKE $1`, ['%80 bornes de la forêt%']);
    let updated = 0;
    for (const row of r.rows) {
      // Patrón: "...(MUNICIPIO (Le|La|Les))" → "...(Le|La|Les MUNICIPIO)"
      const nuevo = row.denominacion.replace(/\(([^()]+?)\s+\((Le|La|Les|L'|L’)\)\)$/i, (full, base, art) => '(' + art + ' ' + base + ')');
      if (nuevo !== row.denominacion) {
        await client.query('UPDATE bienes SET denominacion=$1 WHERE id=$2', [nuevo, row.id]);
        console.log('  [' + row.id + '] ' + row.denominacion + ' → ' + nuevo);
        updated++;
      }
    }

    await client.query('COMMIT');
    console.log(label + ': ' + updated + ' actualizados');
  } catch(e) { await client.query('ROLLBACK'); console.error(label + ' ERR:', e.message); }
  finally { client.release(); await pool.end(); }
}

(async () => {
  await fix({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } }, 'NEON');
  try { await fix({ host: 'localhost', port: 5433, user: 'patrimonio', password: 'patrimonio2026', database: 'patrimonio' }, 'LOCAL'); } catch(e) { console.log('LOCAL: skipped'); }
})();
