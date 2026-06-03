const fs = require('fs');
const path = require('path');
const DIR = 'C:\\Users\\usuario\\Desktop\\MonumentosFront\\src\\i18n\\locales';

const T = {
  es: { century: 'Siglo', centuries: 'Siglos', centuryAbbr: 's.', millennium: 'milenio', bc: 'a.C.', ad: 'd.C.', present: 'actualidad', early: 'inicios', late: 'Finales' },
  ca: { century: 'Segle', centuries: 'Segles', centuryAbbr: 's.', millennium: 'mil·lenni', bc: 'a.C.', ad: 'd.C.', present: 'actualitat', early: 'inicis', late: 'Finals' },
  en: { century: 'Century', centuries: 'Centuries', centuryAbbr: 'c.', millennium: 'millennium', bc: 'BC', ad: 'AD', present: 'present', early: 'early', late: 'Late' },
  fr: { century: 'Siècle', centuries: 'Siècles', centuryAbbr: 's.', millennium: 'millénaire', bc: 'av. J.-C.', ad: 'apr. J.-C.', present: 'aujourd\'hui', early: 'début', late: 'Fin' },
  it: { century: 'Secolo', centuries: 'Secoli', centuryAbbr: 'sec.', millennium: 'millennio', bc: 'a.C.', ad: 'd.C.', present: 'oggi', early: 'inizi', late: 'Fine' },
  pt: { century: 'Século', centuries: 'Séculos', centuryAbbr: 's.', millennium: 'milénio', bc: 'a.C.', ad: 'd.C.', present: 'actualidade', early: 'inícios', late: 'Finais' },
  gl: { century: 'Século', centuries: 'Séculos', centuryAbbr: 's.', millennium: 'milenio', bc: 'a.C.', ad: 'd.C.', present: 'actualidade', early: 'inicios', late: 'Finais' },
  eu: { century: 'mendea', centuries: 'mendeak', centuryAbbr: 'm.', millennium: 'milurte', bc: 'K.a.', ad: 'K.o.', present: 'gaur egun', early: 'hasiera', late: 'Amaiera' },
};

for (const [lng, keys] of Object.entries(T)) {
  const file = path.join(DIR, `${lng}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.period = json.period || {};
  let added = 0;
  for (const [k, v] of Object.entries(keys)) {
    if (json.period[k] !== v) { json.period[k] = v; added++; }
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`${lng}.json: ${added}`);
}
