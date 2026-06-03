/**
 * Enriquecimiento genérico de zona: dada lista de municipios,
 *  1) cuenta lo que hay ya en BD
 *  2) SPARQL Wikidata por municipio
 *  3) cruza por QID + nombre + proximidad geográfica
 *  4) imprime y guarda plan (INSERT + UPDATE)
 *
 * Uso: node _zona_enrich.cjs <zona-key>
 *   donde zona-key es una clave en ZONAS abajo.
 */
require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const fs = require('fs');

const ZONAS = {
  guadix: {
    municipios: [
      'Guadix', 'Albuñán', 'Aldeire', 'Alicún de Ortega', 'Alquife',
      'Beas de Guadix', 'Benalúa', 'La Calahorra', 'Cogollos de Guadix',
      'Cortes y Graena', 'Darro', 'Dehesas de Guadix', 'Diezma', 'Dólar',
      'Ferreira', 'Fonelas', 'Gor', 'Gorafe', 'Guadahortuna', 'Huélago',
      'Huéneja', 'Jérez del Marquesado', 'Lanteira', 'Lugros', 'Marchal',
      'Morelábor', 'Pedro Martínez', 'La Peza', 'Polícar', 'Purullena',
      'Valle del Zalabí', 'Villanueva de las Torres',
    ],
    comarca: 'Comarca de Guadix',
    comunidad: 'Andalucia',
    pais: 'España',
    provinciaQID: 'Q54952', // Granada
  },
};

// Wikidata label "La X" / "El X" → BD label "X (La)" / "X (El)"
const wd2db = (s) => {
  if (!s) return s;
  const m = s.match(/^(La|El|Los|Las)\s+(.+)$/);
  return m ? `${m[2]} (${m[1]})` : s;
};
// BD label "X (La)" → Wikidata label "La X"
const db2wd = (s) => {
  if (!s) return s;
  const m = s.match(/^(.+)\s+\((La|El|Los|Las)\)$/);
  return m ? `${m[2]} ${m[1]}` : s;
};

const zonaKey = process.argv[2] || 'guadix';
const ZONA = ZONAS[zonaKey];
if (!ZONA) {
  console.error(`Zona "${zonaKey}" no definida. Disponibles: ${Object.keys(ZONAS).join(', ')}`);
  process.exit(1);
}
console.log(`Zona: ${zonaKey} (${ZONA.municipios.length} municipios)`);

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

async function findMunicipalityQID(label, provinciaQID) {
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
  // Si hay varios, priorizar Granada/Andalucía
  const target = r.results.bindings.find((b) =>
    b.regionLabel?.value?.match(/Granada|Andalucía|Andalucia/i)
  );
  const chosen = target || r.results.bindings[0];
  return chosen.mun.value.replace('http://www.wikidata.org/entity/', '');
}

async function monumentsInMunicipality(qid) {
  const q = `
    SELECT DISTINCT ?item ?itemLabel ?coords ?image ?typeLabel WHERE {
      ?item wdt:P131 wd:${qid} .
      ?item wdt:P625 ?coords .
      {
        ?item wdt:P31/wdt:P279* wd:Q23413 .
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q16970 .
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q1019811 .
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q839954 .
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q33506 .
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q12081 .
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q57821 .
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q200334 .
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q188055 .
      } UNION {
        ?item wdt:P31/wdt:P279* wd:Q44613 .
      } UNION {
        ?item wdt:P1435 ?heritage .
      }
      ?item wdt:P31 ?type .
      OPTIONAL { ?item wdt:P18 ?image }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    } LIMIT 200
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

const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  const client = await p.connect();

  try {
    // Cada municipio tiene 2 posibles labels: el wikidata-style ("La X") y el BD-style ("X (La)").
    // Para querys SQL probamos ambos.
    const munWithAliases = ZONA.municipios.map((m) => ({
      wd: m,
      db: wd2db(m),
      aliases: [m, wd2db(m), db2wd(m)].filter((v, i, a) => a.indexOf(v) === i),
    }));

    // 1) Recuento BD existente — usar todos los aliases por municipio
    console.log('\n=== Estado BD actual ===');
    const allAliases = munWithAliases.flatMap((m) => m.aliases);
    const counts = await client.query(
      `SELECT b.municipio, COUNT(*) AS total,
              SUM(CASE WHEN w.qid IS NOT NULL THEN 1 ELSE 0 END) AS con_qid
       FROM bienes b LEFT JOIN wikidata w ON w.bien_id = b.id
       WHERE b.municipio = ANY($1)
       GROUP BY b.municipio
       ORDER BY total DESC`,
      [allAliases]
    );
    for (const m of munWithAliases) {
      const rows = counts.rows.filter((r) => m.aliases.includes(r.municipio));
      const total = rows.reduce((a, r) => a + parseInt(r.total), 0);
      const conQid = rows.reduce((a, r) => a + parseInt(r.con_qid), 0);
      const variantes = rows.map((r) => `"${r.municipio}"=${r.total}`).join(', ');
      console.log(
        `  ${m.wd.padEnd(28)} BD: ${total}, con QID: ${conQid}${variantes ? ` (${variantes})` : ''}`
      );
    }
    const totalInDB = counts.rows.reduce((a, r) => a + parseInt(r.total), 0);
    console.log(`\nTotal en BD: ${totalInDB}`);

    // 2) SPARQL por municipio
    const summary = [];
    for (const mun of ZONA.municipios) {
      process.stdout.write(`\n[${mun}] `);
      let qid;
      try {
        qid = await findMunicipalityQID(mun, ZONA.provinciaQID);
      } catch (e) {
        console.log(`error: ${e.message}`);
        continue;
      }
      if (!qid) {
        console.log('(no encontrado en Wikidata)');
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
      // Dedup por QID
      const seen = new Set();
      items = items.filter((i) => (seen.has(i.qid) ? false : seen.add(i.qid)));
      if (items.length === 0) {
        console.log('0');
        continue;
      }
      const qids = items.map((i) => i.qid);
      const existing = await client.query(
        'SELECT qid FROM wikidata WHERE qid = ANY($1)',
        [qids]
      );
      const existingSet = new Set(existing.rows.map((r) => r.qid));
      const nuevos = items.filter((i) => !existingSet.has(i.qid));
      console.log(`WD: ${items.length} | en BD: ${existingSet.size} | NUEVOS: ${nuevos.length}`);
      for (const i of nuevos) {
        console.log(
          `   ${i.qid} | ${i.label} | ${i.type} | ${i.lat ?? '-'},${i.lng ?? '-'}${i.image ? ' | IMG' : ''}`
        );
      }
      if (nuevos.length > 0) summary.push({ mun, qid, items: nuevos });
    }

    // 3) Cruzar por nombre + proximidad
    const toInsert = [];
    const toUpdate = [];
    for (const s of summary) {
      // Buscar con todos los aliases del municipio
      const mAliases = munWithAliases.find((mw) => mw.wd === s.mun)?.aliases || [s.mun];
      const existing = await client.query(
        `SELECT b.id, b.denominacion, b.municipio, b.tipo_monumento, b.latitud, b.longitud, w.qid AS qid_existente
         FROM bienes b LEFT JOIN wikidata w ON w.bien_id = b.id
         WHERE b.municipio = ANY($1)`,
        [mAliases]
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
        let match = existingMap.find(
          (e) => !e.qid && (e.nombreNorm === candNorm || e.nombreNorm.includes(candNorm) || candNorm.includes(e.nombreNorm))
        );
        let matchReason = match ? 'nombre' : null;

        if (!match && cand.lat != null && cand.lng != null) {
          let best = null, bestD = Infinity;
          for (const e of existingMap) {
            if (e.qid) continue;
            if (e.lat == null || e.lng == null) continue;
            const d = distM(cand.lat, cand.lng, e.lat, e.lng);
            if (d < 150 && d < bestD) { best = e; bestD = d; }
          }
          if (best) { match = best; matchReason = `proximidad ${bestD.toFixed(0)}m`; }
        }

        if (match) {
          toUpdate.push({
            municipio: s.mun, bien_id: match.id, nombre_actual: match.nombre,
            municipio_bd: match.municipio, // formato BD real ("X (La)")
            qid_nuevo: cand.qid, label_wikidata: cand.label,
            image: cand.image, type: cand.type,
            lat: cand.lat, lng: cand.lng, match_reason: matchReason,
          });
        } else {
          // Para INSERT, usar el formato BD que ya prevalezca para ese municipio
          const munBd = wd2db(s.mun); // siempre el formato BD canónico
          toInsert.push({
            municipio: munBd, qid: cand.qid, label: cand.label,
            image: cand.image, type: cand.type, lat: cand.lat, lng: cand.lng,
          });
        }
      }
    }

    const toInsertConCoords = toInsert.filter((i) => i.lat != null && i.lng != null);
    const toInsertSinCoords = toInsert.filter((i) => i.lat == null || i.lng == null);

    console.log(`\n\n=== A) INSERT (${toInsertConCoords.length}) ===`);
    for (const i of toInsertConCoords) {
      console.log(`  [${i.municipio}] ${i.qid} | ${i.label} | ${i.type} | ${i.lat},${i.lng}${i.image ? ' | IMG' : ''}`);
    }
    console.log(`\n=== B) SIN COORDS (skip, ${toInsertSinCoords.length}) ===`);
    for (const i of toInsertSinCoords) {
      console.log(`  [${i.municipio}] ${i.qid} | ${i.label} | ${i.type}`);
    }
    console.log(`\n=== C) UPDATE QID (${toUpdate.length}) ===`);
    for (const u of toUpdate) {
      console.log(`  [${u.municipio}] bien_id=${u.bien_id} "${u.nombre_actual}" ← ${u.qid_nuevo} "${u.label_wikidata}" (match: ${u.match_reason})${u.image ? ' | IMG' : ''}`);
    }

    const planFile = `./_${zonaKey}_plan.json`;
    fs.writeFileSync(planFile, JSON.stringify({
      zonaKey, comarca: ZONA.comarca, comunidad: ZONA.comunidad, pais: ZONA.pais,
      toInsertConCoords, toInsertSinCoords, toUpdate,
    }, null, 2));
    console.log(`\nPlan en ${planFile}`);
  } finally {
    client.release();
    await p.end();
  }
})();
