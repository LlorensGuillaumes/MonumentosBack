/**
 * Categoriza items de Catalunya basandose en su tipologia DIBA
 */

const db = require('./db.cjs');

// Mapeo de tipologias DIBA a categorias estandar
const MAPEO_TIPOLOGIA = {
    // Edificaciones
    'Edifici': 'Arquitectonica',
    'Element arquitectonic': 'Arquitectonica',
    'Conjunt arquitectonic': 'Conjunto arquitectonico',
    'Obra civil': 'Obra civil',

    // Arqueologia
    'Jaciment arqueologic': 'Arqueologica',

    // Otros
    'Espai natural': 'Espacio natural',
    'Lloc historic': 'Lugar historico',
    'Monument commemoratiu': 'Monumento',
    'Escultura': 'Escultura',
    'Pintura': 'Pintura',
    'Objecte': 'Objeto',
    'Col·leccio': 'Coleccion',
    'Fons documental': 'Fondo documental',
    'Patrimoni immaterial': 'Patrimonio inmaterial',
};

async function ejecutar() {
    console.log('=== CATEGORIZAR ITEMS CATALUNYA ===\n');

    // Ver tipologias disponibles
    console.log('Tipologias en Catalunya:');
    const tipos = (await db.query(`
        SELECT tipo, COUNT(*) as n
        FROM bienes
        WHERE comunidad_autonoma = 'Catalunya'
        GROUP BY tipo
        ORDER BY n DESC
    `)).rows;
    tipos.forEach(r => console.log(`  ${r.tipo || '(null)'}: ${r.n}`));

    // Contar items sin categoria
    const sinCat = (await db.query(`
        SELECT COUNT(*) as n
        FROM bienes
        WHERE comunidad_autonoma = 'Catalunya'
          AND (categoria IS NULL OR categoria = '')
    `)).rows[0].n;
    console.log(`\nItems sin categoria: ${sinCat}\n`);

    // Actualizar categorias basandose en tipo
    let actualizados = 0;

    for (const [tipo, categoria] of Object.entries(MAPEO_TIPOLOGIA)) {
        const result = await db.query(`
            UPDATE bienes
            SET categoria = ?
            WHERE comunidad_autonoma = 'Catalunya'
              AND tipo = ?
              AND (categoria IS NULL OR categoria = '')
        `, [categoria, tipo]);
        if (result.rowCount > 0) {
            console.log(`  ${tipo} -> ${categoria}: ${result.rowCount} items`);
            actualizados += result.rowCount;
        }
    }

    // Para items sin tipo, intentar inferir de la denominacion
    console.log('\nInfiriendo categoria de denominacion...');

    const patrones = [
        { patron: /^Iglesia|^Ermita|^Capilla|^Basilica|^Catedral|^Parroquia/i, categoria: 'Religiosa' },
        { patron: /^Castillo|^Torre|^Muralla|^Fortificacion/i, categoria: 'Militar' },
        { patron: /^Puente|^Acueducto|^Fuente|^Molino/i, categoria: 'Obra civil' },
        { patron: /^Dolmen|^Menhir|^Cueva|^Yacimiento|^Poblado iberico/i, categoria: 'Arqueologica' },
        { patron: /^Masia|^Casa|^Palacio|^Mansion|^Villa /i, categoria: 'Arquitectonica' },
        { patron: /^Monasterio|^Convento|^Santuario/i, categoria: 'Religiosa' },
    ];

    const sinCatItems = (await db.query(`
        SELECT id, denominacion
        FROM bienes
        WHERE comunidad_autonoma = 'Catalunya'
          AND (categoria IS NULL OR categoria = '')
    `)).rows;

    let inferidos = 0;

    for (const item of sinCatItems) {
        for (const { patron, categoria } of patrones) {
            if (patron.test(item.denominacion)) {
                await db.query('UPDATE bienes SET categoria = ? WHERE id = ?', [categoria, item.id]);
                inferidos++;
                break;
            }
        }
    }

    console.log(`  Inferidos por denominacion: ${inferidos}`);

    // Stats finales
    const totalActualizados = actualizados + inferidos;
    console.log(`\nTotal categorizado: ${totalActualizados}`);

    const finalStats = (await db.query(`
        SELECT categoria, COUNT(*) as n
        FROM bienes
        WHERE comunidad_autonoma = 'Catalunya'
        GROUP BY categoria
        ORDER BY n DESC
    `)).rows;

    console.log('\nDistribucion final por categoria:');
    finalStats.forEach(r => console.log(`  ${r.categoria || '(sin categoria)'}: ${r.n}`));

    await db.cerrar();
}

ejecutar();
