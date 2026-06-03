require('dotenv').config();
const db = require('./db.cjs');

const STOPWORDS = new Set(['el','la','los','las','un','una','de','del','en','y','o','que','a','por','con','para','sobre','este','esta','ese','esa','qué','quién','cómo','cuándo','dónde','hay','tienen','tiene']);

function extraerPalabrasClave(q) {
  return q.toLowerCase().replace(/[¿?¡!.,;:()"']/g,' ').split(/\s+/).filter(w=>w.length>=3&&!STOPWORDS.has(w));
}

async function buscar(question) {
  const palabras = extraerPalabrasClave(question);
  if (palabras.length === 0) return [];
  const ilikeConds = palabras.map((_,i)=>`b.denominacion ILIKE $${i+1}`).join(' OR ');
  const personaConds = palabras.map((_,i)=>`bp.nombre ILIKE $${i+1}`).join(' OR ');
  const params = palabras.map(p=>`%${p}%`);
  const qIdx = params.length + 1;
  params.push(question);
  const r = await db.query(`
    WITH matches AS (
      SELECT b.id, similarity(LOWER(b.denominacion), LOWER($${qIdx})) AS sim, 'denom' AS via
      FROM bienes b WHERE ${ilikeConds}
      UNION
      SELECT DISTINCT bp.bien_id, GREATEST(similarity(LOWER(bp.nombre), LOWER($${qIdx})), 0.4) AS sim, 'persona' AS via
      FROM bien_personas bp WHERE ${personaConds}
    ), ranked AS (
      SELECT id, MAX(sim) AS sim, STRING_AGG(DISTINCT via, ',') AS via_list
      FROM matches GROUP BY id ORDER BY MAX(sim) DESC LIMIT 10
    )
    SELECT b.id, b.denominacion, b.municipio, b.pais, r.sim, r.via_list
    FROM ranked r JOIN bienes b ON b.id = r.id
    ORDER BY r.sim DESC
  `, params);
  return r.rows;
}

(async () => {
  for (const q of ['¿Quién es Josep Cañas?', 'Háblame de la Sagrada Familia', 'Catedral de Burgos', 'obras de Gaudí']) {
    console.log(`\n=== "${q}" ===`);
    const rs = await buscar(q);
    rs.slice(0,5).forEach(r => console.log(`  [${r.via_list}] #${r.id}  ${r.denominacion}  (${r.municipio||'?'})  sim=${r.sim?.toFixed(2)}`));
  }
  process.exit(0);
})();
