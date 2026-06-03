// Limpiar regiones de los países con pocos monumentos (Alemania, Reino Unido,
// Austria, Rumanía, Suiza, Líbano, Túnez). Para cada uno, llevar las regiones
// al nivel administrativo correcto y resolver datos cruzados de Wikidata.
require('dotenv').config();
const db = require('./db.cjs');

async function main() {
  console.log('Aplicando fixes países minoritarios...\n');

  // === ALEMANIA ===
  console.log('=== Alemania ===');
  // Dinkelsbühl (#265721): CCAA "Franconia Media" → "Baviera" (FM es Regierungsbezirk)
  // Municipio "Bechhofen" es incorrecto, real es "Dinkelsbühl"
  const ra1 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Baviera', provincia = 'Franconia Media', municipio = 'Dinkelsbühl'
    WHERE id = 265721
  `);
  console.log(`  ${ra1.rowCount} × Dinkelsbühl → Baviera/Franconia Media/Dinkelsbühl`);

  // Neuschwanstein (#265722): CCAA "Suabia" → "Baviera" (Schwaben es Regierungsbezirk)
  const ra2 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Baviera', provincia = 'Suabia'
    WHERE id = 265722
  `);
  console.log(`  ${ra2.rowCount} × Neuschwanstein → Baviera/Suabia`);

  // === REINO UNIDO ===
  console.log('\n=== Reino Unido ===');
  // Birdoswald (#265714): CCAA "Cumbria" → "Noroeste de Inglaterra", prov queda "Cumbria"
  const rb1 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Noroeste de Inglaterra', provincia = 'Cumbria'
    WHERE id = 265714
  `);
  console.log(`  ${rb1.rowCount} × Birdoswald → Noroeste de Inglaterra/Cumbria`);

  // Highgate Cemetery (#265698): CCAA "Inglaterra" → "Londres" (es región propia)
  const rb2 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Londres'
    WHERE id = 265698
  `);
  console.log(`  ${rb2.rowCount} × Highgate Cemetery → Londres`);

  // Dover (#265656): CCAA "comtat de Kent" → "Sudeste de Inglaterra", prov queda "Kent"
  const rb3 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Sudeste de Inglaterra', provincia = 'Kent'
    WHERE id = 265656
  `);
  console.log(`  ${rb3.rowCount} × Dover → Sudeste de Inglaterra/Kent`);

  // === AUSTRIA ===
  console.log('\n=== Austria ===');
  // Zentralfriedhof (#265699): CCAA "Austria" → "Viena" (Wien es Bundesland)
  const rc1 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Viena'
    WHERE id = 265699
  `);
  console.log(`  ${rc1.rowCount} × Zentralfriedhof → Viena`);

  // === RUMANÍA ===
  console.log('\n=== Rumanía ===');
  // Voroneț (#265723): CCAA "Ducado de Bucovina" → "Suceava" (judet real)
  const rd1 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Suceava', provincia = NULL
    WHERE id = 265723
  `);
  console.log(`  ${rd1.rowCount} × Voroneț → Suceava`);

  // Sucevița (#265724) y Moldovița (#265725): CCAA "Rumania" → "Suceava"
  const rd2 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Suceava'
    WHERE id IN (265724, 265725) AND comunidad_autonoma = 'Rumania'
  `);
  console.log(`  ${rd2.rowCount} × Sucevița + Moldovița → Suceava`);

  // === SUIZA ===
  console.log('\n=== Suiza ===');
  // Lausana (#265660): datos cruzados con Costa Rica. Coords reales = Vaud, Suiza
  const re1 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Vaud', provincia = NULL, municipio = 'Lausanne'
    WHERE id = 265660
  `);
  console.log(`  ${re1.rowCount} × Lausana → Vaud/Lausanne (datos cruzados arreglados)`);

  // === LÍBANO ===
  console.log('\n=== Líbano ===');
  // Tiro (#265674): CCAA "Líbano" → "Líbano del Sur", prov NULL
  const rf1 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Líbano del Sur', provincia = NULL, municipio = 'Tiro'
    WHERE id = 265674
  `);
  console.log(`  ${rf1.rowCount} × Tiro → Líbano del Sur`);

  // Byblos (#265675): CCAA "Líbano" → "Monte Líbano", prov NULL
  const rf2 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Monte Líbano', provincia = NULL, municipio = 'Byblos'
    WHERE id = 265675
  `);
  console.log(`  ${rf2.rowCount} × Byblos → Monte Líbano`);

  // === TÚNEZ ===
  console.log('\n=== Túnez ===');
  // Cartago (#265676): todo NULL/corrupt. Coords reales = Túnez capital
  const rg1 = await db.query(`
    UPDATE bienes SET comunidad_autonoma = 'Túnez', provincia = NULL, municipio = 'Cartago'
    WHERE id = 265676
  `);
  console.log(`  ${rg1.rowCount} × Cartago → Túnez/Cartago`);

  // === VERIFICACIÓN ===
  console.log('\n=== VERIFICACIÓN ===');
  const paises = ['Alemania', 'Reino Unido', 'Austria', 'Rumanía', 'Suiza', 'Líbano', 'Túnez'];
  for (const pais of paises) {
    const v = await db.query(`
      SELECT comunidad_autonoma, COUNT(*)::int as n
      FROM bienes WHERE pais = $1
      GROUP BY comunidad_autonoma ORDER BY n DESC
    `, [pais]);
    console.log(`\n${pais} (${v.rows.length} regiones):`);
    v.rows.forEach(r => console.log(`  ${String(r.n).padStart(3)}  ${r.comunidad_autonoma || 'NULL'}`));
  }

  await db.cerrar();
  console.log('\n✓ Países minoritarios limpios.');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
