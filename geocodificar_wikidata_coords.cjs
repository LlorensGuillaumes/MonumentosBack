/**
 * geocodificar_wikidata_coords.cjs
 * Obtiene coordenadas de Wikidata para items que tienen QID pero no coords en bienes.
 * Consulta SPARQL en lotes de 200 QIDs.
 */

const db = require('./db.cjs');
const axios = require('axios');

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const BATCH_SIZE = 200;
const DELAY_MS = 2000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparqlQuery(query) {
  for (let intento = 0; intento < 3; intento++) {
    try {
      const res = await axios.get(SPARQL_ENDPOINT, {
        params: { query, format: 'json' },
        headers: { 'User-Agent': 'PatrimonioEuropeo/1.0 (geocoding coords)' },
        timeout: 60000,
      });
      return res.data.results.bindings;
    } catch (err) {
      console.log(`  SPARQL error (intento ${intento + 1}/3): ${err.message}`);
      if (intento < 2) await sleep(5000 * (intento + 1));
    }
  }
  return [];
}

async function main() {
  console.log('=== Geocodificación via Wikidata (QIDs sin coordenadas) ===\n');

  // Obtener items sin coords pero con QID
  const items = (await db.query(`
    SELECT b.id, w.qid
    FROM bienes b
    JOIN wikidata w ON b.id = w.bien_id
    WHERE (b.latitud IS NULL OR b.longitud IS NULL)
    AND w.qid IS NOT NULL AND w.qid != ''
  `)).rows;

  console.log(`Items sin coords con QID: ${items.length}\n`);

  if (items.length === 0) {
    console.log('Nada que hacer.');
    await db.cerrar();
    return;
  }

  // Crear mapa QID -> bien_ids (un QID puede estar en varios bienes)
  const qidToBienIds = new Map();
  for (const item of items) {
    if (!qidToBienIds.has(item.qid)) qidToBienIds.set(item.qid, []);
    qidToBienIds.get(item.qid).push(item.id);
  }

  const uniqueQids = [...qidToBienIds.keys()];
  console.log(`QIDs únicos: ${uniqueQids.length}`);

  let totalUpdated = 0;
  let totalBatches = Math.ceil(uniqueQids.length / BATCH_SIZE);

  for (let i = 0; i < uniqueQids.length; i += BATCH_SIZE) {
    const batch = uniqueQids.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const values = batch.map(q => `wd:${q}`).join(' ');
    const query = `
      SELECT ?item ?lat ?lon WHERE {
        VALUES ?item { ${values} }
        ?item wdt:P625 ?coords .
        BIND(geof:latitude(?coords) AS ?lat)
        BIND(geof:longitude(?coords) AS ?lon)
      }
    `;

    process.stdout.write(`[Lote ${batchNum}/${totalBatches}] ${batch.length} QIDs...`);

    const results = await sparqlQuery(query);

    let batchUpdated = 0;
    await db.transaction(async (client) => {
      for (const row of results) {
        if (!row.item || !row.lat || !row.lon) continue;
        const qid = row.item.value.replace('http://www.wikidata.org/entity/', '');
        const lat = parseFloat(row.lat.value);
        const lon = parseFloat(row.lon.value);

        if (isNaN(lat) || isNaN(lon)) continue;

        const bienIds = qidToBienIds.get(qid) || [];
        for (const bienId of bienIds) {
          await client.query('UPDATE bienes SET latitud = $1, longitud = $2 WHERE id = $3', [lat, lon, bienId]);
          batchUpdated++;
        }
      }
    });

    totalUpdated += batchUpdated;

    console.log(` ${results.length} coords encontradas, ${batchUpdated} bienes actualizados`);

    if (i + BATCH_SIZE < uniqueQids.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n=== RESULTADO ===`);
  console.log(`Total bienes actualizados con coordenadas: ${totalUpdated}`);

  // Verificar estado final
  const remaining = (await db.query(`
    SELECT COUNT(*) as c FROM bienes WHERE latitud IS NULL OR longitud IS NULL
  `)).rows[0];
  console.log(`Items restantes sin coords: ${remaining.c}`);

  await db.cerrar();
}

main().catch(err => { console.error(err); process.exit(1); });
