/**
 * v2 — Reglas:
 *   A) Pueblos pequeños (<=50 bienes): vincular todos los pre-evento
 *   B) Ciudades grandes (>50 bienes): solo bienes con tipo_monumento militar/defensivo/conmemorativo Y pre-evento
 *
 * Modos: dry-run (default), --apply
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const APPLY = process.argv.includes('--apply');
const SMALL_TOWN_THRESHOLD = 50;
const TOL = 5;

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

// Tipos relevantes en una batalla / asedio (para ciudades grandes)
const TIPOS_BATALLA = new Set([
  'Castillo / Fortaleza',
  'Torre',
  'Muralla',
  'Palacio',
  'Puente',
  'Monumento conmemorativo',
  'Monumento',
  'Catedral',
  'Conjunto arquitectónico',
  'Monasterio / Convento',
]);

function incY(s) { if(!s) return null; const m=s.match(/^(-?\d{1,4})/); return m?parseInt(m[1],10):null; }
function bienAnterior(b, end) {
  const i = incY(b.inception); if (i!==null) return i <= end+TOL;
  if (b.periodo) { const r = PERIODO_RANGOS[b.periodo]; if (r) return r[0] <= end+TOL; }
  return false;
}

const matches = JSON.parse(fs.readFileSync('_eventos_match_municipios.json','utf8'));

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  const client = await p.connect();

  const resumen = { porPadre: {}, total: 0 };
  const links = [];

  for (const m of matches) {
    const padreInfo = PADRE_RANGOS[m.qidPadre];
    if (!padreInfo) continue;

    const r = await client.query(`
      SELECT b.id, b.tipo_monumento, b.periodo, w.inception
      FROM bienes b
      LEFT JOIN wikidata w ON w.bien_id = b.id
      WHERE LOWER(TRIM(b.municipio)) = $1
    `, [m.municipioMatch]);

    const bienes = r.rows;
    const isSmallTown = bienes.length <= SMALL_TOWN_THRESHOLD;
    let n = 0;

    for (const b of bienes) {
      if (!bienAnterior(b, padreInfo.end)) continue;
      // Ciudad grande → restringir a tipos batalla
      if (!isSmallTown && !TIPOS_BATALLA.has(b.tipo_monumento)) continue;
      links.push({ bien_id: b.id, qid_evento: m.qidEvento, evento: m.eventoLabel, qid_evento_padre: m.qidPadre });
      n++;
    }

    if (!resumen.porPadre[m.qidPadre]) resumen.porPadre[m.qidPadre] = { nombre: padreInfo.nombre, links: 0, eventos: 0 };
    resumen.porPadre[m.qidPadre].links += n;
    resumen.porPadre[m.qidPadre].eventos++;
    resumen.total += n;
  }

  console.log(`\n${APPLY ? 'APLICANDO' : 'DRY-RUN'} v2 - Total a vincular: ${resumen.total}`);
  for (const [qid, r] of Object.entries(resumen.porPadre)) {
    console.log(`  ${qid} ${r.nombre}: ${r.links} links | ${r.eventos} eventos`);
  }

  // Top eventos
  const cnt = {};
  for (const l of links) cnt[l.qid_evento] = (cnt[l.qid_evento]||0) + 1;
  const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,20);
  const labelsByQid = Object.fromEntries(links.map(l => [l.qid_evento, l.evento]));
  console.log('\nTop 20 eventos por links:');
  for (const [qid, n] of top) console.log(`  ${qid} ${labelsByQid[qid]}: ${n}`);

  if (!APPLY) {
    fs.writeFileSync('_eventos_links_v2_preview.json', JSON.stringify(links.slice(0,200), null, 2));
    client.release(); await p.end();
    return;
  }

  console.log('\nInsertando...');
  await client.query('BEGIN');
  try {
    let ins = 0;
    for (const l of links) {
      const r = await client.query(`
        INSERT INTO eventos_monumento (bien_id, evento, qid_evento, qid_evento_padre, fuente)
        SELECT $1, $2, $3, $4, 'wikidata-match-v2'
        WHERE NOT EXISTS (SELECT 1 FROM eventos_monumento WHERE bien_id = $1 AND qid_evento = $3)
      `, [l.bien_id, l.evento, l.qid_evento, l.qid_evento_padre]);
      ins += r.rowCount;
    }
    await client.query('COMMIT');
    console.log(`Insertados nuevos: ${ins}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERR:', e.message);
  }
  client.release(); await p.end();
})();
