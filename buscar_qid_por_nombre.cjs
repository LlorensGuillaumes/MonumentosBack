/**
 * buscar_qid_por_nombre.cjs
 * Busca QIDs de Wikidata per items sense QID, agrupant per municipi.
 * Fa una SPARQL query per municipi per obtenir tots els items patrimoni
 * i fa matching per nom normalitzat.
 *
 * Us: node buscar_qid_por_nombre.cjs [--region Catalunya]
 */

const axios = require('axios');
const removeAccents = require('remove-accents');
const db = require('./db.cjs');

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const HEADERS = { Accept: 'application/sparql-results+json', 'User-Agent': 'PatrimonioEspanaBot/1.0 (heritage QID matching)' };
const DELAY_MS = 1500;

function normalizarTexto(texto) {
    if (!texto) return '';
    return removeAccents(texto.toLowerCase()).replace(/[^a-z0-9 ]/g, '').trim();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Obte tots els items patrimoni d'un municipi des de Wikidata
 */
async function obtenerItemsMunicipio(municipio) {
    // Intentar amb ca, es, en (alguns municipis tenen nom en un idioma o altre)
    const idiomas = ['ca', 'es', 'en'];

    for (const lang of idiomas) {
        const sparql = `
SELECT ?item ?itemLabel ?itemAltLabel WHERE {
  ?item wdt:P1435 ?heritage .
  ?item wdt:P131 ?loc .
  ?loc rdfs:label "${municipio.replace(/"/g, '\\"')}"@${lang} .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},ca,es,en". }
}`;

        try {
            const resp = await axios.get(WIKIDATA_SPARQL, {
                params: { query: sparql, format: 'json' },
                headers: HEADERS,
                timeout: 30000,
            });

            const results = resp.data.results.bindings;
            if (results.length > 0) {
                // Deduplicar per QID (un item pot tenir multiples P1435)
                const seen = new Set();
                const items = [];
                for (const r of results) {
                    const qid = r.item.value.split('/').pop();
                    if (seen.has(qid)) continue;
                    seen.add(qid);
                    items.push({
                        qid,
                        label: r.itemLabel?.value || '',
                        altLabels: r.itemAltLabel?.value || '',
                    });
                }
                return items;
            }
        } catch (err) {
            if (err.response?.status === 429) {
                console.log('    Rate limited, esperant 10s...');
                await sleep(10000);
                // Reintentar
                return obtenerItemsMunicipio(municipio);
            }
            // Si falla amb un idioma, provar el seguent
        }
    }

    return [];
}

/**
 * Fa matching entre items locals i items Wikidata
 */
function matchItems(bienesLocals, wikidataItems) {
    const matches = [];

    // Crear mapa normalitzat dels items Wikidata
    const wdMap = new Map(); // normName -> [{qid, label}]
    for (const wd of wikidataItems) {
        const normLabel = normalizarTexto(wd.label);
        if (normLabel) {
            if (!wdMap.has(normLabel)) wdMap.set(normLabel, []);
            wdMap.get(normLabel).push(wd);
        }
        // Afegir tambe altLabels (separats per comes)
        if (wd.altLabels) {
            for (const alt of wd.altLabels.split(',')) {
                const normAlt = normalizarTexto(alt);
                if (normAlt) {
                    if (!wdMap.has(normAlt)) wdMap.set(normAlt, []);
                    wdMap.get(normAlt).push(wd);
                }
            }
        }
    }

    for (const bien of bienesLocals) {
        const normDenom = normalizarTexto(bien.denominacion);
        if (!normDenom) continue;

        // Match exacte
        if (wdMap.has(normDenom)) {
            const candidates = wdMap.get(normDenom);
            // Deduplicar per QID (un item pot apareixer multiples vegades per multiples P1435)
            const uniqueQids = [...new Set(candidates.map(c => c.qid))];
            if (uniqueQids.length === 1) {
                matches.push({ bien_id: bien.id, qid: uniqueQids[0], denominacion: bien.denominacion, wdLabel: candidates[0].label });
            }
            // Si hi ha mes d'un QID diferent, saltar (ambigu)
        }
    }

    return matches;
}

async function main() {
    const args = process.argv.slice(2);
    const regionIdx = args.indexOf('--region');
    const regionArg = regionIdx !== -1 ? args[regionIdx + 1] : null;

    console.log('=== Buscar QIDs per nom de monument ===\n');

    // Obtenir items sense QID, agrupats per municipi
    // Inclou tant items sense fila a wikidata com amb fila pero qid=NULL
    let sql;
    let params = [];
    if (regionArg) {
        sql = `
            SELECT b.id, b.denominacion, b.municipio, b.comunidad_autonoma
            FROM bienes b
            LEFT JOIN wikidata w ON b.id = w.bien_id
            WHERE (w.id IS NULL OR w.qid IS NULL) AND b.municipio IS NOT NULL AND b.comunidad_autonoma = ?
            ORDER BY b.municipio, b.denominacion
        `;
        params = [regionArg];
        console.log(`Regio: ${regionArg}`);
    } else {
        sql = `
            SELECT b.id, b.denominacion, b.municipio, b.comunidad_autonoma
            FROM bienes b
            LEFT JOIN wikidata w ON b.id = w.bien_id
            WHERE (w.id IS NULL OR w.qid IS NULL) AND b.municipio IS NOT NULL
            ORDER BY b.municipio, b.denominacion
        `;
    }

    const bienesSinQid = (await db.query(sql, params)).rows;
    console.log(`Items sense QID amb municipi: ${bienesSinQid.length}\n`);

    if (bienesSinQid.length === 0) {
        console.log('No hi ha items per processar.');
        await db.cerrar();
        return;
    }

    // Agrupar per municipi
    const porMunicipi = new Map();
    for (const b of bienesSinQid) {
        const key = b.municipio;
        if (!porMunicipi.has(key)) porMunicipi.set(key, []);
        porMunicipi.get(key).push(b);
    }

    console.log(`Municipis a consultar: ${porMunicipi.size}\n`);

    let totalMatched = 0;
    let totalMunicipis = 0;
    let municipisAmbMatch = 0;
    const allMatches = [];

    for (const [municipio, bienes] of porMunicipi) {
        totalMunicipis++;

        if (totalMunicipis % 50 === 0) {
            console.log(`\n--- Progres: ${totalMunicipis}/${porMunicipi.size} municipis, ${totalMatched} matches ---\n`);
        }

        process.stdout.write(`  ${municipio} (${bienes.length} items)... `);

        await sleep(DELAY_MS);
        const wikidataItems = await obtenerItemsMunicipio(municipio);

        if (wikidataItems.length === 0) {
            console.log('0 items WD');
            continue;
        }

        const matches = matchItems(bienes, wikidataItems);

        if (matches.length > 0) {
            municipisAmbMatch++;
            // Guardar a la DB using transaction
            await db.transaction(async (client) => {
                for (const m of matches) {
                    const upd = await client.query('UPDATE wikidata SET qid = $1 WHERE bien_id = $2 AND qid IS NULL', [m.qid, m.bien_id]);
                    if (upd.rowCount === 0) {
                        await client.query('INSERT INTO wikidata (bien_id, qid) VALUES ($1, $2) ON CONFLICT (bien_id) DO NOTHING', [m.bien_id, m.qid]);
                    }
                }
            });

            allMatches.push(...matches);
            totalMatched += matches.length;
            console.log(`${wikidataItems.length} items WD -> ${matches.length} matches`);
        } else {
            console.log(`${wikidataItems.length} items WD -> 0 matches`);
        }
    }

    console.log('\n=== RESUM ===');
    console.log(`Municipis processats: ${totalMunicipis}`);
    console.log(`Municipis amb match: ${municipisAmbMatch}`);
    console.log(`Total matches: ${totalMatched}`);

    if (allMatches.length > 0) {
        console.log('\nPrimers 20 matches:');
        for (const m of allMatches.slice(0, 20)) {
            console.log(`  ${m.qid} <- "${m.denominacion}" (WD: "${m.wdLabel}")`);
        }
    }

    // Verificar quants queden sense QID
    const remaining = (await db.query(`
        SELECT COUNT(*) as n FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE w.id IS NULL OR w.qid IS NULL
    `)).rows[0].n;
    console.log(`\nItems encara sense QID: ${remaining}`);

    await db.cerrar();
}

main().catch(async err => {
    console.error('Error:', err);
    await db.cerrar();
    process.exit(1);
});
