/**
 * Analiza items de Andalucía sin Wikidata
 */

const db = require('./db.cjs');

async function ejecutar() {
    // Cuántos items de Andalucía sin Wikidata tienen municipio?
    const stats = (await db.query(`
        SELECT
            SUM(CASE WHEN b.municipio IS NOT NULL THEN 1 ELSE 0 END) as con_mun,
            SUM(CASE WHEN b.municipio IS NULL THEN 1 ELSE 0 END) as sin_mun,
            SUM(CASE WHEN b.provincia IS NOT NULL THEN 1 ELSE 0 END) as con_prov,
            COUNT(*) as total
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.comunidad_autonoma = 'Andalucia' AND w.qid IS NULL
    `)).rows[0];

    console.log('Items Andalucía SIN Wikidata:');
    console.log('  Total:', stats.total);
    console.log('  Con municipio:', stats.con_mun);
    console.log('  Sin municipio:', stats.sin_mun);
    console.log('  Con provincia:', stats.con_prov);

    // Ver distribución por categoría
    console.log('\nPor categoría:');
    const porCat = (await db.query(`
        SELECT b.categoria, COUNT(*) as n
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.comunidad_autonoma = 'Andalucia' AND w.qid IS NULL
        GROUP BY b.categoria
        ORDER BY n DESC
        LIMIT 10
    `)).rows;
    porCat.forEach(r => console.log(`  ${r.categoria || '(sin)'}: ${r.n}`));

    // Cuántos items de DIBA (Catalunya) tienen categoría inferible del tipo?
    console.log('\n\nItems Catalunya (DIBA) por tipologia:');
    const dibaTipos = (await db.query(`
        SELECT tipo, COUNT(*) as n
        FROM bienes
        WHERE comunidad_autonoma = 'Catalunya' AND tipo IS NOT NULL
        GROUP BY tipo
        ORDER BY n DESC
        LIMIT 15
    `)).rows;
    dibaTipos.forEach(r => console.log(`  ${r.tipo}: ${r.n}`));

    await db.cerrar();
}

ejecutar().catch(console.error);
