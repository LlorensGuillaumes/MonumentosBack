const db = require('./db.cjs');

(async () => {
  try {
    // === TIPO_MONUMENTO: what's left? ===
    console.log('=== SIN TIPO_MONUMENTO: 93K restantes ===\n');

    // By country
    const byCountry = await db.query(
      "SELECT pais, COUNT(*) as c FROM bienes WHERE tipo_monumento IS NULL GROUP BY pais ORDER BY c DESC"
    );
    console.log('Por país:');
    for (const r of byCountry.rows) console.log('  ' + r.pais + ': ' + r.c);

    // By tipo field
    const byTipo = await db.query(
      "SELECT tipo, COUNT(*) as c FROM bienes WHERE tipo_monumento IS NULL " +
      "GROUP BY tipo ORDER BY c DESC LIMIT 40"
    );
    console.log('\nPor campo "tipo":');
    for (const r of byTipo.rows) console.log('  ' + (r.tipo || '(null)') + ': ' + r.c);

    // By categoria field
    const byCat = await db.query(
      "SELECT categoria, COUNT(*) as c FROM bienes WHERE tipo_monumento IS NULL " +
      "GROUP BY categoria ORDER BY c DESC LIMIT 30"
    );
    console.log('\nPor campo "categoria":');
    for (const r of byCat.rows) console.log('  ' + (r.categoria || '(null)') + ': ' + r.c);

    // Denominacion word frequency (bigger sample)
    console.log('\nPalabras en denominacion (muestra 15000):');
    const denomRows = await db.query(
      "SELECT denominacion FROM bienes WHERE tipo_monumento IS NULL AND denominacion IS NOT NULL " +
      "ORDER BY random() LIMIT 15000"
    );
    const wordCounts = {};
    const stopWords = new Set(['de','del','la','el','les','le','los','las','da','do','dos','das','a','en','y','e','et','des','du','d','l','san','saint','santa','são','notre','dame','sur','par','rue','con','por','al','una','un','una','di','il','al','nel','alla','degli','dei','delle','dello','nella','dello']);
    for (const r of denomRows.rows) {
      const words = r.denominacion.toLowerCase().replace(/[^a-záéíóúàèìòùâêîôûäëïöüçñ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      for (const w of words) wordCounts[w] = (wordCounts[w] || 0) + 1;
    }
    const topWords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 80);
    for (const [w, c] of topWords) console.log('  ' + w + ': ' + c);

    // P31 from raw_json (bigger sample)
    console.log('\nP31 QIDs no mapeados (muestra 5000):');
    const rawRows = await db.query(
      "SELECT w.raw_json FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.tipo_monumento IS NULL AND w.raw_json IS NOT NULL " +
      "ORDER BY random() LIMIT 5000"
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
    const sortedP31 = Object.entries(p31Counts).sort((a, b) => b[1] - a[1]).slice(0, 40);
    for (const [qid, count] of sortedP31) console.log('  ' + qid + ': ' + count);

    // Wiki descriptions patterns
    console.log('\nPalabras en wiki descripcion (sin tipo):');
    const descRows = await db.query(
      "SELECT w.descripcion FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.tipo_monumento IS NULL AND w.descripcion IS NOT NULL AND w.descripcion != '' " +
      "ORDER BY random() LIMIT 10000"
    );
    const descWords = {};
    for (const r of descRows.rows) {
      const words = r.descripcion.toLowerCase().replace(/[^a-záéíóúàèìòùâêîôûäëïöüçñ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
      for (const w of words) descWords[w] = (descWords[w] || 0) + 1;
    }
    const topDesc = Object.entries(descWords).sort((a, b) => b[1] - a[1]).slice(0, 60);
    for (const [w, c] of topDesc) console.log('  ' + w + ': ' + c);

    // === PERIODO: what's left? ===
    console.log('\n\n=== SIN PERIODO: 189K restantes ===\n');

    // By country
    const perByCountry = await db.query(
      "SELECT pais, COUNT(*) as c FROM bienes WHERE periodo IS NULL GROUP BY pais ORDER BY c DESC"
    );
    console.log('Por país:');
    for (const r of perByCountry.rows) console.log('  ' + r.pais + ': ' + r.c);

    // By tipo_monumento (already classified)
    const perByTipo = await db.query(
      "SELECT tipo_monumento, COUNT(*) as c FROM bienes WHERE periodo IS NULL AND tipo_monumento IS NOT NULL " +
      "GROUP BY tipo_monumento ORDER BY c DESC LIMIT 20"
    );
    console.log('\nPor tipo_monumento (ya clasificados pero sin periodo):');
    for (const r of perByTipo.rows) console.log('  ' + r.tipo_monumento + ': ' + r.c);

    // Inception values still not parsed?
    const unparsedInc = await db.query(
      "SELECT w.inception, COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND w.inception IS NOT NULL AND w.inception != '' " +
      "GROUP BY w.inception ORDER BY c DESC LIMIT 20"
    );
    console.log('\nInceptions sin parsear:');
    for (const r of unparsedInc.rows) console.log('  [' + r.c + '] ' + r.inception);

    // French MH - do they have date info in denominacion?
    console.log('\nMuestra Monument Historique sin periodo:');
    const mhSample = await db.query(
      "SELECT b.denominacion, b.tipo, b.categoria, w.descripcion, w.inception " +
      "FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND b.pais = 'Francia' " +
      "ORDER BY random() LIMIT 15"
    );
    for (const r of mhSample.rows) {
      console.log('  ' + r.denominacion + ' | ' + (r.descripcion||'').substring(0,80) + ' | inc:' + r.inception);
    }

    // Italian bene - sample
    console.log('\nMuestra Bene Culturale sin periodo:');
    const itSample = await db.query(
      "SELECT b.denominacion, w.descripcion, w.inception, w.estilo " +
      "FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND b.pais = 'Italia' " +
      "ORDER BY random() LIMIT 15"
    );
    for (const r of itSample.rows) {
      console.log('  ' + r.denominacion + ' | ' + (r.descripcion||'').substring(0,80) + ' | est:' + r.estilo + ' | inc:' + r.inception);
    }

    // Check if there's any siglo/century info in denominacion or descripcion
    console.log('\nPatrones de siglo en denominacion (sin periodo):');
    const sigloPatterns = await db.query(
      "SELECT COUNT(*) as c FROM bienes WHERE periodo IS NULL AND " +
      "(denominacion ~* 'siglo|segle|siècle|secolo|século|century|[IVXL]+e\\s*s' " +
      "OR denominacion ~* '\\b(XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)\\b')"
    );
    console.log('  Con referencia a siglo en denominacion: ' + sigloPatterns.rows[0].c);

    const sigloDescPatterns = await db.query(
      "SELECT COUNT(*) as c FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND " +
      "(w.descripcion ~* 'siglo|segle|siècle|secolo|século|century' " +
      "OR w.descripcion ~* '\\b(XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)[eè]?\\b')"
    );
    console.log('  Con referencia a siglo en wiki descripcion: ' + sigloDescPatterns.rows[0].c);

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await db.cerrar();
  }
})();
