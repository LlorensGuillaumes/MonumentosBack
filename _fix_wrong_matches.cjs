/**
 * Identifica i neteja QIDs incorrectament assignats per la cerca parcial
 * de fase2_wikidata.cjs
 *
 * Un QID és incorrecte si:
 * 1. Apareix en múltiples municipis diferents (el QID real només pertany a un lloc)
 * 2. Les coordenades de Wikidata estan a >20km de les locals
 */

const removeAccents = require('remove-accents');
const db = require('./db.cjs');

function normalizarTexto(texto) {
    if (!texto) return '';
    return removeAccents(texto.toLowerCase()).replace(/[^a-z0-9 ]/g, '').trim();
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--fix');

    console.log('=== Detectar i netejar QIDs incorrectes ===');
    console.log(`Mode: ${dryRun ? 'DRY RUN (usa --fix per netejar)' : 'NETEJA'}\n`);

    // Get all items with QID
    const items = (await db.query(`
        SELECT b.id as bien_id, b.denominacion, b.municipio, b.provincia,
               b.comunidad_autonoma, b.latitud as lat, b.longitud as lon,
               w.id as wid, w.qid, w.raw_json, w.wikipedia_url
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid IS NOT NULL
    `)).rows;

    console.log(`Total items amb QID: ${items.length}\n`);

    // Group items by QID to find multi-municipality duplicates
    const qidToItems = new Map();
    for (const item of items) {
        if (!qidToItems.has(item.qid)) qidToItems.set(item.qid, []);
        qidToItems.get(item.qid).push(item);
    }

    // Criterion 1: QID used across >1 different municipality
    const wrongByMultiMuni = new Set();
    let qidsMultiMuni = 0;
    for (const [qid, qidItems] of qidToItems) {
        const munis = new Set(qidItems.map(i => i.municipio).filter(Boolean));
        if (munis.size > 1) {
            qidsMultiMuni++;
            // All items with this QID are suspect - keep only the one that matches best
            // For now, mark ALL as wrong (we'll re-match later)
            for (const item of qidItems) {
                wrongByMultiMuni.add(item.wid);
            }
        }
    }

    // Criterion 2: coordinate mismatch >20km
    const wrongByCoords = new Set();
    for (const item of items) {
        if (wrongByMultiMuni.has(item.wid)) continue; // already flagged
        if (!item.raw_json || !item.lat || !item.lon) continue;
        try {
            const json = JSON.parse(item.raw_json);
            const coordStr = json.coord?.value;
            if (coordStr) {
                const match = coordStr.match(/Point\(([^ ]+) ([^ ]+)\)/);
                if (match) {
                    const wdLon = parseFloat(match[1]);
                    const wdLat = parseFloat(match[2]);
                    const dist = haversineKm(item.lat, item.lon, wdLat, wdLon);
                    if (dist > 20) {
                        wrongByCoords.add(item.wid);
                    }
                }
            }
        } catch (e) {}
    }

    const allWrong = new Set([...wrongByMultiMuni, ...wrongByCoords]);

    console.log(`QIDs en múltiples municipis: ${qidsMultiMuni} QIDs, ${wrongByMultiMuni.size} items`);
    console.log(`Coordenades >20km: ${wrongByCoords.size} items`);
    console.log(`Total a netejar: ${allWrong.size}\n`);

    // Show some examples
    const examples = items.filter(i => allWrong.has(i.wid)).slice(0, 15);
    console.log('Exemples:');
    examples.forEach(e => {
        console.log(`  "${e.denominacion}" (${e.municipio}) -> ${e.qid} | wiki: ${(e.wikipedia_url || 'null').substring(0, 70)}`);
    });

    // Also count: how many items with QID will REMAIN after cleanup?
    const remaining = items.filter(i => !allWrong.has(i.wid));
    console.log(`\nItems amb QID que quedaran: ${remaining.length}`);

    // Count by region
    const byRegion = {};
    for (const item of items) {
        const r = item.comunidad_autonoma || 'unknown';
        if (!byRegion[r]) byRegion[r] = { total: 0, wrong: 0 };
        byRegion[r].total++;
        if (allWrong.has(item.wid)) byRegion[r].wrong++;
    }
    console.log('\nPer region:');
    for (const [region, stats] of Object.entries(byRegion).sort((a,b) => b[1].wrong - a[1].wrong)) {
        if (stats.wrong > 0) {
            console.log(`  ${region}: ${stats.wrong} incorrectes / ${stats.total} total (${(100*stats.wrong/stats.total).toFixed(1)}%)`);
        }
    }

    if (!dryRun && allWrong.size > 0) {
        console.log('\nNetejant...');

        await db.transaction(async (client) => {
            for (const wid of allWrong) {
                await client.query(`
                    UPDATE wikidata SET
                        qid = NULL, wikipedia_url = NULL, imagen_url = NULL,
                        descripcion = NULL, arquitecto = NULL, estilo = NULL,
                        material = NULL, altura = NULL, superficie = NULL,
                        inception = NULL, heritage_label = NULL, commons_category = NULL,
                        sipca_code = NULL, raw_json = NULL
                    WHERE id = $1
                `, [wid]);
            }
            // Clean wrong images
            for (const item of items) {
                if (allWrong.has(item.wid)) {
                    await client.query(`
                        DELETE FROM imagenes WHERE bien_id = $1 AND fuente = 'wikidata'
                    `, [item.bien_id]);
                }
            }
        });

        console.log(`Netejats ${allWrong.size} items.`);

        // Stats after cleanup
        const stats = {
            totalQid: (await db.query('SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL')).rows[0].n,
            totalWiki: (await db.query("SELECT COUNT(*) as n FROM wikidata WHERE wikipedia_url IS NOT NULL AND wikipedia_url NOT LIKE '%wikidata.org%'")).rows[0].n,
            totalImg: (await db.query('SELECT COUNT(*) as n FROM imagenes')).rows[0].n,
        };
        console.log(`\nDesprés de neteja:`);
        console.log(`  Items amb QID: ${stats.totalQid}`);
        console.log(`  Amb Wikipedia real: ${stats.totalWiki}`);
        console.log(`  Total imatges: ${stats.totalImg}`);
    }

    await db.cerrar();
}

main();
