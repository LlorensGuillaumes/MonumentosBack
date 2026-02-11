const axios = require('axios');
const db = require('./db.cjs');

const API_BASE = 'https://do.diba.cat/api/dataset/patrimoni_cultural';
const PAGE_SIZE = 100;
const DELAY_MS = 300;

async function ejecutar() {
    console.log('=== FASE 1 DIBA: Descarga Patrimoni Cultural Barcelona ===\n');

    console.log('Descargando patrimonio inmueble de la Diputacio de Barcelona...');

    // Limpiar datos anteriores de Catalunya
    const existentes = (await db.obtenerBienesPorRegion('Catalunya')).length;
    if (existentes > 0) {
        console.log(`Limpiando ${existentes} registros anteriores de Catalunya...`);
        await db.limpiarBienesPorRegion('Catalunya');
    }

    let todos = [];
    let start = 1;
    let pagina = 1;
    let totalEntitats = null;

    while (true) {
        const end = start + PAGE_SIZE - 1;
        const url = `${API_BASE}/camp-ambit/Patrimoni immoble/format/json/pag-ini/${start}/pag-fi/${end}`;

        console.log(`  Pagina ${pagina} (registros ${start}-${end})...`);
        let response;
        try {
            response = await axios.get(url, { timeout: 30000 });
        } catch (err) {
            console.error(`  Error en pagina ${pagina}: ${err.message}`);
            break;
        }

        const data = response.data;

        if (totalEntitats === null && data.entitats) {
            totalEntitats = parseInt(data.entitats) || 0;
            console.log(`  Total de registros en API: ${totalEntitats}`);
        }

        const elements = data.elements || [];
        if (elements.length === 0) break;

        for (const el of elements) {
            const bien = mapearElemento(el);
            todos.push(bien);

            // Extraer imagenes si existen
            const imagenes = extraerImagenes(el);
            if (imagenes.length > 0) {
                bien._imagenes = imagenes;
            }
        }

        console.log(`    -> ${elements.length} registros (total acumulado: ${todos.length})`);

        if (totalEntitats && todos.length >= totalEntitats) break;
        if (elements.length < PAGE_SIZE) break;

        start += PAGE_SIZE;
        pagina++;
        await sleep(DELAY_MS);
    }

    if (todos.length === 0) {
        console.log('No se obtuvieron registros de DIBA.');
        await db.cerrar();
        return;
    }

    console.log(`\nInsertando ${todos.length} bienes en base de datos...`);

    // Insert bienes and their images
    let totalImagenes = 0;
    for (const bien of todos) {
        const imagenes = bien._imagenes || [];
        delete bien._imagenes;

        const result = await db.upsertBien(bien);
        const bienId = result.lastInsertRowid || (await db.query(
            'SELECT id FROM bienes WHERE comunidad_autonoma = ? AND codigo_fuente = ?',
            [bien.comunidad_autonoma, bien.codigo_fuente]
        )).rows[0]?.id;

        if (bienId && imagenes.length > 0) {
            for (const img of imagenes) {
                img.bien_id = bienId;
                await db.insertarImagen(img);
            }
            totalImagenes += imagenes.length;
        }
    }

    const stats = await db.estadisticas();
    console.log(`\nFase 1 DIBA completada:`);
    console.log(`  - Bienes insertados: ${todos.length}`);
    console.log(`  - Imagenes insertadas: ${totalImagenes}`);
    console.log(`  - Total en BD: ${stats.bienes}`);

    await db.cerrar();
}

function mapearElemento(el) {
    const coords = parsearCoordenadas(el.coordenades);

    return {
        denominacion: limpiarTexto(el.titol) || 'Sin denominacion',
        tipo: limpiarTexto(el.tipologia) || null,
        clase: limpiarTexto(el.estil) || null,
        categoria: null,
        provincia: 'Barcelona',
        comarca: null,
        municipio: limpiarTexto(el.municipi_nom) || null,
        localidad: null,
        latitud: coords.lat,
        longitud: coords.lon,
        situacion: limpiarTexto(el.centuria) || null,
        resolucion: limpiarTexto(el.proteccio) || null,
        publicacion: null,
        fuente_opendata: 0,
        comunidad_autonoma: 'Catalunya',
        codigo_fuente: limpiarTexto(el.id) || null,
        pais: 'España',
    };
}

function parsearCoordenadas(coordStr) {
    if (!coordStr || typeof coordStr !== 'string') return { lat: null, lon: null };
    const parts = coordStr.split(',').map(s => parseFloat(s.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { lat: parts[0], lon: parts[1] };
    }
    return { lat: null, lon: null };
}

function extraerImagenes(el) {
    const imagenes = [];
    if (el.images && Array.isArray(el.images)) {
        for (const img of el.images) {
            const url = img.url || img;
            if (typeof url === 'string' && url.startsWith('http')) {
                imagenes.push({
                    bien_id: null, // set later
                    url,
                    titulo: limpiarTexto(img.titol) || limpiarTexto(el.titol) || null,
                    autor: limpiarTexto(img.autor) || null,
                    fuente: 'diba',
                });
            }
        }
    }
    // Also check single image field
    if (el.imatge && typeof el.imatge === 'string' && el.imatge.startsWith('http')) {
        imagenes.push({
            bien_id: null,
            url: el.imatge,
            titulo: limpiarTexto(el.titol) || null,
            autor: null,
            fuente: 'diba',
        });
    }
    return imagenes;
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
        console.error('Error en Fase 1 DIBA:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
