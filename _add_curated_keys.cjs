// Añade claves nuevas a curatedRoutes en los 8 locales
const fs = require('fs');
const path = require('path');

const DIR = 'C:\\Users\\usuario\\Desktop\\MonumentosFront\\src\\i18n\\locales';

const TRANSLATIONS = {
  es: {
    country: 'País',
    themes: 'Temas',
    era: 'Época',
    sortBy: 'Ordenar',
    eraPrehistoric: 'Prehistoria',
    eraAncient: 'Antigüedad',
    eraEarlyMedieval: 'Alta Edad Media',
    eraMedieval: 'Baja Edad Media',
    eraModern: 'Edad Moderna',
    eraContemporary: 'Contemporáneo',
    sortFeatured: 'Destacadas',
    sortNameAsc: 'Nombre A-Z',
    sortNameDesc: 'Nombre Z-A',
    sortStopsDesc: 'Más paradas',
    sortStopsAsc: 'Menos paradas',
  },
  ca: {
    country: 'País',
    themes: 'Temes',
    era: 'Època',
    sortBy: 'Ordenar',
    eraPrehistoric: 'Prehistòria',
    eraAncient: 'Antiguitat',
    eraEarlyMedieval: 'Alta Edat Mitjana',
    eraMedieval: 'Baixa Edat Mitjana',
    eraModern: 'Edat Moderna',
    eraContemporary: 'Contemporani',
    sortFeatured: 'Destacades',
    sortNameAsc: 'Nom A-Z',
    sortNameDesc: 'Nom Z-A',
    sortStopsDesc: 'Més parades',
    sortStopsAsc: 'Menys parades',
  },
  en: {
    country: 'Country',
    themes: 'Themes',
    era: 'Era',
    sortBy: 'Sort by',
    eraPrehistoric: 'Prehistoric',
    eraAncient: 'Antiquity',
    eraEarlyMedieval: 'Early Middle Ages',
    eraMedieval: 'Middle Ages',
    eraModern: 'Early Modern',
    eraContemporary: 'Contemporary',
    sortFeatured: 'Featured',
    sortNameAsc: 'Name A-Z',
    sortNameDesc: 'Name Z-A',
    sortStopsDesc: 'Most stops',
    sortStopsAsc: 'Fewest stops',
  },
  fr: {
    country: 'Pays',
    themes: 'Thèmes',
    era: 'Époque',
    sortBy: 'Trier',
    eraPrehistoric: 'Préhistoire',
    eraAncient: 'Antiquité',
    eraEarlyMedieval: 'Haut Moyen Âge',
    eraMedieval: 'Bas Moyen Âge',
    eraModern: 'Époque moderne',
    eraContemporary: 'Contemporain',
    sortFeatured: 'En vedette',
    sortNameAsc: 'Nom A-Z',
    sortNameDesc: 'Nom Z-A',
    sortStopsDesc: 'Plus d\'étapes',
    sortStopsAsc: 'Moins d\'étapes',
  },
  it: {
    country: 'Paese',
    themes: 'Temi',
    era: 'Epoca',
    sortBy: 'Ordina',
    eraPrehistoric: 'Preistoria',
    eraAncient: 'Antichità',
    eraEarlyMedieval: 'Alto Medioevo',
    eraMedieval: 'Basso Medioevo',
    eraModern: 'Età moderna',
    eraContemporary: 'Contemporaneo',
    sortFeatured: 'In evidenza',
    sortNameAsc: 'Nome A-Z',
    sortNameDesc: 'Nome Z-A',
    sortStopsDesc: 'Più tappe',
    sortStopsAsc: 'Meno tappe',
  },
  pt: {
    country: 'País',
    themes: 'Temas',
    era: 'Época',
    sortBy: 'Ordenar',
    eraPrehistoric: 'Pré-história',
    eraAncient: 'Antiguidade',
    eraEarlyMedieval: 'Alta Idade Média',
    eraMedieval: 'Baixa Idade Média',
    eraModern: 'Idade Moderna',
    eraContemporary: 'Contemporâneo',
    sortFeatured: 'Em destaque',
    sortNameAsc: 'Nome A-Z',
    sortNameDesc: 'Nome Z-A',
    sortStopsDesc: 'Mais paragens',
    sortStopsAsc: 'Menos paragens',
  },
  gl: {
    country: 'País',
    themes: 'Temas',
    era: 'Época',
    sortBy: 'Ordenar',
    eraPrehistoric: 'Prehistoria',
    eraAncient: 'Antigüidade',
    eraEarlyMedieval: 'Alta Idade Media',
    eraMedieval: 'Baixa Idade Media',
    eraModern: 'Idade Moderna',
    eraContemporary: 'Contemporáneo',
    sortFeatured: 'Destacadas',
    sortNameAsc: 'Nome A-Z',
    sortNameDesc: 'Nome Z-A',
    sortStopsDesc: 'Máis paradas',
    sortStopsAsc: 'Menos paradas',
  },
  eu: {
    country: 'Herrialdea',
    themes: 'Gaiak',
    era: 'Garaia',
    sortBy: 'Ordenatu',
    eraPrehistoric: 'Historiaurrea',
    eraAncient: 'Antzinaroa',
    eraEarlyMedieval: 'Goi Erdi Aroa',
    eraMedieval: 'Behe Erdi Aroa',
    eraModern: 'Aro Modernoa',
    eraContemporary: 'Garaikidea',
    sortFeatured: 'Nabarmenduak',
    sortNameAsc: 'Izena A-Z',
    sortNameDesc: 'Izena Z-A',
    sortStopsDesc: 'Geldialdi gehiago',
    sortStopsAsc: 'Geldialdi gutxiago',
  },
};

for (const [lng, keys] of Object.entries(TRANSLATIONS)) {
  const file = path.join(DIR, `${lng}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.curatedRoutes = json.curatedRoutes || {};
  let added = 0;
  for (const [k, v] of Object.entries(keys)) {
    if (!json.curatedRoutes[k]) {
      json.curatedRoutes[k] = v;
      added++;
    }
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`${lng}.json: ${added} claves añadidas`);
}
