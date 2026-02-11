/**
 * Obtiene imagenes adicionales de Wikimedia Commons
 * para items que tienen commons_category pero pocas imagenes
 */

const axios = require('axios');
const db = require('./db.cjs');

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const DELAY_MS = 200;
const MAX_IMAGES_PER_ITEM = 5;

async function ejecutar() {
    console.log('=== OBTENER IMAGENES DE COMMONS ===\n');

    // Obtener items con commons_category
    const conCommons = (await db.query(`
        SELECT w.id, w.bien_id, w.commons_category, b.denominacion
        FROM wikidata w
        JOIN bienes b ON w.bien_id = b.id
        WHERE w.commons_category IS NOT NULL
        ORDER BY b.comunidad_autonoma
    `)).rows;

    console.log(`Items con Commons category: ${conCommons.length}\n`);

    // Filtrar los que ya tienen suficientes imagenes
    const pendientes = [];
    for (const item of conCommons) {
        const numImg = (await db.query('SELECT COUNT(*) as n FROM imagenes WHERE bien_id = ?', [item.bien_id])).rows[0].n;
        if (numImg < MAX_IMAGES_PER_ITEM) {
            pendientes.push({ ...item, imagenesActuales: numImg });
        }
    }

    console.log(`Items que necesitan mas imagenes: ${pendientes.length}\n`);

    if (pendientes.length === 0) {
        console.log('Nada que hacer.');
        await db.cerrar();
        return;
    }

    let itemsProcesados = 0;
    let imagenesNuevas = 0;
    let errores = 0;

    for (let i = 0; i < pendientes.length; i++) {
        const item = pendientes[i];

        if (i % 100 === 0) {
            console.log(`[${i}/${pendientes.length}] Procesando... (${imagenesNuevas} imagenes nuevas)`);
        }

        try {
            const imagenes = await obtenerImagenesDeCategoria(item.commons_category, MAX_IMAGES_PER_ITEM - item.imagenesActuales);

            for (const img of imagenes) {
                // Verificar que no existe ya
                const existe = (await db.query('SELECT id FROM imagenes WHERE bien_id = ? AND url = ?', [item.bien_id, img.url])).rows[0];
                if (!existe) {
                    await db.insertarImagen({
                        bien_id: item.bien_id,
                        url: img.url,
                        titulo: img.titulo || item.denominacion,
                        autor: img.autor || null,
                        fuente: 'commons'
                    });
                    imagenesNuevas++;
                }
            }

            itemsProcesados++;
        } catch (err) {
            errores++;
            if (errores <= 5) {
                console.error(`  Error en ${item.commons_category}: ${err.message}`);
            }
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nResultado:`);
    console.log(`  - Items procesados: ${itemsProcesados}`);
    console.log(`  - Imagenes nuevas: ${imagenesNuevas}`);
    console.log(`  - Errores: ${errores}`);

    // Stats finales
    const totalImg = (await db.query('SELECT COUNT(*) as n FROM imagenes')).rows[0].n;
    const conImg = (await db.query('SELECT COUNT(DISTINCT bien_id) as n FROM imagenes')).rows[0].n;
    console.log(`\nTotal imagenes: ${totalImg}`);
    console.log(`Bienes con imagen: ${conImg}`);

    await db.cerrar();
}

async function obtenerImagenesDeCategoria(categoria, limite) {
    const response = await axios.get(COMMONS_API, {
        params: {
            action: 'query',
            list: 'categorymembers',
            cmtitle: `Category:${categoria}`,
            cmtype: 'file',
            cmlimit: limite,
            format: 'json'
        },
        headers: {
            'User-Agent': 'PatrimonioEspanaBot/1.0 (heritage data project)'
        },
        timeout: 10000
    });

    if (!response.data.query || !response.data.query.categorymembers) {
        return [];
    }

    const archivos = response.data.query.categorymembers;
    const imagenes = [];

    for (const archivo of archivos) {
        // Solo procesar imagenes (no PDFs, etc)
        const titulo = archivo.title;
        if (!titulo.match(/\.(jpg|jpeg|png|gif|svg)$/i)) {
            continue;
        }

        // Obtener URL de la imagen
        const infoResponse = await axios.get(COMMONS_API, {
            params: {
                action: 'query',
                titles: titulo,
                prop: 'imageinfo',
                iiprop: 'url|user',
                format: 'json'
            },
            headers: {
                'User-Agent': 'PatrimonioEspanaBot/1.0'
            },
            timeout: 10000
        });

        const pages = infoResponse.data.query.pages;
        const pageId = Object.keys(pages)[0];
        const page = pages[pageId];

        if (page.imageinfo && page.imageinfo[0]) {
            imagenes.push({
                url: page.imageinfo[0].url,
                titulo: titulo.replace('File:', '').replace(/\.[^.]+$/, ''),
                autor: page.imageinfo[0].user || null
            });
        }

        await sleep(50); // Pequena pausa entre subconsultas
    }

    return imagenes;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}

module.exports = { ejecutar };
