/**
 * Script complementario: Importar contactos de ayuntamientos desde
 * portales de datos abiertos de las CCAA
 *
 * Fuentes regionales con descarga directa (JSON/CSV):
 * - Andalucía (RAEL): 785 municipios
 * - Navarra: ~270 municipios
 * - Castilla-La Mancha: ~919 municipios
 * - Galicia: 315 municipios
 * - Castellón: ~135 municipios
 * - Euskadi: ~250 municipios
 *
 * Uso:
 *   node importar_contactos_ccaa.cjs            # Importar todas las fuentes
 *   node importar_contactos_ccaa.cjs --fuente andalucia  # Solo una fuente
 *   node importar_contactos_ccaa.cjs --stats    # Estadísticas
 */

const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const db = require('./db.cjs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function log(msg) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== ANDALUCÍA (RAEL) ==============

async function importarAndalucia() {
    log('Descargando RAEL (Andalucía)...');
    const url = 'https://www.juntadeandalucia.es/ssdigitales/festa/download-pro/dataset-rael.json';

    try {
        const resp = await axios.get(url, { timeout: 60000 });
        const data = resp.data;

        if (!Array.isArray(data)) {
            log('  Formato inesperado, intentando parsear...');
            return 0;
        }

        const contactos = [];
        for (const item of data) {
            if (item.claseEntidad !== 'MUNICIPIO') continue;

            // El nombre está en registrales.denominacion
            const nombre = (item.registrales && item.registrales.denominacion) || item.nombre || item.denominacion || '';
            if (!nombre) continue;

            // Capitalizar: "AGRÓN" -> "Agrón"
            const nombreCap = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            // Extraer nombre del presidente si existe
            const pres = item.presidente;
            let personaContacto = null;
            if (pres && pres.nombre) {
                personaContacto = [pres.nombre, pres.apellido1, pres.apellido2].filter(Boolean).join(' ');
            }

            contactos.push({
                municipio: nombreCap,
                provincia: item.provincia || null,
                comunidad_autonoma: 'Andalucia',
                email_patrimonio: null,
                email_general: item.correo ? item.correo.toLowerCase().trim() : null,
                persona_contacto: personaContacto,
                cargo: personaContacto ? 'Alcalde/sa' : null,
                telefono: item.telefono || null,
                web: item.direccionWeb || null,
                fuente: 'RAEL-Andalucia',
            });
        }

        if (contactos.length > 0) {
            await db.upsertContactos(contactos);
        }
        log(`  Andalucía: ${contactos.length} municipios importados, ${contactos.filter(c => c.email_general).length} con email`);
        return contactos.length;
    } catch (err) {
        log(`  Error Andalucía: ${err.message}`);
        return 0;
    }
}

// ============== NAVARRA ==============

async function importarNavarra() {
    log('Descargando datos de Navarra...');
    const url = 'https://datosabiertos.navarra.es/datastore/dump/621b149e-4410-4353-b7d1-b08e3ff5d1e2?format=json&bom=True';

    try {
        const resp = await axios.get(url, { timeout: 60000 });
        const data = resp.data;

        // Navarra devuelve { fields: [...], records: [[...], ...] }
        // fields define el orden de columnas, records son arrays de valores
        const fields = data.fields || [];
        const records = data.records || [];
        if (!Array.isArray(records) || records.length === 0) {
            log('  Formato inesperado Navarra');
            return 0;
        }

        // Crear índice de campos por nombre
        const fieldIdx = {};
        for (let i = 0; i < fields.length; i++) {
            const name = fields[i].id || fields[i];
            fieldIdx[name] = i;
        }

        log(`  Navarra: ${records.length} registros, campos: ${Object.keys(fieldIdx).join(', ')}`);

        const contactos = [];
        for (const row of records) {
            const nombre = row[fieldIdx['Denominacion (ES)']] || '';
            const tipo = row[fieldIdx['Tipo entidad (ES)']] || '';
            if (!nombre) continue;
            // Filtrar solo municipios
            if (tipo && !/municipio/i.test(tipo)) continue;

            const email = row[fieldIdx['Email']] || null;
            const titular = row[fieldIdx['Titular']] || null;
            const secretario = row[fieldIdx['Secretario/a']] || null;

            contactos.push({
                municipio: nombre,
                provincia: 'Navarra',
                comunidad_autonoma: 'Navarra',
                email_patrimonio: null,
                email_general: email ? email.toLowerCase().trim() : null,
                persona_contacto: titular || secretario || null,
                cargo: titular ? 'Alcalde/sa' : (secretario ? 'Secretario/a' : null),
                telefono: row[fieldIdx['Telefono']] || null,
                web: row[fieldIdx['Web']] || null,
                fuente: 'OpenData-Navarra',
            });
        }

        if (contactos.length > 0) {
            await db.upsertContactos(contactos);
        }
        log(`  Navarra: ${contactos.length} municipios importados, ${contactos.filter(c => c.email_general).length} con email`);
        return contactos.length;
    } catch (err) {
        log(`  Error Navarra: ${err.message}`);
        return 0;
    }
}

// ============== CASTILLA-LA MANCHA ==============

async function importarCLM() {
    log('Descargando datos de Castilla-La Mancha...');
    const url = 'https://datosabiertos.castillalamancha.es/sites/datosabiertos.castillalamancha.es/files/Entidades_Locales_CLM%20%28Junio_2025%29.csv';

    try {
        const resp = await axios.get(url, { timeout: 60000, responseType: 'arraybuffer' });
        const workbook = XLSX.read(resp.data, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { defval: null });

        log(`  CLM: ${data.length} filas descargadas`);
        if (data.length > 0) {
            log(`  Columnas: ${Object.keys(data[0]).join(', ')}`);
        }

        const contactos = [];
        for (const item of data) {
            // Intentar identificar columnas (pueden variar)
            const cols = Object.keys(item);
            const colNombre = cols.find(c => /nombre|denominaci|municipio|entidad/i.test(c));
            const colEmail = cols.find(c => /email|correo|e-mail/i.test(c));
            const colTel = cols.find(c => /tel[eé]fono/i.test(c));
            const colWeb = cols.find(c => /web|p[aá]gina|url/i.test(c));
            const colProv = cols.find(c => /provincia/i.test(c));
            const colTipo = cols.find(c => /tipo|clase/i.test(c));

            const nombre = colNombre ? item[colNombre] : null;
            if (!nombre) continue;

            // Filtrar solo municipios/ayuntamientos
            const tipo = colTipo ? String(item[colTipo] || '') : '';
            if (tipo && !/municipio|ayuntamiento/i.test(tipo)) continue;

            contactos.push({
                municipio: String(nombre).trim(),
                provincia: colProv ? String(item[colProv] || '').trim() : null,
                comunidad_autonoma: 'Castilla-La Mancha',
                email_patrimonio: null,
                email_general: colEmail ? (item[colEmail] || '').toLowerCase().trim() || null : null,
                persona_contacto: null,
                cargo: null,
                telefono: colTel ? String(item[colTel] || '').trim() || null : null,
                web: colWeb ? String(item[colWeb] || '').trim() || null : null,
                fuente: 'OpenData-CLM',
            });
        }

        if (contactos.length > 0) {
            await db.upsertContactos(contactos);
        }
        log(`  CLM: ${contactos.length} municipios importados, ${contactos.filter(c => c.email_general).length} con email`);
        return contactos.length;
    } catch (err) {
        log(`  Error CLM: ${err.message}`);
        return 0;
    }
}

// ============== GALICIA ==============

async function importarGalicia() {
    log('Descargando datos de Galicia...');
    const url = 'https://abertos.xunta.gal/catalogo/administracion-publica/-/dataset/0301/casas-dos-concellos-galicia/102/acceso-aos-datos.csv';

    try {
        const resp = await axios.get(url, { timeout: 60000, responseType: 'arraybuffer' });
        const workbook = XLSX.read(resp.data, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { defval: null });

        log(`  Galicia: ${data.length} filas descargadas`);
        if (data.length > 0) {
            log(`  Columnas: ${Object.keys(data[0]).join(', ')}`);
        }

        const contactos = [];
        for (const item of data) {
            const cols = Object.keys(item);
            const colNombre = cols.find(c => /nome|nombre|concello|municipio|denominaci/i.test(c));
            const colEmail = cols.find(c => /email|correo|e-mail/i.test(c));
            const colTel = cols.find(c => /tel[eé]fono/i.test(c));
            const colWeb = cols.find(c => /web|p[aá]gina|url/i.test(c));
            const colProv = cols.find(c => /provincia/i.test(c));

            const nombre = colNombre ? item[colNombre] : null;
            if (!nombre) continue;

            contactos.push({
                municipio: String(nombre).trim(),
                provincia: colProv ? String(item[colProv] || '').trim() : null,
                comunidad_autonoma: 'Galicia',
                email_patrimonio: null,
                email_general: colEmail ? (item[colEmail] || '').toLowerCase().trim() || null : null,
                persona_contacto: null,
                cargo: null,
                telefono: colTel ? String(item[colTel] || '').trim() || null : null,
                web: colWeb ? String(item[colWeb] || '').trim() || null : null,
                fuente: 'OpenData-Galicia',
            });
        }

        if (contactos.length > 0) {
            await db.upsertContactos(contactos);
        }
        log(`  Galicia: ${contactos.length} municipios importados, ${contactos.filter(c => c.email_general).length} con email`);
        return contactos.length;
    } catch (err) {
        log(`  Error Galicia: ${err.message}`);
        return 0;
    }
}

// ============== CASTELLÓN ==============

async function importarCastellon() {
    log('Descargando datos de Castellón...');
    const url = 'https://dipcas.opendatasoft.com/api/v2/catalog/datasets/ayuntamientos/exports/json';

    try {
        const resp = await axios.get(url, { timeout: 60000 });
        const data = resp.data;

        if (!Array.isArray(data)) {
            log('  Formato inesperado Castellón');
            return 0;
        }

        const contactos = [];
        for (const item of data) {
            const nombre = item.municipio || item.nombre || item.denominacion || '';
            if (!nombre) continue;

            contactos.push({
                municipio: String(nombre).trim(),
                provincia: 'Castelló/Castellón',
                comunidad_autonoma: 'Comunitat Valenciana',
                email_patrimonio: null,
                email_general: (item.correo_electronico || item.correo || item.email || '').toLowerCase().trim() || null,
                persona_contacto: null,
                cargo: null,
                telefono: item.telefono || null,
                web: item.web || item.pagina_web || null,
                fuente: 'OpenData-Castellon',
            });
        }

        if (contactos.length > 0) {
            await db.upsertContactos(contactos);
        }
        log(`  Castellón: ${contactos.length} municipios importados, ${contactos.filter(c => c.email_general).length} con email`);
        return contactos.length;
    } catch (err) {
        log(`  Error Castellón: ${err.message}`);
        return 0;
    }
}

// ============== EUSKADI ==============

async function importarEuskadi() {
    log('Descargando datos de Euskadi...');
    const url = 'https://opendata.euskadi.eus/contenidos/ds_registros/registro_entidades_locales/opendata/entidades.xlsx';

    try {
        const resp = await axios.get(url, { timeout: 60000, responseType: 'arraybuffer' });
        const workbook = XLSX.read(resp.data, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { defval: null });

        log(`  Euskadi: ${data.length} filas descargadas`);
        if (data.length > 0) {
            log(`  Columnas: ${Object.keys(data[0]).join(', ')}`);
        }

        const contactos = [];
        for (const item of data) {
            const cols = Object.keys(item);
            const colNombre = cols.find(c => /nombre|denominaci|municipio|entidad/i.test(c));
            const colEmail = cols.find(c => /email|correo|e-mail/i.test(c));
            const colTel = cols.find(c => /tel[eé]fono/i.test(c));
            const colWeb = cols.find(c => /web|p[aá]gina|url/i.test(c));
            const colProv = cols.find(c => /provincia|territorio|lurralde/i.test(c));
            const colTipo = cols.find(c => /tipo|clase|entidad/i.test(c));

            const nombre = colNombre ? item[colNombre] : null;
            if (!nombre) continue;

            // Filtrar ayuntamientos si hay columna tipo
            const tipo = colTipo ? String(item[colTipo] || '') : '';
            if (tipo && !/municipio|ayuntamiento|udal/i.test(tipo) && tipo !== '') continue;

            contactos.push({
                municipio: String(nombre).trim(),
                provincia: colProv ? String(item[colProv] || '').trim() : null,
                comunidad_autonoma: 'Pais Vasco',
                email_patrimonio: null,
                email_general: colEmail ? (item[colEmail] || '').toLowerCase().trim() || null : null,
                persona_contacto: null,
                cargo: null,
                telefono: colTel ? String(item[colTel] || '').trim() || null : null,
                web: colWeb ? String(item[colWeb] || '').trim() || null : null,
                fuente: 'OpenData-Euskadi',
            });
        }

        if (contactos.length > 0) {
            await db.upsertContactos(contactos);
        }
        log(`  Euskadi: ${contactos.length} municipios importados, ${contactos.filter(c => c.email_general).length} con email`);
        return contactos.length;
    } catch (err) {
        log(`  Error Euskadi: ${err.message}`);
        return 0;
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

const FUENTES = {
    andalucia: importarAndalucia,
    navarra: importarNavarra,
    clm: importarCLM,
    galicia: importarGalicia,
    castellon: importarCastellon,
    euskadi: importarEuskadi,
};

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--stats')) {
        await mostrarEstadisticas();
        await db.cerrar();
        return;
    }

    const fuenteIdx = args.indexOf('--fuente');
    const soloFuente = fuenteIdx !== -1 ? args[fuenteIdx + 1] : null;

    try {
        log('===== IMPORTACIÓN DESDE DATOS ABIERTOS CCAA =====');

        const fuentesAProcesar = soloFuente
            ? { [soloFuente]: FUENTES[soloFuente] }
            : FUENTES;

        let totalImportados = 0;

        for (const [nombre, fn] of Object.entries(fuentesAProcesar)) {
            if (!fn) {
                log(`Fuente desconocida: ${nombre}. Disponibles: ${Object.keys(FUENTES).join(', ')}`);
                continue;
            }

            try {
                const n = await fn();
                totalImportados += n;
            } catch (err) {
                log(`Error en ${nombre}: ${err.message}`);
            }

            await sleep(1000);
        }

        log(`\nTotal importados: ${totalImportados}`);
        await mostrarEstadisticas();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await db.cerrar();
    }
}

main();
