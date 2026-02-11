/**
 * Migra todos los datos de patrimonio.db (SQLite) a PostgreSQL.
 * Lee con better-sqlite3 (síncrono), escribe con pg (async).
 *
 * Uso: node migrate_data.cjs
 * Requisito: migrate_schema.cjs ejecutado primero
 */
const Database = require('better-sqlite3');
const { Pool, types } = require('pg');
require('dotenv').config();
const path = require('path');

types.setTypeParser(20, parseInt);

const DB_PATH = path.join(__dirname, 'patrimonio.db');

async function main() {
    const sqlite = new Database(DB_PATH, { readonly: true });
    const pool = new Pool({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'patrimonio',
        password: process.env.PGPASSWORD || 'patrimonio2026',
        database: process.env.PGDATABASE || 'patrimonio',
    });

    console.log('Migrando datos de SQLite a PostgreSQL...\n');

    // Orden importa por FK constraints
    const tables = [
        {
            name: 'bienes',
            cols: ['id','denominacion','tipo','clase','categoria','provincia','comarca','municipio','localidad','latitud','longitud','situacion','resolucion','publicacion','fuente_opendata','comunidad_autonoma','codigo_fuente','pais','created_at','updated_at'],
        },
        {
            name: 'wikidata',
            cols: ['id','bien_id','qid','descripcion','imagen_url','arquitecto','estilo','material','altura','superficie','inception','heritage_label','wikipedia_url','commons_category','sipca_code','raw_json'],
        },
        {
            name: 'sipca',
            cols: ['id','bien_id','sipca_id','descripcion_completa','sintesis_historica','datacion','periodo_historico','siglo','ubicacion_detalle','fuentes','bibliografia','meta_description','url'],
        },
        {
            name: 'imagenes',
            cols: ['id','bien_id','url','titulo','autor','fuente'],
        },
        {
            name: 'usuarios',
            cols: ['id','email','password_hash','nombre','idioma_por_defecto','google_id','avatar_url','rol','created_at','last_login'],
        },
        {
            name: 'favoritos',
            cols: ['id','usuario_id','bien_id','created_at'],
        },
        {
            name: 'contactos_municipios',
            cols: ['id','municipio','provincia','comunidad_autonoma','email_patrimonio','email_general','persona_contacto','cargo','telefono','web','fuente','fecha_actualizacion'],
        },
        {
            name: 'notas_contactos',
            cols: ['id','contacto_id','texto','es_tarea','completada','created_at'],
        },
    ];

    for (const table of tables) {
        await migrateTable(sqlite, pool, table.name, table.cols);
    }

    // Reset sequences
    console.log('\nReseteando secuencias SERIAL...');
    for (const table of tables) {
        const seqName = `${table.name}_id_seq`;
        try {
            await pool.query(`SELECT setval('${seqName}', COALESCE((SELECT MAX(id) FROM ${table.name}), 0) + 1, false)`);
        } catch (e) {
            // Sequence might not exist if table had no data
        }
    }

    // Verificación
    console.log('\n--- VERIFICACIÓN ---');
    for (const table of tables) {
        const sqliteCount = sqlite.prepare(`SELECT COUNT(*) as n FROM ${table.name}`).get().n;
        const pgResult = await pool.query(`SELECT COUNT(*) as n FROM ${table.name}`);
        const pgCount = pgResult.rows[0].n;
        const match = sqliteCount === pgCount ? '✓' : '✗ MISMATCH!';
        console.log(`  ${table.name}: SQLite=${sqliteCount} PG=${pgCount} ${match}`);
    }

    sqlite.close();
    await pool.end();
    console.log('\nMigración completada.');
}

async function migrateTable(sqlite, pool, tableName, cols) {
    // Check if table exists in SQLite
    const tableExists = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(tableName);

    if (!tableExists) {
        console.log(`  ${tableName}: tabla no existe en SQLite, saltando.`);
        return;
    }

    const rows = sqlite.prepare(`SELECT * FROM ${tableName} ORDER BY id`).all();
    const total = rows.length;

    if (total === 0) {
        console.log(`  ${tableName}: 0 filas, saltando.`);
        return;
    }

    console.log(`  ${tableName}: migrando ${total} filas...`);

    const BATCH_SIZE = 500;
    let inserted = 0;

    for (let start = 0; start < total; start += BATCH_SIZE) {
        const batch = rows.slice(start, start + BATCH_SIZE);
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            for (const row of batch) {
                const values = cols.map(col => row[col] !== undefined ? row[col] : null);
                const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(',');
                await client.query(
                    `INSERT INTO ${tableName} (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
                    values
                );
            }

            await client.query('COMMIT');
            inserted += batch.length;

            if (total > BATCH_SIZE) {
                process.stdout.write(`\r    ${inserted}/${total} (${Math.round(inserted / total * 100)}%)`);
            }
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(`\n    Error en batch ${start}: ${e.message}`);
            throw e;
        } finally {
            client.release();
        }
    }

    if (total > BATCH_SIZE) {
        process.stdout.write('\n');
    }
    console.log(`    ${tableName}: ${inserted} filas migradas.`);
}

main().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});
