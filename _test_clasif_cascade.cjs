require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const CLASIFICACION_GRUPOS = {
  religiosa: ['Iglesia / Ermita','Catedral','Monasterio / Convento','Arte religioso','Mezquita / Sinagoga','Cruz / Crucero','Cementerio'],
};

(async () => {
  // Subquery: bienes que están en clasificación religiosa
  const tipos = CLASIFICACION_GRUPOS.religiosa;
  const pl = tipos.map((_, i) => `$${i + 1}`).join(',');

  const r = await pool.query(`
    SELECT b.tipo_monumento as value, COUNT(*) as count
    FROM bienes b
    WHERE b.tipo_monumento IS NOT NULL AND b.id IN (
      SELECT DISTINCT b.id FROM bienes b WHERE b.tipo_monumento IN (${pl})
    )
    GROUP BY b.tipo_monumento ORDER BY count DESC
  `, tipos);
  console.log('=== tipos cuando clasificacion=religiosa (con cascada correcta) ===');
  r.rows.forEach(row => console.log(`  ${String(row.count).padStart(6)}  ${row.value}`));

  await pool.end();
})();
