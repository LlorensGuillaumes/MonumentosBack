#!/usr/bin/env node
/**
 * enriquecer_eventos_p793.cjs
 * Descarga eventos históricos (P793) de Wikidata para bienes patrimoniales
 * de ES, IT, FR, PT, filtra los genéricos, cruza con la DB local e inserta.
 *
 * Uso: node enriquecer_eventos_p793.cjs [--dry-run]
 */
require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'patrimonio',
  password: 'patrimonio2026',
  database: 'patrimonio',
});

// QIDs de eventos genéricos a excluir
const EXCLUDED_QIDS = [
  'Q385378',    // construcción
  'Q1370468',   // renovación
  'Q1455992',   // ampliación
  'Q217197',    // reconstrucción arquitectónica
  'Q2698025',   // proyecto arquitectónico
  'Q29488536',  // restauración
  'Q56754675',  // conservación y restauración
  'Q18382556',  // fecha finalización
  'Q1631646',   // inicio manufactura o construcción
  'Q28837801',  // primera piedra
  'Q5765609',   // reapertura
  'Q1457961',   // reforma
  'Q1504556',   // consagración
  'Q125702792', // UNESCO modification
  'Q2061228',   // Decretum basilica
  'Q15893266',  // apertura
  'Q16143521',  // inauguración
  'Q7216762',   // redacción
  'Q1072750',   // consagración iglesia
  'Q744913',    // ceremonia de inauguración
  'Q11634041',  // colocación primera piedra
  'Q30026906',  // automatisation
  'Q1751765',   // electrificación
  'Q106996638', // fin fabricación
];

// Nombres genéricos extra (por si el QID no está en la lista)
const GENERIC_NAMES = new Set([
  'construcción', 'construction', 'costruzione',
  'renovación', 'rénovation', 'ristrutturazione', 'renovação',
  'ampliación', 'agrandissement', 'ampliamento',
  'reconstrucción', 'reconstruction', 'ricostruzione', 'reconstrução',
  'reforma', 'réforme', 'riforma',
  'restauración', 'restauration', 'restauro', 'restauração',
  'conservación y restauración', 'conservation et restauration',
  'demolición', 'démolition', 'demolizione', 'demolição',
  'inauguración', 'inauguration', 'inaugurazione', 'inauguração',
  'apertura', 'ouverture',
  'clausura', 'fermeture', 'chiusura', 'encerramento',
  'reapertura', 'réouverture', 'riapertura', 'reabertura',
  'cierre', 'primera piedra', 'pose de la première pierre', 'première pierre',
  'proyecto arquitectónico', 'projet architectural', 'progetto architettonico',
  'colocación de la primera piedra',
  'ceremonia de inauguración', "cérémonie d'inauguration", "cérémonie d'ouverture",
  'automatisation', 'automatização', 'automazione',
  'electrificación', 'électrification', 'elettrificazione', 'eletrificação',
  'inicio de manufactura o construcción', 'inizio dei lavori di costruzione',
  'début de la construction', 'início da construção',
  'fecha de finalización', 'fin de la fabricación o construcción',
  'fin de la construction', 'fine della costruzione',
  'consagración', 'consécration', 'consacrazione', 'consagração',
  'consagración de una iglesia',
  'torre defensiva', 'excavación arqueológica', 'fouille archéologique', 'scavo archeologico',
  'renovación para reutilización', 'actividad', 'redacción',
  'extension', 'agrandissement', 'surélévation', 'augmentation',
  'ampliamento', 'intervento edilizio', 'désassemblage',
  'UNESCO World Heritage Site record modification',
  "extension d'un site du patrimoine mondial de l'UNESCO",
  'Decretum "De titulo Basilicae Minoris"',
  'home repair',
  // Destrucción/incendio genéricos (sin especificar qué evento causó la destrucción)
  'destrucción', 'destruction', 'distruzione', 'destruição',
  'incendio', 'incendie', 'incendio doloso',
  'destruction de fortification',
  // Otros genéricos
  'bendición', 'bénédiction', 'benedizione',
  'entrada en servicio', 'mise en service', 'messa in servizio',
  'retirada del servicio', 'mise hors service',
  'colocado à venda', 'listado para aluguer', 'venta', 'compra',
  'finalización', 'achèvement', 'completamento',
  'rehabilitación', 'réhabilitation', 'riabilitazione',
  'reestructuración', 'restructuration', 'ristrutturazione',
  'cambio', 'changement', 'cambiamento',
  'comisión', 'commission', 'commissione',
  'désaffectation', 'vente', 'achat', 'posa della prima pietra',
  'edilizia', 'automatization', 'mise en location', 'mise en vente',
  'incêndio', 'commande artistique', 'comando artístico',
  'procesión', 'procession', 'processione',
]);

const COUNTRIES = [
  { name: 'España', qid: 'Q29', lang: 'es,en' },
  { name: 'Italia', qid: 'Q38', lang: 'it,es,en' },
  { name: 'Francia', qid: 'Q142', lang: 'fr,es,en' },
  { name: 'Portugal', qid: 'Q45', lang: 'pt,es,en' },
];

async function fetchEventsForCountry(country) {
  const excludeFilter = EXCLUDED_QIDS.map(q => `wd:${q}`).join(', ');
  const sparql = `
SELECT DISTINCT ?item ?itemLabel ?event ?eventLabel ?eventDescription ?date ?participantLabel WHERE {
  ?item wdt:P1435 ?heritage.
  ?item wdt:P17 wd:${country.qid}.
  ?item wdt:P793 ?event.
  FILTER(?event NOT IN (${excludeFilter}))
  OPTIONAL { ?event wdt:P585 ?date }
  OPTIONAL { ?event wdt:P580 ?startDate }
  OPTIONAL { ?event wdt:P710 ?participant }
  BIND(COALESCE(?date, ?startDate) AS ?date)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${country.lang}". }
}
`;
  try {
    const r = await axios.get('https://query.wikidata.org/sparql', {
      params: { query: sparql, format: 'json' },
      headers: { 'User-Agent': 'PatrimonioEuropeo/1.0 (heritage database enrichment)' },
      timeout: 120000,
    });
    const rows = r.data.results.bindings;
    // Agrupar por item+evento (puede haber múltiples participantes)
    const map = new Map();
    for (const b of rows) {
      const itemQid = b.item.value.split('/').pop();
      const eventQid = b.event.value.split('/').pop();
      const key = `${itemQid}|${eventQid}`;
      if (!map.has(key)) {
        map.set(key, {
          qid: itemQid,
          monumento: b.itemLabel.value,
          evento: b.eventLabel.value,
          evento_qid: eventQid,
          descripcion: b.eventDescription?.value || null,
          fecha: b.date ? b.date.value.substring(0, 10) : null,
          participantes: [],
          pais: country.name,
        });
      }
      if (b.participantLabel?.value) {
        const entry = map.get(key);
        if (!entry.participantes.includes(b.participantLabel.value)) {
          entry.participantes.push(b.participantLabel.value);
        }
      }
    }
    const results = [...map.values()];
    console.log(`  ${country.name}: ${rows.length} filas → ${results.length} eventos únicos`);
    return results;
  } catch (e) {
    console.error(`  ${country.name}: error - ${e.message}`);
    return [];
  }
}

function isGeneric(event) {
  if (EXCLUDED_QIDS.includes(event.evento_qid)) return true;
  if (GENERIC_NAMES.has(event.evento)) return true;
  if (GENERIC_NAMES.has(event.evento.toLowerCase())) return true;
  return false;
}

async function main() {
  console.log('=== Enriquecimiento P793: eventos históricos ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no se insertará nada]\n');

  // 1. Descargar eventos de Wikidata
  console.log('1. Descargando eventos de Wikidata...');
  let allEvents = [];
  for (const country of COUNTRIES) {
    const events = await fetchEventsForCountry(country);
    allEvents.push(...events);
    // Rate limit entre países
    await new Promise(r => setTimeout(r, 3000));
  }

  // 2. Filtrar genéricos
  console.log(`\n2. Filtrando eventos genéricos...`);
  const historical = allEvents.filter(e => !isGeneric(e));
  console.log(`   Total descargados: ${allEvents.length}`);
  console.log(`   Tras filtrar genéricos: ${historical.length}`);

  // 3. Cruzar con QIDs en nuestra DB
  console.log(`\n3. Cruzando con QIDs de la DB local...`);
  const qids = [...new Set(historical.map(e => e.qid))];
  const r = await pool.query(
    'SELECT qid, bien_id FROM wikidata WHERE qid = ANY($1::text[])',
    [qids]
  );
  const qidToBienId = new Map(r.rows.map(row => [row.qid, row.bien_id]));
  console.log(`   QIDs con eventos: ${qids.length}`);
  console.log(`   QIDs encontrados en DB: ${qidToBienId.size}`);

  const toInsert = historical
    .filter(e => qidToBienId.has(e.qid))
    .map(e => ({
      ...e,
      bien_id: qidToBienId.get(e.qid),
      personajes: e.participantes.length > 0 ? e.participantes.join(', ') : null,
    }));

  console.log(`   Eventos a insertar: ${toInsert.length}`);

  // 4. Verificar duplicados existentes
  const existingCount = await pool.query('SELECT COUNT(*) FROM eventos_monumento');
  if (parseInt(existingCount.rows[0].count) > 0) {
    console.log(`\n   ⚠ La tabla ya tiene ${existingCount.rows[0].count} registros.`);
    console.log(`   Limpiando tabla antes de insertar...`);
    if (!DRY_RUN) {
      await pool.query('DELETE FROM eventos_monumento');
    }
  }

  // 5. Insertar
  if (DRY_RUN) {
    console.log('\n4. [DRY RUN] Muestra de lo que se insertaría:');
    toInsert.slice(0, 20).forEach(e => {
      console.log(`   [${e.pais.substring(0,2)}] bien_id=${e.bien_id} | ${e.evento} | ${e.fecha || 'sin fecha'} | ${e.personajes || ''}`);
    });
  } else {
    console.log('\n4. Insertando en eventos_monumento...');
    let inserted = 0;
    for (const e of toInsert) {
      await pool.query(
        `INSERT INTO eventos_monumento (bien_id, evento, qid_evento, fecha, descripcion, personajes, fuente)
         VALUES ($1, $2, $3, $4, $5, $6, 'wikidata')`,
        [e.bien_id, e.evento, e.evento_qid, e.fecha, e.descripcion, e.personajes]
      );
      inserted++;
    }
    console.log(`   Insertados: ${inserted} eventos`);
  }

  // 6. Resumen
  if (!DRY_RUN) {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_eventos,
        COUNT(DISTINCT bien_id) as monumentos,
        COUNT(DISTINCT qid_evento) as tipos_evento,
        COUNT(fecha) as con_fecha
      FROM eventos_monumento
    `);
    const s = stats.rows[0];
    console.log('\n=== Resumen final ===');
    console.log(`Total eventos insertados: ${s.total_eventos}`);
    console.log(`Monumentos con eventos:   ${s.monumentos}`);
    console.log(`Tipos de evento únicos:   ${s.tipos_evento}`);
    console.log(`Eventos con fecha:        ${s.con_fecha}`);

    // Top eventos
    const top = await pool.query(`
      SELECT evento, COUNT(*) as n
      FROM eventos_monumento
      GROUP BY evento
      ORDER BY n DESC
      LIMIT 15
    `);
    console.log('\nTop 15 eventos:');
    top.rows.forEach(r => console.log(`  ${String(r.n).padStart(4)}  ${r.evento}`));

    // Por país
    const byCountry = await pool.query(`
      SELECT b.pais, COUNT(DISTINCT e.bien_id) as monumentos, COUNT(*) as eventos
      FROM eventos_monumento e
      JOIN bienes b ON b.id = e.bien_id
      GROUP BY b.pais
      ORDER BY eventos DESC
    `);
    console.log('\nPor país:');
    byCountry.rows.forEach(r => console.log(`  ${r.pais.padEnd(10)} ${r.monumentos} monumentos, ${r.eventos} eventos`));
  }

  await pool.end();
  console.log('\nHecho.');
}

main().catch(e => { console.error(e); process.exit(1); });
