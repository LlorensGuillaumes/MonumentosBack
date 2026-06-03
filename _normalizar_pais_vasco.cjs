// Normaliza nombres provincias País Vasco a versión BOE oficial:
//   Álava → Álava (sin cambio)
//   Vizcaya → Bizkaia
//   Guipuzcoa → Gipuzkoa
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

const MAPEO = [
  { from: 'Vizcaya',   to: 'Bizkaia' },
  { from: 'Guipuzcoa', to: 'Gipuzkoa' },
  { from: 'Guipúzcoa', to: 'Gipuzkoa' },  // por si acaso con tilde
];

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  let total = 0;
  for (const m of MAPEO) {
    const cnt = await pool.query(
      "SELECT COUNT(*)::int as n FROM bienes WHERE pais='España' AND provincia=$1",
      [m.from]
    );
    console.log(`"${m.from}" → "${m.to}"  (${cnt.rows[0].n} a actualizar)`);
    total += cnt.rows[0].n;

    if (!DRY_RUN && cnt.rows[0].n > 0) {
      await pool.query(
        "UPDATE bienes SET provincia=$1 WHERE pais='España' AND provincia=$2",
        [m.to, m.from]
      );
    }
  }

  console.log(`\n${DRY_RUN ? 'Estimado' : 'Total actualizado'}: ${total}`);

  if (!DRY_RUN) {
    const v = await pool.query(
      "SELECT provincia, COUNT(*)::int as n FROM bienes WHERE pais='España' AND comunidad_autonoma='País Vasco' GROUP BY provincia ORDER BY n DESC"
    );
    console.log('\nPaís Vasco final:');
    v.rows.forEach(r => console.log(`  ${String(r.n).padStart(5)}  ${r.provincia || 'NULL'}`));
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
