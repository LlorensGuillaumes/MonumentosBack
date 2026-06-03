/**
 * Descarga mapeo oficial municipio→comarca de Cataluña desde Wikidata
 * y lo aplica a la BD (tabla municipio_comarca + UPDATE bienes residuales).
 */
require('dotenv').config();
const { Pool } = require('pg');

const ARG_APPLY = process.argv.includes('--apply');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// Query directa: comarcas catalanas (Q1063040) y sus municipios. Mucho más ligera.
const SPARQL = `
SELECT DISTINCT ?municipio ?municipioLabel ?comarca ?comarcaLabel WHERE {
  ?comarca wdt:P31 wd:Q1063040.
  ?municipio wdt:P131 ?comarca.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ca,es". }
}
ORDER BY ?municipioLabel
`;

async function main() {
  console.log('Pidiendo mapeo oficial a Wikidata SPARQL...');
  const res = await fetch('https://query.wikidata.org/sparql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'PatrimonioEuropeo/1.0',
    },
    body: 'query=' + encodeURIComponent(SPARQL),
  });
  if (!res.ok) { console.error('SPARQL ' + res.status); process.exit(1); }
  const data = await res.json();
  const rows = data.results?.bindings || [];
  console.log('Recibidos ' + rows.length + ' pares municipio→comarca');

  const map = new Map();
  for (const b of rows) {
    const mun = b.municipioLabel?.value;
    const com = b.comarcaLabel?.value;
    if (mun && com && !mun.startsWith('Q')) {
      if (!map.has(mun)) map.set(mun, com);
    }
  }
  console.log('Mapa único: ' + map.size + ' municipios catalanes');

  if (!ARG_APPLY) {
    console.log('(dry-run)');
    [...map.entries()].slice(0, 10).forEach(([m, c]) => console.log('  ' + m + ' → ' + c));
    await pool.end();
    return;
  }

  console.log('Upsert en municipio_comarca...');
  let upserted = 0;
  for (const [mun, com] of map.entries()) {
    await pool.query(
      "INSERT INTO municipio_comarca (municipio, pais, comarca, n_bienes) VALUES ($1, 'España', $2, 0) ON CONFLICT (municipio, pais) DO UPDATE SET comarca = EXCLUDED.comarca",
      [mun, com]
    );
    upserted++;
  }
  console.log('Upserts: ' + upserted);

  console.log('UPDATE bienes catalanes residuales...');
  const u = await pool.query(
    "UPDATE bienes b SET comarca = mc.comarca FROM municipio_comarca mc WHERE b.comunidad_autonoma = 'Catalunya' AND b.comarca IS NULL AND b.municipio = mc.municipio AND mc.pais = 'España'"
  );
  console.log('UPDATE: ' + u.rowCount + ' bienes');

  // Municipios catalanes en BD que NO están en mapping oficial (probables variantes ortográficas)
  const huerf = await pool.query(`
    SELECT DISTINCT b.municipio, COUNT(b.id) AS n_bienes
    FROM bienes b
    WHERE b.comunidad_autonoma = 'Catalunya'
      AND b.municipio IS NOT NULL
      AND b.comarca IS NULL
    GROUP BY b.municipio
    ORDER BY n_bienes DESC
  `);
  console.log('\nMunicipios catalanes SIN match en Wikidata (probables variantes ortográficas):');
  console.log('Total: ' + huerf.rows.length);
  huerf.rows.slice(0, 25).forEach(r => console.log('  ' + String(r.n_bienes).padStart(4) + '  ' + r.municipio));

  const f = await pool.query("SELECT COUNT(*) FILTER (WHERE comarca IS NOT NULL) AS con_comarca, COUNT(*) AS total FROM bienes WHERE comunidad_autonoma = 'Catalunya'");
  console.log('\n=== Catalunya: ' + f.rows[0].con_comarca + '/' + f.rows[0].total + ' (' + (100 * f.rows[0].con_comarca / f.rows[0].total).toFixed(1) + '%) ===');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
