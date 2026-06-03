// Rellena provincia=CCAA en CCAA uniprovinciales donde provincia IS NULL
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// CCAA uniprovinciales: provincia = la CCAA misma (excepto Madrid que es "Madrid")
const UNIPROVINCIALES = [
  { ccaa: 'Asturias',            provincia: 'Asturias'      },
  { ccaa: 'Cantabria',           provincia: 'Cantabria'     },
  { ccaa: 'Illes Balears',       provincia: 'Illes Balears' },
  { ccaa: 'La Rioja',            provincia: 'La Rioja'      },
  { ccaa: 'Comunidad de Madrid', provincia: 'Madrid'        },
  { ccaa: 'Región de Murcia',    provincia: 'Murcia'        },
  { ccaa: 'Navarra',             provincia: 'Navarra'       },
  { ccaa: 'Ceuta',               provincia: 'Ceuta'         },
  { ccaa: 'Melilla',             provincia: 'Melilla'       },
];

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  let totalEstimado = 0, totalAplicado = 0;
  for (const u of UNIPROVINCIALES) {
    // Conteo previo
    const cnt = await pool.query(
      `SELECT COUNT(*)::int as n FROM bienes
       WHERE pais='España' AND comunidad_autonoma=$1 AND provincia IS NULL`,
      [u.ccaa]
    );
    const n = cnt.rows[0].n;
    console.log(`${u.ccaa.padEnd(25)} provincia → "${u.provincia}"  (${n} a actualizar)`);
    totalEstimado += n;

    if (!DRY_RUN && n > 0) {
      const r = await pool.query(
        `UPDATE bienes SET provincia=$1
         WHERE pais='España' AND comunidad_autonoma=$2 AND provincia IS NULL`,
        [u.provincia, u.ccaa]
      );
      totalAplicado += r.rowCount;
    }
  }

  console.log(`\n${DRY_RUN ? 'Estimado a actualizar' : 'Total actualizado'}: ${DRY_RUN ? totalEstimado : totalAplicado}`);

  if (!DRY_RUN) {
    console.log('\n=== Verificación ===');
    for (const u of UNIPROVINCIALES) {
      const v = await pool.query(
        `SELECT provincia, COUNT(*)::int as n FROM bienes
         WHERE pais='España' AND comunidad_autonoma=$1
         GROUP BY provincia ORDER BY n DESC`,
        [u.ccaa]
      );
      console.log(`\n${u.ccaa}:`);
      v.rows.forEach(r => console.log(`  ${String(r.n).padStart(5)}  ${r.provincia || 'NULL'}`));
    }
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
