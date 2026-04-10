/**
 * Seed: Crear las 9 iglesias de la ruta de retablos en la tabla bienes
 * y vincularlas a las paradas de la ruta cultural.
 * Run: node seed_iglesias_retablos.cjs
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL?.replace(/\s+/g, ''),
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'patrimonio',
    password: process.env.PGPASSWORD || 'patrimonio2026',
    database: process.env.PGDATABASE || 'patrimonio',
});

const IGLESIAS = [
    {
        orden: 1,
        denominacion: 'Iglesia de San Pedro Apóstol',
        localidad: 'Vallecillo',
        municipio: 'Vallecillo',
        latitud: 42.35604,
        longitud: -5.21170,
        tipo_monumento: 'Iglesia',
        periodo: 'Siglo XVI',
        codigo_fuente: 'ruta-retablos-vallecillo',
        wikidata: null,
    },
    {
        orden: 2,
        denominacion: 'Iglesia de Nuestra Señora de Arbas',
        localidad: 'Gordaliza del Pino',
        municipio: 'Gordaliza del Pino',
        latitud: 42.343714,
        longitud: -5.157345,
        tipo_monumento: 'Iglesia',
        periodo: 'Siglo XIV',
        codigo_fuente: 'wikidata-Q117971411',
        wikidata: {
            qid: 'Q117971411',
            descripcion: 'Iglesia parroquial católica en Gordaliza del Pino, León',
            imagen_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Iglesia%20de%20Nuestra%20Se%C3%B1ora%20de%20Arb%C3%A1s%2C%20Gordaliza%20del%20Pino%2003.jpg',
            estilo: 'Arquitectura románica, Arquitectura mudéjar',
            inception: '1300',
            commons_category: 'Church of Our Lady of Arbas, Gordaliza del Pino',
        },
    },
    {
        orden: 3,
        denominacion: 'Capilla de la Cofradía de Jesús Nazareno y Patrocinio de San José',
        localidad: 'Sahagún',
        municipio: 'Sahagún',
        latitud: 42.37096,
        longitud: -5.02995,
        tipo_monumento: 'Ermita o capilla',
        periodo: 'Siglo XVI',
        codigo_fuente: 'ruta-retablos-sahagun-nazareno',
        wikidata: null,
    },
    {
        orden: 4,
        denominacion: 'Iglesia de San Andrés',
        localidad: 'Joara',
        municipio: 'Sahagún',
        latitud: 42.42448,
        longitud: -4.96917,
        tipo_monumento: 'Iglesia',
        periodo: 'Siglo XVI',
        codigo_fuente: 'ruta-retablos-joara',
        wikidata: null,
    },
    {
        orden: 5,
        denominacion: 'Iglesia de San Justo y San Pastor',
        localidad: 'Celada de Cea',
        municipio: 'Sahagún',
        latitud: 42.428556,
        longitud: -4.946333,
        tipo_monumento: 'Iglesia',
        periodo: 'Siglo XVI',
        codigo_fuente: 'wikidata-Q106612806',
        wikidata: {
            qid: 'Q106612806',
            descripcion: 'Iglesia en Celada de Cea, Sahagún, León',
            imagen_url: null,
            estilo: null,
            inception: null,
            heritage_label: 'Parte de un sitio Patrimonio de la Humanidad (Camino de Santiago)',
            commons_category: null,
        },
    },
    {
        orden: 6,
        denominacion: 'Iglesia de San Andrés Apóstol',
        localidad: 'Valdescapa',
        municipio: 'Villazanzo de Valderaduey',
        latitud: 42.53333,
        longitud: -4.98333,
        tipo_monumento: 'Iglesia',
        periodo: 'Siglo XVI',
        codigo_fuente: 'ruta-retablos-valdescapa',
        wikidata: null,
    },
    {
        orden: 7,
        denominacion: 'Iglesia de los Santos Facundo y Primitivo',
        localidad: 'Villaselán',
        municipio: 'Villaselán',
        latitud: 42.56105,
        longitud: -5.04820,
        tipo_monumento: 'Iglesia',
        periodo: 'Siglo XV',
        codigo_fuente: 'ruta-retablos-villaselan',
        wikidata: null,
    },
    // Parada 8 ya existe: bien_id=78976 (iglesia parroquial de San Julián y Santa Basilisa)
    {
        orden: 9,
        denominacion: 'Iglesia de Cristo Rey',
        localidad: 'Cistierna',
        municipio: 'Cistierna',
        latitud: 42.80314,
        longitud: -5.12560,
        tipo_monumento: 'Iglesia',
        periodo: 'Siglo XX',
        codigo_fuente: 'ruta-retablos-cistierna',
        wikidata: null,
    },
    {
        orden: 10,
        denominacion: 'Iglesia de San Salvador',
        localidad: 'Yugueros',
        municipio: 'La Ercina',
        latitud: 42.81000,
        longitud: -5.17742,
        tipo_monumento: 'Iglesia',
        periodo: 'Siglo XVI',
        codigo_fuente: 'ruta-retablos-yugueros',
        wikidata: null,
    },
];

async function seed() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get the ruta cultural ID
        const rutaRes = await client.query(
            "SELECT id FROM rutas_culturales WHERE slug = 'retablos-este-leon'"
        );
        if (!rutaRes.rows[0]) throw new Error('Ruta cultural no encontrada');
        const rutaId = rutaRes.rows[0].id;

        for (const ig of IGLESIAS) {
            // Upsert into bienes
            const bienRes = await client.query(
                `INSERT INTO bienes (denominacion, localidad, municipio, latitud, longitud,
                    tipo_monumento, periodo, comunidad_autonoma, provincia, codigo_fuente, pais)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'Castilla y Leon', 'Leon', $8, 'España')
                 ON CONFLICT (pais, comunidad_autonoma, codigo_fuente)
                 DO UPDATE SET denominacion = EXCLUDED.denominacion,
                    latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
                    tipo_monumento = EXCLUDED.tipo_monumento, periodo = EXCLUDED.periodo,
                    updated_at = NOW()
                 RETURNING id`,
                [ig.denominacion, ig.localidad, ig.municipio, ig.latitud, ig.longitud,
                 ig.tipo_monumento, ig.periodo, ig.codigo_fuente]
            );
            const bienId = bienRes.rows[0].id;

            // Insert wikidata if available
            if (ig.wikidata) {
                const wd = ig.wikidata;
                await client.query(
                    `INSERT INTO wikidata (bien_id, qid, descripcion, imagen_url, estilo, inception, heritage_label, commons_category)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (bien_id) DO UPDATE SET
                        qid = EXCLUDED.qid, descripcion = EXCLUDED.descripcion,
                        imagen_url = EXCLUDED.imagen_url, estilo = EXCLUDED.estilo,
                        inception = EXCLUDED.inception, heritage_label = EXCLUDED.heritage_label,
                        commons_category = EXCLUDED.commons_category`,
                    [bienId, wd.qid, wd.descripcion, wd.imagen_url, wd.estilo,
                     wd.inception, wd.heritage_label || null, wd.commons_category]
                );
            }

            // Insert image for Gordaliza del Pino (has Wikimedia Commons image)
            if (ig.wikidata?.imagen_url) {
                await client.query(
                    `INSERT INTO imagenes (bien_id, url, titulo, fuente)
                     VALUES ($1, $2, $3, 'wikidata')
                     ON CONFLICT DO NOTHING`,
                    [bienId, ig.wikidata.imagen_url, ig.denominacion]
                );
            }

            // Link to ruta cultural parada
            await client.query(
                `UPDATE rutas_culturales_paradas SET bien_id = $1
                 WHERE ruta_id = $2 AND orden = $3`,
                [bienId, rutaId, ig.orden]
            );

            console.log(`  Parada ${ig.orden}: ${ig.denominacion} → bien_id=${bienId}${ig.wikidata ? ' (con Wikidata)' : ''}`);
        }

        await client.query('COMMIT');
        console.log('\n9 iglesias insertadas y vinculadas a la ruta cultural.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
