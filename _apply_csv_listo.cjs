// Aplica a la BD las filas marcadas como 'municipio_localizado' en los CSVs _listo
const db = require('./db.cjs');
const fs = require('fs');
const path = require('path');

const DIR = 'C:\\Users\\usuario\\Desktop\\MonumentosRecursos\\Errores';
const FILES = ['bienes_sin_municipio_1_listo.csv', 'bienes_sin_municipio_2_listo.csv'];

function parseCSV(content) {
    // BOM strip
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const lines = content.split(/\r?\n/).filter(l => l.length > 0);
    const header = lines[0].split(';');
    return lines.slice(1).map(line => {
        // Naive split: assume no quoted ; in these CSVs (user-edited via simple PS1)
        const cols = line.split(';');
        const obj = {};
        header.forEach((h, i) => obj[h] = cols[i] || '');
        return obj;
    });
}

async function main() {
    const updates = [];
    for (const f of FILES) {
        const fp = path.join(DIR, f);
        if (!fs.existsSync(fp)) { console.log(`SKIP ${f}: no existe`); continue; }
        const rows = parseCSV(fs.readFileSync(fp, 'utf8'));
        const listas = rows.filter(r => r.motivo === 'municipio_localizado' && r.localidad);
        console.log(`${f}: ${rows.length} filas, ${listas.length} marcadas`);
        updates.push(...listas);
    }
    console.log(`\nTotal a aplicar: ${updates.length}`);

    let ok = 0, skipped = 0;
    for (const u of updates) {
        const id = parseInt(u.id, 10);
        if (!id) { skipped++; continue; }
        const muni = u.localidad.trim();
        const prov = (u.provincia || '').trim();
        if (!muni) { skipped++; continue; }
        await db.query(
            `UPDATE bienes SET municipio=$1, provincia=COALESCE(NULLIF($2,''), provincia), updated_at=NOW() WHERE id=$3`,
            [muni, prov, id]
        );
        ok++;
    }
    console.log(`Actualizados: ${ok} | descartados: ${skipped}`);

    // Propagar comarca
    console.log('\nPropagando municipio→comarca (4 CCAA con datos)...');
    const ccaa = ['Catalunya', 'Comunitat Valenciana', 'Aragón', 'Galicia'];
    let tot = 0;
    for (const c of ccaa) {
        const r = await db.query(`
            UPDATE bienes b SET comarca=mc.comarca, updated_at=NOW()
            FROM municipio_comarca mc
            WHERE b.comunidad_autonoma=$1
              AND (b.comarca IS NULL OR b.comarca='')
              AND b.municipio IS NOT NULL AND b.municipio<>''
              AND unaccent(LOWER(b.municipio))=unaccent(LOWER(mc.municipio))
              AND mc.pais='España'
        `, [c]);
        if (r.rowCount > 0) console.log(`  ${c}: +${r.rowCount}`);
        tot += r.rowCount;
    }
    console.log(`Total comarca: +${tot}`);

    const s = (await db.query(
        "SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE municipio IS NOT NULL AND municipio<>'')::int as cm FROM bienes WHERE pais='España'"
    )).rows[0];
    console.log(`\n=== España ===\n  Con municipio: ${s.cm}/${s.total} (${(100*s.cm/s.total).toFixed(1)}%)`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
