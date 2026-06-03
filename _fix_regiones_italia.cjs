// Corregir anomalías en regiones de Italia (nombres en castellano)
require('dotenv').config();
const db = require('./db.cjs');

const ITALIA_REMAP = {
  'Lombardía': 'Lombardia',
  'Cerdeña': 'Sardegna',
  'Emilia-Romaña': 'Emilia-Romagna',
};

async function main() {
  console.log('Aplicando fixes Italia...\n');

  for (const [wrong, correct] of Object.entries(ITALIA_REMAP)) {
    const r = await db.query(
      `UPDATE bienes SET comunidad_autonoma = $1 WHERE pais = 'Italia' AND comunidad_autonoma = $2`,
      [correct, wrong]
    );
    if (r.rowCount > 0) console.log(`  ${r.rowCount} × "${wrong}" → "${correct}"`);
  }

  // Catedral de San Martín de Lucca (#265662): CCAA=Italia mal, datos cruzados
  const r2 = await db.query(`
    UPDATE bienes
    SET comunidad_autonoma = 'Toscana', provincia = 'Lucca', municipio = 'Lucca'
    WHERE id = 265662
  `);
  console.log(`\n  ${r2.rowCount} × Catedral S. Martín Lucca: CCAA="Italia" → "Toscana", prov→"Lucca", mun→"Lucca"`);

  // Verificación
  const v = await db.query(`
    SELECT comunidad_autonoma, COUNT(*)::int as n
    FROM bienes WHERE pais = 'Italia'
    GROUP BY comunidad_autonoma ORDER BY n DESC
  `);
  console.log(`\nItalia ahora — ${v.rows.length} regiones:`);
  v.rows.forEach(r => console.log(`  ${String(r.n).padStart(6)}  ${r.comunidad_autonoma}`));

  await db.cerrar();
  console.log('\n✓ Italia limpia.');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
