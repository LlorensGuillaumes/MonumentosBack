/**
 * Traduce nombres + descripciones de rutas_culturales a 7 idiomas via MyMemory.
 * Inserta en rutas_culturales_traducciones (idempotente: ON CONFLICT actualiza).
 */
require('dotenv').config();
const { Pool } = require('pg');

const TARGET_LANGS = ['ca','en','fr','it','pt','gl','eu'];
// MyMemory usa códigos como 'es-ES', 'en-GB', 'pt-PT', etc.
const MYMEMORY_CODE = {
  ca: 'ca-ES', en: 'en-GB', fr: 'fr-FR',
  it: 'it-IT', pt: 'pt-PT', gl: 'gl-ES', eu: 'eu-ES',
};

// MYMEMORY_EMAIL en .env duplica la cuota a 50.000 chars/día (sin tarjeta, solo email)
const EMAIL = process.env.MYMEMORY_EMAIL || '';

async function translate(text, target, source = 'es-ES') {
  if (!text || text.trim() === '') return '';
  let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;
  if (EMAIL) url += `&de=${encodeURIComponent(EMAIL)}`;
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j.responseData?.translatedText || text;
}

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  const rutas = (await p.query(`SELECT id, nombre, descripcion FROM rutas_culturales ORDER BY id`)).rows;
  console.log(`Rutas a traducir: ${rutas.length}`);

  // Insertar fila ES con texto original
  let nIns = 0;
  for (const r of rutas) {
    const res = await p.query(`
      INSERT INTO rutas_culturales_traducciones (ruta_id, lang, nombre, descripcion)
      VALUES ($1, 'es', $2, $3)
      ON CONFLICT (ruta_id, lang) DO UPDATE SET nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion
    `, [r.id, r.nombre, r.descripcion || '']);
    nIns += res.rowCount;
  }
  console.log(`ES insertado: ${nIns}`);

  // Traducir a otros idiomas
  for (const lng of TARGET_LANGS) {
    let nLng = 0;
    console.log(`\n=== ${lng} ===`);
    for (const r of rutas) {
      try {
        const nombreT = await translate(r.nombre, MYMEMORY_CODE[lng]);
        await new Promise(rs => setTimeout(rs, 250)); // throttle 4 req/s
        const descT = r.descripcion ? await translate(r.descripcion.slice(0, 500), MYMEMORY_CODE[lng]) : '';
        await new Promise(rs => setTimeout(rs, 250));
        await p.query(`
          INSERT INTO rutas_culturales_traducciones (ruta_id, lang, nombre, descripcion)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (ruta_id, lang) DO UPDATE SET nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion
        `, [r.id, lng, nombreT, descT]);
        nLng++;
        if (nLng % 10 === 0) console.log(`  ${nLng}/${rutas.length}`);
      } catch(e) {
        console.log(`  err ruta ${r.id}: ${e.message}`);
      }
    }
    console.log(`  ${lng}: ${nLng} rutas`);
  }

  await p.end();
  console.log('\n✓ Done');
})();
