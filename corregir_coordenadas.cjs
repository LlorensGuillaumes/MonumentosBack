/**
 * Corrige coordenadas mal formateadas:
 * - Aragón: UTM -> WGS84
 * - Outliers: valores fuera de España
 */

const db = require('./db.cjs');

// Conversión aproximada UTM Zona 30N -> WGS84
// Fórmulas simplificadas para España
function utmToWgs84(easting, northing) {
    // UTM Zone 30N parameters
    const k0 = 0.9996;
    const a = 6378137; // WGS84 equatorial radius
    const e = 0.081819191; // WGS84 eccentricity
    const e2 = e * e;
    const ep2 = e2 / (1 - e2);

    const x = easting - 500000; // Remove false easting
    const y = northing;

    const M = y / k0;
    const mu = M / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));

    const e1 = (1 - Math.sqrt(1-e2)) / (1 + Math.sqrt(1-e2));

    const phi1 = mu + (3*e1/2 - 27*e1*e1*e1/32) * Math.sin(2*mu)
                    + (21*e1*e1/16 - 55*e1*e1*e1*e1/32) * Math.sin(4*mu)
                    + (151*e1*e1*e1/96) * Math.sin(6*mu);

    const C1 = ep2 * Math.cos(phi1) * Math.cos(phi1);
    const T1 = Math.tan(phi1) * Math.tan(phi1);
    const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) * Math.sin(phi1));
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1) * Math.sin(phi1), 1.5);
    const D = x / (N1 * k0);

    const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D*D/2
                - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*ep2) * D*D*D*D/24
                + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*ep2 - 3*C1*C1) * D*D*D*D*D*D/720);

    const lon = (-3 * Math.PI / 180) + (D - (1 + 2*T1 + C1) * D*D*D/6
                + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*ep2 + 24*T1*T1) * D*D*D*D*D/120) / Math.cos(phi1);

    return {
        lat: lat * 180 / Math.PI,
        lon: lon * 180 / Math.PI
    };
}

async function ejecutar() {
    console.log('=== CORREGIR COORDENADAS ===\n');

    // 1. Corregir Aragón (UTM -> WGS84)
    console.log('1. Corrigiendo coordenadas de Aragón (UTM -> WGS84)...');

    const aragon = (await db.query(`
        SELECT id, latitud, longitud, denominacion
        FROM bienes
        WHERE comunidad_autonoma = 'Aragon'
          AND latitud > 1000
    `)).rows;

    console.log(`   Items a convertir: ${aragon.length}`);

    let convertidos = 0;

    for (const item of aragon) {
        // En UTM: longitud original = easting (X), latitud original = northing (Y)
        const easting = item.longitud;
        const northing = item.latitud;

        const wgs84 = utmToWgs84(easting, northing);

        // Validar que está en Aragón (lat 40-43, lon -2 a 1)
        if (wgs84.lat >= 40 && wgs84.lat <= 43 && wgs84.lon >= -2 && wgs84.lon <= 1) {
            await db.query('UPDATE bienes SET latitud = ?, longitud = ? WHERE id = ?', [wgs84.lat, wgs84.lon, item.id]);
            convertidos++;
        }
    }

    console.log(`   Convertidos: ${convertidos}`);

    // 2. Corregir outliers de CLM y otros
    console.log('\n2. Corrigiendo outliers (coords fuera de España)...');

    const outliers = (await db.query(`
        SELECT id, denominacion, comunidad_autonoma, latitud, longitud
        FROM bienes
        WHERE latitud IS NOT NULL
          AND (latitud < 27 OR latitud > 44 OR longitud < -19 OR longitud > 5)
    `)).rows;

    console.log(`   Outliers encontrados: ${outliers.length}`);

    // Poner a NULL los outliers (se pueden geocodificar después)
    for (const item of outliers) {
        await db.query('UPDATE bienes SET latitud = NULL, longitud = NULL WHERE id = ?', [item.id]);
    }

    console.log(`   Outliers limpiados: ${outliers.length}`);

    // 3. Verificar resultados
    console.log('\n3. Verificación de rangos:');
    const rangos = (await db.query(`
        SELECT comunidad_autonoma,
               COUNT(*) as total,
               ROUND(MIN(latitud)::numeric, 2) as lat_min,
               ROUND(MAX(latitud)::numeric, 2) as lat_max,
               ROUND(MIN(longitud)::numeric, 2) as lon_min,
               ROUND(MAX(longitud)::numeric, 2) as lon_max
        FROM bienes
        WHERE latitud IS NOT NULL
        GROUP BY comunidad_autonoma
        ORDER BY total DESC
    `)).rows;

    rangos.forEach(r => {
        console.log(`   ${r.comunidad_autonoma}: ${r.total} items (lat ${r.lat_min}-${r.lat_max}, lon ${r.lon_min}-${r.lon_max})`);
    });

    // Stats finales
    const conCoords = (await db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL')).rows[0].n;
    const total = (await db.query('SELECT COUNT(*) as n FROM bienes')).rows[0].n;
    console.log(`\nTotal con coordenadas: ${conCoords}/${total} (${(100*conCoords/total).toFixed(1)}%)`);

    await db.cerrar();
}

ejecutar().catch(console.error);
