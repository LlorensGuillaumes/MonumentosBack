const db = require('./db.cjs');
async function stats() {
  const total = await db.query('SELECT COUNT(*) as n FROM bienes');
  const conWikidata = await db.query('SELECT COUNT(*) as n FROM wikidata');
  const conQid = await db.query("SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL");
  const sinQid = await db.query("SELECT COUNT(*) as n FROM wikidata WHERE qid IS NULL");
  const conWikipedia = await db.query("SELECT COUNT(*) as n FROM wikidata WHERE wikipedia_url IS NOT NULL");
  const conImagen = await db.query("SELECT COUNT(*) as n FROM wikidata WHERE imagen_url IS NOT NULL");
  const conDescripcion = await db.query("SELECT COUNT(*) as n FROM wikidata WHERE descripcion IS NOT NULL AND LENGTH(descripcion) > 10");
  const conCoords = await db.query("SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL AND longitud IS NOT NULL");
  const conEstilo = await db.query("SELECT COUNT(*) as n FROM wikidata WHERE estilo IS NOT NULL");
  const conArquitecto = await db.query("SELECT COUNT(*) as n FROM wikidata WHERE arquitecto IS NOT NULL");
  const conInception = await db.query("SELECT COUNT(*) as n FROM wikidata WHERE inception IS NOT NULL");
  const conCommons = await db.query("SELECT COUNT(*) as n FROM wikidata WHERE commons_category IS NOT NULL");

  const t = parseInt(total.rows[0].n);
  const w = parseInt(conWikidata.rows[0].n);
  const q = parseInt(conQid.rows[0].n);

  console.log('=== ESTADISTICAS GENERALES ===');
  console.log('Total monumentos:      ', t);
  console.log('Con registro Wikidata: ', w, '(' + (w/t*100).toFixed(1) + '%)');
  console.log('Con QID valido:        ', q, '(' + (q/t*100).toFixed(1) + '%)');
  console.log('QID limpiados/sin dato:', parseInt(sinQid.rows[0].n));
  console.log('Con Wikipedia URL:     ', parseInt(conWikipedia.rows[0].n), '(' + (parseInt(conWikipedia.rows[0].n)/t*100).toFixed(1) + '%)');
  console.log('Con imagen:            ', parseInt(conImagen.rows[0].n), '(' + (parseInt(conImagen.rows[0].n)/t*100).toFixed(1) + '%)');
  console.log('Con descripcion:       ', parseInt(conDescripcion.rows[0].n), '(' + (parseInt(conDescripcion.rows[0].n)/t*100).toFixed(1) + '%)');
  console.log('Con coordenadas:       ', parseInt(conCoords.rows[0].n), '(' + (parseInt(conCoords.rows[0].n)/t*100).toFixed(1) + '%)');
  console.log('Con estilo:            ', parseInt(conEstilo.rows[0].n), '(' + (parseInt(conEstilo.rows[0].n)/t*100).toFixed(1) + '%)');
  console.log('Con arquitecto:        ', parseInt(conArquitecto.rows[0].n), '(' + (parseInt(conArquitecto.rows[0].n)/t*100).toFixed(1) + '%)');
  console.log('Con inception (fecha): ', parseInt(conInception.rows[0].n), '(' + (parseInt(conInception.rows[0].n)/t*100).toFixed(1) + '%)');
  console.log('Con Commons category:  ', parseInt(conCommons.rows[0].n), '(' + (parseInt(conCommons.rows[0].n)/t*100).toFixed(1) + '%)');

  const porPais = await db.query(`
    SELECT b.pais, COUNT(DISTINCT b.id) as total,
      COUNT(DISTINCT CASE WHEN w.qid IS NOT NULL THEN b.id END) as con_qid,
      COUNT(DISTINCT CASE WHEN w.wikipedia_url IS NOT NULL THEN b.id END) as con_wiki,
      COUNT(DISTINCT CASE WHEN w.imagen_url IS NOT NULL THEN b.id END) as con_imagen,
      COUNT(DISTINCT CASE WHEN b.latitud IS NOT NULL THEN b.id END) as con_coords
    FROM bienes b
    LEFT JOIN wikidata w ON b.id = w.bien_id
    GROUP BY b.pais ORDER BY total DESC
  `);

  console.log('\n=== POR PAIS ===');
  console.log('Pais       | Total  | QID          | Wikipedia    | Imagen       | Coords');
  console.log('-'.repeat(90));
  for (const r of porPais.rows) {
    const rt = parseInt(r.total);
    const pad = (s, n) => String(s).padEnd(n);
    const pct = (v) => (parseInt(v)/rt*100).toFixed(1) + '%';
    console.log(
      pad(r.pais || '?', 11) + '| ' +
      pad(rt, 7) + '| ' +
      pad(r.con_qid + ' (' + pct(r.con_qid) + ')', 13) + '| ' +
      pad(r.con_wiki + ' (' + pct(r.con_wiki) + ')', 13) + '| ' +
      pad(r.con_imagen + ' (' + pct(r.con_imagen) + ')', 13) + '| ' +
      r.con_coords + ' (' + pct(r.con_coords) + ')'
    );
  }

  process.exit(0);
}
stats();
