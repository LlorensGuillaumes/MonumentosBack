// Exporta a CSV los bienes España sin municipio.
const db = require('./db.cjs');
const fs = require('fs');
const path = require('path');

const OUT_DIR = 'C:\\Users\\usuario\\Desktop\\MonumentosRecursos\\Errores';

const SEP = ';';
function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

async function main() {
    const rows = (await db.query(`
        SELECT
          b.id,
          b.denominacion,
          b.comunidad_autonoma,
          b.provincia,
          b.localidad,
          b.latitud,
          b.longitud,
          b.tipo,
          b.categoria,
          b.clase,
          b.codigo_fuente,
          b.fuente_opendata,
          b.tipo_monumento,
          b.periodo,
          w.qid,
          w.wikipedia_url,
          w.heritage_label,
          CASE
            WHEN b.latitud IS NULL OR b.longitud IS NULL THEN 'sin_coords'
            ELSE 'coords_fuera_pip'
          END as motivo
        FROM bienes b
        LEFT JOIN wikidata w ON w.bien_id = b.id
        WHERE b.pais='España'
          AND (b.municipio IS NULL OR b.municipio='')
        ORDER BY b.comunidad_autonoma, b.provincia, b.denominacion
    `)).rows;

    const cols = ['id','denominacion','comunidad_autonoma','provincia','localidad','latitud','longitud','tipo','categoria','clase','codigo_fuente','fuente_opendata','tipo_monumento','periodo','qid','wikipedia_url','heritage_label','motivo'];
    // Split en ficheros con tope de ~480 KB cada uno
    const MAX_BYTES = 480 * 1024;
    const header = cols.join(SEP);
    const headerBytes = Buffer.byteLength('﻿' + header + '\r\n', 'utf8');

    const buckets = [];
    let cur = { lines: [header], bytes: headerBytes };
    for (const r of rows) {
        const line = cols.map(c => csvEscape(r[c])).join(SEP);
        const lineBytes = Buffer.byteLength(line + '\r\n', 'utf8');
        if (cur.bytes + lineBytes > MAX_BYTES && cur.lines.length > 1) {
            buckets.push(cur);
            cur = { lines: [header], bytes: headerBytes };
        }
        cur.lines.push(line);
        cur.bytes += lineBytes;
    }
    if (cur.lines.length > 1) buckets.push(cur);

    const pad = String(buckets.length).length;
    for (let p = 0; p < buckets.length; p++) {
        const fname = `bienes_sin_municipio_${String(p + 1).padStart(pad, '0')}.csv`;
        const outPath = path.join(OUT_DIR, fname);
        fs.writeFileSync(outPath, '﻿' + buckets[p].lines.join('\r\n'), 'utf8');
        const kb = Math.round(buckets[p].bytes / 1024);
        console.log(`  ${fname}: ${buckets[p].lines.length - 1} filas, ${kb} KB`);
    }
    console.log(`Total: ${rows.length} filas en ${buckets.length} ficheros (tope 480 KB)`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
