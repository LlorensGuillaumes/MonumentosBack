require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const CLASIFICACION_GRUPOS = {
  religiosa: ['Iglesia / Ermita', 'Catedral', 'Monasterio / Convento', 'Arte religioso', 'Mezquita / Sinagoga', 'Cruz / Crucero'],
  militar: ['Castillo / Fortaleza', 'Torre', 'Muralla'],
  civil: ['Edificio civil', 'Palacio', 'Casa señorial / Mansión', 'Teatro', 'Museo', 'Monumento conmemorativo'],
  arqueologica: ['Yacimiento arqueológico', 'Megalítico'],
  etnologica: ['Arquitectura rural', 'Molino', 'Patrimonio industrial'],
  infraestructura: ['Puente', 'Acueducto', 'Fuente', 'Faro', 'Obra hidráulica', 'Plaza de toros', 'Cementerio', 'Balneario / Termas'],
};

(async () => {
  for (const [clasif, tipos] of Object.entries(CLASIFICACION_GRUPOS)) {
    const placeholders = tipos.map((_, i) => `$${i + 1}`).join(',');
    const r = await pool.query(
      `SELECT COUNT(*) AS n FROM bienes WHERE tipo_monumento IN (${placeholders})`,
      tipos
    );
    console.log(`${clasif.padEnd(18)} → ${String(r.rows[0].n).padStart(7)} bienes`);
  }

  const ALL_CLASSIFIED = Object.values(CLASIFICACION_GRUPOS).flat();
  const plRows = ALL_CLASSIFIED.map((_, i) => `$${i + 1}`).join(',');
  const r2 = await pool.query(
    `SELECT COUNT(*) AS n FROM bienes
     WHERE tipo_monumento IS NULL OR tipo_monumento NOT IN (${plRows})`,
    ALL_CLASSIFIED
  );
  console.log(`\notros (sin clasif)  → ${String(r2.rows[0].n).padStart(7)} bienes`);

  // Tipos NO incluidos en ninguna clasificación
  const sinClasif = await pool.query(`
    SELECT tipo_monumento, COUNT(*) AS n
    FROM bienes WHERE tipo_monumento IS NOT NULL
      AND tipo_monumento NOT IN (${plRows})
    GROUP BY tipo_monumento ORDER BY n DESC
  `, ALL_CLASSIFIED);
  console.log('\nTipos SIN clasificación (huérfanos):');
  sinClasif.rows.forEach(r => console.log(`  ${String(r.n).padStart(6)}  ${r.tipo_monumento}`));

  await pool.end();
})();
