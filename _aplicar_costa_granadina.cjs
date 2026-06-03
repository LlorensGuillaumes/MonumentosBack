/**
 * Aplica el plan generado por _sparql_zona_costa_granadina.cjs:
 *  - INSERT 7 nuevos monumentos en bienes/wikidata/imagenes
 *  - UPDATE (INSERT en wikidata): 10 enlaces QID a bienes existentes + imagen si la hay
 *
 * Todo en transacción única.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const COMARCAS = {
  'Los Guájares': 'Costa Granadina',
  'El Pinar': 'Valle de Lecrín',
  'El Valle': 'Valle de Lecrín',
  'Lanjarón': 'Alpujarra Granadina',
  'Nigüelas': 'Valle de Lecrín',
};

// Mapeo tipo Wikidata → tipo_monumento BD
function mapTipo(wdType, label) {
  const t = (wdType || '').toLowerCase();
  const l = (label || '').toLowerCase();
  if (t.includes('castillo') || t.includes('castle') || l.includes('castillo')) return 'Castillo / Fortaleza';
  if (t.includes('iglesia') || t.includes('church') || t.includes('parroquial') || l.includes('iglesia')) return 'Iglesia / Ermita';
  if (t.includes('ermita') || t.includes('hermitage') || t.includes('capilla') || l.includes('ermita') || l.includes('capilla')) return 'Iglesia / Ermita';
  if (t.includes('torre') || t.includes('tower')) return 'Torre';
  if (t.includes('yacimiento') || t.includes('archaeological') || t.includes('cista') || t.includes('asentamiento') || t.includes('alquería')) return 'Yacimiento arqueológico';
  if (t.includes('museo') || t.includes('museum')) return 'Museo';
  if (t.includes('villa romana')) return 'Yacimiento arqueológico';
  if (t.includes('fortaleza') || t.includes('fortress')) return 'Castillo / Fortaleza';
  return null; // sin clasificar
}

// De URL Commons Special:FilePath → filename limpio
function filenameFromCommonsURL(url) {
  if (!url) return null;
  const m = url.match(/Special:FilePath\/(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

(async () => {
  const plan = JSON.parse(fs.readFileSync('./_costa_granadina_plan.json', 'utf8'));
  const { toInsertConCoords, toUpdate } = plan;

  // Filtrar UPDATE: descartar el falso positivo Nigüelas iglesia↔almazara (proximidad pura)
  // El criterio: si match_reason es "proximidad" Y tipos divergen claramente, descartar
  const toUpdateFiltered = toUpdate.filter((u) => {
    if (u.match_reason && u.match_reason.startsWith('proximidad')) {
      const tipoWD = (u.label_wikidata + ' ' + u.type).toLowerCase();
      const tipoBD = (u.nombre_actual || '').toLowerCase();
      // Si la WD es iglesia/ermita y BD es almazara/molino/torre/edificio civil → falso positivo
      const wdIsReligioso = /iglesia|ermita|capilla|santuario/.test(tipoWD);
      const bdIsReligioso = /iglesia|ermita|capilla|santuario/.test(tipoBD);
      if (wdIsReligioso !== bdIsReligioso) {
        console.log(`SKIP proximidad falso positivo: ${u.nombre_actual} ↔ ${u.label_wikidata}`);
        return false;
      }
    }
    return true;
  });
  // El Nigüelas iglesia ahora pasa a INSERT
  const updatedQIDs = new Set(toUpdateFiltered.map((u) => u.qid_nuevo));
  const removedFromUpdate = toUpdate.filter((u) => !toUpdateFiltered.includes(u));
  for (const r of removedFromUpdate) {
    if (r.lat != null && r.lng != null) {
      toInsertConCoords.push({
        municipio: r.municipio,
        qid: r.qid_nuevo,
        label: r.label_wikidata,
        image: r.image,
        type: r.type,
        lat: r.lat,
        lng: r.lng,
      });
    }
  }

  console.log(`\nPlan a aplicar:`);
  console.log(`  INSERT: ${toInsertConCoords.length}`);
  console.log(`  UPDATE (link QID a bienes existentes): ${toUpdateFiltered.length}`);

  const p = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  const client = await p.connect();
  let inserted = 0,
    updated = 0,
    imgsInserted = 0;

  try {
    await client.query('BEGIN');

    // === INSERT nuevos bienes ===
    for (const i of toInsertConCoords) {
      // doble check duplicado por QID
      const dup = await client.query('SELECT bien_id FROM wikidata WHERE qid = $1', [i.qid]);
      if (dup.rows.length > 0) {
        console.log(`SKIP ${i.qid} ya existe (bien_id=${dup.rows[0].bien_id})`);
        continue;
      }
      const tipo = mapTipo(i.type, i.label);
      const comarca = COMARCAS[i.municipio] || null;

      const r = await client.query(
        `INSERT INTO bienes (
          denominacion, tipo_monumento, comarca, municipio,
          comunidad_autonoma, pais, latitud, longitud, fuente_opendata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id`,
        [i.label, tipo, comarca, i.municipio, 'Andalucia', 'España', i.lat, i.lng, 0]
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
        imgsInserted++;
      }

      console.log(`INSERT ${i.qid} ${i.label} [${i.municipio}] bien_id=${bienId}${i.image ? ' + IMG' : ''}`);
      inserted++;
    }

    // === UPDATE (insert link en wikidata + imagen) para bienes existentes sin QID ===
    for (const u of toUpdateFiltered) {
      const dup = await client.query('SELECT bien_id FROM wikidata WHERE qid = $1', [u.qid_nuevo]);
      if (dup.rows.length > 0) {
        console.log(`SKIP ${u.qid_nuevo} ya existe`);
        continue;
      }
      // Verificar que el bien_id no tenga ya un wikidata enlazado
      const existing = await client.query('SELECT id FROM wikidata WHERE bien_id = $1', [u.bien_id]);
      if (existing.rows.length > 0) {
        console.log(`SKIP bien_id=${u.bien_id} ya tiene wikidata enlazado`);
        continue;
      }
      await client.query(
        `INSERT INTO wikidata (bien_id, qid, imagen_url) VALUES ($1,$2,$3)`,
        [u.bien_id, u.qid_nuevo, u.image || null]
      );

      if (u.image) {
        // ¿ya tiene imagen en imagenes? si no, añadir
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
          imgsInserted++;
        }
      }

      console.log(`UPDATE bien_id=${u.bien_id} "${u.nombre_actual}" ← ${u.qid_nuevo}${u.image ? ' + IMG' : ''}`);
      updated++;
    }

    await client.query('COMMIT');

    console.log(`\n=== RESUMEN ===`);
    console.log(`INSERT bienes nuevos:  ${inserted}`);
    console.log(`UPDATE QID existentes: ${updated}`);
    console.log(`Imágenes añadidas:     ${imgsInserted}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nERROR — rollback:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await p.end();
  }
})();
