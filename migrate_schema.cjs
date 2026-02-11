/**
 * Crea el esquema PostgreSQL (tablas + índices).
 * Usa db.cjs que ya tiene todo el DDL en inicializarTablas().
 *
 * Uso: node migrate_schema.cjs
 * Requisito: PostgreSQL corriendo (docker compose up -d)
 */
const db = require('./db.cjs');

async function main() {
    console.log('Creando esquema PostgreSQL...\n');

    await db.inicializarTablas();

    // Mostrar tablas creadas
    const result = await db.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    console.log('Tablas creadas:');
    result.rows.forEach(r => console.log(`  - ${r.tablename}`));

    // Mostrar índices
    const indices = await db.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname"
    );
    console.log(`\nÍndices creados: ${indices.rows.length}`);

    console.log('\nEsquema creado correctamente.');
    await db.cerrar();
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
