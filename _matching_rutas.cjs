/**
 * Matchea cada ruta con tus `bienes` por proximidad (bbox + radio).
 * Filtra rutas con ≥5 paradas detectadas.
 */
require('dotenv').config();
const fs = require('fs');
const { Pool, types } = require('pg');
types.setTypeParser(20, parseInt);

const rutas = require('./tmp_rutas_geo.json');

// Parámetros
const MIN_PARADAS = 5;
const RADIO_SIN_TRAZADO_KM = 20;   // si solo hay 1 punto (centro)
const BUFFER_TRAZADO_KM = 3;       // buffer corredor start-end
const MAX_PARADAS_POR_RUTA = 40;   // cap para rutas enormes

const local = new Pool({
    host: 'localhost',
    port: 5433,
    user: 'patrimonio',
    password: 'patrimonio2026',
    database: 'patrimonio',
});

// Haversine
function distKm(a, b) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// Distancia de un punto a un segmento (proyección aproximada)
function distPuntoASegmentoKm(p, a, b) {
    // Convertir a coords locales planas (km aprox)
    const latRad = (a.lat + b.lat) / 2 * Math.PI / 180;
    const kx = 111 * Math.cos(latRad);
    const ky = 111;
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
    const centro = ruta.points.find(p => p.type === 'centro') || { lat: ruta.centroLat, lng: ruta.centroLng };

    // Estrategia:
    // - Si tenemos start + end: matching por corredor (buffer 3 km alrededor del segmento)
    // - Else: matching por radio alrededor del centro
    let modo, bboxQuery;
    if (start && end) {
        modo = 'corredor start-end';
        // Bbox del segmento expandido con margen
        const bLat = BUFFER_TRAZADO_KM / 111;
        const bLng = BUFFER_TRAZADO_KM / (111 * Math.cos(ruta.centroLat * Math.PI / 180));
        bboxQuery = {
            minLat: Math.min(start.lat, end.lat) - bLat,
            maxLat: Math.max(start.lat, end.lat) + bLat,
            minLng: Math.min(start.lng, end.lng) - bLng,
            maxLng: Math.max(start.lng, end.lng) + bLng,
        };
    } else {
        modo = 'radio ' + RADIO_SIN_TRAZADO_KM + ' km';
        const r = RADIO_SIN_TRAZADO_KM;
        const bLat = r / 111;
        const bLng = r / (111 * Math.cos(centro.lat * Math.PI / 180));
        bboxQuery = {
            minLat: centro.lat - bLat,
            maxLat: centro.lat + bLat,
            minLng: centro.lng - bLng,
            maxLng: centro.lng + bLng,
        };
    }

    // Query bienes en bbox
    const paisQid2nombre = { Q29: 'España', Q38: 'Italia', Q142: 'Francia', Q45: 'Portugal' };
    // Nota: necesitamos filtrar por país para no incluir bienes de otros países en zonas fronterizas
    // La info del país de la ruta la tenemos en ruta.pais que ya viene normalizada
    const paisNombre = ruta.pais;

    let candidatos;
    try {
        const r = await local.query(
            `SELECT id, denominacion, latitud, longitud, tipo_monumento, comunidad_autonoma
             FROM bienes
             WHERE pais = $1 AND latitud BETWEEN $2 AND $3 AND longitud BETWEEN $4 AND $5
             LIMIT 2000`,
            [paisNombre, bboxQuery.minLat, bboxQuery.maxLat, bboxQuery.minLng, bboxQuery.maxLng]
        );
        candidatos = r.rows;
    } catch (e) {
        return { ruta, modo, paradas: [], error: e.message };
    }

    // Filtro fino: distancia al segmento (corredor) o al centro (radio)
    const paradas = [];
    for (const c of candidatos) {
        const p = { lat: parseFloat(c.latitud), lng: parseFloat(c.longitud) };
        if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
        let d;
        if (start && end) {
            d = distPuntoASegmentoKm(p, start, end);
            if (d > BUFFER_TRAZADO_KM) continue;
        } else {
            d = distKm(centro, p);
            if (d > RADIO_SIN_TRAZADO_KM) continue;
        }
        paradas.push({ ...c, distKm: d });
    }
    paradas.sort((a, b) => a.distKm - b.distKm);

    return {
        ruta,
        modo,
        centroLat: centro.lat,
        centroLng: centro.lng,
        startLat: start?.lat, startLng: start?.lng,
        endLat: end?.lat, endLng: end?.lng,
        paradas: paradas.slice(0, MAX_PARADAS_POR_RUTA),
        totalCandidatos: candidatos.length,
        totalParadas: paradas.length,
    };
}

(async () => {
    const resultados = [];
    for (let i = 0; i < rutas.length; i++) {
        const r = rutas[i];
        const out = await matchRuta(r);
        resultados.push(out);
        if (i % 50 === 0) process.stdout.write(`  ${i}/${rutas.length}\r`);
    }
    console.log(`  ${rutas.length}/${rutas.length}`);

    // Filtrar con ≥ MIN_PARADAS
    const buenas = resultados.filter(r => r.totalParadas >= MIN_PARADAS);
    console.log('\n=== Resultado ===');
    console.log('Rutas totales con geo:          ' + rutas.length);
    console.log('Rutas con ≥' + MIN_PARADAS + ' paradas detectadas: ' + buenas.length);

    // Por país
    const porPais = {};
    buenas.forEach(b => { porPais[b.ruta.pais] = (porPais[b.ruta.pais] || 0) + 1; });
    console.log('\nPor país:', porPais);

    // Ordenar por calidad (score = paradas + bonus por imagen/longitud/desc)
    buenas.sort((a, b) => {
        const sa = a.totalParadas + (a.ruta.imagen?10:0) + (a.ruta.longitud_km?5:0) + (a.ruta.desc?5:0);
        const sb = b.totalParadas + (b.ruta.imagen?10:0) + (b.ruta.longitud_km?5:0) + (b.ruta.desc?5:0);
        return sb - sa;
    });

    // Top 50
    console.log('\n=== TOP 50 rutas por calidad ===');
    buenas.slice(0, 50).forEach((b, idx) => {
        const km = b.ruta.longitud_km ? b.ruta.longitud_km.toFixed(0) + 'km' : '';
        const img = b.ruta.imagen ? '🖼' : '  ';
        console.log(`${String(idx+1).padStart(2)}. [${b.ruta.pais.substring(0,8).padEnd(8)}] ${b.ruta.qid.padEnd(11)} ${(b.ruta.nombre||'?').substring(0,50).padEnd(50)} → ${String(b.totalParadas).padStart(3)} paradas ${img} ${km}`);
    });

    fs.writeFileSync('./tmp_rutas_candidatas.json', JSON.stringify(buenas, null, 2));
    console.log('\n→ ' + buenas.length + ' rutas candidatas en tmp_rutas_candidatas.json');

    await local.end();
})().catch(e => { console.error(e.message); process.exit(1); });
