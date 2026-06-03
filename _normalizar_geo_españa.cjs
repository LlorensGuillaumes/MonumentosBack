/**
 * Normalización geográfica España (CCAA + provincias).
 * Tres fases:
 *  1) CCAA renames (sin tilde→con tilde, veguerias→Catalunya con prov correcta)
 *  2) Bienes individuales con CCAA absurda (Hesse, Alentejo, Países Bajos, Zahedan, Médio Tejo, Occitania, "España")
 *  3) Provincias renames (provincia de X→X, bilingue/Castellon, Leon)
 *
 * Modo dry-run por defecto; --apply para escribir.
 */
require('dotenv').config();
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

// === FASE 1: CCAA renames ===
// Mapping: regla = comparación case-sensitive, source CCAA → target CCAA, optional new provincia
const CCAA_REWRITES = [
  // Errores ortográficos / sin tildes
  { from: 'Andalucia',          to: 'Andalucía' },
  { from: 'Aragon',             to: 'Aragón' },
  { from: 'Castilla y Leon',    to: 'Castilla y León' },
  { from: 'Pais Vasco',         to: 'País Vasco' },
  { from: 'Region de Murcia',   to: 'Región de Murcia' },
  // Veguerias / sub-regiones de Catalunya
  { from: 'Alto Pirineo y Arán', to: 'Catalunya', newProvincia: 'Lleida' },
  { from: 'Campo de Tarragona',  to: 'Catalunya', newProvincia: 'Tarragona' },
  { from: 'Cataluña Central',    to: 'Catalunya', newProvincia: 'Barcelona' },
  { from: 'Comarcas gerundenses', to: 'Catalunya', newProvincia: 'Girona' },
  { from: 'Barcelona',           to: 'Catalunya', newProvincia: 'Barcelona', whenPais: 'España' },
  { from: 'Barcelonés',          to: 'Catalunya', newProvincia: 'Barcelona' },
];

// === FASE 2: bienes individuales con CCAA absurda ===
// Acción: 'move' (a otro país), 'delete' (borrar bien), 'fix' (reescribir solo CCAA/prov)
const BIEN_FIXES = [
  // CCAA="España" — son bienes españoles con etiquetado raro
  { id: 265606, ccaa: 'Asturias',     provincia: 'Asturias',  municipio: 'Oviedo'   },
  { id: 265555, ccaa: 'Extremadura',  provincia: 'Badajoz',   municipio: 'Mérida'   },
  { id: 265647, ccaa: 'Cantabria',    provincia: 'Cantabria', municipio: 'Colindres'},
  { id: 265681, ccaa: 'Andalucía',    provincia: 'Málaga',    municipio: 'Málaga'   },
  // Bienes con muni/prov de otro país pero pais=España: borrar si no tienen paradas,
  // si las tienen → fix con datos correctos.
  { id: 265550, action: 'delete' },  // "Convento de Cristo" en Tomar (sin paradas)
  // Con paradas de rutas: arreglar en vez de borrar
  { id: 265628, ccaa: 'Andalucía',   provincia: 'Córdoba',   municipio: 'Almodóvar del Río' },  // Castillo de Almodóvar
  { id: 265695, ccaa: 'Asturias',    provincia: 'Asturias',  municipio: 'Luarca' },             // Cementerio de Luarca
  { id: 265589, ccaa: 'Andalucía',   provincia: 'Sevilla',   municipio: 'Sevilla' },            // Catedral Sevilla
  { id: 265690, ccaa: 'Catalunya',   provincia: 'Lleida',    municipio: 'El Cogul' },           // Abrigo de Cogul
  { id: 265633, ccaa: 'Andalucía',   provincia: 'Jaén',      municipio: 'Alcalá la Real' },     // Fortaleza de la Mota
];

// === FASE 3: Provincia renames ===
// "provincia de X" → "X" (solo en pais=España)
const PROV_PREFIX_PAT = /^provincia de /i;

// Provincias bilingues con / o sin tilde (España)
const PROV_RENAMES_ES = {
  'València/Valencia': 'Valencia',
  'Castelló/Castellón': 'Castellón',
  'Alacant/Alicante': 'Alicante',
  'Castellon': 'Castellón',
  'Leon': 'León',
};

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  const client = await p.connect();
  await client.query('BEGIN');

  try {
    let totalChanges = 0;

    // --- Fase 1: CCAA renames ---
    console.log('=== FASE 1: CCAA renames ===');
    for (const rw of CCAA_REWRITES) {
      let q, params;
      if (rw.newProvincia) {
        q = `UPDATE bienes SET comunidad_autonoma = $1, provincia = COALESCE(NULLIF(provincia, ''), $2)
              WHERE comunidad_autonoma = $3 ${rw.whenPais ? `AND pais = $4` : ''}`;
        params = rw.whenPais ? [rw.to, rw.newProvincia, rw.from, rw.whenPais] : [rw.to, rw.newProvincia, rw.from];
      } else {
        q = `UPDATE bienes SET comunidad_autonoma = $1 WHERE comunidad_autonoma = $2 AND pais = 'España'`;
        params = [rw.to, rw.from];
      }
      const r = await client.query(q + (APPLY ? '' : ''), params);
      console.log(`  ${rw.from} → ${rw.to}${rw.newProvincia ? ' [+prov '+rw.newProvincia+']' : ''}: ${r.rowCount} bienes`);
      totalChanges += r.rowCount;
    }

    // Para Catalunya: si la provincia es nombre de comarca (Alta Ribagorza, Bages, Ripollés, Alto Campo, Cuenca de Barberá),
    // mapear a la provincia oficial
    const COMARCA_TO_PROV = {
      'Alta Ribagorza': 'Lleida',
      'Bages': 'Barcelona',
      'Ripollés': 'Girona',
      'Alto Campo': 'Tarragona',
      'Cuenca de Barberá': 'Tarragona',
      'Distrito de Gràcia': 'Barcelona',
      'Sants-Montjuic': 'Barcelona',
    };
    for (const [com, prov] of Object.entries(COMARCA_TO_PROV)) {
      const r = await client.query(`UPDATE bienes SET provincia = $1 WHERE provincia = $2 AND comunidad_autonoma = 'Catalunya'`, [prov, com]);
      if (r.rowCount > 0) {
        console.log(`  Comarca→prov: ${com} → ${prov}: ${r.rowCount}`);
        totalChanges += r.rowCount;
      }
    }

    // --- Fase 2: bienes individuales ---
    console.log('\n=== FASE 2: bienes individuales (id>265500) ===');
    let fixed = 0, deleted = 0;
    for (const f of BIEN_FIXES) {
      if (f.action === 'delete') {
        // Comprobar si tiene paradas de rutas
        const par = await client.query(`SELECT COUNT(*) FROM rutas_culturales_paradas WHERE bien_id=$1`, [f.id]);
        if (parseInt(par.rows[0].count, 10) > 0) {
          console.log(`  ⚠ id=${f.id} tiene paradas de rutas — saltando borrado`);
          continue;
        }
        await client.query(`DELETE FROM eventos_monumento WHERE bien_id=$1`, [f.id]);
        await client.query(`DELETE FROM imagenes WHERE bien_id=$1`, [f.id]);
        await client.query(`DELETE FROM wikidata WHERE bien_id=$1`, [f.id]);
        const r = await client.query(`DELETE FROM bienes WHERE id=$1`, [f.id]);
        console.log(`  delete id=${f.id}: ${r.rowCount}`);
        deleted += r.rowCount;
      } else {
        const r = await client.query(`
          UPDATE bienes SET comunidad_autonoma = $1, provincia = $2, municipio = $3
          WHERE id = $4
        `, [f.ccaa, f.provincia, f.municipio, f.id]);
        console.log(`  fix id=${f.id} → ${f.ccaa}/${f.provincia}/${f.municipio}: ${r.rowCount}`);
        fixed += r.rowCount;
      }
    }
    totalChanges += fixed + deleted;

    // --- Fase 3: provincias renames ---
    console.log('\n=== FASE 3: Provincias ===');
    // "provincia de X" → "X"
    const provs = (await client.query(`SELECT DISTINCT provincia FROM bienes WHERE pais='España' AND provincia ~* '^provincia de '`)).rows;
    for (const row of provs) {
      const cleaned = row.provincia.replace(/^provincia de /i, '').trim();
      const r = await client.query(`UPDATE bienes SET provincia = $1 WHERE provincia = $2 AND pais='España'`, [cleaned, row.provincia]);
      if (r.rowCount > 0) {
        console.log(`  ${row.provincia} → ${cleaned}: ${r.rowCount}`);
        totalChanges += r.rowCount;
      }
    }

    // Bilingues / sin tilde (España)
    for (const [from, to] of Object.entries(PROV_RENAMES_ES)) {
      const r = await client.query(`UPDATE bienes SET provincia = $1 WHERE provincia = $2 AND pais='España'`, [to, from]);
      if (r.rowCount > 0) {
        console.log(`  ${from} → ${to}: ${r.rowCount}`);
        totalChanges += r.rowCount;
      }
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\n✓ APPLY OK — total cambios: ${totalChanges}`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\n[DRY-RUN] total cambios potenciales: ${totalChanges}. Ejecutar con --apply para aplicar.`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERR:', e.message);
  } finally {
    client.release(); await p.end();
  }
})();
