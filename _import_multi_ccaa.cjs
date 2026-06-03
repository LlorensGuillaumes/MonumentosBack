/**
 * Import masivo desde Wikidata de monumentos por CCAA en cascada.
 *
 * Estrategia:
 *  1. Para cada CCAA en la lista, SPARQL con LIMIT 10000 (cubre todas, max real ~7000)
 *  2. Filtra QIDs ya en tabla wikidata
 *  3. INSERT bienes + wikidata + imagenes (transaccional por CCAA)
 *
 * Uso:
 *   node _import_multi_ccaa.cjs                          # dry-run TODAS las CCAA pendientes
 *   node _import_multi_ccaa.cjs --apply                  # aplica TODAS
 *   node _import_multi_ccaa.cjs --ccaa=Galicia           # solo Galicia (dry-run)
 *   node _import_multi_ccaa.cjs --ccaa=Galicia --apply   # solo Galicia (apply)
 */
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const ccaaFilter = (args.find(a => a.startsWith('--ccaa=')) || '').split('=')[1] || null;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Lista ordenada por prioridad (descendente por nuevos potenciales)
// `provincias` opcional: si está presente, la consulta se subdivide por provincia
// (necesario para CCAA con >5000 items que rompen la query única o por subtipo)
const CCAA = [
  {
    nom: 'Galicia', qid: 'Q3908', esperaNuevos: 6500,
    provincias: [
      { qid: 'Q82119', label: 'A Coruña'   },
      { qid: 'Q95027', label: 'Lugo'       },
      { qid: 'Q95038', label: 'Ourense'    },
      { qid: 'Q95086', label: 'Pontevedra' },
    ],
  },
  {
    nom: 'Catalunya', qid: 'Q5705', esperaNuevos: 3000,
    provincias: [
      { qid: 'Q81949', label: 'Barcelona' },
      { qid: 'Q7194',  label: 'Girona'    },
      { qid: 'Q13904', label: 'Lleida'    },
      { qid: 'Q98392', label: 'Tarragona' },
    ],
  },
  {
    nom: 'Castilla y León', qid: 'Q5739', esperaNuevos: 4000,
    provincias: [
      { qid: 'Q55271', label: 'Burgos'     },
      { qid: 'Q71140', label: 'León'       },
      { qid: 'Q55269', label: 'Palencia'   },
      { qid: 'Q71080', label: 'Salamanca'  },
      { qid: 'Q55283', label: 'Segovia'    },
      { qid: 'Q55276', label: 'Soria'      },
      { qid: 'Q71097', label: 'Valladolid' },
      { qid: 'Q71113', label: 'Zamora'     },
      { qid: 'Q55288', label: 'Ávila'      },
    ],
  },
  {
    nom: 'Aragón', qid: 'Q4040', esperaNuevos: 2300,
    provincias: [
      { qid: 'Q55182', label: 'Huesca'    },
      { qid: 'Q54955', label: 'Teruel'    },
      { qid: 'Q55180', label: 'Zaragoza'  },
    ],
  },
  {
    nom: 'Castilla-La Mancha', qid: 'Q5748', esperaNuevos: 2500,
    provincias: [
      { qid: 'Q54889', label: 'Albacete'     },
      { qid: 'Q54932', label: 'Ciudad Real'  },
      { qid: 'Q54888', label: 'Cuenca'       },
      { qid: 'Q54925', label: 'Guadalajara'  },
      { qid: 'Q54929', label: 'Toledo'       },
    ],
  },
  { nom: 'Comunidad de Madrid',    qid: 'Q5756',      esperaNuevos: 2200 },
  { nom: 'Extremadura',            qid: 'Q5777',      esperaNuevos: 1300 },
  { nom: 'Asturias',               qid: 'Q3934',      esperaNuevos: 900  },
  { nom: 'Canarias',               qid: 'Q5813',      esperaNuevos: 660  },
  { nom: 'Región de Murcia',       qid: 'Q5772',      esperaNuevos: 650  },
  { nom: 'Illes Balears',          qid: 'Q107356467', esperaNuevos: 580  },
  { nom: 'Cantabria',              qid: 'Q3946',      esperaNuevos: 300  },
  { nom: 'La Rioja',               qid: 'Q5727',      esperaNuevos: 160  },
];

const ccaaSeleccion = ccaaFilter
  ? CCAA.filter(c => c.nom.toLowerCase().includes(ccaaFilter.toLowerCase()))
  : CCAA;

if (ccaaSeleccion.length === 0) {
  console.error(`No se encuentra CCAA "${ccaaFilter}"`);
  process.exit(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'PatrimonioEuropeoBot/1.0 (España multi-CCAA import)',
      },
    });
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      console.log(`    [retry ${i+1}] HTTP ${res.status}, esperando…`);
      await sleep(4000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`SPARQL ${res.status}: ${(await res.text()).slice(0,200)}`);
    return res.json();
  }
  throw new Error('SPARQL max retries');
}

// Bloques de filtros UNITARIOS para fragmentar al máximo cuando la respuesta es demasiado grande
const FILTER_BLOCKS = [
  { name: 'BIC',          filter: '?item wdt:P1435 wd:Q23712 .' },
  { name: 'iglesia',      filter: '?item wdt:P31/wdt:P279* wd:Q24398318 .' },
  { name: 'monasterio',   filter: '?item wdt:P31/wdt:P279* wd:Q44613 .' },
  { name: 'ermita',       filter: '?item wdt:P31/wdt:P279* wd:Q16970 .' },
  { name: 'castillo',     filter: '?item wdt:P31/wdt:P279* wd:Q23413 .' },
  { name: 'torre',        filter: '?item wdt:P31/wdt:P279* wd:Q12518 .' },
  { name: 'yacimiento',   filter: '?item wdt:P31/wdt:P279* wd:Q839954 .' },
  { name: 'museo',        filter: '?item wdt:P31/wdt:P279* wd:Q33506 .' },
  { name: 'palacio',      filter: '?item wdt:P31/wdt:P279* wd:Q16560 .' },
  { name: 'monumento',    filter: '?item wdt:P31/wdt:P279* wd:Q4989906 .' },
];

function buildQuery(qid, filterClause) {
  // Si no se pasa filterClause, usar todos los filtros como UNION (query completa)
  const filters = filterClause || `
    {
      ?item wdt:P1435 wd:Q23712 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q24398318 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q23413 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q839954 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q33506 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q4989906 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q16970 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q44613 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q16560 .
    } UNION {
      ?item wdt:P31/wdt:P279* wd:Q12518 .
    }
  `;
  return `
    SELECT DISTINCT ?item ?itemLabel ?lat ?lng ?image ?tipoLabel ?municipioLabel WHERE {
      ?item wdt:P131* wd:${qid} .
      ?item p:P625 ?coordStatement .
      ?coordStatement psv:P625 ?coordValue .
      ?coordValue wikibase:geoLatitude ?lat .
      ?coordValue wikibase:geoLongitude ?lng .
      OPTIONAL { ?item wdt:P18 ?image }
      OPTIONAL { ?item wdt:P31 ?tipo }
      OPTIONAL { ?item wdt:P131 ?municipio }
      ${filters}
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,gl,ca,eu,pt,en" }
    }
    LIMIT 10000
  `;
}

// Ejecuta query por bloques de filtro UNITARIOS y agrega bindings. Tolera fallos por bloque.
async function sparqlFragmentado(qid) {
  const allBindings = [];
  for (const block of FILTER_BLOCKS) {
    try {
      console.log(`    [bloque: ${block.name}]…`);
      const data = await sparql(buildQuery(qid, block.filter));
      console.log(`      ${data.results.bindings.length} filas`);
      allBindings.push(...data.results.bindings);
    } catch (e) {
      console.log(`      ⚠ Falló bloque "${block.name}": ${e.message.slice(0,100)} — continúo`);
    }
    await sleep(1500);
  }
  return { results: { bindings: allBindings } };
}

function categorize(tipo, label) {
  const text = `${tipo || ''} ${label || ''}`.toLowerCase();
  if (!text.trim()) return 'Edificio histórico';
  if (/iglesia|catedral|capilla|ermita|basílica|parroquia|santuario|monasterio|convento|abadía|colegiata/.test(text)) return 'Iglesia / Ermita';
  if (/castillo|fortaleza|alcazaba|murall|torre|fuerte|baluart|ciudadela|fortific/.test(text)) return 'Castillo / Fortaleza';
  if (/yacimiento|arqueol|ruinas|necrópolis|dolmen|menhir|castro|villa romana/.test(text)) return 'Yacimiento arqueológico';
  if (/museo|museu/.test(text)) return 'Museo';
  if (/palacio|palau|pazo|mansión|residencia/.test(text)) return 'Palacio';
  if (/puente|aqüeducto|acueducto/.test(text)) return 'Ingeniería / Puente';
  if (/teatro|cine|auditorio/.test(text)) return 'Teatro';
  if (/cruceiro|crucero|hórreo|horreo/.test(text)) return 'Patrimonio etnográfico';
  return 'Edificio histórico';
}

async function importCcaa(ccaa, existSetGlobal) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`▶  ${ccaa.nom}  (${ccaa.qid})   esperados ~${ccaa.esperaNuevos}`);
  console.log('═'.repeat(70));

  const t0 = Date.now();
  let data;
  if (ccaa.provincias) {
    // CCAA grande: subdividir por provincia
    console.log(`  Consultando Wikidata por ${ccaa.provincias.length} provincias…`);
    const allBindings = [];
    for (const prov of ccaa.provincias) {
      console.log(`    [${prov.label}]…`);
      try {
        const d = await sparql(buildQuery(prov.qid));
        console.log(`      ${d.results.bindings.length} filas`);
        allBindings.push(...d.results.bindings);
      } catch (e) {
        console.log(`      ⚠ Falló provincia "${prov.label}": ${e.message.slice(0,80)}`);
        if (/JSON|Unexpected|Expected|Unterminated|control character/i.test(e.message)) {
          console.log(`      ↻ Reintentando "${prov.label}" fragmentado por subtipo…`);
          try {
            const d2 = await sparqlFragmentado(prov.qid);
            console.log(`      ${d2.results.bindings.length} filas (fragmentado)`);
            allBindings.push(...d2.results.bindings);
          } catch (e2) {
            console.log(`      ⚠ Fragmentado también falló: ${e2.message.slice(0,80)}`);
          }
        }
      }
      await sleep(1500);
    }
    data = { results: { bindings: allBindings } };
    console.log(`  SPARQL por provincia ok en ${((Date.now()-t0)/1000).toFixed(1)}s — ${data.results.bindings.length} filas`);
  } else {
    // CCAA pequeña: query única + fallback fragmentado
    console.log('  Consultando Wikidata…');
    try {
      data = await sparql(buildQuery(ccaa.qid));
      console.log(`  SPARQL ok en ${((Date.now()-t0)/1000).toFixed(1)}s — ${data.results.bindings.length} filas`);
    } catch (e) {
      if (/JSON|Unexpected|Expected/i.test(e.message)) {
        console.log(`  ⚠  Query única falló (${e.message.slice(0,80)})`);
        console.log(`  ↻ Reintentando fragmentado por subtipo…`);
        data = await sparqlFragmentado(ccaa.qid);
        console.log(`  SPARQL fragmentado ok en ${((Date.now()-t0)/1000).toFixed(1)}s — ${data.results.bindings.length} filas (con duplicados intra-bloque)`);
      } else {
        throw e;
      }
    }
  }

  // Dedup intra-resultados (mismo QID puede salir varias veces por UNION)
  const byQid = new Map();
  for (const b of data.results.bindings) {
    const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
    if (byQid.has(qid)) continue;
    // Si el label devuelto es igual al QID, significa que no hay label en los idiomas pedidos
    const rawLabel = b.itemLabel?.value || null;
    const nom = (rawLabel && rawLabel === qid) ? null : rawLabel;
    const rawTipo = b.tipoLabel?.value || null;
    const tipo = (rawTipo && /^Q\d+$/.test(rawTipo)) ? null : rawTipo;
    const rawMun = b.municipioLabel?.value || null;
    const municipio = (rawMun && /^Q\d+$/.test(rawMun)) ? null : rawMun;
    byQid.set(qid, {
      qid,
      nom,
      lat: parseFloat(b.lat.value),
      lng: parseFloat(b.lng.value),
      img: b.image?.value || null,
      tipo,
      municipio,
    });
  }
  const unique = [...byQid.values()];
  const sinLabel = unique.filter(u => !u.nom).length;
  console.log(`  QIDs únicos: ${unique.length}${sinLabel ? ` (${sinLabel} sin label en es/gl/ca/eu/pt/en)` : ''}`);

  // Filtrar los que NO están en BD
  const nuevos = unique.filter(u => !existSetGlobal.has(u.qid));
  console.log(`  Ya en BD: ${unique.length - nuevos.length}`);
  console.log(`  A insertar: ${nuevos.length}`);

  if (nuevos.length === 0) {
    console.log('  (nada nuevo)');
    return { ccaa: ccaa.nom, inserted: 0, withImage: 0 };
  }

  // Filtros sanitarios: descartar QID corruptos, coords fuera de España, o sin label
  // España bbox: lng -19 a 4.5, lat 27.5 a 44.5 (incluye Canarias, Ceuta, Melilla)
  const sanos = nuevos.filter(n => {
    if (!n.nom) return false; // sin label = sin valor para la web
    if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return false;
    if (n.lat < 27.5 || n.lat > 44.5) return false;
    if (n.lng < -19 || n.lng > 4.5) return false;
    return true;
  });
  const descartados = nuevos.length - sanos.length;
  if (descartados > 0) console.log(`  Descartados (sin label / fuera bbox): ${descartados}`);

  // Preview
  console.log('\n  Preview (max 5):');
  sanos.slice(0, 5).forEach(n =>
    console.log(`    ${n.qid.padEnd(11)} ${(n.nom || '?').slice(0,40).padEnd(40)} ${(n.municipio||'').slice(0,20).padEnd(20)} ${n.img ? '🖼' : ' '}`)
  );

  if (DRY_RUN) {
    console.log(`\n  [DRY-RUN] No se escribe. ${sanos.length} listos para insertar.`);
    // Aún así, los agregamos al set global para que la siguiente CCAA no los re-cuente como nuevos
    sanos.forEach(s => existSetGlobal.add(s.qid));
    return { ccaa: ccaa.nom, inserted: 0, withImage: 0, wouldInsert: sanos.length };
  }

  // Insertar (abrir conexión solo cuando hay trabajo real)
  console.log(`\n  Insertando ${sanos.length}…`);
  const client = await pool.connect();
  await client.query('BEGIN');
  let inserted = 0, imagesIns = 0;
  try {
    for (const n of sanos) {
      const r = await client.query(
        `INSERT INTO bienes (denominacion, tipo_monumento, municipio,
          comunidad_autonoma, pais, latitud, longitud, fuente_opendata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          n.nom || `Sin nombre ${n.qid}`,
          categorize(n.tipo, n.nom),
          n.municipio || ccaa.nom,
          ccaa.nom,
          'España',
          n.lat,
          n.lng,
          0,
        ]
      );
      const bienId = r.rows[0].id;
      await client.query(
        'INSERT INTO wikidata (bien_id, qid, imagen_url) VALUES ($1, $2, $3)',
        [bienId, n.qid, n.img || null]
      );
      if (n.img) {
        await client.query(
          'INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1, $2, $3, $4)',
          [bienId, n.img, n.nom || n.qid, 'Wikimedia Commons']
        );
        imagesIns++;
      }
      existSetGlobal.add(n.qid);
      inserted++;
      if (inserted % 250 === 0) console.log(`    [${inserted}/${sanos.length}]`);
    }
    await client.query('COMMIT');
    console.log(`  ✓ ${ccaa.nom}: ${inserted} bienes insertados (${imagesIns} con imagen)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw new Error(`${ccaa.nom}: ${e.message}`);
  } finally {
    client.release();
  }
  return { ccaa: ccaa.nom, inserted, withImage: imagesIns };
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`CCAA seleccionadas (${ccaaSeleccion.length}):`);
  ccaaSeleccion.forEach(c => console.log(`  - ${c.nom}`));

  // QIDs ya en BD
  console.log('\nCargando QIDs ya en BD…');
  const existing = await pool.query('SELECT qid FROM wikidata');
  const existSet = new Set(existing.rows.map(r => r.qid));
  console.log(`(total: ${existSet.size})`);

  const results = [];
  for (const ccaa of ccaaSeleccion) {
    try {
      const r = await importCcaa(ccaa, existSet);
      results.push(r);
    } catch (e) {
      console.error(`\n✗ ERROR en ${ccaa.nom}: ${e.message}`);
      results.push({ ccaa: ccaa.nom, error: e.message });
    }
    await sleep(2000); // educación con WDQS
  }

  // Resumen
  console.log(`\n${'═'.repeat(70)}`);
  console.log('RESUMEN');
  console.log('═'.repeat(70));
  let totalIns = 0, totalImg = 0, totalWould = 0;
  results.forEach(r => {
    if (r.error) console.log(`  ${r.ccaa.padEnd(26)} ERROR: ${r.error}`);
    else if (r.wouldInsert !== undefined) {
      console.log(`  ${r.ccaa.padEnd(26)} ${String(r.wouldInsert).padStart(5)} listos para insertar (dry-run)`);
      totalWould += r.wouldInsert;
    } else {
      console.log(`  ${r.ccaa.padEnd(26)} ${String(r.inserted).padStart(5)} insertados   ${String(r.withImage).padStart(5)} con imagen`);
      totalIns += r.inserted;
      totalImg += r.withImage;
    }
  });
  console.log('─'.repeat(70));
  if (DRY_RUN) console.log(`  TOTAL a insertar:  ${totalWould}`);
  else console.log(`  TOTAL insertado:   ${totalIns}   (${totalImg} con imagen)`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
