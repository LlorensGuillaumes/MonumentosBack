/**
 * Exporta lista de items sin coordenadas a markdown
 */

const fs = require('fs');
const db = require('./db.cjs');

async function ejecutar() {
    const result = await db.query(`
        SELECT denominacion, categoria, municipio, provincia, comunidad_autonoma, codigo_fuente
        FROM bienes
        WHERE latitud IS NULL
        ORDER BY comunidad_autonoma, municipio, denominacion
    `);
    const sinCoords = result.rows;

    console.log(`Items sin coordenadas: ${sinCoords.length}`);

    let md = `# Items sin coordenadas\n\n`;
    md += `Total: ${sinCoords.length} items\n\n`;

    // Agrupar por CCAA
    const porCCAA = {};
    for (const item of sinCoords) {
        const ccaa = item.comunidad_autonoma || 'Sin CCAA';
        if (!porCCAA[ccaa]) porCCAA[ccaa] = [];
        porCCAA[ccaa].push(item);
    }

    // Resumen por CCAA
    md += `## Resumen por Comunidad Autónoma\n\n`;
    md += `| CCAA | Items |\n|------|-------|\n`;
    for (const [ccaa, items] of Object.entries(porCCAA).sort((a, b) => b[1].length - a[1].length)) {
        md += `| ${ccaa} | ${items.length} |\n`;
    }
    md += `\n`;

    // Detalle por CCAA
    for (const [ccaa, items] of Object.entries(porCCAA).sort((a, b) => b[1].length - a[1].length)) {
        md += `## ${ccaa} (${items.length})\n\n`;

        if (items.length <= 100) {
            for (const item of items) {
                const loc = [item.municipio, item.provincia].filter(Boolean).join(', ') || 'ubicación desconocida';
                md += `- **${item.denominacion}** - ${loc} [${item.categoria || 'sin categoría'}]\n`;
            }
        } else {
            // Solo mostrar primeros 50 y últimos 10
            for (let i = 0; i < 50; i++) {
                const item = items[i];
                const loc = [item.municipio, item.provincia].filter(Boolean).join(', ') || 'ubicación desconocida';
                md += `- **${item.denominacion}** - ${loc} [${item.categoria || 'sin categoría'}]\n`;
            }
            md += `\n... y ${items.length - 60} más ...\n\n`;
            for (let i = items.length - 10; i < items.length; i++) {
                const item = items[i];
                const loc = [item.municipio, item.provincia].filter(Boolean).join(', ') || 'ubicación desconocida';
                md += `- **${item.denominacion}** - ${loc} [${item.categoria || 'sin categoría'}]\n`;
            }
        }
        md += `\n`;
    }

    fs.writeFileSync('items_sin_coordenadas.md', md);
    console.log('Exportado: items_sin_coordenadas.md');

    await db.cerrar();
}

ejecutar().catch(console.error);
