/**
 * Extrae descripciones de Wikipedia para items que tienen URL pero no descripcion
 * Usa la API de Wikipedia para obtener el extracto del articulo
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIPEDIA_API = 'https://es.wikipedia.org/api/rest_v1/page/summary/';
const DELAY_MS = 100; // Wikipedia API es mas permisiva
const BATCH_SIZE = 50;

async function ejecutar() {
    console.log('=== EXTRAER DESCRIPCIONES DE WIKIPEDIA ===\n');

    // Obtener items con Wikipedia URL pero sin descripcion
    const pendientes = (await db.query(`
        SELECT w.id, w.bien_id, w.wikipedia_url, b.denominacion
        FROM wikidata w
        JOIN bienes b ON w.bien_id = b.id
        WHERE w.wikipedia_url IS NOT NULL
          AND (w.descripcion IS NULL OR w.descripcion = '')
        ORDER BY b.comunidad_autonoma
    `)).rows;

    console.log(`Items con Wikipedia sin descripcion: ${pendientes.length}\n`);

    if (pendientes.length === 0) {
        console.log('Nada que hacer.');
        await db.cerrar();
        return;
    }

    let extraidos = 0;
    let errores = 0;

    for (let i = 0; i < pendientes.length; i++) {
        const item = pendientes[i];

        if (i % 100 === 0) {
            console.log(`[${i}/${pendientes.length}] Procesando...`);
        }

        try {
            // Extraer titulo del articulo de la URL
            const titulo = extraerTituloDeURL(item.wikipedia_url);
            if (!titulo) {
                errores++;
                continue;
            }

            const descripcion = await obtenerExtractoWikipedia(titulo);

            if (descripcion) {
                await db.query('UPDATE wikidata SET descripcion = ? WHERE id = ?', [descripcion, item.id]);
                extraidos++;
            }
        } catch (err) {
            errores++;
            if (errores <= 5) {
                console.error(`  Error en ${item.denominacion}: ${err.message}`);
            }
        }

        await sleep(DELAY_MS);
    }

    console.log(`\nResultado:`);
    console.log(`  - Descripciones extraidas: ${extraidos}`);
    console.log(`  - Errores: ${errores}`);

    // Stats finales
    const conDesc = (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE descripcion IS NOT NULL')).rows[0].n;
    console.log(`\nTotal con descripcion: ${conDesc}`);

    await db.cerrar();
}

function extraerTituloDeURL(url) {
    // https://es.wikipedia.org/wiki/Titulo_del_articulo
    const match = url.match(/wikipedia\.org\/wiki\/(.+)$/);
    if (match) {
        return decodeURIComponent(match[1]);
    }
    return null;
}

async function obtenerExtractoWikipedia(titulo) {
    const response = await axios.get(WIKIPEDIA_API + encodeURIComponent(titulo), {
        headers: {
            'User-Agent': 'PatrimonioEspanaBot/1.0 (heritage data project)',
            'Accept': 'application/json'
        },
        timeout: 10000
    });

    if (response.data && response.data.extract) {
        // Limitar a primeras 500 caracteres para no sobrecargar la DB
        let extracto = response.data.extract;
        if (extracto.length > 500) {
            extracto = extracto.substring(0, 497) + '...';
        }
        return extracto;
    }

    return null;
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
