const fs = require('fs');
const path = require('path');
const DIR = 'C:\\Users\\usuario\\Desktop\\MonumentosFront\\src\\i18n\\locales';

const T = {
  es: { darkMode: 'Modo oscuro', lightMode: 'Modo claro', notifications: 'Notificaciones', language: 'Idioma', close: 'Cerrar' },
  ca: { darkMode: 'Mode fosc',   lightMode: 'Mode clar',  notifications: 'Notificacions',  language: 'Idioma', close: 'Tancar' },
  en: { darkMode: 'Dark mode',   lightMode: 'Light mode', notifications: 'Notifications',  language: 'Language', close: 'Close' },
  fr: { darkMode: 'Mode sombre', lightMode: 'Mode clair', notifications: 'Notifications',  language: 'Langue', close: 'Fermer' },
  it: { darkMode: 'Modalità scura', lightMode: 'Modalità chiara', notifications: 'Notifiche', language: 'Lingua', close: 'Chiudi' },
  pt: { darkMode: 'Modo escuro', lightMode: 'Modo claro', notifications: 'Notificações',  language: 'Idioma', close: 'Fechar' },
  gl: { darkMode: 'Modo escuro', lightMode: 'Modo claro', notifications: 'Notificacións', language: 'Idioma', close: 'Pechar' },
  eu: { darkMode: 'Modu iluna',  lightMode: 'Modu argia',  notifications: 'Jakinarazpenak', language: 'Hizkuntza', close: 'Itxi' },
};

for (const [lng, keys] of Object.entries(T)) {
  const file = path.join(DIR, `${lng}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.header = json.header || {};
  let added = 0;
  for (const [k, v] of Object.entries(keys)) {
    if (json.header[k] !== v) { json.header[k] = v; added++; }
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`${lng}.json: ${added}`);
}
