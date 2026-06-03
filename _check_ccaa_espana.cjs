// Comprobar cobertura de CCAA en España
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Las 17 CCAA + 2 ciudades autónomas oficiales
const CCAA_OFICIALES = [
  'Andalucía', 'Aragón', 'Asturias', 'Islas Baleares', 'Canarias',
  'Cantabria', 'Castilla y León', 'Castilla-La Mancha', 'Cataluña',
  'Comunidad Valenciana', 'Extremadura', 'Galicia', 'La Rioja',
  'Comunidad de Madrid', 'Región de Murcia', 'Navarra', 'País Vasco',
  'Ceuta', 'Melilla'
];

(async () => {
  const r = await pool.query(
    `SELECT comunidad_autonoma, COUNT(*)::int as n
     FROM bienes WHERE pais='España'
     GROUP BY comunidad_autonoma ORDER BY n DESC`
  );

  console.log('=== Recuento actual por región (España) ===');
  r.rows.forEach(x => console.log(String(x.n).padStart(6) + '  ' + (x.comunidad_autonoma || 'NULL')));
  console.log(`\nTotal regiones distintas: ${r.rows.length}`);

  // Comprobar cuáles faltan o están con nombre raro
  const presentes = new Set(r.rows.map(x => x.comunidad_autonoma));
  console.log('\n=== Cobertura CCAA oficiales ===');
  const faltan = [];
  const debiles = [];
  for (const ccaa of CCAA_OFICIALES) {
    const fila = r.rows.find(x => x.comunidad_autonoma === ccaa);
    if (!fila) {
      // Buscar variantes
      const variante = r.rows.find(x => {
        if (!x.comunidad_autonoma) return false;
        const a = x.comunidad_autonoma.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const b = ccaa.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return a === b || a.includes(b) || b.includes(a);
      });
      if (variante) {
        console.log(`  ⚠  ${ccaa.padEnd(25)} → aparece como "${variante.comunidad_autonoma}" (${variante.n})`);
      } else {
        faltan.push(ccaa);
        console.log(`  ✗  ${ccaa.padEnd(25)} FALTA`);
      }
    } else {
      const marker = fila.n < 50 ? '⚠' : '✓';
      console.log(`  ${marker}  ${ccaa.padEnd(25)} ${fila.n}`);
      if (fila.n < 50) debiles.push(`${ccaa} (${fila.n})`);
    }
  }

  if (faltan.length === 0) console.log('\n✓ Todas las CCAA oficiales presentes.');
  else console.log(`\n✗ Faltan: ${faltan.join(', ')}`);

  if (debiles.length > 0) console.log(`\n⚠  Débiles (<50): ${debiles.join(', ')}`);

  // Anomalías: nombres que no son CCAA oficiales
  const oficialesSet = new Set(CCAA_OFICIALES);
  const anomalas = r.rows.filter(x => x.comunidad_autonoma && !oficialesSet.has(x.comunidad_autonoma));
  if (anomalas.length > 0) {
    console.log('\n=== Nombres NO oficiales (anomalías) ===');
    anomalas.forEach(x => console.log(`  ${String(x.n).padStart(6)}  ${x.comunidad_autonoma}`));
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
