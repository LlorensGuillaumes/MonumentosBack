/**
 * Exporta eventos de la BD (qid → label) y actualiza los 8 JSON i18n
 * en MonumentosFront con cualquier QID nuevo que no estuviera presente.
 *
 * Solo añade entradas que faltan; no toca las existentes.
 * Usa el label en español de la BD para todos los idiomas (fallback).
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = 'C:\\Users\\usuario\\Desktop\\MonumentosFront\\src\\i18n\\locales';
const LOCALES = ['es','ca','en','eu','fr','gl','it','pt'];

const PADRE_LABELS = {
  'Q10859':   'Guerra Civil Española',
  'Q152499':  'Guerra de Independencia Española',
  'Q150701':  'Guerra de Sucesión Española',
  'Q79791':   'Reconquista',
  'Q1178424': 'Guerras Carlistas',
  'Q1501724': 'Guerra de Restauración portuguesa',
  'Q2105495': 'Crisis de 1383-1385',
  'Q164432':  'Guerra de los Ochenta Años',
  'Q51657':   'Cruzada albigense',
  'Q78994':   'Guerras Napoleónicas',
  'Q362':     'Segunda Guerra Mundial',
  'Q1200506': 'Desamortización española',
  'Q6534':    'Revolución Francesa',
  'Q66344':   'Revolución Industrial',
  'Q166713':  'Risorgimento',
  'Q8065':    'Desastres naturales',
};

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });

  // Obtener mapa qid → label (preferir el label más informativo si hay varios)
  const r = await p.query(`
    SELECT qid_evento as qid, MIN(evento) as label
    FROM eventos_monumento
    WHERE qid_evento IS NOT NULL AND evento IS NOT NULL AND evento != ''
    GROUP BY qid_evento
  `);
  const eventosMap = {};
  for (const row of r.rows) eventosMap[row.qid] = row.label;
  console.log(`Eventos únicos en BD: ${r.rows.length}`);

  // Añadir padres explícitos (por si no aparecen como qid_evento)
  for (const [qid, label] of Object.entries(PADRE_LABELS)) {
    if (!eventosMap[qid]) eventosMap[qid] = label;
  }

  await p.end();

  // Actualizar cada locale
  for (const lng of LOCALES) {
    const file = path.join(LOCALES_DIR, `${lng}.json`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    json.filters = json.filters || {};
    json.filters.events = json.filters.events || {};
    let added = 0;
    for (const [qid, label] of Object.entries(eventosMap)) {
      if (!json.filters.events[qid]) {
        json.filters.events[qid] = label; // mismo label español como fallback
        added++;
      }
    }
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`${lng}.json: añadidos ${added} QIDs`);
  }
})();
