require('dotenv').config();
const { Pool } = require('pg');
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });
  // Sin tildes
  const c = await p.query(`SELECT comarca, COUNT(*) AS n FROM bienes WHERE comarca ILIKE 'alt penedes' OR comarca ILIKE 'baix penedes' OR comarca ILIKE 'garraf' GROUP BY comarca`);
  console.log('Sin tildes:');
  for (const r of c.rows) console.log(`  "${r.comarca}" → ${r.n}`);

  // Buscar todas las comarcas únicas que contengan substring penedes o garraf, case-insensitive, sin acentos
  const all = await p.query(`
    SELECT DISTINCT comarca FROM bienes
    WHERE comarca IS NOT NULL
    AND (LOWER(comarca) LIKE '%penede%' OR LOWER(comarca) LIKE '%garraf%')
  `);
  console.log('\nTotal variantes con penede/garraf:', all.rowCount);
  for (const r of all.rows) console.log(`  "${r.comarca}"`);

  // Por municipio (más fiable): Vilafranca = Alt Penedes, Sitges/SantPereRibes = Garraf, Vendrell/Calafell = Baix Penedes
  const m = await p.query(`
    SELECT municipio, COUNT(*) AS n FROM bienes
    WHERE municipio IN ('Vilafranca del Penedès', 'Sant Sadurní d''Anoia', 'Sitges', 'Sant Pere de Ribes', 'Vilanova i la Geltrú', 'El Vendrell', 'Calafell', 'Cubelles', 'Olèrdola', 'Sant Cugat Sesgarrigues', 'Sant Quintí de Mediona', 'Pacs del Penedès', 'Vilobí del Penedès', 'Subirats')
    GROUP BY municipio ORDER BY n DESC
  `);
  console.log('\nPor municipios típicos Penedès+Garraf:');
  for (const r of m.rows) console.log(`  ${r.municipio.padEnd(30)} ${r.n}`);
  console.log(`Total: ${m.rows.reduce((a,r) => a + parseInt(r.n), 0)}`);

  await p.end();
})();
