const db = require('./db.cjs');

async function main() {
    const row = (await db.query('SELECT * FROM wikidata WHERE bien_id = 37647')).rows[0];
    console.log('bien_id=37647:', JSON.stringify(row, null, 2));
    console.log('\nHas enrichment:', Boolean(row && (row.wikipedia_url || row.imagen_url || row.descripcion || row.inception)));

    // Check: Q23498980 - how many items, and do they have enrichment data?
    const q23items = (await db.query("SELECT w.id, w.bien_id, w.qid, w.wikipedia_url, w.imagen_url, w.descripcion FROM wikidata w WHERE w.qid = 'Q23498980'")).rows;
    console.log('\nQ23498980 total rows:', q23items.length);
    const withEnrich = q23items.filter(i => i.wikipedia_url || i.imagen_url || i.descripcion);
    console.log('With enrichment:', withEnrich.length);

    // Check: Q98057676 (652 items from Andalucia) - was this from fase2?
    const q98count = (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE qid = 'Q98057676'")).rows[0];
    console.log('\nQ98057676 total rows:', q98count.n);

    await db.cerrar();
}

main();
