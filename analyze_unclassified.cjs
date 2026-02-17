const { Pool, types } = require('pg');
require('dotenv').config();

types.setTypeParser(20, parseInt);

// Use remote Neon database which has tipo_monumento and periodo columns
const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

async function run() {
    try {
        // a) Unclassified by categoria (top 30)
        console.log('=== a) Unclassified (tipo_monumento IS NULL) by CATEGORIA (top 30) ===');
        const a = await pool.query(`
            SELECT categoria, COUNT(*) as n 
            FROM bienes WHERE tipo_monumento IS NULL 
            GROUP BY categoria ORDER BY n DESC LIMIT 30
        `);
        console.table(a.rows);

        // b) Unclassified by tipo (top 30)
        console.log('\n=== b) Unclassified by TIPO (top 30) ===');
        const b = await pool.query(`
            SELECT tipo, COUNT(*) as n 
            FROM bienes WHERE tipo_monumento IS NULL 
            GROUP BY tipo ORDER BY n DESC LIMIT 30
        `);
        console.table(b.rows);

        // c) Unclassified by pais
        console.log('\n=== c) Unclassified by PAIS ===');
        const c = await pool.query(`
            SELECT pais, COUNT(*) as n 
            FROM bienes WHERE tipo_monumento IS NULL 
            GROUP BY pais ORDER BY n DESC
        `);
        console.table(c.rows);

        // d) Sample of 30 unclassified
        console.log('\n=== d) Sample 30 unclassified monuments ===');
        const d = await pool.query(`
            SELECT denominacion, categoria, tipo, clase, pais 
            FROM bienes WHERE tipo_monumento IS NULL 
            ORDER BY RANDOM() LIMIT 30
        `);
        console.table(d.rows);

        // e) Count without periodo by pais
        console.log('\n=== e) Without PERIODO by PAIS ===');
        const e = await pool.query(`
            SELECT pais, COUNT(*) as n 
            FROM bienes WHERE periodo IS NULL 
            GROUP BY pais ORDER BY n DESC
        `);
        console.table(e.rows);

        // f) Sample 30 without periodo but WITH tipo_monumento
        console.log('\n=== f) Sample 30 without periodo (with tipo_monumento) ===');
        const f = await pool.query(`
            SELECT b.denominacion, b.tipo_monumento, w.estilo, b.pais 
            FROM bienes b 
            LEFT JOIN wikidata w ON b.id = w.bien_id 
            WHERE b.periodo IS NULL AND b.tipo_monumento IS NOT NULL 
            ORDER BY RANDOM() LIMIT 30
        `);
        console.table(f.rows);

        // g) Common words in denominacion - Italy unclassified
        console.log('\n=== g) Common words in DENOMINACION - ITALY unclassified (top 40) ===');
        const g = await pool.query(`
            SELECT word, COUNT(*) as n FROM (
                SELECT UNNEST(STRING_TO_ARRAY(LOWER(denominacion), ' ')) as word 
                FROM bienes WHERE tipo_monumento IS NULL AND pais = 'Italia'
            ) t WHERE LENGTH(word) > 3 GROUP BY word ORDER BY n DESC LIMIT 40
        `);
        console.table(g.rows);

        // h) Common words - France unclassified
        console.log('\n=== h) Common words in DENOMINACION - FRANCE unclassified (top 40) ===');
        const h = await pool.query(`
            SELECT word, COUNT(*) as n FROM (
                SELECT UNNEST(STRING_TO_ARRAY(LOWER(denominacion), ' ')) as word 
                FROM bienes WHERE tipo_monumento IS NULL AND pais = 'Francia'
            ) t WHERE LENGTH(word) > 3 GROUP BY word ORDER BY n DESC LIMIT 40
        `);
        console.table(h.rows);

        // i) Common words - Spain unclassified
        console.log('\n=== i) Common words in DENOMINACION - SPAIN unclassified (top 40) ===');
        const i_res = await pool.query(`
            SELECT word, COUNT(*) as n FROM (
                SELECT UNNEST(STRING_TO_ARRAY(LOWER(denominacion), ' ')) as word 
                FROM bienes WHERE tipo_monumento IS NULL AND pais = 'España'
            ) t WHERE LENGTH(word) > 3 GROUP BY word ORDER BY n DESC LIMIT 40
        `);
        console.table(i_res.rows);

        // j) Common words - Portugal unclassified
        console.log('\n=== j) Common words in DENOMINACION - PORTUGAL unclassified (top 40) ===');
        const j = await pool.query(`
            SELECT word, COUNT(*) as n FROM (
                SELECT UNNEST(STRING_TO_ARRAY(LOWER(denominacion), ' ')) as word 
                FROM bienes WHERE tipo_monumento IS NULL AND pais = 'Portugal'
            ) t WHERE LENGTH(word) > 3 GROUP BY word ORDER BY n DESC LIMIT 40
        `);
        console.table(j.rows);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

run();
