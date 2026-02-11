const axios = require('axios');
const db = require('./db.cjs');

// Nominatim API
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DELAY_MS = 1100;

// Patrones para extraer lugares del nombre
const PATRONES_LUGAR = [
    /Centro Hist[oó]rico de (.+)/i,
    /Conjunto Hist[oó]rico de (.+)/i,
    /Casco Antiguo de (.+)/i,
    /(?:Iglesia|Ermita|Capilla|Parroquia) (?:de )?(?:Nuestra Se[ñn]ora|San|Santa|Santo|Ntra\. Sra\.|N\. S\.) .+ de (.+)/i,
    /(?:Castillo|Fortaleza|Alcazaba|Torre) de (.+)/i,
    /(?:Puente|Acueducto|Fuente) de (.+)/i,
    /(?:Convento|Monasterio|Abadía) de .+ de (.+)/i,
    /Universidad de (.+)/i,
    /Instituto .+ de (.+)/i,
    /Hospital .+ de (.+)/i,
    /Plaza (?:de )?(?:Toros|Mayor|la Constitución) de (.+)/i,
    /Ayuntamiento de (.+)/i,
    /Catedral de (.+)/i,
];

// Lugares conocidos en Andalucía
const LUGARES_ANDALUCIA = [
    'Almería', 'Cádiz', 'Córdoba', 'Granada', 'Huelva', 'Jaén', 'Málaga', 'Sevilla',
    'Antequera', 'Ronda', 'Jerez', 'Algeciras', 'Marbella', 'Úbeda', 'Baeza',
    'Carmona', 'Écija', 'Osuna', 'Priego', 'Lucena', 'Montilla', 'Linares',
    'Andújar', 'Guadix', 'Baza', 'Motril', 'Loja', 'Alhama', 'Nerja', 'Vélez',
];

async function ejecutar() {
    console.log('=== GEOCODIFICAR POR NOMBRE ===\n');

    // Items de Andalucía sin coordenadas
    const items = (await db.query(`
        SELECT id, denominacion
        FROM bienes
        WHERE comunidad_autonoma = 'Andalucia'
          AND latitud IS NULL
        ORDER BY denominacion
    `)).rows;

    console.log(`Items sin coordenadas: ${items.length}`);

    // Agrupar por lugar extraído
    const porLugar = new Map();
    let sinLugar = 0;

    for (const item of items) {
        const lugar = extraerLugar(item.denominacion);
        if (lugar) {
            if (!porLugar.has(lugar)) {
                porLugar.set(lugar, []);
            }
            porLugar.get(lugar).push(item.id);
        } else {
            sinLugar++;
        }
    }

    console.log(`Lugares identificados: ${porLugar.size}`);
    console.log(`Items con lugar extraído: ${items.length - sinLugar}`);
    console.log(`Items sin lugar identificable: ${sinLugar}\n`);

    // Ordenar por cantidad de items
    const lugaresOrdenados = [...porLugar.entries()]
        .sort((a, b) => b[1].length - a[1].length);

    console.log('Top 20 lugares:');
    lugaresOrdenados.slice(0, 20).forEach(([lugar, ids]) => {
        console.log(`  ${lugar}: ${ids.length} items`);
    });

    // Geocodificar cada lugar
    console.log('\nGeocodificando lugares...\n');

    let geocodificados = 0;
    let noEncontrados = 0;
    let bienesActualizados = 0;

    for (let i = 0; i < lugaresOrdenados.length; i++) {
        const [lugar, ids] = lugaresOrdenados[i];

        if ((i + 1) % 20 === 0 || i === 0) {
            console.log(`[${i + 1}/${lugaresOrdenados.length}] ${lugar} (${ids.length} items)...`);
        }

        try {
            const response = await axios.get(NOMINATIM_URL, {
                params: {
                    q: `${lugar}, Andalucía, España`,
                    format: 'json',
                    limit: 1,
                    countrycodes: 'es',
                },
                headers: {
                    'User-Agent': 'PatrimonioBot/1.0 (heritage data project)',
                },
                timeout: 10000,
            });

            if (response.data && response.data.length > 0) {
                const result = response.data[0];
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);

                // Validar rango Andalucía
                if (lat >= 36 && lat <= 39 && lon >= -8 && lon <= -1) {
                    for (const id of ids) {
                        await db.query('UPDATE bienes SET latitud = ?, longitud = ? WHERE id = ?', [lat, lon, id]);
                        bienesActualizados++;
                    }
                    geocodificados++;
                } else {
                    noEncontrados++;
                }
            } else {
                noEncontrados++;
            }
        } catch (err) {
            noEncontrados++;
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nResultado:`);
    console.log(`  - Lugares geocodificados: ${geocodificados}/${lugaresOrdenados.length}`);
    console.log(`  - Lugares no encontrados: ${noEncontrados}`);
    console.log(`  - Bienes actualizados: ${bienesActualizados}`);

    // Verificar total
    const totalConCoords = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL')).rows[0].n;
    const totalBienes = (await db.query('SELECT COUNT(*) as n FROM bienes')).rows[0].n;
    console.log(`  - Total con coordenadas: ${totalConCoords}/${totalBienes} (${(100*totalConCoords/totalBienes).toFixed(1)}%)`);

    await db.cerrar();
}

function extraerLugar(denominacion) {
    if (!denominacion) return null;

    // Intentar patrones específicos
    for (const patron of PATRONES_LUGAR) {
        const match = denominacion.match(patron);
        if (match && match[1]) {
            return limpiarLugar(match[1]);
        }
    }

    // Buscar lugares conocidos en el nombre
    for (const lugar of LUGARES_ANDALUCIA) {
        if (denominacion.includes(lugar)) {
            return lugar;
        }
    }

    return null;
}

function limpiarLugar(lugar) {
    return lugar
        .replace(/\s*\([^)]+\)\s*/g, '') // Quitar paréntesis
        .replace(/\s*,.*$/, '')           // Quitar después de coma
        .trim();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

ejecutar().catch(async err => {
    console.error('Error:', err.message);
    await db.cerrar();
    process.exit(1);
});
