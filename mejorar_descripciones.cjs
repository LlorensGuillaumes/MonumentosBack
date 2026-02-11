/**
 * Mejora las descripciones extrayendo de Wikipedia (para URLs es.wikipedia)
 * y de Wikidata API (para QIDs sin descripcion util)
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIPEDIA_API = 'https://es.wikipedia.org/api/rest_v1/page/summary/';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const DELAY_MS = 100;

// Descripciones genericas que queremos reemplazar
const DESCRIPCIONES_GENERICAS = [
    'bien de interes cultural',
    'bien de interes cultural',
    'monumento',
    'edificio',
    'patrimonio',
];

function esDescripcionGenerica(desc) {
    if (!desc || desc.length < 30) return true;
    const lower = desc.toLowerCase().trim();
    return DESCRIPCIONES_GENERICAS.some(g => lower === g || lower.startsWith(g + ' '));
}

async function ejecutar() {
    console.log('=== MEJORAR DESCRIPCIONES ===\n');

    // 1. Primero: items con URL de es.wikipedia.org y sin descripcion util
    console.log('1. Extrayendo de Wikipedia (es.wikipedia.org)...');

    const conWikipedia = (await db.query(`
        SELECT w.id, w.bien_id, w.wikipedia_url, w.descripcion, b.denominacion
        FROM wikidata w
        JOIN bienes b ON w.bien_id = b.id
        WHERE w.wikipedia_url LIKE '%es.wikipedia.org%'
          AND (w.descripcion IS NULL
               OR LENGTH(w.descripcion) < 50
               OR w.descripcion LIKE 'bien de interes cultural%'
               OR w.descripcion = 'bien de interes cultural')
        LIMIT 5000
    `)).rows;

    console.log(`  Items con Wikipedia para mejorar: ${conWikipedia.length}`);

    let mejorados = 0;
    let errores = 0;

    for (let i = 0; i < conWikipedia.length; i++) {
        const item = conWikipedia[i];

        if (i % 200 === 0 && i > 0) {
            console.log(`  [${i}/${conWikipedia.length}] ${mejorados} mejorados...`);
        }

        try {
            const titulo = extraerTituloDeURL(item.wikipedia_url);
            if (!titulo) continue;

            const extracto = await obtenerExtractoWikipedia(titulo);

            if (extracto && extracto.length > 50 && !esDescripcionGenerica(extracto)) {
                await db.query('UPDATE wikidata SET descripcion = ? WHERE id = ?', [extracto, item.id]);
                mejorados++;
            }
        } catch (err) {
            errores++;
        }

        await sleep(DELAY_MS);
    }

    console.log(`  Mejorados: ${mejorados}, Errores: ${errores}`);

    // 2. Segundo: items con QID pero sin descripcion util
    console.log('\n2. Extrayendo de Wikidata API...');

    const conQID = (await db.query(`
        SELECT w.id, w.qid, w.descripcion
        FROM wikidata w
        WHERE w.qid IS NOT NULL
          AND (w.descripcion IS NULL
               OR LENGTH(w.descripcion) < 30
               OR w.descripcion LIKE 'bien de interes cultural%')
        LIMIT 5000
    `)).rows;

    console.log(`  Items con QID para mejorar: ${conQID.length}`);

    // Procesar en lotes de 50 QIDs
    const BATCH_SIZE = 50;
    let mejoradosWD = 0;

    for (let i = 0; i < conQID.length; i += BATCH_SIZE) {
        const batch = conQID.slice(i, i + BATCH_SIZE);
        const qids = batch.map(item => item.qid);

        if (i % 500 === 0) {
            console.log(`  [${i}/${conQID.length}] ${mejoradosWD} mejorados...`);
        }

        try {
            const descripciones = await obtenerDescripcionesWikidata(qids);

            for (const item of batch) {
                const desc = descripciones.get(item.qid);
                if (desc && desc.length > 30 && !esDescripcionGenerica(desc)) {
                    await db.query('UPDATE wikidata SET descripcion = ? WHERE id = ?', [desc, item.id]);
                    mejoradosWD++;
                }
            }
        } catch (err) {
            // Silently continue
        }

        await sleep(DELAY_MS * 2);
    }

    console.log(`  Mejorados: ${mejoradosWD}`);

    // Stats finales
    const totalConDesc = (await db.query(`
        SELECT COUNT(*) as n FROM wikidata
        WHERE descripcion IS NOT NULL AND LENGTH(descripcion) > 50
    `)).rows[0].n;

    console.log(`\nTotal con descripcion util (>50 chars): ${totalConDesc}`);

    await db.cerrar();
}

function extraerTituloDeURL(url) {
    const match = url.match(/wikipedia\.org\/wiki\/(.+)$/);
    if (match) {
        return decodeURIComponent(match[1].replace(/_/g, ' '));
    }
    return null;
}

async function obtenerExtractoWikipedia(titulo) {
    const response = await axios.get(WIKIPEDIA_API + encodeURIComponent(titulo), {
        headers: {
            'User-Agent': 'PatrimonioEspanaBot/1.0',
            'Accept': 'application/json'
        },
        timeout: 10000
    });

    if (response.data && response.data.extract) {
        let extracto = response.data.extract;
        // Limitar a 500 caracteres
        if (extracto.length > 500) {
            extracto = extracto.substring(0, 497) + '...';
        }
        return extracto;
    }

    return null;
}

async function obtenerDescripcionesWikidata(qids) {
    const response = await axios.get(WIKIDATA_API, {
        params: {
            action: 'wbgetentities',
            ids: qids.join('|'),
            props: 'descriptions',
            languages: 'es|en',
            format: 'json'
        },
        headers: {
            'User-Agent': 'PatrimonioEspanaBot/1.0'
        },
        timeout: 30000
    });

    const resultMap = new Map();

    if (response.data && response.data.entities) {
        for (const [qid, entity] of Object.entries(response.data.entities)) {
            if (entity.descriptions) {
                const desc = entity.descriptions.es?.value || entity.descriptions.en?.value;
                if (desc) {
                    resultMap.set(qid, desc);
                }
            }
        }
    }

    return resultMap;
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
