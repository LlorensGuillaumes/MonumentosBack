/**
 * Enriquece las 674 rutas con datos geográficos desde Wikidata:
 * - P625 coords directos del ítem
 * - P1427 start point → P625 de ese ítem
 * - P1444 destination → P625
 * - P527 has part → P625 de cada parte
 *
 * Luego determina un "centro" y "bbox" por ruta, y matchea con tus bienes
 * para contar cuántas paradas potenciales tiene cada ruta.
 */
const axios = require('axios');
const fs = require('fs');
const { Pool, types } = require('pg');

types.setTypeParser(20, parseInt);

const rutasRaw = require('./tmp_rutas_wikidata.json');
// Dedupe por qid
const seen = new Set();
const rutas = [];
for (const r of rutasRaw) {
    if (seen.has(r.qid)) continue;
    seen.add(r.qid);
    rutas.push(r);
}
console.log('Rutas únicas a procesar:', rutas.length);

const SPARQL = 'https://query.wikidata.org/sparql';
const HEAD = { 'User-Agent': 'PatrimonioEuropeo/1.0', 'Accept': 'application/sparql-results+json' };

async function sparql(q) {
    const r = await axios.get(SPARQL, { params: { query: q, format: 'json' }, headers: HEAD, timeout: 120000 });
    return r.data.results.bindings;
}

function parseCoord(wkt) {
    // "Point(-3.41 40.12)" → [lat, lng]
    const m = wkt?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (!m) return null;
    return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
}

async function enrichBatch(qids) {
    // VALUES para queryar varias rutas de golpe
    const values = qids.map(q => `wd:${q}`).join(' ');
    const query = `
        SELECT ?ruta ?coord ?start ?startCoord ?end ?endCoord WHERE {
          VALUES ?ruta { ${values} }
          OPTIONAL { ?ruta wdt:P625 ?coord . }
          OPTIONAL { ?ruta wdt:P1427 ?start . ?start wdt:P625 ?startCoord . }
          OPTIONAL { ?ruta wdt:P1444 ?end . ?end wdt:P625 ?endCoord . }
        }
    `;
    return sparql(query);
}

async function waypointsBatch(qids) {
    const values = qids.map(q => `wd:${q}`).join(' ');
    const query = `
        SELECT ?ruta ?parte ?parteLabel ?parteCoord WHERE {
          VALUES ?ruta { ${values} }
          ?ruta wdt:P527 ?parte .
          ?parte wdt:P625 ?parteCoord .
          SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,it,fr,pt". }
        }
    `;
    return sparql(query);
}

async function main() {
    console.log('\n=== 1. Enriqueciendo coords de ruta + start/end ===');
    const BATCH = 60;
    const geo = new Map(); // qid -> { coord, start, end }
    for (let i = 0; i < rutas.length; i += BATCH) {
        const slice = rutas.slice(i, i + BATCH);
        const qids = slice.map(r => r.qid);
        let rows;
        try {
            rows = await enrichBatch(qids);
        } catch (e) {
            console.log('  batch ' + i + ' ERR: ' + e.message);
            continue;
        }
        for (const row of rows) {
            const qid = row.ruta.value.split('/').pop();
            const cur = geo.get(qid) || {};
            if (row.coord) cur.coord = parseCoord(row.coord.value);
            if (row.startCoord) cur.start = parseCoord(row.startCoord.value);
            if (row.endCoord) cur.end = parseCoord(row.endCoord.value);
            geo.set(qid, cur);
        }
        process.stdout.write(`  ${Math.min(i + BATCH, rutas.length)}/${rutas.length}\r`);
    }
    console.log('\n  Rutas con algún dato geo:', [...geo.values()].filter(g => g.coord || g.start || g.end).length);

    console.log('\n=== 2. Enriqueciendo waypoints (P527 con coords) ===');
    const wpts = new Map(); // qid -> [{qid, label, coord}]
    for (let i = 0; i < rutas.length; i += BATCH) {
        const slice = rutas.slice(i, i + BATCH);
        const qids = slice.map(r => r.qid);
        let rows;
        try {
            rows = await waypointsBatch(qids);
        } catch (e) {
            console.log('  batch ' + i + ' ERR');
            continue;
        }
        for (const row of rows) {
            const qid = row.ruta.value.split('/').pop();
            if (!wpts.has(qid)) wpts.set(qid, []);
            wpts.get(qid).push({
                qid: row.parte.value.split('/').pop(),
                label: row.parteLabel?.value,
                coord: parseCoord(row.parteCoord.value),
            });
        }
        process.stdout.write(`  ${Math.min(i + BATCH, rutas.length)}/${rutas.length}\r`);
    }
    console.log('\n  Rutas con waypoints P527:', wpts.size);

    // Combinar
    console.log('\n=== 3. Calculando centro y bbox por ruta ===');
    const enriched = [];
    for (const r of rutas) {
        const g = geo.get(r.qid) || {};
        const ws = wpts.get(r.qid) || [];
        const pts = [];
        if (g.coord) pts.push({ type: 'centro', ...g.coord });
        if (g.start) pts.push({ type: 'start', ...g.start });
        if (g.end) pts.push({ type: 'end', ...g.end });
        ws.forEach(w => pts.push({ type: 'wpt', ...w.coord, label: w.label, qid: w.qid }));

        if (pts.length === 0) continue;

        const lats = pts.map(p => p.lat);
        const lngs = pts.map(p => p.lng);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const centroLat = (minLat + maxLat) / 2;
        const centroLng = (minLng + maxLng) / 2;
        const spanLatKm = (maxLat - minLat) * 111;
        const spanLngKm = (maxLng - minLng) * 111 * Math.cos(centroLat * Math.PI / 180);

        enriched.push({
            ...r,
            points: pts,
            centroLat, centroLng,
            bbox: { minLat, maxLat, minLng, maxLng },
            spanLatKm, spanLngKm,
            spanMaxKm: Math.max(spanLatKm, spanLngKm),
            waypointsConCoord: ws,
        });
    }
    console.log('  Rutas con geometría:', enriched.length);

    fs.writeFileSync('./tmp_rutas_geo.json', JSON.stringify(enriched, null, 2));
    console.log('  → tmp_rutas_geo.json');
}

main().catch(e => { console.error(e.message); process.exit(1); });
