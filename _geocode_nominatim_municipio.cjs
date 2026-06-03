// Geocode con Nominatim para asignar municipio a bienes sin él.
// Rate limit: 1 req/s. User-Agent identificable. Resumible vía checkpoint.

const db = require('./db.cjs');
const fs = require('fs');
const path = require('path');

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'PatrimonioEuropeo/1.0 (j.llorens@uniogestio.com)';
const DELAY_MS = 1100;
const CHECKPOINT = path.join(__dirname, '_geocode_checkpoint.json');
const MAX = parseInt(process.env.MAX || '99999', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadCheckpoint() {
    if (fs.existsSync(CHECKPOINT)) {
        try { return JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')); }
        catch { return { processed: [], ok: 0, no_result: 0, no_match: 0, errors: 0 }; }
    }
    return { processed: [], ok: 0, no_result: 0, no_match: 0, errors: 0 };
}
function saveCheckpoint(ck) {
    fs.writeFileSync(CHECKPOINT, JSON.stringify(ck));
}

async function nominatim(q) {
    const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=1&countrycodes=es`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const arr = await r.json();
    return arr[0] || null;
}

function extractMunicipio(hit) {
    if (!hit || !hit.address) return null;
    const a = hit.address;
    return a.municipality || a.city || a.town || a.village || a.hamlet || null;
}

async function main() {
    const ck = loadCheckpoint();
    const processedSet = new Set(ck.processed);
    console.log(`Checkpoint: ${ck.processed.length} ya procesados, ok=${ck.ok}`);

    // Cargar municipios IGN para validar (set de "provincia|municipio_norm")
    // (Para validar usamos: existe ese municipio en la BD para esa CCAA/prov.)
    const muniSet = new Set();
    const muniRows = (await db.query(
        `SELECT LOWER(unaccent(municipio)) as m FROM municipios_espana`
    )).rows;
    muniRows.forEach(r => muniSet.add(r.m));
    console.log(`Municipios IGN cargados: ${muniSet.size}`);

    const cand = (await db.query(`
        SELECT id, denominacion, comunidad_autonoma, provincia
        FROM bienes
        WHERE pais='España'
          AND (municipio IS NULL OR municipio='')
        ORDER BY comunidad_autonoma, provincia, id
    `)).rows;
    console.log(`Candidatos: ${cand.length}`);

    let done = 0;
    const t0 = Date.now();

    for (const b of cand) {
        if (processedSet.has(b.id)) continue;
        if (done >= MAX) { console.log(`MAX=${MAX} alcanzado, paro.`); break; }

        const q = [b.denominacion, b.provincia, 'España'].filter(Boolean).join(', ');
        try {
            const hit = await nominatim(q);
            const muni = extractMunicipio(hit);
            if (!muni) {
                ck.no_result++;
            } else {
                const muniNorm = muni.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
                if (muniSet.has(muniNorm)) {
                    await db.query(
                        `UPDATE bienes SET municipio=$1, updated_at=NOW() WHERE id=$2`,
                        [muni, b.id]
                    );
                    ck.ok++;
                } else {
                    ck.no_match++;
                }
            }
        } catch (e) {
            ck.errors++;
            if (ck.errors <= 5) console.log(`  ERROR id=${b.id}: ${e.message}`);
            // Si es 429 / 503 esperar más
            if (/429|503/.test(e.message)) await sleep(60000);
        }

        ck.processed.push(b.id);
        processedSet.add(b.id);
        done++;

        if (done % 50 === 0) {
            saveCheckpoint(ck);
            const eta = ((cand.length - ck.processed.length) * DELAY_MS / 1000 / 60).toFixed(0);
            console.log(`  ${ck.processed.length}/${cand.length} | ok=${ck.ok} no_result=${ck.no_result} no_match=${ck.no_match} err=${ck.errors} | ETA ${eta}min`);
        }

        await sleep(DELAY_MS);
    }

    saveCheckpoint(ck);
    console.log(`\n=== Final ===`);
    console.log(`  Procesados esta tanda: ${done}`);
    console.log(`  ok=${ck.ok} no_result=${ck.no_result} no_match=${ck.no_match} errors=${ck.errors}`);
    console.log(`  Tiempo: ${((Date.now()-t0)/60000).toFixed(1)}min`);

    const s = (await db.query(
        "SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE municipio IS NOT NULL AND municipio<>'')::int as cm FROM bienes WHERE pais='España'"
    )).rows[0];
    console.log(`\nEspaña con municipio: ${s.cm}/${s.total} (${(100*s.cm/s.total).toFixed(1)}%)`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
