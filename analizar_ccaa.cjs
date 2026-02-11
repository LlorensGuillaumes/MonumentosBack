const db = require('./db.cjs');

async function main() {
    console.log('=== CCAA ACTUALES ===');
    const actuales = (await db.query('SELECT comunidad_autonoma, COUNT(*) as n FROM bienes GROUP BY comunidad_autonoma')).rows;
    actuales.forEach(r => console.log('  ' + r.comunidad_autonoma + ': ' + r.n.toLocaleString()));

    console.log('\n=== CCAA DE ESPAÑA ===');
    const todas = [
        'Andalucia',
        'Aragon',
        'Asturias',
        'Illes Balears',
        'Canarias',
        'Cantabria',
        'Castilla-La Mancha',
        'Castilla y Leon',
        'Catalunya',
        'Ceuta',
        'Comunitat Valenciana',
        'Extremadura',
        'Galicia',
        'La Rioja',
        'Comunidad de Madrid',
        'Melilla',
        'Region de Murcia',
        'Navarra',
        'Pais Vasco'
    ];

    const existentes = actuales.map(r => r.comunidad_autonoma);

    console.log('\nFaltan:');
    const faltan = todas.filter(c => !existentes.includes(c));
    faltan.forEach(c => console.log('  - ' + c));

    console.log('\nTotal CCAA faltantes: ' + faltan.length + ' de ' + todas.length);

    await db.cerrar();
}

main().catch(console.error);
