/**
 * Sube fotos de una ruta cultural a Supabase Storage e inserta filas en
 * rutas_culturales_fotos en LOCAL y NEON.
 *
 * Comprime con sharp (max 1920px lado largo, JPEG quality 82, strip EXIF).
 * Naming en bucket: {slug}/{paradaOrden:02}_{fotoIdx:02}.jpg
 *
 * Uso:
 *   node cargar_fotos_ruta.cjs --slug retablos-este-leon --dir <carpeta-base>
 *   node cargar_fotos_ruta.cjs --slug retablos-este-leon --dir ... --dry-run
 *   node cargar_fotos_ruta.cjs --slug retablos-este-leon --dir ... --solo-local
 *   node cargar_fotos_ruta.cjs --slug retablos-este-leon --dir ... --solo-neon
 *
 * Las carpetas hijas pueden:
 *   a) Empezar con prefijo numérico (01_xxx, 02_xxx, ...)  → orden = ese número
 *   b) O coincidir con la localidad de la parada              → orden = se busca por localidad
 *
 * El mapeo localidad → orden se hace fuzzy (sin acentos, lowercase, sin tildes).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Pool, types } = require('pg');

types.setTypeParser(20, parseInt);

// ---------- args ----------
const args = process.argv.slice(2);
function getArg(name, def = null) {
    const i = args.indexOf('--' + name);
    if (i === -1) return def;
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) return true;
    return args[i + 1];
}
const SLUG = getArg('slug');
const DIR = getArg('dir');
const DRY_RUN = getArg('dry-run', false) === true;
const SOLO_LOCAL = getArg('solo-local', false) === true;
const SOLO_NEON = getArg('solo-neon', false) === true;
const REPLACE = getArg('replace', false) === true;

if (!SLUG || !DIR) {
    console.error('Uso: node cargar_fotos_ruta.cjs --slug <slug-ruta> --dir <carpeta-fotos> [--dry-run] [--solo-local] [--solo-neon] [--replace]');
    process.exit(1);
}
if (!fs.existsSync(DIR)) {
    console.error('No existe la carpeta: ' + DIR);
    process.exit(1);
}

// ---------- Compresión config ----------
const MAX_DIM = 1920;
const JPEG_QUALITY = 82;

// ---------- S3 client ----------
const s3 = new S3Client({
    endpoint: process.env.SUPABASE_S3_ENDPOINT,
    region: process.env.SUPABASE_S3_REGION,
    credentials: {
        accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
});
const BUCKET = process.env.SUPABASE_BUCKET;

function publicUrl(key) {
    return `${process.env.SUPABASE_PROJECT_URL}/storage/v1/object/public/${BUCKET}/${key}`;
}

// ---------- Normalización para fuzzy match ----------
function norm(s) {
    return (s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

// ---------- DB pools ----------
const local = new Pool({
    host: 'localhost',
    port: 5433,
    user: 'patrimonio',
    password: 'patrimonio2026',
    database: 'patrimonio',
});
const neon = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

async function getParadas(pool, slug) {
    const r = await pool.query(
        `SELECT p.id, p.orden, p.nombre, p.localidad
         FROM rutas_culturales_paradas p
         JOIN rutas_culturales r ON r.id = p.ruta_id
         WHERE r.slug = $1
         ORDER BY p.orden`,
        [slug]
    );
    return r.rows;
}

async function deleteFotosByParadaOrden(pool, slug, orden) {
    await pool.query(
        `DELETE FROM rutas_culturales_fotos
         WHERE parada_id IN (
             SELECT p.id FROM rutas_culturales_paradas p
             JOIN rutas_culturales r ON r.id = p.ruta_id
             WHERE r.slug = $1 AND p.orden = $2
         )`,
        [slug, orden]
    );
}

async function insertFoto(pool, parada_id, url, titulo, orden) {
    await pool.query(
        `INSERT INTO rutas_culturales_fotos (parada_id, url, titulo, orden, fuente)
         VALUES ($1, $2, $3, $4, 'supabase')`,
        [parada_id, url, titulo, orden]
    );
}

(async () => {
    console.log('=== Carga masiva de fotos ===');
    console.log('Ruta: ' + SLUG);
    console.log('Carpeta base: ' + DIR);
    console.log('Modo: ' + (DRY_RUN ? 'DRY-RUN (solo simula)' : 'REAL'));
    console.log('Replace: ' + (REPLACE ? 'sí (borra fotos previas de la parada antes)' : 'no (acumula)'));
    if (SOLO_LOCAL) console.log('DBs: SOLO LOCAL');
    else if (SOLO_NEON) console.log('DBs: SOLO NEON');
    else console.log('DBs: LOCAL + NEON');
    console.log('Compresión: max ' + MAX_DIM + 'px / JPEG q' + JPEG_QUALITY);
    console.log();

    const paradasLocal = await getParadas(local, SLUG);
    if (paradasLocal.length === 0) {
        console.error('Ruta no encontrada en local: ' + SLUG);
        process.exit(1);
    }
    const paradasNeon = await getParadas(neon, SLUG);

    // Construir índices: por orden, por norm(localidad), por norm(nombre)
    function buildIndexes(paradas) {
        const byOrden = new Map();
        const byLocalidad = new Map();
        for (const p of paradas) {
            byOrden.set(p.orden, p);
            if (p.localidad) {
                byLocalidad.set(norm(p.localidad), p);
            }
        }
        return { byOrden, byLocalidad };
    }
    const idxLocal = buildIndexes(paradasLocal);
    const idxNeon = buildIndexes(paradasNeon);

    function resolveParada(folderName) {
        // Caso 1: prefijo numérico "NN_xxx" o "NN-xxx"
        const m = folderName.match(/^(\d+)/);
        if (m) {
            const ord = parseInt(m[1], 10);
            if (idxLocal.byOrden.has(ord) || idxNeon.byOrden.has(ord)) {
                return { orden: ord, source: 'prefijo numérico' };
            }
        }
        // Caso 2: coincidencia con localidad
        const n = norm(folderName);
        for (const [loc, p] of idxLocal.byLocalidad) {
            if (n === loc || n.includes(loc) || loc.includes(n)) {
                return { orden: p.orden, source: 'localidad "' + p.localidad + '"' };
            }
        }
        return null;
    }

    const subdirs = fs.readdirSync(DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();

    console.log('Carpetas detectadas (' + subdirs.length + '):');
    const plan = [];
    for (const sub of subdirs) {
        const r = resolveParada(sub);
        if (!r) {
            console.log('  ❌ ' + sub + '  (no se pudo mapear a ninguna parada)');
            continue;
        }
        const subPath = path.join(DIR, sub);
        const files = fs.readdirSync(subPath)
            .filter(f => /\.(jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(f))
            .sort();
        const parada = idxLocal.byOrden.get(r.orden) || idxNeon.byOrden.get(r.orden);
        console.log('  ✓ ' + sub + '  →  parada #' + r.orden + ' (' + parada.localidad + ')  [' + files.length + ' fotos] (' + r.source + ')');
        plan.push({ sub, subPath, files, orden: r.orden, parada });
    }

    if (plan.length === 0) {
        console.log('\nNada que procesar.');
        await local.end();
        await neon.end();
        return;
    }

    console.log();

    let totalSubidas = 0;
    let bytesOriginales = 0;
    let bytesComprimidos = 0;
    let totalFilas = 0;

    for (const item of plan) {
        const { sub, subPath, files, orden, parada } = item;
        console.log(`\n[Parada ${orden}] ${parada.nombre.substring(0, 60)}...`);

        if (REPLACE && !DRY_RUN) {
            if (!SOLO_NEON) await deleteFotosByParadaOrden(local, SLUG, orden);
            if (!SOLO_LOCAL) await deleteFotosByParadaOrden(neon, SLUG, orden);
            console.log('  (fotos previas borradas)');
        }

        let i = 0;
        for (const file of files) {
            i++;
            const filePath = path.join(subPath, file);
            const stat = fs.statSync(filePath);
            bytesOriginales += stat.size;

            const key = `${SLUG}/${String(orden).padStart(2, '0')}_${String(i).padStart(2, '0')}.jpg`;
            const url = publicUrl(key);

            console.log(`  ${i}. ${file.substring(0, 50)}  (${(stat.size/1024/1024).toFixed(2)} MB)`);

            if (!DRY_RUN) {
                // Compresión con sharp
                let buffer;
                try {
                    buffer = await sharp(filePath)
                        .rotate() // auto-orient via EXIF antes de strip
                        .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
                        .toBuffer();
                } catch (e) {
                    console.log('     ⚠️  Error procesando imagen: ' + e.message);
                    continue;
                }
                bytesComprimidos += buffer.length;
                console.log(`     → ${(buffer.length/1024).toFixed(0)} KB tras compresión (${((1 - buffer.length/stat.size)*100).toFixed(0)}% reducción)`);

                // Subida a Supabase
                await s3.send(new PutObjectCommand({
                    Bucket: BUCKET,
                    Key: key,
                    Body: buffer,
                    ContentType: 'image/jpeg',
                    CacheControl: 'public, max-age=31536000, immutable',
                }));
                totalSubidas++;

                // Inserts en DB
                const titulo = parada.nombre;
                const paradaLocalId = idxLocal.byOrden.get(orden)?.id;
                const paradaNeonId = idxNeon.byOrden.get(orden)?.id;
                if (!SOLO_NEON && paradaLocalId) {
                    await insertFoto(local, paradaLocalId, url, titulo, i);
                    totalFilas++;
                }
                if (!SOLO_LOCAL && paradaNeonId) {
                    await insertFoto(neon, paradaNeonId, url, titulo, i);
                    totalFilas++;
                }
            }
        }
    }

    console.log('\n=== Resumen ===');
    console.log('Archivos subidos a Supabase: ' + totalSubidas);
    console.log('Filas insertadas en rutas_culturales_fotos: ' + totalFilas + ' (local + neon)');
    console.log('Tamaño original total:   ' + (bytesOriginales/1024/1024).toFixed(2) + ' MB');
    console.log('Tamaño comprimido total: ' + (bytesComprimidos/1024/1024).toFixed(2) + ' MB');
    if (bytesOriginales > 0) {
        console.log('Reducción global:        ' + ((1 - bytesComprimidos/bytesOriginales)*100).toFixed(0) + '%');
    }
    if (DRY_RUN) console.log('\n(DRY-RUN: no se ha subido ni insertado nada — vuelve a ejecutar sin --dry-run)');

    await local.end();
    await neon.end();
})().catch(e => {
    console.error('\nERROR:', e.message);
    if (e.Code) console.error('   Code:', e.Code);
    if (e.stack) console.error(e.stack);
    process.exit(1);
});
