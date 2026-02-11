/**
 * Analiza items sin coordenadas
 */

const db = require('./db.cjs');

async function ejecutar() {
    console.log('=== ITEMS SIN COORDENADAS ===\n');

    // Por CCAA
    console.log('1. POR CCAA:');
    const porCCAA = (await db.query(`
        SELECT comunidad_autonoma,
               COUNT(*) as total,
               SUM(CASE WHEN municipio IS NOT NULL THEN 1 ELSE 0 END) as con_mun,
               SUM(CASE WHEN provincia IS NOT NULL THEN 1 ELSE 0 END) as con_prov
        FROM bienes
        WHERE latitud IS NULL
        GROUP BY comunidad_autonoma
        ORDER BY total DESC
    `)).rows;
    porCCAA.forEach(r => {
        console.log(`  ${r.comunidad_autonoma}: ${r.total} (mun: ${r.con_mun}, prov: ${r.con_prov})`);
    });

    // Ejemplos de Andalucía sin coords y sin municipio
    console.log('\n2. EJEMPLOS ANDALUCÍA SIN COORDS NI MUNICIPIO:');
    const ejemplos = (await db.query(`
        SELECT denominacion, categoria, codigo_fuente
        FROM bienes
        WHERE comunidad_autonoma = 'Andalucia'
          AND latitud IS NULL
          AND municipio IS NULL
        LIMIT 10
    `)).rows;
    ejemplos.forEach(r => {
        console.log(`  ${r.denominacion} [${r.categoria}] (${r.codigo_fuente})`);
    });

    // Ejemplos de Illes Balears sin coords
    console.log('\n3. EJEMPLOS ILLES BALEARS SIN COORDS:');
    const baleares = (await db.query(`
        SELECT denominacion, municipio, provincia
        FROM bienes
        WHERE comunidad_autonoma = 'Illes Balears'
          AND latitud IS NULL
        LIMIT 10
    `)).rows;
    baleares.forEach(r => {
        console.log(`  ${r.denominacion} - ${r.municipio} (${r.provincia})`);
    });

    // Cuántos de Andalucía sin coords tienen codigo_fuente (ID de IAPH)?
    const iaph = (await db.query(`
        SELECT COUNT(*) as n
        FROM bienes
        WHERE comunidad_autonoma = 'Andalucia'
          AND latitud IS NULL
          AND codigo_fuente IS NOT NULL
          AND codigo_fuente NOT LIKE 'Q%'
    `)).rows[0];
    console.log(`\n4. ANDALUCÍA SIN COORDS CON ID IAPH: ${iaph.n}`);

    // Ver ejemplos de estos IDs
    console.log('\n5. EJEMPLOS IDS IAPH SIN COORDS:');
    const iaphEj = (await db.query(`
        SELECT codigo_fuente, denominacion
        FROM bienes
        WHERE comunidad_autonoma = 'Andalucia'
          AND latitud IS NULL
          AND codigo_fuente IS NOT NULL
          AND codigo_fuente NOT LIKE 'Q%'
        LIMIT 5
    `)).rows;
    iaphEj.forEach(r => {
        console.log(`  ${r.codigo_fuente}: ${r.denominacion}`);
    });

    await db.cerrar();
}

ejecutar().catch(console.error);
