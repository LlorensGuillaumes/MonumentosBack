// Inspeccionar anomalías en las regiones / countries
require('dotenv').config();
const db = require('./db.cjs');

async function main() {
  const pool = db.getPool ? db.getPool() : null;
  if (!pool) {
    // Fallback: usar db.query directamente
  }

  console.log('\n=== 1. Asturias vs "Provincia de Asturias" ===\n');
  const ast = await db.query(`
    SELECT comunidad_autonoma, provincia, COUNT(*)::int as n
    FROM bienes
    WHERE pais = 'España' AND (
      comunidad_autonoma ILIKE '%asturias%' OR provincia ILIKE '%asturias%'
    )
    GROUP BY comunidad_autonoma, provincia
    ORDER BY n DESC
  `);
  ast.rows.forEach(r => console.log(`  CCAA="${r.comunidad_autonoma}" provincia="${r.provincia}" → ${r.n} monuments`));

  console.log('\n=== 2. Francia con región "Alemania" ===\n');
  const al = await db.query(`
    SELECT id, denominacion, comunidad_autonoma, provincia, pais, latitud, longitud
    FROM bienes
    WHERE pais = 'Francia' AND comunidad_autonoma ILIKE '%aleman%'
  `);
  al.rows.forEach(r => console.log(`  #${r.id} "${r.denominacion}" CCAA="${r.comunidad_autonoma}" prov="${r.provincia}" coords=${r.latitud},${r.longitud}`));

  console.log('\n=== 3. Portugal con Douro / Galicia ===\n');
  const pt = await db.query(`
    SELECT id, denominacion, comunidad_autonoma, provincia, pais, latitud, longitud
    FROM bienes
    WHERE pais = 'Portugal' AND (
      comunidad_autonoma ILIKE '%douro%' OR
      comunidad_autonoma ILIKE '%galicia%' OR
      comunidad_autonoma ILIKE '%gal\xc3\xadcia%'
    )
  `);
  pt.rows.forEach(r => console.log(`  #${r.id} "${r.denominacion}" CCAA="${r.comunidad_autonoma}" prov="${r.provincia}" coords=${r.latitud},${r.longitud}`));

  console.log('\n=== 4. Regiones con 1 o 2 monuments (todos los países) ===\n');
  const escasos = await db.query(`
    SELECT pais, comunidad_autonoma, COUNT(*)::int as n
    FROM bienes
    WHERE comunidad_autonoma IS NOT NULL
    GROUP BY pais, comunidad_autonoma
    HAVING COUNT(*) <= 2
    ORDER BY pais, n, comunidad_autonoma
  `);
  let lastPais = null;
  escasos.rows.forEach(r => {
    if (r.pais !== lastPais) { console.log(`\n  --- ${r.pais} ---`); lastPais = r.pais; }
    console.log(`  ${String(r.n).padStart(2)}  ${r.comunidad_autonoma}`);
  });

  console.log('\n=== 5. Por país: total y nº de regiones ===\n');
  const porPais = await db.query(`
    SELECT
      pais,
      COUNT(*)::int as total_bienes,
      COUNT(DISTINCT comunidad_autonoma) FILTER (WHERE comunidad_autonoma IS NOT NULL)::int as n_regiones
    FROM bienes
    GROUP BY pais
    ORDER BY total_bienes DESC
  `);
  porPais.rows.forEach(r => console.log(`  ${(r.pais || 'NULL').padEnd(25)} bienes=${String(r.total_bienes).padStart(7)} regiones=${r.n_regiones}`));

  console.log('\n=== 6. Países con menos de 10 monuments (candidatos a "Otros" o ampliación) ===\n');
  const pobres = await db.query(`
    SELECT pais, COUNT(*)::int as n
    FROM bienes
    WHERE pais IS NOT NULL
    GROUP BY pais
    HAVING COUNT(*) < 50
    ORDER BY n
  `);
  pobres.rows.forEach(r => console.log(`  ${String(r.n).padStart(4)}  ${r.pais}`));

  await db.cerrar();
}

main().catch(err => { console.error(err); process.exit(1); });
