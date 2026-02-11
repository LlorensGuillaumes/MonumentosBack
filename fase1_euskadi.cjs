/**
 * Fase 1: Descarga de patrimonio del País Vasco
 * Fuente: Open Data Euskadi
 * API: https://opendata.euskadi.eus/
 */

const axios = require('axios');
const db = require('./db.cjs');

// Endpoints de patrimonio cultural de Euskadi
const ENDPOINTS = [
    {
        name: 'Edificios religiosos',
        url: 'https://opendata.euskadi.eus/contenidos/ds_recursos_culturales/edificios_religiosos_702/opendata/edificios_religiosos.json',
        tipo: 'Edificio religioso'
    },
    {
        name: 'Castillos y torres',
        url: 'https://opendata.euskadi.eus/contenidos/ds_recursos_culturales/castillos_702/opendata/castillos.json',
        tipo: 'Castillo'
    },
    {
        name: 'Palacios y casonas',
        url: 'https://opendata.euskadi.eus/contenidos/ds_recursos_culturales/palacios_702/opendata/palacios.json',
        tipo: 'Palacio'
    },
    {
        name: 'Cuevas y restos arqueológicos',
        url: 'https://opendata.euskadi.eus/contenidos/ds_recursos_culturales/cuevas_702/opendata/cuevas.json',
        tipo: 'Cueva'
    },
    {
        name: 'Puentes históricos',
        url: 'https://opendata.euskadi.eus/contenidos/ds_recursos_culturales/puentes_702/opendata/puentes.json',
        tipo: 'Puente'
    },
    {
        name: 'Ferrerías',
        url: 'https://opendata.euskadi.eus/contenidos/ds_recursos_culturales/ferrerias_702/opendata/ferrerias.json',
        tipo: 'Ferrería'
    },
];

const DELAY_MS = 300;

async function ejecutar() {
    console.log('=== FASE 1 PAIS VASCO: Descarga Open Data Euskadi ===\n');

    // Limpiar datos anteriores
    const existentes = (await db.obtenerBienesPorRegion('Pais Vasco')).length;
    if (existentes > 0) {
        console.log(`Limpiando ${existentes} registros anteriores de País Vasco...`);
        await db.limpiarBienesPorRegion('Pais Vasco');
    }

    let totalInsertados = 0;

    for (const endpoint of ENDPOINTS) {
        console.log(`\nDescargando: ${endpoint.name}...`);

        try {
            const response = await axios.get(endpoint.url, {
                timeout: 30000,
                headers: { 'Accept': 'application/json' }
            });

            let items = [];

            // El formato puede variar según el endpoint
            if (Array.isArray(response.data)) {
                items = response.data;
            } else if (response.data.features) {
                items = response.data.features;
            } else if (response.data.items) {
                items = response.data.items;
            } else if (response.data.results) {
                items = response.data.results;
            }

            console.log(`  Obtenidos: ${items.length} registros`);

            const bienes = items.map(item => mapearBien(item, endpoint.tipo)).filter(b => b !== null);

            if (bienes.length > 0) {
                await db.upsertBienes(bienes);
                totalInsertados += bienes.length;
                console.log(`  Insertados: ${bienes.length}`);
            }

        } catch (err) {
            console.error(`  Error: ${err.message}`);
        }

        await sleep(DELAY_MS);
    }

    // Intentar también la API de recursos culturales genérica
    console.log('\nBuscando recursos culturales adicionales...');
    await buscarRecursosCulturales();

    const stats = await db.estadisticas();
    const euskadi = (await db.obtenerBienesPorRegion('Pais Vasco')).length;

    console.log(`\nFase 1 País Vasco completada:`);
    console.log(`  - Bienes insertados: ${euskadi}`);
    console.log(`  - Total en BD: ${stats.bienes}`);

    await db.cerrar();
}

async function buscarRecursosCulturales() {
    // Intentar endpoint genérico de recursos culturales
    const urls = [
        'https://opendata.euskadi.eus/contenidos/ds_recursos_culturales/monumentos_702/opendata/monumentos.json',
        'https://opendata.euskadi.eus/contenidos/ds_recursos_culturales/museos_702/opendata/museos.json',
    ];

    for (const url of urls) {
        try {
            const response = await axios.get(url, { timeout: 15000 });
            const items = Array.isArray(response.data) ? response.data :
                          response.data.features || response.data.items || [];

            if (items.length > 0) {
                console.log(`  Encontrados ${items.length} en ${url.split('/').pop()}`);
                const bienes = items.map(item => mapearBien(item, 'Monumento')).filter(b => b !== null);
                if (bienes.length > 0) {
                    await db.upsertBienes(bienes);
                }
            }
        } catch (err) {
            // Silencioso si no existe
        }
        await sleep(DELAY_MS);
    }
}

function mapearBien(item, tipo) {
    // Los datos de Euskadi pueden venir en diferentes formatos
    const props = item.properties || item;

    // Extraer nombre
    const nombre = props.documentName || props.nombre || props.name ||
                   props.denominacion || props.titulo || props.title ||
                   (props.templateData && props.templateData.nombre);

    if (!nombre) return null;

    // Extraer coordenadas
    let lat = null, lon = null;

    if (item.geometry && item.geometry.coordinates) {
        [lon, lat] = item.geometry.coordinates;
    } else if (props.latitud && props.longitud) {
        lat = parseFloat(props.latitud);
        lon = parseFloat(props.longitud);
    } else if (props.latitude && props.longitude) {
        lat = parseFloat(props.latitude);
        lon = parseFloat(props.longitude);
    } else if (props.latwgs84 && props.lonwgs84) {
        lat = parseFloat(props.latwgs84);
        lon = parseFloat(props.lonwgs84);
    }

    // Extraer municipio y provincia
    const municipio = props.municipality || props.municipio || props.localidad ||
                      props.poblacion || props.ciudad ||
                      (props.templateData && props.templateData.municipio);

    const territorio = props.territory || props.territorio || props.provincia ||
                       (props.templateData && props.templateData.territorio);

    // Mapear territorio a provincia
    let provincia = territorio;
    if (territorio) {
        if (territorio.toLowerCase().includes('araba') || territorio.toLowerCase().includes('alava')) {
            provincia = 'Araba/Álava';
        } else if (territorio.toLowerCase().includes('bizkaia') || territorio.toLowerCase().includes('vizcaya')) {
            provincia = 'Bizkaia';
        } else if (territorio.toLowerCase().includes('gipuzkoa') || territorio.toLowerCase().includes('guipuzcoa')) {
            provincia = 'Gipuzkoa';
        }
    }

    // ID único
    const id = props.documentId || props.id || props.codigo ||
               `${nombre}-${municipio || 'unknown'}`.replace(/\s+/g, '-').toLowerCase();

    return {
        denominacion: nombre,
        tipo: tipo,
        clase: props.estilo || props.style || null,
        categoria: props.categoria || props.category || 'Patrimonio inmueble',
        provincia: provincia,
        comarca: props.comarca || null,
        municipio: municipio,
        localidad: props.localidad || props.barrio || null,
        latitud: lat,
        longitud: lon,
        situacion: props.direccion || props.address || null,
        resolucion: props.proteccion || props.declaracion || null,
        publicacion: null,
        fuente_opendata: 1,
        comunidad_autonoma: 'Pais Vasco',
        codigo_fuente: String(id),
        pais: 'España',
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { ejecutar };

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error en Fase 1 País Vasco:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
