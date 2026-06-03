require('dotenv').config();
const { Pool } = require('pg');

// Renombrados específicos por idioma/contexto
const FIX = [
  // Catalán
  { id: 65384, nuevo: "Jaciment a l'oest del Saió", reclas: 'Yacimiento arqueológico' },
  // Italiano
  { id: 201459, nuevo: 'Sito a Nord di Sa Salina (Calasetta)', reclas: 'Yacimiento arqueológico' },
  // Portugués (caso largo: pinturas murales en palacio)
  { id: 146609, nuevo: 'Pinturas murais no Palácio da Inquisição (Évora)', reclas: null },
  // Español
  { id: 22272, nuevo: 'Yacimiento al lado del aliviadero de la Presa de Giribaile', reclas: 'Yacimiento arqueológico' },
  // "Cerca de/del" español (yacimientos andaluces)
  { id: 16455, nuevo: 'Yacimiento cerca del Risco', reclas: 'Yacimiento arqueológico' },
  { id: 16755, nuevo: 'Yacimiento cerca de los Cantos', reclas: 'Yacimiento arqueológico' },
  { id: 17016, nuevo: 'Yacimiento cerca de la Monea', reclas: 'Yacimiento arqueológico' },
  { id: 17019, nuevo: 'Yacimiento cerca del Águila', reclas: 'Yacimiento arqueológico' },
  { id: 17330, nuevo: 'Yacimiento cerca de Higuera de la Sierra I', reclas: 'Yacimiento arqueológico' },
  { id: 17358, nuevo: 'Yacimiento cerca del Cojo', reclas: 'Yacimiento arqueológico' },
  { id: 17646, nuevo: 'Yacimiento cerca de Atrás', reclas: 'Yacimiento arqueológico' },
  { id: 18539, nuevo: 'Yacimiento cerca del Cura', reclas: 'Yacimiento arqueológico' },
  { id: 19213, nuevo: 'Yacimiento cerca del Cortijo del Gitano', reclas: 'Yacimiento arqueológico' },
  { id: 21615, nuevo: 'Yacimiento cerca de la Central Eléctrica de los Escuderos', reclas: 'Yacimiento arqueológico' },
  { id: 21621, nuevo: 'Yacimiento cerca del Oratorio de Valdecanales', reclas: 'Yacimiento arqueológico' },
  { id: 31150, nuevo: 'Yacimiento cerca de Cadenas', reclas: 'Yacimiento arqueológico' },
  { id: 8959, nuevo: 'Yacimiento cerca de la Villa Vieja', reclas: 'Yacimiento arqueológico' },
  { id: 19193, nuevo: 'Yacimiento cerca del Molino', reclas: 'Yacimiento arqueológico' },
  { id: 21616, nuevo: 'Yacimiento cerca de la Central de los Escuderos', reclas: 'Yacimiento arqueológico' },
  { id: 10811, nuevo: 'Yacimiento cerca de Montemayor (Camino de Córdoba)', reclas: 'Yacimiento arqueológico' },
  { id: 11871, nuevo: 'Yacimiento cerca de la Rambla', reclas: 'Yacimiento arqueológico' },
  // Casos dudosos: skip por seguridad (Puente de Hernán Ruiz, Cerca de Coimbra que podría ser muralla)
];

// Borrar Abacus
const DELETE_IDS = [46812];

async function fix(connConfig, label) {
  const pool = new Pool(connConfig);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let renamed = 0, reclassified = 0;
    for (const f of FIX) {
      await client.query('UPDATE bienes SET denominacion=$1 WHERE id=$2', [f.nuevo, f.id]);
      renamed++;
      if (f.reclas) {
        await client.query('UPDATE bienes SET tipo_monumento=$1 WHERE id=$2', [f.reclas, f.id]);
        reclassified++;
      }
    }
    let deleted = 0;
    for (const id of DELETE_IDS) {
      await client.query('DELETE FROM imagenes WHERE bien_id=$1', [id]);
      await client.query('DELETE FROM wikidata WHERE bien_id=$1', [id]);
      const d = await client.query('DELETE FROM bienes WHERE id=$1 RETURNING id', [id]);
      deleted += d.rows.length;
    }
    await client.query('COMMIT');
    console.log(label + ': ' + renamed + ' renombrados, ' + reclassified + ' reclasificados, ' + deleted + ' borrados');
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
