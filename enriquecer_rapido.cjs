/**
 * enriquecer_rapido.cjs
 * Versión rápida: solo ejecuta Fase B (texto), B2 (categoría) y C (periodo)
 * Salta la Fase A (SPARQL) que es muy lenta.
 * Usar cuando ya se ha ejecutado la Fase A previamente.
 */
const db = require('./db.cjs');

// Importar todo el script principal para reutilizar las funciones
// Pero como son módulos CJS, directamente copiamos la lógica necesaria

// ============== HELPERS ==============

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
    const sigloMatch = inception.match(/(?:siglo|century|siècle|secolo)\s+([IVXLCDM]+)/i);
    if (sigloMatch) {
        const val = romanToInt(sigloMatch[1].toUpperCase());
        if (val) return (val - 1) * 100 + 50;
    }
    const romanAlone = inception.match(/^([IVXLCDM]+)(?:\s|$|-)/);
    if (romanAlone) {
        const val = romanToInt(romanAlone[1]);
        if (val && val >= 1 && val <= 21) return (val - 1) * 100 + 50;
    }
    const yearMatch = inception.match(/(\d{3,4})/);
    if (yearMatch) return parseInt(yearMatch[1]);
    return null;
}

async function flushBatchUpdate(batch, column) {
    if (batch.length === 0) return;
    const ids = batch.map(b => b.id);
    const cases = batch.map(b => `WHEN ${b.id} THEN '${(b.value || '').replace(/'/g, "''")}'`).join(' ');
    await db.query(`
        UPDATE bienes SET ${column} = CASE id ${cases} END
        WHERE id = ANY($1) AND ${column} IS NULL
    `, [ids]);
}

// ============== TEXT PATTERNS (expanded) ==============

const TEXT_PATTERNS = [
    { regex: /catedral|cathédrale|cattedrale|duomo\b/i, tipo: 'Catedral' },
    { regex: /monasterio|convento|abadía|cartuja|mosteiro|abbaye|monastère|couvent|abbazia|monastero|priorato|priorat|prioré|certosa|chartreux/i, tipo: 'Monasterio / Convento' },
    { regex: /basílica|basilique|basilica/i, tipo: 'Iglesia / Ermita' },
    { regex: /iglesia|ermita|parroquia|capilla|église|chapelle|chiesa|paróquia|igreja|santuario|sanctuaire|santuário|colegiata|collégiale|pieve|piève|oratorio|oratoire|oratório/i, tipo: 'Iglesia / Ermita' },
    { regex: /ermida|capella\b|capela\b|eliza\b/i, tipo: 'Iglesia / Ermita' },
    { regex: /castillo|fortaleza|alcázar|château[\s-]fort|forteresse|castello|fortezza|castelo|alcazaba|atalaya|kastellu/i, tipo: 'Castillo / Fortaleza' },
    { regex: /\bfort\b|fortín|fortino|fortin\b|blocao|blockhaus|bastión|bastione|baluarte/i, tipo: 'Castillo / Fortaleza' },
    { regex: /rocca\b|ciutadella|ciudadela|citadelle|cittadella/i, tipo: 'Castillo / Fortaleza' },
    { regex: /palacio|palais|palazzo\b|paço|pazo|palacete/i, tipo: 'Palacio' },
    { regex: /torre\b|tour\b(?!\s*(de\s+)?france)/i, tipo: 'Torre' },
    { regex: /muralla|rempart|mura\b(?!no|les)|muralha|recinto\s*amurallado|enceinte|fortification|cinta\s*mur/i, tipo: 'Muralla' },
    { regex: /puente|pont\b|ponte\b/i, tipo: 'Puente' },
    { regex: /mezquita|mosquée|moschea|sinagoga|synagogue/i, tipo: 'Mezquita / Sinagoga' },
    { regex: /teatro\b|théâtre|theater\b/i, tipo: 'Teatro' },
    { regex: /museo\b|musée|museum\b/i, tipo: 'Museo' },
    { regex: /dolmen|menhir|cromlech|megalít|tholos|anta\b|mamoa|taula\b|talayot|naveta\b/i, tipo: 'Megalítico' },
    { regex: /nuraghe|nuraxi|nuragh/i, tipo: 'Yacimiento arqueológico' },
    { regex: /yacimiento|arqueológic|ruinas?\b|villa\s*roman[ao]|castro\b|site\s*archéo|sítio\s*arqueológ|oppidum|excavaci|necróp|necrópole|grotta\s*preistor/i, tipo: 'Yacimiento arqueológico' },
    { regex: /cueva\b|cova\b|grotte\b|grotta\b|abrigo\s*rupestre|abri\s*sous|riparo\b|coveta\b/i, tipo: 'Yacimiento arqueológico' },
    { regex: /acueducto|aqueduc|acquedotto|aqueduto/i, tipo: 'Acueducto' },
    { regex: /fuente\b|fontaine\b|fontana\b|fonte\b|chafariz|lavadero|lavoir|lavatoio|bealera/i, tipo: 'Fuente' },
    { regex: /faro\b|phare\b|farol\b|lighthouse/i, tipo: 'Faro' },
    { regex: /plaza\s*de\s*toros|arènes\b/i, tipo: 'Plaza de toros' },
    { regex: /crucero\b|cruz\b(?!\s*roja)|croix\b|cruzeiro\b|creu\b|croce\b|calvario|calvaire|cruceiro/i, tipo: 'Cruz / Crucero' },
    { regex: /monumento\s*(conmemorat|a\s*los\s*caídos|ai\s*caduti|aux\s*morts)|memorial\b|obelisco|estatua|monument\s*aux/i, tipo: 'Monumento conmemorativo' },
    { regex: /acequia|canal\b|presa\b|azud|noria\b|molino\s*de\s*agua|embalse|pantano\b|barrage|diga\b/i, tipo: 'Obra hidráulica' },
    { regex: /molino|moulin|mulino|moinho|molí\b/i, tipo: 'Molino' },
    { regex: /fábrica|usine|fabbrica|forno\b|horno\b|four\b|ferrería|forja|forge\b|fucina|mina\b|mine\b|miniera|cantera|carrière|cava\b/i, tipo: 'Patrimonio industrial' },
    { regex: /estación\b|estação\b|gare\b|stazione\b/i, tipo: 'Patrimonio industrial' },
    { regex: /masía|masia\b|mas\b(?=\s+d[e'])|cortijo|hórreo|horreo|palloza|barraca\b|borda\b|cabaña\b|refugio\s*(?:de\s*pastor|pastoril)/i, tipo: 'Arquitectura rural' },
    { regex: /cascina|casale\b|masseria|trullo|dammuso|borgo\s*rural/i, tipo: 'Arquitectura rural' },
    { regex: /pigeonnier|palomar|colombier|colombaia|pombal\b/i, tipo: 'Arquitectura rural' },
    { regex: /ayuntamiento|hôtel\s*de\s*ville|câmara\s*municipal|palazzo\s*comunale|mairie|municipio\b|ajuntament/i, tipo: 'Edificio civil' },
    { regex: /aduana|lonja|bolsa\b|bourse\b|borsa\b/i, tipo: 'Edificio civil' },
    { regex: /hospital\b|hospicio|hôpital|ospedale|hospedería/i, tipo: 'Edificio civil' },
    { regex: /escuela|colegio|collège|scuola|escola|universidad|université|università|seminari/i, tipo: 'Edificio civil' },
    { regex: /cárcel|prisión|prison\b|prigione|cadeia/i, tipo: 'Edificio civil' },
    { regex: /mercado\b|marché\b|mercato\b|halle\b|halles\b/i, tipo: 'Edificio civil' },
    { regex: /biblioteca\b|bibliothèque|biblioteca/i, tipo: 'Edificio civil' },
    { regex: /cementerio|cimetière|cimitero|cemitério/i, tipo: 'Cementerio' },
    { regex: /casa\s*(señorial|solariega|palacio|nobiliaria|torre|forte|grande|natal)|manor|manoir|palazzo\s*(nobil|signor)|solar\b|château\b(?![\s-]fort)/i, tipo: 'Casa señorial / Mansión' },
    { regex: /villa\b(?!\s*(roman|grec|ibér|romain))/i, tipo: 'Casa señorial / Mansión' },
    { regex: /\bcasa\b|maison\b|immeuble\b|vivienda|habitatge|edifício|edificio\b|hôtel\b(?!\s*de\s*ville)|logis\b|demeure\b/i, tipo: 'Edificio civil' },
];

const CATEGORIA_FALLBACKS = [
    { regex: /etnol[oó]g/i, tipo: 'Arquitectura rural' },
    { regex: /obra\s*civil/i, tipo: 'Edificio civil' },
    { regex: /arqueol[oó]g/i, tipo: 'Yacimiento arqueológico' },
    { regex: /militar/i, tipo: 'Castillo / Fortaleza' },
    { regex: /religio/i, tipo: 'Iglesia / Ermita' },
    { regex: /zona\s*speciale|sito\s*di\s*interesse|zona\s*di\s*protez/i, tipo: null },
    { regex: /patrimonio\s*dell.*umanit|patrimonio\s*mundial|Património\s*Mundial/i, tipo: null },
];

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

const TIPO_TO_PERIODO_DEFAULT = {
    'Megalítico': 'Prehistoria',
};

// ============== PHASES ==============

async function phaseB() {
    console.log('\n=== FASE B: Clasificación por texto (ampliada) ===\n');
    const result = await db.query(`
        SELECT b.id, b.denominacion, b.tipo, b.clase, w.descripcion as wiki_desc
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.tipo_monumento IS NULL
        ORDER BY b.id
    `);
    const items = result.rows;
    console.log(`Items sin tipo_monumento: ${items.length}`);

    let updated = 0;
    const FLUSH_SIZE = 1000;
    let batch = [];

    for (const item of items) {
        const text = [item.denominacion, item.tipo, item.clase, item.wiki_desc].filter(Boolean).join(' ');
        let matched = null;
        for (const p of TEXT_PATTERNS) {
            if (p.regex.test(text)) { matched = p.tipo; break; }
        }
        if (matched) {
            batch.push({ id: item.id, value: matched });
            updated++;
            if (batch.length >= FLUSH_SIZE) {
                await flushBatchUpdate(batch, 'tipo_monumento');
                batch = [];
                console.log(`  Progreso: ${updated} clasificados...`);
            }
        }
    }
    if (batch.length > 0) await flushBatchUpdate(batch, 'tipo_monumento');
    console.log(`Fase B completada: ${updated} actualizados`);
}

async function phaseB2() {
    console.log('\n=== FASE B2: Clasificación por categoría/tipo (fallback) ===\n');
    const result = await db.query(`
        SELECT b.id, b.categoria, b.tipo FROM bienes b WHERE b.tipo_monumento IS NULL ORDER BY b.id
    `);
    const items = result.rows;
    console.log(`Items restantes sin tipo_monumento: ${items.length}`);

    let updated = 0, skipped = 0;
    const FLUSH_SIZE = 1000;
    let batch = [];

    for (const item of items) {
        const catTipo = [item.categoria, item.tipo].filter(Boolean).join(' ');
        if (!catTipo) continue;
        let matched = undefined;
        for (const fb of CATEGORIA_FALLBACKS) {
            if (fb.regex.test(catTipo)) { matched = fb.tipo; break; }
        }
        if (matched === null) { skipped++; continue; }
        if (matched) {
            batch.push({ id: item.id, value: matched });
            updated++;
            if (batch.length >= FLUSH_SIZE) {
                await flushBatchUpdate(batch, 'tipo_monumento');
                batch = [];
                console.log(`  Progreso: ${updated} clasificados...`);
            }
        }
    }
    if (batch.length > 0) await flushBatchUpdate(batch, 'tipo_monumento');
    console.log(`Fase B2 completada: ${updated} actualizados, ${skipped} omitidos`);
}

async function phaseC1() {
    console.log('  C1: Desde wikidata.estilo...');
    const result = await db.query(`
        SELECT b.id, w.estilo FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE b.periodo IS NULL AND w.estilo IS NOT NULL AND w.estilo != ''
    `);
    let updated = 0;
    let batch = [];
    for (const item of result.rows) {
        for (const p of ESTILO_TO_PERIODO) {
            if (p.regex.test(item.estilo)) {
                batch.push({ id: item.id, value: p.periodo });
                updated++;
                if (batch.length >= 1000) { await flushBatchUpdate(batch, 'periodo'); batch = []; }
                break;
            }
        }
    }
    if (batch.length > 0) await flushBatchUpdate(batch, 'periodo');
    console.log(`    ${updated} actualizados desde estilo`);
}

async function phaseC2() {
    console.log('  C2: Desde wikidata.inception...');
    const result = await db.query(`
        SELECT b.id, w.inception FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE b.periodo IS NULL AND w.inception IS NOT NULL AND w.inception != ''
    `);
    let updated = 0;
    let batch = [];
    for (const item of result.rows) {
        const year = parseInceptionYear(item.inception);
        if (year !== null) {
            batch.push({ id: item.id, value: yearToPeriodo(year) });
            updated++;
            if (batch.length >= 1000) { await flushBatchUpdate(batch, 'periodo'); batch = []; }
        }
    }
    if (batch.length > 0) await flushBatchUpdate(batch, 'periodo');
    console.log(`    ${updated} actualizados desde inception`);
}

async function phaseC3() {
    console.log('  C3: Desde sipca...');
    const result = await db.query(`
        SELECT b.id, s.periodo_historico, s.siglo FROM bienes b
        JOIN sipca s ON b.id = s.bien_id
        WHERE b.periodo IS NULL AND (s.periodo_historico IS NOT NULL OR s.siglo IS NOT NULL)
    `);
    let updated = 0;
    let batch = [];
    for (const item of result.rows) {
        let periodo = null;
        if (item.periodo_historico) {
            for (const p of ESTILO_TO_PERIODO) {
                if (p.regex.test(item.periodo_historico)) { periodo = p.periodo; break; }
            }
        }
        if (!periodo && item.siglo) {
            const m = item.siglo.match(/([IVXLCDM]+)/i);
            if (m) {
                const c = romanToInt(m[1].toUpperCase());
                if (c) periodo = yearToPeriodo((c - 1) * 100 + 50);
            }
        }
        if (periodo) {
            batch.push({ id: item.id, value: periodo });
            updated++;
            if (batch.length >= 1000) { await flushBatchUpdate(batch, 'periodo'); batch = []; }
        }
    }
    if (batch.length > 0) await flushBatchUpdate(batch, 'periodo');
    console.log(`    ${updated} actualizados desde SIPCA`);
}

async function phaseC4() {
    console.log('  C4: Desde texto en denominación/descripción...');
    const result = await db.query(`
        SELECT b.id, b.denominacion, w.descripcion FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.periodo IS NULL
    `);
    const patterns = [
        { regex: /megalít|dolmen|menhir|neolít|edad\s*del\s*bronce|calcolít|tholos|nuraghe|nuragico|talayót|naviform|prehistór|preistoric/i, periodo: 'Prehistoria' },
        { regex: /roman[oa]?\b|ibéric|fenicio|villa\s*roman[ao]|romain|termas\s*roman|anfiteatro|circo\s*roman|calzada\s*roman|via\s*roman|etrusc|terme\s*roman|foro\s*roman/i, periodo: 'Antiguo / Romano' },
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
    let batch = [];
    for (const item of result.rows) {
        const text = [item.denominacion, item.descripcion].filter(Boolean).join(' ');
        for (const p of patterns) {
            if (p.regex.test(text)) {
                batch.push({ id: item.id, value: p.periodo });
                updated++;
                if (batch.length >= 1000) { await flushBatchUpdate(batch, 'periodo'); batch = []; }
                break;
            }
        }
    }
    if (batch.length > 0) await flushBatchUpdate(batch, 'periodo');
    console.log(`    ${updated} actualizados desde texto`);
}

async function phaseC5() {
    console.log('  C5: Desde tipo_monumento...');
    let updated = 0;
    for (const [tipo, periodo] of Object.entries(TIPO_TO_PERIODO_DEFAULT)) {
        if (!periodo) continue;
        const r = await db.query('UPDATE bienes SET periodo = $1 WHERE tipo_monumento = $2 AND periodo IS NULL', [periodo, tipo]);
        updated += r.rowCount || 0;
        if (r.rowCount > 0) console.log(`    ${tipo} → ${periodo}: ${r.rowCount}`);
    }
    console.log(`    ${updated} actualizados`);
}

async function phaseC6() {
    console.log('  C6: Desde wikidata.descripcion (búsqueda amplia)...');
    const result = await db.query(`
        SELECT b.id, w.descripcion FROM bienes b
        JOIN wikidata w ON b.id = w.bien_id
        WHERE b.periodo IS NULL AND w.descripcion IS NOT NULL AND w.descripcion != ''
    `);
    const descPatterns = [
        { regex: /(?:built|costruit[oa]|constru[íi]d[oa]|bâti|erigid[oa]|fondé|fondat[oa]|edificat[oa]).{0,30}(\d{3,4})/i, extract: true },
        { regex: /(?:du|del|dal|des|de[l]?)\s+([IVXLCDM]+)\s*[eè]?\s*(?:si[eè]cle|siglo|secolo|século)/i, extractRoman: true },
        { regex: /(\d{1,2})(?:th|st|nd|rd)\s*century/i, extractCentury: true },
    ];
    let updated = 0;
    let batch = [];
    for (const item of result.rows) {
        let periodo = null;
        for (const p of descPatterns) {
            const m = item.descripcion.match(p.regex);
            if (m) {
                if (p.extract) {
                    const y = parseInt(m[1]);
                    if (y >= 100 && y <= 2100) periodo = yearToPeriodo(y);
                } else if (p.extractRoman) {
                    const c = romanToInt(m[1].toUpperCase());
                    if (c && c >= 1 && c <= 21) periodo = yearToPeriodo((c - 1) * 100 + 50);
                } else if (p.extractCentury) {
                    const c = parseInt(m[1]);
                    if (c >= 1 && c <= 21) periodo = yearToPeriodo((c - 1) * 100 + 50);
                }
                if (periodo) break;
            }
        }
        if (periodo) {
            batch.push({ id: item.id, value: periodo });
            updated++;
            if (batch.length >= 1000) { await flushBatchUpdate(batch, 'periodo'); batch = []; }
        }
    }
    if (batch.length > 0) await flushBatchUpdate(batch, 'periodo');
    console.log(`    ${updated} actualizados desde descripcion`);
}

// ============== MAIN ==============

async function main() {
    console.log('=== Enriquecimiento rápido (sin SPARQL) ===');
    console.log(`Inicio: ${new Date().toISOString()}\n`);

    try {
        await db.query('SELECT 1');

        const beforeTipo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE tipo_monumento IS NOT NULL');
        const beforePeriodo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE periodo IS NOT NULL');
        console.log(`Estado inicial:`);
        console.log(`  Con tipo_monumento: ${beforeTipo.rows[0].n}`);
        console.log(`  Con periodo: ${beforePeriodo.rows[0].n}`);

        await phaseB();
        await phaseB2();

        console.log('\n=== FASE C: Asignación de periodo ===\n');
        await phaseC1();
        await phaseC2();
        await phaseC3();
        await phaseC4();
        await phaseC5();
        await phaseC6();

        // Summary
        console.log('\n=== RESUMEN FINAL ===\n');

        const tipoR = await db.query(`
            SELECT tipo_monumento, COUNT(*) as count FROM bienes
            WHERE tipo_monumento IS NOT NULL GROUP BY tipo_monumento ORDER BY count DESC
        `);
        let totalTipo = 0;
        console.log('Distribución tipo_monumento:');
        for (const row of tipoR.rows) {
            console.log(`  ${row.tipo_monumento}: ${row.count}`);
            totalTipo += parseInt(row.count);
        }
        const sinTipo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE tipo_monumento IS NULL');
        const totalBienes = totalTipo + parseInt(sinTipo.rows[0].n);
        console.log(`  TOTAL: ${totalTipo} / ${totalBienes} (${(totalTipo/totalBienes*100).toFixed(1)}%)`);
        console.log(`  Sin clasificar: ${sinTipo.rows[0].n}`);

        const periodoR = await db.query(`
            SELECT periodo, COUNT(*) as count FROM bienes
            WHERE periodo IS NOT NULL GROUP BY periodo ORDER BY count DESC
        `);
        let totalPeriodo = 0;
        console.log('\nDistribución periodo:');
        for (const row of periodoR.rows) {
            console.log(`  ${row.periodo}: ${row.count}`);
            totalPeriodo += parseInt(row.count);
        }
        const sinPeriodo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE periodo IS NULL');
        console.log(`  TOTAL: ${totalPeriodo} / ${totalBienes} (${(totalPeriodo/totalBienes*100).toFixed(1)}%)`);
        console.log(`  Sin periodo: ${sinPeriodo.rows[0].n}`);

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
