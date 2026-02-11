/**
 * asignar_distritos_portugal.cjs
 * Asigna distrito (comunidad_autonoma + provincia) a los items de Portugal
 * que no lo tienen, consultando P131+ transitivo en Wikidata.
 *
 * Uso:
 *   node asignar_distritos_portugal.cjs          # dry run
 *   node asignar_distritos_portugal.cjs --aplicar # aplicar cambios
 */

const axios = require('axios');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'Accept': 'application/sparql-results+json',
    'User-Agent': 'PatrimonioEuropaBot/1.0 (heritage district assignment)'
};
const DELAY_MS = 2500;
const BATCH_SIZE = 50;

// QIDs CORRECTOS de los distritos de Portugal (P31 = distrito de Portugal)
const DISTRITOS_QID = {
    'Q207199': 'Lisboa',
    'Q322792': 'Porto',
    'Q326203': 'Braga',
    'Q274109': 'Setúbal',
    'Q210527': 'Aveiro',
    'Q244521': 'Faro',
    'Q244512': 'Leiria',
    'Q244517': 'Coimbra',
    'Q244510': 'Santarém',
    'Q273525': 'Viseu',
    'Q326214': 'Viana do Castelo',
    'Q379372': 'Vila Real',
    'Q274118': 'Évora',
    'Q273529': 'Castelo Branco',
    'Q273533': 'Guarda',
    'Q321455': 'Beja',
    'Q373528': 'Bragança',
    'Q225189': 'Portalegre',
    // Regiões autónomas
    'Q25263': 'Açores',
    'Q26253': 'Madeira',
};

const DISTRITOS_VALUES = Object.keys(DISTRITOS_QID).map(q => `wd:${q}`).join(' ');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function consultarBatch(qids) {
    const valuesClause = qids.map(q => `wd:${q}`).join(' ');

    const query = `
SELECT ?item ?distrito WHERE {
    VALUES ?item { ${valuesClause} }
    VALUES ?distrito { ${DISTRITOS_VALUES} }
    ?item wdt:P131+ ?distrito .
}
`;

    const res = await axios.get(WIKIDATA_SPARQL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 120000,
    });

    const results = new Map();
    for (const r of res.data.results.bindings) {
        const qid = r.item?.value?.split('/').pop();
        const distQid = r.distrito?.value?.split('/').pop();
        if (!qid || !distQid || results.has(qid)) continue;

        const distrito = DISTRITOS_QID[distQid];
        if (distrito) {
            results.set(qid, distrito);
        }
    }

    return results;
}

async function main() {
    const aplicar = process.argv.includes('--aplicar');

    console.log('=== Asignar distritos a Portugal ===');
    console.log(`Modo: ${aplicar ? 'APLICAR cambios' : 'DRY RUN'}\n`);

    // Items de Portugal sin comunidad_autonoma que tienen QID
    const items = (await db.query(`
        SELECT b.id, b.denominacion, w.qid
        FROM bienes b
        JOIN wikidata w ON w.bien_id = b.id
        WHERE b.pais = 'Portugal'
          AND (b.comunidad_autonoma IS NULL OR b.comunidad_autonoma = '')
          AND w.qid IS NOT NULL AND w.qid != ''
    `)).rows;

    console.log(`Items sin distrito con QID: ${items.length}\n`);

    let asignados = 0;
    let sinDistrito = 0;
    const porDistrito = {};

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const qids = batch.map(b => b.qid);
        const progress = `[${i + 1}-${Math.min(i + BATCH_SIZE, items.length)}/${items.length}]`;

        process.stdout.write(`${progress} Consultando ${qids.length} items... `);

        try {
            const results = await consultarBatch(qids);

            let batchFound = 0;
            for (const item of batch) {
                const distrito = results.get(item.qid);
                if (distrito) {
                    batchFound++;
                    asignados++;
                    porDistrito[distrito] = (porDistrito[distrito] || 0) + 1;

                    if (aplicar) {
                        await db.query('UPDATE bienes SET comunidad_autonoma = ?, provincia = ? WHERE id = ?', [distrito, distrito, item.id]);
                    }
                } else {
                    sinDistrito++;
                }
            }
            console.log(`${batchFound} distritos encontrados`);
        } catch (err) {
            if (err.response?.status === 429) {
                console.log('Rate limited, esperando 20s...');
                await sleep(20000);
                i -= BATCH_SIZE;
                continue;
            }
            if (err.code === 'ECONNABORTED') {
                console.log('Timeout, reduciendo batch y reintentando...');
                await sleep(5000);
                i -= BATCH_SIZE;
                continue;
            }
            console.log(`Error: ${err.message}`);
        }

        await sleep(DELAY_MS);
    }

    console.log('\n=== Resultados ===');
    console.log(`Asignados: ${asignados}`);
    console.log(`Sin distrito encontrado: ${sinDistrito}`);
    console.log('\nPor distrito:');
    const sorted = Object.entries(porDistrito).sort((a, b) => b[1] - a[1]);
    for (const [d, c] of sorted) {
        console.log(`  ${d}: ${c}`);
    }

    if (!aplicar && asignados > 0) {
        console.log(`\nPara aplicar cambios: node asignar_distritos_portugal.cjs --aplicar`);
    }

    const sinCA = (await db.query("SELECT COUNT(*) as c FROM bienes WHERE pais = 'Portugal' AND (comunidad_autonoma IS NULL OR comunidad_autonoma = '')")).rows[0].c;
    console.log(`\nPortugal sin distrito: ${sinCA}`);

    await db.cerrar();
}

main().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});
