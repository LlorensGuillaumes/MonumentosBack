const db = require('./db.cjs');

(async () => {
  try {
    // 1. Estilos que NO se matchean a periodo
    console.log('=== ESTILOS SIN PERIODO (top 30) ===');
    const a = await db.query(
      "SELECT w.estilo, COUNT(*) as n FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND w.estilo IS NOT NULL AND w.estilo != '' " +
      "GROUP BY w.estilo ORDER BY n DESC LIMIT 30"
    );
    console.table(a.rows);

    // 2. Inception stats
    console.log('=== INCEPTION STATS ===');
    const b = await db.query(
      "SELECT COUNT(*) as total_wikidata, " +
      "SUM(CASE WHEN inception IS NOT NULL AND inception != '' THEN 1 ELSE 0 END) as con_inception, " +
      "SUM(CASE WHEN inception IS NULL OR inception = '' THEN 1 ELSE 0 END) as sin_inception " +
      "FROM wikidata"
    );
    console.table(b.rows);

    // 3. Sample wiki descriptions sin periodo con números
    console.log('=== SAMPLE WIKI DESC SIN PERIODO (30 random, con números) ===');
    const c = await db.query(
      "SELECT b.id, b.denominacion, w.descripcion, b.pais " +
      "FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND w.descripcion ~ '\\d{3,4}' " +
      "ORDER BY RANDOM() LIMIT 30"
    );
    for (const r of c.rows) {
      console.log(r.pais + ' | ' + (r.denominacion || '').substring(0, 50) + ' | ' + (r.descripcion || '').substring(0, 120));
    }

    // 4. Potencial: desc con números
    console.log('\n=== POTENCIAL: DESC CON NÚMEROS ===');
    const d = await db.query(
      "SELECT COUNT(*) as n FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND w.descripcion ~ '\\d{3,4}'"
    );
    console.log('Items sin periodo con números en desc:', d.rows[0].n);

    // 5. Sin desc wikidata
    const e = await db.query(
      "SELECT COUNT(*) as n FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND (w.descripcion IS NULL OR w.descripcion = '')"
    );
    console.log('Items sin periodo SIN desc wikidata:', e.rows[0].n);

    // 6. Sin periodo con QID - cuántos podríamos enriquecer via SPARQL P571?
    const f = await db.query(
      "SELECT COUNT(*) as n FROM bienes b JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND w.qid IS NOT NULL AND (w.inception IS NULL OR w.inception = '')"
    );
    console.log('Items sin periodo, con QID, sin inception (candidatos SPARQL P571):', f.rows[0].n);

    // 7. Heritage labels de Francia sin periodo - potencialmente tienen siglo en nombre
    console.log('\n=== SAMPLE FRANCIA SIN PERIODO (nombres con siglo?) ===');
    const g = await db.query(
      "SELECT b.denominacion FROM bienes b " +
      "WHERE b.periodo IS NULL AND b.pais = 'Francia' " +
      "ORDER BY RANDOM() LIMIT 20"
    );
    for (const r of g.rows) {
      console.log('  FR: ' + (r.denominacion || '').substring(0, 100));
    }

    // 8. Sample Italia sin periodo
    console.log('\n=== SAMPLE ITALIA SIN PERIODO ===');
    const h = await db.query(
      "SELECT b.denominacion, w.descripcion FROM bienes b " +
      "LEFT JOIN wikidata w ON b.id = w.bien_id " +
      "WHERE b.periodo IS NULL AND b.pais = 'Italia' " +
      "ORDER BY RANDOM() LIMIT 20"
    );
    for (const r of h.rows) {
      console.log('  IT: ' + (r.denominacion || '').substring(0, 60) + ' | ' + (r.descripcion || '').substring(0, 80));
    }

  } catch (err) {
    console.error(err);
  } finally {
    await db.cerrar();
  }
})();
