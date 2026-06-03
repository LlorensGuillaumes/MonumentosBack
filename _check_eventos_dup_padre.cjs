require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query(`
    SELECT qid_evento, MIN(evento) label, COUNT(DISTINCT qid_evento_padre) padres,
           STRING_AGG(DISTINCT qid_evento_padre, ', ') padres_lista,
           COUNT(*) filas
    FROM eventos_monumento
    WHERE qid_evento IS NOT NULL AND qid_evento_padre IS NOT NULL
    GROUP BY qid_evento
    HAVING COUNT(DISTINCT qid_evento_padre) > 1
    ORDER BY filas DESC
  `);
  console.log(`Eventos con múltiples padres: ${r.rows.length}`);
  r.rows.forEach(x => console.log(`  ${x.qid_evento} ${(x.label||'').slice(0,45).padEnd(45)} | padres: [${x.padres_lista}] | filas: ${x.filas}`));

  await p.end();
})();
