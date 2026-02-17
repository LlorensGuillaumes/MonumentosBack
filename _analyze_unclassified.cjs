const db = require('./db.cjs');

(async () => {
  try {
    // 1. Sample unclassified
    console.log('=== MUESTRA DE 20 SIN CLASIFICAR ===\n');
    const sample = await db.query(
      "SELECT b.denominacion, b.tipo, b.clase, b.categoria, b.pais, b.comunidad_autonoma, " +
      "w.qid, w.descripcion, w.estilo, w.inception, w.heritage_label " +
      "FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.tipo_monumento IS NULL ORDER BY random() LIMIT 20"
    );
    for (const r of sample.rows) {
      console.log('---');
      console.log('Denom:', r.denominacion);
      console.log('Tipo:', r.tipo, '| Clase:', r.clase, '| Cat:', r.categoria);
      console.log('País:', r.pais, '| CCAA:', r.comunidad_autonoma);
      console.log('Wiki desc:', (r.descripcion || '').substring(0, 120));
      console.log('Estilo:', r.estilo, '| Inception:', r.inception, '| Heritage:', r.heritage_label);
    }

    // 2. Distribution by tipo/categoria/clase
    console.log('\n\n=== CAMPO "tipo" (sin clasificar, top 30) ===');
    const tipos = await db.query(
      "SELECT b.tipo, COUNT(*) as c FROM bienes b " +
      "WHERE b.tipo_monumento IS NULL AND b.tipo IS NOT NULL AND b.tipo != '' " +
      "GROUP BY b.tipo ORDER BY c DESC LIMIT 30"
    );
    for (const r of tipos.rows) console.log('  ' + r.tipo + ': ' + r.c);

    console.log('\n=== CAMPO "categoria" (sin clasificar, top 30) ===');
    const cats = await db.query(
      "SELECT b.categoria, COUNT(*) as c FROM bienes b " +
      "WHERE b.tipo_monumento IS NULL AND b.categoria IS NOT NULL AND b.categoria != '' " +
      "GROUP BY b.categoria ORDER BY c DESC LIMIT 30"
    );
    for (const r of cats.rows) console.log('  ' + r.categoria + ': ' + r.c);

    console.log('\n=== CAMPO "clase" (sin clasificar, top 20) ===');
    const clases = await db.query(
      "SELECT b.clase, COUNT(*) as c FROM bienes b " +
      "WHERE b.tipo_monumento IS NULL AND b.clase IS NOT NULL AND b.clase != '' " +
      "GROUP BY b.clase ORDER BY c DESC LIMIT 20"
    );
    for (const r of clases.rows) console.log('  ' + r.clase + ': ' + r.c);

    // 3. By country
    console.log('\n=== POR PAÍS (sin tipo_monumento) ===');
    const paises = await db.query(
      "SELECT b.pais, COUNT(*) as c FROM bienes b WHERE b.tipo_monumento IS NULL GROUP BY b.pais ORDER BY c DESC"
    );
    for (const r of paises.rows) console.log('  ' + r.pais + ': ' + r.c);

    // 4. Unmapped P31 QIDs from raw_json
    console.log('\n=== P31 QIDs NO MAPEADOS (muestra 1000) ===');
    const rawRows = await db.query(
      "SELECT w.raw_json FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.tipo_monumento IS NULL AND w.raw_json IS NOT NULL LIMIT 1000"
    );
    const p31Counts = {};
    for (const r of rawRows.rows) {
      try {
        const data = JSON.parse(r.raw_json);
        const p31Claims = (data.claims || {}).P31 || [];
        for (const claim of p31Claims) {
          const val = claim.mainsnak && claim.mainsnak.datavalue && claim.mainsnak.datavalue.value;
          if (val && val.id) p31Counts[val.id] = (p31Counts[val.id] || 0) + 1;
        }
      } catch (e) {}
    }
    const sorted = Object.entries(p31Counts).sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [qid, count] of sorted) console.log('  ' + qid + ': ' + count);

    // 5. Periodo analysis
    console.log('\n=== ANÁLISIS PERIODO (sin periodo) ===');
    const withEstilo = await db.query(
      "SELECT COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND w.estilo IS NOT NULL AND w.estilo != ''"
    );
    console.log('Sin periodo pero con estilo:', withEstilo.rows[0].c);

    const withInception = await db.query(
      "SELECT COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND w.inception IS NOT NULL AND w.inception != ''"
    );
    console.log('Sin periodo pero con inception:', withInception.rows[0].c);

    console.log('\nEstilos NO mapeados (top 25):');
    const estilos = await db.query(
      "SELECT w.estilo, COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND w.estilo IS NOT NULL AND w.estilo != '' " +
      "GROUP BY w.estilo ORDER BY c DESC LIMIT 25"
    );
    for (const r of estilos.rows) console.log('  [' + r.c + '] ' + r.estilo);

    console.log('\nInceptions NO parseados (top 25):');
    const inceptions = await db.query(
      "SELECT w.inception, COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND w.inception IS NOT NULL AND w.inception != '' " +
      "GROUP BY w.inception ORDER BY c DESC LIMIT 25"
    );
    for (const r of inceptions.rows) console.log('  [' + r.c + '] ' + r.inception);

    // 6. Heritage labels
    console.log('\n=== Heritage labels (sin tipo) ===');
    const heritage = await db.query(
      "SELECT w.heritage_label, COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.tipo_monumento IS NULL AND w.heritage_label IS NOT NULL AND w.heritage_label != '' " +
      "GROUP BY w.heritage_label ORDER BY c DESC LIMIT 15"
    );
    for (const r of heritage.rows) console.log('  [' + r.c + '] ' + r.heritage_label);

    // 7. Denominacion patterns for unclassified - what words appear most?
    console.log('\n=== PALABRAS FRECUENTES en denominacion (sin tipo, muestra 5000) ===');
    const denomRows = await db.query(
      "SELECT b.denominacion FROM bienes b WHERE b.tipo_monumento IS NULL AND b.denominacion IS NOT NULL " +
      "ORDER BY random() LIMIT 5000"
    );
    const wordCounts = {};
    const stopWords = new Set(['de','del','la','el','les','le','los','las','da','do','dos','das','a','en','y','e','et','des','du','d','l','san','saint','santa','são','notre','dame']);
    for (const r of denomRows.rows) {
      const words = r.denominacion.toLowerCase().replace(/[^a-záéíóúàèìòùâêîôûäëïöüçñ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      for (const w of words) wordCounts[w] = (wordCounts[w] || 0) + 1;
    }
    const topWords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 50);
    for (const [w, c] of topWords) console.log('  ' + w + ': ' + c);

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await db.cerrar();
  }
})();
