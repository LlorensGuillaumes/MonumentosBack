const axios = require('axios');
const removeAccents = require('remove-accents'); // npm install remove-accents

function normalizarTexto(texto) {
  return removeAccents(texto.toLowerCase()).replace(/[^a-z0-9 ]/g, '').trim();
}

async function buscarEnWikipediaEnIdioma(nombre, idiomaBusqueda) {
  const url = `https://${idiomaBusqueda}.wikipedia.org/w/api.php`;
  const nombreNorm = normalizarTexto(nombre);

  try {
    const response = await axios.get(url, {
      params: {
        action: 'query',
        format: 'json',
        list: 'search',
        srsearch: nombre,
        srlimit: 5,
        srprop: 'snippet|titlesnippet|pageid',
      }
    });

    const resultados = response.data.query.search;
    if (resultados.length === 0) {
      return [];
    }

    // Asignar puntuación a cada resultado
    return resultados.map(r => {
      const tituloNorm = normalizarTexto(r.title);
      let score = 0;
      if (tituloNorm.includes(nombreNorm) || nombreNorm.includes(tituloNorm)) {
        score = 1;
      }
      return { ...r, score, idioma: idiomaBusqueda };
    });

  } catch (error) {
    console.error(`⚠️ Error consultando Wikipedia (${idiomaBusqueda}):`, error.message);
    return [];
  }
}

async function buscarEnWikipediaYElegirCoincidente(nombre, idiomaBusqueda1 = 'ca', idiomaBusqueda2 = 'es') {
  // Buscar en ambos idiomas simultáneamente
  const resultadosCat = await buscarEnWikipediaEnIdioma(nombre, idiomaBusqueda1);
  const resultadosEsp = await buscarEnWikipediaEnIdioma(nombre, idiomaBusqueda2);

  const todosResultados = [...resultadosCat, ...resultadosEsp];

  if (todosResultados.length === 0) {
    console.log(`❌ No se encontró nada en Wikipedia ni en ${idiomaBusqueda1} ni en ${idiomaBusqueda2} para "${nombre}"`);
    return;
  }

  // Elegir el mejor resultado global por score (y si empate, el primero)
  todosResultados.sort((a, b) => b.score - a.score);
  const mejorResultado = todosResultados[0];

  console.log('Mejor resultado:');
  console.log(`🔹 Título: ${mejorResultado.title} (${mejorResultado.idioma})`);
  console.log(`   Extracto: ${mejorResultado.snippet.replace(/<\/?[^>]+(>|$)/g, '')}...`);
  console.log(`   Página ID: ${mejorResultado.pageid}`);
  console.log(`   URL: https://${mejorResultado.idioma}.wikipedia.org/wiki/${encodeURIComponent(mejorResultado.title)}`);

  await obtenerDetallesPaginaWikipedia(mejorResultado.pageid, mejorResultado.idioma);

  const qid = await obtenerQIDdeWikipedia(mejorResultado.pageid, mejorResultado.idioma);
  if (qid) {
    await consultarWikidata(qid);
  } else {
    console.log('❌ No se encontró QID en Wikidata para esta página.');
  }
}

async function obtenerDetallesPaginaWikipedia(pageid, idioma = 'es') {
  const url = `https://${idioma}.wikipedia.org/w/api.php`;
  try {
    const response = await axios.get(url, {
      params: {
        action: 'query',
        pageids: pageid,
        format: 'json',
        prop: 'extracts|pageimages|categories|info|coordinates',
        exintro: true,
        explaintext: true,
        piprop: 'original',
        inprop: 'url',
      }
    });

    const page = response.data.query.pages[pageid];
    if (!page) {
      console.log('❌ Página no encontrada');
      return;
    }

    console.log(page)
    // console.log('--- Detalles Wikipedia ---');
    // console.log('Título:', page.title);
    // console.log('Extracto:', page.extract);
    // console.log('URL:', page.fullurl);

    if (page.original) {
      console.log('Imagen principal:', page.original.source);
    } else {
      console.log('Imagen principal: No disponible');
    }

    if (page.categories) {
      console.log('Categorías:', page.categories.map(cat => cat.title).join(', '));
    } else {
      console.log('Categorías: No disponibles');
    }

    if (page.coordinates && page.coordinates.length > 0) {
      console.log('Coordenadas:');
      console.log('  Latitud:', page.coordinates[0].lat);
      console.log('  Longitud:', page.coordinates[0].lon);
    } else {
      console.log('Coordenadas: No disponibles');
    }

  } catch (error) {
    console.error('⚠️ Error al obtener detalles:', error.message);
  }
}

async function obtenerQIDdeWikipedia(pageid, idioma = 'ca') {
  const url = `https://${idioma}.wikipedia.org/w/api.php`;
  try {
    const response = await axios.get(url, {
      params: {
        action: 'query',
        pageids: pageid,
        format: 'json',
        prop: 'pageprops',
      }
    });

    const page = response.data.query.pages[pageid];
    if (!page) {
      console.log('❌ Página no encontrada para obtener QID');
      return null;
    }

    const qid = page.pageprops?.wikibase_item;
    if (qid) {
      console.log('QID de Wikidata:', qid);
      return qid;
    } else {
      return null;
    }

  } catch (error) {
    console.error('⚠️ Error al obtener QID:', error.message);
    return null;
  }
}

async function consultarWikidata(qid) {
  const endpoint = 'https://query.wikidata.org/sparql';
  const query = `
SELECT ?item ?itemLabel ?description
       ?image ?coord ?inception ?endTime ?designatedTime ?modifiedTime
       ?locationLabel ?architectLabel ?architecturalStyleLabel
       ?physicalLocationLabel ?height ?area ?creatorLabel ?mainMaterialLabel
       ?heritageLabel ?awardLabel ?officialWebsite ?commonsCategory
       ?externalUrl ?referenceUrl ?registryNumber ?heritageStatusLabel
       ?countryLabel ?municipalityLabel ?heritageDesignationDate
       ?startDate ?completionDate ?demolitionDate ?restorationDate
WHERE {
  VALUES ?item { wd:${qid} }

  OPTIONAL { ?item schema:description ?description FILTER(LANG(?description) = "es") }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P582 ?endTime }
  OPTIONAL { ?item wdt:P580 ?designatedTime }
  OPTIONAL { ?item wdt:P674 ?modifiedTime }
  OPTIONAL { ?item wdt:P131 ?location }
  OPTIONAL { ?item wdt:P84 ?architect }
  OPTIONAL { ?item wdt:P149 ?architecturalStyle }
  OPTIONAL { ?item wdt:P276 ?physicalLocation }
  OPTIONAL { ?item wdt:P2044 ?height }
  OPTIONAL { ?item wdt:P2049 ?area }
  OPTIONAL { ?item wdt:P50 ?creator }
  OPTIONAL { ?item wdt:P186 ?mainMaterial }
  OPTIONAL { ?item wdt:P2581 ?heritage }
  OPTIONAL { ?item wdt:P1435 ?award }
  OPTIONAL { ?item wdt:P856 ?officialWebsite }
  OPTIONAL { ?item wdt:P373 ?commonsCategory }
  OPTIONAL { ?item wdt:P2699 ?externalUrl }
  OPTIONAL { ?item wdt:P854 ?referenceUrl }
  OPTIONAL { ?item wdt:P528 ?registryNumber }
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL { ?item wdt:P131 ?municipality }
  OPTIONAL { ?item wdt:P580 ?heritageDesignationDate }
  OPTIONAL { ?item wdt:P580 ?startDate }
  OPTIONAL { ?item wdt:P574 ?completionDate }
  OPTIONAL { ?item wdt:P576 ?demolitionDate }
  OPTIONAL { ?item wdt:P585 ?restorationDate }
  OPTIONAL { ?item wdt:P4174 ?heritageStatus }

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "es,en".
    ?item rdfs:label ?itemLabel.
    ?location rdfs:label ?locationLabel.
    ?architect rdfs:label ?architectLabel.
    ?architecturalStyle rdfs:label ?architecturalStyleLabel.
    ?physicalLocation rdfs:label ?physicalLocationLabel.
    ?creator rdfs:label ?creatorLabel.
    ?mainMaterial rdfs:label ?mainMaterialLabel.
    ?heritage rdfs:label ?heritageLabel.
    ?award rdfs:label ?awardLabel.
    ?country rdfs:label ?countryLabel.
    ?municipality rdfs:label ?municipalityLabel.
    ?heritageStatus rdfs:label ?heritageStatusLabel.
  }
}
LIMIT 1

`;

  try {
    const res = await axios.get(endpoint, {
      params: { query, format: 'json' },
      headers: { Accept: 'application/sparql-results+json' }
    });

    const results = res.data.results.bindings;
    if (results.length === 0) {
      console.log('❌ No se encontraron datos en Wikidata para el QID:', qid);
      return;
    }

    const item = results[0];
    console.log('--- Datos Wikidata ---');
    console.log(item);

  } catch (error) {
    console.error('⚠️ Error consultando Wikidata:', error.message);
  }
}

// Ejemplo de uso
buscarEnWikipediaYElegirCoincidente("Esglesia de sant joan d'isil", "ca", "es");
