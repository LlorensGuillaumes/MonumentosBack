/**
 * Parsea el inventario "Monumentos sacros en llamas" (Martí Bonet 1938)
 * y hace match con bienes de BD para vincular a Guerra Civil Española.
 *
 * Uso:
 *   node _parsear_llamas_gc.cjs           # parse + match + dry-run
 *   node _parsear_llamas_gc.cjs --apply   # inserta en eventos_monumento
 */
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const SRC = require('path').join(__dirname, '_llamas_full.txt');
const QID_GC = 'Q10859';        // Guerra Civil Española (padre)
const QID_REPRESION = 'Q3772343'; // Persecución/Represión en zona republicana (sub-evento)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Detectar estado/papel del bien según descripción
function clasificar(desc) {
  const d = (desc || '').toLowerCase();
  if (/incendiad[oa]|incendio|en llamas|quemad|destrui|en ruinas|ruinoso|derribad|demolid|arrasad/.test(d)) return 'destruido';
  if (/saquead|despojad|incautad|destruido el|robad/.test(d)) return 'saqueado';
  if (/refugiad|hospital|cuartel|comit[eé]|sindicato|partido|escuela|almac[eé]n|mercado|granja|vaquer|cooperativ/.test(d)) return 'incautado';
  if (/intact[oa]|conservad|buen estado|cerrad/.test(d)) return 'conservado';
  return 'mencionado';
}

// Lista de prefijos de tipos de edificios religiosos (heurística)
const TIPOS_RE = /^(iglesias?|parroquia(les?)?|capilla|ermita|conventos?|monasterios?|cartuja|catedral|abad[ií]a|colegio|seminario|santuario|oratorio|casa rectoral|sant[oa]\s|saint\s|cofrad|hospital|hospederí|noviciado|palacio episcopal|or fanato|asilo)/i;

function parsePdf() {
  const text = fs.readFileSync(SRC, 'utf8');
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const entradas = [];
  let currentMun = null;
  let currentLineas = []; // líneas acumuladas para el municipio actual
  let stats = { hdrs: 0, items: 0, lines: lines.length };

  function procesarMunicipio(mun, linesArr) {
    const fullText = linesArr.join(' ');
    // Encontrar ítems: cualquier mención a edificio religioso
    // Estrategia simple: separar por punto y filtrar frases que mencionen un tipo
    // Split por punto pero NO por "S." / "Sta." / "St." seguido de mayúscula (abreviaturas religiosas)
    const oraciones = fullText.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(o => !/^[A-Z]\.\s*$/.test(o));
    for (const o of oraciones) {
      if (TIPOS_RE.test(o)) {
        // El bien es la primera parte hasta el primer verbo o "está"/"es"/"sirve"
        const m = o.match(/^(.{8,80}?)(?:\s+(?:est[áaá]\s|es\s|son\s|sirve|fue\s|han\s|ha\s|sufrió|convertid|fundada|ocupad|cerrad|destruid|incendia|en\s+ruinas|de\s+(?:car[áa]cter|monjas|frailes|hermanas|los|las|el|la)))(.+)?$/i);
        const bien = m ? m[1].trim() : o.slice(0, 80).trim();
        const desc = m && m[2] ? m[2].trim() : o.slice(bien.length).trim();
        if (bien && bien.length >= 8) {
          entradas.push({
            municipio: mun,
            bien: bien.replace(/^(la\s+|el\s+|los\s+|las\s+|una\s+|un\s+)/i, ''),
            desc: desc.slice(0, 300),
            estado: clasificar(desc || bien),
          });
        }
      }
    }
  }

  const limpiarMun = (s) => s.replace(/\s*\([^)]*\)\s*$/, '').replace(/[.,:;]+$/, '').trim();

  for (const line of lines) {
    if (/^(MONUMENTOS SACROS|J\.\s*Mª\s*Martí|Inventario de los edificios)/i.test(line)) continue;
    if (/^\d{1,4}$/.test(line)) continue;

    // Cabecera municipio: "X.Y. Municipio [resto]"
    const mHdr = line.match(/^(\d+\.\d+)\.\s+([^\.;:]+?)(?:\s+(.*))?$/);
    if (mHdr) {
      stats.hdrs++;
      if (currentMun && currentLineas.length) procesarMunicipio(currentMun, currentLineas);
      // El municipio es típicamente las primeras 1-4 palabras antes de "Iglesia/La/El..."
      const candidate = mHdr[2] + (mHdr[3] ? ' ' + mHdr[3] : '');
      // Primero intentar identificar dónde empieza el primer tipo religioso
      const munMatch = candidate.match(/^([A-ZÀ-Úa-zà-ú0-9'’\-\s\(\)]+?)\s+(iglesia|parroqui|capilla|ermita|convento|monasterio|catedral|abad[ií]a|colegio|seminario|santuario|oratorio|casa rectoral|sant[oa]\s|saint\s|cartuja|hospital|la\s+iglesia|el\s+convento|tanto|todos\s+los|seis\s+iglesias|noviciado)/i);
      if (munMatch) {
        currentMun = limpiarMun(munMatch[1]);
        currentLineas = [candidate.slice(munMatch[1].length).trim()];
      } else {
        // Fallback: primeras 1-3 palabras
        const parts = candidate.split(/\s+/);
        currentMun = limpiarMun(parts.slice(0, Math.min(3, parts.length)).join(' '));
        currentLineas = [parts.slice(3).join(' ')];
      }
      continue;
    }

    // Ítem con guion → agregar al municipio actual
    const mItem = line.match(/^[-•—]\s*(.+)$/);
    if (mItem) {
      stats.items++;
      if (currentMun) currentLineas.push(mItem[1]);
      continue;
    }

    // Continuación
    if (currentMun) currentLineas.push(line);
  }
  if (currentMun && currentLineas.length) procesarMunicipio(currentMun, currentLineas);

  console.log(`  (debug) headers=${stats.hdrs}, items=${stats.items}, líneas=${stats.lines}`);
  console.log(`  (debug) entradas totales antes filtro: ${entradas.length}`);

  return entradas.filter(e =>
    e.bien && TIPOS_RE.test(e.bien) && e.municipio && e.municipio.length >= 3 && e.municipio.length < 60
  );
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);
  console.log('Parseando PDF...');
  const entradas = parsePdf();
  console.log(`Entradas extraídas: ${entradas.length}`);
  console.log('\nMuestra primeras 10:');
  entradas.slice(0, 10).forEach((e, i) =>
    console.log(`  [${i+1}] ${e.municipio} | ${e.bien.slice(0,60)} | estado: ${e.estado}`)
  );

  // Distribución por estado
  const distEstado = new Map();
  entradas.forEach(e => distEstado.set(e.estado, (distEstado.get(e.estado) || 0) + 1));
  console.log('\nPor estado:');
  [...distEstado.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

  // Top municipios
  const distMun = new Map();
  entradas.forEach(e => distMun.set(e.municipio, (distMun.get(e.municipio) || 0) + 1));
  console.log(`\nMunicipios distintos: ${distMun.size}`);
  console.log('Top 15 por bienes mencionados:');
  [...distMun.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,n]) =>
    console.log(`  ${String(n).padStart(4)}  ${k}`)
  );

  // MATCH contra BD: por municipio + denominación similar
  console.log('\n=== MATCH contra BD ===');
  const matches = []; // { bien_id, denominacion_bd, entrada }
  let testados = 0, matched = 0;

  // Cargar todos los bienes Catalunya en memoria una vez para evitar miles de queries
  const r = await pool.query(`
    SELECT id, denominacion, municipio FROM bienes
    WHERE pais='España' AND comunidad_autonoma='Catalunya' AND municipio IS NOT NULL
  `);
  console.log(`Bienes Catalunya en BD: ${r.rows.length}`);

  // Index por municipio normalizado
  const porMun = new Map();
  for (const b of r.rows) {
    const k = norm(b.municipio);
    if (!porMun.has(k)) porMun.set(k, []);
    porMun.get(k).push(b);
  }

  const STOPWORDS = new Set([
    'iglesia','parroquia','parroquial','capilla','ermita','convento','monasterio',
    'cartuja','catedral','abadia','colegio','seminario','santuario','oratorio',
    'casa','rectoral','rectoria','del','de','la','el','los','las','san','santa',
    'sant','santo','sta','santas','santos','nuestra','señora','sra','sant',
    'church','chapel','virgen','virgin','sagrado','sagrada','divin','divina',
    'esglesia','seu','catedral','mare','deu','sr',
  ]);

  // Categorías religiosas (compatibles entre sí solo con la misma).
  const RELIG = new Set(['catedral','ermita','capilla','convento','monasterio','santuario','palacio_episcopal','colegio','iglesia','rectoral']);
  // Categorías NO religiosas — incompatibles con religiosas
  const NO_RELIG = new Set(['torre','cementerio','masia','monumento_civil','mercado','palacio_civil','casa_civil','puente','muralla','castillo','fuente','molino']);

  function categoria(name) {
    const n = norm(name);
    // RELIGIOSAS PRIMERO (más específico, priorizan cuando comparten contexto con "font", etc.)
    if (/\bcatedral\b|\bseu\b|\bseo\b/.test(n)) return 'catedral';
    if (/\bermita\b/.test(n)) return 'ermita';
    if (/\bcapilla\b|\bcapella\b|\boratorio\b/.test(n)) return 'capilla';
    if (/\bconvento\b|\bconvent\b|\bcartuja\b/.test(n)) return 'convento';
    if (/\bmonasterio\b|\bmonestir\b|\babad/.test(n)) return 'monasterio';
    if (/\bsantuario\b|\bsantuari\b/.test(n)) return 'santuario';
    if (/\bpalacio episcopal\b|\bpalau episcopal\b/.test(n)) return 'palacio_episcopal';
    if (/\bcolegio\b|\bcol\.?legi\b|\bseminario\b|\bseminari\b|\bnoviciado\b/.test(n)) return 'colegio';
    if (/\biglesia\b|\besglesia\b|\bparroqui|\bparr[oò]quia/.test(n)) return 'iglesia';
    if (/\bcasa rectoral\b|\brectoria\b/.test(n)) return 'rectoral';
    // Advocaciones puras → asumir iglesia
    if (/^(sant|santa|sants|santas|san|sta)\s+[a-záéíóúïü]/i.test(n) && !/torre|masia|cementer|mercat|residencia|font|castell|molino|moli/.test(n)) {
      return 'iglesia';
    }
    if (/^mare de deu|^mare de d[eé]u|^verge\s|^virgen\s|^nuestra señora/.test(n)) return 'iglesia';
    // NO religiosas
    if (/\bcementer|\bcementiri\b/.test(n)) return 'cementerio';
    if (/\bmercad|\bmercat\b/.test(n)) return 'mercado';
    if (/\bmas[ií]a\b|\bmasi\b/.test(n)) return 'masia';
    if (/\bpaller\b|\bcab[aá]nya\b/.test(n)) return 'masia';
    if (/\bmolino\b|\bmol[ií]\b/.test(n)) return 'molino';
    if (/\bfuente\b|\bfont\b/.test(n)) return 'fuente';
    if (/\bpuente\b|\bpont\b|\baqued|\baqüed/.test(n)) return 'puente';
    if (/\bmuralla\b|\bmurall/.test(n)) return 'muralla';
    if (/\bcastillo\b|\bcastell\b/.test(n)) return 'castillo';
    if (/\bresidencia geri|\bgeri[aá]tric/.test(n)) return 'residencia_civil';
    if (/\bhospital\b/.test(n)) return 'hospital_civil';
    if (/\btorre\b/.test(n)) return 'torre';
    if (/\bcreu de terme\b|\bcreu \b/.test(n)) return 'cruz_terme';
    return null;
  }

  // Compatibilidad entre categorías
  function categoriasCompatibles(cA, cB) {
    if (!cA || !cB) return null; // null = no decidible, deja pasar
    if (cA === cB) return true;
    const aRel = RELIG.has(cA), bRel = RELIG.has(cB);
    const aNo = NO_RELIG.has(cA), bNo = NO_RELIG.has(cB);
    // Religioso vs no-religioso: rechazar
    if ((aRel && bNo) || (aNo && bRel)) return false;
    // Misma "familia" no-religiosa pero distinta: rechazar
    if (aNo && bNo) return false;
    // Distintas religiosas (ermita vs convento): rechazar — son edificios distintos
    if (aRel && bRel) return false;
    return null;
  }

  function nombreMatch(bdName, pdfName) {
    const a = norm(bdName), b = norm(pdfName);
    if (!a || !b) return false;
    const cA = categoria(bdName), cB = categoria(pdfName);
    // Si ambas categorías son conocidas y distintas → rechazar
    if (cA && cB && cA !== cB) return false;
    // Si PDF es religioso, BD también debe serlo (no null, no civil)
    if (cB && RELIG.has(cB) && (!cA || !RELIG.has(cA))) return false;
    // Si BD es religioso, PDF también
    if (cA && RELIG.has(cA) && (!cB || !RELIG.has(cB))) return false;
    if (a === b) return true;
    const ta = new Set(a.split(' ').filter(w => w.length >= 4 && !STOPWORDS.has(w)));
    const tb = new Set(b.split(' ').filter(w => w.length >= 4 && !STOPWORDS.has(w)));
    if (ta.size === 0 || tb.size === 0) return false;
    let common = 0;
    for (const t of tb) if (ta.has(t)) common++;
    if (common === 0) return false;
    const ratio = common / Math.min(ta.size, tb.size);
    return ratio >= 0.5;
  }

  for (const e of entradas) {
    testados++;
    const munNorm = norm(e.municipio);
    const candidatos = porMun.get(munNorm) || [];
    if (candidatos.length === 0) continue;
    // Buscar mejor match
    for (const c of candidatos) {
      if (nombreMatch(c.denominacion, e.bien)) {
        matches.push({ bien_id: c.id, denominacion_bd: c.denominacion, entrada: e });
        matched++;
        break;
      }
    }
  }

  console.log(`\nEntradas testadas: ${testados}`);
  console.log(`Matches con BD: ${matched} (${(matched/testados*100).toFixed(1)}%)`);
  console.log('\nMuestra primeros 20 matches:');
  matches.slice(0, 20).forEach((m, i) =>
    console.log(`  [${i+1}] BD #${m.bien_id} "${m.denominacion_bd.slice(0,40)}" ↔ "${m.entrada.bien.slice(0,40)}" (${m.entrada.municipio}) [${m.entrada.estado}]`)
  );

  if (DRY_RUN) {
    fs.writeFileSync('/tmp/llamas_matches_preview.json', JSON.stringify(matches.slice(0, 500), null, 2));
    console.log('\n[DRY-RUN] Sin escribir. Matches guardados en /tmp/llamas_matches_preview.json');
    await pool.end();
    return;
  }

  // Insertar
  console.log('\nInsertando en eventos_monumento...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ins = 0;
    for (const m of matches) {
      const r = await client.query(`
        INSERT INTO eventos_monumento (bien_id, evento, qid_evento, qid_evento_padre, fuente, descripcion)
        SELECT $1, $2, $3, $4, 'marti-bonet-1938', $5
        WHERE NOT EXISTS (SELECT 1 FROM eventos_monumento WHERE bien_id = $1 AND qid_evento = $3)
      `, [
        m.bien_id,
        `Persecución religiosa GC — ${m.entrada.estado}`,
        QID_REPRESION,
        QID_GC,
        m.entrada.desc ? `Inventario 1938 (Martí Bonet): ${m.entrada.desc}`.slice(0, 500) : null,
      ]);
      ins += r.rowCount;
    }
    await client.query('COMMIT');
    console.log(`✓ Insertados: ${ins}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
  } finally {
    client.release();
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
