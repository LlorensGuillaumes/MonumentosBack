require('dotenv').config();
const { Pool } = require('pg');

const FIXES = [
  { id: 265894, from: 'Los Guájares', to: 'Guájares (Los)' },
  { id: 265895, from: 'El Pinar', to: 'Pinar (El)' },
  { id: 265896, from: 'El Pinar', to: 'Pinar (El)' },
  { id: 265897, from: 'El Valle', to: 'Valle (El)' },
];

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const f of FIXES) {
      const r = await client.query(
        `UPDATE bienes SET municipio = $1 WHERE id = $2 AND municipio = $3 RETURNING id, denominacion, municipio`,
        [f.to, f.id, f.from]
      );
      if (r.rows.length > 0) {
        console.log(`OK ${r.rows[0].id} "${r.rows[0].denominacion}" → ${r.rows[0].municipio}`);
      } else {
        console.log(`SKIP ${f.id}: no encontrado con municipio="${f.from}"`);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERROR rollback:', e.message);
  } finally {
    client.release();
    await p.end();
  }
})();
