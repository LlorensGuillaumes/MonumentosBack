/**
 * Lista monumentos ya en BD de los municipios alrededor de Vélez de Benaudalla
 * (Costa Granadina + zonas limítrofes Alpujarra Granadina + Valle de Lecrín).
 * Sirve para evitar duplicados antes de ampliar el catálogo de la zona.
 */
require('dotenv').config();
const { Pool } = require('pg');

const MUNICIPIOS = [
  // Costa Granadina
  'Vélez de Benaudalla',
  'Salobreña',
  'Almuñécar',
  'Motril',
  'Lentegí',
  'Otívar',
  'Jete',
  'Los Guájares',
  'Ítrabo',
  'Molvízar',
  'Lobres',
  'Gualchos',
  'Rubite',
  'Albuñol',
  'Sorvilán',
  'Polopos',
  // Valle de Lecrín / Alpujarra colindante
  'Lanjarón',
  'Órgiva',
  'Lecrín',
  'Béznar',
  'El Pinar',
  'El Valle',
  'Nigüelas',
  'Dúrcal',
  'Padul',
  'Restábal',
  'Pinos del Valle',
];

(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  const client = await p.connect();
  try {
    const r = await client.query(
      `SELECT b.id, b.denominacion, b.municipio, b.tipo_monumento, w.qid
       FROM bienes b
       LEFT JOIN wikidata w ON w.bien_id = b.id
       WHERE b.municipio = ANY($1)
       ORDER BY b.municipio, b.denominacion`,
      [MUNICIPIOS]
    );
    console.log(`\n=== Monumentos ya en BD por municipio (${r.rows.length} total) ===\n`);
    let last = '';
    for (const row of r.rows) {
      if (row.municipio !== last) {
        console.log(`\n[${row.municipio}]`);
        last = row.municipio;
      }
      console.log(`  ${row.id} | ${row.denominacion} | ${row.tipo_monumento || '-'} | ${row.qid || 'sin QID'}`);
    }
    // Resumen por municipio
    const counts = {};
    for (const row of r.rows) counts[row.municipio] = (counts[row.municipio] || 0) + 1;
    console.log(`\n=== Conteo por municipio ===`);
    for (const m of MUNICIPIOS) {
      console.log(`  ${m.padEnd(25)} ${counts[m] || 0}`);
    }
  } finally {
    client.release();
    await p.end();
  }
})();
