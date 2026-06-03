// Detallar matches por (evento, municipio, n_bienes) tras filtrado
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const PADRE_RANGOS = {
  'Q10859':   { nombre: 'Guerra Civil Española',         end: 1939 },
  'Q152499':  { nombre: 'Guerra de Independencia',       end: 1814 },
  'Q150701':  { nombre: 'Guerra de Sucesión',            end: 1714 },
  'Q79791':   { nombre: 'Reconquista',                   end: 1492 },
  'Q1178424': { nombre: 'Guerras Carlistas',             end: 1876 },
  'Q1501724': { nombre: 'Guerra Restauración portuguesa', end: 1668 },
  'Q2105495': { nombre: 'Crisis 1383-1385',              end: 1385 },
  'Q164432':  { nombre: 'Guerra Ochenta Años',           end: 1648 },
  'Q51657':   { nombre: 'Cruzada albigense',             end: 1229 },
  'Q78994':   { nombre: 'Guerras Napoleónicas',          end: 1815 },
  'Q362':     { nombre: 'Segunda Guerra Mundial',        end: 1945 },
};

const PERIODO_RANGOS = {
  'Prehistoria':[-100000,-1000],'Antiguo / Romano':[-1000,500],'Prerrománico':[500,1000],
  'Románico':[1000,1200],'Mudéjar':[800,1500],'Gótico':[1200,1500],'Renacimiento':[1400,1600],
  'Barroco':[1600,1750],'Neoclásico':[1750,1830],'Modernismo':[1880,1920],'Contemporáneo':[1789,2025],
};

function incY(s) { if(!s) return null; const m=s.match(/^(-?\d{1,4})/); return m?parseInt(m[1],10):null; }
function shouldLink(b, end) {
  const i = incY(b.inception); if (i!==null) return i <= end+5;
  if (b.periodo) { const r = PERIODO_RANGOS[b.periodo]; if (r) return r[0] <= end+5; }
  return false;
}

const matches = JSON.parse(fs.readFileSync('_eventos_match_municipios.json','utf8'));

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  const rep = [];
  for (const m of matches) {
    const padreInfo = PADRE_RANGOS[m.qidPadre];
    if (!padreInfo) continue;
    const r = await p.query(`SELECT b.id, b.periodo, w.inception FROM bienes b LEFT JOIN wikidata w ON w.bien_id=b.id WHERE LOWER(TRIM(b.municipio))=$1`, [m.municipioMatch]);
    const total = r.rows.length;
    const isSmall = total <= 50;
    let linked = 0;
    if (isSmall) linked = total;
    else for (const b of r.rows) if (shouldLink(b, padreInfo.end)) linked++;
    rep.push({ padre: padreInfo.nombre, evento: m.eventoLabel, qid: m.qidEvento, municipio: m.municipioMatch, total, linked, small: isSmall });
  }
  // Ordenar por linked desc
  rep.sort((a,b) => b.linked - a.linked);
  console.log('Top 30 (evento, municipio) por bienes vinculados:');
  rep.slice(0, 30).forEach(r => console.log(`  [${r.padre}] ${r.evento} → ${r.municipio}: ${r.linked}/${r.total} ${r.small?'(small town: todos)':''}`));
  fs.writeFileSync('_eventos_breakdown.json', JSON.stringify(rep, null, 2));
  console.log('\n→ _eventos_breakdown.json');
  await p.end();
})();
