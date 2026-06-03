// Infiere provincia para bienes con provincia NULL pero con coords, usando centroides
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Centroides de provincias por CCAA
const CENTROIDES_POR_CCAA = {
  'Andalucía': [
    { nom: 'Almería',  lat: 37.15, lng: -2.10 }, { nom: 'Cádiz',    lat: 36.55, lng: -5.95 },
    { nom: 'Córdoba',  lat: 37.95, lng: -4.75 }, { nom: 'Granada',  lat: 37.30, lng: -3.30 },
    { nom: 'Huelva',   lat: 37.55, lng: -6.85 }, { nom: 'Jaén',     lat: 37.95, lng: -3.40 },
    { nom: 'Málaga',   lat: 36.80, lng: -4.65 }, { nom: 'Sevilla',  lat: 37.55, lng: -5.85 },
  ],
  'Aragón': [
    { nom: 'Huesca',   lat: 42.13, lng: -0.42 }, { nom: 'Teruel',   lat: 40.34, lng: -1.10 },
    { nom: 'Zaragoza', lat: 41.65, lng: -0.90 },
  ],
  'Castilla-La Mancha': [
    { nom: 'Albacete', lat: 38.85, lng: -1.83 }, { nom: 'Ciudad Real', lat: 38.99, lng: -3.92 },
    { nom: 'Cuenca', lat: 40.07, lng: -2.13 },   { nom: 'Guadalajara', lat: 40.83, lng: -2.96 },
    { nom: 'Toledo', lat: 39.86, lng: -4.02 },
  ],
  'Galicia': [
    { nom: 'A Coruña', lat: 43.00, lng: -8.40 }, { nom: 'Lugo', lat: 43.00, lng: -7.55 },
    { nom: 'Ourense', lat: 42.34, lng: -7.85 }, { nom: 'Pontevedra', lat: 42.43, lng: -8.65 },
  ],
  'Castilla y León': [
    { nom: 'Ávila', lat: 40.65, lng: -4.70 }, { nom: 'Burgos', lat: 42.34, lng: -3.70 },
    { nom: 'León', lat: 42.60, lng: -5.57 }, { nom: 'Palencia', lat: 42.00, lng: -4.53 },
    { nom: 'Salamanca', lat: 40.96, lng: -5.66 }, { nom: 'Segovia', lat: 40.95, lng: -4.12 },
    { nom: 'Soria', lat: 41.77, lng: -2.47 }, { nom: 'Valladolid', lat: 41.65, lng: -4.72 },
    { nom: 'Zamora', lat: 41.50, lng: -5.75 },
  ],
  'Catalunya': [
    { nom: 'Barcelona', lat: 41.50, lng: 1.95 }, { nom: 'Girona', lat: 42.00, lng: 2.80 },
    { nom: 'Lleida', lat: 41.85, lng: 0.95 }, { nom: 'Tarragona', lat: 41.10, lng: 1.20 },
  ],
  'Canarias': [
    { nom: 'Las Palmas', lat: 28.10, lng: -15.40 }, { nom: 'Santa Cruz de Tenerife', lat: 28.45, lng: -16.30 },
  ],
  'Extremadura': [
    { nom: 'Badajoz', lat: 38.88, lng: -6.97 }, { nom: 'Cáceres', lat: 39.47, lng: -6.37 },
  ],
  'País Vasco': [
    { nom: 'Álava', lat: 42.85, lng: -2.67 }, { nom: 'Bizkaia', lat: 43.20, lng: -2.90 },
    { nom: 'Gipuzkoa', lat: 43.20, lng: -2.20 },
  ],
};

function distKm(la1, lo1, la2, lo2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(la2 - la1);
  const dLng = toRad(lo2 - lo1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(la1))*Math.cos(toRad(la2))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);
  let totalUpd = 0;
  const distGlobal = new Map();

  for (const [ccaa, centroides] of Object.entries(CENTROIDES_POR_CCAA)) {
    const r = await pool.query(
      `SELECT id, latitud, longitud FROM bienes
       WHERE pais='España' AND comunidad_autonoma=$1 AND provincia IS NULL AND latitud IS NOT NULL`,
      [ccaa]
    );
    if (r.rows.length === 0) continue;
    console.log(`${ccaa.padEnd(25)} ${r.rows.length} a inferir`);

    const updates = [];
    for (const b of r.rows) {
      const lat = parseFloat(b.latitud), lng = parseFloat(b.longitud);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      let best = null, bestD = Infinity;
      for (const c of centroides) {
        const d = distKm(lat, lng, c.lat, c.lng);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) {
        updates.push({ id: b.id, prov: best.nom });
        const k = `${ccaa}: ${best.nom}`;
        distGlobal.set(k, (distGlobal.get(k) || 0) + 1);
      }
    }

    if (!DRY_RUN && updates.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const u of updates) {
          await client.query('UPDATE bienes SET provincia=$1 WHERE id=$2', [u.prov, u.id]);
        }
        await client.query('COMMIT');
        totalUpd += updates.length;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('  ROLLBACK', ccaa, e.message);
      } finally {
        client.release();
      }
    } else {
      totalUpd += updates.length;
    }
  }

  console.log(`\n${DRY_RUN ? 'A actualizar' : 'Actualizado'}: ${totalUpd}`);
  console.log('\nDistribución:');
  [...distGlobal.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
    console.log(`  ${String(n).padStart(4)}  ${k}`)
  );

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
