/**
 * Limpia provincias cruzadas/anómalas:
 *  - Provincias con coma → primera del string ("Cádiz, Málaga" → "Cádiz")
 *  - Provincias de OTRA CCAA dentro de Andalucía (Valencia, Alicante, Castellón, Bizkaia...):
 *    inferir por coords usando centroides andaluces.
 *  - Provincias anómalas en CCAA no-andaluzas: inferir por bbox de la CCAA correcta.
 *
 * Uso:
 *   node _limpiar_provincias_cruzadas.cjs           # dry-run
 *   node _limpiar_provincias_cruzadas.cjs --apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Centroides de provincias por CCAA (las CCAA pluriprovinciales)
const CENTROIDES_POR_CCAA = {
  'Andalucía': [
    { nom: 'Almería',  lat: 37.15, lng: -2.10 },
    { nom: 'Cádiz',    lat: 36.55, lng: -5.95 },
    { nom: 'Córdoba',  lat: 37.95, lng: -4.75 },
    { nom: 'Granada',  lat: 37.30, lng: -3.30 },
    { nom: 'Huelva',   lat: 37.55, lng: -6.85 },
    { nom: 'Jaén',     lat: 37.95, lng: -3.40 },
    { nom: 'Málaga',   lat: 36.80, lng: -4.65 },
    { nom: 'Sevilla',  lat: 37.55, lng: -5.85 },
  ],
  'Aragón': [
    { nom: 'Huesca',   lat: 42.13, lng: -0.42 },
    { nom: 'Teruel',   lat: 40.34, lng: -1.10 },
    { nom: 'Zaragoza', lat: 41.65, lng: -0.90 },
  ],
  'Castilla-La Mancha': [
    { nom: 'Albacete',     lat: 38.85, lng: -1.83 },
    { nom: 'Ciudad Real',  lat: 38.99, lng: -3.92 },
    { nom: 'Cuenca',       lat: 40.07, lng: -2.13 },
    { nom: 'Guadalajara',  lat: 40.83, lng: -2.96 },
    { nom: 'Toledo',       lat: 39.86, lng: -4.02 },
  ],
  'Galicia': [
    { nom: 'A Coruña',   lat: 43.00, lng: -8.40 },
    { nom: 'Lugo',       lat: 43.00, lng: -7.55 },
    { nom: 'Ourense',    lat: 42.34, lng: -7.85 },
    { nom: 'Pontevedra', lat: 42.43, lng: -8.65 },
  ],
  'Castilla y León': [
    { nom: 'Ávila',      lat: 40.65, lng: -4.70 },
    { nom: 'Burgos',     lat: 42.34, lng: -3.70 },
    { nom: 'León',       lat: 42.60, lng: -5.57 },
    { nom: 'Palencia',   lat: 42.00, lng: -4.53 },
    { nom: 'Salamanca',  lat: 40.96, lng: -5.66 },
    { nom: 'Segovia',    lat: 40.95, lng: -4.12 },
    { nom: 'Soria',      lat: 41.77, lng: -2.47 },
    { nom: 'Valladolid', lat: 41.65, lng: -4.72 },
    { nom: 'Zamora',     lat: 41.50, lng: -5.75 },
  ],
  'Catalunya': [
    { nom: 'Barcelona',  lat: 41.50, lng: 1.95 },
    { nom: 'Girona',     lat: 42.00, lng: 2.80 },
    { nom: 'Lleida',     lat: 41.85, lng: 0.95 },
    { nom: 'Tarragona',  lat: 41.10, lng: 1.20 },
  ],
  'Comunitat Valenciana': [
    { nom: 'Alicante',   lat: 38.35, lng: -0.50 },
    { nom: 'Castellón',  lat: 40.20, lng: -0.10 },
    { nom: 'Valencia',   lat: 39.50, lng: -0.80 },
  ],
  'Canarias': [
    { nom: 'Las Palmas',             lat: 28.10, lng: -15.40 },
    { nom: 'Santa Cruz de Tenerife', lat: 28.45, lng: -16.30 },
  ],
  'Extremadura': [
    { nom: 'Badajoz', lat: 38.88, lng: -6.97 },
    { nom: 'Cáceres', lat: 39.47, lng: -6.37 },
  ],
  'País Vasco': [
    { nom: 'Álava',    lat: 42.85, lng: -2.67 },
    { nom: 'Bizkaia',  lat: 43.20, lng: -2.90 },
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

function inferirProvincia(ccaa, lat, lng) {
  const centroides = CENTROIDES_POR_CCAA[ccaa];
  if (!centroides || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let mejor = null, mejorDist = Infinity;
  for (const c of centroides) {
    const d = distKm(lat, lng, c.lat, c.lng);
    if (d < mejorDist) { mejorDist = d; mejor = c; }
  }
  return mejor?.nom || null;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  // 1. Provincias con coma (cruzadas)
  console.log('═══ Fase 1: provincias con coma ═══');
  const r1 = await pool.query(`
    SELECT id, comunidad_autonoma, provincia, latitud, longitud
    FROM bienes
    WHERE pais='España' AND provincia LIKE '%,%'
  `);
  console.log(`Encontrados: ${r1.rows.length}\n`);
  const cambios1 = [];
  for (const b of r1.rows) {
    const primera = b.provincia.split(',')[0].trim();
    cambios1.push({ id: b.id, viejo: b.provincia, nuevo: primera, ccaa: b.comunidad_autonoma });
    console.log(`  #${b.id} ${b.ccaa}: "${b.provincia}" → "${primera}"`);
  }

  // 2. Provincias de OTRA CCAA (no coincide con su CCAA)
  console.log('\n═══ Fase 2: provincias ajenas a su CCAA ═══');
  const todasProvinciasValidas = new Map();
  for (const [ccaa, centroides] of Object.entries(CENTROIDES_POR_CCAA)) {
    for (const c of centroides) {
      if (!todasProvinciasValidas.has(c.nom)) todasProvinciasValidas.set(c.nom, ccaa);
    }
  }
  // Las uniprovinciales también
  const UNIPROV = {
    'Asturias':'Asturias','Cantabria':'Cantabria','Illes Balears':'Illes Balears',
    'La Rioja':'La Rioja','Madrid':'Comunidad de Madrid','Murcia':'Región de Murcia',
    'Navarra':'Navarra','Ceuta':'Ceuta','Melilla':'Melilla',
  };
  for (const [p, c] of Object.entries(UNIPROV)) todasProvinciasValidas.set(p, c);

  const r2 = await pool.query(`
    SELECT id, comunidad_autonoma, provincia, latitud, longitud
    FROM bienes
    WHERE pais='España' AND provincia IS NOT NULL AND provincia NOT LIKE '%,%'
      AND comunidad_autonoma IS NOT NULL
  `);
  const cambios2 = [];
  for (const b of r2.rows) {
    const ccaaPertenece = todasProvinciasValidas.get(b.provincia);
    if (ccaaPertenece && ccaaPertenece !== b.comunidad_autonoma) {
      // Provincia ajena a su CCAA — inferir nueva por coords
      const inferida = inferirProvincia(b.comunidad_autonoma, parseFloat(b.latitud), parseFloat(b.longitud));
      cambios2.push({
        id: b.id, viejo: b.provincia, nuevo: inferida, ccaa: b.comunidad_autonoma,
        observ: inferida ? '' : '(sin coords - se queda como NULL)'
      });
    }
  }
  console.log(`Encontrados: ${cambios2.length}\n`);
  cambios2.forEach(c => console.log(`  #${c.id} ${c.ccaa}: "${c.viejo}" → "${c.nuevo || 'NULL'}" ${c.observ}`));

  const totalCambios = cambios1.length + cambios2.length;
  console.log(`\nTotal cambios: ${totalCambios}`);

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Sin escribir. --apply para aplicar.');
    await pool.end();
    return;
  }

  // Aplicar
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of [...cambios1, ...cambios2]) {
      await client.query('UPDATE bienes SET provincia=$1 WHERE id=$2', [c.nuevo || null, c.id]);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${totalCambios} UPDATEs aplicados`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
  }

  // Verificación
  const v = await pool.query(`
    SELECT COUNT(*)::int as n FROM bienes WHERE pais='España' AND provincia LIKE '%,%'
  `);
  console.log(`\nProvincias con coma restantes: ${v.rows[0].n}`);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
