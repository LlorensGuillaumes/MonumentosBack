require('dotenv').config();
const { Pool } = require('pg');

async function fix(connConfig, label) {
  const pool = new Pool(connConfig);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bienId = 265732;

    await client.query("UPDATE wikidata SET qid=$1, descripcion=$2, imagen_url=NULL WHERE bien_id=$3",
      ['Q220107', 'Villa medieval amurallada, capital de la Conca de Barberà. Uno de los recintos amurallados mejor conservados de Cataluña', bienId]);

    await client.query("UPDATE bienes SET municipio=$1, provincia=$2, comunidad_autonoma=$3 WHERE id=$4",
      ['Montblanc', 'Tarragona', 'Catalunya', bienId]);

    await client.query("DELETE FROM imagenes WHERE bien_id=$1 AND fuente=$2", [bienId, 'wikidata']);

    await client.query('COMMIT');
    console.log(label + ': Montblanc [' + bienId + '] corregido → Q220107, Tarragona, Catalunya');
  } catch (e) { await client.query('ROLLBACK'); console.error(label + ' ERR:', e.message); }
  finally { client.release(); await pool.end(); }
}

(async () => {
  await fix({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } }, 'NEON');
  await fix({ host: 'localhost', port: 5433, user: 'patrimonio', password: 'patrimonio2026', database: 'patrimonio' }, 'LOCAL');
})();
