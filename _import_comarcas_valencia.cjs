/**
 * Importa el CSV de comarcas de la Comunitat Valenciana (GVA) y aplica
 * point-in-polygon con coordenadas de bienes para asignar comarca.
 *
 * El CSV viene en EPSG:25830 (UTM zona 30N ETRS89). Transformamos a 4326
 * (WGS84 lat/lng) para poder hacer ST_Contains contra las coords de bienes.
 */
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const CSV_PATH = 'C:/Users/usuario/Downloads/Delimitaciones.csv';
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
    // 1. Crear tabla
    console.log('1. Creando tabla comarcas_valencia...');
    await pool.query(`DROP TABLE IF EXISTS comarcas_valencia`);
    await pool.query(`
        CREATE TABLE comarcas_valencia (
            id INTEGER PRIMARY KEY,
            provincia TEXT,
            comarca TEXT NOT NULL,
            cod_comarc TEXT,
            area_ha DOUBLE PRECISION,
            geom geometry(MultiPolygon, 4326)
        )
    `);

    // 2. Parsear CSV
    console.log('2. Parseando CSV...');
    const csv = fs.readFileSync(CSV_PATH, 'utf-8');
    const lines = csv.split('\n').slice(1).filter(l => l.trim());

    let inserted = 0;
    const strip = s => s ? s.replace(/^"|"$/g, '').trim() : s;
    for (const line of lines) {
        const wktMatch = line.match(/^"([^"]+)",(.*)/);
        if (!wktMatch) continue;
        const wkt = wktMatch[1];
        const rest = wktMatch[2].split(',').map(strip);
        const [id, provincia, comarca, cod_comarc, area_ha] = rest;
        try {
            await pool.query(`
                INSERT INTO comarcas_valencia (id, provincia, comarca, cod_comarc, area_ha, geom)
                VALUES ($1, $2, $3, $4, $5,
                    ST_Multi(ST_Transform(ST_GeomFromText($6, 25830), 4326)))
            `, [parseInt(id), provincia, comarca, cod_comarc, parseFloat(area_ha) || null, wkt]);
            inserted++;
        } catch (e) {
            console.log(`  Error fila ${id}: ${e.message.substring(0, 100)}`);
        }
    }
    console.log(`   ${inserted} comarcas importadas`);

    // 3. Crear índice espacial
    console.log('3. Creando índice GIST...');
    await pool.query(`CREATE INDEX ix_cv_geom ON comarcas_valencia USING GIST (geom)`);

    // 4. UPDATE bienes valencianos sin comarca usando point-in-polygon
    console.log('4. Aplicando point-in-polygon a bienes valencianos...');
    const t0 = Date.now();
    const u = await pool.query(`
        UPDATE bienes b SET comarca = cv.comarca
        FROM comarcas_valencia cv
        WHERE b.comunidad_autonoma = 'Comunitat Valenciana'
          AND b.comarca IS NULL
          AND b.latitud IS NOT NULL AND b.longitud IS NOT NULL
          AND ST_Contains(cv.geom, ST_SetSRID(ST_MakePoint(b.longitud, b.latitud), 4326))
    `);
    console.log(`   UPDATE ${u.rowCount} bienes en ${Date.now() - t0}ms`);

    // 5. Propagar también vía municipio→comarca para bienes valencianos sin coords
    console.log('5. Propagación municipio→comarca para los sin coords...');
    const u2 = await pool.query(`
        WITH muni_comarca AS (
            SELECT municipio, MODE() WITHIN GROUP (ORDER BY comarca) AS comarca
            FROM bienes WHERE comunidad_autonoma='Comunitat Valenciana'
              AND comarca IS NOT NULL AND municipio IS NOT NULL
            GROUP BY municipio
        )
        UPDATE bienes b SET comarca = mc.comarca
        FROM muni_comarca mc
        WHERE b.comunidad_autonoma = 'Comunitat Valenciana'
          AND b.comarca IS NULL AND b.municipio = mc.municipio
    `);
    console.log(`   UPDATE ${u2.rowCount} bienes adicionales por municipio`);

    // 6. Estado final
    const f = await pool.query(`
        SELECT comarca, COUNT(*) AS n FROM bienes
        WHERE comunidad_autonoma = 'Comunitat Valenciana' AND comarca IS NOT NULL
        GROUP BY comarca ORDER BY n DESC LIMIT 15
    `);
    console.log('\n=== Top comarcas valencianas pobladas ===');
    f.rows.forEach(r => console.log(`   ${String(r.n).padStart(5)}  ${r.comarca}`));
    const t = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE comarca IS NOT NULL) AS con_comarca,
            COUNT(*) AS total
        FROM bienes WHERE comunidad_autonoma = 'Comunitat Valenciana'
    `);
    console.log(`\nValencia final: ${t.rows[0].con_comarca}/${t.rows[0].total} (${(100*t.rows[0].con_comarca/t.rows[0].total).toFixed(1)}%)`);

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
