const axios = require('axios');
const db = require('./db.cjs');

const OPENDATA_URL = 'https://opendata.aragon.es/GA_OD_Core/download?resource_id=333&formato=json';

async function ejecutar() {
    console.log('=== FASE 1: Descarga de Aragon Open Data ===\n');

    console.log('Descargando GeoJSON de BIC (Bienes de Interes Cultural)...');
    const response = await axios.get(OPENDATA_URL, { timeout: 30000 });
    const geojson = response.data;

    if (!geojson.features || !Array.isArray(geojson.features)) {
        throw new Error('Formato GeoJSON inesperado: no se encontro "features"');
    }

    console.log(`Descargados ${geojson.features.length} registros.\n`);

    // Limpiar datos anteriores de Aragon antes de reimportar
    const existentes = (await db.obtenerBienesPorRegion('Aragon')).length;
    if (existentes > 0) {
        console.log(`Limpiando ${existentes} registros anteriores de Aragon...`);
        await db.limpiarBienesPorRegion('Aragon');
    }

    const bienes = geojson.features.map(feature => {
        const p = feature.properties || {};
        const coords = extraerCoordenadas(feature.geometry);

        return {
            denominacion: limpiarTexto(p.denominaci) || limpiarTexto(p.denominacion) || 'Sin denominacion',
            tipo: limpiarTexto(p.tipo),
            clase: limpiarTexto(p.clase),
            categoria: limpiarTexto(p.categoria),
            provincia: normalizarProvincia(limpiarTexto(p.provincia)),
            comarca: limpiarTexto(p.comarca),
            municipio: limpiarTexto(p.municipio),
            localidad: limpiarTexto(p.localidad),
            latitud: coords.lat,
            longitud: coords.lon,
            situacion: limpiarTexto(p.situacion),
            resolucion: limpiarTexto(p.resolucion),
            publicacion: limpiarTexto(p.publicacio) || limpiarTexto(p.publicacion),
            fuente_opendata: 1,
            comunidad_autonoma: 'Aragon',
            codigo_fuente: limpiarTexto(p.codigo) || null,
            pais: 'España',
        };
    });

    console.log('Insertando en base de datos...');
    await db.insertarBienes(bienes);

    const stats = await db.estadisticas();
    console.log(`\nFase 1 completada:`);
    console.log(`  - Bienes insertados: ${stats.bienes}`);
    console.log(`  - Por provincia:`);
    stats.por_provincia.forEach(p => console.log(`      ${p.provincia || 'Sin dato'}: ${p.n}`));
    console.log(`  - Por categoria:`);
    stats.por_categoria.forEach(c => console.log(`      ${c.categoria || 'Sin dato'}: ${c.n}`));

    await db.cerrar();
}

function extraerCoordenadas(geometry) {
    if (!geometry || !geometry.coordinates) return { lat: null, lon: null };

    const coords = geometry.coordinates;

    // GeoJSON usa [longitud, latitud]
    if (geometry.type === 'Point') {
        return { lon: coords[0], lat: coords[1] };
    }
    // Para polígonos, usar el centroide
    if (geometry.type === 'Polygon' && coords[0]) {
        const ring = coords[0];
        const n = ring.length;
        let latSum = 0, lonSum = 0;
        for (const [lon, lat] of ring) {
            latSum += lat;
            lonSum += lon;
        }
        return { lat: latSum / n, lon: lonSum / n };
    }
    if (geometry.type === 'MultiPoint' && coords[0]) {
        return { lon: coords[0][0], lat: coords[0][1] };
    }

    return { lat: null, lon: null };
}

function limpiarTexto(valor) {
    if (valor === null || valor === undefined) return null;
    const texto = String(valor).trim();
    return texto === '' ? null : texto;
}

function normalizarProvincia(valor) {
    if (!valor) return null;
    const lower = valor.toLowerCase().trim();
    if (lower.startsWith('hue')) return 'Huesca';
    if (lower.startsWith('ter')) return 'Teruel';
    if (lower.startsWith('zar')) return 'Zaragoza';
    return valor.trim();
}

module.exports = { ejecutar };

// Ejecucion directa
if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error en Fase 1:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
