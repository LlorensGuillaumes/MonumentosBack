/**
 * Importa items OSM España con wikidata=Q... que NO tenemos en BD.
 *
 * Estrategia: cada item OSM tiene un QID. Hacemos SPARQL batch para sacar
 * metadata (label, coords, image, type, P131 municipio, P17 país) y los
 * insertamos en bienes + wikidata + imagenes.
 *
 * Filtros sanitarios:
 *  - Tipo OSM relevante (excluimos wayside_cross y boundary_stone como menores)
 *  - QID debe tener coords en Wikidata
 *  - País Wikidata = España (Q29) — descartar cross-borders
 *
 * Uso:
 *   node _importar_osm_wikidata.cjs           # dry-run
 *   node _importar_osm_wikidata.cjs --apply
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const DRY_RUN = !process.argv.includes('--apply');
const BATCH_SIZE = 80;

// Tipos OSM a importar (filtro)
const TIPOS_VALIDOS = new Set([
  'archaeological_site', 'memorial', 'manor', 'ruins', 'yes', 'monument',
  'castle', 'building', 'church', 'bridge', 'wayside_shrine', 'city_gate',
  'tomb', 'heritage', 'aqueduct', 'railway_station', 'tower', 'castle_wall',
  'battlefield', 'fort', 'monastery', 'palace', 'citywalls', 'fountain',
  'lavoir', 'chapel', 'lighthouse', 'roman_bridge', 'roman_road', 'mine',
  'watermill', 'train_station', 'house', 'farm', 'plaza_de_toros',
  'dam', 'kiln', 'hospital',
]);

// Categorizar tipo OSM → tipo_monumento del proyecto
const TIPO_MAP = {
  archaeological_site: 'Yacimiento arqueológico',
  tomb: 'Yacimiento arqueológico',
  battlefield: 'Yacimiento arqueológico',
  roman_road: 'Yacimiento arqueológico',
  memorial: 'Monumento conmemorativo',
  monument: 'Monumento conmemorativo',
  manor: 'Casa señorial / Mansión',
  palace: 'Palacio',
  ruins: 'Edificio histórico',
  yes: 'Edificio histórico',
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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PE/1.0 (osm import)' },
    });
    if ([429,502,503,504].includes(res.status)) { await sleep(3000*(i+1)); continue; }
    if (!res.ok) throw new Error(`SPARQL ${res.status}`);
    return res.json();
  }
  throw new Error('max retries');
}

function buildQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  return `
    SELECT ?item ?itemLabel ?lat ?lng ?image ?municipioLabel ?country WHERE {
      VALUES ?item { ${values} }
      ?item p:P625 ?cs .
      ?cs psv:P625 ?cv .
      ?cv wikibase:geoLatitude ?lat .
      ?cv wikibase:geoLongitude ?lng .
      ?item wdt:P17 ?country .
      OPTIONAL { ?item wdt:P18 ?image }
      OPTIONAL { ?item wdt:P131 ?municipio }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,gl,eu,en" }
    }
  `;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  const d = JSON.parse(fs.readFileSync('./_osm_spain.json'));
  const conWd = d.elements.filter(e => e.tags?.wikidata);

  // Filtrar tipos válidos
  const filtrados = conWd.filter(e => TIPOS_VALIDOS.has(e.tags.historic));
  console.log(`OSM con wikidata + tipo válido: ${filtrados.length}`);

  // Cross-ref con BD
  const existing = await pool.query('SELECT qid FROM wikidata');
  const enBD = new Set(existing.rows.map(r => r.qid));
  const nuevos = filtrados.filter(e => !enBD.has(e.tags.wikidata));
  console.log(`Nuevos para importar: ${nuevos.length}`);

  // Index OSM por QID → conserva tipo y coords OSM como fallback
  const osmByQid = new Map();
  for (const e of nuevos) {
    const lat = e.lat || e.center?.lat;
    const lon = e.lon || e.center?.lon;
    osmByQid.set(e.tags.wikidata, {
      tipoOsm: e.tags.historic,
      lat, lon,
      name: e.tags.name || e.tags['name:es'] || e.tags['name:ca'] || null,
      municipio: e.tags['addr:city'] || e.tags['is_in:municipality'] || null,
    });
  }

  // SPARQL batch
  const qids = [...osmByQid.keys()];
  const resolved = new Map(); // qid → {nom, lat, lng, img, mun, country}
  for (let i = 0; i < qids.length; i += BATCH_SIZE) {
    const batch = qids.slice(i, i + BATCH_SIZE);
    try {
      const data = await sparql(buildQuery(batch));
      for (const b of data.results.bindings) {
        const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
        if (resolved.has(qid)) continue;
        const country = b.country.value.replace('http://www.wikidata.org/entity/', '');
        if (country !== 'Q29') continue; // solo España
        const nom = b.itemLabel?.value;
        if (!nom || /^Q\d+$/.test(nom)) continue;
        resolved.set(qid, {
          nom,
          lat: parseFloat(b.lat.value),
          lng: parseFloat(b.lng.value),
          img: b.image?.value || null,
          mun: b.municipioLabel?.value || null,
        });
      }
      process.stdout.write(`  [${Math.min(i+BATCH_SIZE, qids.length)}/${qids.length}] resueltos:${resolved.size}\r`);
    } catch (e) {
      console.log(`\n  ⚠ batch fallido: ${e.message.slice(0,80)}`);
    }
    await sleep(1000);
  }
  console.log();
  console.log(`Resueltos con coords y España: ${resolved.size}`);

  // Preview
  console.log('\nMuestra primeros 10:');
  [...resolved.entries()].slice(0, 10).forEach(([qid, r]) => {
    const osm = osmByQid.get(qid);
    console.log(`  ${qid}  ${r.nom.slice(0,40).padEnd(40)} ${r.mun?.slice(0,18)||'?'} (osm:${osm.tipoOsm})`);
  });

  // Sanitarios España bbox
  const sanos = [...resolved.entries()].filter(([_, r]) => {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return false;
    if (r.lat < 27.5 || r.lat > 44.5) return false;
    if (r.lng < -19 || r.lng > 4.5) return false;
    return true;
  });
  console.log(`\nTras filtros sanitarios: ${sanos.length}`);

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Sin escribir.');
    await pool.end();
    return;
  }

  // Insertar
  console.log('\nInsertando...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ins = 0, imgIns = 0;
    for (const [qid, r] of sanos) {
      const osm = osmByQid.get(qid);
      const tipo_monumento = TIPO_MAP[osm.tipoOsm] || 'Edificio histórico';
      const res = await client.query(
        `INSERT INTO bienes (denominacion, tipo_monumento, municipio, pais, latitud, longitud, fuente_opendata)
         VALUES ($1, $2, $3, 'España', $4, $5, 0) RETURNING id`,
        [r.nom, tipo_monumento, r.mun || null, r.lat, r.lng]
      );
      const bienId = res.rows[0].id;
      await client.query(
        `INSERT INTO wikidata (bien_id, qid, imagen_url) VALUES ($1, $2, $3)`,
        [bienId, qid, r.img || null]
      );
      if (r.img) {
        await client.query(
          `INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1, $2, $3, 'Wikimedia Commons')`,
          [bienId, r.img, r.nom]
        );
        imgIns++;
      }
      ins++;
      if (ins % 200 === 0) console.log(`  [${ins}/${sanos.length}]`);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${ins} bienes insertados (${imgIns} con imagen)`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
