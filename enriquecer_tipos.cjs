/**
 * enriquecer_tipos.cjs
 * Enriquece bienes con tipo_monumento y periodo usando:
 *   Fase A: Wikidata P31 (instance of) via SPARQL
 *   Fase B: Clasificación por texto (regex multilingüe ampliado)
 *   Fase B2: Clasificación por categoria/tipo cuando no hay match de texto
 *   Fase C: Asignación de periodo (estilo, inception, sipca, texto, tipo_monumento)
 */
const db = require('./db.cjs');

// ============== MAPPINGS ==============

// P31 QID → tipo_monumento (ordered by priority for multi-match resolution)
const P31_MAP = [
    // Catedral (highest priority)
    { qids: ['Q2977', 'Q1509093', 'Q56242215'], tipo: 'Catedral' },
    // Monasterio / Convento
    { qids: ['Q44613', 'Q160742', 'Q1125365', 'Q1668004', 'Q2977698', 'Q845945', 'Q193302', 'Q2576531'], tipo: 'Monasterio / Convento' },
    // Basílica → Iglesia / Ermita
    { qids: ['Q145165', 'Q109607'], tipo: 'Iglesia / Ermita' },
    // Iglesia / Ermita
    { qids: ['Q16970', 'Q108325', 'Q317557', 'Q120560', 'Q1088552', 'Q2031836', 'Q56242215', 'Q15823632',
             'Q1523477', 'Q94037', 'Q1542379', 'Q44539', 'Q1509956', 'Q334383', 'Q29553', 'Q1475601'], tipo: 'Iglesia / Ermita' },
    // Castillo / Fortaleza
    { qids: ['Q23413', 'Q57831', 'Q274153', 'Q282472', 'Q91122', 'Q1055465', 'Q5765', 'Q3947'], tipo: 'Castillo / Fortaleza' },
    // Palacio
    { qids: ['Q16560', 'Q53536964', 'Q3950', 'Q1343246', 'Q189867', 'Q1802963'], tipo: 'Palacio' },
    // Casa señorial / Mansión
    { qids: ['Q35112127', 'Q192468', 'Q1030034', 'Q22698'], tipo: 'Casa señorial / Mansión' },
    // Torre
    { qids: ['Q12518', 'Q1378845', 'Q33506', 'Q1571948', 'Q274153'], tipo: 'Torre' },
    // Muralla
    { qids: ['Q5773', 'Q549998', 'Q3010369', 'Q355304'], tipo: 'Muralla' },
    // Puente
    { qids: ['Q12280', 'Q158438', 'Q537127'], tipo: 'Puente' },
    // Mezquita / Sinagoga
    { qids: ['Q32815', 'Q34627', 'Q44539'], tipo: 'Mezquita / Sinagoga' },
    // Teatro
    { qids: ['Q24354', 'Q153562', 'Q57660343'], tipo: 'Teatro' },
    // Museo
    { qids: ['Q33506', 'Q207694', 'Q17431399', 'Q856584'], tipo: 'Museo' },
    // Yacimiento arqueológico
    { qids: ['Q839954', 'Q34763', 'Q863015', 'Q15661340', 'Q1107656', 'Q32880'], tipo: 'Yacimiento arqueológico' },
    // Megalítico
    { qids: ['Q1066446', 'Q35600', 'Q179700', 'Q854022', 'Q1060829', 'Q1311670'], tipo: 'Megalítico' },
    // Acueducto
    { qids: ['Q474748', 'Q49833'], tipo: 'Acueducto' },
    // Fuente
    { qids: ['Q483110', 'Q54050', 'Q43483'], tipo: 'Fuente' },
    // Plaza de toros
    { qids: ['Q1062422'], tipo: 'Plaza de toros' },
    // Faro
    { qids: ['Q39715'], tipo: 'Faro' },
    // Edificio civil
    { qids: ['Q543654', 'Q1128397', 'Q41176', 'Q11707', 'Q3914', 'Q188913', 'Q40357',
             'Q10842956', 'Q11315', 'Q4830453', 'Q57831'], tipo: 'Edificio civil' },
    // Cementerio
    { qids: ['Q39614', 'Q15070', 'Q375011'], tipo: 'Cementerio' },
    // Cruz / Crucero
    { qids: ['Q2143825', 'Q219972'], tipo: 'Cruz / Crucero' },
    // Monumento conmemorativo
    { qids: ['Q4989906', 'Q575759', 'Q1076486'], tipo: 'Monumento conmemorativo' },
];

// Build reverse lookup: QID → tipo (first match wins = highest priority)
const QID_TO_TIPO = {};
for (const group of P31_MAP) {
    for (const qid of group.qids) {
        if (!QID_TO_TIPO[qid]) {
            QID_TO_TIPO[qid] = group.tipo;
        }
    }
}

// Priority order for resolving multiple P31 types
const TIPO_PRIORITY = [
    'Catedral', 'Monasterio / Convento', 'Iglesia / Ermita',
    'Castillo / Fortaleza', 'Palacio', 'Casa señorial / Mansión', 'Torre', 'Muralla', 'Puente',
    'Mezquita / Sinagoga', 'Teatro', 'Museo', 'Yacimiento arqueológico', 'Megalítico',
    'Acueducto', 'Fuente', 'Faro', 'Plaza de toros', 'Cruz / Crucero',
    'Monumento conmemorativo', 'Edificio civil', 'Cementerio'
];

// Text patterns for Phase B (ordered by specificity - more specific first)
// Massively expanded with IT/FR/PT/CA/EU/GL patterns discovered in unclassified data
const TEXT_PATTERNS = [
    // --- Religiosa ---
    { regex: /catedral|cathédrale|cattedrale|duomo\b/i, tipo: 'Catedral' },
    { regex: /monasterio|convento|abadía|cartuja|mosteiro|abbaye|monastère|couvent|abbazia|monastero|priorato|priorat|prioré|certosa|chartreux/i, tipo: 'Monasterio / Convento' },
    { regex: /basílica|basilique|basilica/i, tipo: 'Iglesia / Ermita' },
    { regex: /iglesia|ermita|parroquia|capilla|église|chapelle|chiesa|paróquia|igreja|santuario|sanctuaire|santuário|colegiata|collégiale|pieve|piève|oratorio|oratoire|oratório/i, tipo: 'Iglesia / Ermita' },
    { regex: /ermida|capella\b|capela\b|eliza\b/i, tipo: 'Iglesia / Ermita' },
    // --- Militar ---
    { regex: /castillo|fortaleza|alcázar|château[\s-]fort|forteresse|castello|fortezza|castelo|alcazaba|atalaya|kastellu/i, tipo: 'Castillo / Fortaleza' },
    { regex: /\bfort\b|fortín|fortino|fortin\b|blocao|blockhaus|bastión|bastione|baluarte/i, tipo: 'Castillo / Fortaleza' },
    { regex: /rocca\b|ciutadella|ciudadela|citadelle|cittadella/i, tipo: 'Castillo / Fortaleza' },
    { regex: /palacio|palais|palazzo\b|paço|pazo|palacete/i, tipo: 'Palacio' },
    { regex: /torre\b|tour\b(?!\s*(de\s+)?france)/i, tipo: 'Torre' },
    { regex: /muralla|rempart|mura\b(?!no|les)|muralha|recinto\s*amurallado|enceinte|fortification|cinta\s*mur/i, tipo: 'Muralla' },
    // --- Civil ---
    { regex: /puente|pont\b|ponte\b/i, tipo: 'Puente' },
    { regex: /mezquita|mosquée|moschea|sinagoga|synagogue/i, tipo: 'Mezquita / Sinagoga' },
    { regex: /teatro\b|théâtre|theater\b/i, tipo: 'Teatro' },
    { regex: /museo\b|musée|museum\b/i, tipo: 'Museo' },
    // --- Arqueológica ---
    { regex: /dolmen|menhir|cromlech|megalít|tholos|anta\b|mamoa|taula\b|talayot|naveta\b/i, tipo: 'Megalítico' },
    { regex: /nuraghe|nuraxi|nuragh/i, tipo: 'Yacimiento arqueológico' },
    { regex: /yacimiento|arqueológic|ruinas?\b|villa\s*roman[ao]|castro\b|site\s*archéo|sítio\s*arqueológ|oppidum|excavaci|necróp|necrópole|grotta\s*preistor/i, tipo: 'Yacimiento arqueológico' },
    { regex: /cueva\b|cova\b|grotte\b|grotta\b|abrigo\s*rupestre|abri\s*sous|riparo\b|coveta\b/i, tipo: 'Yacimiento arqueológico' },
    // --- Infraestructura ---
    { regex: /acueducto|aqueduc|acquedotto|aqueduto/i, tipo: 'Acueducto' },
    { regex: /fuente\b|fontaine\b|fontana\b|fonte\b|chafariz|lavadero|lavoir|lavatoio|bealera/i, tipo: 'Fuente' },
    { regex: /faro\b|phare\b|farol\b|lighthouse/i, tipo: 'Faro' },
    { regex: /plaza\s*de\s*toros|arènes\b/i, tipo: 'Plaza de toros' },
    // --- Cruz / Crucero ---
    { regex: /crucero\b|cruz\b(?!\s*roja)|croix\b|cruzeiro\b|creu\b|croce\b|calvario|calvaire|cruceiro/i, tipo: 'Cruz / Crucero' },
    // --- Monumento conmemorativo ---
    { regex: /monumento\s*(conmemorat|a\s*los\s*caídos|ai\s*caduti|aux\s*morts)|memorial\b|obelisco|estatua|monument\s*aux/i, tipo: 'Monumento conmemorativo' },
    // --- Obra hidráulica ---
    { regex: /acequia|canal\b|presa\b|azud|noria\b|molino\s*de\s*agua|embalse|pantano\b|barrage|diga\b/i, tipo: 'Obra hidráulica' },
    // --- Molino ---
    { regex: /molino|moulin|mulino|moinho|molí\b/i, tipo: 'Molino' },
    // --- Patrimonio industrial ---
    { regex: /fábrica|usine|fabbrica|forno\b|horno\b|four\b|ferrería|forja|forge\b|fucina|mina\b|mine\b|miniera|cantera|carrière|cava\b/i, tipo: 'Patrimonio industrial' },
    { regex: /estación\b|estação\b|gare\b|stazione\b/i, tipo: 'Patrimonio industrial' },
    // --- Arquitectura rural ---
    { regex: /masía|masia\b|mas\b(?=\s+d[e'])|cortijo|hórreo|horreo|palloza|barraca\b|borda\b|cabaña\b|refugio\s*(?:de\s*pastor|pastoril)/i, tipo: 'Arquitectura rural' },
    { regex: /cascina|casale\b|masseria|trullo|dammuso|nuraghe|borgo\s*rural/i, tipo: 'Arquitectura rural' },
    { regex: /pigeonnier|palomar|colombier|colombaia|pombal\b/i, tipo: 'Arquitectura rural' },
    // --- Edificio civil (catch-all, must go last) ---
    { regex: /ayuntamiento|hôtel\s*de\s*ville|câmara\s*municipal|palazzo\s*comunale|mairie|municipio\b|ajuntament/i, tipo: 'Edificio civil' },
    { regex: /aduana|lonja|bolsa\b|bourse\b|borsa\b/i, tipo: 'Edificio civil' },
    { regex: /hospital\b|hospicio|hôpital|ospedale|hospedería/i, tipo: 'Edificio civil' },
    { regex: /escuela|colegio|collège|scuola|escola|universidad|université|università|seminari/i, tipo: 'Edificio civil' },
    { regex: /cárcel|prisión|prison\b|prigione|cadeia/i, tipo: 'Edificio civil' },
    { regex: /mercado\b|marché\b|mercato\b|halle\b|halles\b/i, tipo: 'Edificio civil' },
    { regex: /biblioteca\b|bibliothèque|biblioteca/i, tipo: 'Edificio civil' },
    // --- Cementerio ---
    { regex: /cementerio|cimetière|cimitero|cemitério/i, tipo: 'Cementerio' },
    // --- Casa / Vivienda → Casa señorial si parece noble, sino Edificio civil ---
    { regex: /casa\s*(señorial|solariega|palacio|nobiliaria|torre|forte|grande|natal)|manor|manoir|palazzo\s*(nobil|signor)|solar\b|château\b(?![\s-]fort)/i, tipo: 'Casa señorial / Mansión' },
    { regex: /villa\b(?!\s*(roman|grec|ibér|romain))/i, tipo: 'Casa señorial / Mansión' },
    // --- Vivienda genérica y edificios → Edificio civil ---
    { regex: /\bcasa\b|maison\b|immeuble\b|vivienda|habitatge|edifício|edificio\b|hôtel\b(?!\s*de\s*ville)|logis\b|demeure\b/i, tipo: 'Edificio civil' },
];

// Fallback: classify by categoria/tipo when text patterns didn't match
const CATEGORIA_FALLBACKS = [
    { regex: /etnol[oó]g/i, tipo: 'Arquitectura rural' },
    { regex: /obra\s*civil/i, tipo: 'Edificio civil' },
    { regex: /arqueol[oó]g/i, tipo: 'Yacimiento arqueológico' },
    { regex: /militar/i, tipo: 'Castillo / Fortaleza' },
    { regex: /religio/i, tipo: 'Iglesia / Ermita' },
    { regex: /zona\s*speciale|sito\s*di\s*interesse|zona\s*di\s*protez/i, tipo: null }, // Skip nature reserves
    { regex: /patrimonio\s*dell.*umanit|patrimonio\s*mundial|Património\s*Mundial/i, tipo: null }, // Skip generic UNESCO
];

// Estilo → periodo mapping
const ESTILO_TO_PERIODO = [
    { regex: /megalít|neolít|edad\s*del\s*bronce|calcolít|néolithique|mégalithique|neolitico|megalítico|preistor|prehistór/i, periodo: 'Prehistoria' },
    { regex: /roman[oa]?\b|ibéric|romain|celti|fenicio|grieg|púnic|tartés|turdetano|lusitano|etrusc/i, periodo: 'Antiguo / Romano' },
    { regex: /visigod|prerrománic|mozárabe|asturian|wisigoth|préroman|longobard|carolingi/i, periodo: 'Prerrománico' },
    { regex: /románic[oa]?\b|romanesque|roman\b|lombard/i, periodo: 'Románico' },
    { regex: /gótic[oa]?\b|gothic|gothique|flamíger|ogival/i, periodo: 'Gótico' },
    { regex: /mudéjar|mudéjare/i, periodo: 'Mudéjar' },
    { regex: /renacimiento|renacent|plateresc|herrerian|renaissance|rinasciment|manierism/i, periodo: 'Renacimiento' },
    { regex: /barroc[oa]?\b|churrigueresc|rococó|baroque|rococo/i, periodo: 'Barroco' },
    { regex: /neoclásic|néoclassique|neoclassic|palladiano/i, periodo: 'Neoclásico' },
    { regex: /modernism|art\s*nouveau|neogótic|eclecticismo|modernista|neomudejar|neorrománic|neo-gótic|jugendstil|liberty|sezession/i, periodo: 'Modernismo' },
    { regex: /racionalism|brutalism|contemporáne|funcional|art\s*déco|razionalismo|racionalista|postmodern/i, periodo: 'Contemporáneo' },
];

// tipo_monumento → periodo (when no other source available)
const TIPO_TO_PERIODO_DEFAULT = {
    'Megalítico': 'Prehistoria',
    'Yacimiento arqueológico': null,  // too ambiguous
    'Mezquita / Sinagoga': null,      // too ambiguous
};

// Year → periodo mapping
function yearToPeriodo(year) {
    if (year < -800) return 'Prehistoria';
    if (year <= 476) return 'Antiguo / Romano';
    if (year <= 999) return 'Prerrománico';
    if (year <= 1250) return 'Románico';
    if (year <= 1500) return 'Gótico';
    if (year <= 1600) return 'Renacimiento';
    if (year <= 1750) return 'Barroco';
    if (year <= 1850) return 'Neoclásico';
    if (year <= 1930) return 'Modernismo';
    return 'Contemporáneo';
}

// Parse inception string to year
function parseInceptionYear(inception) {
    if (!inception) return null;
    // Handle negative years (BCE)
    const negMatch = inception.match(/^-(\d+)/);
    if (negMatch) return -parseInt(negMatch[1]);
    // Handle "siglo X" / "century X" / "siècle"
    const sigloMatch = inception.match(/(?:siglo|century|siècle|secolo)\s+([IVXLCDM]+)/i);
    if (sigloMatch) {
        const roman = sigloMatch[1].toUpperCase();
        const val = romanToInt(roman);
        if (val) return (val - 1) * 100 + 50; // midpoint of century
    }
    // Handle roman numeral alone (like "XII" or "XIII-XIV")
    const romanAlone = inception.match(/^([IVXLCDM]+)(?:\s|$|-)/);
    if (romanAlone) {
        const val = romanToInt(romanAlone[1]);
        if (val && val >= 1 && val <= 21) return (val - 1) * 100 + 50;
    }
    // Handle plain year
    const yearMatch = inception.match(/(\d{3,4})/);
    if (yearMatch) return parseInt(yearMatch[1]);
    return null;
}

function romanToInt(s) {
    const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let result = 0;
    for (let i = 0; i < s.length; i++) {
        const curr = map[s[i]];
        const next = map[s[i + 1]];
        if (!curr) return null;
        if (next && curr < next) result -= curr;
        else result += curr;
    }
    return result;
}

// ============== SPARQL HELPERS ==============

const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';

async function sparqlQuery(query) {
    const url = `${WIKIDATA_SPARQL_URL}?query=${encodeURIComponent(query)}&format=json`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/sparql-results+json',
            'User-Agent': 'PatrimonioEuropeoBot/1.0 (monument enrichment script)',
        },
    });
    if (response.status === 429) {
        throw new Error('RATE_LIMIT');
    }
    if (!response.ok) {
        throw new Error(`SPARQL error: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== BATCH UPDATE HELPER ==============

async function flushBatchUpdate(batch, column) {
    if (batch.length === 0) return;
    // Use a single query with CASE WHEN for efficiency
    const ids = batch.map(b => b.id);
    const cases = batch.map(b => `WHEN ${b.id} THEN '${(b.value || '').replace(/'/g, "''")}'`).join(' ');
    await db.query(`
        UPDATE bienes SET ${column} = CASE id ${cases} END
        WHERE id = ANY($1) AND ${column} IS NULL
    `, [ids]);
}

// ============== PHASE A: Wikidata P31 ==============

async function phaseA() {
    console.log('\n=== FASE A: Wikidata P31 (instance of) ===\n');

    // Get all bienes with QID that don't have tipo_monumento yet
    const result = await db.query(`
        SELECT b.id, w.qid
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE w.qid IS NOT NULL AND b.tipo_monumento IS NULL
        ORDER BY b.id
    `);

    const items = result.rows;
    console.log(`Items con QID sin tipo_monumento: ${items.length}`);

    if (items.length === 0) {
        console.log('Nada que procesar en Fase A.');
        return;
    }

    const BATCH_SIZE = 50;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const qids = batch.map(b => b.qid);
        const qidToIds = {};
        for (const b of batch) {
            if (!qidToIds[b.qid]) qidToIds[b.qid] = [];
            qidToIds[b.qid].push(b.id);
        }

        const values = qids.map(q => `wd:${q}`).join(' ');
        const sparql = `
            SELECT ?item ?type WHERE {
                VALUES ?item { ${values} }
                ?item wdt:P31 ?type .
            }
        `;

        let retries = 0;
        const maxRetries = 3;

        while (retries <= maxRetries) {
            try {
                const data = await sparqlQuery(sparql);
                const bindings = data.results?.bindings || [];

                // Group types by item QID
                const itemTypes = {};
                for (const b of bindings) {
                    const itemQid = b.item.value.split('/').pop();
                    const typeQid = b.type.value.split('/').pop();
                    if (!itemTypes[itemQid]) itemTypes[itemQid] = [];
                    itemTypes[itemQid].push(typeQid);
                }

                // Resolve best tipo for each item
                for (const [qid, typeQids] of Object.entries(itemTypes)) {
                    const candidateTipos = typeQids
                        .map(tq => QID_TO_TIPO[tq])
                        .filter(Boolean);

                    if (candidateTipos.length === 0) continue;

                    // Pick highest priority
                    let bestTipo = null;
                    for (const t of TIPO_PRIORITY) {
                        if (candidateTipos.includes(t)) {
                            bestTipo = t;
                            break;
                        }
                    }
                    if (!bestTipo) bestTipo = candidateTipos[0];

                    // Update all bienes with this QID
                    const bienIds = qidToIds[qid] || [];
                    for (const bienId of bienIds) {
                        await db.query(
                            'UPDATE bienes SET tipo_monumento = $1 WHERE id = $2 AND tipo_monumento IS NULL',
                            [bestTipo, bienId]
                        );
                        updated++;
                    }
                }

                break; // success, exit retry loop
            } catch (err) {
                if (err.message === 'RATE_LIMIT' && retries < maxRetries) {
                    retries++;
                    const delay = 5000 * Math.pow(2, retries);
                    console.log(`  Rate limited, waiting ${delay / 1000}s (retry ${retries}/${maxRetries})...`);
                    await sleep(delay);
                } else {
                    console.error(`  Error en lote ${i}-${i + BATCH_SIZE}:`, err.message);
                    errors++;
                    break;
                }
            }
        }

        if ((i / BATCH_SIZE) % 10 === 0) {
            console.log(`  Procesados ${i + batch.length}/${items.length} (actualizados: ${updated})`);
        }

        // Delay between batches to respect rate limits
        await sleep(2000);
    }

    console.log(`Fase A completada: ${updated} actualizados, ${errors} errores`);
}

// ============== PHASE B: Text classification ==============

async function phaseB() {
    console.log('\n=== FASE B: Clasificación por texto (ampliada) ===\n');

    // Get bienes still without tipo_monumento
    const result = await db.query(`
        SELECT b.id, b.denominacion, b.tipo, b.categoria, b.clase,
               w.descripcion as wiki_desc
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.tipo_monumento IS NULL
        ORDER BY b.id
    `);

    const items = result.rows;
    console.log(`Items sin tipo_monumento para clasificar por texto: ${items.length}`);

    let updated = 0;
    const FLUSH_SIZE = 1000;
    let updateBatch = [];

    for (const item of items) {
        const searchText = [
            item.denominacion,
            item.tipo,
            item.clase,
            item.wiki_desc
        ].filter(Boolean).join(' ');

        let matched = null;
        for (const pattern of TEXT_PATTERNS) {
            if (pattern.regex.test(searchText)) {
                matched = pattern.tipo;
                break;
            }
        }

        if (matched) {
            updateBatch.push({ id: item.id, value: matched });
            updated++;

            if (updateBatch.length >= FLUSH_SIZE) {
                await flushBatchUpdate(updateBatch, 'tipo_monumento');
                updateBatch = [];
                console.log(`  Progreso: ${updated} clasificados...`);
            }
        }
    }

    if (updateBatch.length > 0) {
        await flushBatchUpdate(updateBatch, 'tipo_monumento');
    }

    console.log(`Fase B completada: ${updated} actualizados`);
}

// ============== PHASE B2: Classify by categoria/tipo fallback ==============

async function phaseB2() {
    console.log('\n=== FASE B2: Clasificación por categoría/tipo (fallback) ===\n');

    const result = await db.query(`
        SELECT b.id, b.denominacion, b.categoria, b.tipo
        FROM bienes b
        WHERE b.tipo_monumento IS NULL
        ORDER BY b.id
    `);

    const items = result.rows;
    console.log(`Items restantes sin tipo_monumento: ${items.length}`);

    let updated = 0;
    let skipped = 0;
    const FLUSH_SIZE = 1000;
    let updateBatch = [];

    for (const item of items) {
        const catTipo = [item.categoria, item.tipo].filter(Boolean).join(' ');
        if (!catTipo) continue;

        let matched = null;
        for (const fb of CATEGORIA_FALLBACKS) {
            if (fb.regex.test(catTipo)) {
                matched = fb.tipo;
                break;
            }
        }

        if (matched === null) {
            // Explicitly null means skip (e.g., nature reserves)
            skipped++;
            continue;
        }

        if (matched) {
            updateBatch.push({ id: item.id, value: matched });
            updated++;

            if (updateBatch.length >= FLUSH_SIZE) {
                await flushBatchUpdate(updateBatch, 'tipo_monumento');
                updateBatch = [];
                console.log(`  Progreso: ${updated} clasificados...`);
            }
        }
    }

    if (updateBatch.length > 0) {
        await flushBatchUpdate(updateBatch, 'tipo_monumento');
    }

    console.log(`Fase B2 completada: ${updated} actualizados, ${skipped} omitidos (reservas naturales, etc.)`);
}

// ============== PHASE C: Period assignment ==============

async function phaseC() {
    console.log('\n=== FASE C: Asignación de periodo ===\n');

    // Sub-phase C1: From wikidata.estilo
    await phaseC1();
    // Sub-phase C2: From wikidata.inception
    await phaseC2();
    // Sub-phase C3: From sipca.periodo_historico / sipca.siglo
    await phaseC3();
    // Sub-phase C4: From text patterns in denominacion/descripcion
    await phaseC4();
    // Sub-phase C5: From tipo_monumento (e.g., Megalítico → Prehistoria)
    await phaseC5();
    // Sub-phase C6: From wikidata.descripcion (broader text search)
    await phaseC6();
}

async function phaseC1() {
    console.log('  C1: Desde wikidata.estilo...');
    const result = await db.query(`
        SELECT b.id, w.estilo
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE b.periodo IS NULL AND w.estilo IS NOT NULL AND w.estilo != ''
        ORDER BY b.id
    `);

    let updated = 0;
    const FLUSH_SIZE = 1000;
    let updateBatch = [];

    for (const item of result.rows) {
        for (const pattern of ESTILO_TO_PERIODO) {
            if (pattern.regex.test(item.estilo)) {
                updateBatch.push({ id: item.id, value: pattern.periodo });
                updated++;
                if (updateBatch.length >= FLUSH_SIZE) {
                    await flushBatchUpdate(updateBatch, 'periodo');
                    updateBatch = [];
                }
                break;
            }
        }
    }
    if (updateBatch.length > 0) await flushBatchUpdate(updateBatch, 'periodo');
    console.log(`    ${updated} actualizados desde estilo`);
}

async function phaseC2() {
    console.log('  C2: Desde wikidata.inception...');
    const result = await db.query(`
        SELECT b.id, w.inception
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE b.periodo IS NULL AND w.inception IS NOT NULL AND w.inception != ''
        ORDER BY b.id
    `);

    let updated = 0;
    const FLUSH_SIZE = 1000;
    let updateBatch = [];

    for (const item of result.rows) {
        const year = parseInceptionYear(item.inception);
        if (year !== null) {
            const periodo = yearToPeriodo(year);
            updateBatch.push({ id: item.id, value: periodo });
            updated++;
            if (updateBatch.length >= FLUSH_SIZE) {
                await flushBatchUpdate(updateBatch, 'periodo');
                updateBatch = [];
            }
        }
    }
    if (updateBatch.length > 0) await flushBatchUpdate(updateBatch, 'periodo');
    console.log(`    ${updated} actualizados desde inception`);
}

async function phaseC3() {
    console.log('  C3: Desde sipca.periodo_historico / sipca.siglo...');
    const result = await db.query(`
        SELECT b.id, s.periodo_historico, s.siglo
        FROM bienes b
        JOIN sipca s ON b.id = s.bien_id
        WHERE b.periodo IS NULL AND (s.periodo_historico IS NOT NULL OR s.siglo IS NOT NULL)
        ORDER BY b.id
    `);

    let updated = 0;
    const FLUSH_SIZE = 1000;
    let updateBatch = [];

    for (const item of result.rows) {
        let periodo = null;

        // Try periodo_historico first
        if (item.periodo_historico) {
            for (const pattern of ESTILO_TO_PERIODO) {
                if (pattern.regex.test(item.periodo_historico)) {
                    periodo = pattern.periodo;
                    break;
                }
            }
        }

        // Fall back to siglo
        if (!periodo && item.siglo) {
            const sigloMatch = item.siglo.match(/([IVXLCDM]+)/i);
            if (sigloMatch) {
                const century = romanToInt(sigloMatch[1].toUpperCase());
                if (century) {
                    const approxYear = (century - 1) * 100 + 50;
                    periodo = yearToPeriodo(approxYear);
                }
            }
        }

        if (periodo) {
            updateBatch.push({ id: item.id, value: periodo });
            updated++;
            if (updateBatch.length >= FLUSH_SIZE) {
                await flushBatchUpdate(updateBatch, 'periodo');
                updateBatch = [];
            }
        }
    }
    if (updateBatch.length > 0) await flushBatchUpdate(updateBatch, 'periodo');
    console.log(`    ${updated} actualizados desde SIPCA`);
}

async function phaseC4() {
    console.log('  C4: Desde patrones de texto en denominación/descripción...');
    const result = await db.query(`
        SELECT b.id, b.denominacion, w.descripcion
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.periodo IS NULL
        ORDER BY b.id
    `);

    const textPeriodoPatterns = [
        { regex: /megalít|dolmen|menhir|neolít|edad\s*del\s*bronce|calcolít|tholos|nuraghe|nuragico|talayót|naviform|prehistór|preistoric/i, periodo: 'Prehistoria' },
        { regex: /roman[oa]?\b|ibéric|fenicio|villa\s*roman[ao]|romain|termas\s*roman|anfiteatro|circo\s*roman|calzada\s*roman|via\s*roman|acquedotto\s*roman|ponte\s*roman|arco\s*roman|etrusc|terme\s*roman|foro\s*roman/i, periodo: 'Antiguo / Romano' },
        { regex: /visigod|prerrománic|mozárabe|asturian|wisigoth|lombard|longobard|carolingi/i, periodo: 'Prerrománico' },
        { regex: /románic[oa]?\b|romanesque|roman\b(?!\s*[ao])/i, periodo: 'Románico' },
        { regex: /gótic[oa]?\b|gothic|gothique|gotico/i, periodo: 'Gótico' },
        { regex: /mudéjar/i, periodo: 'Mudéjar' },
        { regex: /renacent|plateresc|herrerian|renaissance|rinasciment/i, periodo: 'Renacimiento' },
        { regex: /barroc[oa]?\b|churrigueresc|rococó|baroque|rococo/i, periodo: 'Barroco' },
        { regex: /neoclásic|néoclassique|neoclassic/i, periodo: 'Neoclásico' },
        { regex: /modernist|art\s*nouveau|neogótic|liberty|jugendstil|sezession/i, periodo: 'Modernismo' },
        { regex: /art\s*déco|racionalis|brutalis|funcional|contemporáne/i, periodo: 'Contemporáneo' },
    ];

    let updated = 0;
    const FLUSH_SIZE = 1000;
    let updateBatch = [];

    for (const item of result.rows) {
        const text = [item.denominacion, item.descripcion].filter(Boolean).join(' ');
        for (const pattern of textPeriodoPatterns) {
            if (pattern.regex.test(text)) {
                updateBatch.push({ id: item.id, value: pattern.periodo });
                updated++;
                if (updateBatch.length >= FLUSH_SIZE) {
                    await flushBatchUpdate(updateBatch, 'periodo');
                    updateBatch = [];
                }
                break;
            }
        }
    }
    if (updateBatch.length > 0) await flushBatchUpdate(updateBatch, 'periodo');
    console.log(`    ${updated} actualizados desde texto`);
}

async function phaseC5() {
    console.log('  C5: Desde tipo_monumento (inferencia directa)...');
    // Some tipo_monumento values strongly imply a specific period
    let updated = 0;

    for (const [tipo, periodo] of Object.entries(TIPO_TO_PERIODO_DEFAULT)) {
        if (!periodo) continue;
        const result = await db.query(
            'UPDATE bienes SET periodo = $1 WHERE tipo_monumento = $2 AND periodo IS NULL',
            [periodo, tipo]
        );
        const count = result.rowCount || 0;
        updated += count;
        if (count > 0) console.log(`    ${tipo} → ${periodo}: ${count}`);
    }
    console.log(`    ${updated} actualizados desde tipo_monumento`);
}

async function phaseC6() {
    console.log('  C6: Desde wikidata.descripcion (búsqueda amplia)...');
    // For monuments still without periodo, search the wikidata description for period hints
    const result = await db.query(`
        SELECT b.id, w.descripcion
        FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE b.periodo IS NULL AND w.descripcion IS NOT NULL AND w.descripcion != ''
        ORDER BY b.id
    `);

    const descPatterns = [
        { regex: /(?:built|costruit[oa]|constru[íi]d[oa]|bâti|erigid[oa]|fondé|fondat[oa]|edificat[oa]).{0,30}(\d{3,4})/i, extract: true },
        { regex: /(?:du|del|dal|des|de[l]?)\s+([IVXLCDM]+)\s*[eè]?\s*(?:si[eè]cle|siglo|secolo|século)/i, extractRoman: true },
        { regex: /(\d{1,2})(?:th|st|nd|rd)\s*century/i, extractCentury: true },
    ];

    let updated = 0;
    const FLUSH_SIZE = 1000;
    let updateBatch = [];

    for (const item of result.rows) {
        const desc = item.descripcion;
        let periodo = null;

        for (const pattern of descPatterns) {
            const m = desc.match(pattern.regex);
            if (m) {
                if (pattern.extract) {
                    const year = parseInt(m[1]);
                    if (year >= 100 && year <= 2100) periodo = yearToPeriodo(year);
                } else if (pattern.extractRoman) {
                    const century = romanToInt(m[1].toUpperCase());
                    if (century && century >= 1 && century <= 21) {
                        periodo = yearToPeriodo((century - 1) * 100 + 50);
                    }
                } else if (pattern.extractCentury) {
                    const century = parseInt(m[1]);
                    if (century >= 1 && century <= 21) {
                        periodo = yearToPeriodo((century - 1) * 100 + 50);
                    }
                }
                if (periodo) break;
            }
        }

        if (periodo) {
            updateBatch.push({ id: item.id, value: periodo });
            updated++;
            if (updateBatch.length >= FLUSH_SIZE) {
                await flushBatchUpdate(updateBatch, 'periodo');
                updateBatch = [];
            }
        }
    }
    if (updateBatch.length > 0) await flushBatchUpdate(updateBatch, 'periodo');
    console.log(`    ${updated} actualizados desde descripcion wikidata`);
}

// ============== MAIN ==============

async function main() {
    console.log('=== Enriquecimiento de tipo_monumento y periodo (v2) ===');
    console.log(`Inicio: ${new Date().toISOString()}\n`);

    try {
        // Ensure DB connection works
        await db.query('SELECT 1');

        // Count before
        const beforeTipo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE tipo_monumento IS NOT NULL');
        const beforePeriodo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE periodo IS NOT NULL');
        console.log(`Estado inicial:`);
        console.log(`  Con tipo_monumento: ${beforeTipo.rows[0].n}`);
        console.log(`  Con periodo: ${beforePeriodo.rows[0].n}`);

        await phaseA();
        await phaseB();
        await phaseB2();
        await phaseC();

        // Print summary
        console.log('\n=== RESUMEN FINAL ===\n');

        const tipoR = await db.query(`
            SELECT tipo_monumento, COUNT(*) as count
            FROM bienes
            WHERE tipo_monumento IS NOT NULL
            GROUP BY tipo_monumento
            ORDER BY count DESC
        `);
        let totalTipo = 0;
        console.log('Distribución tipo_monumento:');
        for (const row of tipoR.rows) {
            console.log(`  ${row.tipo_monumento}: ${row.count}`);
            totalTipo += parseInt(row.count);
        }

        const sinTipo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE tipo_monumento IS NULL');
        const totalBienes = totalTipo + parseInt(sinTipo.rows[0].n);
        console.log(`  TOTAL clasificados: ${totalTipo} / ${totalBienes} (${(totalTipo/totalBienes*100).toFixed(1)}%)`);
        console.log(`  Sin clasificar: ${sinTipo.rows[0].n}`);

        const periodoR = await db.query(`
            SELECT periodo, COUNT(*) as count
            FROM bienes
            WHERE periodo IS NOT NULL
            GROUP BY periodo
            ORDER BY count DESC
        `);
        let totalPeriodo = 0;
        console.log('\nDistribución periodo:');
        for (const row of periodoR.rows) {
            console.log(`  ${row.periodo}: ${row.count}`);
            totalPeriodo += parseInt(row.count);
        }

        const sinPeriodo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE periodo IS NULL');
        console.log(`  TOTAL con periodo: ${totalPeriodo} / ${totalBienes} (${(totalPeriodo/totalBienes*100).toFixed(1)}%)`);
        console.log(`  Sin periodo: ${sinPeriodo.rows[0].n}`);

        // Improvement
        console.log(`\n--- Mejora ---`);
        console.log(`  tipo_monumento: +${totalTipo - parseInt(beforeTipo.rows[0].n)} nuevos`);
        console.log(`  periodo: +${totalPeriodo - parseInt(beforePeriodo.rows[0].n)} nuevos`);

    } catch (err) {
        console.error('Error fatal:', err);
        process.exit(1);
    } finally {
        await db.cerrar();
        console.log(`\nFin: ${new Date().toISOString()}`);
    }
}

main();
