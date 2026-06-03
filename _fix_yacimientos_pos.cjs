require('dotenv').config();
const { Pool } = require('pg');

async function fix(connConfig, label) {
  const pool = new Pool(connConfig);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const patterns = [
      "^A [0-9]+ ?m ",
      "^A [0-9]+ ?metros",
      "^A prop d",
      "^A ponent d",
      "^A migdia d",
      "^A llevant d",
      "^A tramuntana d",
      "^A orillas d",
      "^A la vora",
      "^A pocos metros",
      "^A unos metros",
      "^Al Norte d",
      "^Al Sur d",
      "^Al Este d",
      "^Al Oeste d",
      "^Al Noroeste d",
      "^Al Noreste d",
      "^Al Sureste d",
      "^Al Suroeste d",
    ];

    const seen = new Set();
    let renamed = 0, reclassified = 0;

    for (const p of patterns) {
      const r = await client.query(
        `SELECT id, denominacion, tipo_monumento FROM bienes WHERE denominacion ~* $1`,
        [p]
      );
      for (const row of r.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);

        // Renombrar: añadir "Yacimiento" al inicio (con minúscula al inicio del resto)
        // "A prop de X" → "Yacimiento a prop de X"
        // "Al Sur de X" → "Yacimiento al Sur de X"
        const primeraLetra = row.denominacion.charAt(0);
        const resto = row.denominacion.slice(1);
        const nuevo = "Yacimiento " + primeraLetra.toLowerCase() + resto;

        await client.query('UPDATE bienes SET denominacion=$1 WHERE id=$2', [nuevo, row.id]);
        renamed++;

        // Reclasificar si no es Yacimiento arqueológico
        if (row.tipo_monumento !== 'Yacimiento arqueológico') {
          await client.query(
            'UPDATE bienes SET tipo_monumento=$1 WHERE id=$2',
            ['Yacimiento arqueológico', row.id]
          );
          reclassified++;
        }
      }
    }

    await client.query('COMMIT');
    console.log(label + ': ' + renamed + ' renombrados, ' + reclassified + ' reclasificados a Yacimiento');
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
