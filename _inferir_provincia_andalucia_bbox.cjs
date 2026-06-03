/**
 * Infiere provincia para bienes andaluces SIN provincia, usando distancia al centroide.
 * Asigna la provincia cuyo centroide está más cerca de las coords del bien.
 *
 * Uso:
 *   node _inferir_provincia_andalucia_bbox.cjs          # dry-run
 *   node _inferir_provincia_andalucia_bbox.cjs --apply  # aplica UPDATEs
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Centroides aproximados de cada provincia andaluza
const PROVINCIAS = [
  { nom: 'Almería',  lat: 37.15, lng: -2.10 },
  { nom: 'Cádiz',    lat: 36.55, lng: -5.95 },
  { nom: 'Córdoba',  lat: 37.95, lng: -4.75 },
  { nom: 'Granada',  lat: 37.30, lng: -3.30 },
  { nom: 'Huelva',   lat: 37.55, lng: -6.85 },
  { nom: 'Jaén',     lat: 37.95, lng: -3.40 },
  { nom: 'Málaga',   lat: 36.80, lng: -4.65 },
  { nom: 'Sevilla',  lat: 37.55, lng: -5.85 },
];

// Bounding box global Andalucía para descartar coords erróneas
const BBOX_ANDALUCIA = { latMin: 35.9, latMax: 38.8, lngMin: -7.6, lngMax: -1.5 };

function distKm(la1, lo1, la2, lo2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(la2 - la1);
  const dLng = toRad(lo2 - lo1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(la1))*Math.cos(toRad(la2))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function provinciaMasCercana(lat, lng) {
  let mejor = null, mejorDist = Infinity;
  for (const p of PROVINCIAS) {
    const d = distKm(lat, lng, p.lat, p.lng);
    if (d < mejorDist) { mejorDist = d; mejor = p; }
  }
  return { provincia: mejor.nom, distancia: mejorDist };
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  const r = await pool.query(`
    SELECT id, denominacion, latitud, longitud, municipio FROM bienes
    WHERE pais='España' AND comunidad_autonoma='Andalucía' AND provincia IS NULL
  `);
  console.log(`Bienes Andalucía sin provincia: ${r.rows.length}`);

  let conCoords = 0, fueraBbox = 0, sinCoords = 0;
  const asignaciones = []; // {id, prov}
  const distribucion = new Map();

  for (const b of r.rows) {
    const lat = parseFloat(b.latitud), lng = parseFloat(b.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { sinCoords++; continue; }
    if (lat < BBOX_ANDALUCIA.latMin || lat > BBOX_ANDALUCIA.latMax
     || lng < BBOX_ANDALUCIA.lngMin || lng > BBOX_ANDALUCIA.lngMax) {
      fueraBbox++; continue;
    }
    const { provincia } = provinciaMasCercana(lat, lng);
    asignaciones.push({ id: b.id, prov: provincia });
    distribucion.set(provincia, (distribucion.get(provincia) || 0) + 1);
    conCoords++;
  }

  console.log(`  Asignables con centroide: ${conCoords}`);
  console.log(`  Sin coords:               ${sinCoords}`);
  console.log(`  Fuera bbox Andalucía:     ${fueraBbox}`);

  console.log('\nDistribución estimada:');
  [...distribucion.entries()].sort((a, b) => b[1] - a[1]).forEach(([p, n]) =>
    console.log(`  ${String(n).padStart(5)}  ${p}`)
  );

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Sin escribir. --apply para ejecutar.');
    await pool.end();
    return;
  }

  // Aplicar UPDATEs transaccional
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const a of asignaciones) {
      await client.query('UPDATE bienes SET provincia=$1 WHERE id=$2', [a.prov, a.id]);
      inserted++;
      if (inserted % 500 === 0) console.log(`  [${inserted}/${asignaciones.length}]`);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${inserted} UPDATEs aplicados`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
  }

  // Verificación
  const v = await pool.query(`
    SELECT provincia, COUNT(*)::int as n FROM bienes
    WHERE pais='España' AND comunidad_autonoma='Andalucía'
    GROUP BY provincia ORDER BY n DESC
  `);
  console.log('\nAndalucía final:');
  v.rows.forEach(r => console.log(`  ${String(r.n).padStart(5)}  ${r.provincia || 'NULL'}`));

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
