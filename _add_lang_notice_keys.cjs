const fs = require('fs');
const path = require('path');
const DIR = 'C:\\Users\\usuario\\Desktop\\MonumentosFront\\src\\i18n\\locales';

const T = {
  es: { spanishOnly: 'Texto disponible solo en español',     translateWithGoogle: 'Traducir con Google' },
  ca: { spanishOnly: 'Text disponible només en castellà',    translateWithGoogle: 'Tradueix amb Google' },
  en: { spanishOnly: 'Text only available in Spanish',       translateWithGoogle: 'Translate with Google' },
  fr: { spanishOnly: 'Texte disponible uniquement en espagnol', translateWithGoogle: 'Traduire avec Google' },
  it: { spanishOnly: 'Testo disponibile solo in spagnolo',   translateWithGoogle: 'Traduci con Google' },
  pt: { spanishOnly: 'Texto disponível apenas em espanhol',  translateWithGoogle: 'Traduzir com Google' },
  gl: { spanishOnly: 'Texto dispoñible só en castelán',      translateWithGoogle: 'Traducir con Google' },
  eu: { spanishOnly: 'Testua gaztelaniaz bakarrik dago eskuragarri', translateWithGoogle: 'Itzuli Googlerekin' },
};

for (const [lng, keys] of Object.entries(T)) {
  const file = path.join(DIR, `${lng}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.detail = json.detail || {};
  let added = 0;
  for (const [k, v] of Object.entries(keys)) {
    if (json.detail[k] !== v) { json.detail[k] = v; added++; }
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`${lng}.json: ${added}`);
}
