/**
 * Exploración Wikidata: rutas culturales/turísticas en ES/IT/FR/PT.
 * Solo lectura. Una query por tipo+país.
 */
const axios = require('axios');
const fs = require('fs');

const SPARQL_URL = 'https://query.wikidata.org/sparql';
const HEADERS = {
    'User-Agent': 'PatrimonioEuropeo/1.0',
    'Accept': 'application/sparql-results+json',
};

const TIPOS = [
    ['Q2143825', 'cultural route'],
    ['Q3286156', 'European Cultural Route (CoE)'],
    ['Q1457376', 'tourist route'],
    ['Q5004679', 'pilgrimage route'],
    ['Q1907114', 'Way of Saint James'],
    ['Q1059585', 'long-distance trail'],
    ['Q11424100', 'Sentiero CAI (Italia)'],
    ['Q4810448', 'GR (Francia)'],
    ['Q4304266', 'Cammini storici (Italia)'],
];

const PAISES = [
    ['Q29', 'España'],
    ['Q38', 'Italia'],
    ['Q142', 'Francia'],
    ['Q45', 'Portugal'],
];

async function sparql(query) {
    const r = await axios.get(SPARQL_URL, {
        params: { query, format: 'json' },
        headers: HEADERS,
        timeout: 90000,
    });
    return r.data.results.bindings;
}

async function rutasPorTipoYPais(tipoQid, paisQid) {
    const query = `
        SELECT ?ruta ?rutaLabel ?desc ?long ?web ?img WHERE {
          ?ruta wdt:P31 wd:${tipoQid} .
          ?ruta wdt:P17 wd:${paisQid} .
          OPTIONAL { ?ruta schema:description ?desc . FILTER(LANG(?desc) IN ("es","en","it","fr","pt")) }
          OPTIONAL { ?ruta wdt:P2043 ?long . }
          OPTIONAL { ?ruta wdt:P856 ?web . }
          OPTIONAL { ?ruta wdt:P18 ?img . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,it,fr,pt". }
        }
        LIMIT 200
    `;
    return sparql(query);
}

function qid(uri) { return uri ? uri.split('/').pop() : null; }

(async () => {
    const todos = [];
    const matriz = {}; // tipo -> pais -> count

    for (const [tipoQid, tipoNombre] of TIPOS) {
        matriz[tipoNombre] = {};
        for (const [paisQid, paisNombre] of PAISES) {
            try {
                const rows = await rutasPorTipoYPais(tipoQid, paisQid);
                matriz[tipoNombre][paisNombre] = rows.length;
                for (const r of rows) {
                    const item = {
                        pais: paisNombre,
                        tipo: tipoNombre,
                        qid: qid(r.ruta?.value),
                        nombre: r.rutaLabel?.value,
                        desc: r.desc?.value,
                        longitud_km: r.long ? parseFloat(r.long.value) / 1000 : null,
                        web: r.web?.value,
                        imagen: r.img?.value,
                    };
                    // dedupe por qid+pais
                    if (!todos.find(t => t.qid === item.qid)) todos.push(item);
                }
            } catch (e) {
                matriz[tipoNombre][paisNombre] = 'ERR';
            }
        }
    }

    // Imprimir matriz
    console.log('\n=== Matriz tipo × país (rutas en Wikidata) ===\n');
    const padTipo = 35, padNum = 10;
    process.stdout.write('Tipo'.padEnd(padTipo));
    PAISES.forEach(([, n]) => process.stdout.write(n.padStart(padNum)));
    process.stdout.write('\n');
    process.stdout.write('-'.repeat(padTipo + padNum * PAISES.length) + '\n');
    for (const [tipoNombre, paises] of Object.entries(matriz)) {
        process.stdout.write(tipoNombre.substring(0, padTipo - 1).padEnd(padTipo));
        PAISES.forEach(([, n]) => process.stdout.write(String(paises[n] ?? '-').padStart(padNum)));
        process.stdout.write('\n');
    }

    console.log('\n=== Total rutas únicas: ' + todos.length + ' ===\n');

    // Top con datos enriquecidos
    const conImagen = todos.filter(t => t.imagen).length;
    const conLong = todos.filter(t => t.longitud_km).length;
    const conWeb = todos.filter(t => t.web).length;
    const conDesc = todos.filter(t => t.desc).length;
    console.log(`  Con imagen:    ${conImagen}`);
    console.log(`  Con longitud:  ${conLong}`);
    console.log(`  Con web:       ${conWeb}`);
    console.log(`  Con descrip:   ${conDesc}`);

    // Muestras destacadas por país
    console.log('\n=== Muestras por país (top 10 con más datos) ===');
    for (const [, paisNombre] of PAISES) {
        const rutas = todos
            .filter(t => t.pais === paisNombre)
            .sort((a, b) => {
                const sa = (a.imagen?1:0) + (a.longitud_km?1:0) + (a.web?1:0);
                const sb = (b.imagen?1:0) + (b.longitud_km?1:0) + (b.web?1:0);
                return sb - sa;
            })
            .slice(0, 10);
        console.log(`\n--- ${paisNombre} (${todos.filter(t => t.pais===paisNombre).length} totales) ---`);
        rutas.forEach(r => {
            const tags = [
                r.imagen ? '🖼' : '',
                r.longitud_km ? `${r.longitud_km.toFixed(0)}km` : '',
                r.web ? '🌐' : '',
            ].filter(Boolean).join(' ');
            console.log(`  ${r.qid.padEnd(10)} ${(r.nombre||'?').substring(0,55).padEnd(55)} ${tags}`);
            if (r.desc) console.log(`             ${r.desc.substring(0, 120)}`);
        });
    }

    fs.writeFileSync('./tmp_rutas_wikidata.json', JSON.stringify(todos, null, 2));
    console.log(`\n\nVolcado completo: tmp_rutas_wikidata.json (${todos.length} rutas)`);
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
