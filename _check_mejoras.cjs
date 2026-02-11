const db = require('./db.cjs');

async function main() {
    // Andalucía sin coords
    const andSinCoords = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL)")).rows[0];
    const andConQid = (await db.query("SELECT COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id=w.bien_id WHERE b.comunidad_autonoma='Andalucia' AND (b.latitud IS NULL OR b.longitud IS NULL)")).rows[0];
    const andTotal = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia'")).rows[0];

    // Catalunya sin Wikidata
    const catTotal = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Catalunya'")).rows[0];
    const catConWiki = (await db.query("SELECT COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id=w.bien_id WHERE b.comunidad_autonoma='Catalunya'")).rows[0];

    // Francia
    const fraTotal = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE pais='Francia'")).rows[0];
    const fraConWiki = (await db.query("SELECT COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id=w.bien_id WHERE b.pais='Francia'")).rows[0];
    const fraSinCoords = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE pais='Francia' AND (latitud IS NULL OR longitud IS NULL)")).rows[0];

    // General sin coords
    const totalSinCoords = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE latitud IS NULL OR longitud IS NULL")).rows[0];
    const conMuni = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE (latitud IS NULL OR longitud IS NULL) AND municipio IS NOT NULL AND municipio != ''")).rows[0];

    // Andalucía sin coords: desglose por si tienen municipio
    const andSinCoordsConMuni = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL) AND municipio IS NOT NULL AND municipio != ''")).rows[0];

    // Cuántos items sin coords tienen QID con coords en wikidata?
    const sinCoordsConQidYCoords = (await db.query(`
      SELECT COUNT(*) as c FROM bienes b
      JOIN wikidata w ON b.id = w.bien_id
      WHERE (b.latitud IS NULL OR b.longitud IS NULL)
    `)).rows[0];

    console.log('=== ANDALUCIA ===');
    console.log('Total:', andTotal.c);
    console.log('Sin coords:', andSinCoords.c);
    console.log('Sin coords + con QID:', andConQid.c, '(podrían obtener coords de Wikidata)');
    console.log('Sin coords + con municipio:', andSinCoordsConMuni.c, '(podrían geocodificarse)');

    console.log('\n=== CATALUNYA ===');
    console.log('Total:', catTotal.c);
    console.log('Con Wikidata:', catConWiki.c);
    console.log('Sin Wikidata:', catTotal.c - catConWiki.c);

    console.log('\n=== FRANCIA ===');
    console.log('Total:', fraTotal.c);
    console.log('Con Wikidata:', fraConWiki.c);
    console.log('Sin coords:', fraSinCoords.c);

    console.log('\n=== GENERAL ===');
    console.log('Total sin coords:', totalSinCoords.c);
    console.log('Sin coords + con municipio:', conMuni.c);
    console.log('Sin coords + con QID:', sinCoordsConQidYCoords.c);

    // Top 5 CCAA con más items sin coords
    const porCCAA = (await db.query(`
      SELECT comunidad_autonoma, pais, COUNT(*) as c
      FROM bienes
      WHERE latitud IS NULL OR longitud IS NULL
      GROUP BY pais, comunidad_autonoma
      ORDER BY c DESC
      LIMIT 10
    `)).rows;
    console.log('\n=== TOP 10 REGIONES SIN COORDS ===');
    porCCAA.forEach(r => console.log(`  ${r.pais} / ${r.comunidad_autonoma}: ${r.c}`));

    await db.cerrar();
}

main();
