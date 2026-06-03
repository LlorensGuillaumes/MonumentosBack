/**
 * Fix: 31 monumentos no españoles tenían comunidad_autonoma = 'Aragon'
 * (sin tilde) por error en la importación inicial.
 * Asigna la región correcta por país.
 */
require('dotenv').config();
const { Pool } = require('pg');

const updates = [
  // FRANCIA
  { id: 265670, region: 'Occitanie' },          // Basílica de San Saturnino
  { id: 265657, region: 'Hauts-de-France' },    // Calais
  { id: 265658, region: 'Grand Est' },          // Catedral de Reims
  { id: 265702, region: 'Centre-Val de Loire' },// Chambord
  { id: 265703, region: 'Centre-Val de Loire' },// Chenonceau
  { id: 265716, region: 'Occitanie' },          // Peyrepertuse
  { id: 265705, region: 'Centre-Val de Loire' },// Villandry
  { id: 265715, region: 'Occitanie' },          // Carcassonne
  { id: 265687, region: 'Auvergne-Rhône-Alpes' },// Chauvet
  { id: 265686, region: 'Nouvelle-Aquitaine' }, // Lascaux
  { id: 265548, region: 'Normandie' },          // Mont-Saint-Michel
  { id: 265560, region: 'Grand Est' },          // Neuf-Brisach
  { id: 265696, region: 'Île-de-France' },      // Père-Lachaise
  { id: 265571, region: 'Grand Est' },          // Struthof

  // ITALIA
  { id: 265586, region: 'Lombardia' },          // Abbazia di Piona
  { id: 265669, region: 'Lombardia' },          // Basílica San Miguel Mayor
  { id: 265581, region: 'Lombardia' },          // Castello di Vezio
  { id: 265585, region: 'Lombardia' },          // Chiesetta di San Rocco
  { id: 265664, region: 'Lazio' },              // Roma (Plaza San Pedro)
  { id: 265588, region: 'Lombardia' },          // Santuario Madonna di Valpozzo
  { id: 265583, region: 'Lombardia' },          // Santuario Madonna di Lezzeno
  { id: 265663, region: 'Toscana' },            // Siena
  { id: 265678, region: 'Sardegna' },           // Tharros

  // PORTUGAL
  { id: 265547, region: 'Santarém' },           // Convento de Cristo
  { id: 265557, region: 'Portalegre' },         // Menir da Meada
  { id: 265673, region: 'Porto' },              // Monasterio de Paço de Sousa

  // REINO UNIDO
  { id: 265655, region: 'Sudeste de Inglaterra' },// Canterbury
  { id: 265712, region: 'Nordeste de Inglaterra' },// Housesteads

  // RUMANÍA
  { id: 265700, region: 'Maramureș' },          // Săpânța
  { id: 265726, region: 'Suceava' },            // Monasterio de Humor

  // ALEMANIA
  { id: 265671, region: 'Sajonia-Anhalt' },     // Quedlinburg
];

(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  const client = await p.connect();

  try {
    await client.query('BEGIN');

    let updated = 0;
    for (const { id, region } of updates) {
      const r = await client.query(
        'UPDATE bienes SET comunidad_autonoma = $1 WHERE id = $2 AND comunidad_autonoma = $3',
        [region, id, 'Aragon']
      );
      if (r.rowCount === 1) updated++;
      else console.warn(`Aviso: id=${id} no actualizado (rowCount=${r.rowCount})`);
    }

    // Salvaguarda: comprobar que ya no queda ninguno con 'Aragon' (sin tilde)
    const left = await client.query(
      "SELECT COUNT(*)::int AS n FROM bienes WHERE comunidad_autonoma = 'Aragon'"
    );

    await client.query('COMMIT');

    console.log(`\nActualizados: ${updated} / ${updates.length}`);
    console.log(`Restantes con 'Aragon' (sin tilde): ${left.rows[0].n}`);

    // Verificación: distribución final
    const verif = await client.query(`
      SELECT pais, comunidad_autonoma, COUNT(*) AS n
      FROM bienes
      WHERE id = ANY($1)
      GROUP BY pais, comunidad_autonoma
      ORDER BY pais, comunidad_autonoma
    `, [updates.map(u => u.id)]);
    console.log('\nDistribución final de los 31 registros:');
    console.table(verif.rows);

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERROR — rollback:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await p.end();
  }
})();
