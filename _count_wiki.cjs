const db = require('./db.cjs');

async function main() {
    const conQid = (await db.query("SELECT COUNT(*) as c FROM wikidata WHERE qid IS NOT NULL AND qid != ''")).rows[0];
    const conWiki = (await db.query("SELECT COUNT(*) as c FROM wikidata WHERE wikipedia_url IS NOT NULL AND wikipedia_url != ''")).rows[0];
    const sinWiki = (await db.query("SELECT COUNT(*) as c FROM wikidata WHERE qid IS NOT NULL AND qid != '' AND (wikipedia_url IS NULL OR wikipedia_url = '')")).rows[0];
    console.log('Con QID:', conQid.c);
    console.log('Con Wikipedia:', conWiki.c);
    console.log('Con QID sin Wikipedia:', sinWiki.c);
    await db.cerrar();
}

main();
