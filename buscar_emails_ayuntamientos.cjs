/**
 * Script para buscar emails de ayuntamientos españoles
 *
 * Fuente: administracion.gob.es - Directorio de Entidades Locales
 * Scraping de las fichas de ayuntamientos por provincia con datos de contacto
 * (email, teléfono, fax, dirección)
 *
 * Uso:
 *   node buscar_emails_ayuntamientos.cjs              # Ejecutar scraping completo
 *   node buscar_emails_ayuntamientos.cjs --provincia 28  # Solo una provincia (ej: Madrid)
 *   node buscar_emails_ayuntamientos.cjs --resume      # Reanudar desde donde se quedó
 *   node buscar_emails_ayuntamientos.cjs --stats       # Solo mostrar estadísticas
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('./db.cjs');
const removeAccents = require('remove-accents');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const PROGRESS_FILE = path.join(DATA_DIR, 'scraping_progress.json');
const BASE_URL = 'https://administracion.gob.es/pagFront/espanaAdmon/directorioOrganigrama/entidadesLocales/entidadesLocales.htm';

// Provincias con código INE
const PROVINCIAS = [
    { cod: '01', nombre: 'Araba/Álava' },
    { cod: '02', nombre: 'Albacete' },
    { cod: '03', nombre: 'Alacant/Alicante' },
    { cod: '04', nombre: 'Almería' },
    { cod: '05', nombre: 'Ávila' },
    { cod: '06', nombre: 'Badajoz' },
    { cod: '07', nombre: 'Illes Balears' },
    { cod: '08', nombre: 'Barcelona' },
    { cod: '09', nombre: 'Burgos' },
    { cod: '10', nombre: 'Cáceres' },
    { cod: '11', nombre: 'Cádiz' },
    { cod: '12', nombre: 'Castelló/Castellón' },
    { cod: '13', nombre: 'Ciudad Real' },
    { cod: '14', nombre: 'Córdoba' },
    { cod: '15', nombre: 'Coruña, A' },
    { cod: '16', nombre: 'Cuenca' },
    { cod: '17', nombre: 'Girona' },
    { cod: '18', nombre: 'Granada' },
    { cod: '19', nombre: 'Guadalajara' },
    { cod: '20', nombre: 'Gipuzkoa' },
    { cod: '21', nombre: 'Huelva' },
    { cod: '22', nombre: 'Huesca' },
    { cod: '23', nombre: 'Jaén' },
    { cod: '24', nombre: 'León' },
    { cod: '25', nombre: 'Lleida' },
    { cod: '26', nombre: 'Rioja, La' },
    { cod: '27', nombre: 'Lugo' },
    { cod: '28', nombre: 'Madrid' },
    { cod: '29', nombre: 'Málaga' },
    { cod: '30', nombre: 'Murcia' },
    { cod: '31', nombre: 'Navarra' },
    { cod: '32', nombre: 'Ourense' },
    { cod: '33', nombre: 'Asturias' },
    { cod: '34', nombre: 'Palencia' },
    { cod: '35', nombre: 'Palmas, Las' },
    { cod: '36', nombre: 'Pontevedra' },
    { cod: '37', nombre: 'Salamanca' },
    { cod: '38', nombre: 'Santa Cruz de Tenerife' },
    { cod: '39', nombre: 'Cantabria' },
    { cod: '40', nombre: 'Segovia' },
    { cod: '41', nombre: 'Sevilla' },
    { cod: '42', nombre: 'Soria' },
    { cod: '43', nombre: 'Tarragona' },
    { cod: '44', nombre: 'Teruel' },
    { cod: '45', nombre: 'Toledo' },
    { cod: '46', nombre: 'València/Valencia' },
    { cod: '47', nombre: 'Valladolid' },
    { cod: '48', nombre: 'Bizkaia' },
    { cod: '49', nombre: 'Zamora' },
    { cod: '50', nombre: 'Zaragoza' },
    { cod: '51', nombre: 'Ceuta' },
    { cod: '52', nombre: 'Melilla' },
];

// Mapa provincia -> CCAA
const PROV_CCAA = {
    '01': 'Pais Vasco', '02': 'Castilla-La Mancha', '03': 'Comunitat Valenciana',
    '04': 'Andalucia', '05': 'Castilla y Leon', '06': 'Extremadura',
    '07': 'Illes Balears', '08': 'Catalunya', '09': 'Castilla y Leon',
    '10': 'Extremadura', '11': 'Andalucia', '12': 'Comunitat Valenciana',
    '13': 'Castilla-La Mancha', '14': 'Andalucia', '15': 'Galicia',
    '16': 'Castilla-La Mancha', '17': 'Catalunya', '18': 'Andalucia',
    '19': 'Castilla-La Mancha', '20': 'Pais Vasco', '21': 'Andalucia',
    '22': 'Aragon', '23': 'Andalucia', '24': 'Castilla y Leon',
    '25': 'Catalunya', '26': 'La Rioja', '27': 'Galicia',
    '28': 'Comunidad de Madrid', '29': 'Andalucia', '30': 'Region de Murcia',
    '31': 'Navarra', '32': 'Galicia', '33': 'Asturias',
    '34': 'Castilla y Leon', '35': 'Canarias', '36': 'Galicia',
    '37': 'Castilla y Leon', '38': 'Canarias', '39': 'Cantabria',
    '40': 'Castilla y Leon', '41': 'Andalucia', '42': 'Castilla y Leon',
    '43': 'Catalunya', '44': 'Aragon', '45': 'Castilla-La Mancha',
    '46': 'Comunitat Valenciana', '47': 'Castilla y Leon', '48': 'Pais Vasco',
    '49': 'Castilla y Leon', '50': 'Aragon', '51': 'Ceuta', '52': 'Melilla',
};

// ============== UTILIDADES ==============

function normalizar(str) {
    if (!str) return '';
    return removeAccents(str).toLowerCase().trim()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
    return { provinciasCompletadas: [], municipiosProcesados: 0 };
}

function saveProgress(progress) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ============== SCRAPING ==============

/**
 * Obtener lista de ayuntamientos de una provincia
 */
async function obtenerAyuntamientosProvincia(codProvincia) {
    const url = `${BASE_URL}?idProvincia=${codProvincia}`;
    const resp = await axios.get(url, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    const html = resp.data;
    const ayuntamientos = [];

    // Extraer links de municipios con regex
    const regex = /href="[^"]*idUniOrganica=(L01\d+)&idProvincia=(\d+)"[^>]*>([^<]+)</g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const nombre = match[3].trim().replace(/^Ayuntamiento\s+de\s+/i, '').trim();
        ayuntamientos.push({
            codigo: match[1],
            codProvincia: match[2],
            nombre,
        });
    }

    return ayuntamientos;
}

/**
 * Obtener datos de contacto de un ayuntamiento específico
 */
async function obtenerContactoAyuntamiento(codigoDir3, codProvincia) {
    const url = `${BASE_URL}?idUniOrganica=${codigoDir3}&idProvincia=${codProvincia}`;
    const resp = await axios.get(url, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    const html = resp.data;
    const contacto = {};

    // Email
    const emailMatch = html.match(/Email:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
    if (emailMatch) contacto.email = emailMatch[1].trim().toLowerCase();

    // Teléfono
    const telMatch = html.match(/Tel[eé]fono\s*:?\s*([\d\s]{6,})/i);
    if (telMatch) contacto.telefono = telMatch[1].replace(/\s/g, '').trim();

    // Fax
    const faxMatch = html.match(/Fax\s*:?\s*([\d\s]{6,})/i);
    if (faxMatch) contacto.fax = faxMatch[1].replace(/\s/g, '').trim();

    // Dirección (del ppg-map__info--text)
    const addrMatch = html.match(/ppg-map__info--text">([\s\S]*?)<\/p>/);
    if (addrMatch) contacto.direccion = addrMatch[1].replace(/\s+/g, ' ').trim();

    // Web (buscar enlaces con patrón de web municipal)
    const webMatch = html.match(/href="(https?:\/\/(?:www\.)?[^"]*(?:ayto|ayuntamiento|ajuntament|udaletxe|concello|muni)[^"]*)"[^>]*>/i);
    if (webMatch) contacto.web = webMatch[1];

    return contacto;
}

/**
 * Procesar una provincia completa
 */
async function procesarProvincia(codProvincia, nombreProvincia) {
    log(`Procesando provincia: ${nombreProvincia} (${codProvincia})...`);

    const ayuntamientos = await obtenerAyuntamientosProvincia(codProvincia);
    log(`  ${ayuntamientos.length} ayuntamientos encontrados`);

    const ccaa = PROV_CCAA[codProvincia] || null;
    let conEmail = 0;
    let errores = 0;
    const contactos = [];

    for (let i = 0; i < ayuntamientos.length; i++) {
        const ayto = ayuntamientos[i];

        try {
            const contacto = await obtenerContactoAyuntamiento(ayto.codigo, codProvincia);

            contactos.push({
                municipio: ayto.nombre,
                provincia: nombreProvincia,
                comunidad_autonoma: ccaa,
                email_patrimonio: null,
                email_general: contacto.email || null,
                persona_contacto: null,
                cargo: null,
                telefono: contacto.telefono || null,
                web: contacto.web || null,
                fuente: 'administracion.gob.es',
            });

            if (contacto.email) conEmail++;

            // Guardar cada 50 para no perder datos
            if (contactos.length >= 50) {
                await db.upsertContactos(contactos);
                contactos.length = 0;
            }
        } catch (err) {
            errores++;
            if (errores > 5) {
                log(`  Demasiados errores consecutivos, esperando 10s...`);
                await sleep(10000);
                errores = 0;
            }
        }

        // Rate limiting: 400ms entre peticiones
        await sleep(400);

        if ((i + 1) % 25 === 0) {
            log(`  Progreso: ${i + 1}/${ayuntamientos.length} (emails: ${conEmail})`);
        }
    }

    // Guardar los restantes
    if (contactos.length > 0) {
        await db.upsertContactos(contactos);
    }

    log(`  Completada ${nombreProvincia}: ${ayuntamientos.length} municipios, ${conEmail} con email`);
    return { total: ayuntamientos.length, conEmail };
}

// ============== MATCHING CON BIENES ==============

async function matchearConBienes() {
    // Obtener municipios de España en nuestra DB que no tienen contacto todavía
    const municipiosDB = (await db.query(`
        SELECT DISTINCT b.municipio, b.provincia, b.comunidad_autonoma
        FROM bienes b
        WHERE b.pais = 'España' AND b.municipio IS NOT NULL AND b.municipio != ''
        AND NOT EXISTS (
            SELECT 1 FROM contactos_municipios c
            WHERE c.municipio = b.municipio AND c.provincia = b.provincia
        )
        ORDER BY b.municipio
    `)).rows;

    if (municipiosDB.length === 0) {
        log('Todos los municipios de bienes ya tienen entrada en contactos');
        return;
    }

    log(`Añadiendo ${municipiosDB.length} municipios de bienes sin contacto a la tabla...`);

    // Crear índice de contactos existentes
    const contactosExistentes = (await db.query(`
        SELECT municipio, provincia, email_general FROM contactos_municipios
    `)).rows;

    const contactosIdx = new Map();
    for (const c of contactosExistentes) {
        contactosIdx.set(normalizar(c.municipio), c);
    }

    const nuevos = [];
    let matchedPorNombre = 0;

    for (const mun of municipiosDB) {
        const nombreMun = mun.municipio.split(',')[0].trim();
        const keyNorm = normalizar(nombreMun);

        // Intentar match por nombre normalizado (diferente provincia)
        const existente = contactosIdx.get(keyNorm);
        if (existente && existente.email_general) {
            nuevos.push({
                municipio: nombreMun,
                provincia: mun.provincia,
                comunidad_autonoma: mun.comunidad_autonoma,
                email_patrimonio: null,
                email_general: existente.email_general,
                persona_contacto: null,
                cargo: null,
                telefono: null,
                web: null,
                fuente: 'match-nombre',
            });
            matchedPorNombre++;
        } else {
            nuevos.push({
                municipio: nombreMun,
                provincia: mun.provincia,
                comunidad_autonoma: mun.comunidad_autonoma,
                email_patrimonio: null,
                email_general: null,
                persona_contacto: null,
                cargo: null,
                telefono: null,
                web: null,
                fuente: null,
            });
        }
    }

    if (nuevos.length > 0) {
        await db.upsertContactos(nuevos);
        log(`  ${nuevos.length} municipios añadidos (${matchedPorNombre} con email por matching)`);
    }
}

// ============== ESTADÍSTICAS ==============

async function mostrarEstadisticas() {
    const stats = await db.estadisticasContactos();
    console.log('\n========== ESTADÍSTICAS CONTACTOS MUNICIPIOS ==========');
    console.log(`Total municipios:          ${stats.total}`);
    console.log(`Con email patrimonio:      ${stats.con_email_patrimonio}`);
    console.log(`Con email general:         ${stats.con_email_general}`);
    console.log(`Con persona de contacto:   ${stats.con_contacto}`);
    console.log('\nPor Comunidad Autónoma:');
    if (stats.por_ccaa) {
        for (const ccaa of stats.por_ccaa) {
            const name = (ccaa.comunidad_autonoma || 'Sin CCAA').padEnd(30);
            console.log(`  ${name} total: ${String(ccaa.total).padStart(5)}  con email: ${String(ccaa.con_email).padStart(5)}`);
        }
    }
    console.log('=======================================================\n');
}

// ============== MAIN ==============

async function main() {
    const args = process.argv.slice(2);
    const soloStats = args.includes('--stats');
    const resume = args.includes('--resume');
    const provIdx = args.indexOf('--provincia');
    const soloProvincia = provIdx !== -1 ? args[provIdx + 1] : null;

    if (soloStats) {
        await mostrarEstadisticas();
        await db.cerrar();
        return;
    }

    const progress = resume ? loadProgress() : { provinciasCompletadas: [], municipiosProcesados: 0 };
    let totalMunicipios = 0;
    let totalConEmail = 0;

    try {
        log('===== SCRAPING ADMINISTRACION.GOB.ES =====');
        log(`Provincias a procesar: ${soloProvincia ? 1 : PROVINCIAS.length}`);

        const provinciasAProcesar = soloProvincia
            ? PROVINCIAS.filter(p => p.cod === soloProvincia)
            : PROVINCIAS;

        for (const prov of provinciasAProcesar) {
            if (resume && progress.provinciasCompletadas.includes(prov.cod)) {
                log(`Saltando ${prov.nombre} (ya completada)`);
                continue;
            }

            try {
                const resultado = await procesarProvincia(prov.cod, prov.nombre);
                totalMunicipios += resultado.total;
                totalConEmail += resultado.conEmail;

                progress.provinciasCompletadas.push(prov.cod);
                progress.municipiosProcesados += resultado.total;
                saveProgress(progress);

                // Pausa entre provincias
                await sleep(1000);
            } catch (err) {
                log(`ERROR en provincia ${prov.nombre}: ${err.message}`);
                log('Continuando con la siguiente provincia...');
                await sleep(5000);
            }
        }

        log('\n===== MATCHING CON BIENES =====');
        await matchearConBienes();

        log(`\nScraping completado: ${totalMunicipios} municipios, ${totalConEmail} con email`);
        await mostrarEstadisticas();
    } catch (err) {
        console.error('Error fatal:', err);
    } finally {
        await db.cerrar();
    }
}

main();
