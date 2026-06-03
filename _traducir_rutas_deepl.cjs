/**
 * Traduce nombres + descripciones de rutas_culturales via DeepL Free API.
 * Idempotente: ON CONFLICT (ruta_id, lang) UPDATE.
 *
 * Requiere DEEPL_API_KEY en .env (acaba en ":fx" para Free).
 * Costos: 68 rutas × 7 idiomas × ~380 chars/ruta = ~180k chars (cabe en 500k/mes).
 */
require('dotenv').config();
const { Pool } = require('pg');

const TARGET_LANGS = ['ca','en','fr','it','pt','gl','eu'];
// DeepL no soporta ca, gl, eu — usar fallback
const DEEPL_CODE = {
  en: 'EN-GB',
  fr: 'FR',
  it: 'IT',
  pt: 'PT-PT',
};
// Idiomas no soportados por DeepL: ca, gl, eu
const NOT_SUPPORTED = ['ca','gl','eu'];

const KEY = process.env.DEEPL_API_KEY;
if (!KEY) { console.error('Falta DEEPL_API_KEY en .env'); process.exit(1); }
const HOST = KEY.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';

async function translate(text, target, source = 'ES') {
  if (!text || text.trim() === '') return '';
  const r = await fetch(`${HOST}/v2/translate`, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ text, source_lang: source, target_lang: target }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 100));
  const j = await r.json();
  return j.translations?.[0]?.text || text;
}

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  const rutas = (await p.query(`SELECT id, nombre, descripcion FROM rutas_culturales ORDER BY id`)).rows;
  console.log(`Rutas a traducir: ${rutas.length}`);

  // ES original
  for (const r of rutas) {
    await p.query(`
      INSERT INTO rutas_culturales_traducciones (ruta_id, lang, nombre, descripcion)
      VALUES ($1, 'es', $2, $3)
      ON CONFLICT (ruta_id, lang) DO UPDATE SET nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion
    `, [r.id, r.nombre, r.descripcion || '']);
  }

  // Idiomas soportados por DeepL
  for (const lng of TARGET_LANGS) {
    if (NOT_SUPPORTED.includes(lng)) {
      console.log(`\n${lng}: NO soportado por DeepL — saltando (tendrá fallback al original)`);
      continue;
    }
    let nLng = 0;
    console.log(`\n=== ${lng} ===`);
    for (const r of rutas) {
      try {
        const nombreT = await translate(r.nombre, DEEPL_CODE[lng]);
        const descT = r.descripcion ? await translate(r.descripcion.slice(0, 1000), DEEPL_CODE[lng]) : '';
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
