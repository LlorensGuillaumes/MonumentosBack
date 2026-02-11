const db = require('./db.cjs');

async function main() {
    // Ejemplo de registro completo con datos de las 3 fuentes
    const result = await db.query(`
        SELECT b.denominacion, b.provincia, b.comarca, b.municipio, b.categoria,
               b.latitud, b.longitud,
               w.qid, w.estilo, w.arquitecto, w.inception, w.heritage_label,
               w.wikipedia_url, w.commons_category, w.imagen_url as wiki_img,
               s.descripcion_completa, s.sintesis_historica, s.datacion,
               s.periodo_historico, s.siglo, s.ubicacion_detalle,
               s.fuentes, s.bibliografia, s.url as sipca_url,
               (SELECT COUNT(*) FROM imagenes WHERE bien_id = b.id) as total_imgs,
               (SELECT COUNT(*) FROM imagenes WHERE bien_id = b.id AND fuente = 'wikidata') as wiki_imgs,
               (SELECT COUNT(*) FROM imagenes WHERE bien_id = b.id AND fuente = 'sipca') as sipca_imgs
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        JOIN sipca s ON b.id = s.bien_id
        WHERE w.qid IS NOT NULL AND s.descripcion_completa IS NOT NULL
        AND w.estilo IS NOT NULL
        ORDER BY total_imgs DESC
        LIMIT 3
    `);
    const full = result.rows;

    for (const r of full) {
        console.log('============================================');
        console.log(`${r.denominacion} (${r.municipio}, ${r.provincia})`);
        console.log(`  Categoria: ${r.categoria}`);
        console.log(`  Coordenadas: ${r.latitud}, ${r.longitud}`);
        console.log(`  -- Wikidata --`);
        console.log(`  QID: ${r.qid}`);
        console.log(`  Estilo: ${r.estilo}`);
        console.log(`  Arquitecto: ${r.arquitecto || 'n/a'}`);
        console.log(`  Inception: ${r.inception || 'n/a'}`);
        console.log(`  Heritage: ${r.heritage_label}`);
        console.log(`  Wikipedia: ${r.wikipedia_url}`);
        console.log(`  Commons: ${r.commons_category || 'n/a'}`);
        console.log(`  -- SIPCA --`);
        console.log(`  Datacion: ${r.datacion}`);
        console.log(`  Periodo: ${r.periodo_historico} / ${r.siglo}`);
        console.log(`  Ubicacion: ${r.ubicacion_detalle}`);
        console.log(`  Descripcion: ${r.descripcion_completa ? r.descripcion_completa.substring(0, 200) + '...' : 'n/a'}`);
        console.log(`  Sint. historica: ${r.sintesis_historica ? r.sintesis_historica.substring(0, 200) + '...' : 'n/a'}`);
        console.log(`  Fuentes: ${r.fuentes ? r.fuentes.substring(0, 100) + '...' : 'n/a'}`);
        console.log(`  URL SIPCA: ${r.sipca_url}`);
        console.log(`  -- Imagenes --`);
        console.log(`  Total: ${r.total_imgs} (Wikidata: ${r.wiki_imgs}, SIPCA: ${r.sipca_imgs})`);
        console.log('');
    }

    await db.cerrar();
}

main().catch(console.error);
