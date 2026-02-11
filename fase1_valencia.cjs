const axios = require('axios');
const db = require('./db.cjs');

const WFS_BASE = 'https://terramapas.icv.gva.es/22_IGPCV';
// Two layers: Delimitaciones (32 polygons) + Entornos (299 polygons), deduplicate by codigo
const WFS_LAYERS = ['BIC.Delimitaciones', 'BIC.Entornos'];
const PAGE_SIZE = 500;
const DELAY_MS = 300;

async function ejecutar() {
    console.log('=== FASE 1 VALENCIA: Descarga WFS GVA (BIC) ===\n');

    console.log('Descargando BIC de la Comunitat Valenciana via WFS...');

    // Limpiar datos anteriores de Valencia
    const existentes = (await db.obtenerBienesPorRegion('Comunitat Valenciana')).length;
    if (existentes > 0) {
        console.log(`Limpiando ${existentes} registros anteriores de Comunitat Valenciana...`);
        await db.limpiarBienesPorRegion('Comunitat Valenciana');
    }

    // Download from both layers, dedup by codigo
    const porCodigo = new Map();

    for (const layer of WFS_LAYERS) {
        console.log(`\n  Capa: ${layer}`);
        let startindex = 0;
        let pagina = 1;

        while (true) {
            const params = {
                service: 'WFS',
                version: '2.0.0',
                request: 'GetFeature',
                typename: layer,
                outputformat: 'geojson',
                srsname: 'EPSG:4326',
                count: PAGE_SIZE,
                startindex,
            };

            console.log(`    Pagina ${pagina} (startindex=${startindex})...`);
            let response;
            try {
                response = await axios.get(WFS_BASE, { params, timeout: 60000 });
            } catch (err) {
                console.error(`    Error en pagina ${pagina}: ${err.message}`);
                break;
            }

            const geojson = response.data;
            const features = geojson.features || [];

            if (features.length === 0) break;

            for (const feature of features) {
                const bien = mapearFeature(feature);
                const key = bien.codigo_fuente || bien.denominacion;
                if (!porCodigo.has(key)) {
                    porCodigo.set(key, bien);
                }
            }

            console.log(`      -> ${features.length} registros (unicos acumulados: ${porCodigo.size})`);

            if (features.length < PAGE_SIZE) break;

            startindex += PAGE_SIZE;
            pagina++;
            await sleep(DELAY_MS);
        }
    }

    const todos = Array.from(porCodigo.values());

    if (todos.length === 0) {
        console.log('No se obtuvieron registros de Valencia.');
        await db.cerrar();
        return;
    }

    // Verificar coordenadas - si están fuera de rango, puede que necesiten reproyección
    const sample = todos.find(b => b.latitud && b.longitud);
    if (sample && (Math.abs(sample.latitud) > 90 || Math.abs(sample.longitud) > 180)) {
        console.log('  AVISO: Coordenadas fuera de rango WGS84, intentando reproyeccion UTM30N...');
        try {
            const proj4 = require('proj4');
            proj4.defs('EPSG:25830', '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
            for (const bien of todos) {
                if (bien.latitud && bien.longitud) {
                    const [lon, lat] = proj4('EPSG:25830', 'EPSG:4326', [bien.longitud, bien.latitud]);
                    bien.latitud = lat;
                    bien.longitud = lon;
                }
            }
            console.log('  Reproyeccion completada.');
        } catch (err) {
            console.error('  Error en reproyeccion: ' + err.message);
            console.error('  Instala proj4: npm install proj4');
        }
    }

    console.log(`\nInsertando ${todos.length} bienes en base de datos...`);
    await db.upsertBienes(todos);

    const stats = await db.estadisticas();
    console.log(`\nFase 1 Valencia completada:`);
    console.log(`  - Bienes insertados: ${todos.length}`);
    console.log(`  - Total en BD: ${stats.bienes}`);

    await db.cerrar();
}

function mapearFeature(feature) {
    const p = feature.properties || {};
    const coords = extraerCoordenadas(feature.geometry);

    return {
        denominacion: limpiarTexto(p.denominacion) || limpiarTexto(p.nombre) || 'Sin denominacion',
        tipo: limpiarTexto(p.tipologia) || null,
        clase: null,
        categoria: limpiarTexto(p.categoria) || null,
        provincia: limpiarTexto(p.provincia) || null,
        comarca: limpiarTexto(p.comarca) || null,
        municipio: limpiarTexto(p.noms_mun) || limpiarTexto(p.municipio) || null,
        localidad: null,
        latitud: coords.lat,
        longitud: coords.lon,
        situacion: limpiarTexto(p.ficha) || null,
        resolucion: null,
        publicacion: null,
        fuente_opendata: 0,
        comunidad_autonoma: 'Comunitat Valenciana',
        codigo_fuente: limpiarTexto(p.codigo) || limpiarTexto(p.id) || null,
        pais: 'España',
    };
}

function extraerCoordenadas(geometry) {
    if (!geometry || !geometry.coordinates) return { lat: null, lon: null };

    const coords = geometry.coordinates;

    if (geometry.type === 'Point') {
        return { lon: coords[0], lat: coords[1] };
    }
    if (geometry.type === 'Polygon' && coords[0]) {
        return calcularCentroide(coords[0]);
    }
    if (geometry.type === 'MultiPolygon' && coords[0] && coords[0][0]) {
        return calcularCentroide(coords[0][0]);
    }
    if (geometry.type === 'MultiPoint' && coords[0]) {
        return { lon: coords[0][0], lat: coords[0][1] };
    }

    return { lat: null, lon: null };
}

function calcularCentroide(ring) {
    const n = ring.length;
    if (n === 0) return { lat: null, lon: null };
    let latSum = 0, lonSum = 0;
    for (const [lon, lat] of ring) {
        latSum += lat;
        lonSum += lon;
    }
    return { lat: latSum / n, lon: lonSum / n };
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
        console.error('Error en Fase 1 Valencia:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
