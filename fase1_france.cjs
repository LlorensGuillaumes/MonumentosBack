/**
 * Fase 1: Descarga de patrimonio de Francia
 * Fuente: data.culture.gouv.fr - Liste des immeubles protégés au titre des monuments historiques
 * ~46,000 registros con coordenadas, categoría (classé/inscrit), departamento, comuna
 */

const axios = require('axios');
const db = require('./db.cjs');

const DATA_URL = 'https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/liste-des-immeubles-proteges-au-titre-des-monuments-historiques/exports/json';

async function ejecutar() {
    console.log('=== FASE 1: Descarga patrimonio Francia (data.culture.gouv.fr) ===\n');

    console.log('Descargando JSON completo de monuments historiques...');
    const response = await axios.get(DATA_URL, {
        timeout: 120000,
        maxContentLength: 500 * 1024 * 1024,
    });
    const data = response.data;

    if (!Array.isArray(data)) {
        throw new Error('Formato inesperado: se esperaba un array JSON');
    }

    console.log(`Descargados ${data.length} registros.\n`);

    // Verificar si ya tenemos datos de Francia
    const existentes = (await db.query(
        "SELECT COUNT(*) as n FROM bienes WHERE pais = 'Francia'"
    )).rows[0].n;
    if (existentes > 0) {
        console.log(`Ya existen ${existentes} registros de Francia. Se actualizarán con upsert.\n`);
    }

    let insertados = 0;
    let sinCoords = 0;
    const batch = [];

    for (const item of data) {
        const bien = mapearBien(item);
        if (!bien) continue;

        batch.push(bien);

        if (batch.length >= 1000) {
            await db.upsertBienes(batch);
            insertados += batch.length;
            process.stdout.write(`\r  Procesados: ${insertados}/${data.length}`);
            batch.length = 0;
        }
    }

    // Insertar último batch
    if (batch.length > 0) {
        await db.upsertBienes(batch);
        insertados += batch.length;
    }

    // Contar sin coordenadas
    sinCoords = (await db.query(
        "SELECT COUNT(*) as n FROM bienes WHERE pais = 'Francia' AND latitud IS NULL"
    )).rows[0].n;

    const totalFR = (await db.query(
        "SELECT COUNT(*) as n FROM bienes WHERE pais = 'Francia'"
    )).rows[0].n;

    console.log(`\n\nFase 1 Francia completada:`);
    console.log(`  - Registros procesados: ${insertados}`);
    console.log(`  - Total en BD (Francia): ${totalFR}`);
    console.log(`  - Sin coordenadas: ${sinCoords}`);

    // Distribución por región
    const porRegion = (await db.query(
        "SELECT comunidad_autonoma, COUNT(*) as n FROM bienes WHERE pais = 'Francia' GROUP BY comunidad_autonoma ORDER BY n DESC"
    )).rows;
    console.log('  - Por región:');
    porRegion.forEach(r => console.log(`      ${r.comunidad_autonoma || 'Sin dato'}: ${r.n}`));

    await db.cerrar();
}

function mapearBien(item) {
    // Nombre: preferir titre_editorial, luego denomination
    const denominacion = limpiarTexto(item.titre_editorial_de_la_notice)
        || limpiarTexto(item.denomination_de_l_edifice)
        || limpiarTexto(item.appellation_courante)
        || null;

    if (!denominacion) return null;

    // Código fuente: referencia Mérimée (ej: PA00078021)
    const codigo = limpiarTexto(item.reference) || null;
    if (!codigo) return null;

    // Coordenadas
    let latitud = null, longitud = null;
    if (item.coordonnees_au_format_wgs84) {
        const coords = item.coordonnees_au_format_wgs84;
        if (coords.lat && coords.lon) {
            latitud = parseFloat(coords.lat);
            longitud = parseFloat(coords.lon);
        }
    }

    // Categoría de protección
    const categoria = limpiarTexto(item.typologie_de_la_protection) || null;

    // Región y departamento
    const region = limpiarTexto(item.region) || null;
    const departement = limpiarTexto(item.departement_en_lettres) || null;
    const commune = limpiarTexto(item.commune_forme_index) || null;

    // Siglo de construcción
    const siglo = limpiarTexto(item.format_abrege_du_siecle_de_construction) || null;

    return {
        denominacion,
        tipo: 'Monument historique',
        clase: null,
        categoria,
        provincia: departement,
        comarca: null,
        municipio: commune,
        localidad: null,
        latitud,
        longitud,
        situacion: siglo,
        resolucion: null,
        publicacion: null,
        fuente_opendata: 0,
        comunidad_autonoma: region,
        codigo_fuente: codigo,
        pais: 'Francia',
    };
}

function limpiarTexto(valor) {
    if (valor === null || valor === undefined) return null;
    const texto = String(valor).trim();
    return texto === '' ? null : texto;
}

module.exports = { ejecutar };

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error en Fase 1 Francia:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
