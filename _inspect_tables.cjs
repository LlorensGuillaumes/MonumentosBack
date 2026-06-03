require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const tabs = await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log('TABLAS:'); tabs.rows.forEach(x => console.log(' ', x.table_name));

  for (const t of ['eventos_monumento', 'wikidata', 'wikidata_bien']) {
    try {
      const r = await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
      if (r.rows.length) {
        console.log(`\nCols ${t}:`); r.rows.forEach(x => console.log(' ', x.column_name));
      }
    } catch(e) {}
  }

  // ¿Cuántos bienes están en wikidata?
  try {
    const wb = await p.query("SELECT COUNT(DISTINCT bien_id) FROM wikidata WHERE qid IS NOT NULL");
    console.log('\nBienes con QID en wikidata:', wb.rows[0].count);
  } catch(e) { console.log('No table wikidata o sin bien_id/qid:', e.message); }

  // Bienes Belchite y su match en wikidata
  const bel = await p.query(`SELECT b.id, b.denominacion, b.municipio FROM bienes b WHERE b.municipio ILIKE 'belchite%' LIMIT 5`);
  for (const b of bel.rows) {
    try {
      const w = await p.query("SELECT qid FROM wikidata WHERE bien_id = $1", [b.id]);
      console.log(`Bien ${b.id} ${b.denominacion} → qids:`, w.rows.map(x => x.qid));
    } catch(e) { console.log('err', e.message); break; }
  }

  await p.end();
})();
