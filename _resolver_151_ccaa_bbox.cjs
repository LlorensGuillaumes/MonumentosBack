/**
 * Resolver CCAA para los 151 items residuales 'Aragon' por bbox de coords.
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// BBOX CCAA España (aproximados, ordenados por probabilidad)
const CCAA_BBOX = [
  { nom: 'Canarias',             latMin: 27.4, latMax: 29.5,  lngMin: -18.3, lngMax: -13.3 },
  { nom: 'Ceuta',                latMin: 35.85, latMax: 35.93, lngMin: -5.40, lngMax: -5.27 },
  { nom: 'Melilla',              latMin: 35.27, latMax: 35.35, lngMin: -2.99, lngMax: -2.91 },
  { nom: 'Illes Balears',        latMin: 38.6, latMax: 40.1,  lngMin: 1.1,   lngMax: 4.4 },
  { nom: 'Galicia',              latMin: 41.8, latMax: 43.8,  lngMin: -9.4,  lngMax: -6.7 },
  { nom: 'Asturias',             latMin: 42.9, latMax: 43.7,  lngMin: -7.2,  lngMax: -4.5 },
  { nom: 'Cantabria',            latMin: 42.9, latMax: 43.55, lngMin: -4.85, lngMax: -3.1 },
  { nom: 'País Vasco',           latMin: 42.5, latMax: 43.5,  lngMin: -3.4,  lngMax: -1.7 },
  { nom: 'Navarra',              latMin: 41.9, latMax: 43.4,  lngMin: -2.5,  lngMax: -0.7 },
  { nom: 'La Rioja',             latMin: 41.9, latMax: 42.65, lngMin: -3.15, lngMax: -1.65 },
  { nom: 'Catalunya',            latMin: 40.5, latMax: 42.9,  lngMin: 0.15,  lngMax: 3.35 },
  { nom: 'Aragón',               latMin: 39.8, latMax: 42.92, lngMin: -2.2,  lngMax: 0.8 },
  { nom: 'Castilla y León',      latMin: 40.05, latMax: 43.25, lngMin: -7.1, lngMax: -1.65 },
  { nom: 'Comunidad de Madrid',  latMin: 40.0, latMax: 41.2,  lngMin: -4.6,  lngMax: -3.1 },
  { nom: 'Comunitat Valenciana', latMin: 37.85, latMax: 40.8, lngMin: -1.55, lngMax: 0.65 },
  { nom: 'Castilla-La Mancha',   latMin: 38.0, latMax: 41.35, lngMin: -5.4,  lngMax: -1.05 },
  { nom: 'Extremadura',          latMin: 37.95, latMax: 40.5, lngMin: -7.55, lngMax: -4.65 },
  { nom: 'Región de Murcia',     latMin: 37.4, latMax: 38.8,  lngMin: -2.35, lngMax: -0.65 },
  { nom: 'Andalucía',            latMin: 35.95, latMax: 38.8, lngMin: -7.55, lngMax: -1.55 },
];

function inferir(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Provincias muy específicas primero (Ceuta, Melilla, Canarias) ya están al inicio
  for (const c of CCAA_BBOX) {
    if (lat >= c.latMin && lat <= c.latMax && lng >= c.lngMin && lng <= c.lngMax) {
      return c.nom;
    }
  }
  return null;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);
  const r = await pool.query(`
    SELECT id, denominacion, latitud, longitud
    FROM bienes WHERE pais='España' AND comunidad_autonoma='Aragon'
  `);
  console.log(`Items a resolver: ${r.rows.length}`);

  const updates = [];
  const dist = new Map();
  for (const b of r.rows) {
    const ccaa = inferir(parseFloat(b.latitud), parseFloat(b.longitud));
    if (ccaa) {
      updates.push({ id: b.id, ccaa });
      dist.set(ccaa, (dist.get(ccaa) || 0) + 1);
    }
  }
  console.log(`Resueltos por bbox: ${updates.length}`);
  console.log(`Sin bbox match: ${r.rows.length - updates.length}`);

  console.log('\nDistribución:');
  [...dist.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));

  if (DRY_RUN) {
    console.log('\n[DRY-RUN]');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      await client.query('UPDATE bienes SET comunidad_autonoma=$1 WHERE id=$2', [u.ccaa, u.id]);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${updates.length} UPDATEs aplicados`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
  }

  // Verificar restantes
  const v = await pool.query("SELECT COUNT(*)::int n FROM bienes WHERE pais='España' AND comunidad_autonoma='Aragon'");
  console.log(`\nQuedan 'Aragon' (sin tilde): ${v.rows[0].n}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
