/**
 * Applier genérico: lee plan _<zona>_plan.json y aplica INSERT + UPDATE.
 * Filtra falsos positivos por proximidad cuando tipo divergente (iglesia↔almazara).
 *
 * Uso: node _aplicar_zona.cjs <zona-key>
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const zonaKey = process.argv[2];
if (!zonaKey) {
  console.error('Uso: node _aplicar_zona.cjs <zona-key>');
  process.exit(1);
}
const planFile = `./_${zonaKey}_plan.json`;
if (!fs.existsSync(planFile)) {
  console.error(`No existe ${planFile}`);
  process.exit(1);
}

function mapTipo(wdType, label) {
  const t = (wdType || '').toLowerCase();
  const l = (label || '').toLowerCase();
  if (t.includes('castillo') || t.includes('castle') || l.includes('castillo')) return 'Castillo / Fortaleza';
  if (t.includes('torre') || t.includes('tower')) return 'Torre';
  if (t.includes('ermita') || t.includes('hermitage') || t.includes('capilla') || l.includes('ermita') || l.includes('capilla')) return 'Iglesia / Ermita';
  if (t.includes('iglesia') || t.includes('church') || t.includes('parroquial') || l.includes('iglesia')) return 'Iglesia / Ermita';
  if (t.includes('catedral') || t.includes('cathedral')) return 'Catedral';
  if (t.includes('yacimiento') || t.includes('archaeological') || t.includes('cista') || t.includes('asentamiento') || t.includes('alquería') || t.includes('villa romana') || t.includes('ciudad romana') || t.includes('necrópolis') || t.includes('dolmen') || t.includes('megalítico') || t.includes('cueva')) return 'Yacimiento arqueológico';
  if (t.includes('museo') || t.includes('museum')) return 'Museo';
  if (t.includes('fortaleza') || t.includes('fortress')) return 'Castillo / Fortaleza';
  if (t.includes('monasterio') || t.includes('convento') || t.includes('monastery') || t.includes('convent')) return 'Monasterio / Convento';
  if (t.includes('molino') || t.includes('mill')) return 'Molino';
  if (t.includes('puente') || t.includes('bridge')) return 'Puente';
  if (t.includes('fuente') || t.includes('fountain')) return 'Fuente';
  if (t.includes('acueducto') || t.includes('acequia')) return 'Acueducto / Acequia';
  if (t.includes('balneario') || t.includes('spa')) return 'Balneario / Termas';
  if (t.includes('edificio')) return 'Edificio civil';
  if (t.includes('palacio') || t.includes('palace')) return 'Palacio';
  return null;
}

function filenameFromCommonsURL(url) {
  if (!url) return null;
  const m = url.match(/Special:FilePath\/(.+)$/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

(async () => {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  let { toInsertConCoords, toUpdate, comarca, comunidad = 'Andalucia', pais = 'España' } = plan;

  // Filtrar falsos positivos por proximidad cuando tipos divergen
  toUpdate = toUpdate.filter((u) => {
    if (u.match_reason && u.match_reason.startsWith('proximidad')) {
      const tipoWD = (u.label_wikidata + ' ' + u.type).toLowerCase();
      const tipoBD = (u.nombre_actual || '').toLowerCase();
      const wdIsReligioso = /iglesia|ermita|capilla|santuario|catedral/.test(tipoWD);
      const bdIsReligioso = /iglesia|ermita|capilla|santuario|catedral/.test(tipoBD);
      if (wdIsReligioso !== bdIsReligioso) {
        console.log(`SKIP falso positivo proximidad: "${u.nombre_actual}" ↔ "${u.label_wikidata}"`);
        return false;
      }
      // Mismo check para castillo/torre
      const wdIsCastle = /castillo|torre|fortaleza|fortress|castle|tower/.test(tipoWD);
      const bdIsCastle = /castillo|torre|fortaleza/.test(tipoBD);
      if (wdIsCastle !== bdIsCastle) {
        console.log(`SKIP falso positivo proximidad (castillo): "${u.nombre_actual}" ↔ "${u.label_wikidata}"`);
        return false;
      }
    }
    return true;
  });

  console.log(`\nPlan a aplicar para zona "${zonaKey}":`);
  console.log(`  INSERT: ${toInsertConCoords.length}`);
  console.log(`  UPDATE: ${toUpdate.length}`);

  const p = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  const client = await p.connect();
  let inserted = 0, updated = 0, qidInserted = 0, skipped = 0, imgsAdded = 0;

  try {
    await client.query('BEGIN');

    // === INSERT nuevos ===
    for (const i of toInsertConCoords) {
      const dup = await client.query('SELECT bien_id FROM wikidata WHERE qid = $1', [i.qid]);
      if (dup.rows.length > 0) {
        console.log(`SKIP ${i.qid}: ya enlazado a bien_id=${dup.rows[0].bien_id}`);
        skipped++;
        continue;
      }
      const tipo = mapTipo(i.type, i.label);
      const r = await client.query(
        `INSERT INTO bienes (
          denominacion, tipo_monumento, comarca, municipio,
          comunidad_autonoma, pais, latitud, longitud, fuente_opendata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [i.label, tipo, comarca, i.municipio, comunidad, pais, i.lat, i.lng, 0]
      );
      const bienId = r.rows[0].id;
      await client.query(
        `INSERT INTO wikidata (bien_id, qid, imagen_url) VALUES ($1,$2,$3)`,
        [bienId, i.qid, i.image || null]
      );
      if (i.image) {
        const titulo = filenameFromCommonsURL(i.image);
        await client.query(
          `INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1,$2,$3,$4)`,
          [bienId, i.image, titulo, 'Wikimedia Commons']
        );
        imgsAdded++;
      }
      console.log(`INSERT ${i.qid} ${i.label} [${i.municipio}] bien_id=${bienId}${i.image ? ' + IMG' : ''}`);
      inserted++;
    }

    // === UPDATE (link QID a bienes existentes) ===
    for (const u of toUpdate) {
      const dupQid = await client.query('SELECT bien_id FROM wikidata WHERE qid = $1', [u.qid_nuevo]);
      if (dupQid.rows.length > 0 && dupQid.rows[0].bien_id !== u.bien_id) {
        console.log(`SKIP ${u.qid_nuevo} ya enlazado a bien_id=${dupQid.rows[0].bien_id} (no a ${u.bien_id})`);
        skipped++;
        continue;
      }
      const existing = await client.query(
        'SELECT id, qid FROM wikidata WHERE bien_id = $1',
        [u.bien_id]
      );
      if (existing.rows.length === 0) {
        await client.query(
          'INSERT INTO wikidata (bien_id, qid, imagen_url) VALUES ($1,$2,$3)',
          [u.bien_id, u.qid_nuevo, u.image || null]
        );
        qidInserted++;
      } else {
        const row = existing.rows[0];
        if (row.qid && row.qid !== u.qid_nuevo) {
          console.log(`SKIP bien_id=${u.bien_id}: ya tiene qid=${row.qid}`);
          skipped++;
          continue;
        }
        await client.query(
          `UPDATE wikidata SET qid = $1, imagen_url = COALESCE(imagen_url, $2) WHERE id = $3`,
          [u.qid_nuevo, u.image || null, row.id]
        );
        updated++;
      }
      if (u.image) {
        const imgExist = await client.query(
          'SELECT id FROM imagenes WHERE bien_id = $1 LIMIT 1',
          [u.bien_id]
        );
        if (imgExist.rows.length === 0) {
          const titulo = filenameFromCommonsURL(u.image);
          await client.query(
            `INSERT INTO imagenes (bien_id, url, titulo, fuente) VALUES ($1,$2,$3,$4)`,
            [u.bien_id, u.image, titulo, 'Wikimedia Commons']
          );
          imgsAdded++;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`\n=== RESUMEN zona "${zonaKey}" ===`);
    console.log(`INSERT bienes nuevos: ${inserted}`);
    console.log(`UPDATE QIDs:          ${updated}`);
    console.log(`INSERT wikidata (sin fila prev): ${qidInserted}`);
    console.log(`Skipped:              ${skipped}`);
    console.log(`Imágenes añadidas:    ${imgsAdded}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERROR rollback:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await p.end();
  }
})();
