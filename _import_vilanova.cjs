require('dotenv').config();
const { Pool } = require('pg');

async function sparql(q) {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'PatrimonioBot/1.0', 'Accept': 'application/sparql-results+json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
}

const TYPE_MAP = {
    'Q23413': 'Castillo / Fortaleza',
    'Q16560': 'Palacio',
    'Q16970': 'Iglesia / Ermita',
    'Q108325': 'Iglesia / Ermita',
    'Q44613': 'Monasterio / Convento',
    'Q160742': 'Monasterio / Convento',
    'Q317557': 'Iglesia / Ermita',
    'Q33506': 'Museo',
    'Q839954': 'Yacimiento arqueológico',
    'Q12518': 'Torre',
    'Q41176': 'Edificio civil',
    'Q3947': 'Casa señorial / Mansión',
    'Q22698': 'Conjunto arquitectónico',
    'Q570116': 'Conjunto arquitectónico',
    'Q1248784': 'Conjunto arquitectónico',
    'Q4989906': 'Edificio civil',
    'Q5107': 'Edificio civil',
    'Q1810691': 'Edificio civil',
    'Q11707': 'Edificio civil',
    'Q3957': 'Conjunto arquitectónico',
};

async function fetchData() {
    const query = `
        SELECT ?item ?itemLabel ?itemDesc ?lat ?lng ?image ?type ?inception ?heritage ?heritageLabel WHERE {
            ?item wdt:P131* wd:Q15553 .
            ?item wdt:P31 ?type .
            ?item wdt:P625 ?coords .
            BIND(geof:latitude(?coords) AS ?lat)
            BIND(geof:longitude(?coords) AS ?lng)
            OPTIONAL { ?item wdt:P18 ?image }
            OPTIONAL { ?item wdt:P571 ?inception }
            OPTIONAL { ?item wdt:P1435 ?heritage }
            FILTER (?type IN (
                wd:Q16560, wd:Q23413, wd:Q16970, wd:Q33506, wd:Q839954,
                wd:Q12518, wd:Q41176, wd:Q570116, wd:Q44613, wd:Q3947,
                wd:Q1248784, wd:Q4989906, wd:Q317557, wd:Q22698, wd:Q5107,
                wd:Q1810691, wd:Q108325, wd:Q160742, wd:Q11707, wd:Q3957
            ))
            SERVICE wikibase:label { bd:serviceParam wikibase:language "ca,es,en" }
        }
    `;
    const data = await sparql(query);
    const byQid = {};
    for (const b of (data.results?.bindings || [])) {
        const qid = b.item.value.split('/').pop();
        if (!byQid[qid]) {
            byQid[qid] = {
                qid,
                label: b.itemLabel?.value || '',
                desc: b.itemDesc?.value || '',
                lat: parseFloat(b.lat.value),
                lng: parseFloat(b.lng.value),
                image: b.image?.value || null,
                inception: b.inception?.value?.substring(0, 10) || null,
                heritage: b.heritageLabel?.value || null,
                types: [],
            };
        }
        byQid[qid].types.push(b.type.value.split('/').pop());
    }
    return Object.values(byQid);
}

async function importTo(connConfig, label, items) {
    const pool = new Pool(connConfig);
    let created = 0, skipped = 0;
    for (const it of items) {
        const tipoQid = it.types.find(t => TYPE_MAP[t]) || it.types[0];
        const tipo = TYPE_MAP[tipoQid] || null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check if already exists by QID
            const exists = await client.query('SELECT bien_id FROM wikidata WHERE qid=$1', [it.qid]);
            if (exists.rows.length > 0) {
                skipped++;
                await client.query('ROLLBACK');
                client.release();
                client.released = true;
                continue;
            }

            const bienRes = await client.query(`
                INSERT INTO bienes (denominacion, localidad, municipio, provincia, comunidad_autonoma, latitud, longitud, pais, codigo_fuente, tipo_monumento)
                VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9)
                ON CONFLICT (pais, comunidad_autonoma, codigo_fuente) DO UPDATE SET denominacion=EXCLUDED.denominacion, updated_at=NOW()
                RETURNING id
            `, [it.label, 'Vilanova i la Geltrú', 'Barcelona', 'Catalunya', it.lat, it.lng, 'España', 'wikidata-' + it.qid, tipo]);
            const bienId = bienRes.rows[0].id;

            await client.query(`
                INSERT INTO wikidata (bien_id, qid, descripcion, imagen_url, inception, heritage_label)
                VALUES ($1,$2,$3,$4,$5,$6)
                ON CONFLICT (bien_id) DO NOTHING
            `, [bienId, it.qid, it.desc, it.image, it.inception, it.heritage]);

            if (it.image) {
                await client.query('INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
                    [bienId, it.image, it.label, 'wikidata']);
            }

            await client.query('COMMIT');
            created++;
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('  ERR ' + it.qid + ': ' + e.message);
        } finally {
            if (!client.released) client.release();
        }
    }
    console.log(`${label}: creados=${created}, ya existían=${skipped}`);
    await pool.end();
}

(async () => {
    console.log('Consultando Wikidata...');
    const items = await fetchData();
    console.log('Items: ' + items.length);

    await importTo({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } }, 'NEON', items);
    await importTo({ host: 'localhost', port: 5433, user: 'patrimonio', password: 'patrimonio2026', database: 'patrimonio' }, 'LOCAL', items);
})();
