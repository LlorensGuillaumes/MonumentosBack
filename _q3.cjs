require('dotenv').config();
const { Pool } = require('pg');
const ALT_PENEDES = ['Vilafranca del Penedès','Sant Sadurní d\'Anoia','Avinyonet del Penedès','Cabanyes (Les)','Castellet i la Gornal','Castellví de la Marca','Font-rubí','Gelida','Granada (La)','Mediona','Olèrdola','Olesa de Bonesvalls','Pacs del Penedès','Pla del Penedès (El)','Pontons','Puigdàlber','Sant Cugat Sesgarrigues','Sant Llorenç d\'Hortons','Sant Martí Sarroca','Sant Pere de Riudebitlles','Sant Quintí de Mediona','Santa Fe del Penedès','Santa Margarida i els Monjos','Subirats','Torrelavit','Torrelles de Foix','Vilobí del Penedès'];
const BAIX_PENEDES = ['El Vendrell','Vendrell (El)','Albinyana','Arboç (L\')','L\'Arboç','Banyeres del Penedès','Bellvei','Bisbal del Penedès (La)','Bonastre','Calafell','Cunit','Llorenç del Penedès','Masllorenç','Montmell (El)','El Montmell','Salomó','Sant Jaume dels Domenys','Santa Oliva'];
const GARRAF = ['Sitges','Sant Pere de Ribes','Vilanova i la Geltrú','Cubelles','Olivella','Canyelles'];

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } });
  for (const [nom, mun] of [['Alt Penedès', ALT_PENEDES], ['Baix Penedès', BAIX_PENEDES], ['Garraf', GARRAF]]) {
    const r = await p.query(`SELECT COUNT(*) AS n FROM bienes WHERE municipio = ANY($1)`, [mun]);
    console.log(`${nom}: ${r.rows[0].n} bienes`);
  }
  const total = await p.query(`SELECT COUNT(*) AS n FROM bienes WHERE municipio = ANY($1)`, [[...ALT_PENEDES, ...BAIX_PENEDES, ...GARRAF]]);
  console.log(`\nTOTAL: ${total.rows[0].n}`);

  // Detalle municipios Baix Penedès (que sospecho pobre)
  const det = await p.query(`SELECT municipio, COUNT(*) AS n FROM bienes WHERE municipio = ANY($1) GROUP BY municipio ORDER BY n DESC`, [BAIX_PENEDES]);
  console.log('\nDetalle Baix Penedès:');
  for (const r of det.rows) console.log(`  ${r.municipio.padEnd(30)} ${r.n}`);
  await p.end();
})();
