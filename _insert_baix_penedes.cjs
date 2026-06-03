/**
 * Inserción de 20 monumentos del Baix Penedès verificados en Wikidata.
 * Datos extraídos de SPARQL endpoint con QID, coords, imagen y municipio.
 *
 * Ejecuta en transacción:
 *  1. INSERT bienes (denominacion, municipio, lat, lng, etc.)
 *  2. INSERT wikidata (qid, imagen_url) vinculado a bien_id
 *  3. INSERT imagenes (url, fuente) vinculado a bien_id si tiene imagen
 */
require('dotenv').config();
const { Pool } = require('pg');

const COMMONS = (filename) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;

const monumentos = [
  // ALBINYANA
  { qid: 'Q17595798', nom: "Castell d'Albinyana", municipio: 'Albinyana', tipo: 'Castillo / Fortaleza', lat: 41.2413, lng: 1.47551, img: "Paisatge del Baix Penedès des de el Castell de l'Esquernosa.jpg" },
  { qid: 'Q11946920', nom: "Sant Antoni de Pàdua d'Albinyana", municipio: 'Albinyana', tipo: 'Iglesia / Ermita', lat: 41.24186111, lng: 1.4762, img: "Albinyana - Ermita de Sant Antoni.jpg" },
  { qid: 'Q18006650', nom: "Sant Bartomeu d'Albinyana", municipio: 'Albinyana', tipo: 'Iglesia / Ermita', lat: 41.2461, lng: 1.48638, img: "L'església Sant Bartomeu d'Albinyana.JPG" },

  // EL VENDRELL (incluye Sant Salvador como localidad)
  { qid: 'Q11938061', nom: 'Museu Pau Casals', municipio: 'El Vendrell', localidad: 'Sant Salvador', tipo: 'Museo', lat: 41.18316111, lng: 1.54153056, img: "Museu Pau Casals 02.JPG" },
  { qid: 'Q18007389', nom: 'Sant Salvador del Vendrell', municipio: 'El Vendrell', tipo: 'Iglesia / Ermita', lat: 41.2201, lng: 1.5352, img: "Església parroquial del Salvador (el Vendrell).jpg" },
  { qid: 'Q56586588', nom: 'Capella de Fàtima del Vendrell', municipio: 'El Vendrell', tipo: 'Iglesia / Ermita', lat: 41.22286, lng: 1.53465, img: "Capella de Fàtima (el Vendrell).jpg" },

  // BONASTRE
  { qid: 'Q30019617', nom: 'Santa Magdalena de Bonastre', municipio: 'Bonastre', tipo: 'Iglesia / Ermita', lat: 41.22217, lng: 1.44092, img: "Església de Santa Magdalena (Bonastre) - 1.jpg" },

  // CALAFELL
  { qid: 'Q11913016', nom: 'Castell de Calafell', municipio: 'Calafell', tipo: 'Castillo / Fortaleza', lat: 41.2017, lng: 1.56857, img: "Castell de Calafell IMG 9211.JPG" },
  { qid: 'Q83620241', nom: 'Confraria del Calafell Pescador', municipio: 'Calafell', tipo: 'Museo', lat: 41.186728712, lng: 1.56980163, img: null },
  { qid: 'Q18007484', nom: 'Santa Creu de Calafell', municipio: 'Calafell', tipo: 'Iglesia / Ermita', lat: 41.2007, lng: 1.5689, img: "080 L'església de la Santa Creu des del Castell.jpg" },
  { qid: 'Q8346545', nom: 'Ciutadella ibèrica de Calafell', municipio: 'Calafell', tipo: 'Yacimiento arqueológico', lat: 41.190486, lng: 1.581127, img: "Mapa ciudadela.jpg" },
  { qid: 'Q42659903', nom: 'El Vilarenc', municipio: 'Calafell', tipo: 'Yacimiento arqueológico', lat: 41.191535, lng: 1.569977, img: "El Vilarenc.jpg" },
  { qid: 'Q17602334', nom: 'Església de Sant Pere Pescador', municipio: 'Calafell', tipo: 'Iglesia / Ermita', lat: 41.1888, lng: 1.57232, img: "002 Església de Sant Pere Pescador.jpg" },

  // SANTA OLIVA
  { qid: 'Q18007636', nom: 'Santa Maria de Santa Oliva', municipio: 'Santa Oliva', tipo: 'Iglesia / Ermita', lat: 41.2499, lng: 1.54728, img: "Església parroquial de Santa Maria (Santa Oliva) - 1.jpg" },
  { qid: 'Q11913096', nom: 'Castell de Santa Oliva', municipio: 'Santa Oliva', tipo: 'Castillo / Fortaleza', lat: 41.25353333, lng: 1.54950833, img: "11 Castell església de la Verge del Remei (Santa Oliva), des del carrer de la Planeta.jpg" },

  // EL MONTMELL
  { qid: 'Q137367606', nom: 'Església romànica de Sant Miquel de Montmell', municipio: 'El Montmell', tipo: 'Iglesia / Ermita', lat: 41.332222222, lng: 1.459444444, img: "Església de Sant Miquel del Montmell (el Montmell) - 2.jpg" },
  { qid: 'Q18007012', nom: 'Sant Marc del Montmell', municipio: 'El Montmell', tipo: 'Iglesia / Ermita', lat: 41.3465, lng: 1.46626, img: "Ermita de Sant Marc (el Montmell) - 1.jpg" },
  { qid: 'Q18007154', nom: 'Sant Miquel del Montmell', municipio: 'El Montmell', tipo: 'Iglesia / Ermita', lat: 41.330143, lng: 1.456343, img: "Església nova de Sant Miquel (el Montmell) - 4.jpg" },

  // L'ARBOÇ
  { qid: 'Q5911421', nom: "Sant Julià de l'Arboç", municipio: "L'Arboç", tipo: 'Iglesia / Ermita', lat: 41.2679, lng: 1.6042, img: "Església de Sant Julià- a4.JPG" },
  { qid: 'Q61658756', nom: "Ermita de Sant Antoni de l'Arboç", municipio: "L'Arboç", tipo: 'Iglesia / Ermita', lat: 41.28721, lng: 1.62673, img: "Ermita de Sant Antoni (l'Arboç) - 2.jpg" },
];

(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  const client = await p.connect();

  let inserted = 0;
  let skipped = 0;
  let imagesInserted = 0;

  try {
    await client.query('BEGIN');

    for (const m of monumentos) {
      // Verificar duplicado por QID en wikidata
      const dup = await client.query(
        'SELECT bien_id FROM wikidata WHERE qid = $1',
        [m.qid]
      );
      if (dup.rows.length > 0) {
        console.log(`SKIP ${m.qid} ${m.nom} — ya existe (bien_id=${dup.rows[0].bien_id})`);
        skipped++;
        continue;
      }

      // INSERT bienes
      const r = await client.query(
        `INSERT INTO bienes (
          denominacion, tipo_monumento, comarca, municipio, localidad,
          comunidad_autonoma, pais, latitud, longitud, fuente_opendata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          m.nom,
          m.tipo,
          'Baix Penedès',
          m.municipio,
          m.localidad || null,
          'Catalunya',
          'España',
          m.lat,
          m.lng,
          0, // fuente_opendata
        ]
      );
      const bienId = r.rows[0].id;

      // INSERT wikidata
      const imageUrl = m.img ? COMMONS(m.img) : null;
      await client.query(
        `INSERT INTO wikidata (bien_id, qid, imagen_url) VALUES ($1, $2, $3)`,
        [bienId, m.qid, imageUrl]
      );

      // INSERT imagen (si tiene)
      if (m.img) {
        await client.query(
          `INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1, $2, $3, $4)`,
          [bienId, imageUrl, m.img, 'Wikimedia Commons']
        );
        imagesInserted++;
      }

      console.log(`OK   ${m.qid} ${m.nom} (bien_id=${bienId}${m.img ? ', con imagen' : ''})`);
      inserted++;
    }

    await client.query('COMMIT');

    console.log(`\n=== RESUMEN ===`);
    console.log(`Insertados: ${inserted}`);
    console.log(`Skipped:    ${skipped}`);
    console.log(`Imágenes:   ${imagesInserted}`);
    console.log(`Total:      ${monumentos.length}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERROR — rollback:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await p.end();
  }
})();
