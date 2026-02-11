const db = require('./db.cjs');

async function main() {
    const total = (await db.query("SELECT COUNT(*) as c FROM bienes")).rows[0];
    const conCoords = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE latitud IS NOT NULL AND longitud IS NOT NULL")).rows[0];
    const conWiki = (await db.query("SELECT COUNT(DISTINCT b.id) as c FROM bienes b JOIN wikidata w ON b.id=w.bien_id")).rows[0];
    const conDesc = (await db.query("SELECT COUNT(DISTINCT b.id) as c FROM bienes b JOIN wikidata w ON b.id=w.bien_id WHERE w.descripcion IS NOT NULL AND w.descripcion != ''")).rows[0];
    const imgs = (await db.query("SELECT COUNT(*) as c FROM imagenes")).rows[0];
    const conWikipedia = (await db.query("SELECT COUNT(DISTINCT b.id) as c FROM bienes b JOIN wikidata w ON b.id=w.bien_id WHERE w.wikipedia_url IS NOT NULL AND w.wikipedia_url != ''")).rows[0];

    console.log('=== ESTADÍSTICAS FINALES ===');
    console.log(`Total bienes: ${total.c}`);
    console.log(`Con coordenadas: ${conCoords.c} (${(conCoords.c/total.c*100).toFixed(1)}%)`);
    console.log(`Con Wikidata QID: ${conWiki.c}`);
    console.log(`Con descripción: ${conDesc.c}`);
    console.log(`Imágenes totales: ${imgs.c}`);
    console.log(`Con Wikipedia: ${conWikipedia.c}`);
    console.log(`Sin coordenadas: ${total.c - conCoords.c}`);

    // Por país
    const porPais = (await db.query("SELECT pais, COUNT(*) as c, SUM(CASE WHEN latitud IS NOT NULL THEN 1 ELSE 0 END) as coords FROM bienes GROUP BY pais ORDER BY c DESC")).rows;
    console.log('\nPor país:');
    porPais.forEach(r => console.log(`  ${r.pais}: ${r.c} (${r.coords} con coords, ${(r.coords/r.c*100).toFixed(1)}%)`));

    await db.cerrar();
}

main();
