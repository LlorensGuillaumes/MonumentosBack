/**
 * _reclasificar_tipos.cjs
 *
 * Revisa tipo_monumento mal asignado:
 * Para cada item, reclasifica basándose estrictamente en denominacion
 * (y como fallback en tipo/clase/wiki_desc) usando reglas más restrictivas.
 *
 * Uso:
 *   node _reclasificar_tipos.cjs                 # dry-run (no escribe, solo lista)
 *   node _reclasificar_tipos.cjs --apply         # aplica los cambios
 *   node _reclasificar_tipos.cjs --solo Castillo # solo revisa un tipo concreto
 */

const db = require('./db.cjs');

const DRY_RUN = !process.argv.includes('--apply');
const soloIdx = process.argv.indexOf('--solo');
const SOLO_TIPO = soloIdx !== -1 ? process.argv[soloIdx + 1] : null;

// Reglas estrictas por denominación (más restrictivas que las originales).
// Orden importa: primera coincidencia gana.
const STRICT_PATTERNS = [
    // ========= RELIGIOSO =========
    { regex: /\b(catedral|cathédrale|cattedrale|catedral)\b/i, tipo: 'Catedral' },
    { regex: /\bbas[íi]lica\b|basilique|basilica/i, tipo: 'Iglesia / Ermita' },
    { regex: /\b(iglesia|ermita|parroquia|capilla|église|chapelle|chiesa|paróquia|igreja|santuario|sanctuaire|santuário|colegiata|collégiale|pieve|oratorio|oratoire|oratório|ermida|església|capella|capela|eliza)\b/i, tipo: 'Iglesia / Ermita' },
    { regex: /\b(monasterio|convento|abadía|abadia|abbaye|abbazia|mosteiro|cartuja|chartreuse|certosa)\b/i, tipo: 'Monasterio / Convento' },
    { regex: /\b(mezquita|mosquée|moschea|sinagoga|synagogue)\b/i, tipo: 'Mezquita / Sinagoga' },
    { regex: /\b(crucero|cruz\s+(?:de|del)|calvari|calvaire|calvario|peirón)\b/i, tipo: 'Cruz / Crucero' },

    // ========= MILITAR (estricto) =========
    { regex: /\b(castillo|castell|château(?:[\s-]fort)?|castello|castelo|alcázar|alcazaba|alcàsser|fortaleza|forteresse|fortezza|kasteel)\b/i, tipo: 'Castillo / Fortaleza' },
    { regex: /\b(atalaya|fortín|fortino|ciudadela|ciutadella|citadelle|cittadella|rocca|alcazar)\b/i, tipo: 'Castillo / Fortaleza' },
    { regex: /\bfort\b(?!\s*(?:de|della|du))/i, tipo: 'Castillo / Fortaleza' },
    { regex: /\b(torre\s+(?:de|del|vigía|defensiva|militar)|tour\s+(?:de|du|militaire)|torre\b)/i, tipo: 'Torre' },
    { regex: /\b(muralla|murallas|rempart|remparts|mura|muralha|recinto\s+amurallado|enceinte)\b/i, tipo: 'Muralla' },

    // ========= CIVIL =========
    { regex: /\b(palacio|palais|palazzo|paço|pazo|palacete)\b/i, tipo: 'Palacio' },
    { regex: /\b(ayuntamiento|ajuntament|hôtel\s+de\s+ville|câmara\s+municipal|palazzo\s+comunale|mairie|municipio)\b/i, tipo: 'Edificio civil' },
    { regex: /\b(hospital|hospicio|hôpital|ospedale|hospedería)\b/i, tipo: 'Edificio civil' },
    { regex: /\b(escuela|colegio|collège|scuola|escola|universidad|université|università|seminari)\b/i, tipo: 'Edificio civil' },
    { regex: /\b(teatro|théâtre|teatre)\b/i, tipo: 'Teatro' },
    { regex: /\b(museo|museu|museum|musée)\b/i, tipo: 'Museo' },
    { regex: /\b(biblioteca|bibliothèque)\b/i, tipo: 'Edificio civil' },
    { regex: /\b(mercado|marché|mercato|halle|halles)\b/i, tipo: 'Edificio civil' },
    { regex: /\b(cárcel|prisión|prison|prigione|cadeia)\b/i, tipo: 'Edificio civil' },

    // ========= INFRAESTRUCTURA =========
    { regex: /\b(puente|pont|ponte|brücke)\b/i, tipo: 'Puente' },
    { regex: /\b(acueducto|acqueduc|acquedotto|aqueduto)\b/i, tipo: 'Acueducto' },
    { regex: /\b(fuente|fontaine|fontana|fonte)\b/i, tipo: 'Fuente' },
    { regex: /\b(faro|phare|faro|farol)\b/i, tipo: 'Faro' },
    { regex: /\b(plaza\s+de\s+toros|arène|arena|corrida)\b/i, tipo: 'Plaza de toros' },
    { regex: /\b(cementerio|cimetière|cimitero|cemitério)\b/i, tipo: 'Cementerio' },
    { regex: /\b(balneario|thermes|terme|balneário)\b/i, tipo: 'Balneario / Termas' },

    // ========= ETNOLOGÍA / RURAL =========
    { regex: /\b(mas[íi]a|masia|mas\b|cortijo|hórreo|horreo|palloza|barraca|borda|cabaña|pigeonnier|palomar|colombier)\b/i, tipo: 'Arquitectura rural' },
    { regex: /\b(cascina|masseria|trullo|dammuso)\b/i, tipo: 'Arquitectura rural' },
    { regex: /\b(molino|moulin|mulino|moinho)\b/i, tipo: 'Molino' },

    // ========= ARQUEOLOGÍA =========
    { regex: /\b(yacimiento|jaciment|gisement|sito\s+archeologico|sítio\s+arqueológico)\b/i, tipo: 'Yacimiento arqueológico' },
    { regex: /\b(dolmen|menhir|cromlech|megalítico|megalitic)\b/i, tipo: 'Megalítico' },
    { regex: /\b(villa\s+roman|villa\s+romaine|villa\s+romana)\b/i, tipo: 'Yacimiento arqueológico' },

    // ========= RESIDENCIAL =========
    { regex: /\b(casa\s+(?:señorial|solariega|palacio|nobiliaria|torre|forte|grande|natal)|manor|manoir|palazzo\s+(?:nobil|signor)|solar)\b/i, tipo: 'Casa señorial / Mansión' },
    { regex: /\bvilla\b(?!\s+(?:roman|romaine|romana|ibér))/i, tipo: 'Casa señorial / Mansión' },

    // Cal/Can/Ca (Catalan farmhouses/houses) — NO matchea castillo
    { regex: /^(cal\s|can\s|ca\s|ca\sl|ca\sn)/i, tipo: 'Edificio civil' },

    // Fallback genérico casa/edificio
    { regex: /\b(casa|maison|immeuble|vivienda|habitatge|edifício|edificio|edifici|hôtel\b(?!\s+de\s+ville)|logis|demeure)\b/i, tipo: 'Edificio civil' },

    // Patrimonio industrial
    { regex: /\b(fábrica|fabrique|fabbrica|fábrica|usine|factoría|estación|gare|stazione|estação)\b/i, tipo: 'Patrimonio industrial' },
];

// Fallback desde tipo/clase/categoria
const FALLBACK_PATTERNS = [
    { regex: /jaciment|yacimiento|archäolog|archeolog|arqueol[oó]g/i, tipo: 'Yacimiento arqueológico' },
    { regex: /\betnol[oó]g/i, tipo: 'Arquitectura rural' },
    { regex: /\bobra\s+civil/i, tipo: 'Edificio civil' },
    { regex: /\b(edifici|edifico|edificio)\b/i, tipo: 'Edificio civil' },
    { regex: /\bcasa\b/i, tipo: 'Casa señorial / Mansión' },
];

function classifyStrict(item) {
    const den = item.denominacion || '';
    // 1. Por denominación (la más fiable)
    for (const p of STRICT_PATTERNS) {
        if (p.regex.test(den)) return p.tipo;
    }
    // 2. Fallback por tipo/clase/categoria
    const meta = [item.tipo, item.clase, item.categoria].filter(Boolean).join(' ');
    for (const p of FALLBACK_PATTERNS) {
        if (p.regex.test(meta)) return p.tipo;
    }
    return null;
}

async function main() {
    console.log(`=== Reclasificación de tipo_monumento ${DRY_RUN ? '[DRY-RUN]' : '[APPLY]'} ===\n`);
    if (SOLO_TIPO) console.log(`Filtrando solo items con tipo_monumento ILIKE '%${SOLO_TIPO}%'\n`);

    const whereSolo = SOLO_TIPO ? `AND tipo_monumento ILIKE '%${SOLO_TIPO.replace(/'/g, "''")}%'` : '';

    const result = await db.query(`
        SELECT id, denominacion, tipo, clase, categoria, tipo_monumento
        FROM bienes
        WHERE tipo_monumento IS NOT NULL ${whereSolo}
        ORDER BY id
    `);

    console.log(`Items a revisar: ${result.rows.length}\n`);

    const changes = [];
    const stats = { kept: 0, changed: 0, cleared: 0 };
    const changesByTransition = new Map(); // "A → B" => count

    for (const item of result.rows) {
        const suggested = classifyStrict(item);
        const current = item.tipo_monumento;

        if (suggested === null) {
            // No encontró clasificación fiable → mantener la actual (prudente)
            stats.kept++;
            continue;
        }

        if (suggested === current) {
            stats.kept++;
            continue;
        }

        // Change suggested
        changes.push({ id: item.id, den: item.denominacion, from: current, to: suggested });
        const key = `${current} → ${suggested}`;
        changesByTransition.set(key, (changesByTransition.get(key) || 0) + 1);
        stats.changed++;
    }

    // Stats summary
    console.log(`\n--- Resumen ---`);
    console.log(`  Mantenidos: ${stats.kept}`);
    console.log(`  A cambiar:  ${stats.changed}\n`);

    // Top transitions
    const sorted = [...changesByTransition.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`--- Top transiciones propuestas ---`);
    for (const [key, count] of sorted.slice(0, 30)) {
        console.log(`  ${count.toString().padStart(5)}  ${key}`);
    }

    // Sample items
    console.log(`\n--- Muestra de 25 cambios propuestos ---`);
    for (const c of changes.slice(0, 25)) {
        console.log(`  [${c.id}] "${c.den}"\n    ${c.from}  →  ${c.to}`);
    }

    if (DRY_RUN) {
        console.log(`\n[DRY-RUN] No se ha modificado nada. Usa --apply para aplicar.`);
    } else {
        console.log(`\nAplicando ${changes.length} cambios...`);
        const FLUSH = 1000;
        for (let i = 0; i < changes.length; i += FLUSH) {
            const batch = changes.slice(i, i + FLUSH);
            const ids = batch.map(b => b.id);
            const cases = batch.map(b => `WHEN ${b.id} THEN '${b.to.replace(/'/g, "''")}'`).join(' ');
            await db.query(`
                UPDATE bienes SET tipo_monumento = CASE id ${cases} END
                WHERE id = ANY($1)
            `, [ids]);
            console.log(`  ${Math.min(i + FLUSH, changes.length)} / ${changes.length}`);
        }
        console.log(`\nAplicado. ${changes.length} items reclasificados.`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
