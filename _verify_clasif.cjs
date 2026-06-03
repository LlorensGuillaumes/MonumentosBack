require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const CLASIFICACION_GRUPOS = {
  religiosa: ['Iglesia / Ermita', 'Catedral', 'Monasterio / Convento', 'Arte religioso', 'Mezquita / Sinagoga', 'Cruz / Crucero', 'Cementerio'],
  militar: ['Castillo / Fortaleza', 'Torre', 'Muralla'],
  civil: ['Edificio civil', 'Edificio histórico', 'Conjunto arquitectónico', 'Elemento arquitectónico', 'Palacio', 'Casa señorial / Mansión', 'Teatro', 'Museo', 'Monumento conmemorativo', 'Monumento'],
  arqueologica: ['Yacimiento arqueológico', 'Megalítico'],
  etnologica: ['Arquitectura rural', 'Molino', 'Patrimonio etnográfico'],
  infraestructura: ['Puente', 'Acueducto', 'Fuente', 'Faro', 'Obra hidráulica', 'Plaza de toros', 'Balneario / Termas', 'Patrimonio industrial'],
};

(async () => {
  let total = 0;
  for (const [k, tipos] of Object.entries(CLASIFICACION_GRUPOS)) {
    const pl = tipos.map((_, i) => `$${i + 1}`).join(',');
    const r = await pool.query(`SELECT COUNT(*) AS n FROM bienes WHERE tipo_monumento IN (${pl})`, tipos);
    total += parseInt(r.rows[0].n);
    console.log(`${k.padEnd(18)} → ${String(r.rows[0].n).padStart(7)} bienes`);
  }
  console.log(`${'TOTAL clasificados'.padEnd(18)} → ${String(total).padStart(7)} bienes`);

  const ALL = Object.values(CLASIFICACION_GRUPOS).flat();
  const pl2 = ALL.map((_, i) => `$${i + 1}`).join(',');
  const r2 = await pool.query(
    `SELECT COUNT(*) AS n FROM bienes WHERE tipo_monumento IS NULL OR tipo_monumento NOT IN (${pl2})`,
    ALL
  );
  console.log(`${'otros (sin tipo)'.padEnd(18)} → ${String(r2.rows[0].n).padStart(7)} bienes`);

  const huerf = await pool.query(`
    SELECT tipo_monumento, COUNT(*) AS n
    FROM bienes WHERE tipo_monumento IS NOT NULL AND tipo_monumento NOT IN (${pl2})
    GROUP BY tipo_monumento ORDER BY n DESC
  `, ALL);
  console.log('\nHuérfanos restantes:');
  huerf.rows.forEach(r => console.log(`  ${String(r.n).padStart(6)}  ${r.tipo_monumento}`));

  await pool.end();
})();
