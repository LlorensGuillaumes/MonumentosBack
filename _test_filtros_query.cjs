require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  for (const [campo, lim] of [['propietario',5],['religion',5],['dedicado_a',5],['parte_de',5]]) {
    const sql = `
      SELECT value, COUNT(*) as count FROM (
        SELECT TRIM(unnest(string_to_array(w.${campo}, '|'))) as value
        FROM wikidata w JOIN bienes b ON w.bien_id = b.id
        WHERE w.${campo} IS NOT NULL AND w.${campo} != '' AND 1=1
      ) sub
      WHERE value <> ''
      GROUP BY value
      ORDER BY count DESC LIMIT ${lim}
    `;
    try {
      const r = await pool.query(sql);
      console.log(`\n=== ${campo} (${r.rows.length} top) ===`);
      r.rows.forEach(x => console.log(`  ${x.count}  ${x.value}`));
    } catch (e) {
      console.log(`${campo} ERROR:`, e.message);
    }
  }
  await pool.end();
})();
