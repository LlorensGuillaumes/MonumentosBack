const db = require('./db.cjs');

async function main() {
    // Cuántos sin coords en Andalucía
    const total = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL)")).rows[0];
    console.log('Andalucía sin coords:', total.c);

    // Cuántos tienen QID
    const conQid = (await db.query(`
      SELECT COUNT(*) as c FROM bienes b
      JOIN wikidata w ON b.id = w.bien_id
      WHERE b.comunidad_autonoma='Andalucia' AND (b.latitud IS NULL OR b.longitud IS NULL)
      AND w.qid IS NOT NULL
    `)).rows[0];
    console.log('Con QID:', conQid.c);

    // Cuántos tienen municipio
    const conMuni = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL) AND municipio IS NOT NULL AND municipio != ''")).rows[0];
    console.log('Con municipio:', conMuni.c);

    // Cuántos tienen provincia
    const conProv = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL) AND provincia IS NOT NULL AND provincia != ''")).rows[0];
    console.log('Con provincia:', conProv.c);

    // Cuántos tienen comarca
    const conComarca = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL) AND comarca IS NOT NULL AND comarca != ''")).rows[0];
    console.log('Con comarca:', conComarca.c);

    // Cuántos tienen localidad
    const conLocalidad = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL) AND localidad IS NOT NULL AND localidad != ''")).rows[0];
    console.log('Con localidad:', conLocalidad.c);

    // Cuántos tienen codigo_fuente (IAPH ID)
    const conCodigo = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL) AND codigo_fuente IS NOT NULL AND codigo_fuente != ''")).rows[0];
    console.log('Con codigo_fuente:', conCodigo.c);

    // Veamos el tipo de datos que tienen
    const sample = (await db.query(`
      SELECT b.id, b.denominacion, b.municipio, b.provincia, b.localidad, b.comarca, b.tipo, b.categoria, b.codigo_fuente,
             w.qid, w.descripcion, w.imagen_url
      FROM bienes b
      LEFT JOIN wikidata w ON b.id = w.bien_id
      WHERE b.comunidad_autonoma='Andalucia' AND (b.latitud IS NULL OR b.longitud IS NULL)
      LIMIT 15
    `)).rows;
    console.log('\nSample (15 items):');
    sample.forEach(r => {
      console.log(`  [${r.id}] ${r.denominacion}`);
      console.log(`    muni=${r.municipio} | prov=${r.provincia} | loc=${r.localidad} | comarca=${r.comarca}`);
      console.log(`    tipo=${r.tipo} | cat=${r.categoria} | cod=${r.codigo_fuente} | qid=${r.qid}`);
    });

    // Por provincia, cuántos sin coords
    const porProv = (await db.query(`
      SELECT provincia, COUNT(*) as c
      FROM bienes
      WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL)
      GROUP BY provincia ORDER BY c DESC
    `)).rows;
    console.log('\nPor provincia:');
    porProv.forEach(r => console.log(`  ${r.provincia || '(null)'}: ${r.c}`));

    // Cuántos tienen descripción en wikidata con posibles pistas de ubicación
    const conDescripcion = (await db.query(`
      SELECT COUNT(*) as c FROM bienes b
      JOIN wikidata w ON b.id = w.bien_id
      WHERE b.comunidad_autonoma='Andalucia' AND (b.latitud IS NULL OR b.longitud IS NULL)
      AND w.descripcion IS NOT NULL AND w.descripcion != ''
    `)).rows[0];
    console.log('\nCon descripción Wikidata:', conDescripcion.c);

    // Verificar si fase1_andalucia --con-detalle podría ayudar
    // Miremos cuántos tienen codigo_fuente que empiece con patterns de IAPH
    const iaphCodes = (await db.query(`
      SELECT substr(codigo_fuente, 1, 2) as prefix, COUNT(*) as c
      FROM bienes
      WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL)
      AND codigo_fuente IS NOT NULL
      GROUP BY prefix ORDER BY c DESC LIMIT 10
    `)).rows;
    console.log('\nPrefijos codigo_fuente:');
    iaphCodes.forEach(r => console.log(`  ${r.prefix}: ${r.c}`));

    await db.cerrar();
}

main();
