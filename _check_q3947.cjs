const { Pool } = require('pg');
require('dotenv').config();

const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } })
    : new Pool({ host: 'localhost', port: 5432, user: 'patrimonio', password: 'patrimonio2026', database: 'patrimonio' });

(async () => {
    const label = process.env.DATABASE_URL ? 'NEON' : 'LOCAL';
    console.log(`=== ${label} ===`);

    const r1 = await pool.query(`
        SELECT b.id, b.denominacion, b.tipo_monumento, w.qid
        FROM bienes b JOIN wikidata w ON b.id = w.bien_id
        WHERE b.denominacion ILIKE ANY(ARRAY['%Cal Ros%', '%Can Panxo%', '%Cal Rossell%', '%Cal Ros del Maiol%', '%Cal Ros Barber%'])
        ORDER BY b.id LIMIT 30
    `);
    console.log(`\nCasas catalanas mencionadas (${r1.rows.length}):`);
    for (const r of r1.rows) console.log(`  [${r.id}] ${r.denominacion} | tipo=${r.tipo_monumento} | qid=${r.qid}`);

    const r2 = await pool.query(`
        SELECT tipo_monumento, COUNT(*) AS n
        FROM bienes
        WHERE tipo_monumento IS NOT NULL
        GROUP BY tipo_monumento
        ORDER BY n DESC LIMIT 25
    `);
    console.log(`\nTop tipos_monumento:`);
    for (const r of r2.rows) console.log(`  ${r.n.toString().padStart(6)}  ${r.tipo_monumento}`);

    const r3 = await pool.query(`
        SELECT COUNT(*) AS n FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE b.tipo_monumento ILIKE '%Castillo%' AND w.qid IS NOT NULL
    `);
    console.log(`\nCastillos con QID: ${r3.rows[0].n}`);

    await pool.end();
})();
