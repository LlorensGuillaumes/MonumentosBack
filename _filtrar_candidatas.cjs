/**
 * Filtra las rutas candidatas eliminando basura (áreas metropolitanas, rutas cortas
 * con radios absurdos) y aplicando radio dinámico según longitud conocida.
 */
require('dotenv').config();
const fs = require('fs');
const { Pool, types } = require('pg');
types.setTypeParser(20, parseInt);

const raw = require('./tmp_rutas_geo.json');

// QIDs de tipos que son basura (no son rutas)
const TIPOS_BASURA = new Set([
    'Q1907114',   // metropolitan area
    'Q1062379',   // arrondissement
    'Q1489259',   // urban area
]);

const local = new Pool({
    host: 'localhost',
    port: 5433,
    user: 'patrimonio',
    password: 'patrimonio2026',
    database: 'patrimonio',
});

function distKm(a, b) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
function distPuntoASegmentoKm(p, a, b) {
    const latRad = (a.lat + b.lat) / 2 * Math.PI / 180;
    const kx = 111 * Math.cos(latRad), ky = 111;
    const ax = a.lng * kx, ay = a.lat * ky;
    const bx = b.lng * kx, by = b.lat * ky;
    const px = p.lng * kx, py = p.lat * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.sqrt((px-ax)**2 + (py-ay)**2);
    let t = ((px-ax)*dx + (py-ay)*dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t*dx, cy = ay + t*dy;
    return Math.sqrt((px-cx)**2 + (py-cy)**2);
}

async function matchRuta(ruta) {
    const start = ruta.points.find(p => p.type === 'start');
    const end = ruta.points.find(p => p.type === 'end');
    const centro = { lat: ruta.centroLat, lng: ruta.centroLng };

    // Radio dinámico según longitud
    // Si conocemos longitud_km: buffer = min(5, max(2, longitud/20))
    // Si no: radio 10 km (más conservador que antes)
    let buffer;
    if (ruta.longitud_km && ruta.longitud_km > 1) {
        buffer = Math.min(5, Math.max(2, ruta.longitud_km / 20));
    } else {
        buffer = 10; // sin longitud → radio moderado
    }

    let bboxQuery, modo;
    if (start && end && distKm(start, end) > 5) {
        modo = 'corredor ' + buffer.toFixed(1) + 'km';
        const bLat = buffer / 111;
        const bLng = buffer / (111 * Math.cos(ruta.centroLat * Math.PI / 180));
        bboxQuery = {
            minLat: Math.min(start.lat, end.lat) - bLat,
            maxLat: Math.max(start.lat, end.lat) + bLat,
            minLng: Math.min(start.lng, end.lng) - bLng,
            maxLng: Math.max(start.lng, end.lng) + bLng,
        };
    } else {
        modo = 'radio ' + buffer.toFixed(1) + 'km';
        const bLat = buffer / 111;
        const bLng = buffer / (111 * Math.cos(centro.lat * Math.PI / 180));
        bboxQuery = {
            minLat: centro.lat - bLat,
            maxLat: centro.lat + bLat,
            minLng: centro.lng - bLng,
            maxLng: centro.lng + bLng,
        };
    }

    const r = await local.query(
        `SELECT id, denominacion, latitud, longitud, tipo_monumento, comunidad_autonoma, categoria
         FROM bienes
         WHERE pais = $1 AND latitud BETWEEN $2 AND $3 AND longitud BETWEEN $4 AND $5
         LIMIT 1000`,
        [ruta.pais, bboxQuery.minLat, bboxQuery.maxLat, bboxQuery.minLng, bboxQuery.maxLng]
    );
    const candidatos = r.rows;

    const paradas = [];
    for (const c of candidatos) {
        const p = { lat: parseFloat(c.latitud), lng: parseFloat(c.longitud) };
        if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
        let d;
        if (start && end && distKm(start, end) > 5) {
            d = distPuntoASegmentoKm(p, start, end);
        } else {
            d = distKm(centro, p);
        }
        if (d > buffer) continue;
        paradas.push({ ...c, distKm: d });
    }
    paradas.sort((a, b) => a.distKm - b.distKm);

    return { ruta, modo, buffer, paradas, totalParadas: paradas.length };
}

// ---------- Filtro por nombre y descripción ----------
function esBasura(r) {
    const n = (r.nombre || '').toLowerCase();
    const d = (r.desc || '').toLowerCase();
    if (/\b(metropolitan|metropolita|área metropolitana|area metropolitana|urban area|área urbana|aire urbaine|área de influencia)\b/.test(n)) return true;
    if (/\b(metropolitan area|área metropolitana|area metropolitana|aire urbaine)\b/.test(d)) return true;
    return false;
}

function nombreGenerico(r) {
    const n = (r.nombre || '').toLowerCase();
    // "Camí de X", "Chemin des X" sin longitud ni imagen suele ser senderito rural local
    if (/^(cam[íi]|chemin)\s+d[eliaus]/i.test(n) && !r.imagen && !r.longitud_km) return true;
    return false;
}

(async () => {
    console.log('Rutas antes de filtros:', raw.length);

    const limpio = raw.filter(r => !esBasura(r) && !nombreGenerico(r));
    console.log('Tras quitar basura y nombres genéricos:', limpio.length);

    const resultados = [];
    for (let i = 0; i < limpio.length; i++) {
        try {
            resultados.push(await matchRuta(limpio[i]));
        } catch (e) {
            // skip
        }
        if (i % 30 === 0) process.stdout.write(`  ${i}/${limpio.length}\r`);
    }
    console.log(`  ${limpio.length}/${limpio.length}`);

    const buenas = resultados.filter(r => r.totalParadas >= 5 && r.totalParadas <= 200);

    console.log('\n=== Resultado ===');
    console.log('Rutas con 5-200 paradas detectadas:', buenas.length);

    const porPais = {};
    buenas.forEach(b => porPais[b.ruta.pais] = (porPais[b.ruta.pais]||0)+1);
    console.log('Por país:', porPais);

    // Score: paradas + bonus por metadatos
    buenas.sort((a, b) => {
        const sa = Math.log(a.totalParadas+1)*10 + (a.ruta.imagen?15:0) + (a.ruta.longitud_km?10:0) + (a.ruta.desc?5:0) + (a.ruta.web?10:0);
        const sb = Math.log(b.totalParadas+1)*10 + (b.ruta.imagen?15:0) + (b.ruta.longitud_km?10:0) + (b.ruta.desc?5:0) + (b.ruta.web?10:0);
        return sb - sa;
    });

    console.log('\n=== TOP 60 rutas candidatas ===');
    buenas.slice(0, 60).forEach((b, idx) => {
        const km = b.ruta.longitud_km ? b.ruta.longitud_km.toFixed(0)+'km' : '   -  ';
        const img = b.ruta.imagen ? '🖼' : ' ';
        const w = b.ruta.web ? '🌐' : ' ';
        const tipo = b.ruta.tipo ? b.ruta.tipo.substring(0, 16).padEnd(16) : ' '.repeat(16);
        console.log(
            String(idx+1).padStart(3) + '. ' +
            '[' + b.ruta.pais.substring(0,8).padEnd(8) + '] ' +
            b.ruta.qid.padEnd(11) + ' ' +
            (b.ruta.nombre||'?').substring(0,45).padEnd(45) + ' ' +
            String(b.totalParadas).padStart(3) + 'p  ' +
            km.padStart(6) + ' ' + img + w + '  ' + tipo
        );
    });

    fs.writeFileSync('./tmp_candidatas_v2.json', JSON.stringify(buenas, null, 2));
    console.log('\n→ ' + buenas.length + ' candidatas en tmp_candidatas_v2.json');

    await local.end();
})().catch(e => { console.error(e.message); process.exit(1); });
