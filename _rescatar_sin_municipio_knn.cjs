// Rescate bienes España sin municipio con coords:
// asignar municipio cuyo polígono IGN esté más cerca (<=5km) en una sola query SQL.

const db = require('./db.cjs');

const MAX_DIST_M = 5000;

async function main() {
    console.log(`=== Rescate KNN bienes sin municipio (tope ${MAX_DIST_M/1000}km, single-query) ===\n`);

    const antes = (await db.query(
        "SELECT COUNT(*)::int as n FROM bienes WHERE pais='España' AND (municipio IS NULL OR municipio='') AND latitud IS NOT NULL AND longitud IS NOT NULL"
    )).rows[0].n;
    console.log(`Candidatos antes: ${antes}`);

    const t0 = Date.now();

    // Distribución de distancias (para entender qué se quedará fuera)
    console.log('\nCalculando distribución de distancias al municipio más cercano...');
    const dist = await db.query(`
        WITH cand AS (
            SELECT b.id, b.latitud, b.longitud
            FROM bienes b
            WHERE b.pais='España'
              AND (b.municipio IS NULL OR b.municipio='')
              AND b.latitud IS NOT NULL AND b.longitud IS NOT NULL
        ),
        nearest AS (
            SELECT c.id,
                   ST_Distance(
                     m.geom::geography,
                     ST_SetSRID(ST_MakePoint(c.longitud, c.latitud), 4326)::geography
                   ) as dist_m
            FROM cand c
            CROSS JOIN LATERAL (
                SELECT geom
                FROM municipios_espana
                ORDER BY geom <-> ST_SetSRID(ST_MakePoint(c.longitud, c.latitud), 4326)
                LIMIT 1
            ) m
        )
        SELECT
          COUNT(*) FILTER (WHERE dist_m <= 500)::int as bucket_500m,
          COUNT(*) FILTER (WHERE dist_m > 500 AND dist_m <= 1000)::int as bucket_1km,
          COUNT(*) FILTER (WHERE dist_m > 1000 AND dist_m <= 2000)::int as bucket_2km,
          COUNT(*) FILTER (WHERE dist_m > 2000 AND dist_m <= 5000)::int as bucket_5km,
          COUNT(*) FILTER (WHERE dist_m > 5000 AND dist_m <= 20000)::int as bucket_20km,
          COUNT(*) FILTER (WHERE dist_m > 20000)::int as bucket_far
        FROM nearest
    `);
    const d = dist.rows[0];
    console.log(`  <=500m   ${d.bucket_500m}`);
    console.log(`  500m-1km ${d.bucket_1km}`);
    console.log(`  1-2km    ${d.bucket_2km}`);
    console.log(`  2-5km    ${d.bucket_5km}`);
    console.log(`  5-20km   ${d.bucket_20km}`);
    console.log(`  >20km    ${d.bucket_far}`);
    console.log(`Tiempo: ${Date.now()-t0}ms`);

    // UPDATE: asignar municipio si está dentro de MAX_DIST_M
    console.log(`\nAplicando UPDATE...`);
    const t1 = Date.now();
    const upd = await db.query(`
        WITH cand AS (
            SELECT b.id, b.latitud, b.longitud
            FROM bienes b
            WHERE b.pais='España'
              AND (b.municipio IS NULL OR b.municipio='')
              AND b.latitud IS NOT NULL AND b.longitud IS NOT NULL
        ),
        nearest AS (
            SELECT c.id,
                   m.nombre,
                   ST_Distance(
                     m.geom::geography,
                     ST_SetSRID(ST_MakePoint(c.longitud, c.latitud), 4326)::geography
                   ) as dist_m
            FROM cand c
            CROSS JOIN LATERAL (
                SELECT municipio AS nombre, geom
                FROM municipios_espana
                ORDER BY geom <-> ST_SetSRID(ST_MakePoint(c.longitud, c.latitud), 4326)
                LIMIT 1
            ) m
        )
        UPDATE bienes SET municipio = n.nombre, updated_at = NOW()
        FROM nearest n
        WHERE bienes.id = n.id
          AND n.dist_m <= $1
    `, [MAX_DIST_M]);
    console.log(`UPDATE: ${upd.rowCount} filas en ${Date.now()-t1}ms`);

    const final = (await db.query(
        "SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE municipio IS NOT NULL AND municipio<>'')::int as con_muni FROM bienes WHERE pais='España'"
    )).rows[0];
    console.log(`\n=== España final ===`);
    console.log(`  Total: ${final.total}`);
    console.log(`  Con municipio: ${final.con_muni} (${(100*final.con_muni/final.total).toFixed(1)}%)`);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
