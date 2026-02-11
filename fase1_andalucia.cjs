const axios = require('axios');
const db = require('./db.cjs');

const API_BASE = 'https://www.juntadeandalucia.es/datosabiertos/portal/iaph/dataset/bien/inmueble';
const ROWS_PER_PAGE = 100;
const DELAY_MS = 300;
const DETAIL_DELAY_MS = 500;

async function ejecutar() {
    const conDetalle = process.argv.includes('--con-detalle');
    const soloDetalle = process.argv.includes('--solo-detalle');

    console.log('=== FASE 1 ANDALUCIA: Descarga IAPH (Bienes Inmuebles) ===\n');

    if (soloDetalle) {
        console.log('  MODO SOLO-DETALLE: Descargando coordenadas/descripcion para bienes existentes.');
        console.log('  (Esto puede tardar varias horas)\n');
        await descargarDetalles();
        const stats = await db.estadisticas();
        console.log(`\nFase 1 Andalucia (solo-detalle) completada:`);
        console.log(`  - Total en BD: ${stats.bienes}`);
        await db.cerrar();
        return;
    }

    if (conDetalle) {
        console.log('  MODO DETALLE: Se descargaran coordenadas, descripcion e imagenes por cada bien.');
        console.log('  (Esto puede tardar varias horas)\n');
    }

    // Limpiar datos anteriores de Andalucia
    const existentes = (await db.obtenerBienesPorRegion('Andalucia')).length;
    if (existentes > 0) {
        console.log(`Limpiando ${existentes} registros anteriores de Andalucia...`);
        await db.limpiarBienesPorRegion('Andalucia');
    }

    let todos = [];
    let page = 0;
    let totalRegistros = null;

    console.log('Descargando listado de bienes inmuebles...');

    while (true) {
        const url = `${API_BASE}?page=${page}&rows=${ROWS_PER_PAGE}&format=json`;

        console.log(`  Pagina ${page + 1} (offset=${page * ROWS_PER_PAGE})...`);
        let response;
        try {
            response = await axios.get(url, { timeout: 30000 });
        } catch (err) {
            console.error(`  Error en pagina ${page + 1}: ${err.message}`);
            // Retry once
            await sleep(2000);
            try {
                response = await axios.get(url, { timeout: 30000 });
            } catch (err2) {
                console.error(`  Segundo intento fallido, deteniendo: ${err2.message}`);
                break;
            }
        }

        const data = response.data;
        const solr = data.response || data;

        if (totalRegistros === null) {
            totalRegistros = solr.numFound || 0;
            console.log(`  Total de registros en API: ${totalRegistros}`);
        }

        const resultados = solr.docs || data.resultados || data.results || [];
        if (resultados.length === 0) break;

        for (const item of resultados) {
            todos.push(mapearBien(item));
        }

        console.log(`    -> ${resultados.length} registros (total acumulado: ${todos.length})`);

        if (todos.length >= totalRegistros) break;
        if (resultados.length < ROWS_PER_PAGE) break;

        page++;
        await sleep(DELAY_MS);
    }

    if (todos.length === 0) {
        console.log('No se obtuvieron registros de Andalucia.');
        await db.cerrar();
        return;
    }

    console.log(`\nInsertando ${todos.length} bienes en base de datos...`);
    await db.upsertBienes(todos);

    // Fase de detalle opcional
    if (conDetalle) {
        console.log(`\nDescargando detalles para ${todos.length} bienes...`);
        await descargarDetalles();
    }

    const stats = await db.estadisticas();
    console.log(`\nFase 1 Andalucia completada:`);
    console.log(`  - Bienes insertados: ${todos.length}`);
    console.log(`  - Total en BD: ${stats.bienes}`);

    await db.cerrar();
}

function mapearBien(item) {
    return {
        denominacion: limpiarTexto(item.denominacion) || 'Sin denominacion',
        tipo: null,
        clase: null,
        categoria: limpiarTexto(item.caracterizacion) || null,
        provincia: limpiarTexto(item.provincia) || null,
        comarca: null,
        municipio: limpiarTexto(item.municipio) || null,
        localidad: null,
        latitud: null,
        longitud: null,
        situacion: null,
        resolucion: null,
        publicacion: null,
        fuente_opendata: 0,
        comunidad_autonoma: 'Andalucia',
        codigo_fuente: limpiarTexto(item.id) || String(item.id) || null,
        pais: 'España',
    };
}

async function descargarDetalles() {
    // Solo procesar items que faltan datos (municipio o coordenadas)
    const todosAndalucia = await db.obtenerBienesPorRegion('Andalucia');
    const bienes = todosAndalucia.filter(b =>
        b.codigo_fuente && (b.municipio === null || b.latitud === null)
    );

    console.log(`  Items de Andalucia total: ${todosAndalucia.length}`);
    console.log(`  Items sin municipio o coords: ${bienes.length}`);

    if (bienes.length === 0) {
        console.log('  Todos los items ya tienen datos completos.');
        return;
    }

    let actualizados = 0;
    let errores = 0;
    let coordsEncontradas = 0;
    let municipiosEncontrados = 0;

    for (let i = 0; i < bienes.length; i++) {
        const bien = bienes[i];

        if ((i + 1) % 100 === 0 || i === 0) {
            console.log(`  [${i + 1}/${bienes.length}] ${bien.denominacion}...`);
        }

        try {
            const url = `${API_BASE.replace('/inmueble', '')}/inmueble/${bien.codigo_fuente}?format=json`;
            const response = await axios.get(url, { timeout: 15000 });
            const detalle = response.data;

            // CRITICO: Coordenadas INVERTIDAS en la API IAPH
            // longitud_s = latitud real, latitud_s = longitud real
            let lat = parseFloat(detalle.longitud_s) || null;
            let lon = parseFloat(detalle.latitud_s) || null;

            // Municipio y provincia del detalle
            const municipio = limpiarTexto(detalle.municipio);
            const provincia = limpiarTexto(detalle.provincia);

            // Actualizar municipio/provincia si faltaban
            if (municipio && !bien.municipio) {
                await db.query(
                    'UPDATE bienes SET municipio = ?, provincia = ? WHERE id = ?',
                    [municipio, provincia, bien.id]
                );
                municipiosEncontrados++;
            }

            // Validar rango Andalucia (lat 36-38.5, lon -7.5 a -1.6)
            if (lat && lon && lat >= 36 && lat <= 39 && lon >= -8 && lon <= -1) {
                await db.query(
                    'UPDATE bienes SET latitud = ?, longitud = ? WHERE id = ?',
                    [lat, lon, bien.id]
                );
                coordsEncontradas++;
            }

            // Descripcion e historia
            const desc = limpiarTexto(detalle.descripcion) || limpiarTexto(detalle.analisis);
            const historia = limpiarTexto(detalle.historia) || limpiarTexto(detalle.datacion_historica);
            if (desc || historia) {
                await db.insertarSipca({
                    bien_id: bien.id,
                    sipca_id: null,
                    descripcion_completa: desc || null,
                    sintesis_historica: historia || null,
                    datacion: limpiarTexto(detalle.datacion) || null,
                    periodo_historico: limpiarTexto(detalle.periodo_historico) || null,
                    siglo: null,
                    ubicacion_detalle: limpiarTexto(detalle.direccion) || null,
                    fuentes: null,
                    bibliografia: limpiarTexto(detalle.bibliografia) || null,
                    meta_description: null,
                    url: `https://www.iaph.es/patrimonio-inmueble-andalucia/resumen.do?id=${bien.codigo_fuente}`,
                });
            }

            // Imagenes
            if (detalle.imagenes && Array.isArray(detalle.imagenes)) {
                for (const img of detalle.imagenes) {
                    const imgUrl = img.url || img.imagen;
                    if (imgUrl) {
                        await db.insertarImagen({
                            bien_id: bien.id,
                            url: imgUrl,
                            titulo: limpiarTexto(img.titulo) || bien.denominacion,
                            autor: limpiarTexto(img.autor) || null,
                            fuente: 'iaph',
                        });
                    }
                }
            }

            actualizados++;
        } catch (err) {
            errores++;
        }

        await sleep(DETAIL_DELAY_MS);
    }

    console.log(`\n  Resultados:`);
    console.log(`    - Items procesados: ${actualizados + errores}`);
    console.log(`    - Municipios encontrados: ${municipiosEncontrados}`);
    console.log(`    - Coordenadas encontradas: ${coordsEncontradas}`);
    console.log(`    - Errores: ${errores}`);
}

function limpiarTexto(valor) {
    if (valor === null || valor === undefined) return null;
    const texto = String(valor).trim();
    return texto === '' ? null : texto;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { ejecutar };

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error en Fase 1 Andalucia:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
