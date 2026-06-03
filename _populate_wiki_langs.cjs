// Cuenta cuántos idiomas Wikipedia tiene cada bien y lo guarda en
// columna wikidata.wiki_lang_count. Es proxy de popularidad/relevancia.
// Run en local con todos los DATABASE_URL_ENRICHMENT_* configurados.

const db = require('./db.cjs');

const LANGS = ['es', 'ca', 'en', 'fr', 'it', 'pt', 'gl', 'eu'];

async function main() {
    console.log('=== Populate wiki_lang_count ===\n');

    // 1) Crear columna si no existe
    await db.query(`ALTER TABLE wikidata ADD COLUMN IF NOT EXISTS wiki_lang_count INTEGER DEFAULT 0`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_wd_lang_count ON wikidata(wiki_lang_count DESC)`);

    // 2) Contar por bien_id en un Map
    const counts = new Map();
    for (const lang of LANGS) {
        const pool = db.getEnrichmentPool(lang);
        if (!pool) { console.log(`  ${lang}: pool no configurado`); continue; }
        try {
            const r = await pool.query(
                `SELECT DISTINCT bien_id FROM wikipedia_extracts WHERE bien_id IS NOT NULL`
            );
            console.log(`  ${lang}: ${r.rows.length} bienes con artículo`);
            for (const row of r.rows) {
                counts.set(row.bien_id, (counts.get(row.bien_id) || 0) + 1);
            }
        } catch (e) {
            console.log(`  ${lang}: error ${e.message}`);
        }
    }
    console.log(`\nTotal bienes con al menos un artículo: ${counts.size}`);

    // 3) Distribución
    const dist = { '1': 0, '2-3': 0, '4-5': 0, '6+': 0 };
    counts.forEach(v => {
        if (v === 1) dist['1']++;
        else if (v <= 3) dist['2-3']++;
        else if (v <= 5) dist['4-5']++;
        else dist['6+']++;
    });
    console.log('Distribución idiomas/bien:');
    Object.entries(dist).forEach(([k, v]) => console.log(`  ${k} idiomas: ${v}`));

    // 4) UPDATE batch en wikidata.wiki_lang_count
    console.log('\nActualizando wikidata.wiki_lang_count...');
    // Reset primero
    await db.query(`UPDATE wikidata SET wiki_lang_count = 0 WHERE wiki_lang_count > 0`);
    const entries = Array.from(counts.entries());
    let done = 0;
    for (let i = 0; i < entries.length; i += 500) {
        const chunk = entries.slice(i, i + 500);
        // Build VALUES list
        const values = chunk.map((_, j) => `($${2*j+1}::int, $${2*j+2}::int)`).join(',');
        const params = chunk.flatMap(([bid, n]) => [bid, n]);
        await db.query(`
            UPDATE wikidata w SET wiki_lang_count = v.n
            FROM (VALUES ${values}) AS v(bid, n)
            WHERE w.bien_id = v.bid
        `, params);
        done += chunk.length;
        if (i % 2500 === 0) console.log(`  ${done}/${entries.length}`);
    }

    const s = (await db.query(`
        SELECT COUNT(*)::int as total,
               COUNT(*) FILTER (WHERE wiki_lang_count >= 4)::int as muy_pop,
               COUNT(*) FILTER (WHERE wiki_lang_count >= 6)::int as top_pop
        FROM wikidata WHERE wiki_lang_count > 0
    `)).rows[0];
    console.log(`\nFinal: ${s.total} bienes con wiki_lang_count > 0`);
    console.log(`  >=4 idiomas (muy populares): ${s.muy_pop}`);
    console.log(`  >=6 idiomas (top): ${s.top_pop}`);

    // 5) Verificación visual con sospechosos
    console.log('\n=== Comprobación: Aragón hitos vs no-hitos ===');
    const test = await db.query(`
        SELECT b.id, b.denominacion, b.municipio, w.wiki_lang_count
        FROM bienes b JOIN wikidata w ON w.bien_id = b.id
        WHERE LOWER(b.denominacion) LIKE '%loarre%'
           OR LOWER(b.denominacion) LIKE '%piedra%' AND LOWER(b.denominacion) LIKE '%monasterio%'
           OR LOWER(b.denominacion) LIKE '%veruela%' AND LOWER(b.denominacion) LIKE '%real%'
           OR LOWER(b.denominacion) LIKE '%san juan de la pe%' AND LOWER(b.denominacion) LIKE '%real%'
           OR LOWER(b.denominacion) LIKE '%albarrac%' AND LOWER(b.denominacion) LIKE '%conjunto%'
           OR LOWER(b.denominacion) LIKE '%tarazona%' AND LOWER(b.denominacion) LIKE '%catedral%'
           OR LOWER(b.denominacion) LIKE '%aljafer%'
           OR LOWER(b.denominacion) LIKE '%castillo-palacio de paules%'
           OR LOWER(b.denominacion) LIKE '%castillo de la corona%'
           OR LOWER(b.denominacion) LIKE '%castillo de gañarul%'
        ORDER BY w.wiki_lang_count DESC NULLS LAST
        LIMIT 15
    `);
    test.rows.forEach(r => console.log(`  ${String(r.wiki_lang_count || 0).padStart(2)} idiomas | ${r.denominacion.slice(0,50).padEnd(50)} | ${r.municipio}`));

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
