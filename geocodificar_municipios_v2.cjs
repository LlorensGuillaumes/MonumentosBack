/**
 * geocodificar_municipios_v2.cjs
 * Geocodifica bienes sin coordenadas usando nombre de municipio + provincia + país.
 * Agrupa por municipio único para minimizar consultas a Nominatim.
 * Respeta rate limit de 1 req/seg.
 */

const db = require('./db.cjs');
const axios = require('axios');

const DELAY_MS = 1100; // Nominatim: max 1 req/sec

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocode(municipio, provincia, pais) {
  const countryMap = {
    'España': 'Spain',
    'Francia': 'France',
    'Portugal': 'Portugal',
  };
  const country = countryMap[pais] || pais;

  // Intentar con municipio + provincia + país
  const queries = [
    { q: `${municipio}, ${provincia}, ${country}` },
    { q: `${municipio}, ${country}` },
  ];

  for (const params of queries) {
    try {
      const res = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { ...params, format: 'json', limit: 1 },
        headers: { 'User-Agent': 'PatrimonioEuropeo/1.0 (geocoding)' },
        timeout: 10000,
      });
      if (res.data && res.data.length > 0) {
        return {
          lat: parseFloat(res.data[0].lat),
          lon: parseFloat(res.data[0].lon),
        };
      }
    } catch (err) {
      // Retry on error
      await sleep(2000);
    }
  }
  return null;
}

async function main() {
  console.log('=== Geocodificación por municipio (Nominatim) ===\n');

  // Obtener combinaciones únicas de municipio+provincia+pais sin coords
  const groups = (await db.query(`
    SELECT municipio, provincia, pais, COUNT(*) as c
    FROM bienes
    WHERE (latitud IS NULL OR longitud IS NULL)
    AND municipio IS NOT NULL AND municipio != ''
    GROUP BY municipio, provincia, pais
    ORDER BY c DESC
  `)).rows;

  console.log(`Combinaciones únicas municipio+provincia+pais: ${groups.length}`);
  const totalItems = groups.reduce((sum, g) => sum + parseInt(g.c), 0);
  console.log(`Total items afectados: ${totalItems}\n`);

  let totalUpdated = 0;
  let geocoded = 0;
  let failed = 0;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const progress = `[${i + 1}/${groups.length}]`;

    // Check if we already have coords for same municipality in DB
    const existing = (await db.query(`
      SELECT latitud, longitud FROM bienes
      WHERE municipio = ? AND pais = ? AND latitud IS NOT NULL AND longitud IS NOT NULL
      LIMIT 1
    `, [g.municipio, g.pais])).rows[0];

    let coords;
    if (existing) {
      coords = { lat: existing.latitud, lon: existing.longitud };
      process.stdout.write(`${progress} ${g.municipio} (${g.pais}) [${g.c} items] -> DB cache`);
    } else {
      coords = await geocode(g.municipio, g.provincia, g.pais);
      if (coords) {
        process.stdout.write(`${progress} ${g.municipio} (${g.pais}) [${g.c} items] -> ${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`);
      }
      await sleep(DELAY_MS);
    }

    if (coords && !isNaN(coords.lat) && !isNaN(coords.lon)) {
      const result = await db.query(`
        UPDATE bienes SET latitud = ?, longitud = ?
        WHERE (latitud IS NULL OR longitud IS NULL)
        AND municipio = ? AND pais = ?
        AND (provincia = ? OR provincia IS NULL)
      `, [coords.lat, coords.lon, g.municipio, g.pais, g.provincia]);
      totalUpdated += result.rowCount;
      geocoded++;
      console.log(` (${result.rowCount} actualizados)`);
    } else {
      failed++;
      console.log(`${progress} ${g.municipio} (${g.pais}) [${g.c} items] -> NO ENCONTRADO`);
    }

    // Progress log every 100
    if ((i + 1) % 100 === 0) {
      console.log(`--- Progreso: ${i + 1}/${groups.length} procesados, ${totalUpdated} actualizados, ${failed} fallidos ---`);
    }
  }

  console.log(`\n=== RESULTADO ===`);
  console.log(`Municipios geocodificados: ${geocoded}/${groups.length}`);
  console.log(`Municipios no encontrados: ${failed}`);
  console.log(`Total bienes actualizados: ${totalUpdated}`);

  const remaining = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE latitud IS NULL OR longitud IS NULL")).rows[0];
  console.log(`Items restantes sin coords: ${remaining.c}`);

  await db.cerrar();
}

main().catch(err => { console.error(err); process.exit(1); });
