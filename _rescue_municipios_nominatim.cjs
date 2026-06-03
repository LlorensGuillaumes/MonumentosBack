/**
 * Rescata el campo `municipio` para bienes que tienen coordenadas pero
 * municipio NULL, usando Nominatim (OpenStreetMap) reverse geocoding.
 *
 * Política Nominatim:
 *  - 1 req/seg máximo
 *  - User-Agent obligatorio con contacto
 *  - Bulk usage: descargar dump propio (pero 28k es manejable así)
 *
 * Uso:
 *   node _rescue_municipios_nominatim.cjs --apply
 *   node _rescue_municipios_nominatim.cjs --apply --limit=100
 *   node _rescue_municipios_nominatim.cjs --apply --ccaa=Andalucía
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=0').split('=')[1], 10);
const CCAA = (args.find(a => a.startsWith('--ccaa=')) || '').split('=')[1] || null;

const SLEEP_MS = 1100;
const FETCH_TIMEOUT_MS = 15000;
const RETRIES = 4;

const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reverseGeocode(lat, lon) {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('lat', lat);
    u.searchParams.set('lon', lon);
    u.searchParams.set('zoom', '12');
    u.searchParams.set('addressdetails', '1');

    for (let i = 0; i < RETRIES; i++) {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(u.toString(), {
                headers: {
                    'User-Agent': 'PatrimonioEuropeo/1.0 (contact@patrimonio-europeo.netlify.app)',
                    'Accept': 'application/json',
                    'Accept-Language': 'es,ca,gl,eu',
                },
                signal: ctrl.signal,
            });
            clearTimeout(tid);
            if (res.status === 429 || res.status === 503) {
                await sleep(Math.pow(2, i + 1) * 2000);
                continue;
            }
            if (!res.ok) return { error: `HTTP ${res.status}` };
            return { data: await res.json() };
        } catch (e) {
            clearTimeout(tid);
            if (i === RETRIES - 1) return { error: `${e.code || 'EXC'}: ${e.message}` };
            await sleep(Math.pow(2, i + 1) * 1000);
        }
    }
    return { error: 'max retries' };
}

function extraerMunicipio(data) {
    const a = data?.address || {};
    return (
        a.municipality ||
        a.city ||
        a.town ||
        a.village ||
        a.hamlet ||
        a.suburb ||
        null
    );
}

async function main() {
    console.log(`Modo: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
    if (CCAA) console.log(`CCAA: ${CCAA}`);
    if (LIMIT) console.log(`Limit: ${LIMIT}`);

    const ccaaCond = CCAA ? `AND comunidad_autonoma = '${CCAA.replace(/'/g, "''")}'` : '';

    const r = await pool.query(`
        SELECT id, latitud, longitud, denominacion, comunidad_autonoma
        FROM bienes
        WHERE (municipio IS NULL OR municipio = '')
          AND latitud IS NOT NULL AND longitud IS NOT NULL
          ${ccaaCond}
        ORDER BY id
        ${LIMIT ? `LIMIT ${LIMIT}` : ''}
    `);
    console.log(`Candidatos: ${r.rows.length}\n`);
    if (r.rows.length === 0) { await pool.end(); return; }

    let processed = 0, conMun = 0, errors = 0;
    const muniCount = new Map();

    for (const row of r.rows) {
        const { data, error } = await reverseGeocode(row.latitud, row.longitud);
        processed++;

        if (error) {
            errors++;
            if (errors <= 5) console.log(`  ⚠ #${row.id} ERROR: ${error}`);
            await sleep(SLEEP_MS);
            continue;
        }

        const mun = extraerMunicipio(data);
        if (mun) {
            conMun++;
            muniCount.set(mun, (muniCount.get(mun) || 0) + 1);
            if (!DRY_RUN) {
                await pool.query(`UPDATE bienes SET municipio = $1 WHERE id = $2`, [mun, row.id]);
            }
        }

        if (processed % 100 === 0) {
            const pct = (100 * processed / r.rows.length).toFixed(1);
            console.log(`  [${processed}/${r.rows.length}] (${pct}%) con_mun=${conMun} err=${errors}`);
        }

        await sleep(SLEEP_MS);
    }

    console.log('\n=== Resumen ===');
    console.log(`  Procesados:    ${processed}`);
    console.log(`  Con municipio: ${conMun}`);
    console.log(`  Errores:       ${errors}`);
    console.log('\nTop 15 municipios recuperados:');
    [...muniCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([m, n]) =>
        console.log(`  ${String(n).padStart(4)}  ${m}`)
    );

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
