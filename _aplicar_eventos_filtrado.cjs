/**
 * Aplica eventos a bienes con dos reglas:
 *   A) Pueblos pequeños (<=50 bienes en municipio): vincular todos
 *   B) Ciudades grandes (>50 bienes): solo bienes cuya fecha (inception o periodo) es <= end del evento
 *      Si bien no tiene fecha alguna, descartar (estricto).
 *
 * Modos: --dry-run (solo reporta), --apply (escribe). Por defecto dry-run.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const APPLY = process.argv.includes('--apply');
const SMALL_TOWN_THRESHOLD = 50;
const TOLERANCIA_AÑOS = 5; // tolerancia hacia el final del evento

// Rangos temporales [start, end] de cada categoría padre
const PADRE_RANGOS = {
  'Q10859':   { nombre: 'Guerra Civil Española',         start: 1936, end: 1939 },
  'Q152499':  { nombre: 'Guerra de Independencia Española', start: 1808, end: 1814 },
  'Q150701':  { nombre: 'Guerra de Sucesión Española',   start: 1701, end: 1714 },
  'Q79791':   { nombre: 'Reconquista',                   start: 718,  end: 1492 },
  'Q1178424': { nombre: 'Guerras Carlistas',             start: 1833, end: 1876 },
  'Q1501724': { nombre: 'Guerra de Restauración portuguesa', start: 1640, end: 1668 },
  'Q2105495': { nombre: 'Crisis 1383-1385 (Portugal)',   start: 1383, end: 1385 },
  'Q164432':  { nombre: 'Guerra de los Ochenta Años',    start: 1568, end: 1648 },
  'Q51657':   { nombre: 'Cruzada albigense',             start: 1209, end: 1229 },
  'Q78994':   { nombre: 'Guerras Napoleónicas',          start: 1803, end: 1815 },
  'Q362':     { nombre: 'Segunda Guerra Mundial',        start: 1939, end: 1945 },
};

// Mapping periodo → [year_start, year_end] aproximado
const PERIODO_RANGOS = {
  'Prehistoria':         [-100000, -1000],
  'Antiguo / Romano':    [-1000,    500],
  'Prerrománico':        [500,     1000],
  'Románico':            [1000,    1200],
  'Mudéjar':             [800,     1500],
  'Gótico':              [1200,    1500],
  'Renacimiento':        [1400,    1600],
  'Barroco':             [1600,    1750],
  'Neoclásico':          [1750,    1830],
  'Modernismo':          [1880,    1920],
  'Contemporáneo':       [1789,    2025],
};

function inceptionYear(s) {
  if (!s) return null;
  const m = s.match(/^(-?\d{1,4})/);
  return m ? parseInt(m[1], 10) : null;
}

function periodoEnd(s) {
  if (!s) return null;
  if (PERIODO_RANGOS[s]) return PERIODO_RANGOS[s][1];
  // "Siglo XVI", "Siglos XII-XIV", "1456-1507"...
  const r = s.match(/(\d{3,4})\s*[-–—]\s*(\d{3,4})/);
  if (r) return parseInt(r[2], 10);
  const single = s.match(/(\d{3,4})/);
  if (single) return parseInt(single[1], 10);
  return null;
}

function bienEsAnteriorOContemporaneo(bien, eventoEnd) {
  const incY = inceptionYear(bien.inception);
  if (incY !== null) return incY <= eventoEnd + TOLERANCIA_AÑOS;
  const perEnd = periodoEnd(bien.periodo);
  if (perEnd !== null) return perEnd >= /* algún año en ventana */ -100000 && inceptionYear(bien.inception) === null
    ? perEnd <= eventoEnd + 100 // mucha tolerancia para periodos por su naturaleza
    : true;
  return false; // sin info → estricto, descartar
}

// Versión más simple y correcta:
function shouldLink(bien, eventoEnd) {
  const incY = inceptionYear(bien.inception);
  if (incY !== null) {
    return incY <= eventoEnd + TOLERANCIA_AÑOS;
  }
  // No tiene inception, mirar periodo
  if (bien.periodo) {
    const range = PERIODO_RANGOS[bien.periodo];
    if (range) {
      // Aceptar si el periodo empieza antes del fin del evento
      // (es decir, el bien podría existir cuando ocurrió el evento)
      return range[0] <= eventoEnd + TOLERANCIA_AÑOS;
    }
  }
  return false; // sin info usable → descartar
}

const matches = JSON.parse(fs.readFileSync('_eventos_match_municipios.json', 'utf8'));

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  const client = await p.connect();

  const resumen = { porPadre: {}, totalLinks: 0, descartadosFecha: 0, descartadosSinInfo: 0 };
  const linksToInsert = [];

  for (const m of matches) {
    const padreInfo = PADRE_RANGOS[m.qidPadre];
    if (!padreInfo) continue;

    // Bienes del municipio
    const r = await client.query(`
      SELECT b.id, b.denominacion, b.periodo, w.inception
      FROM bienes b
      LEFT JOIN wikidata w ON w.bien_id = b.id
      WHERE LOWER(TRIM(b.municipio)) = $1
    `, [m.municipioMatch]);

    const bienes = r.rows;
    const isSmallTown = bienes.length <= SMALL_TOWN_THRESHOLD;
    let linkedThisEvent = 0;
    let descByFecha = 0;
    let descSinInfo = 0;

    for (const b of bienes) {
      let link = false;
      if (isSmallTown) {
        link = true; // small town: vincular todos
      } else {
        // Ciudad grande: filtrar por fecha
        const incY = inceptionYear(b.inception);
        if (incY !== null) {
          if (incY <= padreInfo.end + TOLERANCIA_AÑOS) link = true;
          else descByFecha++;
        } else if (b.periodo) {
          const range = PERIODO_RANGOS[b.periodo];
          if (range) {
            if (range[0] <= padreInfo.end + TOLERANCIA_AÑOS) link = true;
            else descByFecha++;
          } else {
            // periodo desconocido → descartar
            descSinInfo++;
          }
        } else {
          descSinInfo++;
        }
      }

      if (link) {
        linksToInsert.push({
          bien_id: b.id,
          qid_evento: m.qidEvento,
          evento: m.eventoLabel,
          qid_evento_padre: m.qidPadre,
        });
        linkedThisEvent++;
      }
    }

    if (!resumen.porPadre[m.qidPadre]) resumen.porPadre[m.qidPadre] = { nombre: padreInfo.nombre, links: 0, descByFecha: 0, descSinInfo: 0, eventos: 0 };
    resumen.porPadre[m.qidPadre].links += linkedThisEvent;
    resumen.porPadre[m.qidPadre].descByFecha += descByFecha;
    resumen.porPadre[m.qidPadre].descSinInfo += descSinInfo;
    resumen.porPadre[m.qidPadre].eventos++;
    resumen.totalLinks += linkedThisEvent;
    resumen.descartadosFecha += descByFecha;
    resumen.descartadosSinInfo += descSinInfo;
  }

  console.log(`\n${APPLY ? 'APLICANDO' : 'DRY-RUN'} - Total a vincular: ${resumen.totalLinks}`);
  console.log(`Descartados por fecha: ${resumen.descartadosFecha}`);
  console.log(`Descartados sin info temporal: ${resumen.descartadosSinInfo}`);
  console.log('\nPor categoría padre:');
  for (const [qid, r] of Object.entries(resumen.porPadre)) {
    console.log(`  ${qid} ${r.nombre}: ${r.links} links | desc fecha: ${r.descByFecha} | desc sin info: ${r.descSinInfo} | ${r.eventos} eventos`);
  }

  if (!APPLY) {
    fs.writeFileSync('_eventos_links_preview.json', JSON.stringify(linksToInsert.slice(0, 100), null, 2));
    console.log(`\n→ Sample 100 en _eventos_links_preview.json`);
    client.release(); await p.end();
    return;
  }

  // APPLY: insertar/upsert en eventos_monumento
  console.log('\nInsertando...');
  await client.query('BEGIN');
  try {
    let inserted = 0;
    for (const l of linksToInsert) {
      // upsert: evitar duplicados (bien_id, qid_evento)
      const r = await client.query(`
        INSERT INTO eventos_monumento (bien_id, evento, qid_evento, qid_evento_padre, fuente)
        SELECT $1, $2, $3, $4, 'wikidata-match-municipio'
        WHERE NOT EXISTS (
          SELECT 1 FROM eventos_monumento WHERE bien_id = $1 AND qid_evento = $3
        )
      `, [l.bien_id, l.evento, l.qid_evento, l.qid_evento_padre]);
      inserted += r.rowCount;
    }
    await client.query('COMMIT');
    console.log(`Insertados nuevos: ${inserted}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERR:', e.message);
  }

  client.release(); await p.end();
})();
