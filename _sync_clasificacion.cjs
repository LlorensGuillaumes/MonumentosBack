/**
 * Sincroniza tipo_monumento y periodo desde Neon (remota) a local Docker PostgreSQL.
 * También sincroniza inception en wikidata.
 */
const { Pool, types } = require('pg');
require('dotenv').config();

types.setTypeParser(20, parseInt);

const neon = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

const local = new Pool({
    host: 'localhost',
    port: 5433,
    user: 'patrimonio',
    password: 'patrimonio2026',
    database: 'patrimonio',
});

const BATCH = 5000;

async function main() {
    console.log('=== Sync clasificación Neon → Local ===\n');

    // 1. Sync tipo_monumento
    console.log('--- Sincronizando tipo_monumento ---');
    let offset = 0;
    let tipoUpdated = 0;

    while (true) {
        const result = await neon.query(
            'SELECT id, tipo_monumento FROM bienes WHERE tipo_monumento IS NOT NULL ORDER BY id LIMIT $1 OFFSET $2',
            [BATCH, offset]
        );
        if (result.rows.length === 0) break;

        for (const row of result.rows) {
            const r = await local.query(
                'UPDATE bienes SET tipo_monumento = $1 WHERE id = $2',
                [row.tipo_monumento, row.id]
            );
            if (r.rowCount > 0) tipoUpdated++;
        }

        offset += BATCH;
        if (offset % 50000 === 0) console.log('  tipo_monumento: ' + offset + ' procesados, ' + tipoUpdated + ' actualizados');
    }
    console.log('tipo_monumento sincronizado: ' + tipoUpdated + ' filas\n');

    // 2. Sync periodo
    console.log('--- Sincronizando periodo ---');
    offset = 0;
    let periodoUpdated = 0;

    while (true) {
        const result = await neon.query(
            'SELECT id, periodo FROM bienes WHERE periodo IS NOT NULL ORDER BY id LIMIT $1 OFFSET $2',
            [BATCH, offset]
        );
        if (result.rows.length === 0) break;

        for (const row of result.rows) {
            const r = await local.query(
                'UPDATE bienes SET periodo = $1 WHERE id = $2',
                [row.periodo, row.id]
            );
            if (r.rowCount > 0) periodoUpdated++;
        }

        offset += BATCH;
        if (offset % 50000 === 0) console.log('  periodo: ' + offset + ' procesados, ' + periodoUpdated + ' actualizados');
    }
    console.log('periodo sincronizado: ' + periodoUpdated + ' filas\n');

    // 3. Sync inception in wikidata
    console.log('--- Sincronizando wikidata.inception ---');
    // Check if column exists locally
    try {
        await local.query('SELECT inception FROM wikidata LIMIT 1');
    } catch {
        console.log('  Columna inception no existe en local, creándola...');
        await local.query('ALTER TABLE wikidata ADD COLUMN IF NOT EXISTS inception TEXT');
    }

    offset = 0;
    let inceptionUpdated = 0;

    while (true) {
        const result = await neon.query(
            "SELECT bien_id, inception FROM wikidata WHERE inception IS NOT NULL AND inception != '' ORDER BY bien_id LIMIT $1 OFFSET $2",
            [BATCH, offset]
        );
        if (result.rows.length === 0) break;

        for (const row of result.rows) {
            const r = await local.query(
                'UPDATE wikidata SET inception = $1 WHERE bien_id = $2',
                [row.inception, row.bien_id]
            );
            if (r.rowCount > 0) inceptionUpdated++;
        }

        offset += BATCH;
        if (offset % 20000 === 0) console.log('  inception: ' + offset + ' procesados, ' + inceptionUpdated + ' actualizados');
    }
    console.log('inception sincronizado: ' + inceptionUpdated + ' filas\n');

    // Verify
    console.log('=== Verificación local ===');
    const localStats = await local.query(
        "SELECT COUNT(*) as total, " +
        "SUM(CASE WHEN tipo_monumento IS NOT NULL THEN 1 ELSE 0 END) as con_tipo, " +
        "SUM(CASE WHEN periodo IS NOT NULL THEN 1 ELSE 0 END) as con_periodo " +
        "FROM bienes"
    );
    const s = localStats.rows[0];
    console.log('Local: total=' + s.total + ', tipo_monumento=' + s.con_tipo + ' (' + (s.con_tipo/s.total*100).toFixed(1) + '%), periodo=' + s.con_periodo + ' (' + (s.con_periodo/s.total*100).toFixed(1) + '%)');

    await neon.end();
    await local.end();
    console.log('\nSincronización completada.');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
