/**
 * Limpia huérfanos: borra metadatos triviales, asigna padres a eventos históricos.
 *
 * Decisiones manuales:
 *  - BORRAR (no son eventos históricos): metadatos de obra, eventos deportivos modernos,
 *    incidentes triviales, conmemoraciones recientes, etc.
 *  - PADRE Q8065 (Desastres naturales) — crear (no Wikidata real, usado como categoría)
 *  - Asignar a padres existentes: Q78994 Napoleónicas, Q10859 GC, Q362 2GM,
 *    Q79791 Reconquista, Q51657 Cruzada albigense
 *
 *  --apply para escribir.
 */
require('dotenv').config();
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

// === BORRAR ===
const TO_DELETE = [
  // metadatos de obra
  'Q1650581','Q59913255','Q6160','Q10387684','Q112228551','Q12047344','Q12772819','Q1309431',
  'Q138289280','Q14903979','Q16635429','Q1762010','Q1905393','Q2111921','Q25640113','Q329425',
  'Q3536388','Q3875186','Q464980','Q57195384','Q6498959','Q65757353','Q826949','Q959782',
  'Q100064047','Q10387575','Q1043452','Q106334491','Q107036510','Q10855061','Q120560',
  'Q125135318','Q126401804','Q12773274','Q1441983','Q15051339','Q15135589','Q1514547',
  'Q1582987','Q16961640','Q178564','Q179057','Q18054140','Q184199','Q188462','Q190291',
  'Q1914636','Q192623','Q194189','Q1954181','Q210064','Q21096945','Q2144962','Q2146005',
  'Q2251595','Q24662','Q2520975','Q27229605','Q275038','Q2918584','Q29933828','Q3010369',
  'Q305418','Q327209','Q3460970','Q37754875','Q4232202','Q44497','Q44777','Q472568',
  'Q473003','Q481609','Q49845','Q507850','Q52161698','Q52385658','Q55237917','Q554774',
  'Q56289407','Q56315709','Q56556915','Q566889','Q5935476','Q60539160','Q63065035','Q63100',
  'Q6484056','Q721587','Q75505084','Q7590','Q79782','Q811972','Q84590041','Q85835264',
  'Q85835276','Q863247','Q889779','Q903071','Q907116','Q9073584','Q916475','Q95978231',
  'Q64089000','Q836900','Q1361229','Q5557787','Q1153401',
  // eventos deportivos / culturales modernos
  'Q101730','Q1165755','Q1477177','Q124753','Q130318015','Q130443330','Q130829','Q131591',
  'Q132241','Q132529','Q1344','Q135475006','Q135524177','Q1575593','Q182196','Q182770',
  'Q19132508','Q2554098','Q2641832','Q3068793','Q4630399','Q47000326','Q5518616',
  'Q5655041','Q5870783','Q647475','Q671403','Q739989','Q7997','Q8036','Q83710044','Q8445',
  'Q9583','Q92634207',
  // años / fechas como evento
  'Q18107','Q1998','Q1999','Q25337','Q6208','Q69263726','Q69268076','Q69269832','Q7015',
  // bodas, ceremonias, conmemoraciones
  'Q111512493','Q123615718','Q131399738','Q2818511','Q2818607','Q523312',
  // incidentes urbanos/triviales
  'Q1069987','Q119822927','Q124607475','Q131251440','Q135899222','Q136090574','Q18288822',
  'Q3797640','Q48760489','Q21479779','Q97480614','Q63167656','Q114320651','Q324555',
  'Q3975689','Q810740','Q109466544','Q106668752','Q104641717','Q98878491','Q11915228',
  // eventos/personajes/organizaciones random
  'Q10264605','Q1538618','Q1928947',
];

// === DESASTRES NATURALES (Q8065 = catástrofe natural en Wikidata) ===
const DESASTRES_PADRE = 'Q8065';
const DESASTRES = [
  'Q2411998','Q109339706','Q191055','Q167903','Q104762350','Q137917781','Q386230',
  'Q26689701','Q3008540','Q3517908','Q4560834','Q3799027','Q2827862','Q7944','Q95978896',
];

// === ASIGNACIONES MANUALES a padres existentes ===
const ASSIGN = {
  'Q78994': [   // Guerras Napoleónicas
    'Q1450594','Q17354899','Q973118','Q690989','Q60524550','Q3485810','Q97185172',
  ],
  'Q10859': [   // Guerra Civil Española
    'Q113484936','Q73716938','Q12266885',
  ],
  'Q362': [     // Segunda Guerra Mundial
    'Q3297473','Q836897','Q3641960','Q2909614',
  ],
  'Q79791': [   // Reconquista
    'Q17586783','Q17586787','Q18004777','Q815183','Q31074969','Q55633152',
  ],
  'Q51657': [   // Cruzada albigense
    'Q12950532',
  ],
  'Q166713': [  // Risorgimento
    'Q28671351','Q3636408',
  ],
  'Q6534': [    // Revolución Francesa
    'Q200749',
  ],
  'Q1200506': [ // Desamortización (no aplica realmente, pero queda como placeholder)
  ],
};

// Eventos sueltos que dejamos sin padre asignar (forman su propio "Otros eventos históricos"
// o quedan huérfanos hasta crear más categorías):
//   guerra de Comunidades, guerra Sucesión castellana, Compromiso Caspe, etc.
// Estos NO se borran ni reasignan.

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  const c = await p.connect();
  await c.query('BEGIN');
  try {
    let totalDel = 0, totalAssign = 0;

    // 1) Borrar
    for (const qid of TO_DELETE) {
      const r = await c.query(`DELETE FROM eventos_monumento WHERE qid_evento=$1`, [qid]);
      totalDel += r.rowCount;
    }
    console.log(`Borrados: ${totalDel} filas (${TO_DELETE.length} qids)`);

    // 2) Desastres naturales
    let nDes = 0;
    for (const qid of DESASTRES) {
      const r = await c.query(`UPDATE eventos_monumento SET qid_evento_padre=$1 WHERE qid_evento=$2`, [DESASTRES_PADRE, qid]);
      nDes += r.rowCount;
    }
    console.log(`Desastres naturales (${DESASTRES_PADRE}): ${nDes} filas`);
    totalAssign += nDes;

    // 3) Asignaciones manuales
    for (const [padre, qids] of Object.entries(ASSIGN)) {
      let n = 0;
      for (const qid of qids) {
        const r = await c.query(`UPDATE eventos_monumento SET qid_evento_padre=$1 WHERE qid_evento=$2`, [padre, qid]);
        n += r.rowCount;
      }
      if (n > 0) console.log(`${padre}: ${n} filas (${qids.length} qids)`);
      totalAssign += n;
    }

    // Resumen final huérfanos restantes
    const huer = await c.query(`SELECT COUNT(DISTINCT qid_evento) FROM eventos_monumento WHERE qid_evento_padre IS NULL`);
    console.log(`\nHuérfanos restantes: ${huer.rows[0].count} qids`);

    if (APPLY) {
      await c.query('COMMIT');
      console.log(`✓ APPLY OK — Borrados: ${totalDel}, Asignados: ${totalAssign}`);
    } else {
      await c.query('ROLLBACK');
      console.log(`[DRY-RUN] Borrados: ${totalDel}, Asignados: ${totalAssign}. Ejecutar con --apply.`);
    }
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ERR:', e.message);
  } finally {
    c.release(); await p.end();
  }
})();
