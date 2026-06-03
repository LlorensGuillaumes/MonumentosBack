// Fixes Capa 1: anomalías individuales detectadas en regiones / countries
// Ejecuta con: node _fix_anomalias_regiones.cjs
require('dotenv').config();
const db = require('./db.cjs');

async function main() {
  console.log('Aplicando fixes Capa 1...\n');

  // 1. Asturias: unificar las 3 variantes en CCAA="Asturias"
  console.log('1. Asturias merge:');
  const r1a = await db.query(`
    UPDATE bienes
    SET provincia = NULL
    WHERE pais = 'España' AND comunidad_autonoma = 'Asturias' AND provincia = 'Asturias'
  `);
  console.log(`   - CCAA="Asturias" provincia="Asturias" → provincia=NULL: ${r1a.rowCount} filas`);
  const r1b = await db.query(`
    UPDATE bienes
    SET comunidad_autonoma = 'Asturias'
    WHERE pais = 'España' AND comunidad_autonoma = 'provincia de Asturias'
  `);
  console.log(`   - "provincia de Asturias" → "Asturias": ${r1b.rowCount} filas`);

  // 2. Château de Quéribus #265717: Francia/Alemania → Francia/Occitania/Aude
  console.log('\n2. Château de Quéribus (#265717):');
  const r2 = await db.query(`
    UPDATE bienes
    SET comunidad_autonoma = 'Occitania', provincia = 'Aude'
    WHERE id = 265717
  `);
  console.log(`   - CCAA="Alemania"/Turingia → "Occitania"/"Aude": ${r2.rowCount} filas`);

  // 3. Catedral de Tui #265563: Portugal/Galicia → España/Galicia
  console.log('\n3. Catedral de Tui (#265563):');
  const r3 = await db.query(`
    UPDATE bienes
    SET pais = 'España', comunidad_autonoma = 'Galicia', provincia = 'provincia de Pontevedra'
    WHERE id = 265563
  `);
  console.log(`   - país="Portugal" → "España" (Galicia ya estaba OK): ${r3.rowCount} filas`);

  // 4. Highgate Cemetery #265698: Reino Unido/Tennessee/Memphis → Reino Unido/London
  console.log('\n4. Highgate Cemetery (#265698):');
  const r4 = await db.query(`
    UPDATE bienes
    SET comunidad_autonoma = 'Inglaterra',
        provincia = 'Greater London',
        municipio = 'London'
    WHERE id = 265698
  `);
  console.log(`   - Tennessee/Memphis → "Inglaterra"/Greater London/London: ${r4.rowCount} filas`);

  // 5. Paso del Gran San Bernardo #265661: Suiza/Distrito de Havlíčkův Brod → Suiza/Valais
  console.log('\n5. Paso del Gran San Bernardo (#265661):');
  const r5 = await db.query(`
    UPDATE bienes
    SET comunidad_autonoma = 'Valais',
        provincia = NULL,
        municipio = 'Bourg-Saint-Pierre'
    WHERE id = 265661
  `);
  console.log(`   - "Distrito de Havlíčkův Brod" → "Valais": ${r5.rowCount} filas`);

  // 6. Foz Côa #265689: Portugal/Douro → Portugal/Norte
  // (Vila Nova de Foz Côa está en la región Norte de Portugal, distrito Guarda)
  console.log('\n6. Foz Côa (#265689):');
  const r6 = await db.query(`
    UPDATE bienes
    SET comunidad_autonoma = 'Norte', provincia = 'Distrito de Guarda'
    WHERE id = 265689
  `);
  console.log(`   - "Douro" → "Norte"/Guarda: ${r6.rowCount} filas`);

  // Verificación final: comprobar que no queden las anomalías
  console.log('\n=== VERIFICACIÓN POST-FIX ===\n');

  const v1 = await db.query(`
    SELECT comunidad_autonoma, COUNT(*)::int as n
    FROM bienes
    WHERE pais = 'España' AND (
      comunidad_autonoma ILIKE '%asturias%' OR provincia ILIKE '%provincia de asturias%'
    )
    GROUP BY comunidad_autonoma
  `);
  console.log('Asturias (debería ser solo 1 fila):');
  v1.rows.forEach(r => console.log(`  ${r.comunidad_autonoma} → ${r.n}`));

  const v2 = await db.query(`
    SELECT pais, comunidad_autonoma, COUNT(*)::int as n
    FROM bienes
    WHERE comunidad_autonoma IN ('Alemania', 'Tennessee', 'Distrito de Havlíčkův Brod', 'Douro')
       OR (pais = 'Portugal' AND comunidad_autonoma = 'Galicia')
    GROUP BY pais, comunidad_autonoma
  `);
  console.log('\nAnomalías post-fix (debería estar vacío o no encontrarse):');
  if (v2.rows.length === 0) console.log('  ✓ Todas las anomalías corregidas');
  else v2.rows.forEach(r => console.log(`  ❌ pais=${r.pais} CCAA="${r.comunidad_autonoma}" n=${r.n}`));

  await db.cerrar();
  console.log('\n✓ Fixes Capa 1 completados.\n');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
