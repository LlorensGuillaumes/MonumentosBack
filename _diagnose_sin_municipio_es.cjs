const db = require('./db.cjs');

async function main() {
    console.log('=== Diagnóstico bienes España sin municipio ===\n');

    const total = (await db.query(
        "SELECT COUNT(*)::int as n FROM bienes WHERE pais='España'"
    )).rows[0].n;
    console.log('Total España:', total);

    const sinMuni = (await db.query(
        "SELECT COUNT(*)::int as n FROM bienes WHERE pais='España' AND (municipio IS NULL OR municipio='')"
    )).rows[0].n;
    console.log('Sin municipio:', sinMuni, `(${(100*sinMuni/total).toFixed(1)}%)`);

    const sinCoords = (await db.query(`
        SELECT COUNT(*)::int as n FROM bienes
        WHERE pais='España' AND (municipio IS NULL OR municipio='')
          AND (latitud IS NULL OR longitud IS NULL)
    `)).rows[0].n;
    console.log('\n  ├─ Sin coordenadas:', sinCoords);

    const conCoords = sinMuni - sinCoords;
    console.log('  └─ Con coordenadas pero PIP falló:', conCoords);

    console.log('\n=== Por CCAA (sin municipio) ===');
    const porCCAA = (await db.query(`
        SELECT comunidad_autonoma, COUNT(*)::int as n,
               SUM(CASE WHEN latitud IS NULL OR longitud IS NULL THEN 1 ELSE 0 END)::int as sin_coords,
               SUM(CASE WHEN latitud IS NOT NULL AND longitud IS NOT NULL THEN 1 ELSE 0 END)::int as con_coords
        FROM bienes
        WHERE pais='España' AND (municipio IS NULL OR municipio='')
        GROUP BY comunidad_autonoma
        ORDER BY n DESC
    `)).rows;
    porCCAA.forEach(r => {
        console.log(`  ${(r.comunidad_autonoma||'(null)').padEnd(25)} ${String(r.n).padStart(5)} | sin_coords=${r.sin_coords} con_coords=${r.con_coords}`);
    });

    console.log('\n=== Bounding box de los con coordenadas (rescatables vía PIP) ===');
    const bbox = (await db.query(`
        SELECT
          MIN(latitud)::float as min_lat, MAX(latitud)::float as max_lat,
          MIN(longitud)::float as min_lon, MAX(longitud)::float as max_lon
        FROM bienes
        WHERE pais='España' AND (municipio IS NULL OR municipio='')
          AND latitud IS NOT NULL AND longitud IS NOT NULL
    `)).rows[0];
    console.log(`  lat: ${bbox.min_lat?.toFixed(3)} → ${bbox.max_lat?.toFixed(3)}`);
    console.log(`  lon: ${bbox.min_lon?.toFixed(3)} → ${bbox.max_lon?.toFixed(3)}`);

    const ceutaMelilla = (await db.query(`
        SELECT COUNT(*)::int as n FROM bienes
        WHERE pais='España' AND (municipio IS NULL OR municipio='')
          AND latitud BETWEEN 35.0 AND 36.0
          AND longitud BETWEEN -5.5 AND -2.5
    `)).rows[0].n;
    console.log(`\n  Ceuta/Melilla (lat 35-36, lon -5.5/-2.5): ${ceutaMelilla}`);

    const canarias = (await db.query(`
        SELECT COUNT(*)::int as n FROM bienes
        WHERE pais='España' AND (municipio IS NULL OR municipio='')
          AND latitud BETWEEN 27.0 AND 29.5
          AND longitud BETWEEN -19.0 AND -13.0
    `)).rows[0].n;
    console.log(`  Canarias (lat 27-29.5, lon -19/-13): ${canarias}`);

    console.log('\n=== ¿Cuántos rescatables con buffer 2km al polígono más cercano? ===');
    try {
        const cercanos = (await db.query(`
            WITH sin_muni AS (
                SELECT id, latitud, longitud
                FROM bienes
                WHERE pais='España' AND (municipio IS NULL OR municipio='')
                  AND latitud IS NOT NULL AND longitud IS NOT NULL
            )
            SELECT COUNT(*)::int as n FROM sin_muni s
            WHERE EXISTS (
                SELECT 1 FROM municipios_espana m
                WHERE ST_DWithin(
                  m.geom::geography,
                  ST_SetSRID(ST_MakePoint(s.longitud, s.latitud), 4326)::geography,
                  2000
                )
            )
        `)).rows[0].n;
        console.log(`  Con polígono IGN a <=2km: ${cercanos}`);
    } catch (e) {
        console.log(`  Error: ${e.message}`);
    }

    console.log('\n=== Sample (10 bienes sin municipio) ===');
    const sample = (await db.query(`
        SELECT id, denominacion, comunidad_autonoma, provincia, latitud, longitud
        FROM bienes
        WHERE pais='España' AND (municipio IS NULL OR municipio='')
        ORDER BY RANDOM() LIMIT 10
    `)).rows;
    sample.forEach(r => {
        const coords = (r.latitud && r.longitud) ? `(${r.latitud.toFixed(3)},${r.longitud.toFixed(3)})` : '(sin coords)';
        console.log(`  ${String(r.id).padStart(7)} | ${(r.denominacion||'').slice(0,50).padEnd(50)} | ${(r.comunidad_autonoma||'?').padEnd(20)} | ${coords}`);
    });
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
