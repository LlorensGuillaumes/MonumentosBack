/**
 * Refina coords aproximadas (coords_precision='municipio') usando Nominatim.
 * Solo procesa items con nombre rico (Iglesia/Ermita/Castillo/etc).
 *
 * Uso:
 *   node _nominatim_refinar.cjs               # dry-run sample 100
 *   node _nominatim_refinar.cjs --apply       # aplica
 *   node _nominatim_refinar.cjs --apply --limit=5000
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=100').split('=')[1], 10);
const MIN_DIST_KM = 0;     // mejora siempre que esté en bbox
const MAX_DIST_KM = 8;     // sanity: no aceptar si Nominatim devuelve algo a >8km del municipio

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Términos para filtrar nombres "buscables" en OSM
const TERMINOS_BUSCABLES = ['iglesia', 'ermita', 'catedral', 'capilla', 'basílica', 'santuario',
  'monasterio', 'convento', 'colegiata', 'parroquia',
  'castillo', 'fortaleza', 'alcazaba', 'torre', 'palacio', 'palau',
  'museo', 'casa señorial', 'pazo', 'cortijo', 'masía',
  'puente', 'acueducto', 'molino', 'molí',
  'plaza', 'mercado', 'teatro'];

function distKm(la1, lo1, la2, lo2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(la2 - la1);
  const dLng = toRad(lo2 - lo1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(la1))*Math.cos(toRad(la2))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function nominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=es`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PatrimonioEuropeo/1.0 (webdepatrimonio@gmail.com)' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}  |  limit=${LIMIT}\n`);

  const termsLike = TERMINOS_BUSCABLES.map(t => `LOWER(b.denominacion) LIKE '%${t}%'`).join(' OR ');
  const r = await pool.query(`
    SELECT b.id, b.denominacion, b.municipio, b.provincia, b.latitud, b.longitud
    FROM bienes b
    WHERE b.pais='España' AND b.coords_precision='municipio'
      AND (${termsLike})
      AND b.municipio IS NOT NULL AND b.provincia IS NOT NULL
    ORDER BY b.id
    LIMIT $1
  `, [LIMIT]);

  console.log(`Candidatos: ${r.rows.length}\n`);
  if (r.rows.length === 0) { await pool.end(); return; }

  let resueltos = 0, descartados = 0, sinMatch = 0;
  const updates = [];

  for (let i = 0; i < r.rows.length; i++) {
    const b = r.rows[i];
    const q = `${b.denominacion}, ${b.municipio}, ${b.provincia}, España`;
    try {
      const res = await nominatim(q);
      if (res.length > 0) {
        const lat = parseFloat(res[0].lat), lng = parseFloat(res[0].lon);
        const d = distKm(parseFloat(b.latitud), parseFloat(b.longitud), lat, lng);
        if (d >= MIN_DIST_KM && d <= MAX_DIST_KM) {
          updates.push({ id: b.id, lat, lng, dist: d, name: b.denominacion });
          resueltos++;
        } else {
          descartados++;
          if (descartados <= 5) console.log(`  ✗ #${b.id} descartado por dist=${d.toFixed(1)}km: "${b.denominacion}" en ${b.municipio}`);
        }
      } else {
        sinMatch++;
      }
    } catch (e) {
      console.log(`  ⚠ #${b.id} error: ${e.message.slice(0,60)}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  [${i+1}/${r.rows.length}] ok=${resueltos} desc=${descartados} nomatch=${sinMatch}`);
    await sleep(1100); // 1 req/s recommended by Nominatim
  }

  console.log(`\n=== RESULTADO ===`);
  console.log(`  Refinados (aceptables): ${resueltos}`);
  console.log(`  Descartados (>${MAX_DIST_KM}km): ${descartados}`);
  console.log(`  Sin match: ${sinMatch}`);
  console.log(`  Total: ${r.rows.length}`);

  // Muestra primeros 10 OK
  console.log(`\n=== Muestra primeros 10 refinamientos ===`);
  updates.slice(0, 10).forEach(u =>
    console.log(`  #${u.id}  +${u.dist.toFixed(2)}km   "${u.name.slice(0,55)}"`)
  );

  if (!DRY_RUN && updates.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const u of updates) {
        await client.query(
          "UPDATE bienes SET latitud=$1, longitud=$2, coords_precision='nominatim' WHERE id=$3",
          [u.lat, u.lng, u.id]
        );
      }
      await client.query('COMMIT');
      console.log(`\n✓ ${updates.length} UPDATEs aplicados (coords_precision='nominatim')`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('ROLLBACK:', e.message);
    } finally {
      client.release();
    }
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
