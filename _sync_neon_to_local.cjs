/**
 * Sync Neon -> Local (lectura de Neon, escritura en Local).
 * UPSERT no destructivo. Excluye usuarios y login_history.
 */
require('dotenv').config();
const { Pool, types } = require('pg');

types.setTypeParser(20, parseInt);

const neon = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
    max: 4,
});

const local = new Pool({
    host: 'localhost',
    port: 5433,
    user: 'patrimonio',
    password: 'patrimonio2026',
    database: 'patrimonio',
    max: 8,
});

const BATCH = 2000;

// Tablas a sincronizar en orden de dependencias (parents primero).
// Excluimos: usuarios, login_history, favoritos (FK usuarios), notas_monumento, social_history,
// valoraciones_monumento, propuestas_*, mensajes_* (FK usuarios o vacías sin sentido sin usuarios)
// Incluimos: bienes, wikidata, sipca, imagenes, eventos_monumento, contactos_municipios,
// notas_contactos, rutas_culturales, rutas_culturales_paradas, rutas_culturales_fotos
const TABLAS = [
    { name: 'bienes', pk: 'id', hasIdSeq: true },
    { name: 'wikidata', pk: 'bien_id', hasIdSeq: false },
    { name: 'sipca', pk: 'bien_id', hasIdSeq: false },
    { name: 'imagenes', pk: 'id', hasIdSeq: true },
    { name: 'eventos_monumento', pk: 'id', hasIdSeq: true },
    { name: 'contactos_municipios', pk: 'id', hasIdSeq: true },
    { name: 'notas_contactos', pk: 'id', hasIdSeq: true },
    { name: 'rutas_culturales', pk: 'id', hasIdSeq: true },
    { name: 'rutas_culturales_paradas', pk: 'id', hasIdSeq: true },
    { name: 'rutas_culturales_fotos', pk: 'id', hasIdSeq: true },
];

async function getColumns(pool, table) {
    const r = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
        [table]
    );
    return r.rows.map(r => r.column_name);
}

async function syncTable(t) {
    const neonCols = await getColumns(neon, t.name);
    const localCols = await getColumns(local, t.name);
    if (localCols.length === 0) {
        console.log(`  [SKIP] ${t.name}: no existe en local`);
        return;
    }
    const cols = neonCols.filter(c => localCols.includes(c));
    const colList = cols.map(c => '"' + c + '"').join(', ');
    const updateCols = cols.filter(c => c !== t.pk);
    const setClause = updateCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

    // Total
    const totalR = await neon.query(`SELECT COUNT(*)::int AS c FROM ${t.name}`);
    const total = totalR.rows[0].c;
    console.log(`\n=== ${t.name} (${total} filas en Neon) ===`);
    if (total === 0) return;

    let lastPk = null;
    let processed = 0;
    let upserted = 0;

    while (true) {
        const where = lastPk === null ? '' : `WHERE "${t.pk}" > $1`;
        const params = lastPk === null ? [BATCH] : [lastPk, BATCH];
        const limitParam = lastPk === null ? '$1' : '$2';
        const sql = `SELECT ${colList} FROM ${t.name} ${where} ORDER BY "${t.pk}" LIMIT ${limitParam}`;
        const r = await neon.query(sql, params);
        if (r.rows.length === 0) break;

        // Build multi-row insert
        const values = [];
        const placeholders = [];
        for (let i = 0; i < r.rows.length; i++) {
            const row = r.rows[i];
            const rowPlaceholders = [];
            for (let j = 0; j < cols.length; j++) {
                values.push(row[cols[j]]);
                rowPlaceholders.push('$' + values.length);
            }
            placeholders.push('(' + rowPlaceholders.join(', ') + ')');
        }
        const upsertSql =
            `INSERT INTO ${t.name} (${colList}) VALUES ${placeholders.join(', ')} ` +
            (updateCols.length > 0
                ? `ON CONFLICT ("${t.pk}") DO UPDATE SET ${setClause}`
                : `ON CONFLICT ("${t.pk}") DO NOTHING`);

        try {
            const ins = await local.query(upsertSql, values);
            upserted += ins.rowCount;
        } catch (e) {
            console.log(`  ERROR batch en ${t.name}: ${e.message}`);
            // Fallback: row by row
            for (const row of r.rows) {
                try {
                    const rowVals = cols.map(c => row[c]);
                    const ph = cols.map((_, i) => '$' + (i + 1)).join(', ');
                    const single =
                        `INSERT INTO ${t.name} (${colList}) VALUES (${ph}) ` +
                        (updateCols.length > 0
                            ? `ON CONFLICT ("${t.pk}") DO UPDATE SET ${setClause}`
                            : `ON CONFLICT ("${t.pk}") DO NOTHING`);
                    const ir = await local.query(single, rowVals);
                    upserted += ir.rowCount;
                } catch (e2) {
                    // skip silently (FK violation etc)
                }
            }
        }

        processed += r.rows.length;
        lastPk = r.rows[r.rows.length - 1][t.pk];
        if (processed % 20000 === 0 || processed >= total) {
            const pct = ((processed / total) * 100).toFixed(1);
            console.log(`  ${processed}/${total} (${pct}%) upserted=${upserted}`);
        }
    }
    console.log(`  Final ${t.name}: ${upserted} upserted`);

    // Resync sequence si tiene id serial
    if (t.hasIdSeq && t.pk === 'id') {
        try {
            await local.query(
                `SELECT setval(pg_get_serial_sequence('${t.name}', 'id'), COALESCE((SELECT MAX(id) FROM ${t.name}), 1))`
            );
        } catch (e) {
            console.log(`  warn setval: ${e.message}`);
        }
    }
}

async function main() {
    console.log('=== Sync Neon -> Local (UPSERT) ===');
    console.log('Excluye: usuarios, login_history, y tablas con FK a usuarios sin filas\n');

    for (const t of TABLAS) {
        try {
            await syncTable(t);
        } catch (e) {
            console.log(`ERROR en ${t.name}: ${e.message}`);
        }
    }

    console.log('\n=== Verificación final ===');
    for (const t of TABLAS) {
        try {
            const lr = await local.query(`SELECT COUNT(*)::int AS c FROM ${t.name}`);
            const nr = await neon.query(`SELECT COUNT(*)::int AS c FROM ${t.name}`);
            const ok = lr.rows[0].c === nr.rows[0].c ? 'OK' : 'DIFF';
            console.log(`  ${t.name.padEnd(30)} local=${String(lr.rows[0].c).padEnd(8)} neon=${String(nr.rows[0].c).padEnd(8)} ${ok}`);
        } catch {}
    }

    await neon.end();
    await local.end();
    console.log('\nSync completado.');
}

main().catch(e => { console.error(e); process.exit(1); });
