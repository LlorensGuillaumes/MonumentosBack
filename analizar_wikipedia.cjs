/**
 * Analiza URLs de Wikipedia y descripciones
 */

const db = require('./db.cjs');

async function ejecutar() {
    // Ver URLs que no son es.wikipedia
    console.log('URLs que no son es.wikipedia:');
    const otros = (await db.query(`
        SELECT wikipedia_url
        FROM wikidata
        WHERE wikipedia_url IS NOT NULL
          AND wikipedia_url NOT LIKE '%es.wikipedia%'
          AND wikipedia_url NOT LIKE '%ca.wikipedia%'
          AND wikipedia_url NOT LIKE '%en.wikipedia%'
        LIMIT 15
    `)).rows;
    otros.forEach(r => console.log('  ' + r.wikipedia_url));

    // Ver cuántos tienen descripción genérica
    console.log('\nDescripciones más comunes:');
    const genericas = (await db.query(`
        SELECT descripcion, COUNT(*) as n
        FROM wikidata
        WHERE descripcion IS NOT NULL
        GROUP BY descripcion
        ORDER BY n DESC
        LIMIT 15
    `)).rows;
    genericas.forEach(r => console.log(`  [${r.n}] ${(r.descripcion || '').substring(0, 70)}`));

    // Contar items con Wikipedia pero sin descripción útil
    const sinDescUtil = (await db.query(`
        SELECT COUNT(*) as n
        FROM wikidata
        WHERE wikipedia_url IS NOT NULL
          AND (descripcion IS NULL
               OR descripcion = 'bien de interés cultural'
               OR descripcion ILIKE 'bien de interés cultural %'
               OR LENGTH(descripcion) < 30)
    `)).rows[0].n;
    console.log(`\nItems con Wikipedia pero sin descripción útil: ${sinDescUtil}`);

    // Por idioma de Wikipedia
    console.log('\nURLs por idioma:');
    const idiomas = (await db.query(`
        SELECT
            SUBSTRING(wikipedia_url FROM 9 FOR POSITION('.' IN SUBSTRING(wikipedia_url FROM 9)) - 1) as lang,
            COUNT(*) as n
        FROM wikidata
        WHERE wikipedia_url IS NOT NULL
        GROUP BY lang
        ORDER BY n DESC
        LIMIT 10
    `)).rows;
    idiomas.forEach(r => console.log(`  ${r.lang}: ${r.n}`));

    await db.cerrar();
}

ejecutar().catch(console.error);
