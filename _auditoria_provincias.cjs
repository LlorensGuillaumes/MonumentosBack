// Auditoría completa por provincia España
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  // Métricas por provincia
  const r = await pool.query(`
    SELECT
      b.comunidad_autonoma,
      COALESCE(b.provincia, '(sin provincia)') as provincia,
      COUNT(*)::int as total,
      COUNT(CASE WHEN b.latitud IS NOT NULL THEN 1 END)::int as con_coords,
      COUNT(CASE WHEN w.qid IS NOT NULL THEN 1 END)::int as con_wikidata,
      COUNT(DISTINCT CASE WHEN i.id IS NOT NULL OR w.imagen_url IS NOT NULL THEN b.id END)::int as con_imagen
    FROM bienes b
    LEFT JOIN wikidata w ON w.bien_id = b.id
    LEFT JOIN imagenes i ON i.bien_id = b.id
    WHERE b.pais='España'
    GROUP BY b.comunidad_autonoma, b.provincia
    ORDER BY b.comunidad_autonoma, total DESC
  `);

  // Agrupar por CCAA
  const porCcaa = new Map();
  let totalEspana = { total: 0, coords: 0, wiki: 0, img: 0 };
  for (const row of r.rows) {
    if (!porCcaa.has(row.comunidad_autonoma)) porCcaa.set(row.comunidad_autonoma, []);
    porCcaa.get(row.comunidad_autonoma).push(row);
    totalEspana.total += row.total;
    totalEspana.coords += row.con_coords;
    totalEspana.wiki += row.con_wikidata;
    totalEspana.img += row.con_imagen;
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('AUDITORÍA POR PROVINCIA — ESPAÑA');
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Leyenda: T=Total | C=Coords | W=Wikidata | I=Imagen | %img=cobertura imagen');
  console.log('');

  const pct = (n, t) => t > 0 ? Math.round(n/t*100) : 0;

  const ccaaOrden = [...porCcaa.keys()].sort((a, b) => {
    const sa = porCcaa.get(a).reduce((s, r) => s + r.total, 0);
    const sb = porCcaa.get(b).reduce((s, r) => s + r.total, 0);
    return sb - sa;
  });

  for (const ccaa of ccaaOrden) {
    const provs = porCcaa.get(ccaa);
    const tot = provs.reduce((s, r) => s + r.total, 0);
    const cc = provs.reduce((s, r) => s + r.con_coords, 0);
    const cw = provs.reduce((s, r) => s + r.con_wikidata, 0);
    const ci = provs.reduce((s, r) => s + r.con_imagen, 0);
    console.log(`\n━━━ ${ccaa.padEnd(24)} ${String(tot).padStart(6)} bienes  │  coords ${pct(cc,tot)}% │ wiki ${pct(cw,tot)}% │ imagen ${pct(ci,tot)}%`);
    console.log('  Provincia                     T       C       W       I     %img');
    console.log('  ' + '─'.repeat(63));
    for (const p of provs) {
      const marker = p.total < 100 ? '⚠' : ' ';
      console.log(`  ${marker} ${p.provincia.padEnd(24)} ${String(p.total).padStart(6)}  ${String(p.con_coords).padStart(6)}  ${String(p.con_wikidata).padStart(6)}  ${String(p.con_imagen).padStart(6)}    ${String(pct(p.con_imagen, p.total)).padStart(3)}%`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════');
  console.log(`TOTAL ESPAÑA  ${String(totalEspana.total).padStart(6)} bienes  │  coords ${pct(totalEspana.coords, totalEspana.total)}% │ wiki ${pct(totalEspana.wiki, totalEspana.total)}% │ imagen ${pct(totalEspana.img, totalEspana.total)}%`);
  console.log('═══════════════════════════════════════════════════════════════════════════════════');

  // Provincias con problemas potenciales
  const flojas = r.rows.filter(p => p.total < 200 && p.provincia !== '(sin provincia)');
  if (flojas.length > 0) {
    console.log(`\n⚠ Provincias con menos de 200 bienes (revisar):`);
    flojas.sort((a, b) => a.total - b.total).forEach(p =>
      console.log(`   ${String(p.total).padStart(4)}  ${p.provincia} (${p.comunidad_autonoma})`)
    );
  }

  const sinImagen = r.rows
    .filter(p => p.provincia !== '(sin provincia)' && pct(p.con_imagen, p.total) < 30 && p.total > 200)
    .sort((a, b) => pct(a.con_imagen, a.total) - pct(b.con_imagen, b.total));
  if (sinImagen.length > 0) {
    console.log(`\n📷 Provincias con baja cobertura imagen (<30%):`);
    sinImagen.forEach(p =>
      console.log(`   ${String(pct(p.con_imagen, p.total)).padStart(3)}%   ${p.provincia.padEnd(22)} (${p.comunidad_autonoma}) — ${p.con_imagen}/${p.total}`)
    );
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
