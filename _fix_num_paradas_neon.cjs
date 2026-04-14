require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(20, parseInt);

const neon = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

(async () => {
    const r = await neon.query(`
        UPDATE rutas_culturales r SET num_paradas = (
          SELECT COUNT(*) FROM rutas_culturales_paradas WHERE ruta_id = r.id
        ) RETURNING id, slug, num_paradas
    `);
    console.log('Actualizadas ' + r.rowCount + ' filas en Neon');
    r.rows.slice().sort((a,b) => a.id - b.id).forEach(x => {
        console.log('  ' + String(x.id).padStart(3) + '  ' + x.slug.padEnd(35) + '  ' + x.num_paradas);
    });
    await neon.end();
})();
