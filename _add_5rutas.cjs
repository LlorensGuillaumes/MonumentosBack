require('dotenv').config();
const { Pool } = require('pg');

const RUTAS = [
  {
    slug: 'muro-adriano', nombre: 'Muro de Adriano – Frontera del Imperio Romano',
    desc: 'La línea defensiva romana más importante del norte de Europa, 117 km de costa a costa',
    pais: 'Reino Unido', tema: 'roman', lat: 55.0, lng: -2.1, zoom: 9,
    paradas: [
      { orden: 1, nombre: 'Segedunum (Wallsend)', localidad: 'Wallsend', lat: 54.986, lng: -1.532, qid: 'Q2264667', tipo: 'Yacimiento arqueológico', pais: 'Reino Unido', desc: 'Inicio este del Muro de Adriano' },
      { orden: 2, nombre: 'Housesteads Roman Fort', localidad: 'Bardon Mill', lat: 55.012, lng: -2.332, qid: 'Q595181', tipo: 'Yacimiento arqueológico', pais: 'Reino Unido', desc: 'El fuerte romano más completo del muro' },
      { orden: 3, nombre: 'Vindolanda', localidad: 'Bardon Mill', lat: 54.991, lng: -2.360, qid: 'Q1234479', tipo: 'Yacimiento arqueológico', pais: 'Reino Unido', desc: 'Famoso por sus tablillas de madera escritas, s. I-II' },
      { orden: 4, nombre: 'Birdoswald Roman Fort', localidad: 'Gilsland', lat: 54.990, lng: -2.602, qid: 'Q865063', tipo: 'Yacimiento arqueológico', pais: 'Reino Unido', desc: 'Donde mejor se aprecia el muro y el foso original' },
    ]
  },
  {
    slug: 'castillos-cataros-completa', nombre: 'Castillos Cátaros – Ciudadelas del Vértigo',
    desc: 'Fortalezas inexpugnables en lo alto de crestas rocosas del Languedoc, testigos de la cruzada albigense',
    pais: 'Francia', tema: 'castles', lat: 42.95, lng: 2.3, zoom: 9,
    paradas: [
      { orden: 1, nombre: 'Cité de Carcassonne', localidad: 'Carcassonne', lat: 43.206, lng: 2.364, qid: 'Q6592', tipo: 'Castillo / Fortaleza', pais: 'Francia', desc: 'La ciudad medieval amurallada más famosa de Europa, UNESCO' },
      { orden: 2, nombre: 'Château de Peyrepertuse', localidad: 'Duilhac-sous-Peyrepertuse', lat: 42.870, lng: 2.555, qid: 'Q1013444', tipo: 'Castillo / Fortaleza', pais: 'Francia', desc: 'La nave de piedra sobre el abismo, 800m de largo' },
      { orden: 3, nombre: 'Château de Quéribus', localidad: 'Cucugnan', lat: 42.836, lng: 2.621, qid: 'Q538183', tipo: 'Castillo / Fortaleza', pais: 'Francia', desc: 'Último bastión de la resistencia cátara (1255)' },
      { orden: 4, nombre: 'Château de Montségur', localidad: 'Montségur', lat: 42.875, lng: 1.832, qid: 'Q11019', tipo: 'Castillo / Fortaleza', pais: 'Francia', desc: 'Símbolo de la tragedia cátara, caída en 1244' },
    ]
  },
  {
    slug: 'ruta-romantica-baviera', nombre: 'La Ruta Romántica – Baviera Medieval',
    desc: 'De Würzburg a Füssen, la esencia de la Alemania de cuento de hadas',
    pais: 'Alemania', tema: 'castles', lat: 48.5, lng: 10.4, zoom: 7,
    paradas: [
      { orden: 1, nombre: 'Würzburger Residenz', localidad: 'Würzburg', lat: 49.793, lng: 9.938, qid: 'Q154944', tipo: 'Palacio', pais: 'Alemania', desc: 'Palacio barroco UNESCO, frescos de Tiepolo' },
      { orden: 2, nombre: 'Rothenburg ob der Tauber', localidad: 'Rothenburg ob der Tauber', lat: 49.377, lng: 10.178, qid: 'Q163044', tipo: 'Conjunto arquitectónico', pais: 'Alemania', desc: 'Ciudad medieval mejor conservada de Alemania' },
      { orden: 3, nombre: 'Dinkelsbühl', localidad: 'Dinkelsbühl', lat: 49.069, lng: 10.319, qid: 'Q156382', tipo: 'Conjunto arquitectónico', pais: 'Alemania', desc: 'Casco antiguo intacto, murallas completas' },
      { orden: 4, nombre: 'Schloss Neuschwanstein', localidad: 'Schwangau', lat: 47.557, lng: 10.749, qid: 'Q4152', tipo: 'Palacio', pais: 'Alemania', desc: 'El castillo del Rey Loco Luis II, inspiración de Disney' },
    ]
  },
  {
    slug: 'monasterios-bucovina', nombre: 'Monasterios de Bucovina – Frescos Exteriores',
    desc: 'Iglesias del s. XV-XVI con fachadas totalmente pintadas al fresco, patrimonio UNESCO de Rumanía',
    pais: 'Rumanía', tema: 'monasteries', lat: 47.65, lng: 25.75, zoom: 10,
    paradas: [
      { orden: 1, nombre: 'Monasterio de Voroneț', localidad: 'Gura Humorului', lat: 47.517, lng: 25.864, qid: 'Q513904', tipo: 'Monasterio / Convento', pais: 'Rumanía', desc: 'El Juicio Final y el famoso azul de Voroneț' },
      { orden: 2, nombre: 'Monasterio de Sucevița', localidad: 'Sucevița', lat: 47.778, lng: 25.711, qid: 'Q266580', tipo: 'Monasterio / Convento', pais: 'Rumanía', desc: 'La Escala de las Virtudes, el más grande de los monasterios pintados' },
      { orden: 3, nombre: 'Monasterio de Moldovița', localidad: 'Vatra Moldoviței', lat: 47.657, lng: 25.571, qid: 'Q2415383', tipo: 'Monasterio / Convento', pais: 'Rumanía', desc: 'Fresco del Asedio de Constantinopla' },
      { orden: 4, nombre: 'Monasterio de Humor', localidad: 'Mănăstirea Humorului', lat: 47.593, lng: 25.856, qid: 'Q1058284', tipo: 'Monasterio / Convento', pais: 'Rumanía', desc: 'De los más pequeños pero mejor decorados' },
    ]
  },
  {
    slug: 'sitios-reales-espana', nombre: 'Sitios Reales de España – Patrimonio Nacional',
    desc: 'El eje del poder de la monarquía hispánica: palacios, monasterios y jardines reales',
    pais: 'España', tema: 'palaces', lat: 40.5, lng: -3.8, zoom: 7,
    paradas: [
      { orden: 1, nombre: 'Palacio Real de Madrid', localidad: 'Madrid', lat: 40.417, lng: -3.714, qid: 'Q171511', tipo: 'Palacio', pais: 'España', desc: 'Palacio real más grande de Europa Occidental' },
      { orden: 2, nombre: 'Monasterio de El Escorial', localidad: 'San Lorenzo de El Escorial', lat: 40.589, lng: -4.147, qid: 'Q28471', tipo: 'Monasterio / Convento', pais: 'España', desc: 'Octava maravilla del mundo, panteón real' },
      { orden: 3, nombre: 'Palacio Real de Aranjuez', localidad: 'Aranjuez', lat: 40.036, lng: -3.608, qid: 'Q464955', tipo: 'Palacio', pais: 'España', desc: 'Jardines a orillas del Tajo, paisaje cultural UNESCO' },
      { orden: 4, nombre: 'Palacio Real de La Granja', localidad: 'San Ildefonso', lat: 40.897, lng: -4.004, qid: 'Q1140026', tipo: 'Palacio', pais: 'España', desc: 'El Versalles español y sus fuentes monumentales' },
      { orden: 5, nombre: 'Monasterio de las Huelgas', localidad: 'Burgos', lat: 42.336, lng: -3.721, qid: 'Q1462080', tipo: 'Monasterio / Convento', pais: 'España', desc: 'Panteón de reyes de Castilla, fundado en 1187' },
    ]
  },
];

async function run(connConfig, label) {
  const pool = new Pool(connConfig);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const ruta of RUTAS) {
      const rutaRes = await client.query(`
        INSERT INTO rutas_culturales (slug,nombre,descripcion,pais,tema,centro_lat,centro_lng,zoom,num_paradas,activa)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
        ON CONFLICT(slug) DO UPDATE SET nombre=EXCLUDED.nombre,descripcion=EXCLUDED.descripcion,
          centro_lat=EXCLUDED.centro_lat,centro_lng=EXCLUDED.centro_lng,zoom=EXCLUDED.zoom,
          num_paradas=EXCLUDED.num_paradas,updated_at=NOW()
        RETURNING id
      `, [ruta.slug, ruta.nombre, ruta.desc, ruta.pais, ruta.tema, ruta.lat, ruta.lng, ruta.zoom, ruta.paradas.length]);
      const rutaId = rutaRes.rows[0].id;
      await client.query('DELETE FROM rutas_culturales_paradas WHERE ruta_id=$1', [rutaId]);

      for (const p of ruta.paradas) {
        const bienRes = await client.query(
          `INSERT INTO bienes(denominacion,latitud,longitud,pais,codigo_fuente,tipo_monumento)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(pais,comunidad_autonoma,codigo_fuente) DO UPDATE
             SET denominacion=EXCLUDED.denominacion,latitud=EXCLUDED.latitud,longitud=EXCLUDED.longitud,updated_at=NOW()
           RETURNING id`,
          [p.nombre, p.lat, p.lng, p.pais, 'wikidata-' + p.qid, p.tipo]);
        const bienId = bienRes.rows[0].id;
        const ex = await client.query('SELECT id FROM wikidata WHERE bien_id=$1', [bienId]);
        if (ex.rows.length > 0) await client.query('UPDATE wikidata SET qid=$1,descripcion=$2 WHERE bien_id=$3', [p.qid, p.desc, bienId]);
        else await client.query('INSERT INTO wikidata(bien_id,qid,descripcion) VALUES($1,$2,$3)', [bienId, p.qid, p.desc]);
        await client.query(
          `INSERT INTO rutas_culturales_paradas(ruta_id,bien_id,orden,nombre,localidad,latitud,longitud)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [rutaId, bienId, p.orden, p.nombre, p.localidad, p.lat, p.lng]);
        console.log(label + ': [' + ruta.slug + '] ' + p.orden + '. ' + p.nombre + ' -> ' + bienId);
      }
      console.log(label + ': ' + ruta.slug + ' id=' + rutaId + ' OK');
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); console.error(label + ' ERR:', e.message); }
  finally { client.release(); await pool.end(); }
}

(async () => {
  await run({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } }, 'NEON');
  await run({ host: 'localhost', port: 5433, user: 'patrimonio', password: 'patrimonio2026', database: 'patrimonio' }, 'LOCAL');
})();
