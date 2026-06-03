// Capa 4: reclasificar regiones malposicionadas en Francia y Portugal
require('dotenv').config();
const db = require('./db.cjs');

// FRANCIA: mapeo de regiones mal etiquetadas a régions administratives reales
const FRANCIA_REMAP = {
  'Distrito de Chinon': 'Centre-Val de Loire',
  'distrito de Foix': 'Occitanie',
  'Alta Francia': 'Hauts-de-France',
  'Centro-Valle de Loira': 'Centre-Val de Loire',
  'Distrito de Blois': 'Centre-Val de Loire',
  'Loiret': 'Centre-Val de Loire',
  'Occitania': 'Occitanie',
  'Borgoña-Franco Condado': 'Bourgogne-Franche-Comté',
  'Indre y Loira': 'Centre-Val de Loire',
  'Marne': 'Grand Est',
};

async function main() {
  console.log('Aplicando fixes Capa 4...\n');

  // --- FRANCIA ---
  console.log('=== FRANCIA: reclasificar regiones mal etiquetadas ===\n');
  for (const [wrong, correct] of Object.entries(FRANCIA_REMAP)) {
    const r = await db.query(
      `UPDATE bienes SET comunidad_autonoma = $1 WHERE pais = 'Francia' AND comunidad_autonoma = $2`,
      [correct, wrong]
    );
    if (r.rowCount > 0) {
      console.log(`  ${r.rowCount} × "${wrong}" → "${correct}"`);
    }
  }

  // Château de Saumur (#265708) tiene CCAA NULL — Saumur está en Maine-et-Loire (Pays de la Loire)
  const rSaumur = await db.query(`
    UPDATE bienes
    SET comunidad_autonoma = 'Pays de la Loire'
    WHERE id = 265708 AND comunidad_autonoma IS NULL
  `);
  if (rSaumur.rowCount > 0) console.log(`  ${rSaumur.rowCount} × Château de Saumur NULL → "Pays de la Loire"`);

  // --- PORTUGAL ---
  console.log('\n=== PORTUGAL: ajustar Foz Côa al patrón de distritos ===\n');
  // Portugal usa distritos como CCAA (Lisboa, Porto, Braga...) — Foz Côa estaba puesto
  // como CCAA="Norte" (NUTS) por nuestro fix Capa 1. Para consistencia, mover a
  // CCAA="Guarda" (distrito) y provincia=NULL.
  const rFoz = await db.query(`
    UPDATE bienes
    SET comunidad_autonoma = 'Guarda', provincia = NULL
    WHERE pais = 'Portugal' AND comunidad_autonoma = 'Norte'
  `);
  if (rFoz.rowCount > 0) console.log(`  ${rFoz.rowCount} × CCAA="Norte" → "Guarda" (distrito)`);

  // --- VERIFICACIÓN ---
  console.log('\n=== VERIFICACIÓN ===\n');

  console.log('Francia ahora — regiones con <5 monumentos:');
  const v1 = await db.query(`
    SELECT comunidad_autonoma, COUNT(*)::int as n
    FROM bienes
    WHERE pais = 'Francia'
    GROUP BY comunidad_autonoma
    HAVING COUNT(*) < 5
    ORDER BY n
  `);
  if (v1.rows.length === 0) console.log('  ✓ Sin anomalías');
  else v1.rows.forEach(r => console.log(`  ${String(r.n).padStart(3)}  ${r.comunidad_autonoma || 'NULL'}`));

  console.log('\nPortugal ahora — todas las regiones:');
  const v2 = await db.query(`
    SELECT comunidad_autonoma, COUNT(*)::int as n
    FROM bienes WHERE pais = 'Portugal'
    GROUP BY comunidad_autonoma ORDER BY n DESC
  `);
  v2.rows.forEach(r => console.log(`  ${String(r.n).padStart(5)}  ${r.comunidad_autonoma || 'NULL'}`));

  console.log('\nFrancia — n.º de regiones distintas (antes 29):');
  const v3 = await db.query(`
    SELECT COUNT(DISTINCT comunidad_autonoma)::int as n FROM bienes WHERE pais = 'Francia' AND comunidad_autonoma IS NOT NULL
  `);
  console.log(`  ${v3.rows[0].n}`);

  await db.cerrar();
  console.log('\n✓ Capa 4 completada.\n');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
