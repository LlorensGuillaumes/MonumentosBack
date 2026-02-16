const db = require('./db.cjs');

(async () => {
  console.log('=== ESTADISTICAS GENERALES ===');
  const total = (await db.query('SELECT COUNT(*) as n FROM bienes')).rows[0].n;
  console.log('Total bienes:', total);

  const porPais = (await db.query('SELECT pais, COUNT(*) as n FROM bienes GROUP BY pais ORDER BY n DESC')).rows;
  porPais.forEach(r => console.log('  ' + r.pais + ': ' + r.n));

  const conCoords = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL AND longitud IS NOT NULL')).rows[0].n;
  console.log('Con coordenadas:', conCoords, '(' + (conCoords / total * 100).toFixed(1) + '%)');

  const conQid = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL')).rows[0].n;
  console.log('Con Wikidata QID:', conQid, '(' + (conQid / total * 100).toFixed(1) + '%)');

  const conWiki = (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE wikipedia_url IS NOT NULL AND wikipedia_url != ''")).rows[0].n;
  console.log('Con Wikipedia:', conWiki);

  const wikiReal = (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE wikipedia_url IS NOT NULL AND wikipedia_url != '' AND wikipedia_url NOT LIKE '%wikidata.org%'")).rows[0].n;
  console.log('Wikipedia real (no wikidata.org):', wikiReal);

  const imgs = (await db.query('SELECT COUNT(*) as n FROM imagenes')).rows[0].n;
  console.log('Imagenes:', imgs);

  const descs = (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE descripcion IS NOT NULL AND descripcion != ''")).rows[0].n;
  console.log('Descripciones:', descs);

  // Coordenadas por pais
  console.log('\n=== COORDENADAS POR PAIS ===');
  const coordsPais = (await db.query('SELECT pais, COUNT(*) as total, SUM(CASE WHEN latitud IS NOT NULL THEN 1 ELSE 0 END) as con_coords FROM bienes GROUP BY pais ORDER BY total DESC')).rows;
  coordsPais.forEach(r => console.log('  ' + r.pais + ': ' + r.con_coords + '/' + r.total + ' (' + (parseInt(r.con_coords) / parseInt(r.total) * 100).toFixed(1) + '%)'));

  // CCAA España
  const ccaa = (await db.query("SELECT comunidad_autonoma, COUNT(*) as n FROM bienes WHERE pais = 'España' GROUP BY comunidad_autonoma ORDER BY n DESC")).rows;
  console.log('\n=== CCAA ESPAÑA (' + ccaa.length + ' comunidades) ===');
  ccaa.forEach(r => console.log('  ' + r.comunidad_autonoma + ': ' + r.n));

  // QID por pais
  console.log('\n=== WIKIDATA QID POR PAIS ===');
  const qidPais = (await db.query('SELECT b.pais, COUNT(w.id) as con_qid, COUNT(b.id) as total FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id GROUP BY b.pais ORDER BY total DESC')).rows;
  qidPais.forEach(r => console.log('  ' + r.pais + ': ' + r.con_qid + '/' + r.total + ' (' + (parseInt(r.con_qid) / parseInt(r.total) * 100).toFixed(1) + '%)'));

  // Imágenes por fuente
  console.log('\n=== IMAGENES POR FUENTE ===');
  const imgFuente = (await db.query('SELECT fuente, COUNT(*) as n FROM imagenes GROUP BY fuente ORDER BY n DESC')).rows;
  imgFuente.forEach(r => console.log('  ' + (r.fuente || 'NULL') + ': ' + r.n));

  // === INTEGRIDAD ===
  console.log('\n=== INTEGRIDAD ===');

  const wikHuerf = (await db.query('SELECT COUNT(*) as n FROM wikidata w LEFT JOIN bienes b ON w.bien_id = b.id WHERE b.id IS NULL')).rows[0].n;
  console.log('Wikidata huerfanos:', wikHuerf);

  const imgHuerf = (await db.query('SELECT COUNT(*) as n FROM imagenes i LEFT JOIN bienes b ON i.bien_id = b.id WHERE b.id IS NULL')).rows[0].n;
  console.log('Imagenes huerfanas:', imgHuerf);

  const favHuerf = (await db.query('SELECT COUNT(*) as n FROM favoritos f LEFT JOIN bienes b ON f.bien_id = b.id WHERE b.id IS NULL')).rows[0].n;
  console.log('Favoritos huerfanos:', favHuerf);

  const latBad = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL AND (latitud < -90 OR latitud > 90)')).rows[0].n;
  const lonBad = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE longitud IS NOT NULL AND (longitud < -180 OR longitud > 180)')).rows[0].n;
  console.log('Coords fuera de rango:', latBad, 'lat,', lonBad, 'lon');

  const fueraEuropa = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL AND (latitud < 27 OR latitud > 72 OR longitud < -32 OR longitud > 45)')).rows[0].n;
  console.log('Coords fuera de Europa:', fueraEuropa);

  const httpImgs = (await db.query("SELECT COUNT(*) as n FROM imagenes WHERE url LIKE 'http://%'")).rows[0].n;
  const httpWikiImg = (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE imagen_url LIKE 'http://%'")).rows[0].n;
  const httpWp = (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE wikipedia_url LIKE 'http://%'")).rows[0].n;
  console.log('URLs http:// en imagenes:', httpImgs);
  console.log('URLs http:// en wikidata imgs:', httpWikiImg);
  console.log('URLs http:// en wikipedia:', httpWp);

  const dupes = (await db.query('SELECT COUNT(*) as n FROM (SELECT pais, comunidad_autonoma, codigo_fuente, COUNT(*) as c FROM bienes GROUP BY pais, comunidad_autonoma, codigo_fuente HAVING COUNT(*) > 1) sub')).rows[0].n;
  console.log('Duplicados (pais+ccaa+codigo):', dupes);

  const paisNull = (await db.query("SELECT COUNT(*) as n FROM bienes WHERE pais IS NULL OR pais = ''")).rows[0].n;
  console.log('Pais NULL/vacio:', paisNull);

  const denomNull = (await db.query("SELECT COUNT(*) as n FROM bienes WHERE denominacion IS NULL OR denominacion = ''")).rows[0].n;
  console.log('Denominacion NULL/vacia:', denomNull);

  // Italia regioni
  const itRegioni = (await db.query("SELECT comunidad_autonoma, COUNT(*) as n FROM bienes WHERE pais = 'Italia' GROUP BY comunidad_autonoma ORDER BY n DESC")).rows;
  console.log('\n=== ITALIA REGIONI (' + itRegioni.length + ') ===');
  itRegioni.forEach(r => console.log('  ' + r.comunidad_autonoma + ': ' + r.n));

  // Francia regiones
  const frRegs = (await db.query("SELECT comunidad_autonoma, COUNT(*) as n FROM bienes WHERE pais = 'Francia' GROUP BY comunidad_autonoma ORDER BY n DESC LIMIT 10")).rows;
  console.log('\n=== FRANCIA TOP 10 REGIONES ===');
  frRegs.forEach(r => console.log('  ' + r.comunidad_autonoma + ': ' + r.n));

  // Portugal distritos
  const ptDist = (await db.query("SELECT comunidad_autonoma, COUNT(*) as n FROM bienes WHERE pais = 'Portugal' GROUP BY comunidad_autonoma ORDER BY n DESC")).rows;
  console.log('\n=== PORTUGAL DISTRITOS (' + ptDist.length + ') ===');
  ptDist.forEach(r => console.log('  ' + r.comunidad_autonoma + ': ' + r.n));

  console.log('\n=== FIN VERIFICACION ===');
  await db.cerrar();
})();
