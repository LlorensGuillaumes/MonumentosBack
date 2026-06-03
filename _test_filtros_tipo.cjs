require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL.replace(/\s+/g, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const CLASIFICACION_GRUPOS = {
  religiosa: ['Iglesia / Templo', 'Catedral', 'Basílica', 'Convento / Monasterio', 'Capilla / Ermita', 'Santuario', 'Cementerio', 'Cruz / Crucero', 'Arte religioso'],
  militar: ['Castillo / Fortaleza', 'Torre defensiva', 'Muralla / Recinto fortificado', 'Búnker', 'Refugio'],
  civil: ['Casa señorial / Mansión', 'Palacio', 'Edificio civil', 'Conjunto arquitectónico'],
  arqueologica: ['Yacimiento arqueológico', 'Cueva / Abrigo', 'Megalito / Dolmen', 'Calzada romana', 'Acueducto', 'Termas / Balneario antiguo'],
  etnologica: ['Molino', 'Fuente / Lavadero', 'Pozo / Aljibe', 'Horno', 'Eras / Construcción agrícola', 'Arquitectura rural'],
  infraestructura: ['Puente', 'Acueducto', 'Faro', 'Estación', 'Carretera / Puerto'],
};

(async () => {
  // 1. Cobertura tipo_monumento total
  const tot = await pool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE tipo_monumento IS NOT NULL) AS con_tipo,
           COUNT(DISTINCT tipo_monumento) AS uniq_tipos
    FROM bienes
  `);
  console.log('=== Cobertura tipo_monumento ===');
  console.log(JSON.stringify(tot.rows[0], null, 2));

  // 2. Top tipos
  const tipos = await pool.query(`
    SELECT tipo_monumento as v, COUNT(*) AS n
    FROM bienes WHERE tipo_monumento IS NOT NULL
    GROUP BY tipo_monumento ORDER BY n DESC
  `);
  console.log('\n=== TODOS los tipos_monumento ordenados por count ===');
  tipos.rows.forEach(r => console.log(`  ${String(r.n).padStart(6)}  ${r.v}`));

  // 3. Aplicar filtro religiosa y ver cuántos salen
  const tiposReligiosa = CLASIFICACION_GRUPOS.religiosa;
  const placeholders = tiposReligiosa.map((_, i) => `$${i + 1}`).join(',');
  const r1 = await pool.query(
    `SELECT COUNT(*) AS n FROM bienes WHERE tipo_monumento IN (${placeholders})`,
    tiposReligiosa
  );
  console.log(`\n=== Filtro clasificacion=religiosa → ${r1.rows[0].n} bienes ===`);

  // 4. Combinacion tipo + religion: castillo + catolicismo (no deberían existir muchos)
  const r2 = await pool.query(`
    SELECT COUNT(DISTINCT b.id) AS n
    FROM bienes b LEFT JOIN wikidata w ON w.bien_id = b.id
    WHERE b.tipo_monumento = 'Castillo / Fortaleza'
      AND (LOWER(w.religion) LIKE '%catolicismo%' OR LOWER(w.religion) LIKE '%iglesia católica%')
  `);
  console.log(`\n=== Castillos católicos → ${r2.rows[0].n} bienes ===`);

  await pool.end();
})();
