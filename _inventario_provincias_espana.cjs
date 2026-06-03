// Inventario por provincia España — detectar flojas
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// 50 provincias oficiales + 2 ciudades autónomas
const PROVINCIAS_ESPANA = {
  'Andalucía':              ['Almería','Cádiz','Córdoba','Granada','Huelva','Jaén','Málaga','Sevilla'],
  'Aragón':                 ['Huesca','Teruel','Zaragoza'],
  'Asturias':               ['Asturias'],
  'Illes Balears':          ['Illes Balears'],
  'Canarias':               ['Las Palmas','Santa Cruz de Tenerife'],
  'Cantabria':              ['Cantabria'],
  'Castilla y León':        ['Ávila','Burgos','León','Palencia','Salamanca','Segovia','Soria','Valladolid','Zamora'],
  'Castilla-La Mancha':     ['Albacete','Ciudad Real','Cuenca','Guadalajara','Toledo'],
  'Catalunya':              ['Barcelona','Girona','Lleida','Tarragona'],
  'Comunitat Valenciana':   ['Alicante','Castellón','Valencia'],
  'Extremadura':            ['Badajoz','Cáceres'],
  'Galicia':                ['A Coruña','Lugo','Ourense','Pontevedra'],
  'La Rioja':               ['La Rioja'],
  'Comunidad de Madrid':    ['Madrid'],
  'Región de Murcia':       ['Murcia'],
  'Navarra':                ['Navarra'],
  'País Vasco':             ['Álava','Gipuzkoa','Bizkaia'],
  'Ceuta':                  ['Ceuta'],
  'Melilla':                ['Melilla'],
};

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

(async () => {
  console.log('═══ INVENTARIO POR PROVINCIA — ESPAÑA ═══\n');

  // Contar por (CCAA, provincia)
  const r = await pool.query(`
    SELECT comunidad_autonoma, provincia, COUNT(*)::int as n
    FROM bienes WHERE pais='España'
    GROUP BY comunidad_autonoma, provincia
    ORDER BY comunidad_autonoma, n DESC
  `);

  // Agrupar por CCAA
  const porCcaa = new Map();
  for (const row of r.rows) {
    if (!porCcaa.has(row.comunidad_autonoma)) porCcaa.set(row.comunidad_autonoma, []);
    porCcaa.get(row.comunidad_autonoma).push(row);
  }

  const flojas = [];
  const sinProvincia = [];

  for (const [ccaa, esperadas] of Object.entries(PROVINCIAS_ESPANA)) {
    const datos = porCcaa.get(ccaa) || [];
    const total = datos.reduce((s, d) => s + d.n, 0);
    console.log(`\n──── ${ccaa}  (${total} bienes) ────`);

    const matches = new Map(); // provincia_oficial → count
    const otras = [];
    const sinProvProv = datos.find(d => !d.provincia);

    for (const d of datos) {
      if (!d.provincia) continue;
      const provNorm = norm(d.provincia);
      const oficial = esperadas.find(e => norm(e) === provNorm || provNorm.includes(norm(e)) || norm(e).includes(provNorm));
      if (oficial) {
        matches.set(oficial, (matches.get(oficial) || 0) + d.n);
      } else {
        otras.push(d);
      }
    }

    for (const prov of esperadas) {
      const n = matches.get(prov) || 0;
      const marker = n === 0 ? '✗' : (n < 100 ? '⚠' : '✓');
      console.log(`  ${marker}  ${String(n).padStart(6)}  ${prov}`);
      if (n < 100 && esperadas.length > 1) flojas.push({ ccaa, prov, n });
    }

    if (otras.length > 0) {
      console.log(`  ── nombres NO oficiales en BD:`);
      otras.forEach(o => console.log(`     ${String(o.n).padStart(6)}  "${o.provincia}"`));
    }
    if (sinProvProv) {
      console.log(`  ── sin provincia: ${sinProvProv.n}`);
      sinProvincia.push({ ccaa, n: sinProvProv.n });
    }
  }

  // Resumen
  console.log('\n═══ RESUMEN ═══');
  console.log(`\nProvincias flojas (<100 bienes):`);
  flojas.sort((a, b) => a.n - b.n);
  flojas.forEach(f => console.log(`  ${String(f.n).padStart(4)}  ${f.prov}  (${f.ccaa})`));

  if (sinProvincia.length > 0) {
    console.log(`\nBienes sin provincia (NULL) por CCAA:`);
    sinProvincia.sort((a, b) => b.n - a.n);
    sinProvincia.forEach(s => console.log(`  ${String(s.n).padStart(6)}  ${s.ccaa}`));
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
