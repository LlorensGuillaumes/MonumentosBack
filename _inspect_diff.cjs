/**
 * Inspecciona diferencias de schema y conteos entre Local y Neon.
 * Solo lectura.
 */
require('dotenv').config();
const { Pool } = require('pg');

const neon = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

const local = new Pool({
    host: 'localhost',
    port: 5433,
    user: process.env.PGUSER || 'patrimonio',
    password: process.env.PGPASSWORD || 'patrimonio2026',
    database: process.env.PGDATABASE || 'patrimonio',
});

async function listTables(pool) {
    const r = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    );
    return r.rows.map(r => r.table_name);
}

async function count(pool, table) {
    try {
        const r = await pool.query('SELECT COUNT(*)::int AS c FROM ' + table);
        return r.rows[0].c;
    } catch (e) {
        return 'NO_EXISTE';
    }
}

async function columns(pool, table) {
    const r = await pool.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
        [table]
    );
    return r.rows;
}

async function main() {
    console.log('=== Tablas ===');
    const localTables = await listTables(local);
    const neonTables = await listTables(neon);
    const all = Array.from(new Set([...localTables, ...neonTables])).sort();

    console.log('Tabla'.padEnd(35) + 'Local'.padEnd(15) + 'Neon');
    console.log('-'.repeat(70));
    for (const t of all) {
        const inL = localTables.includes(t);
        const inN = neonTables.includes(t);
        const cL = inL ? await count(local, t) : '-';
        const cN = inN ? await count(neon, t) : '-';
        const mark = (!inN && inL) ? ' <- SOLO LOCAL' : (!inL && inN) ? ' <- SOLO NEON' : (cL !== cN ? ' <- DIFF' : '');
        console.log(t.padEnd(35) + String(cL).padEnd(15) + String(cN) + mark);
    }

    // Diff de columnas para tablas comunes con DIFF interesante
    console.log('\n=== Columnas extra en LOCAL (no en Neon) ===');
    for (const t of localTables) {
        if (!neonTables.includes(t)) continue;
        const lc = await columns(local, t);
        const nc = await columns(neon, t);
        const ncNames = new Set(nc.map(c => c.column_name));
        const extras = lc.filter(c => !ncNames.has(c.column_name));
        if (extras.length) {
            console.log(t + ': ' + extras.map(c => c.column_name + ' (' + c.data_type + ')').join(', '));
        }
    }

    await local.end();
    await neon.end();
}

main().catch(e => { console.error(e); process.exit(1); });
