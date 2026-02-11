const fs = require('fs');
const db = require('./db.cjs');

async function main() {
    console.log('Exportando items sin coordenadas...');

    const result = await db.query(`
        SELECT id, denominacion, municipio, provincia, comunidad_autonoma, categoria
        FROM bienes
        WHERE latitud IS NULL
        ORDER BY comunidad_autonoma, provincia, municipio, denominacion
    `);
    const items = result.rows;

    let md = '# Items sin coordenadas\n\n';
    md += `**Total:** ${items.length} items\n\n`;
    md += `**Fecha de generación:** ${new Date().toISOString().split('T')[0]}\n\n`;
    md += '---\n';

    let currentRegion = '';
    let currentProv = '';
    let countRegion = 0;

    for (const item of items) {
        if (item.comunidad_autonoma !== currentRegion) {
            if (currentRegion) {
                md += `\n*${countRegion} items en ${currentRegion}*\n`;
            }
            currentRegion = item.comunidad_autonoma;
            countRegion = 0;
            md += `\n## ${currentRegion || 'Sin región'}\n\n`;
            currentProv = '';
        }

        if (item.provincia !== currentProv) {
            currentProv = item.provincia;
            md += `### ${currentProv || 'Sin provincia'}\n\n`;
        }

        const categoria = item.categoria ? `[${item.categoria}]` : '';
        const municipio = item.municipio || 'Sin municipio';
        md += `- **${item.denominacion}** (${municipio}) ${categoria}\n`;
        countRegion++;
    }

    if (currentRegion) {
        md += `\n*${countRegion} items en ${currentRegion}*\n`;
    }

    fs.writeFileSync('items_sin_coordenadas.md', md);

    console.log(`Archivo creado: items_sin_coordenadas.md`);
    console.log(`Total items: ${items.length}`);

    await db.cerrar();
}

main().catch(console.error);
