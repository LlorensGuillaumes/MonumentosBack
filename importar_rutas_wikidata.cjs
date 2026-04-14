/**
 * Importa rutas seleccionadas desde Wikidata a rutas_culturales + paradas.
 * Escribe en LOCAL y NEON.
 *
 * Entrada: tmp_top_rutas.json (18 rutas seleccionadas)
 * Uso:
 *   node importar_rutas_wikidata.cjs          → import real (local + neon)
 *   node importar_rutas_wikidata.cjs --dry-run → muestra qué haría sin escribir
 *   node importar_rutas_wikidata.cjs --solo-local / --solo-neon
 */
require('dotenv').config();
const axios = require('axios');
const { Pool, types } = require('pg');
types.setTypeParser(20, parseInt);

const rutas = require('./tmp_top_rutas.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SOLO_LOCAL = args.includes('--solo-local');
const SOLO_NEON = args.includes('--solo-neon');

const local = new Pool({
    host: 'localhost', port: 5433, user: 'patrimonio',
    password: 'patrimonio2026', database: 'patrimonio',
});
const neon = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

const LANG_BY_COUNTRY = {
    'España': ['es', 'en'],
    'Italia': ['it', 'en'],
    'Francia': ['fr', 'en'],
    'Portugal': ['pt', 'en'],
};

function slugify(s) {
    return (s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 80);
}

function zoomFromSpan(spanKm) {
    if (spanKm < 2) return 14;
    if (spanKm < 5) return 13;
    if (spanKm < 15) return 12;
    if (spanKm < 40) return 11;
    if (spanKm < 100) return 10;
    if (spanKm < 250) return 9;
    return 8;
}

function temaFrom(r) {
    const n = ((r.nombre || '') + ' ' + (r.desc || '')).toLowerCase();
    const tipo = (r.tipo || '').toLowerCase();
    if (tipo.includes('pilgrim') || /\b(camino|cammino|caminho|chemin|pilgrim|jakob)/.test(n)) return 'religious';
    if (/\b(sentiero|senderismo|randonn|escursion|trail|trekking)/.test(n)) return 'hiking';
    return 'cultural';
}

async function sparql(query) {
    const r = await axios.get('https://query.wikidata.org/sparql', {
        params: { query, format: 'json' },
        headers: { 'User-Agent': 'PatrimonioEuropeo/1.0', 'Accept': 'application/sparql-results+json' },
        timeout: 60000,
    });
    return r.data.results.bindings;
}

async function fetchLabelDesc(qid, langs) {
    // Pedir labels y descripciones en varios idiomas
    const langList = langs.map(l => `"${l}"`).join(',');
    const query = `
        SELECT ?label ?lang ?desc ?dlang WHERE {
          OPTIONAL { wd:${qid} rdfs:label ?label . BIND(LANG(?label) AS ?lang) }
          OPTIONAL { wd:${qid} schema:description ?desc . BIND(LANG(?desc) AS ?dlang) }
          FILTER(?lang IN (${langList}) || ?dlang IN (${langList}))
        }
    `;
    const rows = await sparql(query);
    const labels = {}, descs = {};
    for (const r of rows) {
        if (r.label && r.lang) labels[r.lang.value] = r.label.value;
        if (r.desc && r.dlang) descs[r.dlang.value] = r.desc.value;
    }
    return { labels, descs };
}

function pickBestLang(map, langs) {
    for (const l of langs) if (map[l]) return map[l];
    return Object.values(map)[0];
}

// Orden de paradas: proyección sobre segmento start-end, si no distancia al centro
function ordenarParadas(paradas, centro, start, end) {
    if (start && end) {
        const kx = 111 * Math.cos(centro.lat * Math.PI / 180), ky = 111;
        const ax = start.lng * kx, ay = start.lat * ky;
        const bx = end.lng * kx, by = end.lat * ky;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        paradas.forEach(p => {
            const px = parseFloat(p.longitud) * kx;
            const py = parseFloat(p.latitud) * ky;
            p._t = ((px - ax) * dx + (py - ay) * dy) / len2;
        });
        paradas.sort((a, b) => a._t - b._t);
    } else {
        paradas.sort((a, b) => a.distKm - b.distKm);
    }
    return paradas;
}

async function slugUnico(pool, slugBase) {
    let slug = slugBase;
    let n = 1;
    while (true) {
        const r = await pool.query('SELECT 1 FROM rutas_culturales WHERE slug = $1', [slug]);
        if (r.rows.length === 0) return slug;
        n++;
        slug = slugBase + '-' + n;
    }
}

async function insertRuta(pool, data) {
    const r = await pool.query(
        `INSERT INTO rutas_culturales
          (slug, nombre, descripcion, region, pais, tema, centro_lat, centro_lng, zoom, imagen_portada, num_paradas, activa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         RETURNING id`,
        [data.slug, data.nombre, data.descripcion, data.region, data.pais, data.tema,
         data.centro_lat, data.centro_lng, data.zoom, data.imagen_portada, data.num_paradas || 0]
    );
    return r.rows[0].id;
}

async function insertParada(pool, ruta_id, orden, bien_id, nombre, lat, lng, descripcion) {
    await pool.query(
        `INSERT INTO rutas_culturales_paradas
          (ruta_id, orden, bien_id, nombre, latitud, longitud, descripcion)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ruta_id, orden, bien_id, nombre, lat, lng, descripcion]
    );
}

async function existeSlug(pool, slug) {
    const r = await pool.query('SELECT id FROM rutas_culturales WHERE slug = $1', [slug]);
    return r.rows[0]?.id || null;
}

async function main() {
    console.log('=== Import rutas Wikidata → rutas_culturales ===');
    console.log('Modo:', DRY_RUN ? 'DRY-RUN' : 'REAL');
    console.log('DBs:', SOLO_LOCAL ? 'LOCAL' : SOLO_NEON ? 'NEON' : 'LOCAL + NEON');
    console.log('Total rutas a procesar:', rutas.length, '\n');

    let ok = 0, skip = 0, fail = 0;

    for (let i = 0; i < rutas.length; i++) {
        const b = rutas[i];
        const r = b.ruta;
        const langs = LANG_BY_COUNTRY[r.pais] || ['en'];

        console.log(`\n[${i+1}/${rutas.length}] ${r.qid} — ${r.nombre}`);

        try {
            // 1. Labels y descripciones multilang
            const { labels, descs } = await fetchLabelDesc(r.qid, [...langs, 'es', 'en']);
            const nombre = pickBestLang(labels, langs) || r.nombre;
            const descripcion = pickBestLang(descs, langs) || r.desc;

            // 2. Metadatos de ruta
            const start = b.ruta.points?.find ? b.ruta.points.find(p => p.type === 'start') : null;
            const end = b.ruta.points?.find ? b.ruta.points.find(p => p.type === 'end') : null;
            const spanKm = b.ruta.spanMaxKm || 20;
            const slugBase = slugify(nombre) || 'ruta-' + r.qid.toLowerCase();

            const rutaData = {
                slug: slugBase,
                nombre,
                descripcion,
                region: null,
                pais: r.pais,
                tema: temaFrom(r),
                centro_lat: b.ruta.centroLat,
                centro_lng: b.ruta.centroLng,
                zoom: zoomFromSpan(spanKm),
                imagen_portada: r.imagen || null,
                num_paradas: b.paradas.length,
            };

            // 3. Verificar slug y saltar si ya existe en local
            if (!DRY_RUN && !SOLO_NEON) {
                const existe = await existeSlug(local, rutaData.slug);
                if (existe) {
                    console.log('  SKIP: ya existe slug "' + rutaData.slug + '" en local');
                    skip++;
                    continue;
                }
                rutaData.slug = await slugUnico(local, rutaData.slug);
            }

            console.log(`  slug=${rutaData.slug}  tema=${rutaData.tema}  zoom=${rutaData.zoom}  centro=${rutaData.centro_lat.toFixed(3)},${rutaData.centro_lng.toFixed(3)}`);
            console.log(`  desc: ${(descripcion||'').substring(0,110)}`);

            // 4. Ordenar paradas
            const centro = { lat: b.ruta.centroLat, lng: b.ruta.centroLng };
            const paradasOrden = ordenarParadas([...b.paradas], centro, start, end);
            console.log('  ' + paradasOrden.length + ' paradas');

            if (DRY_RUN) {
                ok++;
                continue;
            }

            // 5. Insertar en LOCAL
            let rutaLocalId, rutaNeonId;
            if (!SOLO_NEON) {
                rutaLocalId = await insertRuta(local, rutaData);
                for (let j = 0; j < paradasOrden.length; j++) {
                    const p = paradasOrden[j];
                    await insertParada(local, rutaLocalId, j + 1, p.id,
                        p.denominacion, parseFloat(p.latitud), parseFloat(p.longitud), null);
                }
                console.log('  ✓ local: ruta ' + rutaLocalId + ' + ' + paradasOrden.length + ' paradas');
            }

            // 6. Insertar en NEON (mismos IDs de bien porque están sincronizados)
            if (!SOLO_LOCAL) {
                // En neon buscar slug único también
                const existeN = await existeSlug(neon, rutaData.slug);
                if (existeN) {
                    console.log('  WARN neon: slug "' + rutaData.slug + '" ya existe (id=' + existeN + '), saltado en neon');
                } else {
                    rutaNeonId = await insertRuta(neon, rutaData);
                    for (let j = 0; j < paradasOrden.length; j++) {
                        const p = paradasOrden[j];
                        await insertParada(neon, rutaNeonId, j + 1, p.id,
                            p.denominacion, parseFloat(p.latitud), parseFloat(p.longitud), null);
                    }
                    console.log('  ✓ neon: ruta ' + rutaNeonId + ' + ' + paradasOrden.length + ' paradas');
                }
            }

            ok++;
        } catch (e) {
            console.log('  ✗ ERROR: ' + e.message);
            fail++;
        }
    }

    console.log(`\n=== Resumen ===  OK: ${ok}  SKIP: ${skip}  FAIL: ${fail}  (total ${rutas.length})`);
    await local.end();
    await neon.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
