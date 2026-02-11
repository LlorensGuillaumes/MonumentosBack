const db = require('./db.cjs');

async function main() {
    // Check: does the wikidata table have duplicate bien_id entries?
    const dupes = (await db.query(`
        SELECT bien_id, COUNT(*) as cnt, STRING_AGG(qid, ', ') as qids
        FROM wikidata
        GROUP BY bien_id
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 20
    `)).rows;
    console.log('Items amb múltiples files a wikidata:', dupes.length);
    dupes.slice(0, 10).forEach(d2 => console.log('  bien_id=' + d2.bien_id + ' rows=' + d2.cnt + ' qids: ' + (d2.qids || '').substring(0, 100)));

    // Check bien_id=31628 (Jaciment ibèric de l'Hostal del Pi in Abrera)
    const rows31628 = (await db.query('SELECT * FROM wikidata WHERE bien_id = 31628')).rows;
    console.log('\nbien_id=31628 rows:', rows31628.length);
    rows31628.forEach(r => console.log('  id=' + r.id + ' qid=' + r.qid + ' wiki=' + (r.wikipedia_url || 'null')));

    // Check total duplicates
    const totalDupes = (await db.query('SELECT COUNT(*) as n FROM (SELECT bien_id FROM wikidata GROUP BY bien_id HAVING COUNT(*) > 1) sub')).rows[0];
    console.log('\nTotal bienes amb files duplicades a wikidata:', totalDupes.n);

    // Check wikidata table schema (PostgreSQL version)
    const schema = (await db.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'wikidata'
        ORDER BY ordinal_position
    `)).rows;
    console.log('\nWikidata table columns:');
    schema.forEach(c => console.log(`  ${c.column_name} (${c.data_type})`));

    await db.cerrar();
}

main();
