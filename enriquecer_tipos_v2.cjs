/**
 * enriquecer_tipos_v2.cjs
 * Segunda pasada de enriquecimiento: usa campos locales (tipo, clase, categoria, denominacion, descripcion, estilo)
 * para clasificar los bienes que quedaron sin tipo_monumento y/o periodo.
 *
 * NO hace llamadas SPARQL — todo es local, rápido.
 */
const db = require('./db.cjs');

// ============== TIPO_MONUMENTO: text patterns (expanded) ==============

const TIPO_PATTERNS = [
    // --- Already existing but with more coverage ---
    { regex: /catedral|cathédrale|cattedrale|\bsé\b/i, tipo: 'Catedral' },
    { regex: /monasterio|convento|abadía|cartuja|mosteiro|abbaye|monastère|couvent|abbazia|monastero|priorato|priorat|prieuré/i, tipo: 'Monasterio / Convento' },
    { regex: /basílica|basilique|basilica/i, tipo: 'Iglesia / Ermita' },
    { regex: /iglesia|ermita|parroquia|capilla|église|égli[sz]e|chapelle|chiesa|paróquia|igreja|santuario|sanctuaire|santuário|colegiata|collégiale|oratorio|oratoire|templo|temple/i, tipo: 'Iglesia / Ermita' },
    { regex: /castillo|fortaleza|alcázar|château[\s-]fort|fort\b|forteresse|castello|fortezza|castelo|alcazaba|atalaya|cittadella|cidadela|citadelle/i, tipo: 'Castillo / Fortaleza' },
    { regex: /palacio|palais|palazzo|paço|pazo|palau/i, tipo: 'Palacio' },
    { regex: /torre\b|tour\b(?!is)/i, tipo: 'Torre' },
    { regex: /muralla|rempart|mura\b|muralha|recinto\s*amurallado|cinta\s*muraria|porta\s*(della|di|del)\b/i, tipo: 'Muralla' },
    { regex: /puente|pont\b|ponte\b/i, tipo: 'Puente' },
    { regex: /mezquita|mosquée|moschea|sinagoga|synagogue/i, tipo: 'Mezquita / Sinagoga' },
    { regex: /teatro|théâtre|teatro/i, tipo: 'Teatro' },
    { regex: /dolmen|menhir|cromlech|megalít|tholos|\banta\b|mamoa|túmulo|tumulus/i, tipo: 'Megalítico' },
    { regex: /yacimiento|arqueológic|ruinas?\b|villa\s*romana|castro\b|site\s*archéo|sítio\s*arqueológ|oppidum|excavaci|necrópol|necropoli|nécropole/i, tipo: 'Yacimiento arqueológico' },
    { regex: /acueducto|aqueduc|acquedotto|aqueduto/i, tipo: 'Acueducto' },
    { regex: /fuente\b|fontaine|fontana|fonte\b|lavadero|lavoir|font\b(?!.*francesc|.*bru)/i, tipo: 'Fuente' },
    { regex: /plaza\s*de\s*toros|arènes|arena\b/i, tipo: 'Plaza de toros' },
    { regex: /cementerio|cimetière|cimitero|cemitério|camposanto/i, tipo: 'Cementerio' },
    { regex: /ayuntamiento|hôtel\s*de\s*ville|câmara\s*municipal|palazzo\s*(comunale|del\s*comune)|aduana|lonja|bolsa\b|hospital|hospicio|hôpital|ospedale/i, tipo: 'Edificio civil' },

    // --- New categories ---
    { regex: /\bcreu\s*(de\s*terme|de\s*pedra)|\bcruz\s*(de\s*término|de\s*piedra|procesional)|\bcroix\s*(de\s*chemin|de\s*pierre|de\s*mission)|crucero\b|calvari|calvaire|pilaret/i, tipo: 'Cruz / Crucero' },
    { regex: /molí\b|molino|moulin|mulino|moinho|molí\s*(d['e]|de\s)|aceña|batán/i, tipo: 'Molino' },
    { regex: /\bcasa\s*(consistorial|señorial|solariega|palacio|torre|fuerte|natal|rectoral|abacial|gran|noble|pairal)|casona|casal\b|manor\b|manoir|hôtel\s*(?!de\s*ville)|palazzo\s*(?!comunale|del\s*comune)|mansión|mansion|solar\b.*noble/i, tipo: 'Casa señorial / Mansión' },
    { regex: /barraca\b|caseta\b|corral\b|cortijo|cabana\b|cabaña\b|chozo|bombo\b|refugi\b|palloza|hórreo|horreo|espigueiro|séchoir|granero|graner|mas\s+d[e']/i, tipo: 'Arquitectura rural' },
    { regex: /\bmuseo|musée|museum\b|pinacoteca|galería\s*de\s*arte/i, tipo: 'Museo' },
    { regex: /\bmina\b|mine\b|miniera|horno\s*(alto|de\s*cal)|ferrería|forja|farga|fundición|fábrica\b|usine|usina|chimenea\s*industrial/i, tipo: 'Patrimonio industrial' },
    { regex: /retablo|retaule|reredos|retable/i, tipo: 'Arte religioso' },
    { regex: /faro\b|phare\b|faro\s*(de|del)|lighthouse/i, tipo: 'Faro' },
    { regex: /balneario|termas\b(?!\s*roman)|baños\s*(?!roman)/i, tipo: 'Balneario / Termas' },
];

// ============== PERIODO: style patterns (expanded with IT/FR/PT) ==============

const ESTILO_TO_PERIODO = [
    { regex: /megalít|neolít|edad\s*del\s*bronce|calcolít|néolithique|mégalithique|neolitico|megalítico|preistori|pré-?histor/i, periodo: 'Prehistoria' },
    { regex: /roman[oa]?\b|ibéric|romain[e]?|celti|fenicio|grieg|púnic|tartés|turdetano|lusitano|romano|etrusc/i, periodo: 'Antiguo / Romano' },
    { regex: /visigod|prerrománic|mozárabe|asturian|wisigoth|préroman|preromanico|longobard|paleocristian/i, periodo: 'Prerrománico' },
    { regex: /románic[oa]?\b|romanesque|roman\b(?!o)|romanica|romànic|architecture\s*romane|arquitetura\s*românica|romanico\s*lombardo|arte\s*romanica/i, periodo: 'Románico' },
    { regex: /gótic[oa]?\b|gothic|gothique|flamíger|ogival|gotico|tardo\s*gotico|tardogotico/i, periodo: 'Gótico' },
    { regex: /mudéjar|mudéjare|mudejar/i, periodo: 'Mudéjar' },
    { regex: /renacimiento|renacent|plateresc|herrerian|renaissance|rinasciment|manuelino|maneirismo|manierista|cinquecentesco|cinquecento/i, periodo: 'Renacimiento' },
    { regex: /barroc[oa]?\b|churrigueresc|rococó|baroque|rococo|barocco|architettura\s*barocca/i, periodo: 'Barroco' },
    { regex: /neoclásic[oa]?|néoclassique|neoclassic|neoclassicismo|classicisme|architecture\s*classique|arquitetura\s*neoclássica/i, periodo: 'Neoclásico' },
    { regex: /modernism[eo]?|art\s*nouveau|neogótic|eclectic|modernista|neomudejar|neorrománic|neo-?gótic|jugendstil|liberty|noucentis|historicist|neo-?roman|architettura\s*neogotica|architettura\s*neoromanica/i, periodo: 'Modernismo' },
    { regex: /racionalism|brutalism|contemporáne|funcional|art\s*déco|razionalismo|racionalista|deconstructiv|postmodern/i, periodo: 'Contemporáneo' },
];

// Catalonia clase → periodo mapping
const CLASE_TO_PERIODO = [
    { regex: /\bMedieval\b/i, periodo: 'Gótico' },
    { regex: /\bModern\b/i, periodo: 'Renacimiento' }, // "Modern" in Catalan heritage = Early Modern (XVI-XVIII)
    { regex: /\bModernisme\b/i, periodo: 'Modernismo' },
    { regex: /\bNoucentisme\b/i, periodo: 'Modernismo' },
    { regex: /\bNeoclàssic\b/i, periodo: 'Neoclásico' },
    { regex: /\bEclecticisme\b/i, periodo: 'Modernismo' },
    { regex: /\bRomànic\b/i, periodo: 'Románico' },
    { regex: /\bGòtic\b/i, periodo: 'Gótico' },
    { regex: /\bBarroc\b/i, periodo: 'Barroco' },
    { regex: /\bRenaixement\b/i, periodo: 'Renacimiento' },
    { regex: /\bContemporani\b/i, periodo: 'Contemporáneo' },
    { regex: /\bPopular\b/i, periodo: null }, // Not useful for periodo by itself
];

// Year → periodo
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

function parseInceptionYear(inception) {
    if (!inception) return null;
    const negMatch = inception.match(/^-(\d+)/);
    if (negMatch) return -parseInt(negMatch[1]);
    const yearMatch = inception.match(/(\d{3,4})/);
    if (yearMatch) return parseInt(yearMatch[1]);
    return null;
}

// ============== MAIN PHASES ==============

const BATCH = 5000;

async function phaseTipo() {
    console.log('\n=== FASE 1: tipo_monumento desde texto (patrones ampliados) ===\n');

    let offset = 0;
    let totalUpdated = 0;

    while (true) {
        const result = await db.query(
            "SELECT b.id, b.denominacion, b.tipo, b.clase, b.categoria, b.clase, " +
            "w.descripcion as wiki_desc, w.heritage_label " +
            "FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id " +
            "WHERE b.tipo_monumento IS NULL " +
            "ORDER BY b.id LIMIT " + BATCH + " OFFSET " + offset
        );

        if (result.rows.length === 0) break;

        let batchUpdated = 0;
        for (const item of result.rows) {
            const searchText = [
                item.denominacion,
                item.tipo,
                item.categoria,
                item.clase,
                item.wiki_desc,
                item.heritage_label
            ].filter(Boolean).join(' ');

            let matched = null;
            for (const pattern of TIPO_PATTERNS) {
                if (pattern.regex.test(searchText)) {
                    matched = pattern.tipo;
                    break;
                }
            }

            if (matched) {
                await db.query(
                    'UPDATE bienes SET tipo_monumento = $1 WHERE id = $2 AND tipo_monumento IS NULL',
                    [matched, item.id]
                );
                batchUpdated++;
                totalUpdated++;
            }
        }

        offset += BATCH;
        if (offset % 20000 === 0 || result.rows.length < BATCH) {
            console.log(`  Procesados ${offset} (actualizados: ${totalUpdated})`);
        }
    }

    console.log(`Fase 1 completada: ${totalUpdated} nuevos tipo_monumento`);
}

async function phasePeriodoEstilo() {
    console.log('\n=== FASE 2: periodo desde estilo (patrones ampliados) ===\n');

    const result = await db.query(
        "SELECT b.id, w.estilo FROM bienes b " +
        "JOIN wikidata w ON b.id = w.bien_id " +
        "WHERE b.periodo IS NULL AND w.estilo IS NOT NULL AND w.estilo != '' " +
        "ORDER BY b.id"
    );

    let updated = 0;
    for (const item of result.rows) {
        for (const pattern of ESTILO_TO_PERIODO) {
            if (pattern.regex.test(item.estilo)) {
                await db.query(
                    'UPDATE bienes SET periodo = $1 WHERE id = $2 AND periodo IS NULL',
                    [pattern.periodo, item.id]
                );
                updated++;
                break;
            }
        }
    }
    console.log(`Fase 2 completada: ${updated} periodos desde estilo`);
}

async function phasePeriodoClase() {
    console.log('\n=== FASE 3: periodo desde campo clase (Catalunya) ===\n');

    const result = await db.query(
        "SELECT b.id, b.clase FROM bienes b " +
        "WHERE b.periodo IS NULL AND b.clase IS NOT NULL AND b.clase != '' " +
        "ORDER BY b.id"
    );

    let updated = 0;
    for (const item of result.rows) {
        // Split by | and pick the most specific period (not Popular/Contemporani alone)
        const parts = item.clase.split('|').map(s => s.trim());

        let bestPeriodo = null;
        let bestPriority = 999;

        // Priority: prefer more specific/older periods
        const priorityMap = {
            'Románico': 1, 'Gótico': 2, 'Mudéjar': 3, 'Renacimiento': 4,
            'Barroco': 5, 'Neoclásico': 6, 'Modernismo': 7, 'Contemporáneo': 8
        };

        for (const part of parts) {
            for (const pattern of CLASE_TO_PERIODO) {
                if (pattern.periodo && pattern.regex.test(part)) {
                    const prio = priorityMap[pattern.periodo] || 99;
                    if (prio < bestPriority) {
                        bestPriority = prio;
                        bestPeriodo = pattern.periodo;
                    }
                    break;
                }
            }
        }

        if (bestPeriodo) {
            await db.query(
                'UPDATE bienes SET periodo = $1 WHERE id = $2 AND periodo IS NULL',
                [bestPeriodo, item.id]
            );
            updated++;
        }
    }
    console.log(`Fase 3 completada: ${updated} periodos desde clase`);
}

async function phasePeriodoInception() {
    console.log('\n=== FASE 4: periodo desde inception ===\n');

    const result = await db.query(
        "SELECT b.id, w.inception FROM bienes b " +
        "JOIN wikidata w ON b.id = w.bien_id " +
        "WHERE b.periodo IS NULL AND w.inception IS NOT NULL AND w.inception != '' " +
        "ORDER BY b.id"
    );

    let updated = 0;
    for (const item of result.rows) {
        const year = parseInceptionYear(item.inception);
        if (year !== null) {
            const periodo = yearToPeriodo(year);
            await db.query(
                'UPDATE bienes SET periodo = $1 WHERE id = $2 AND periodo IS NULL',
                [periodo, item.id]
            );
            updated++;
        }
    }
    console.log(`Fase 4 completada: ${updated} periodos desde inception`);
}

async function phasePeriodoTexto() {
    console.log('\n=== FASE 5: periodo desde texto denominacion/descripcion ===\n');

    const textPeriodoPatterns = [
        { regex: /megalít|dolmen|menhir|neolít|edad\s*del\s*bronce|calcolít|tholos|preistori|pré-?histor/i, periodo: 'Prehistoria' },
        { regex: /roman[oa]?\b|ibéric|fenicio|villa\s*romana|romain|termas\s*romanas|anfiteatro|circo\s*romano|calzada\s*romana|via\s*romana/i, periodo: 'Antiguo / Romano' },
        { regex: /visigod|prerrománic|mozárabe|asturian|paleocristian/i, periodo: 'Prerrománico' },
        { regex: /románic[oa]?\b|romanesque|romànic|romanico/i, periodo: 'Románico' },
        { regex: /gótic[oa]?\b|gothic|gòtic|gotico/i, periodo: 'Gótico' },
        { regex: /mudéjar/i, periodo: 'Mudéjar' },
        { regex: /renacent|plateresc|herrerian|manuelino|maneirismo/i, periodo: 'Renacimiento' },
        { regex: /barroc[oa]?\b|churrigueresc|rococó|barocco/i, periodo: 'Barroco' },
        { regex: /neoclásic|neoclassic/i, periodo: 'Neoclásico' },
        { regex: /modernist|art\s*nouveau|neogótic|noucentis/i, periodo: 'Modernismo' },
    ];

    let offset = 0;
    let totalUpdated = 0;

    while (true) {
        const result = await db.query(
            "SELECT b.id, b.denominacion, w.descripcion FROM bienes b " +
            "LEFT JOIN wikidata w ON b.id = w.bien_id " +
            "WHERE b.periodo IS NULL " +
            "ORDER BY b.id LIMIT " + BATCH + " OFFSET " + offset
        );

        if (result.rows.length === 0) break;

        for (const item of result.rows) {
            const text = [item.denominacion, item.descripcion].filter(Boolean).join(' ');
            for (const pattern of textPeriodoPatterns) {
                if (pattern.regex.test(text)) {
                    await db.query(
                        'UPDATE bienes SET periodo = $1 WHERE id = $2 AND periodo IS NULL',
                        [pattern.periodo, item.id]
                    );
                    totalUpdated++;
                    break;
                }
            }
        }

        offset += BATCH;
        if (offset % 50000 === 0 || result.rows.length < BATCH) {
            console.log(`  Procesados ${offset} (actualizados: ${totalUpdated})`);
        }
    }
    console.log(`Fase 5 completada: ${totalUpdated} periodos desde texto`);
}

async function phasePeriodoFromTipo() {
    console.log('\n=== FASE 6: periodo desde tipo_monumento (heurístico) ===\n');

    // Some monument types strongly correlate with periods
    const tipoToPeriodo = [
        { tipo: 'Megalítico', periodo: 'Prehistoria' },
        // Yacimiento arqueológico is too varied to assign a single period
    ];

    let updated = 0;
    for (const mapping of tipoToPeriodo) {
        const result = await db.query(
            'UPDATE bienes SET periodo = $1 WHERE tipo_monumento = $2 AND periodo IS NULL',
            [mapping.periodo, mapping.tipo]
        );
        updated += result.rowCount;
        console.log(`  ${mapping.tipo} → ${mapping.periodo}: ${result.rowCount}`);
    }
    console.log(`Fase 6 completada: ${updated} periodos desde tipo_monumento`);
}

// ============== MAIN ==============

async function main() {
    console.log('=== Enriquecimiento v2 (fuentes locales) ===');
    console.log(`Inicio: ${new Date().toISOString()}\n`);

    // Initial counts
    const initTipo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE tipo_monumento IS NOT NULL");
    const initPeriodo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE periodo IS NOT NULL");
    console.log(`Estado inicial: tipo_monumento=${initTipo.rows[0].c}, periodo=${initPeriodo.rows[0].c}`);

    try {
        await phaseTipo();
        await phasePeriodoEstilo();
        await phasePeriodoClase();
        await phasePeriodoInception();
        await phasePeriodoTexto();
        await phasePeriodoFromTipo();

        // Final summary
        console.log('\n=== RESUMEN FINAL ===\n');

        const tipoR = await db.query(
            "SELECT tipo_monumento, COUNT(*) as count FROM bienes " +
            "WHERE tipo_monumento IS NOT NULL GROUP BY tipo_monumento ORDER BY count DESC"
        );
        console.log('Distribución tipo_monumento:');
        for (const row of tipoR.rows) console.log(`  ${row.tipo_monumento}: ${row.count}`);

        const sinTipo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE tipo_monumento IS NULL');
        console.log(`  (sin clasificar): ${sinTipo.rows[0].n}`);

        const periodoR = await db.query(
            "SELECT periodo, COUNT(*) as count FROM bienes " +
            "WHERE periodo IS NOT NULL GROUP BY periodo ORDER BY count DESC"
        );
        console.log('\nDistribución periodo:');
        for (const row of periodoR.rows) console.log(`  ${row.periodo}: ${row.count}`);

        const sinPeriodo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE periodo IS NULL');
        console.log(`  (sin periodo): ${sinPeriodo.rows[0].n}`);

        // Delta
        const finalTipo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE tipo_monumento IS NOT NULL");
        const finalPeriodo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE periodo IS NOT NULL");
        console.log(`\nMejora: tipo_monumento +${finalTipo.rows[0].c - initTipo.rows[0].c}, periodo +${finalPeriodo.rows[0].c - initPeriodo.rows[0].c}`);

    } catch (err) {
        console.error('Error fatal:', err);
        process.exit(1);
    } finally {
        await db.cerrar();
        console.log(`\nFin: ${new Date().toISOString()}`);
    }
}

main();
