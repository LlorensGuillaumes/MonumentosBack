require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(20, parseInt);

const neon = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

(async () => {
    const PARADAS_BIEN_IDS = [265516,265517,265518,265519,265520,265521,265522,78976,265523,265524];

    // Schema
    const cols = await neon.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='propuestas_imagenes' ORDER BY ordinal_position"
    );
    console.log('propuestas_imagenes columns:');
    cols.rows.forEach(c => console.log('  ' + c.column_name + ' ' + c.data_type));

    const colsM = await neon.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='propuestas_monumentos' ORDER BY ordinal_position"
    );
    console.log('\npropuestas_monumentos columns:');
    colsM.rows.forEach(c => console.log('  ' + c.column_name + ' ' + c.data_type));

    const tot = await neon.query('SELECT COUNT(*)::int AS c FROM propuestas_imagenes');
    const totM = await neon.query('SELECT COUNT(*)::int AS c FROM propuestas_monumentos');
    console.log('\nTotal propuestas_imagenes en Neon: ' + tot.rows[0].c);
    console.log('Total propuestas_monumentos en Neon: ' + totM.rows[0].c);

    if (tot.rows[0].c > 0) {
        const r = await neon.query(
            `SELECT pi.id, pi.propuesta_id, octet_length(pi.contenido) AS bytes,
                    pm.bien_id, b.denominacion, b.localidad
             FROM propuestas_imagenes pi
             LEFT JOIN propuestas_monumentos pm ON pi.propuesta_id = pm.id
             LEFT JOIN bienes b ON pm.bien_id = b.id
             ORDER BY pi.id`
        );
        console.log('\nFilas:');
        r.rows.forEach(x => console.log(JSON.stringify(x)));

        // ¿Alguna corresponde a las paradas?
        const matches = r.rows.filter(x => PARADAS_BIEN_IDS.includes(x.bien_id));
        console.log('\nDe estas, ' + matches.length + ' apuntan a paradas de la ruta de retablos.');
    }

    // Imágenes ya en imagenes para los bien_id de las paradas
    const imgs = await neon.query(
        `SELECT bien_id, fuente, url, titulo FROM imagenes WHERE bien_id = ANY($1) ORDER BY bien_id`,
        [PARADAS_BIEN_IDS]
    );
    console.log('\nImagenes en tabla imagenes para los 10 bienes (Neon):');
    imgs.rows.forEach(x => console.log('  bien=' + x.bien_id + ' [' + x.fuente + '] ' + x.url));

    await neon.end();
})().catch(e => { console.error(e); process.exit(1); });
