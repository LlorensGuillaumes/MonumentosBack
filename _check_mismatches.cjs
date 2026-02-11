const db = require('./db.cjs');

async function main() {
    // Top QIDs en múltiples municipios
    const example = (await db.query(`
        SELECT w.qid, COUNT(DISTINCT b.municipio) as munis, COUNT(*) as items,
               STRING_AGG(DISTINCT b.municipio, ',') as municipios
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid IS NOT NULL
        GROUP BY w.qid
        HAVING COUNT(DISTINCT b.municipio) > 1
        ORDER BY items DESC
        LIMIT 10
    `)).rows;

    console.log('=== Top 10 QIDs en múltiples municipios ===');
    example.forEach(e => {
        console.log(`  ${e.qid} (${e.items} items, ${e.munis} munis): ${e.municipios.substring(0, 120)}`);
    });

    // Detalle de Q47170044
    console.log('\n=== Detalle Q47170044 ===');
    const detail = (await db.query(`
        SELECT b.id, b.denominacion, b.municipio, b.provincia, w.qid, w.wikipedia_url
        FROM bienes b JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid = 'Q47170044'
    `)).rows;
    detail.forEach(r => console.log(`  id=${r.id} | ${r.denominacion} | muni=${r.municipio} | wiki=${(r.wikipedia_url || 'null').substring(0, 80)}`));

    // Detalle de Q21077255
    console.log('\n=== Detalle Q21077255 ===');
    const detail2 = (await db.query(`
        SELECT b.id, b.denominacion, b.municipio, b.provincia, w.qid, w.wikipedia_url
        FROM bienes b JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid = 'Q21077255'
    `)).rows;
    detail2.forEach(r => console.log(`  id=${r.id} | ${r.denominacion} | muni=${r.municipio} | wiki=${(r.wikipedia_url || 'null').substring(0, 80)}`));

    // También: QIDs con coordenadas a >20km
    console.log('\n=== Items con coordenadas WD a >20km ===');
    const items = (await db.query(`
        SELECT b.id, b.denominacion, b.municipio, b.latitud as lat, b.longitud as lon,
               w.qid, w.raw_json
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid IS NOT NULL AND w.raw_json IS NOT NULL AND b.latitud IS NOT NULL
    `)).rows;

    function haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    let farItems = [];
    for (const item of items) {
        try {
            const json = JSON.parse(item.raw_json);
            const coordStr = json.coord?.value;
            if (coordStr) {
                const match = coordStr.match(/Point\(([^ ]+) ([^ ]+)\)/);
                if (match) {
                    const wdLon = parseFloat(match[1]);
                    const wdLat = parseFloat(match[2]);
                    const dist = haversineKm(item.lat, item.lon, wdLat, wdLon);
                    if (dist > 20) {
                        farItems.push({ ...item, dist: dist.toFixed(1), wdLat, wdLon });
                    }
                }
            }
        } catch(e) {}
    }

    farItems.forEach(f => {
        console.log(`  id=${f.id} | ${f.denominacion} | ${f.municipio} | ${f.qid} | dist=${f.dist}km`);
    });

    // Stats por CCAA de items con QID
    console.log('\n=== Items con QID por CCAA ===');
    const byCCAA = (await db.query(`
        SELECT b.comunidad_autonoma, COUNT(*) as total,
               SUM(CASE WHEN w.wikipedia_url IS NOT NULL AND w.wikipedia_url NOT LIKE '%wikidata.org%' THEN 1 ELSE 0 END) as con_wiki
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid IS NOT NULL
        GROUP BY b.comunidad_autonoma
        ORDER BY total DESC
    `)).rows;
    byCCAA.forEach(r => console.log(`  ${r.comunidad_autonoma}: ${r.total} con QID, ${r.con_wiki} con Wikipedia`));

    await db.cerrar();
}

main();
