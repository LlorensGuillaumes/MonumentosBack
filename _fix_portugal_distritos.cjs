const db = require('./db.cjs');

const distritos = [
  { nombre: 'Viana do Castelo', latMin: 41.6, latMax: 42.2, lonMin: -8.9, lonMax: -8.1 },
  { nombre: 'Braga', latMin: 41.3, latMax: 41.87, lonMin: -8.9, lonMax: -7.9 },
  { nombre: 'Vila Real', latMin: 41.0, latMax: 41.6, lonMin: -8.2, lonMax: -7.1 },
  { nombre: 'Porto', latMin: 40.85, latMax: 41.35, lonMin: -8.85, lonMax: -7.85 },
  { nombre: 'Faro', latMin: 36.9, latMax: 37.55, lonMin: -8.99, lonMax: -7.3 },
  { nombre: 'Lisboa', latMin: 38.4, latMax: 39.1, lonMin: -9.55, lonMax: -8.65 },
  { nombre: 'Açores', latMin: 36.9, latMax: 39.8, lonMin: -31.3, lonMax: -24.8 },
  { nombre: 'Coimbra', latMin: 39.9, latMax: 40.55, lonMin: -8.9, lonMax: -7.85 },
  { nombre: 'Évora', latMin: 38.0, latMax: 39.1, lonMin: -8.5, lonMax: -7.0 },
  { nombre: 'Portalegre', latMin: 38.7, latMax: 39.75, lonMin: -8.0, lonMax: -6.9 },
  { nombre: 'Beja', latMin: 37.4, latMax: 38.2, lonMin: -8.8, lonMax: -7.2 },
  { nombre: 'Guarda', latMin: 40.2, latMax: 41.1, lonMin: -7.8, lonMax: -6.7 },
  { nombre: 'Madeira', latMin: 32.0, latMax: 33.2, lonMin: -17.3, lonMax: -16.2 },
  { nombre: 'Setúbal', latMin: 37.9, latMax: 38.65, lonMin: -9.3, lonMax: -8.2 },
  { nombre: 'Leiria', latMin: 39.3, latMax: 40.1, lonMin: -9.1, lonMax: -8.2 },
  { nombre: 'Santarém', latMin: 38.8, latMax: 39.7, lonMin: -9.1, lonMax: -7.9 },
  { nombre: 'Aveiro', latMin: 40.4, latMax: 41.0, lonMin: -8.8, lonMax: -8.0 },
  { nombre: 'Viseu', latMin: 40.4, latMax: 41.15, lonMin: -8.2, lonMax: -7.3 },
  { nombre: 'Castelo Branco', latMin: 39.6, latMax: 40.35, lonMin: -7.9, lonMax: -6.8 },
  { nombre: 'Bragança', latMin: 41.1, latMax: 41.9, lonMin: -7.3, lonMax: -6.2 },
];

(async () => {
  const items = (await db.query("SELECT id, denominacion, latitud, longitud FROM bienes WHERE pais = 'Portugal' AND comunidad_autonoma IS NULL")).rows;
  console.log('Items sin distrito:', items.length);
  let fixed = 0;
  for (const item of items) {
    if (!item.latitud || !item.longitud) {
      console.log('  SIN COORDS: ' + item.denominacion);
      continue;
    }
    const lat = parseFloat(item.latitud);
    const lon = parseFloat(item.longitud);
    let found = null;
    for (const d of distritos) {
      if (lat >= d.latMin && lat <= d.latMax && lon >= d.lonMin && lon <= d.lonMax) {
        found = d.nombre;
        break;
      }
    }
    if (found) {
      await db.query('UPDATE bienes SET comunidad_autonoma = ? WHERE id = ?', [found, item.id]);
      console.log('  OK: ' + item.denominacion + ' -> ' + found);
      fixed++;
    } else {
      console.log('  SIN MATCH: ' + item.denominacion + ' (' + lat + ',' + lon + ')');
    }
  }
  console.log('\nAsignados: ' + fixed + '/' + items.length);
  const remaining = (await db.query("SELECT COUNT(*) as n FROM bienes WHERE pais = 'Portugal' AND comunidad_autonoma IS NULL")).rows[0].n;
  console.log('Restantes sin distrito: ' + remaining);
  await db.cerrar();
})();
