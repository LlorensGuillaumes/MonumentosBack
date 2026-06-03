/**
 * Importa items OSM España SIN wikidata=Q, evitando duplicar lo que ya hay en BD.
 *
 * Estrategia:
 *  - Filtrar tipos relevantes (excluir wayside_cross, boundary_stone, etc.)
 *  - Cross-ref con BD por coords cercanas (<500m) + denominación similar
 *  - Si no hay match → insertar como nuevo (sin QID)
 *  - CCAA inferida por bbox de coords
 *
 * Uso:
 *   node _importar_osm_sin_wikidata.cjs           # dry-run
 *   node _importar_osm_sin_wikidata.cjs --apply
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const DRY_RUN = !process.argv.includes('--apply');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

const TIPOS_VALIDOS = new Set([
  'archaeological_site', 'memorial', 'manor', 'ruins', 'monument',
  'castle', 'building', 'church', 'bridge', 'wayside_shrine', 'city_gate',
  'tomb', 'heritage', 'aqueduct', 'railway_station', 'tower', 'castle_wall',
  'battlefield', 'fort', 'monastery', 'palace', 'citywalls', 'fountain',
  'lavoir', 'chapel', 'lighthouse', 'roman_bridge', 'roman_road', 'mine',
  'watermill', 'train_station', 'house', 'farm', 'plaza_de_toros',
  'dam', 'kiln', 'hospital', 'threshing_floor', 'cannon',
]);

const TIPO_MAP = {
  archaeological_site: 'Yacimiento arqueológico',
  tomb: 'Yacimiento arqueológico',
  battlefield: 'Yacimiento arqueológico',
  roman_road: 'Yacimiento arqueológico',
  threshing_floor: 'Yacimiento arqueológico',
  memorial: 'Monumento conmemorativo',
  monument: 'Monumento conmemorativo',
  cannon: 'Monumento conmemorativo',
  manor: 'Casa señorial / Mansión',
  palace: 'Palacio',
  ruins: 'Edificio histórico',
  heritage: 'Edificio histórico',
  building: 'Edificio histórico',
  house: 'Casa señorial / Mansión',
  farm: 'Arquitectura rural',
  castle: 'Castillo / Fortaleza',
  fort: 'Castillo / Fortaleza',
  castle_wall: 'Muralla',
  citywalls: 'Muralla',
  city_gate: 'Muralla',
  tower: 'Torre',
  church: 'Iglesia / Ermita',
  chapel: 'Iglesia / Ermita',
  wayside_shrine: 'Iglesia / Ermita',
  monastery: 'Monasterio / Convento',
  bridge: 'Puente',
  roman_bridge: 'Puente',
  aqueduct: 'Acueducto',
  fountain: 'Fuente',
  lavoir: 'Fuente',
  watermill: 'Molino',
  railway_station: 'Patrimonio industrial',
  train_station: 'Patrimonio industrial',
  mine: 'Patrimonio industrial',
  dam: 'Patrimonio industrial',
  kiln: 'Patrimonio industrial',
  lighthouse: 'Faro',
  plaza_de_toros: 'Plaza de toros',
  hospital: 'Edificio histórico',
};

// CCAA bbox (igual que en _resolver_151_ccaa_bbox)
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

function inferirCCAA(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const c of CCAA_BBOX) {
    if (lat >= c.latMin && lat <= c.latMax && lng >= c.lngMin && lng <= c.lngMax) return c.nom;
  }
  return null;
}

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Normalización extendida: traducciones es↔ca↔gl↔eu, eliminación de stop-prefixes
function normExt(s) {
  let n = norm(s);
  // Equivalencias bilingües (catalán → castellano simplificado)
  const reps = [
    [/\besglesia\b/g, 'iglesia'],
    [/\besglésia\b/g, 'iglesia'],
    [/\bcastell\b/g, 'castillo'],
    [/\btorre del?\b/g, 'torre'],
    [/\bermita de la?\b/g, 'ermita'],
    [/\bermita del?\b/g, 'ermita'],
    [/\bcapella\b/g, 'capilla'],
    [/\bsanta maria\b/g, 'santa maria'],
    [/\bsant\b/g, 'san'],
    [/\bsta\b/g, 'santa'],
    [/\bdona\b/g, 'mare de deu'],  // confusión común catalán
    [/\bvirgen\b/g, 'mare de deu'],
    [/\bsenyora\b/g, 'señora'],
    [/\bmonestir\b/g, 'monasterio'],
    [/\bconvent\b/g, 'convento'],
    [/\bcatedral basilica\b/g, 'catedral'],
    [/\bsantuari\b/g, 'santuario'],
  ];
  for (const [re, to] of reps) n = n.replace(re, to);
  // Tokens stop comunes (no aportan identidad)
  const STOP = new Set(['de','del','la','las','los','el','y','i','en','su','sus','un','una',
                        'iglesia','ermita','capilla','convento','monasterio','catedral','castillo',
                        'torre','palacio','santuario','san','santa','santo','rectoral','casa','pazo',
                        'mare','deu','de','dona','sant','sta','st']);
  return n.split(' ').filter(t => t.length >= 4 && !STOP.has(t));
}

function tokenSimilarity(arrA, arrB) {
  if (arrA.length === 0 || arrB.length === 0) return 0;
  const sA = new Set(arrA);
  let common = 0;
  for (const t of arrB) if (sA.has(t)) common++;
  return common / Math.min(arrA.length, arrB.length);
}

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

  const d = JSON.parse(fs.readFileSync('./_osm_spain.json'));
  const sinWd = d.elements.filter(e => !e.tags?.wikidata);
  console.log(`OSM sin wikidata: ${sinWd.length}`);

  // Filtrar: tipo válido + tiene nombre + tiene coords
  const candidatos = sinWd.filter(e => {
    if (!TIPOS_VALIDOS.has(e.tags?.historic)) return false;
    const name = e.tags?.name || e.tags?.['name:es'] || e.tags?.['name:ca'];
    if (!name || name.length < 4) return false;
    const lat = e.lat || e.center?.lat;
    const lon = e.lon || e.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return true;
  });
  console.log(`Candidatos válidos (tipo + nombre + coords): ${candidatos.length}`);

  // Por tipo
  const byTipo = new Map();
  candidatos.forEach(e => byTipo.set(e.tags.historic, (byTipo.get(e.tags.historic) || 0) + 1));
  console.log('\nPor tipo (top 15):');
  [...byTipo.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

  // Cargar todos los bienes España con coords para cross-ref
  console.log('\nCargando bienes BD para cross-ref...');
  const bdRes = await pool.query(`
    SELECT id, denominacion, latitud, longitud FROM bienes
    WHERE pais='España' AND latitud IS NOT NULL
  `);
  console.log(`Bienes BD a comparar: ${bdRes.rows.length}`);

  // Index por bbox grueso. 0.02 grados = ~2km. Buscamos en 3x3 cells = ~6km radio.
  const grid = new Map();
  for (const b of bdRes.rows) {
    const lat = parseFloat(b.latitud);
    const lng = parseFloat(b.longitud);
    const key = `${Math.floor(lat*50)}:${Math.floor(lng*50)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({
      id: b.id, lat, lng,
      normName: norm(b.denominacion),
      tokensExt: normExt(b.denominacion),
    });
  }

  // Match each candidate
  const nuevos = [];
  const matched = [];
  for (const e of candidatos) {
    const lat = e.lat || e.center.lat;
    const lon = e.lon || e.center.lon;
    const name = e.tags.name || e.tags['name:es'] || e.tags['name:ca'];
    const normN = norm(name);
    const tokensN = normExt(name);
    const baseLat = Math.floor(lat*50);
    const baseLng = Math.floor(lon*50);
    let foundMatch = null;
    for (let di = -1; di <= 1 && !foundMatch; di++) {
      for (let dj = -1; dj <= 1 && !foundMatch; dj++) {
        const cell = grid.get(`${baseLat+di}:${baseLng+dj}`);
        if (!cell) continue;
        for (const b of cell) {
          const d = distKm(lat, lon, b.lat, b.lng);
          if (d > 0.5) continue; // >500m → no match
          // Match nivel 1: contención literal normalizada
          if (b.normName === normN ||
              b.normName.includes(normN) ||
              normN.includes(b.normName)) {
            foundMatch = b;
            break;
          }
          // Match nivel 2: tokens significativos compartidos con normalización extendida
          if (tokensN.length > 0 && b.tokensExt.length > 0) {
            const sim = tokenSimilarity(tokensN, b.tokensExt);
            if (sim >= 0.5 && d < 0.3) { // 50% tokens + dist <300m → muy probable mismo
              foundMatch = b;
              break;
            }
          }
        }
      }
    }
    if (foundMatch) matched.push({ osmName: name, bdId: foundMatch.id });
    else nuevos.push({
      name, lat, lon,
      tipo: e.tags.historic,
      municipio: e.tags['addr:city'] || e.tags['is_in:municipality'] || null,
    });
  }

  console.log(`\nMatched (ya en BD): ${matched.length}`);
  console.log(`Nuevos para importar: ${nuevos.length}`);

  // Sanitarios: España bbox + CCAA inferida
  const sanos = nuevos.map(n => ({ ...n, ccaa: inferirCCAA(n.lat, n.lon) }))
                       .filter(n => n.ccaa !== null);
  console.log(`Sanos con CCAA: ${sanos.length}`);

  // Por CCAA
  const distCcaa = new Map();
  sanos.forEach(n => distCcaa.set(n.ccaa, (distCcaa.get(n.ccaa) || 0) + 1));
  console.log('\nDistribución por CCAA:');
  [...distCcaa.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

  // Muestra
  console.log('\nMuestra 10 primeros nuevos:');
  sanos.slice(0,10).forEach(n => console.log(`  ${n.name.slice(0,40).padEnd(40)} ${n.ccaa.padEnd(20)} (osm:${n.tipo})`));

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Sin escribir.');
    await pool.end();
    return;
  }

  // Insertar
  console.log('\nInsertando...');
  const client = await pool.connect();
  let ins = 0;
  try {
    await client.query('BEGIN');
    for (const n of sanos) {
      const tipo_monumento = TIPO_MAP[n.tipo] || 'Edificio histórico';
      await client.query(
        `INSERT INTO bienes (denominacion, tipo_monumento, municipio, comunidad_autonoma, pais, latitud, longitud, fuente_opendata)
         VALUES ($1, $2, $3, $4, 'España', $5, $6, 0)`,
        [n.name.slice(0, 250), tipo_monumento, n.municipio, n.ccaa, n.lat, n.lon]
      );
      ins++;
      if (ins % 500 === 0) console.log(`  [${ins}/${sanos.length}]`);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${ins} bienes insertados`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
