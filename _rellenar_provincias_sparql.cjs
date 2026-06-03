/**
 * Rellena provincia en bienes pluriprovinciales con provincia NULL.
 * SPARQL por batches: para cada QID, obtener su provincia (P131* → item con P31=Q24732).
 *
 * Uso:
 *   node _rellenar_provincias_sparql.cjs            # dry-run
 *   node _rellenar_provincias_sparql.cjs --apply    # ejecuta UPDATEs
 *   node _rellenar_provincias_sparql.cjs --ccaa=Galicia --apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const ccaaFilter = (args.find(a => a.startsWith('--ccaa=')) || '').split('=')[1] || null;
const BATCH_SIZE = 100;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// CCAA pluriprovinciales objetivo
const CCAA_TARGET = [
  'Andalucía', 'Aragón', 'Canarias', 'Castilla y León', 'Castilla-La Mancha',
  'Catalunya', 'Comunitat Valenciana', 'Extremadura', 'Galicia', 'País Vasco',
];

// Mapeo nombre canónico final → variantes Wikidata
// (Wikidata devuelve labels en español tipo "provincia de Lugo" → queremos "Lugo")
function limpiarProvincia(label) {
  if (!label) return null;
  // "provincia de Lugo" / "Provincia de Lugo" → "Lugo"
  let s = label.replace(/^[Pp]rovincia (de |d')/, '').trim();
  // Mapeos especiales: País Vasco oficial
  const ESPECIAL = {
    'Vizcaya':   'Bizkaia',
    'Guipúzcoa': 'Gipuzkoa',
    'Guipuzcoa': 'Gipuzkoa',
    'Álava':     'Álava',
    'Alava':     'Álava',
    'Orense':    'Ourense',
    'La Coruña': 'A Coruña',
    'Lérida':    'Lleida',
    'Gerona':    'Girona',
  };
  return ESPECIAL[s] || s;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'PatrimonioEuropeoBot/1.0 (provincia enrichment)',
      },
    });
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      await sleep(3000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`SPARQL ${res.status}: ${(await res.text()).slice(0,200)}`);
    return res.json();
  }
  throw new Error('SPARQL max retries');
}

// Query batch: para cada QID, encuentra provincia ancestral (P131*)
function buildBatchQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  return `
    SELECT ?item ?prov ?provLabel WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P131* ?prov .
      ?prov wdt:P31 wd:Q162620 .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es" }
    }
  `;
}

async function procesarBatch(qids) {
  const data = await sparql(buildBatchQuery(qids));
  const map = new Map(); // qid → provincia limpia
  for (const b of data.results.bindings) {
    const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
    const provLabel = b.provLabel?.value;
    if (qid && provLabel && !map.has(qid)) {
      map.set(qid, limpiarProvincia(provLabel));
    }
  }
  return map;
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}${ccaaFilter ? ` | filtro: ${ccaaFilter}` : ''}\n`);

  const ccaaList = ccaaFilter
    ? CCAA_TARGET.filter(c => c.toLowerCase().includes(ccaaFilter.toLowerCase()))
    : CCAA_TARGET;

  let totalResueltos = 0, totalIntentados = 0, totalNoResueltos = 0;

  for (const ccaa of ccaaList) {
    console.log(`\n══ ${ccaa} ══`);
    const r = await pool.query(`
      SELECT b.id, w.qid FROM bienes b
      INNER JOIN wikidata w ON w.bien_id = b.id
      WHERE b.pais='España' AND b.comunidad_autonoma=$1 AND b.provincia IS NULL
      ORDER BY b.id
    `, [ccaa]);
    const items = r.rows;
    console.log(`  Bienes con provincia NULL: ${items.length}`);
    if (items.length === 0) continue;

    totalIntentados += items.length;
    const resoluciones = new Map(); // bien_id → provincia

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const qids = [...new Set(batch.map(b => b.qid))];
      try {
        const provMap = await procesarBatch(qids);
        for (const it of batch) {
          const prov = provMap.get(it.qid);
          if (prov) resoluciones.set(it.id, prov);
        }
        process.stdout.write(`    [${Math.min(i + BATCH_SIZE, items.length)}/${items.length}]\r`);
      } catch (e) {
        console.log(`\n    ⚠ batch fallido: ${e.message.slice(0, 80)}`);
      }
      await sleep(1200);
    }
    console.log();

    console.log(`  Resueltos: ${resoluciones.size} / ${items.length}`);
    totalResueltos += resoluciones.size;
    totalNoResueltos += (items.length - resoluciones.size);

    // Mostrar distribución por provincia detectada
    const dist = new Map();
    for (const prov of resoluciones.values()) dist.set(prov, (dist.get(prov) || 0) + 1);
    console.log('  Distribución:');
    [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([p, n]) =>
      console.log(`    ${String(n).padStart(5)}  ${p}`)
    );

    if (!DRY_RUN && resoluciones.size > 0) {
      // UPDATE por lotes
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const [bienId, prov] of resoluciones) {
          await client.query(
            `UPDATE bienes SET provincia=$1 WHERE id=$2`,
            [prov, bienId]
          );
        }
        await client.query('COMMIT');
        console.log(`  ✓ ${resoluciones.size} UPDATEs aplicados`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ROLLBACK: ${e.message}`);
      } finally {
        client.release();
      }
    }
  }

  console.log('\n═══ RESUMEN ═══');
  console.log(`  Total intentados:  ${totalIntentados}`);
  console.log(`  Resueltos:         ${totalResueltos}`);
  console.log(`  No resueltos:      ${totalNoResueltos}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
