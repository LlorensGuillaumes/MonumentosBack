const fs = require('fs');
const db = require('./db.cjs');

async function main() {
    console.log('Exportando a GeoJSON...');

    // Obtener bienes con coordenadas
    const result = await db.query(`
        SELECT
            b.*,
            w.qid, w.descripcion as wiki_desc, w.imagen_url, w.arquitecto, w.estilo,
            w.wikipedia_url, w.commons_category,
            s.descripcion_completa, s.sintesis_historica, s.datacion, s.periodo_historico
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        LEFT JOIN sipca s ON b.id = s.bien_id
        WHERE b.latitud IS NOT NULL AND b.longitud IS NOT NULL
        ORDER BY b.pais, b.comunidad_autonoma, b.provincia, b.municipio
    `);
    const bienes = result.rows;

    console.log(`  Bienes con coordenadas: ${bienes.length}`);

    const features = bienes.map(b => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [b.longitud, b.latitud]
        },
        properties: {
            id: b.id,
            nombre: b.denominacion,
            tipo: b.tipo,
            categoria: b.categoria,
            provincia: b.provincia,
            comarca: b.comarca,
            municipio: b.municipio,
            comunidad: b.comunidad_autonoma,
            pais: b.pais,
            // Wikidata
            qid: b.qid || null,
            descripcion: b.wiki_desc || b.descripcion_completa || null,
            imagen: b.imagen_url || null,
            arquitecto: b.arquitecto || null,
            estilo: b.estilo || null,
            wikipedia: b.wikipedia_url || null,
            // Datación
            datacion: b.datacion || null,
            periodo: b.periodo_historico || null,
        }
    }));

    const geojson = {
        type: 'FeatureCollection',
        name: 'Patrimonio Arquitectonico Europeo',
        generated: new Date().toISOString(),
        features: features
    };

    fs.writeFileSync('patrimonio.geojson', JSON.stringify(geojson, null, 2));

    // Estadísticas
    const porRegion = {};
    features.forEach(f => {
        const r = f.properties.comunidad;
        porRegion[r] = (porRegion[r] || 0) + 1;
    });

    console.log('\nExportado: patrimonio.geojson');
    console.log(`  Features totales: ${features.length}`);
    console.log('  Por región:');
    Object.entries(porRegion).sort((a,b) => b[1]-a[1]).forEach(([r, n]) => {
        console.log(`    ${r}: ${n}`);
    });

    const size = (fs.statSync('patrimonio.geojson').size / 1024 / 1024).toFixed(1);
    console.log(`  Tamaño: ${size} MB`);

    await db.cerrar();
}

main().catch(console.error);
