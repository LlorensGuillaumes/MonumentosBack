/**
 * Seed: Retablos Renacentistas del Este de León
 * Run: node seed_ruta_retablos_leon.cjs
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

const RUTA = {
    slug: 'retablos-este-leon',
    nombre: 'Retablos Renacentistas del Este de León',
    descripcion: 'Recorrido por diez espléndidos retablos renacentistas y góticos conservados en iglesias del este de la provincia de León, entre la Tierra de Sahagún y la Montaña de Riaño. Un viaje por el arte sacro de los siglos XV y XVI, con obras de imagineros como Guillén Doncel y pintores como Cristóbal de Colmenares, que muestran la riqueza artística del patrimonio religioso leonés.',
    region: 'Leon',
    pais: 'España',
    tema: 'renaissance',
    centro_lat: 42.50,
    centro_lng: -5.05,
    zoom: 10,
    imagen_portada: null,
};

const PARADAS = [
    {
        orden: 1,
        nombre: 'Retablo Mayor – Iglesia de San Pedro Apóstol',
        localidad: 'Vallecillo',
        municipio: 'Vallecillo',
        latitud: 42.35604,
        longitud: -5.21170,
        descripcion: 'Retablo renacentista del segundo tercio del siglo XVI formado por una estructura de tres cuerpos y cinco calles elevadas sobre predela. Está rematado por un pequeño ático con la imagen de Dios Padre y protegido por guardapolvos laterales. En la predela se representa la totalidad del apostolado. Los diferentes cuerpos repiten el mismo esquema compositivo, dedicándose el primero al titular de la iglesia, san Pedro, el segundo a la Virgen y el tercero y último a la Pasión de Cristo. Acompañando a las imágenes de bulto de la calle central de cada uno de ellos, las calles laterales incorporan tablas pintadas con relatos sobre su hagiografía y martirio y correspondientes ciclos iconográficos. Restaurado en el año 2006.',
        estilo: 'Renacimiento',
        periodo: 'Segundo tercio del siglo XVI',
        autor: null,
        anyo_restauracion: '2006',
        fotos: [],
    },
    {
        orden: 2,
        nombre: 'Retablo Colateral de la Epístola – Iglesia de Nuestra Señora de Arbas',
        localidad: 'Gordaliza del Pino',
        municipio: 'Gordaliza del Pino',
        latitud: 42.34418,
        longitud: -5.15637,
        descripcion: 'Retablo colateral de la epístola perteneciente al tercer cuarto del siglo XVI y dedicado a los ciclos de la Pasión y Gloria de Cristo. Su mazonería está realizada en madera de pino y conformada por una predela, dos cuerpos de tres calles articuladas mediante columnas estilizadas de fuste retallado y polseras laterales. El retablo fue policromado en 1563 por el pintor Martín Alonso. La calle central está ocupada por los grupos escultóricos del Descendimiento y la Flagelación, mientras que en las laterales se ubican historias de pincel relativas a la Resurrección y Gloria de Cristo. Restaurado en el año 2005.',
        estilo: 'Renacimiento',
        periodo: 'Tercer cuarto del siglo XVI',
        autor: 'Policromado por Martín Alonso (1563)',
        anyo_restauracion: '2005',
        fotos: [],
    },
    {
        orden: 3,
        nombre: 'Retablo Mayor – Capilla de la Cofradía de Jesús Nazareno y Patrocinio de San José',
        localidad: 'Sahagún',
        municipio: 'Sahagún',
        latitud: 42.37096,
        longitud: -5.02995,
        descripcion: 'De mazonería barroca de hacia 1730, el retablo situado en la cabecera de la capilla incorpora ocho bajorrelieves renacentistas procedentes del que doña Isabel de Quiñones había encargado en 1545 al imaginero Juan de Angés y al entallador Guillén Doncel para la capilla familiar que tenía en el convento de Santa María de Trianos. Los bustos de los Evangelistas, en forma de medallones, se sitúan en las calles laterales de la predela y del cuerpo principal, pero el mayor protagonismo lo acaparan los relieves del Santo Entierro de la calle central del banco, La oración en el Huerto y Jesús con la cruz a cuestas de los laterales del cuerpo principal y el Descendimiento del ático, que tuvieron como fuente de inspiración grabados del norte de Europa como los elaborados por Alberto Durero y Lucas van Leyden. Restaurado en 2003.',
        estilo: 'Barroco (mazonería) con relieves renacentistas',
        periodo: 'Mazonería ~1730; relieves de 1545',
        autor: 'Juan de Angés (imaginero) y Guillén Doncel (entallador)',
        anyo_restauracion: '2003',
        fotos: [],
    },
    {
        orden: 4,
        nombre: 'Retablo Mayor – Iglesia de San Andrés',
        localidad: 'Joara',
        municipio: 'Sahagún',
        latitud: 42.42448,
        longitud: -4.96917,
        descripcion: 'Retablo del segundo cuarto del siglo XVI compuesto por tres cuerpos y siete calles, siendo las exteriores, en las que se alojan imágenes de bulto de los evangelistas con su correspondiente símbolo del Tetramorfo, de menor tamaño. El primero de los cuerpos, elevado sobre un zócalo decorado con bustos y paneles de grutescos, contiene en su calle central un tabernáculo cuya puerta se adorna con un relieve de la Resurrección. La calle central de los cuerpos segundo y tercero alberga las imágenes de bulto redondo de san Andrés y La Coronación de la Virgen, respectivamente. En las calles laterales se incorporan diferentes historias de pincel sobre la hagiografía y martirio del santo titular, san Andrés, y la Pasión de Cristo, obras del pintor Cristóbal de Colmenares, quien, según contrato fechado en 1541, también doró la mazonería.',
        estilo: 'Renacimiento',
        periodo: 'Segundo cuarto del siglo XVI',
        autor: 'Pintura: Cristóbal de Colmenares (contrato 1541)',
        anyo_restauracion: null,
        fotos: [],
    },
    {
        orden: 5,
        nombre: 'Retablo Mayor – Iglesia de los Santos Justo y Pastor',
        localidad: 'Celada de Cea',
        municipio: 'Joara',
        latitud: 42.42816,
        longitud: -4.94653,
        descripcion: 'Retablo renacentista de mediados del siglo XVI compuesto por tres cuerpos y cinco calles sobre sotabanco de fábrica y predela. Aunque la calle central de los primeros cuerpos ha sufrido algunas pérdidas, estas han quedado parcialmente restituidas con la inclusión de un sagrario en el primero y las esculturas exentas de factura moderna de los santos titulares del templo, los niños Justo y Pastor con la palma del martirio, en el segundo. Sobre ellos se sitúa una imagen de bulto redondo del siglo XVI de la Virgen María, mientras las calles laterales son ocupadas por óleos sobre lienzo que representan, desde el cuerpo inferior al superior, a los Padres de la Iglesia occidental o latina, los Evangelistas y diversos pasajes marianos.',
        estilo: 'Renacimiento',
        periodo: 'Mediados del siglo XVI',
        autor: null,
        anyo_restauracion: null,
        fotos: [],
    },
    {
        orden: 6,
        nombre: 'Retablo Mayor – Iglesia de San Andrés Apóstol',
        localidad: 'Valdescapa',
        municipio: 'Villazanzo de Valderaduey',
        latitud: 42.53333,
        longitud: -4.98333,
        descripcion: 'El retablo mayor de la iglesia de san Andrés de Valdescapa, realizado hacia mediados del siglo XVI, es un magnífico ejemplo de la huella que el maestro Juan de Juni dejó en tierras leonesas, especialmente a partir de algunos de sus colaboradores, como el también maestro francés Guillén Doncel, a quien tradicionalmente se vienen atribuyendo las labores escultóricas de este conjunto. Está estructurado en tres cuerpos de tamaño creciente y cinco calles. La central, más amplia, que albergaba en el piso inferior el sagrario —hoy desaparecido—, contiene las imágenes de san Andrés, en el segundo cuerpo, y de la Asunción de la Virgen, en el tercero. Este, a su vez, está rematado con un frontón triangular con la imagen de Dios Padre y, en lo alto, con una imagen de bulto de Cristo Crucificado. Las calles laterales integran un conjunto de historias de pincel que recogen pasajes del ciclo de la Pasión, de la hagiografía del santo titular y del ciclo de la Infancia de Jesús, que han sido atribuidas al pintor Francisco de Villamuño. Restaurado en 2011.',
        estilo: 'Renacimiento',
        periodo: 'Mediados del siglo XVI',
        autor: 'Escultura atribuida a Guillén Doncel; pintura atribuida a Francisco de Villamuño',
        anyo_restauracion: '2011',
        fotos: [],
    },
    {
        orden: 7,
        nombre: 'Retablo Mayor – Iglesia de los Santos Facundo y Primitivo',
        localidad: 'Villaselán',
        municipio: 'Villaselán',
        latitud: 42.56105,
        longitud: -5.04820,
        descripcion: 'Retablo mayor situado sobre sotabanco de fábrica y con estructura de estilo gótico de finales del siglo XV. Mediante estilizados pilares fasciculados que rematan en pináculos, el retablo se estructura en tres cuerpos de cinco calles con un guardapolvo superior ligeramente curvado que imita una bóveda de crucería. A la estructura anterior se añadió un tabernáculo o sagrario renacentista que recuerda a los elaborados por los seguidores de Gaspar Becerra durante el último cuarto del siglo XVI. También parecen pertenecer a esta época las tablas pictóricas en las que se representan pasajes del ciclo de la Pasión de Cristo en el cuerpo inferior, escenas de la vida de la Virgen e Infancia de Jesús en el superior y escenas del martirio de los santos titulares, san Facundo y san Primitivo, en el cuerpo intermedio, cuyas imágenes también se reproducen con esculturas de bulto redondo en la calle central. Restaurado en 2021.',
        estilo: 'Gótico (estructura) con elementos renacentistas',
        periodo: 'Finales del siglo XV',
        autor: null,
        anyo_restauracion: '2021',
        fotos: [],
    },
    {
        orden: 8,
        nombre: 'Retablo Mayor – Iglesia de San Julián y Santa Basilisa',
        localidad: 'Valdavida',
        municipio: 'Villaselán',
        latitud: 42.58928,
        longitud: -5.00720,
        descripcion: 'Retablo mayor de estilo renacentista y planta lineal realizado en el último tercio del siglo XVI. Está estructurado con una predela, tres cuerpos de cinco calles y un ático. La predela contiene relieves con pasajes de los libros del Génesis y Números. Las esculturas de bulto redondo de los santos titulares, san Julián y santa Basilisa, presiden las hornacinas de la calle central situadas sobre el sagrario, mientras que las calles laterales incorporan tablas pictóricas en las que se reproducen escenas de la Pasión de Cristo, en el cuerpo inferior, pasajes de las hagiografías de san Julián Hospitalario y san Julián Mártir, en el cuerpo central, y pasajes de la vida de la Virgen María en el cuerpo superior. Sobre este último se eleva, conectado mediante aletones, el ático con un relieve del calvario sobre fondo pictórico. Restaurado en 2020.',
        estilo: 'Renacimiento',
        periodo: 'Último tercio del siglo XVI',
        autor: null,
        anyo_restauracion: '2020',
        fotos: [],
    },
    {
        orden: 9,
        nombre: 'Retablo Renacentista – Iglesia de Cristo Rey',
        localidad: 'Cistierna',
        municipio: 'Cistierna',
        latitud: 42.80314,
        longitud: -5.12560,
        descripcion: 'Este retablo renacentista, procedente de la iglesia de la Vera Cruz de Valderas y elaborado durante el segundo tercio del siglo XVI, está compuesto por una mazonería dorada, policromada y ricamente decorada con grutescos y motivos a candelieri. A través de una sucesión de pilastras y entablamentos, el conjunto se organiza en cuatro cuerpos de tres calles. Solo la calle central del segundo cuerpo acoge una imagen de bulto redondo de la Virgen con el Niño, mientras que el resto vienen ocupadas por tablas pictóricas en las que, sobre un grupo de seis apóstoles que conforma el piso inferior, se narran episodios de los ciclos de la Infancia de Jesús y de la Virgen María, así como un grupo de tres tablas en el piso superior con imágenes de la Pasión.',
        estilo: 'Renacimiento',
        periodo: 'Segundo tercio del siglo XVI',
        autor: null,
        anyo_restauracion: null,
        fotos: [],
    },
    {
        orden: 10,
        nombre: 'Retablo Mayor – Iglesia de San Salvador',
        localidad: 'Yugueros',
        municipio: 'La Ercina',
        latitud: 42.81000,
        longitud: -5.17742,
        descripcion: 'Retablo mayor de estilo renacentista finalizado en el año 1553, tal y como indica la cartela situada en el tímpano del frontón triangular de remate del conjunto. Está formado por dos primeros cuerpos de cinco calles y uno superior de tres calles que conecta con los anteriores mediante aletones finalizados en figuras de híbridos. Dentro de la mazonería destaca la variedad de motivos del grutesco incorporados a las pilastras y frisos de los entablamentos, mientras que la calle central de los primeros cuerpos contiene un tabernáculo y una escultura de la Trinidad. Por su parte, las calles laterales integran un conjunto de óleos sobre tabla centrados principalmente en episodios de los ciclos de la Infancia de Jesús, Gloria de Cristo y escenas de la vida de María que culminan con la representación de la Ascensión de Cristo. Restaurado en 2011.',
        estilo: 'Renacimiento',
        periodo: '1553',
        autor: null,
        anyo_restauracion: '2011',
        fotos: [],
    },
];

async function seed() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Insert route
        const rutaResult = await client.query(
            `INSERT INTO rutas_culturales (slug, nombre, descripcion, region, pais, tema, centro_lat, centro_lng, zoom, imagen_portada, num_paradas)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (slug) DO UPDATE SET
                nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion,
                region = EXCLUDED.region, tema = EXCLUDED.tema,
                centro_lat = EXCLUDED.centro_lat, centro_lng = EXCLUDED.centro_lng,
                zoom = EXCLUDED.zoom, imagen_portada = EXCLUDED.imagen_portada,
                num_paradas = EXCLUDED.num_paradas, updated_at = NOW()
             RETURNING id`,
            [RUTA.slug, RUTA.nombre, RUTA.descripcion, RUTA.region, RUTA.pais,
             RUTA.tema, RUTA.centro_lat, RUTA.centro_lng, RUTA.zoom,
             RUTA.imagen_portada, PARADAS.length]
        );
        const rutaId = rutaResult.rows[0].id;
        console.log(`Ruta insertada/actualizada con id=${rutaId}`);

        // Delete existing stops (for idempotency — CASCADE deletes fotos too)
        await client.query('DELETE FROM rutas_culturales_paradas WHERE ruta_id = $1', [rutaId]);

        // Insert stops and photos
        for (const parada of PARADAS) {
            const pResult = await client.query(
                `INSERT INTO rutas_culturales_paradas
                 (ruta_id, bien_id, orden, nombre, localidad, municipio, latitud, longitud, descripcion, estilo, periodo, autor, anyo_restauracion)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                 RETURNING id`,
                [rutaId, parada.bien_id || null, parada.orden, parada.nombre,
                 parada.localidad, parada.municipio, parada.latitud, parada.longitud,
                 parada.descripcion, parada.estilo, parada.periodo,
                 parada.autor, parada.anyo_restauracion]
            );
            const paradaId = pResult.rows[0].id;

            for (const foto of parada.fotos) {
                await client.query(
                    `INSERT INTO rutas_culturales_fotos (parada_id, url, titulo, orden, autor, fuente)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
                    [paradaId, foto.url, foto.titulo, foto.orden, foto.autor || null, foto.fuente || null]
                );
            }

            console.log(`  Parada ${parada.orden}: ${parada.nombre} (${parada.fotos.length} fotos)`);
        }

        await client.query('COMMIT');
        console.log(`\nRuta "${RUTA.nombre}" sembrada con ${PARADAS.length} paradas.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
