require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const LIMIT = parseInt(process.argv[2] || '100', 10);
const OUT = process.argv[3] || 'C:/Users/usuario/Desktop/MonumentosRecursos/Pulido/monumentos_sin_coords_100.csv';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const SOLO_CON_QID = process.argv.includes('--solo-qid');
  const CON_MUN = process.argv.includes('--con-municipio');
  const LIMPIO = process.argv.includes('--limpio'); // municipio mono, sin "provincia de", etc.
  const filtroQid = SOLO_CON_QID ? 'AND w.qid IS NOT NULL' : '';
  const filtroMun = CON_MUN ? "AND b.municipio IS NOT NULL AND b.municipio != ''" : '';
  const filtroLimpio = LIMPIO ? `
      AND b.municipio NOT LIKE '%,%'
      AND b.municipio NOT ILIKE 'provincia%'
      AND b.municipio NOT ILIKE 'aragón'
      AND b.municipio NOT ILIKE 'catalunya'
      AND b.municipio NOT ILIKE 'andalucía'
      AND b.municipio NOT ILIKE 'galicia'
      AND b.municipio NOT ILIKE 'asturias'
      AND b.municipio NOT ILIKE '%(la)%'
      AND b.provincia IS NOT NULL AND b.provincia != ''
  ` : '';
  const r = await pool.query(`
    SELECT b.id, b.denominacion, b.municipio, b.provincia, w.qid
    FROM bienes b ${SOLO_CON_QID ? 'INNER' : 'LEFT'} JOIN wikidata w ON w.bien_id=b.id
    WHERE b.pais='España' AND b.latitud IS NULL ${filtroQid} ${filtroMun} ${filtroLimpio}
    ORDER BY b.id
    LIMIT $1
  `, [LIMIT]);

  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = ['id;nombre;municipio;provincia;Idwikidata'];
  for (const x of r.rows) {
    lines.push([x.id, esc(x.denominacion), esc(x.municipio), esc(x.provincia), x.qid || ''].join(';'));
  }
  // UTF-8 con BOM para que Excel detecte acentos
  fs.writeFileSync(OUT, '﻿' + lines.join('\r\n'), 'utf8');
  console.log('Filas:', r.rows.length);
  console.log('Archivo:', OUT);
  console.log('\nPrimeras 5 líneas:');
  lines.slice(0, 6).forEach(l => console.log('  ' + l));

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
