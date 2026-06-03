/**
 * Pipeline limpio: vincula bien ↔ evento solo si Wikidata tiene
 * el item ?item con wdt:P793 ?event (significant event).
 *
 * Para cada evento obtenido, intenta inferir el padre vía P361 (part of)
 * o P3831 (part of the series).
 *
 * Uso:
 *   node _aplicar_eventos_p793.cjs           # dry-run
 *   node _aplicar_eventos_p793.cjs --apply
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const BATCH_SIZE = 100;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PE/1.0 (P793 events)' },
    });
    if ([429,502,503,504].includes(res.status)) { await sleep(3000*(i+1)); continue; }
    if (!res.ok) throw new Error(`SPARQL ${res.status}`);
    return res.json();
  }
  throw new Error('max retries');
}

function buildBatchQuery(qids) {
  const values = qids.map(q => `wd:${q}`).join(' ');
  return `
    SELECT ?item ?event ?eventLabel ?parent ?parentLabel WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P793 ?event .
      OPTIONAL {
        ?event wdt:P361 ?parent .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" }
    }
  `;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  // Bienes con QID, sin evento todavía
  const r = await pool.query(`
    SELECT b.id, w.qid FROM bienes b
    INNER JOIN wikidata w ON w.bien_id=b.id
    WHERE b.pais='España' AND w.qid IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM eventos_monumento em WHERE em.bien_id=b.id)
    ORDER BY b.id
  `);
  console.log(`Candidatos: ${r.rows.length}`);
  if (r.rows.length === 0) { await pool.end(); return; }

  const qidToBienIds = new Map();
  r.rows.forEach(x => {
    if (!qidToBienIds.has(x.qid)) qidToBienIds.set(x.qid, []);
    qidToBienIds.get(x.qid).push(x.id);
  });

  const links = [];      // {bien_id, evento, qid_evento, qid_evento_padre}
  const eventTally = new Map(); // qid_evento → {label, n, qid_padre, padre_label}
  const allQids = [...qidToBienIds.keys()];
  let resueltos = 0;

  for (let i = 0; i < allQids.length; i += BATCH_SIZE) {
    const batch = allQids.slice(i, i + BATCH_SIZE);
    try {
      const data = await sparql(buildBatchQuery(batch));
      // Por QID y por evento, juntar primer parent encontrado
      const perQid = new Map(); // qid → Map(eventQid → {eventLabel, parentQid, parentLabel})
      for (const b of data.results.bindings) {
        const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
        const eventQid = b.event.value.replace('http://www.wikidata.org/entity/', '');
        const eventLabel = b.eventLabel?.value || null;
        const parentQid = b.parent?.value?.replace('http://www.wikidata.org/entity/', '') || null;
        const parentLabel = b.parentLabel?.value || null;
        if (!perQid.has(qid)) perQid.set(qid, new Map());
        if (!perQid.get(qid).has(eventQid)) {
          perQid.get(qid).set(eventQid, { eventLabel, parentQid, parentLabel });
        }
      }
      // Para cada QID, replicar links sobre todos sus bien_ids
      for (const [qid, eventMap] of perQid) {
        const bienIds = qidToBienIds.get(qid) || [];
        for (const [eventQid, info] of eventMap) {
          for (const bid of bienIds) {
            links.push({
              bien_id: bid,
              evento: info.eventLabel || eventQid,
              qid_evento: eventQid,
              qid_evento_padre: info.parentQid,
            });
          }
          if (!eventTally.has(eventQid)) eventTally.set(eventQid, { label: info.eventLabel, n: 0, parentQid: info.parentQid, parentLabel: info.parentLabel });
          eventTally.get(eventQid).n += bienIds.length;
          resueltos += bienIds.length;
        }
      }
      process.stdout.write(`  [${Math.min(i+BATCH_SIZE, allQids.length)}/${allQids.length} qids] links:${links.length}\r`);
    } catch (e) {
      console.log(`\n  ⚠ batch fallido: ${e.message.slice(0,80)}`);
    }
    await sleep(1000);
  }
  console.log();
  console.log(`Bienes vinculados: ${resueltos} | Links totales: ${links.length}`);

  // Top eventos
  console.log('\nTop 20 eventos:');
  [...eventTally.entries()].sort((a,b)=>b[1].n-a[1].n).slice(0,20).forEach(([qid, info]) =>
    console.log(`  ${String(info.n).padStart(5)}  ${qid}  ${(info.label||'').slice(0,40).padEnd(40)}  padre: ${info.parentLabel || '-'}`)
  );

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] No escribo. --apply para insertar.');
    await pool.end();
    return;
  }

  console.log('\nInsertando...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ins = 0;
    for (const l of links) {
      const r = await client.query(`
        INSERT INTO eventos_monumento (bien_id, evento, qid_evento, qid_evento_padre, fuente)
        SELECT $1, $2, $3, $4, 'wikidata-P793'
        WHERE NOT EXISTS (SELECT 1 FROM eventos_monumento WHERE bien_id = $1 AND qid_evento = $3)
      `, [l.bien_id, l.evento, l.qid_evento, l.qid_evento_padre]);
      ins += r.rowCount;
      if (ins % 500 === 0 && ins > 0) console.log(`  [${ins}/${links.length}]`);
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
