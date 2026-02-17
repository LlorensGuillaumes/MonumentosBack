/**
 * enriquecer_tipos_v4.cjs
 * Fourth enrichment pass focused on periodo (the weakest field):
 *   Fase 1: Map unmapped estilo values → periodo
 *   Fase 2: SPARQL P571 (inception) for items with QID but no inception stored
 *   Fase 3: More aggressive text extraction from wiki descriptions
 *   Fase 4: French-specific patterns (Mérimée dates, "XIIe" without "siècle")
 *   Fase 5: Infer periodo from tipo_monumento + country heuristics
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
    return result > 0 && result < 30 ? result : null;
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';

async function sparqlQuery(query) {
    const url = `${WIKIDATA_SPARQL_URL}?query=${encodeURIComponent(query)}&format=json`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/sparql-results+json',
            'User-Agent': 'PatrimonioEuropeoBot/1.0 (monument enrichment script)',
        },
    });
    if (response.status === 429) throw new Error('RATE_LIMIT');
    if (!response.ok) throw new Error(`SPARQL error: ${response.status}`);
    return response.json();
}

// ============== FASE 1: Unmapped estilos → periodo ==============

async function fase1_estilosUnmapped() {
    console.log('\n=== FASE 1: Estilos no mapeados → periodo ===\n');

    // Extended style → periodo mapping (catching what v1-v3 missed)
    const EXTRA_ESTILO = [
        // Italian Gothic
        { regex: /architettura\s*gotica|gotico\s*italiano|gotico\s*pisano|gotico\s*senese|gotico\s*fiorentino|gotico\s*veneziano|gotico\s*catalano/i, periodo: 'Gótico' },
        // Medieval generic
        { regex: /arquitectura\s*medieval|architettura\s*medievale|arquitetura\s*da\s*idade\s*média|architecture\s*médiévale/i, periodo: 'Gótico' },
        // Eclectic
        { regex: /ecléctico|eclettismo|architettura\s*eclettica|éclectisme|eclettico/i, periodo: 'Modernismo' },
        // Neoclassicism (missed Italian/French forms)
        { regex: /neoclasicismo|neoclassicisme|neoclassicismo/i, periodo: 'Neoclásico' },
        // Palladian
        { regex: /palladianesimo|palladiano|palladian/i, periodo: 'Renacimiento' },
        // French period styles
        { regex: /style\s*Louis\s*XIII|Louis\s*treize/i, periodo: 'Barroco' },
        { regex: /style\s*Louis\s*XIV|Louis\s*quatorze/i, periodo: 'Barroco' },
        { regex: /style\s*Louis\s*XV|Louis\s*quinze|style\s*Régence/i, periodo: 'Barroco' },
        { regex: /style\s*Louis\s*XVI|Louis\s*seize/i, periodo: 'Neoclásico' },
        { regex: /style\s*Empire|premier\s*Empire/i, periodo: 'Neoclásico' },
        { regex: /style\s*Directoire|style\s*Consulat/i, periodo: 'Neoclásico' },
        { regex: /style\s*Napoléon\s*III|second\s*Empire/i, periodo: 'Modernismo' },
        { regex: /style\s*Henri\s*(II|IV)|style\s*François\s*I/i, periodo: 'Renacimiento' },
        // Industrial
        { regex: /architettura\s*industriale|architecture\s*industrielle|arquitectura\s*industrial/i, periodo: 'Contemporáneo' },
        // Modern movement
        { regex: /arquitectura\s*moderna|movimento\s*moderno|mouvement\s*moderne|architettura\s*moderna/i, periodo: 'Contemporáneo' },
        // Islamic/Andalusi
        { regex: /arquitectura\s*islámica|Arte\s*andalusí|architettura\s*islamica|art\s*islamique|arte\s*islám/i, periodo: 'Mudéjar' },
        // Academicism
        { regex: /academicismo|académisme|accademismo/i, periodo: 'Neoclásico' },
        // Rococo (Italian)
        { regex: /rococò/i, periodo: 'Barroco' },
        // Portuguese Romanesque
        { regex: /arte\s*românica|romanico\s*pisano|romanico\s*lombardo|architettura\s*romanica/i, periodo: 'Románico' },
        // Novecento/Novecentismo
        { regex: /Novecento|Novecentismo/i, periodo: 'Contemporáneo' },
        // Neovasco
        { regex: /Neovasco|neo-?vasco/i, periodo: 'Modernismo' },
        // Byzantine
        { regex: /architettura\s*bizantina|architecture\s*byzantine|arquitectura\s*bizantina|bizantino/i, periodo: 'Prerrománico' },
        // Norman
        { regex: /architettura\s*normanna|architecture\s*normande|normando/i, periodo: 'Románico' },
        // Monumentalism
        { regex: /monumentalismo|monumentalisme/i, periodo: 'Contemporáneo' },
        // Lombard
        { regex: /lombardo|longobardo/i, periodo: 'Prerrománico' },
        // Art Deco
        { regex: /art\s*déco|art\s*deco/i, periodo: 'Contemporáneo' },
        // Baroque (more Italian variants)
        { regex: /barocco\s*siciliano|barocco\s*leccese|barocco\s*piemontese|tardo\s*barocco/i, periodo: 'Barroco' },
        // Renaissance Italian
        { regex: /rinascimento|architettura\s*rinascimentale|quattrocento|cinquecento/i, periodo: 'Renacimiento' },
    ];

    const result = await db.query(
        "SELECT b.id, w.estilo FROM bienes b " +
        "JOIN wikidata w ON b.id = w.bien_id " +
        "WHERE b.periodo IS NULL AND w.estilo IS NOT NULL AND w.estilo != '' " +
        "ORDER BY b.id"
    );

    let updated = 0;
    for (const item of result.rows) {
        for (const pattern of EXTRA_ESTILO) {
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
    console.log('Fase 1 completada: ' + updated + ' periodos desde estilos no mapeados');
}

// ============== FASE 2: SPARQL P571 (inception) ==============

async function fase2_sparqlInception() {
    console.log('\n=== FASE 2: SPARQL P571 inception para items sin periodo ===\n');

    const result = await db.query(
        "SELECT b.id, w.qid FROM bienes b " +
        "JOIN wikidata w ON b.id = w.bien_id " +
        "WHERE b.periodo IS NULL AND w.qid IS NOT NULL " +
        "AND (w.inception IS NULL OR w.inception = '') " +
        "ORDER BY b.id"
    );

    const items = result.rows;
    console.log('Candidatos SPARQL P571: ' + items.length);

    const BATCH_SIZE = 100;
    let updated = 0;
    let inceptionsSaved = 0;
    let errors = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const qidToIds = {};
        for (const b of batch) {
            if (!qidToIds[b.qid]) qidToIds[b.qid] = [];
            qidToIds[b.qid].push(b.id);
        }

        const values = Object.keys(qidToIds).map(q => 'wd:' + q).join(' ');
        const sparql = `
            SELECT ?item ?inception WHERE {
                VALUES ?item { ${values} }
                ?item wdt:P571 ?inception .
            }
        `;

        let retries = 0;
        while (retries <= 3) {
            try {
                const data = await sparqlQuery(sparql);
                const bindings = data.results?.bindings || [];

                for (const b of bindings) {
                    const qid = b.item.value.split('/').pop();
                    const inceptionVal = b.inception.value;
                    const bienIds = qidToIds[qid] || [];

                    // Parse year from inception
                    let year = null;
                    const yearMatch = inceptionVal.match(/(-?\d{1,4})/);
                    if (yearMatch) year = parseInt(yearMatch[1]);

                    if (year !== null && year >= -3000 && year <= 2030) {
                        const periodo = yearToPeriodo(year);
                        const inceptionStr = String(year);

                        for (const bienId of bienIds) {
                            // Update periodo
                            const r = await db.query(
                                'UPDATE bienes SET periodo = $1 WHERE id = $2 AND periodo IS NULL',
                                [periodo, bienId]
                            );
                            if (r.rowCount > 0) updated++;

                            // Save inception for future use
                            await db.query(
                                'UPDATE wikidata SET inception = $1 WHERE bien_id = $2 AND (inception IS NULL OR inception = \'\')',
                                [inceptionStr, bienId]
                            );
                            inceptionsSaved++;
                        }
                    }
                }
                break;
            } catch (err) {
                if (err.message === 'RATE_LIMIT' && retries < 3) {
                    retries++;
                    const delay = 5000 * Math.pow(2, retries);
                    console.log('  Rate limited, esperando ' + (delay / 1000) + 's...');
                    await sleep(delay);
                } else {
                    errors++;
                    if (errors <= 3) console.error('  Error lote ' + i + ': ' + err.message);
                    break;
                }
            }
        }

        if ((i / BATCH_SIZE) % 20 === 0) {
            console.log('  Procesados ' + (i + batch.length) + '/' + items.length + ' (periodos: ' + updated + ', inceptions: ' + inceptionsSaved + ')');
        }

        await sleep(1500);
    }

    console.log('Fase 2 completada: ' + updated + ' periodos, ' + inceptionsSaved + ' inceptions guardados, ' + errors + ' errores');
}

// ============== FASE 3: Aggressive text extraction ==============

async function fase3_aggressiveText() {
    console.log('\n=== FASE 3: Extracción agresiva de periodos desde texto ===\n');

    const BATCH = 5000;
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
            if (!text) continue;

            let periodo = null;

            // 1. French: "XIIe" without "siècle" (common in Mérimée data)
            let m = text.match(/\b([IVXLCDM]+)[eè]\b/);
            if (m && !periodo) {
                const c = romanToInt(m[1].toUpperCase());
                if (c && c >= 5 && c <= 21) periodo = centuryToPeriodo(c);
            }

            // 2. Italian: "del XVI" or "sec. XVI" or "XVI sec."
            if (!periodo) {
                m = text.match(/(?:del|dal|nel|sec\.?\s*)([IVXLCDM]+)(?:\s*sec\.?|\b)/i);
                if (m) {
                    const c = romanToInt(m[1].toUpperCase());
                    if (c && c >= 5 && c <= 21) periodo = centuryToPeriodo(c);
                }
            }

            // 3. Standalone year in text (1234, 1850, etc.) — more aggressive
            if (!periodo) {
                m = text.match(/\b(1[0-9]{3})\b/);
                if (m) {
                    const year = parseInt(m[1]);
                    if (year >= 1000 && year <= 1970) periodo = yearToPeriodo(year);
                }
            }

            // 4. "Xe-XIe" range patterns - take average
            if (!periodo) {
                m = text.match(/([IVXLCDM]+)[eè]?\s*[-–—\/]\s*([IVXLCDM]+)[eè]?\s*(?:siècle|s\.|sec|century|secolo|siglo)/i);
                if (m) {
                    const c1 = romanToInt(m[1].toUpperCase());
                    const c2 = romanToInt(m[2].toUpperCase());
                    if (c1 && c2) {
                        const avg = Math.round((c1 + c2) / 2);
                        periodo = centuryToPeriodo(avg);
                    }
                }
            }

            // 5. "época romana", "edad media", "medieval" in various languages
            if (!periodo) {
                if (/época\s*romana|età\s*romana|période\s*romaine|roman\s*period|romano\b/i.test(text)) periodo = 'Antiguo / Romano';
                else if (/edad\s*media|medioev|medieval|moyen\s*[aâ]ge|médievale?/i.test(text)) periodo = 'Gótico';
                else if (/antigüedad|antig[üu]e|antichità|antiquité/i.test(text)) periodo = 'Antiguo / Romano';
                else if (/época\s*moderna|early\s*modern|età\s*moderna|époque\s*moderne/i.test(text)) periodo = 'Renacimiento';
            }

            if (periodo) {
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
    console.log('Fase 3 completada: ' + totalUpdated + ' periodos desde texto agresivo');
}

// ============== FASE 4: French-specific date patterns ==============

async function fase4_frenchDates() {
    console.log('\n=== FASE 4: Patrones franceses específicos (data.culture.gouv.fr) ===\n');

    // French monuments often have century in the "clase" or "categoria" fields
    const result = await db.query(
        "SELECT b.id, b.denominacion, b.categoria, b.clase, b.tipo " +
        "FROM bienes b WHERE b.periodo IS NULL AND b.pais = 'Francia' ORDER BY b.id"
    );

    let updated = 0;
    for (const item of result.rows) {
        const text = [item.denominacion, item.categoria, item.clase, item.tipo].filter(Boolean).join(' ');

        let periodo = null;

        // "XIIe siècle" or just "XIIe" in any field
        let m = text.match(/([IVXLCDM]+)[eè]/i);
        if (m) {
            const c = romanToInt(m[1].toUpperCase());
            if (c && c >= 1 && c <= 21) periodo = centuryToPeriodo(c);
        }

        // "12e siècle"
        if (!periodo) {
            m = text.match(/(\d{1,2})[eè]\s*(?:siècle|s\.)/i);
            if (m) {
                const c = parseInt(m[1]);
                if (c >= 1 && c <= 21) periodo = centuryToPeriodo(c);
            }
        }

        if (periodo) {
            await db.query(
                'UPDATE bienes SET periodo = $1 WHERE id = $2 AND periodo IS NULL',
                [periodo, item.id]
            );
            updated++;
        }
    }
    console.log('Fase 4 completada: ' + updated + ' periodos desde patrones franceses');
}

// ============== FASE 5: Heuristic inference from tipo_monumento ==============

async function fase5_heuristic() {
    console.log('\n=== FASE 5: Inferencia heurística tipo_monumento → periodo ===\n');

    // Only infer for types with very strong period correlation
    // Megalítico already done in v3
    const inferences = [
        // Acueductos: 68% Romano
        { tipo: 'Acueducto', periodo: 'Antiguo / Romano' },
        // Dolmen/Menhir already covered by Megalítico → Prehistoria
    ];

    let updated = 0;
    for (const inf of inferences) {
        const r = await db.query(
            'UPDATE bienes SET periodo = $1 WHERE tipo_monumento = $2 AND periodo IS NULL',
            [inf.periodo, inf.tipo]
        );
        console.log('  ' + inf.tipo + ' → ' + inf.periodo + ': ' + r.rowCount);
        updated += r.rowCount;
    }
    console.log('Fase 5 completada: ' + updated + ' periodos heurísticos');
}

// ============== MAIN ==============

async function main() {
    console.log('=== Enriquecimiento v4 (foco en periodo) ===');
    console.log('Inicio: ' + new Date().toISOString() + '\n');

    const initPeriodo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE periodo IS NOT NULL");
    const initTotal = await db.query("SELECT COUNT(*) as c FROM bienes");
    console.log('Estado inicial: periodo=' + initPeriodo.rows[0].c + ' / ' + initTotal.rows[0].c +
                ' (' + (initPeriodo.rows[0].c / initTotal.rows[0].c * 100).toFixed(1) + '%)');

    try {
        await fase1_estilosUnmapped();
        await fase2_sparqlInception();
        await fase3_aggressiveText();
        await fase4_frenchDates();
        await fase5_heuristic();

        // Summary
        console.log('\n=== RESUMEN FINAL ===\n');
        const periodoR = await db.query(
            "SELECT periodo, COUNT(*) as count FROM bienes " +
            "WHERE periodo IS NOT NULL GROUP BY periodo ORDER BY count DESC"
        );
        let totalPeriodo = 0;
        console.log('Distribución periodo:');
        for (const row of periodoR.rows) {
            console.log('  ' + row.periodo + ': ' + row.count);
            totalPeriodo += parseInt(row.count);
        }

        const sinPeriodo = await db.query('SELECT COUNT(*) as n FROM bienes WHERE periodo IS NULL');
        const total = totalPeriodo + parseInt(sinPeriodo.rows[0].n);
        console.log('\n  TOTAL con periodo: ' + totalPeriodo + ' / ' + total + ' (' + (totalPeriodo / total * 100).toFixed(1) + '%)');
        console.log('  Sin periodo: ' + sinPeriodo.rows[0].n);

        // By country
        console.log('\nCobertura por país:');
        const byPais = await db.query(
            "SELECT pais, COUNT(*) as total, " +
            "SUM(CASE WHEN periodo IS NOT NULL THEN 1 ELSE 0 END) as con_periodo " +
            "FROM bienes GROUP BY pais ORDER BY total DESC"
        );
        for (const r of byPais.rows) {
            console.log('  ' + r.pais + ': ' + r.con_periodo + '/' + r.total +
                        ' (' + (r.con_periodo / r.total * 100).toFixed(1) + '%)');
        }

        const finalPeriodo = await db.query("SELECT COUNT(*) as c FROM bienes WHERE periodo IS NOT NULL");
        console.log('\nMejora v4: periodo +' + (finalPeriodo.rows[0].c - initPeriodo.rows[0].c));

    } catch (err) {
        console.error('Error fatal:', err);
        process.exit(1);
    } finally {
        await db.cerrar();
        console.log('\nFin: ' + new Date().toISOString());
    }
}

main();
