const db = require('./db.cjs');

const SCRIPTS_FASE1 = {
    // España
    'Aragon':               { script: './fase1_opendata.cjs', pais: 'España' },
    'Andalucia':            { script: './fase1_andalucia.cjs', pais: 'España' },
    'Catalunya':            { script: './fase1_diba.cjs', pais: 'España' },
    'Comunitat Valenciana': { script: './fase1_valencia.cjs', pais: 'España' },
    // Portugal
    'Portugal':             { script: './fase1_portugal.cjs', pais: 'Portugal' },
    // Francia
    'Francia':              { script: './fase1_france.cjs', pais: 'Francia' },
    // Italia
    'Italia':               { script: './fase1_italia.cjs', pais: 'Italia' },
};

const TODAS_REGIONES = Object.keys(SCRIPTS_FASE1);
const TODOS_PAISES = [...new Set(Object.values(SCRIPTS_FASE1).map(s => s.pais))];

async function main() {
    const args = process.argv.slice(2);
    const faseArg = args.indexOf('--fase');
    const faseNum = faseArg !== -1 ? parseInt(args[faseArg + 1]) : null;
    const regionArg = args.indexOf('--region');
    const regionNombre = regionArg !== -1 ? args[regionArg + 1] : null;
    const paisArg = args.indexOf('--pais');
    const paisNombre = paisArg !== -1 ? args[paisArg + 1] : null;

    // Validar region
    if (regionNombre && !SCRIPTS_FASE1[regionNombre]) {
        console.error(`Region desconocida: ${regionNombre}`);
        console.error(`Regiones disponibles: ${TODAS_REGIONES.join(', ')}`);
        process.exit(1);
    }

    // Validar pais
    if (paisNombre && !TODOS_PAISES.includes(paisNombre)) {
        console.error(`País desconocido: ${paisNombre}`);
        console.error(`Países disponibles: ${TODOS_PAISES.join(', ')}`);
        process.exit(1);
    }

    let regiones;
    if (regionNombre) {
        regiones = [regionNombre];
    } else if (paisNombre) {
        regiones = Object.keys(SCRIPTS_FASE1).filter(r => SCRIPTS_FASE1[r].pais === paisNombre);
    } else {
        regiones = TODAS_REGIONES;
    }

    console.log('================================================');
    console.log(' Pipeline Patrimonio Arquitectonico Europeo');
    console.log('================================================');
    console.log(`  Regiones: ${regiones.join(', ')}`);
    if (paisNombre) console.log(`  País: ${paisNombre}`);
    if (faseNum) console.log(`  Fase: ${faseNum}`);
    console.log('');

    const inicio = Date.now();

    try {
        // Fase 1: Descarga de datos abiertos (por region)
        if (!faseNum || faseNum === 1) {
            for (const region of regiones) {
                const { script } = SCRIPTS_FASE1[region];
                console.log(`>>> Fase 1: ${region} (${script})\n`);
                const fase1 = require(script);
                await fase1.ejecutar();
                console.log('\n');
            }
        }

        // Fase 2: Wikidata enrichment (maneja --region y --pais internamente)
        if (!faseNum || faseNum === 2) {
            // Pasar region/pais al modulo via process.argv si se especifico
            if (regionNombre && !process.argv.includes('--region')) {
                process.argv.push('--region', regionNombre);
            }
            if (paisNombre && !process.argv.includes('--pais')) {
                process.argv.push('--pais', paisNombre);
            }
            const fase2 = require('./fase2_wikidata.cjs');
            await fase2.ejecutar();
            console.log('\n');
        }

        // Fase 3: SIPCA scraping (solo para Aragon)
        if (!faseNum || faseNum === 3) {
            const esAragon = !regionNombre && !paisNombre // sin filtro = todo incluido Aragon
                || regionNombre === 'Aragon'
                || (paisNombre === 'España' && !regionNombre);
            if (esAragon) {
                const fase3 = require('./fase3_sipca.cjs');
                await fase3.ejecutar();
                console.log('\n');
            } else {
                console.log(`>>> Fase 3 (SIPCA): Solo disponible para Aragon, saltando.\n`);
            }
        }

        // Resumen final
        const stats = await db.estadisticas();
        const duracion = ((Date.now() - inicio) / 1000).toFixed(1);

        console.log('================================================');
        console.log(' RESUMEN FINAL');
        console.log('================================================');
        console.log(`  Bienes totales:       ${stats.bienes}`);
        console.log(`  Con datos Wikidata:   ${stats.con_wikidata}`);
        console.log(`  Con datos SIPCA:      ${stats.con_sipca}`);
        console.log(`  Imagenes totales:     ${stats.imagenes}`);
        console.log(`  Tiempo total:         ${duracion}s`);
        console.log('');
        console.log('  Por pais:');
        stats.por_pais.forEach(p => console.log(`    ${p.pais || 'Sin dato'}: ${p.n}`));
        console.log('');
        console.log('  Por comunidad autonoma:');
        stats.por_ccaa.forEach(c => console.log(`    ${c.comunidad_autonoma || 'Sin dato'}: ${c.n}`));
        console.log('');
        console.log('  Por provincia:');
        stats.por_provincia.forEach(p => console.log(`    ${p.provincia || 'Sin dato'}: ${p.n}`));
        console.log('');
        console.log('  Por categoria:');
        stats.por_categoria.forEach(c => console.log(`    ${c.categoria || 'Sin dato'}: ${c.n}`));
        console.log('================================================');
        console.log(`  Base de datos: PostgreSQL (patrimonio)`);
        console.log('================================================\n');

    } catch (err) {
        console.error('Error en pipeline:', err);
    } finally {
        await db.cerrar();
    }
}

main();
