/**
 * _reclasificar_desde_wikidata.cjs
 *
 * Re-clasifica tipo_monumento consultando Wikidata P31 (instance of).
 * Mapping CORREGIDO respecto a enriquecer_tipos.cjs original:
 *   - Q3947 (casa) NO va a Castillo — va a Casa señorial / Mansión
 *   - Q57831 (building genérico) NO va a Castillo — se ignora (no asigna)
 *   - Q274153 solo torre (no castillo)
 *   - Otros QIDs sin evidencia clara de ser fortificación → removed de Castillo
 *
 * Uso:
 *   DATABASE_URL=... node _reclasificar_desde_wikidata.cjs           # Neon dry-run
 *   DATABASE_URL=... node _reclasificar_desde_wikidata.cjs --apply   # Neon apply
 *   unset DATABASE_URL && node _reclasificar_desde_wikidata.cjs --apply   # Local
 *   node _reclasificar_desde_wikidata.cjs --solo Castillo            # solo items con tipo actual Castillo...
 *   node _reclasificar_desde_wikidata.cjs --limit 1000               # procesa solo N items (test)
 */

const { Pool, types } = require('pg');
require('dotenv').config();

types.setTypeParser(20, parseInt);

const DRY_RUN = !process.argv.includes('--apply');
const soloIdx = process.argv.indexOf('--solo');
const SOLO = soloIdx !== -1 ? process.argv[soloIdx + 1] : null;
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) : null;
const SAFE_ONLY = process.argv.includes('--safe');

// Whitelist de transiciones de alta confianza (validadas tras dry-run global).
const SAFE_TRANSITIONS = new Set([
    // Ronda 1 (ya aplicadas)
    'Edificio civil → Casa señorial / Mansión',
    'Iglesia / Ermita → Catedral',
    'Muralla → Castillo / Fortaleza',
    'Yacimiento arqueológico → Castillo / Fortaleza',
    'Monumento conmemorativo → Castillo / Fortaleza',
    'Torre → Castillo / Fortaleza',
    // Ronda 2: transiciones seguras adicionales
    'Edificio civil → Iglesia / Ermita',
    'Iglesia / Ermita → Monasterio / Convento',
    'Edificio civil → Palacio',
    'Casa señorial / Mansión → Palacio',
    'Monasterio / Convento → Iglesia / Ermita',
    'Palacio → Museo',
    'Monasterio / Convento → Museo',
    'Edificio civil → Arquitectura rural',
    'Edificio civil → Yacimiento arqueológico',
    'Edificio civil → Muralla',
    'Edificio civil → Fuente',
    'Edificio civil → Molino',
    'Edificio civil → Museo',
]);

// Transiciones que requieren validación por denominación
// { from → to : regex que debe cumplir la denominación para aplicar }
const VALIDATED_TRANSITIONS = {
    'Torre → Museo': /museo/i,
    'Torre → Casa señorial / Mansión': /casa[s]?\b/i,
};

// ============== DB ==============
const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } })
    : new Pool({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'patrimonio',
        password: process.env.PGPASSWORD || 'patrimonio2026',
        database: process.env.PGDATABASE || 'patrimonio',
    });

const DB_LABEL = process.env.DATABASE_URL ? 'NEON (remoto)' : 'LOCAL';

// ============== MAPPING CORREGIDO ==============
// Prioridad: primero en la lista = más específico (gana en desempates)
const P31_MAP = [
    // Religioso (más específicos primero)
    { qids: ['Q2977', 'Q1509093', 'Q56242215'], tipo: 'Catedral' },
    { qids: ['Q44613', 'Q160742', 'Q1125365', 'Q1668004', 'Q2977698', 'Q845945', 'Q193302', 'Q2576531',
             'Q317557'], tipo: 'Monasterio / Convento' },
    { qids: ['Q145165', 'Q109607'], tipo: 'Iglesia / Ermita' }, // basílica
    { qids: ['Q16970', 'Q108325', 'Q120560', 'Q1088552', 'Q2031836', 'Q15823632',
             'Q1523477', 'Q94037', 'Q1542379', 'Q1509956', 'Q334383', 'Q29553', 'Q1475601',
             'Q56242215'], tipo: 'Iglesia / Ermita' },
    { qids: ['Q32815', 'Q34627', 'Q44539'], tipo: 'Mezquita / Sinagoga' },

    // Militar estricto — SOLO QIDs que REALMENTE son fortificaciones
    // Q23413 = castillo, Q57831 = eliminado (es "building" genérico)
    // Q3947 ELIMINADO de aquí (es "casa")
    // Q5765 ELIMINADO (no es fortaleza)
    // Añadidos: Q57821 (fortification), Q91717 (alcazaba), Q1045481 (batería artillería)
    { qids: ['Q23413', 'Q282472', 'Q1055465', 'Q1348006', 'Q25558360', 'Q57821', 'Q91717', 'Q1045481', 'Q177734', 'Q337567'], tipo: 'Castillo / Fortaleza' },

    // Torre (Q947103 = watchtower, Q1293150 = defensive tower)
    { qids: ['Q12518', 'Q1378845', 'Q1571948', 'Q274153', 'Q1440300', 'Q947103', 'Q1293150'], tipo: 'Torre' },

    // Muralla (Q1497364 = defensive wall, Q355304 = city wall)
    { qids: ['Q5773', 'Q549998', 'Q3010369', 'Q355304', 'Q1497364'], tipo: 'Muralla' },

    // Palacio
    { qids: ['Q16560', 'Q53536964', 'Q3950', 'Q1343246', 'Q189867', 'Q1802963'], tipo: 'Palacio' },

    // Casa señorial / Mansión (incluye Q3947 "casa" aquí)
    { qids: ['Q35112127', 'Q192468', 'Q1030034', 'Q22698', 'Q3947', 'Q13402009'], tipo: 'Casa señorial / Mansión' },

    // Puente
    { qids: ['Q12280', 'Q158438', 'Q537127'], tipo: 'Puente' },

    // Teatro
    { qids: ['Q24354', 'Q153562', 'Q57660343'], tipo: 'Teatro' },

    // Museo (Q33506 aquí, NO en Torre)
    { qids: ['Q33506', 'Q207694', 'Q17431399', 'Q856584'], tipo: 'Museo' },

    // Yacimiento arqueológico
    { qids: ['Q839954', 'Q34763', 'Q863015', 'Q15661340', 'Q1107656', 'Q32880'], tipo: 'Yacimiento arqueológico' },

    // Megalítico
    { qids: ['Q1066446', 'Q35600', 'Q179700', 'Q854022', 'Q1060829', 'Q1311670'], tipo: 'Megalítico' },

    // Infraestructura
    { qids: ['Q474748', 'Q49833'], tipo: 'Acueducto' },
    { qids: ['Q483110', 'Q54050', 'Q43483'], tipo: 'Fuente' },
    { qids: ['Q1062422'], tipo: 'Plaza de toros' },
    { qids: ['Q39715'], tipo: 'Faro' },
    { qids: ['Q44494'], tipo: 'Molino' },

    // Etnología / Rural
    { qids: ['Q131596', 'Q578691', 'Q11995291'], tipo: 'Arquitectura rural' },

    // Conmemorativo — QUITADO Q4989906 (es designación genérica BIC, no conmemorativo real)
    // Solo mantenemos QIDs muy específicos de obras conmemorativas (estatuas, memoriales)
    { qids: ['Q575759', 'Q1076486', 'Q5003624', 'Q1424976'], tipo: 'Monumento conmemorativo' },

    // Cementerio
    { qids: ['Q39614', 'Q15070', 'Q375011'], tipo: 'Cementerio' },

    // Cruz / Crucero
    { qids: ['Q2143825', 'Q219972'], tipo: 'Cruz / Crucero' },

    // Edificio civil (fallback específico — NO Q57831 porque es demasiado genérico)
    { qids: ['Q543654', 'Q1128397', 'Q41176', 'Q11707', 'Q3914', 'Q188913', 'Q40357',
             'Q10842956', 'Q11315', 'Q4830453'], tipo: 'Edificio civil' },
];

const QID_TO_TIPO = {};
for (const group of P31_MAP) {
    for (const qid of group.qids) {
        if (!QID_TO_TIPO[qid]) QID_TO_TIPO[qid] = group.tipo;
    }
}

const TIPO_PRIORITY = [
    'Catedral', 'Monasterio / Convento', 'Iglesia / Ermita', 'Mezquita / Sinagoga',
    'Castillo / Fortaleza', 'Torre', 'Muralla',
    'Palacio', 'Casa señorial / Mansión',
    'Puente', 'Acueducto', 'Faro', 'Molino', 'Fuente', 'Plaza de toros',
    'Teatro', 'Museo', 'Cementerio', 'Cruz / Crucero',
    'Yacimiento arqueológico', 'Megalítico', 'Arquitectura rural',
    'Monumento conmemorativo', 'Edificio civil',
];

// ============== SPARQL ==============

async function sparqlQuery(query) {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/sparql-results+json',
            'User-Agent': 'PatrimonioEuropeoBot/1.0 (reclasificación tipo_monumento)',
        },
    });
    if (response.status === 429) throw new Error('RATE_LIMIT');
    if (!response.ok) throw new Error(`SPARQL error: ${response.status}`);
    return response.json();
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ============== MAIN ==============

async function main() {
    console.log(`=== Reclasificación vía Wikidata P31 ${DRY_RUN ? '[DRY-RUN]' : '[APPLY]'} ===`);
    console.log(`Base de datos: ${DB_LABEL}`);
    if (SOLO) console.log(`Solo items con tipo_monumento actual = '${SOLO}'`);
    if (LIMIT) console.log(`Limitando a ${LIMIT} items`);
    if (SAFE_ONLY) console.log(`Modo --safe: solo transiciones whitelisted (${SAFE_TRANSITIONS.size})`);
    console.log('');

    // Si SOLO, buscamos por prefijo ILIKE. Si no, todos con QID y tipo_monumento asignado.
    const whereClauses = [`w.qid IS NOT NULL`];
    if (SOLO) whereClauses.push(`b.tipo_monumento ILIKE '%${SOLO.replace(/'/g, "''")}%'`);
    else whereClauses.push(`b.tipo_monumento IS NOT NULL`);

    const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';

    const result = await pool.query(`
        SELECT b.id, b.denominacion, b.tipo_monumento, w.qid
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY b.id
        ${limitClause}
    `);

    console.log(`Items con QID a revisar: ${result.rows.length}`);
    if (result.rows.length === 0) {
        await pool.end();
        return;
    }

    const items = result.rows;
    const BATCH_SIZE = 50;

    const changes = []; // {id, den, from, to, via}
    const transitions = new Map();
    let noClassifiable = 0;
    let kept = 0;
    let errors = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const qidToItem = new Map();
        for (const b of batch) {
            if (!qidToItem.has(b.qid)) qidToItem.set(b.qid, []);
            qidToItem.get(b.qid).push(b);
        }

        const uniqueQids = [...qidToItem.keys()];
        const values = uniqueQids.map(q => `wd:${q}`).join(' ');
        const sparql = `
            SELECT ?item ?type WHERE {
                VALUES ?item { ${values} }
                ?item wdt:P31 ?type .
            }
        `;

        let retries = 0;
        const maxRetries = 4;

        while (retries <= maxRetries) {
            try {
                const data = await sparqlQuery(sparql);
                const bindings = data.results?.bindings || [];

                const itemP31s = {}; // qid => [typeQid, ...]
                for (const b of bindings) {
                    const itemQid = b.item.value.split('/').pop();
                    const typeQid = b.type.value.split('/').pop();
                    if (!itemP31s[itemQid]) itemP31s[itemQid] = [];
                    itemP31s[itemQid].push(typeQid);
                }

                for (const [qid, entries] of qidToItem) {
                    const typeQids = itemP31s[qid] || [];
                    const candidateTipos = typeQids.map(tq => QID_TO_TIPO[tq]).filter(Boolean);
                    const candidateSet = new Set(candidateTipos);

                    let suggested = null;
                    if (candidateTipos.length > 0) {
                        for (const t of TIPO_PRIORITY) {
                            if (candidateSet.has(t)) { suggested = t; break; }
                        }
                        if (!suggested) suggested = candidateTipos[0];
                    }

                    for (const ent of entries) {
                        if (suggested === null) {
                            // P31 no mapeado → no tocar, la clasificación actual puede ser correcta por texto
                            noClassifiable++;
                            continue;
                        }
                        // Conservador: si el tipo actual está entre los candidatos Wikidata,
                        // respetarlo (aunque otro tipo tenga más prioridad). Evita cambios
                        // erróneos cuando el monumento tiene múltiples P31 válidos.
                        if (candidateSet.has(ent.tipo_monumento)) {
                            kept++;
                            continue;
                        }
                        if (suggested === ent.tipo_monumento) {
                            kept++;
                            continue;
                        }
                        const key = `${ent.tipo_monumento} → ${suggested}`;
                        if (SAFE_ONLY) {
                            if (SAFE_TRANSITIONS.has(key)) {
                                // OK, aplicar
                            } else if (VALIDATED_TRANSITIONS[key]) {
                                // Solo aplicar si la denominación cumple la regex
                                if (!VALIDATED_TRANSITIONS[key].test(ent.denominacion)) {
                                    kept++;
                                    continue;
                                }
                            } else {
                                kept++;
                                continue;
                            }
                        }
                        changes.push({
                            id: ent.id, den: ent.denominacion,
                            from: ent.tipo_monumento, to: suggested,
                            qid: qid, p31s: typeQids.join(',')
                        });
                        transitions.set(key, (transitions.get(key) || 0) + 1);
                    }
                }

                break; // éxito
            } catch (err) {
                retries++;
                if (err.message === 'RATE_LIMIT' || retries <= maxRetries) {
                    const wait = 2000 * retries;
                    console.log(`  Rate limit / error (${err.message}), esperando ${wait}ms...`);
                    await sleep(wait);
                } else {
                    console.error(`  Error procesando batch ${i}:`, err.message);
                    errors += batch.length;
                    break;
                }
            }
        }

        if ((i / BATCH_SIZE) % 10 === 9) {
            const done = Math.min(i + BATCH_SIZE, items.length);
            console.log(`  Progreso: ${done}/${items.length} — kept=${kept}, changes=${changes.length}, noClassifiable=${noClassifiable}`);
        }

        // Rate limit prudente entre batches
        await sleep(200);
    }

    // Resumen
    console.log(`\n=== Resumen ===`);
    console.log(`  Mantenidos:        ${kept}`);
    console.log(`  A cambiar:         ${changes.length}`);
    console.log(`  P31 no mapeado:    ${noClassifiable}  (se respeta tipo actual)`);
    console.log(`  Errores:           ${errors}`);

    const sorted = [...transitions.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\n--- Top transiciones ---`);
    for (const [key, count] of sorted.slice(0, 40)) {
        console.log(`  ${count.toString().padStart(5)}  ${key}`);
    }

    console.log(`\n--- Muestra de 25 cambios ---`);
    for (const c of changes.slice(0, 25)) {
        console.log(`  [${c.id}] "${c.den}" (${c.qid}, P31=[${c.p31s}])`);
        console.log(`           ${c.from}  →  ${c.to}`);
    }

    if (DRY_RUN) {
        console.log(`\n[DRY-RUN] No se ha modificado nada. Usa --apply para aplicar.`);
    } else {
        console.log(`\nAplicando ${changes.length} cambios en ${DB_LABEL}...`);
        const FLUSH = 500;
        for (let i = 0; i < changes.length; i += FLUSH) {
            const batch = changes.slice(i, i + FLUSH);
            const ids = batch.map(b => b.id);
            const cases = batch.map(b => `WHEN ${b.id} THEN '${b.to.replace(/'/g, "''")}'`).join(' ');
            await pool.query(`
                UPDATE bienes SET tipo_monumento = CASE id ${cases} END
                WHERE id = ANY($1)
            `, [ids]);
            console.log(`  ${Math.min(i + FLUSH, changes.length)} / ${changes.length}`);
        }
        console.log(`\n✓ Aplicado. ${changes.length} items reclasificados en ${DB_LABEL}.`);
    }

    await pool.end();
}

main().catch(err => {
    console.error('Error fatal:', err);
    pool.end();
    process.exit(1);
});
