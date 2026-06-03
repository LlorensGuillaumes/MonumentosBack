/**
 * SPARQL Wikidata: monumentos en municipios pobres de la Costa Granadina
 * + Valle de Lecrín + Alpujarra colindante.
 *
 * Estrategia: una query por municipio (queries masivas dan timeout 504).
 * Cruza con BD para identificar lo que no tenemos.
 */
require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');

const MUNICIPIOS_TARGET = [
  'Los Guájares', 'Lobres', 'Béznar', 'El Pinar', 'El Valle', 'Restábal',
  'Pinos del Valle', 'Lentegí', 'Ítrabo', 'Jete', 'Rubite', 'Molvízar',
  'Lanjarón', 'Dúrcal', 'Padul', 'Nigüelas',
];

function sparqlQuery(q) {
  return new Promise((resolve, reject) => {
    const data = 'query=' + encodeURIComponent(q);
    const req = https.request(
      {
        hostname: 'query.wikidata.org',
        path: '/sparql?format=json',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'PatrimonioEuropeo/1.0 Node',
          'Accept': 'application/sparql-results+json',
        },
        timeout: 60000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200)
            return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

async function findMunicipalityQID(label) {
  // Sin filtro provincia (la cadena P131 no siempre llega).
  // Pedimos también que esté en España y en Andalucía si hay desambiguación.
  const q = `
    SELECT ?mun ?regionLabel WHERE {
      ?mun wdt:P31 wd:Q2074737 .
      ?mun rdfs:label "${label}"@es .
      OPTIONAL { ?mun wdt:P131 ?region . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    } LIMIT 10
  `;
  const r = await sparqlQuery(q);
  if (r.results.bindings.length === 0) return null;
  // Si hay varios, priorizar el que esté en Granada/Andalucía
  const granada = r.results.bindings.find((b) =>
    b.regionLabel?.value?.match(/Granada|Andalucía|Andalucia/i)
  );
  const chosen = granada || r.results.bindings[0];
  return chosen.mun.value.replace('http://www.wikidata.org/entity/', '');
}

async function monumentsInMunicipality(qid) {
  // Filtramos por tipos relevantes O por estar declarado BIC/heritage status.
  const q = `
    SELECT DISTINCT ?item ?itemLabel ?coords ?image ?typeLabel WHERE {
      ?item wdt:P131 wd:${qid} .
      ?item wdt:P625 ?coords .
      {
        ?item wdt:P31/wdt:P279* wd:Q23413 .  # castle
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q16970 .  # church
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q1019811 . # chapel/hermitage
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q839954 . # archaeological site
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q33506 .  # museum
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q12081 .  # tower (might be too broad)
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q57821 .  # fortress
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q200334 . # spa
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q188055 . # convent
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q44613 .  # monastery
      } UNION {
        ?item wdt:P1435 ?heritage .          # any heritage designation (BIC, etc)
      }
      ?item wdt:P31 ?type .
      OPTIONAL { ?item wdt:P18 ?image }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    } LIMIT 100
  `;
  const r = await sparqlQuery(q);
  return r.results.bindings.map((b) => {
    const m = b.coords.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    return {
      qid: b.item.value.replace('http://www.wikidata.org/entity/', ''),
      label: b.itemLabel?.value,
      lng: m ? parseFloat(m[1]) : null,
      lat: m ? parseFloat(m[2]) : null,
      image: b.image?.value || null,
      type: b.typeLabel?.value,
    };
  });
}

(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  const client = await p.connect();

  try {
    const summary = [];
    for (const mun of MUNICIPIOS_TARGET) {
      process.stdout.write(`\n[${mun}] `);
      const qid = await findMunicipalityQID(mun);
      if (!qid) {
        console.log('(municipio no encontrado en Wikidata como municipio Granada)');
        continue;
      }
      process.stdout.write(`(${qid}) `);
      let items;
      try {
        items = await monumentsInMunicipality(qid);
      } catch (e) {
        console.log(`error: ${e.message}`);
        continue;
      }
      // Deduplicar por QID
      const seen = new Set();
      items = items.filter((i) => (seen.has(i.qid) ? false : seen.add(i.qid)));
      // Cruzar con BD
      if (items.length === 0) {
        console.log('0 monumentos en Wikidata');
        continue;
      }
      const qids = items.map((i) => i.qid);
      const existing = await client.query(
        'SELECT qid FROM wikidata WHERE qid = ANY($1)',
        [qids]
      );
      const existingSet = new Set(existing.rows.map((r) => r.qid));
      const nuevos = items.filter((i) => !existingSet.has(i.qid));
      console.log(`Wikidata: ${items.length} | Ya en BD: ${existingSet.size} | NUEVOS: ${nuevos.length}`);
      for (const i of nuevos) {
        console.log(
          `   ${i.qid} | ${i.label} | ${i.type} | ${i.lat},${i.lng}${i.image ? ' | IMG' : ''}`
        );
      }
      if (nuevos.length > 0) {
        summary.push({ mun, qid, count: nuevos.length, items: nuevos });
      }
    }

    // Segundo paso: cruzar por nombre+municipio para detectar candidatos a UPDATE (no INSERT)
    const norm = (s) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const toInsert = [];
    const toUpdate = [];

    // Haversine en metros
    const distM = (lat1, lng1, lat2, lng2) => {
      const R = 6371000;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    for (const s of summary) {
      // Cargar bienes del municipio con coords y QIDs ya conocidos
      const existing = await client.query(
        `SELECT b.id, b.denominacion, b.tipo_monumento, b.latitud, b.longitud, w.qid AS qid_existente
         FROM bienes b LEFT JOIN wikidata w ON w.bien_id = b.id
         WHERE b.municipio = $1`,
        [s.mun]
      );
      const existingMap = existing.rows.map((r) => ({
        id: r.id,
        nombre: r.denominacion,
        nombreNorm: norm(r.denominacion),
        tipo: r.tipo_monumento,
        qid: r.qid_existente,
        lat: r.latitud != null ? parseFloat(r.latitud) : null,
        lng: r.longitud != null ? parseFloat(r.longitud) : null,
      }));

      for (const cand of s.items) {
        const candNorm = norm(cand.label);
        // 1) Match por nombre normalizado (preferido)
        let match = existingMap.find(
          (e) => !e.qid && (e.nombreNorm === candNorm || e.nombreNorm.includes(candNorm) || candNorm.includes(e.nombreNorm))
        );
        let matchReason = match ? 'nombre' : null;

        // 2) Si no hay match por nombre y hay coords, buscar por proximidad (<150m)
        if (!match && cand.lat != null && cand.lng != null) {
          let best = null;
          let bestD = Infinity;
          for (const e of existingMap) {
            if (e.qid) continue;
            if (e.lat == null || e.lng == null) continue;
            const d = distM(cand.lat, cand.lng, e.lat, e.lng);
            if (d < 150 && d < bestD) {
              best = e;
              bestD = d;
            }
          }
          if (best) {
            match = best;
            matchReason = `proximidad ${bestD.toFixed(0)}m`;
          }
        }

        if (match) {
          toUpdate.push({
            municipio: s.mun,
            bien_id: match.id,
            nombre_actual: match.nombre,
            qid_nuevo: cand.qid,
            label_wikidata: cand.label,
            image: cand.image,
            type: cand.type,
            lat: cand.lat,
            lng: cand.lng,
            match_reason: matchReason,
          });
        } else {
          toInsert.push({
            municipio: s.mun,
            qid: cand.qid,
            label: cand.label,
            image: cand.image,
            type: cand.type,
            lat: cand.lat,
            lng: cand.lng,
          });
        }
      }
    }

    // Filtrar inserts sin coordenadas
    const toInsertConCoords = toInsert.filter((i) => i.lat != null && i.lng != null);
    const toInsertSinCoords = toInsert.filter((i) => i.lat == null || i.lng == null);

    console.log(`\n\n=== A) NUEVOS PARA INSERT (con coords) — ${toInsertConCoords.length} ===`);
    for (const i of toInsertConCoords) {
      console.log(
        `  [${i.municipio}] ${i.qid} | ${i.label} | ${i.type} | ${i.lat},${i.lng}${i.image ? ' | IMG' : ''}`
      );
    }
    console.log(`\n=== B) NUEVOS SIN COORDS (no insertables) — ${toInsertSinCoords.length} ===`);
    for (const i of toInsertSinCoords) {
      console.log(`  [${i.municipio}] ${i.qid} | ${i.label} | ${i.type}`);
    }
    console.log(`\n=== C) MATCH (nombre o proximidad) — UPDATE QID/imagen — ${toUpdate.length} ===`);
    for (const u of toUpdate) {
      console.log(
        `  [${u.municipio}] bien_id=${u.bien_id} "${u.nombre_actual}" ← ${u.qid_nuevo} "${u.label_wikidata}" (match: ${u.match_reason})${u.image ? ' | IMG' : ''}`
      );
    }

    // Guardar JSON para próxima fase
    require('fs').writeFileSync(
      './_costa_granadina_plan.json',
      JSON.stringify({ toInsertConCoords, toInsertSinCoords, toUpdate }, null, 2)
    );
    console.log(`\nGuardado plan en _costa_granadina_plan.json`);
  } finally {
    client.release();
    await p.end();
  }
})();
