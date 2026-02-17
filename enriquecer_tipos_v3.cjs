/**
 * enriquecer_tipos_v3.cjs
 * Third enrichment pass:
 *  - More tipo_monumento patterns (accented/unaccented, new keywords, wiki desc, campo tipo directo)
 *  - Parse century references from denominacion/descripcion for periodo
 */
const db = require('./db.cjs');

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
    return result > 0 && result < 30 ? result : null; // sanity: centuries 1-29
}

function centuryToPeriodo(century) {
    if (century <= -8) return 'Prehistoria';
    if (century <= 5) return 'Antiguo / Romano';
    if (century <= 10) return 'Prerrománico';
    if (century <= 13) return 'Románico';
    if (century <= 15) return 'Gótico';
    if (century <= 16) return 'Renacimiento';
    if (century <= 18) return 'Barroco';
    if (century <= 19) return 'Neoclásico';
    if (century <= 20) return 'Modernismo';
    return 'Contemporáneo';
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

// Extract century from text in multiple languages
function extractCentury(text) {
    if (!text) return null;

    // "siglo XII", "segle XII", "século XV"
    let m = text.match(/(?:siglo|segle|século)\s+([IVXLCDM]+)/i);
    if (m) { const c = romanToInt(m[1].toUpperCase()); if (c) return c; }

    // "XIIe siècle", "XIIIe s.", "XIe-XIIe siècle" (take first)
    m = text.match(/([IVXLCDM]+)[eè]\s*(?:siècle|s\.)/i);
    if (m) { const c = romanToInt(m[1].toUpperCase()); if (c) return c; }

    // "XIII secolo", "del XV secolo"
    m = text.match(/([IVXLCDM]+)\s*secolo/i);
    if (m) { const c = romanToInt(m[1].toUpperCase()); if (c) return c; }

    // "12th century", "13th-century"
    m = text.match(/(\d{1,2})(?:st|nd|rd|th)[\s-]*century/i);
    if (m) return parseInt(m[1]);

    // Standalone Roman numerals preceded by "s." or "sec." — "s. XII", "sec. XV"
    m = text.match(/(?:^|[\s(])s(?:ec)?\.?\s*([IVXLCDM]+)\b/i);
    if (m) { const c = romanToInt(m[1].toUpperCase()); if (c) return c; }

    // Year in parentheses or after "de" — "(1723)", "de 1850", careful not to match IDs
    m = text.match(/(?:\(|de\s+|del\s+|año\s+|en\s+|vers\s+|circa\s+|c\.\s*)(\d{3,4})\b/);
    if (m) {
        const year = parseInt(m[1]);
        if (year >= 500 && year <= 2025) return Math.ceil(year / 100);
    }

    return null;
}

const BATCH = 5000;

// ============== FASE 1: More tipo_monumento patterns ==============

async function fase1_tipoDenom() {
    console.log('\n=== FASE 1a: tipo_monumento - patrones ampliados en denominacion ===\n');

    const patterns = [
        // Churches without accent (French)
        { regex: /\beglise\b/i, tipo: 'Iglesia / Ermita' },
        // Italian farmhouses
        { regex: /\bcascina\b|masseria\b|podere\b/i, tipo: 'Arquitectura rural' },
        // French farms
        { regex: /\bferme\b|grange\b/i, tipo: 'Arquitectura rural' },
        // Portuguese estates
        { regex: /\bquinta\b/i, tipo: 'Casa señorial / Mansión' },
        // Sardinian nuraghe
        { regex: /\bnuraghe\b|nuraghi\b/i, tipo: 'Yacimiento arqueológico' },
        // Portuguese pillory
        { regex: /\bpelourinho\b/i, tipo: 'Cruz / Crucero' },
        // Wells
        { regex: /\bpou\b|pozo\b|puits\b|pozzo\b/i, tipo: 'Fuente' },
        // Irrigation
        { regex: /\bacequia\b|sèquia\b|séquia\b|canal\s*(de\s*riego|d['']irrigació)/i, tipo: 'Obra hidráulica' },
        // Rock shelters (archaeological)
        { regex: /\babrigo\b.*rupestre|abrigo\s*rocoso|abri\s*sous\s*roche|pintura\s*rupestre/i, tipo: 'Yacimiento arqueológico' },
        // War memorials
        { regex: /\bcaduti\b|monument\s*aux\s*morts|monumento\s*a\s*los\s*caídos|memorial\s*(de\s*guerra|war)/i, tipo: 'Monumento conmemorativo' },
        // Crosses (broader patterns)
        { regex: /\bcroix\b(?!\s*rouge)|cruzeiro\b|\bcreu\b(?!\s*roja)/i, tipo: 'Cruz / Crucero' },
        // Catalan ovens
        { regex: /\bforn\b|horno\s*(de\s*cal|de\s*pan|de\s*cerámica|communal)|four\s*(à\s*chaux|banal)/i, tipo: 'Patrimonio industrial' },
        // Clocks (not clocktower - that's torre)
        { regex: /\brellotge\s*de\s*sol\b|reloj\s*de\s*sol\b|cadran\s*solaire/i, tipo: 'Arte religioso' },
        // Coats of arms / heraldic
        { regex: /\bescudo\b.*heráldic|escudo\s*nobiliario|blason/i, tipo: 'Arte religioso' },
        // Factories
        { regex: /\bfàbrica\b|\bfábrica\b(?!\s*de\s*(iglesia|la\s*catedral))/i, tipo: 'Patrimonio industrial' },
        // Chapels (broader, capture "cappella" singular)
        { regex: /\bcappella\b|cappelletta\b|edicola\b/i, tipo: 'Iglesia / Ermita' },
        // Fountain/washtrough (broader)
        { regex: /\bfontanella\b|fontanile\b|abbeveratoio\b/i, tipo: 'Fuente' },
        // Italian castles spelled differently
        { regex: /\brocca\b|fortino\b|bastione\b|torre\s*costiera/i, tipo: 'Castillo / Fortaleza' },
        // Bell towers
        { regex: /\bcampanile\b|campanario\b|clocher\b/i, tipo: 'Torre' },
        // Aqueducts/water infrastructure
        { regex: /\baljibe\b|\bcisterna\b|citerne\b/i, tipo: 'Obra hidráulica' },
        // Plazas/squares
        { regex: /\bplaza\s*mayor\b|plaça\s*major\b|piazza\s*(?:del\s*popolo|maggiore|grande|principale)/i, tipo: 'Edificio civil' },
    ];

    let offset = 0;
    let totalUpdated = 0;

    while (true) {
        const result = await db.query(
            "SELECT b.id, b.denominacion FROM bienes b " +
            "WHERE b.tipo_monumento IS NULL " +
            "ORDER BY b.id LIMIT " + BATCH + " OFFSET " + offset
        );
        if (result.rows.length === 0) break;

        for (const item of result.rows) {
            if (!item.denominacion) continue;
            for (const p of patterns) {
                if (p.regex.test(item.denominacion)) {
                    await db.query(
                        'UPDATE bienes SET tipo_monumento = $1 WHERE id = $2 AND tipo_monumento IS NULL',
                        [p.tipo, item.id]
                    );
                    totalUpdated++;
                    break;
                }
            }
        }
        offset += BATCH;
        if (offset % 25000 === 0) console.log('  Procesados ' + offset + ' (' + totalUpdated + ' actualizados)');
    }
    console.log('Fase 1a completada: ' + totalUpdated + ' nuevos');
}

async function fase1b_tipoWikiDesc() {
    console.log('\n=== FASE 1b: tipo_monumento - wiki descripcion patterns ===\n');

    const patterns = [
        { regex: /agropecuarios|piedra\s*en\s*seco|piedra\s*seca|masia\b|masía\b|barraca\s*de|construcciones?\s*rurales?|architettura\s*rurale/i, tipo: 'Arquitectura rural' },
        { regex: /hidráulicas|infraestructura\s*hidr[aá]ulica|presa\b|acueducto|embalse/i, tipo: 'Obra hidráulica' },
        { regex: /industriale?s?\b|fábrica|usine|manifattura|ferrería/i, tipo: 'Patrimonio industrial' },
        { regex: /residencial|vivienda|habitation|abitazione|dwelling/i, tipo: 'Casa señorial / Mansión' },
        { regex: /chiesa|iglesia|church|église|igreja/i, tipo: 'Iglesia / Ermita' },
        { regex: /castello|château(?!\s*d['']eau)|castelo|castle/i, tipo: 'Castillo / Fortaleza' },
        { regex: /palazzo|palais|palace|palácio/i, tipo: 'Palacio' },
        { regex: /torre\b|tower\b|tour\b(?!is)/i, tipo: 'Torre' },
        { regex: /ponte\b|puente|bridge|pont\b/i, tipo: 'Puente' },
        { regex: /fontaine|fuente|fountain|fonte\b|fontana/i, tipo: 'Fuente' },
    ];

    const result = await db.query(
        "SELECT b.id, w.descripcion FROM bienes b " +
        "JOIN wikidata w ON b.id = w.bien_id " +
        "WHERE b.tipo_monumento IS NULL AND w.descripcion IS NOT NULL AND w.descripcion != '' " +
        "ORDER BY b.id"
    );

    let updated = 0;
    for (const item of result.rows) {
        for (const p of patterns) {
            if (p.regex.test(item.descripcion)) {
                await db.query(
                    'UPDATE bienes SET tipo_monumento = $1 WHERE id = $2 AND tipo_monumento IS NULL',
                    [p.tipo, item.id]
                );
                updated++;
                break;
            }
        }
    }
    console.log('Fase 1b completada: ' + updated + ' nuevos');
}

async function fase1c_tipoFromCampoTipo() {
    console.log('\n=== FASE 1c: tipo_monumento - desde campo tipo/categoria ===\n');

    // Direct mappings from the tipo field
    const tipoMappings = [
        { where: "b.tipo = 'Bien inmueble de Etnología'", tipo: 'Arquitectura rural' },
        { where: "b.tipo = 'Obra civil'", tipo: 'Edificio civil' },
        { where: "b.tipo = 'Conjunt arquitectònic'", tipo: 'Conjunto arquitectónico' },
        { where: "b.tipo = 'Element arquitectònic'", tipo: 'Elemento arquitectónico' },
        { where: "b.tipo = 'Monumento' OR b.tipo = 'Inmueble'", tipo: 'Monumento' },
        { where: "b.categoria = 'Etnológica' OR b.categoria = 'Arquitectónica, Etnológica'", tipo: 'Arquitectura rural' },
    ];

    let totalUpdated = 0;
    for (const mapping of tipoMappings) {
        const result = await db.query(
            'UPDATE bienes b SET tipo_monumento = $1 WHERE (' + mapping.where + ') AND b.tipo_monumento IS NULL',
            [mapping.tipo]
        );
        console.log('  ' + mapping.where.substring(0, 60) + '... → ' + mapping.tipo + ': ' + result.rowCount);
        totalUpdated += result.rowCount;
    }
    console.log('Fase 1c completada: ' + totalUpdated + ' nuevos');
}

// ============== FASE 2: periodo from century references ==============

async function fase2_periodoFromCentury() {
    console.log('\n=== FASE 2: periodo - desde referencias a siglo en denominacion ===\n');

    let offset = 0;
    let totalUpdated = 0;

    while (true) {
        const result = await db.query(
            "SELECT b.id, b.denominacion, b.clase FROM bienes b " +
            "WHERE b.periodo IS NULL " +
            "ORDER BY b.id LIMIT " + BATCH + " OFFSET " + offset
        );
        if (result.rows.length === 0) break;

        for (const item of result.rows) {
            const century = extractCentury(item.denominacion);
            if (century) {
                const periodo = centuryToPeriodo(century);
                await db.query(
                    'UPDATE bienes SET periodo = $1 WHERE id = $2 AND periodo IS NULL',
                    [periodo, item.id]
                );
                totalUpdated++;
            }
        }
        offset += BATCH;
        if (offset % 50000 === 0) console.log('  Procesados ' + offset + ' (' + totalUpdated + ' actualizados)');
    }
    console.log('Fase 2 completada: ' + totalUpdated + ' nuevos periodos desde denominacion');
}

async function fase2b_periodoFromWikiDesc() {
    console.log('\n=== FASE 2b: periodo - desde siglo en wiki descripcion ===\n');

    const result = await db.query(
        "SELECT b.id, w.descripcion FROM bienes b " +
        "JOIN wikidata w ON b.id = w.bien_id " +
        "WHERE b.periodo IS NULL AND w.descripcion IS NOT NULL AND w.descripcion != '' " +
        "ORDER BY b.id"
    );

    let updated = 0;
    for (const item of result.rows) {
        const century = extractCentury(item.descripcion);
        if (century) {
            const periodo = centuryToPeriodo(century);
            await db.query(
                'UPDATE bienes SET periodo = $1 WHERE id = $2 AND periodo IS NULL',
                [periodo, item.id]
            );
            updated++;
        }
    }
    console.log('Fase 2b completada: ' + updated + ' nuevos periodos desde wiki desc');
}

async function fase2c_periodoFromYear() {
    console.log('\n=== FASE 2c: periodo - desde año en denominacion (ej: "(1723)") ===\n');

    let offset = 0;
    let totalUpdated = 0;

    // Only match items that have a year-like pattern
    while (true) {
        const result = await db.query(
            "SELECT b.id, b.denominacion FROM bienes b " +
            "WHERE b.periodo IS NULL AND b.denominacion ~ '\\d{3,4}' " +
            "ORDER BY b.id LIMIT " + BATCH + " OFFSET " + offset
        );
        if (result.rows.length === 0) break;

        for (const item of result.rows) {
            // More conservative: only extract years in clear context
            const m = item.denominacion.match(/(?:\(|año\s+|de\s+|del\s+|built\s+|construi[dt][oa]?\s*(?:en\s+)?)(\d{3,4})\b/);
            if (m) {
                const year = parseInt(m[1]);
                if (year >= 800 && year <= 2025) {
                    const periodo = yearToPeriodo(year);
                    await db.query(
                        'UPDATE bienes SET periodo = $1 WHERE id = $2 AND periodo IS NULL',
                        [periodo, item.id]
                    );
                    totalUpdated++;
                }
            }
        }
        offset += BATCH;
    }
    console.log('Fase 2c completada: ' + totalUpdated + ' nuevos periodos desde año en denom');
}

// ============== MAIN ==============

async function main() {
    console.log('=== Enriquecimiento v3 ===');
    console.log('Inicio: ' + new Date().toISOString() + '\n');

    const initTipo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE tipo_monumento IS NOT NULL");
    const initPeriodo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE periodo IS NOT NULL");
    console.log('Estado inicial: tipo_monumento=' + initTipo.rows[0].c + ', periodo=' + initPeriodo.rows[0].c);

    try {
        await fase1_tipoDenom();
        await fase1b_tipoWikiDesc();
        await fase1c_tipoFromCampoTipo();
        await fase2_periodoFromCentury();
        await fase2b_periodoFromWikiDesc();
        await fase2c_periodoFromYear();

        // Summary
        console.log('\n=== RESUMEN FINAL ===\n');

        const tipoR = await db.query(
            "SELECT tipo_monumento, COUNT(*) as count FROM bienes " +
            "WHERE tipo_monumento IS NOT NULL GROUP BY tipo_monumento ORDER BY count DESC"
        );
        console.log('Distribución tipo_monumento:');
        for (const row of tipoR.rows) console.log('  ' + row.tipo_monumento + ': ' + row.count);
        const sinTipo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE tipo_monumento IS NULL');
        console.log('  (sin clasificar): ' + sinTipo.rows[0].n);

        const periodoR = await db.query(
            "SELECT periodo, COUNT(*) as count FROM bienes " +
            "WHERE periodo IS NOT NULL GROUP BY periodo ORDER BY count DESC"
        );
        console.log('\nDistribución periodo:');
        for (const row of periodoR.rows) console.log('  ' + row.periodo + ': ' + row.count);
        const sinPeriodo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE periodo IS NULL');
        console.log('  (sin periodo): ' + sinPeriodo.rows[0].n);

        const finalTipo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE tipo_monumento IS NOT NULL");
        const finalPeriodo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE periodo IS NOT NULL");
        console.log('\nMejora v3: tipo_monumento +' + (finalTipo.rows[0].c - initTipo.rows[0].c) +
                    ', periodo +' + (finalPeriodo.rows[0].c - initPeriodo.rows[0].c));

    } catch (err) {
        console.error('Error fatal:', err);
        process.exit(1);
    } finally {
        await db.cerrar();
        console.log('\nFin: ' + new Date().toISOString());
    }
}

main();
