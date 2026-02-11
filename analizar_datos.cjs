/**
 * Análisis de calidad de datos
 */

const db = require('./db.cjs');

async function ejecutar() {
    console.log('=== ANÁLISIS DE CALIDAD DE DATOS ===\n');

    // 1. Items por CCAA con % de coordenadas
    console.log('1. COORDENADAS POR CCAA:');
    const coordsPorCCAA = (await db.query(`
        SELECT comunidad_autonoma,
               COUNT(*) as total,
               SUM(CASE WHEN latitud IS NOT NULL THEN 1 ELSE 0 END) as con_coords,
               ROUND(100.0 * SUM(CASE WHEN latitud IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
        FROM bienes
        GROUP BY comunidad_autonoma
        ORDER BY total DESC
    `)).rows;
    coordsPorCCAA.forEach(r => {
        const faltan = r.total - r.con_coords;
        console.log(`  ${r.comunidad_autonoma}: ${r.con_coords}/${r.total} (${r.pct}%) - faltan ${faltan}`);
    });

    // 2. Items por CCAA con % de Wikidata
    console.log('\n2. WIKIDATA QID POR CCAA:');
    const wikiPorCCAA = (await db.query(`
        SELECT b.comunidad_autonoma,
               COUNT(b.id) as total,
               SUM(CASE WHEN w.qid IS NOT NULL THEN 1 ELSE 0 END) as con_wiki,
               ROUND(100.0 * SUM(CASE WHEN w.qid IS NOT NULL THEN 1 ELSE 0 END) / COUNT(b.id), 1) as pct
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        GROUP BY b.comunidad_autonoma
        ORDER BY total DESC
    `)).rows;
    wikiPorCCAA.forEach(r => {
        console.log(`  ${r.comunidad_autonoma}: ${r.con_wiki}/${r.total} (${r.pct}%)`);
    });

    // 3. Imágenes por fuente
    console.log('\n3. IMÁGENES POR FUENTE:');
    const imgPorFuente = (await db.query(`
        SELECT fuente, COUNT(*) as n FROM imagenes GROUP BY fuente ORDER BY n DESC
    `)).rows;
    imgPorFuente.forEach(r => console.log(`  ${r.fuente}: ${r.n.toLocaleString()}`));

    // 4. Items sin imágenes
    const totalBienes = (await db.query('SELECT COUNT(*) as n FROM bienes')).rows[0].n;
    const conImg = (await db.query('SELECT COUNT(DISTINCT bien_id) as n FROM imagenes')).rows[0].n;
    const sinImg = totalBienes - conImg;
    console.log(`\n4. IMÁGENES: ${conImg.toLocaleString()} bienes con imagen / ${sinImg.toLocaleString()} sin imagen`);

    // 5. Items con descripción
    const conDesc = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE descripcion IS NOT NULL')).rows[0].n;
    const sinDesc = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE descripcion IS NULL')).rows[0].n;
    console.log(`\n5. DESCRIPCIONES WIKIDATA: ${conDesc.toLocaleString()} con / ${sinDesc.toLocaleString()} sin`);

    // 6. Categorías más comunes
    console.log('\n6. CATEGORÍAS MÁS COMUNES:');
    const categorias = (await db.query(`
        SELECT categoria, COUNT(*) as n FROM bienes GROUP BY categoria ORDER BY n DESC LIMIT 15
    `)).rows;
    categorias.forEach(r => console.log(`  ${r.categoria || '(sin categoría)'}: ${r.n.toLocaleString()}`));

    // 7. Items con Wikipedia
    const conWiki = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE wikipedia_url IS NOT NULL')).rows[0].n;
    console.log(`\n7. CON ARTÍCULO WIKIPEDIA: ${conWiki.toLocaleString()}`);

    // 8. Items con Commons Category
    const conCommons = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE commons_category IS NOT NULL')).rows[0].n;
    console.log(`8. CON COMMONS CATEGORY: ${conCommons.toLocaleString()}`);

    // 9. Estilos arquitectónicos
    console.log('\n9. ESTILOS ARQUITECTÓNICOS (top 15):');
    const estilos = (await db.query(`
        SELECT estilo, COUNT(*) as n FROM wikidata WHERE estilo IS NOT NULL GROUP BY estilo ORDER BY n DESC LIMIT 15
    `)).rows;
    estilos.forEach(r => console.log(`  ${r.estilo}: ${r.n.toLocaleString()}`));

    // 10. Siglos (inception)
    console.log('\n10. ÉPOCAS DE CONSTRUCCIÓN:');
    const conInception = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE inception IS NOT NULL')).rows[0].n;
    console.log(`  Items con fecha de construcción: ${conInception.toLocaleString()}`);

    // 11. Provincias más representadas
    console.log('\n11. PROVINCIAS (top 15):');
    const provincias = (await db.query(`
        SELECT provincia, COUNT(*) as n FROM bienes WHERE provincia IS NOT NULL GROUP BY provincia ORDER BY n DESC LIMIT 15
    `)).rows;
    provincias.forEach(r => console.log(`  ${r.provincia}: ${r.n.toLocaleString()}`));

    // 12. Municipios con más bienes
    console.log('\n12. MUNICIPIOS (top 15):');
    const municipios = (await db.query(`
        SELECT municipio, COUNT(*) as n FROM bienes WHERE municipio IS NOT NULL GROUP BY municipio ORDER BY n DESC LIMIT 15
    `)).rows;
    municipios.forEach(r => console.log(`  ${r.municipio}: ${r.n.toLocaleString()}`));

    // 13. CCAA sin Wikidata QID
    console.log('\n13. BIENES SIN WIKIDATA (por CCAA):');
    const sinWikiPorCCAA = (await db.query(`
        SELECT b.comunidad_autonoma, COUNT(*) as n
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid IS NULL
        GROUP BY b.comunidad_autonoma
        ORDER BY n DESC
    `)).rows;
    sinWikiPorCCAA.forEach(r => console.log(`  ${r.comunidad_autonoma}: ${r.n.toLocaleString()}`));

    await db.cerrar();
}

ejecutar().catch(console.error);
