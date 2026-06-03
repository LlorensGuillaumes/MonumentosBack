/**
 * Limpia URLs incorrectas en wikidata.wikipedia_url.
 *
 * Problema: ~25% de los bienes con wikipedia_url tienen valores que apuntan a
 * `www.wikidata.org/wiki/Q...` en lugar de a un artículo real de Wikipedia.
 * Eso confunde al endpoint /wikipedia y a los scripts de enrichment.
 *
 * Causa probable: imports históricos que confundieron el campo. El QID sigue
 * intacto en la columna `qid`, no se pierde información.
 *
 * Solución: poner a NULL los wikipedia_url cuyo host sea wikidata.org.
 *
 * Uso:
 *   node _limpiar_wikipedia_url_wikidata.cjs           # dry-run
 *   node _limpiar_wikipedia_url_wikidata.cjs --apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  // Identificar URLs problemáticas
  const r = await pool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE wikipedia_url ~* '://www\\.wikidata\\.org/') AS wikidata_org,
           COUNT(*) FILTER (WHERE wikipedia_url ~* '://[a-z]{2,3}\\.wikipedia\\.org/') AS wikipedia_real
    FROM wikidata
    WHERE wikipedia_url IS NOT NULL
  `);
  const stats = r.rows[0];
  console.log('Estado actual:');
  console.log(`  Total con wikipedia_url:   ${stats.total}`);
  console.log(`  Apuntan a wikidata.org:     ${stats.wikidata_org} (${(stats.wikidata_org/stats.total*100).toFixed(1)}%)`);
  console.log(`  Apuntan a Wikipedia real:  ${stats.wikipedia_real} (${(stats.wikipedia_real/stats.total*100).toFixed(1)}%)`);
  const otros = stats.total - parseInt(stats.wikidata_org) - parseInt(stats.wikipedia_real);
  console.log(`  Otros patrones:            ${otros}`);

  // Muestra de URLs wikidata.org a limpiar
  const sample = await pool.query(`
    SELECT w.bien_id, b.denominacion, w.qid, w.wikipedia_url
    FROM wikidata w
    LEFT JOIN bienes b ON b.id = w.bien_id
    WHERE w.wikipedia_url ~* '://www\\.wikidata\\.org/'
    LIMIT 5
  `);
  console.log('\nMuestra de URLs a limpiar (primeras 5):');
  sample.rows.forEach(r => {
    console.log(`  bien #${r.bien_id} (${(r.denominacion || '').slice(0, 40)})`);
    console.log(`    qid=${r.qid}  url=${r.wikipedia_url}`);
  });

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] No se aplican cambios. Ejecutar con --apply para limpiar.');
    await pool.end();
    return;
  }

  // Aplicar: poner a NULL los wikipedia_url incorrectos
  console.log('\nAplicando limpieza...');
  const upd = await pool.query(`
    UPDATE wikidata
    SET wikipedia_url = NULL
    WHERE wikipedia_url ~* '://www\\.wikidata\\.org/'
  `);
  console.log(`✓ ${upd.rowCount} rows limpiadas (wikipedia_url puesto a NULL)`);
  console.log('  El QID sigue intacto en la columna `qid`.');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
