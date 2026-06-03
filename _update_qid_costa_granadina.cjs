/**
 * UPDATE filas wikidata existentes que tienen bien_id pero qid IS NULL.
 * Enriquece con QID + imagen donde la haya. Filtrando falsos positivos por proximidad.
 *
 * Si un bien_id no tiene fila en wikidata, hace INSERT en su lugar.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

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
  let { toUpdate } = plan;

  // Filtrar mismos falsos positivos que el script anterior
  toUpdate = toUpdate.filter((u) => {
    if (u.match_reason && u.match_reason.startsWith('proximidad')) {
      const tipoWD = (u.label_wikidata + ' ' + u.type).toLowerCase();
      const tipoBD = (u.nombre_actual || '').toLowerCase();
      const wdIsReligioso = /iglesia|ermita|capilla|santuario/.test(tipoWD);
      const bdIsReligioso = /iglesia|ermita|capilla|santuario/.test(tipoBD);
      if (wdIsReligioso !== bdIsReligioso) return false;
    }
    return true;
  });

  console.log(`UPDATEs a aplicar: ${toUpdate.length}`);

  const p = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  const client = await p.connect();
  let updated = 0,
    inserted = 0,
    skipped = 0,
    imgsAdded = 0;

  try {
    await client.query('BEGIN');

    for (const u of toUpdate) {
      // Verificar si el QID ya existe en otra fila (no duplicar)
      const dupQid = await client.query(
        'SELECT bien_id FROM wikidata WHERE qid = $1',
        [u.qid_nuevo]
      );
      if (dupQid.rows.length > 0 && dupQid.rows[0].bien_id !== u.bien_id) {
        console.log(`SKIP ${u.qid_nuevo}: ya enlazado a bien_id=${dupQid.rows[0].bien_id} (no a ${u.bien_id})`);
        skipped++;
        continue;
      }

      // Buscar fila wikidata para este bien_id
      const existing = await client.query(
        'SELECT id, qid, imagen_url FROM wikidata WHERE bien_id = $1',
        [u.bien_id]
      );

      if (existing.rows.length === 0) {
        // No tiene fila, INSERT
        await client.query(
          'INSERT INTO wikidata (bien_id, qid, imagen_url) VALUES ($1,$2,$3)',
          [u.bien_id, u.qid_nuevo, u.image || null]
        );
        inserted++;
        console.log(`INSERT bien_id=${u.bien_id} "${u.nombre_actual}" ← ${u.qid_nuevo}${u.image ? ' + IMG' : ''}`);
      } else {
        const row = existing.rows[0];
        if (row.qid && row.qid !== u.qid_nuevo) {
          console.log(`SKIP bien_id=${u.bien_id}: ya tiene qid=${row.qid} (intentado ${u.qid_nuevo})`);
          skipped++;
          continue;
        }
        // UPDATE: setear qid + imagen si falta
        await client.query(
          `UPDATE wikidata
           SET qid = $1, imagen_url = COALESCE(imagen_url, $2)
           WHERE id = $3`,
          [u.qid_nuevo, u.image || null, row.id]
        );
        updated++;
        console.log(`UPDATE bien_id=${u.bien_id} "${u.nombre_actual}" ← ${u.qid_nuevo}${u.image ? ' + IMG' : ''}`);
      }

      // Imagen en tabla imagenes si tiene + no había
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
    console.log(`\n=== RESUMEN ===`);
    console.log(`UPDATE wikidata: ${updated}`);
    console.log(`INSERT wikidata: ${inserted}`);
    console.log(`Skipped:         ${skipped}`);
    console.log(`Imágenes nuevas: ${imgsAdded}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERROR — rollback:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await p.end();
  }
})();
