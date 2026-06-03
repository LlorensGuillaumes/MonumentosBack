/**
 * Descarga TODOS los municipios de España vía WFS INSPIRE del IGN.
 */
const fs = require('fs');
const https = require('https');
const { parseString } = require('xml2js');

const WFS_URL = 'https://www.ign.es/wfs-inspire/unidades-administrativas';
const PAGE_SIZE = 100;
const TOTAL_PAGES = 82;
const SLEEP_MS = 1500;

function fetch(url) {
    return new Promise((res, rej) => {
        https.get(url, r => {
            let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
        }).on('error', rej);
    });
}

function parseXML(xml) {
    return new Promise((res, rej) => {
        parseString(xml, { explicitArray: false }, (e, r) => {
            if (e) rej(e); else res(r);
        });
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractName(nameObj) {
    try {
        const gn = nameObj['gn:GeographicalName'];
        if (!gn) return null;
        const spelling = gn['gn:spelling'];
        if (!spelling) return null;
        const spArr = [].concat(spelling);
        for (const sp of spArr) {
            const sn = sp['gn:SpellingOfName'];
            if (sn && sn['gn:text']) {
                const t = typeof sn['gn:text'] === 'object' ? sn['gn:text']._ : sn['gn:text'];
                if (t && !t.startsWith('Q')) return t;
            }
        }
    } catch (e) { /* */ }
    return null;
}

function parsePosList(str) {
    const nums = String(str).trim().split(/\s+/).map(parseFloat);
    const coords = [];
    for (let i = 0; i < nums.length; i += 2) {
        coords.push([nums[i + 1], nums[i]]);
    }
    return coords;
}

function extractGeometry(geomObj) {
    const ms = geomObj['gml:MultiSurface'];
    if (!ms) return null;
    const sm = [].concat(ms['gml:surfaceMember']);
    const polys = [];
    for (const m of sm) {
        const p = m['gml:Polygon'];
        if (!p) continue;
        const exterior = p['gml:exterior'];
        if (!exterior) continue;
        const ring = exterior['gml:LinearRing'];
        if (!ring || !ring['gml:posList']) continue;
        const outer = parsePosList(ring['gml:posList']);
        const rings = [outer];
        if (p['gml:interior']) {
            const intArr = [].concat(p['gml:interior']);
            for (const i of intArr) {
                if (i['gml:LinearRing'] && i['gml:LinearRing']['gml:posList']) {
                    rings.push(parsePosList(i['gml:LinearRing']['gml:posList']));
                }
            }
        }
        polys.push(rings);
    }
    if (polys.length === 0) return null;
    return { type: 'MultiPolygon', coordinates: polys };
}

async function downloadPage(startIndex) {
    const url = `${WFS_URL}?service=WFS&version=2.0.0&request=GetFeature&typeNames=au:AdministrativeUnit&count=${PAGE_SIZE}&startIndex=${startIndex}`;
    const xml = await fetch(url);
    const parsed = await parseXML(xml);
    const fc = parsed['wfs:FeatureCollection'];
    if (!fc || !fc['wfs:member']) return [];
    const members = [].concat(fc['wfs:member']);
    const features = [];
    for (const m of members) {
        const au = m['au:AdministrativeUnit'];
        if (!au) continue;
        const levelHref = au['au:nationalLevel']?.['$']?.['xlink:href'] || '';
        if (!levelHref.endsWith('4thOrder')) continue;
        const name = extractName(au['au:name']);
        const geometry = extractGeometry(au['au:geometry']);
        if (!name || !geometry) continue;
        features.push({
            type: 'Feature',
            properties: { name, nationalCode: au['au:nationalCode'] },
            geometry,
        });
    }
    return features;
}

async function main() {
    const all = { type: 'FeatureCollection', features: [] };
    let totalOk = 0, totalErr = 0;
    for (let page = 0; page < TOTAL_PAGES; page++) {
        const startIndex = page * PAGE_SIZE;
        try {
            const fs2 = await downloadPage(startIndex);
            all.features.push(...fs2);
            totalOk++;
            if (page % 5 === 0 || page === TOTAL_PAGES - 1) {
                console.log(`  [page ${page + 1}/${TOTAL_PAGES}] startIndex=${startIndex} → +${fs2.length} feats (total acum: ${all.features.length})`);
            }
        } catch (e) {
            totalErr++;
            console.log(`  ⚠ page ${page} ERROR: ${e.message}`);
        }
        await sleep(SLEEP_MS);
    }
    fs.writeFileSync('./municipios_espana_full.geojson', JSON.stringify(all));
    console.log(`\n=== Resumen ===`);
    console.log(`  Páginas OK: ${totalOk} / errores: ${totalErr}`);
    console.log(`  Total municipios: ${all.features.length}`);
    console.log(`  Guardado en: ./municipios_espana_full.geojson`);
}

main().catch(e => { console.error(e); process.exit(1); });
