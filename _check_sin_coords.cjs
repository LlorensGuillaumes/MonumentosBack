const db = require('./db.cjs');

async function main() {
    const total = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE latitud IS NULL OR longitud IS NULL")).rows[0];
    console.log('Total sin coords:', total.c);

    const conMuni = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE (latitud IS NULL OR longitud IS NULL) AND municipio IS NOT NULL AND municipio != ''")).rows[0];
    console.log('Con municipio:', conMuni.c);

    const conProv = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE (latitud IS NULL OR longitud IS NULL) AND provincia IS NOT NULL AND provincia != ''")).rows[0];
    console.log('Con provincia:', conProv.c);

    const conCCAA = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE (latitud IS NULL OR longitud IS NULL) AND comunidad_autonoma IS NOT NULL AND comunidad_autonoma != ''")).rows[0];
    console.log('Con CCAA/region:', conCCAA.c);

    // Desglose por país
    const porPais = (await db.query(`
      SELECT pais, COUNT(*) as c
      FROM bienes
      WHERE latitud IS NULL OR longitud IS NULL
      GROUP BY pais ORDER BY c DESC
    `)).rows;
    console.log('\nPor país:');
    porPais.forEach(r => console.log(`  ${r.pais}: ${r.c}`));

    // Desglose Andalucía
    const andSinCoords = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL)")).rows[0];
    const andConMuni = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL) AND municipio IS NOT NULL AND municipio != ''")).rows[0];
    console.log('\nAndalucía sin coords:', andSinCoords.c, '(con municipio:', andConMuni.c + ')');

    // Sample de Andalucía sin coords para ver qué datos tienen
    const sample = (await db.query(`
      SELECT denominacion, municipio, provincia, comunidad_autonoma
      FROM bienes
      WHERE comunidad_autonoma='Andalucia' AND (latitud IS NULL OR longitud IS NULL)
      LIMIT 10
    `)).rows;
    console.log('\nSample Andalucía sin coords:');
    sample.forEach(r => console.log(`  ${r.denominacion} | muni=${r.municipio} | prov=${r.provincia}`));

    // Francia sin coords con municipio
    const fraSinCoords = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE pais='Francia' AND (latitud IS NULL OR longitud IS NULL)")).rows[0];
    const fraConMuni = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE pais='Francia' AND (latitud IS NULL OR longitud IS NULL) AND municipio IS NOT NULL AND municipio != ''")).rows[0];
    console.log('\nFrancia sin coords:', fraSinCoords.c, '(con municipio:', fraConMuni.c + ')');

    // Portugal sin coords con municipio
    const ptSinCoords = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE pais='Portugal' AND (latitud IS NULL OR longitud IS NULL)")).rows[0];
    const ptConMuni = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE pais='Portugal' AND (latitud IS NULL OR longitud IS NULL) AND municipio IS NOT NULL AND municipio != ''")).rows[0];
    console.log('Portugal sin coords:', ptSinCoords.c, '(con municipio:', ptConMuni.c + ')');

    await db.cerrar();
}

main();
