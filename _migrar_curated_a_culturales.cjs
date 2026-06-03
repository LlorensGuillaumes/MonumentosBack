/**
 * _migrar_curated_a_culturales.cjs
 *
 * Migra las 35 rutas curadas de curatedRoutes.js a rutas_culturales en BD,
 * buscando cada highlight como parada vinculada a un bien existente.
 *
 * Matching strategy:
 *   1. Busca bienes por denominacion ILIKE '%keyword%'
 *   2. Si hay radiusSearch o center, filtra por proximidad geográfica
 *   3. Si hay múltiples matches, elige el más cercano al center de la ruta
 *   4. Si no hay match → crea parada sin bien_id (log para revisión)
 *
 * Uso:
 *   node _migrar_curated_a_culturales.cjs                  # dry-run
 *   node _migrar_curated_a_culturales.cjs --apply           # apply
 *   node _migrar_curated_a_culturales.cjs --solo romanico-valle-boi  # solo una ruta
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const soloIdx = process.argv.indexOf('--solo');
const SOLO = soloIdx !== -1 ? process.argv[soloIdx + 1] : null;

const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''), ssl: { rejectUnauthorized: false } })
    : new Pool({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'patrimonio',
        password: process.env.PGPASSWORD || 'patrimonio2026',
        database: process.env.PGDATABASE || 'patrimonio',
    });

const DB_LABEL = process.env.DATABASE_URL ? 'NEON' : 'LOCAL';

// ============== CURATED ROUTES DATA ==============
// Copiado de curatedRoutes.js (no podemos importar ESM desde CJS)
const CURATED_ROUTES = [
  {
    id: 'romanico-camino-frances', theme: 'romanesque', countries: ['España'],
    name: 'Camino Francés – Ruta Románica', period: 'Siglos XI–XIII',
    highlights: ['Catedral de Jaca', 'San Martín de Frómista', 'San Isidoro de León', 'Catedral de Santiago'],
    center: { lat: 42.6, lng: -4.5 }, zoom: 7,
  },
  {
    id: 'romanico-valle-boi', theme: 'romanesque', countries: ['España'],
    name: 'Valle de Boí – Románico Lombardo UNESCO', period: 'Siglos XI–XII',
    highlights: ['Sant Climent de Taüll', 'Santa Maria de Taüll', 'Sant Joan de Boí', "Santa Eulàlia d'Erill la Vall", 'Sant Feliu de Barruera', 'Nativitat de la Mare de Déu de Durro', 'Sant Quirc de Durro', 'Santa Maria de Cardet', "Santa Maria de l'Assumpció de Coll"],
    center: { lat: 42.52, lng: 0.83 }, zoom: 12, radiusKm: 15,
  },
  {
    id: 'romanico-palentino', theme: 'romanesque', countries: ['España'],
    name: 'Románico Palentino', period: 'Siglos XI–XIII',
    highlights: ['San Martín de Frómista', 'San Andrés de Arroyo', 'San Pedro de Moarves'],
    center: { lat: 42.65, lng: -4.52 }, zoom: 9, radiusKm: 60,
  },
  {
    id: 'romanico-aragones', theme: 'romanesque', countries: ['España'],
    name: 'Románico Aragonés – Jacetania y Serrablo', period: 'Siglos XI–XII',
    highlights: ['Catedral de Jaca', 'San Juan de la Peña', 'Castillo de Loarre'],
    center: { lat: 42.45, lng: -0.6 }, zoom: 9,
  },
  {
    id: 'romanico-cantabrico', theme: 'romanesque', countries: ['España'],
    name: 'Románico Cantábrico – Camino del Norte', period: 'Siglos XII–XIII',
    highlights: ['Santa María de la Oliva', 'San Antolín de Bedón', 'Santa María de Bareyo'],
    center: { lat: 43.3, lng: -4.0 }, zoom: 8, radiusKm: 100,
  },
  {
    id: 'romanico-soriano', theme: 'romanesque', countries: ['España'],
    name: 'Románico Soriano', period: 'Siglos XII–XIII',
    highlights: ['Santo Domingo de Soria', 'San Juan de Rabanera', 'San Miguel de San Esteban'],
    center: { lat: 41.76, lng: -2.47 }, zoom: 9, radiusKm: 60,
  },
  {
    id: 'gotico-catedrales-francia', theme: 'gothic', countries: ['Francia'],
    name: 'Grandes Catedrales Góticas de Francia', period: 'Siglos XII–XV',
    highlights: ['Chartres', 'Amiens', 'Reims', 'Notre-Dame de Paris'],
    center: { lat: 48.8, lng: 2.8 }, zoom: 7,
  },
  {
    id: 'gotico-levantino', theme: 'gothic', countries: ['España'],
    name: 'Gótico Levantino – Valencia', period: 'Siglos XIV–XVI',
    highlights: ['Lonja de la Seda', 'Catedral de Valencia', 'Torres de Serranos'],
    center: { lat: 39.47, lng: -0.38 }, zoom: 9,
  },
  {
    id: 'gotico-catedrales-castilla', theme: 'gothic', countries: ['España'],
    name: 'Tres Catedrales Góticas de Castilla', period: 'Siglos XIII–XVI',
    highlights: ['Catedral de Burgos', 'Catedral de León', 'Catedral de Palencia'],
    center: { lat: 42.35, lng: -4.0 }, zoom: 8,
  },
  {
    id: 'mudejar-aragones', theme: 'mudejar', countries: ['España'],
    name: 'Mudéjar Aragonés – Patrimonio UNESCO', period: 'Siglos XII–XVI',
    highlights: ['Aljafería', 'Torres de Teruel', 'Colegiata de Calatayud'],
    center: { lat: 41.2, lng: -1.2 }, zoom: 8,
  },
  {
    id: 'renacimiento-ubeda-baeza', theme: 'renaissance', countries: ['España'],
    name: 'Renacimiento Andaluz – Úbeda y Baeza UNESCO', period: 'Siglo XVI',
    highlights: ['Sacra Capilla del Salvador', 'Hospital de Santiago', 'Catedral de Baeza'],
    center: { lat: 38.0, lng: -3.37 }, zoom: 11, radiusKm: 30,
  },
  {
    id: 'barroco-salamanca', theme: 'renaissance', countries: ['España'],
    name: 'Barroco Churrigueresco – Salamanca', period: 'Siglos XVII–XVIII',
    highlights: ['Plaza Mayor', 'Clerecía', 'Catedral Nueva', 'San Esteban'],
    center: { lat: 40.96, lng: -5.66 }, zoom: 12, radiusKm: 15,
  },
  {
    id: 'cister-cataluna', theme: 'monasteries', countries: ['España'],
    name: 'Ruta del Cister – Cataluña', period: 'Siglos XII–XIV',
    highlights: ['Monasterio de Poblet', 'Santes Creus', 'Vallbona de les Monges'],
    center: { lat: 41.5, lng: 1.1 }, zoom: 9,
  },
  {
    id: 'mosteiros-portugal', theme: 'monasteries', countries: ['Portugal'],
    name: 'Rota dos Mosteiros – Portugal UNESCO', period: 'Siglos XII–XVI',
    highlights: ['Mosteiro de Alcobaça', 'Mosteiro da Batalha', 'Convento de Cristo de Tomar'],
    center: { lat: 39.55, lng: -8.8 }, zoom: 9,
  },
  {
    id: 'abadias-normandia', theme: 'monasteries', countries: ['Francia'],
    name: 'Abadías de Normandía', period: 'Siglos XI–XVI',
    highlights: ['Mont Saint-Michel', 'Saint-Wandrille', 'Abadía de La Trappe'],
    center: { lat: 48.8, lng: -1.0 }, zoom: 8, radiusKm: 150,
  },
  {
    id: 'chateaux-loire', theme: 'castles', countries: ['Francia'],
    name: 'Châteaux del Valle del Loira', period: 'Siglos XV–XVI',
    highlights: ['Chambord', 'Chenonceau', 'Blois', 'Amboise'],
    center: { lat: 47.4, lng: 1.2 }, zoom: 8, radiusKm: 100,
  },
  {
    id: 'castillos-cataros', theme: 'castles', countries: ['Francia'],
    name: 'Castillos Cátaros – Languedoc', period: 'Siglos XII–XIII',
    highlights: ['Carcassonne', 'Peyrepertuse', 'Quéribus', 'Montségur'],
    center: { lat: 42.9, lng: 2.3 }, zoom: 9, radiusKm: 80,
  },
  {
    id: 'castillos-castilla', theme: 'castles', countries: ['España'],
    name: 'Castillos de Castilla – Frontera y Defensa', period: 'Siglos XII–XV',
    highlights: ['Alcázar de Segovia', 'Castillo de Peñafiel', 'Castillo de Coca'],
    center: { lat: 41.5, lng: -4.5 }, zoom: 8,
  },
  {
    id: 'ruta-templaria', theme: 'castles', countries: ['España', 'Portugal'],
    name: 'Ruta Templaria – España y Portugal', period: 'Siglos XII–XIV',
    highlights: ['Castillo de Ponferrada', 'Castillo de Miravet', 'Convento de Cristo de Tomar'],
    center: { lat: 40.5, lng: -4.0 }, zoom: 6,
  },
  {
    id: 'ruta-nazari', theme: 'islamic', countries: ['España'],
    name: 'Ruta Nazarí – Legado Andalusí', period: 'Siglos XIII–XV',
    highlights: ['Alhambra', 'Alcazaba de Almería', 'Alcazaba de Málaga'],
    center: { lat: 37.18, lng: -3.6 }, zoom: 8,
  },
  {
    id: 'reinos-taifa', theme: 'islamic', countries: ['España'],
    name: 'Reinos Taifa – Palacios y Alcazabas', period: 'Siglo XI',
    highlights: ['Aljafería de Zaragoza', 'Alcázar de Toledo', 'Murallas de Badajoz'],
    center: { lat: 39.5, lng: -3.5 }, zoom: 6,
  },
  {
    id: 'prerromanico-asturiano', theme: 'preromanesque', countries: ['España'],
    name: 'Prerrománico Asturiano – UNESCO', period: 'Siglos IX–X',
    highlights: ['Santa María del Naranco', 'San Miguel de Lillo', 'San Julián de los Prados'],
    center: { lat: 43.36, lng: -5.84 }, zoom: 10,
  },
  {
    id: 'ruta-mozarabe', theme: 'preromanesque', countries: ['España'],
    name: 'Ruta Mozárabe – Toledo y El Bierzo', period: 'Siglos IX–XI',
    highlights: ['Santa Eulalia de Toledo', 'Santo Tomás de las Ollas', 'Santiago de Peñalba'],
    center: { lat: 40.5, lng: -4.5 }, zoom: 7,
  },
  {
    id: 'via-de-la-plata', theme: 'roman', countries: ['España'],
    name: 'Vía de la Plata – Patrimonio Romano', period: 'Siglos II a.C. – II d.C.',
    highlights: ['Mérida', 'Astorga', 'Cáparra', 'Puente de Alcántara'],
    center: { lat: 39.5, lng: -6.0 }, zoom: 7,
  },
  {
    id: 'megalitica-alentejo', theme: 'megalithic', countries: ['Portugal'],
    name: 'Ruta Megalítica del Alentejo', period: 'IV–III milenio a.C.',
    highlights: ['Anta Grande do Zambujeiro', 'Menhir da Meada', 'Cromlech de Almendres'],
    center: { lat: 38.57, lng: -7.9 }, zoom: 9,
  },
  {
    id: 'dolmenes-antequera', theme: 'megalithic', countries: ['España'],
    name: 'Dólmenes de Antequera – UNESCO', period: 'III–II milenio a.C.',
    highlights: ['Dolmen de Menga', 'Dolmen de Viera', 'Tholos de El Romeral'],
    center: { lat: 37.02, lng: -4.56 }, zoom: 12, radiusKm: 20,
  },
  {
    id: 'arte-rupestre-cantabrico', theme: 'megalithic', countries: ['España'],
    name: 'Arte Rupestre Paleolítico – Cornisa Cantábrica', period: '35.000–11.000 a.C.',
    highlights: ['Cueva de Altamira', 'Cueva de Ekain', 'Tito Bustillo', 'El Castillo'],
    center: { lat: 43.3, lng: -4.1 }, zoom: 8,
  },
  {
    id: 'fortificaciones-vauban', theme: 'fortifications', countries: ['Francia'],
    name: 'Fortificaciones de Vauban – UNESCO', period: 'Siglo XVII',
    highlights: ['Mont-Louis', 'Briançon', 'Besançon', 'Neuf-Brisach'],
    center: { lat: 47.0, lng: 3.0 }, zoom: 6,
  },
  {
    id: 'castillos-frontera-cataluna', theme: 'fortifications', countries: ['España'],
    name: 'Castillos de Frontera – Cataluña', period: 'Siglos X–XIV',
    highlights: ['Castillo de Cardona', 'Monasterio de Ripoll', 'Castillo del Gaià'],
    center: { lat: 41.9, lng: 1.7 }, zoom: 8,
  },
  {
    id: 'camino-frances', theme: 'camino', countries: ['España'],
    name: 'Camino Francés – Ruta Jacobea Principal', period: 'Siglos XI–actualidad',
    highlights: ['Catedral de Pamplona', 'Catedral de Burgos', 'Catedral de León', 'Catedral de Santiago'],
    center: { lat: 42.5, lng: -4.5 }, zoom: 7,
  },
  {
    id: 'camino-primitivo', theme: 'camino', countries: ['España'],
    name: 'Camino Primitivo – La Primera Ruta Jacobea', period: 'Siglos IX–XIII',
    highlights: ['Catedral de Oviedo', 'Santa María del Naranco', 'Catedral de Lugo', 'Catedral de Santiago'],
    center: { lat: 43.2, lng: -6.5 }, zoom: 8, radiusKm: 120,
  },
  {
    id: 'camino-portugues', theme: 'camino', countries: ['Portugal', 'España'],
    name: 'Camino Portugués – Lisboa/Porto a Santiago', period: 'Siglos XII–actualidad',
    highlights: ['Catedral de Lisboa', 'Catedral de Porto', 'Catedral de Tui', 'Catedral de Santiago'],
    center: { lat: 40.5, lng: -8.3 }, zoom: 7, radiusKm: 100,
  },
  {
    id: 'modernismo-catalan', theme: 'modernist', countries: ['España'],
    name: 'Modernismo Catalán – Gaudí y Domènech', period: 'Finales s. XIX – inicios s. XX',
    highlights: ['Sagrada Familia', 'Park Güell', 'Casa Batlló', 'Palau de la Música'],
    center: { lat: 41.39, lng: 2.17 }, zoom: 12,
  },
  {
    id: 'palacios-reales', theme: 'palaces', countries: ['España'],
    name: 'Palacios Reales – Sitios Reales de España', period: 'Siglos XVI–XVIII',
    highlights: ['Palacio Real de Madrid', 'El Escorial', 'Aranjuez', 'La Granja'],
    center: { lat: 40.42, lng: -3.7 }, zoom: 8,
  },
  {
    id: 'ceramica-toledana', theme: 'renaissance', countries: ['España'],
    name: 'Cerámica Toledana – Patrimonio UNESCO', period: 'Siglos XVI–actualidad',
    highlights: ['Basílica del Prado', 'Convento de las Bernardas', 'Talleres artesanales'],
    center: { lat: 39.96, lng: -4.83 }, zoom: 10,
  },
];

// ============== MANUAL OVERRIDES ==============
// Monumentos que están en BD con nombre diferente al highlight.
// bien_id directo evita matching fuzzy erróneo.
const OVERRIDES = {
    'Catedral de Lisboa': 143614,      // "Sé de Lisboa"
    'Catedral de Porto': 142352,       // "Sé do Porto"
    'Cromlech de Almendres': 143898,   // "Cromeleque dos Almendres"
    'Catedral de Santiago': 73706,     // "Catedral Basílica Metropolitana de Santiago de Compostela"
    'Catedral de León': 77762,         // "Catedral de Santa María de Regla de León"
    'Catedral de Oviedo': 74143,       // "Catedral de San Salvador de Oviedo"
    'Catedral de Lugo': 73712,         // "Catedral de Santa María de Lugo"
    'Catedral de Burgos': 76688,       // "catedral de Burgos"
    'Catedral de Pamplona': 84251,     // "Catedral de Pamplona"
    'Catedral de Palencia': 76472,     // "catedral de San Antolín de Palencia"
    'Colegiata de Calatayud': 228939,  // "colegiata de Santa María la Mayor de Calatayud"
    'Catedral de Valencia': null,       // no encontrada — NULL para que no matchee basura
    'Catedral de Tui': null,
    'Catedral de Baeza': null,         // no es catedral real en BD
    'Sagrada Familia': null,           // id 90178 es Madrid, no Barcelona — skip
    'Astorga': null,                   // "Casa Astorga" no es Astorga romana
    'Mérida': null,                    // "Santa Catalina Basilica, Mérida" no es lo que buscamos
    'Aranjuez': 80351,                 // "Zona arqueológica de Aranjuez" — aceptable
    'Talleres artesanales': null,      // no es un monumento
    // Falsos positivos a bloquear (matching por token suelto devuelve basura)
    'Chartres': null,                  // BD solo tiene vía romana que menciona Chartres
    'Amiens': null,                    // BD solo tiene hôtel des évêques
    'Reims': null,                     // BD solo tiene voies romaines
    'Besançon': null,                  // BD solo tiene aeródromo
    'Santes Creus': null,              // "Antic Casal" no es el monasterio
    'Sant Joan de Boí': null,          // "Casa Joan Bares" es falso positivo
    'Castillo de Cardona': null,       // "Camí Ral de Manresa a Cardona" no es el castillo
    'Monasterio de Ripoll': null,      // "Ripoll de Can Brunet" no es el monasterio
};

// ============== MATCHING ==============

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Busca un highlight en bienes con matching en cascada:
 *  Tier 1: denominacion ILIKE '%highlight%' (exacto) — radio amplio
 *  Tier 2: denominacion ILIKE '%palabra1%palabra2%' (palabras clave) — radio amplio
 *  Tier 3: para "Tipo de X", buscar "tipo%X" — radio más estricto
 *  Tier 4: para nombres simples (Alhambra, Chambord), token suelto — radio <50km
 */
async function findBien(highlight, route) {
    // Check manual overrides first
    if (highlight in OVERRIDES) {
        const overrideId = OVERRIDES[highlight];
        if (overrideId === null) return null; // Explicitly no match
        const result = await pool.query(
            'SELECT id, denominacion, localidad, municipio, latitud, longitud, tipo_monumento FROM bienes WHERE id = $1',
            [overrideId]
        );
        if (result.rows[0]) return { ...result.rows[0], dist_km: 0, searchVariant: 'override' };
    }

    const { lat, lng } = route.center;
    const country = route.countries[0];
    const paisDB = country === 'Francia' ? 'Francia' : country === 'Portugal' ? 'Portugal' : 'España';

    const strategies = buildSearchStrategies(highlight);

    for (const { pattern, maxKm, label } of strategies) {
        const result = await pool.query(`
            SELECT id, denominacion, localidad, municipio, latitud, longitud,
                   tipo_monumento,
                   (6371 * acos(
                       LEAST(1, cos(radians($2)) * cos(radians(latitud)) * cos(radians(longitud) - radians($3))
                       + sin(radians($2)) * sin(radians(latitud)))
                   )) AS dist_km
            FROM bienes
            WHERE denominacion ILIKE $1
              AND pais = $4
              AND latitud IS NOT NULL
            ORDER BY dist_km ASC
            LIMIT 5
        `, [pattern, lat, lng, paisDB]);

        if (result.rows.length > 0) {
            const best = result.rows[0];
            const effectiveMaxKm = route.radiusKm ? route.radiusKm * 2 : maxKm;
            if (best.dist_km <= effectiveMaxKm) {
                return { ...best, searchVariant: label };
            }
        }
    }

    return null;
}

function buildSearchStrategies(highlight) {
    const strategies = [];

    // Tier 1: exacto — radio 500km
    strategies.push({ pattern: `%${highlight}%`, maxKm: 500, label: 'exact' });

    // Normalizar acentos catalanes/franceses para búsqueda alternativa
    const normalized = highlight
        .replace(/ü/g, 'u').replace(/à/g, 'a').replace(/è/g, 'e')
        .replace(/ò/g, 'o').replace(/ï/g, 'i').replace(/ç/g, 'c')
        .replace(/'/g, "'");
    if (normalized !== highlight) {
        strategies.push({ pattern: `%${normalized}%`, maxKm: 500, label: 'normalized' });
    }

    // Sin artículos iniciales
    const sinArticulo = highlight.replace(/^(El |La |Los |Las |L'|Le |Les |O |Os |A |As |Da |Do |Dos |Das )/i, '');
    if (sinArticulo !== highlight) {
        strategies.push({ pattern: `%${sinArticulo}%`, maxKm: 300, label: 'sinArt' });
    }

    // Para "Tipo de X" (Catedral de Jaca, Castillo de Loarre...)
    // → buscar "tipo%X" (acepta denominaciones largas como "Catedral de San Pedro de Jaca")
    const tipoMatch = highlight.match(/^(Catedral|Iglesia|Monasterio|Castillo|Convento|Mosteiro|Alcazaba|Alcázar|Dolmen|Cueva|Basílica|Palacio|Lonja|Torres?|Murallas?|Hospital|Colegiata|Abadía|Abbaye)\s+(?:de\s+(?:la\s+|las\s+|los\s+|el\s+)?|d[aeo]\s+|d')?(.+)/i);
    if (tipoMatch) {
        const tipo = tipoMatch[1];
        const lugar = tipoMatch[2];
        // "catedral%Jaca" — denominación debe contener tipo Y lugar
        strategies.push({ pattern: `%${tipo}%${lugar}%`, maxKm: 300, label: `${tipo}%${lugar}` });
        // Solo el lugar en combinación con tipo_monumento, pero via ILIKE
        strategies.push({ pattern: `%${lugar}%`, maxKm: 50, label: `lugar:${lugar}` });
    }

    // Para nombres simples de 1 palabra (Alhambra, Chambord, Carcassonne)
    // → buscar con radio muy estricto
    const palabras = highlight.split(/[\s\-–,]+/).filter(t =>
        t.length > 3 && !['de', 'del', 'des', 'las', 'los', 'the', 'les', 'das', 'dos', 'une', 'sant', 'san', 'santa'].includes(t.toLowerCase())
    );
    if (palabras.length === 1) {
        strategies.push({ pattern: `%${palabras[0]}%`, maxKm: 50, label: `token:${palabras[0]}` });
    }

    return strategies;
}

// ============== MAIN ==============

async function main() {
    console.log(`=== Migración Curated → Culturales ${DRY_RUN ? '[DRY-RUN]' : '[APPLY]'} ===`);
    console.log(`Base de datos: ${DB_LABEL}`);
    if (SOLO) console.log(`Solo ruta: ${SOLO}`);
    console.log('');

    const routes = SOLO ? CURATED_ROUTES.filter(r => r.id === SOLO) : CURATED_ROUTES;

    let totalHighlights = 0;
    let totalMatched = 0;
    let totalUnmatched = 0;
    const unmatchedList = [];

    for (const route of routes) {
        console.log(`\n--- ${route.name} (${route.id}) ---`);
        console.log(`  Highlights: ${route.highlights.length}`);

        const paradas = [];

        for (let i = 0; i < route.highlights.length; i++) {
            const hl = route.highlights[i];
            totalHighlights++;

            const bien = await findBien(hl, route);

            if (bien) {
                totalMatched++;
                console.log(`  ✓ [${i + 1}] "${hl}" → [${bien.id}] "${bien.denominacion}" (${bien.dist_km?.toFixed(1)}km)`);
                paradas.push({
                    orden: i + 1,
                    nombre: hl,
                    bien_id: bien.id,
                    localidad: bien.localidad,
                    municipio: bien.municipio,
                    latitud: bien.latitud,
                    longitud: bien.longitud,
                });
            } else {
                totalUnmatched++;
                console.log(`  ✗ [${i + 1}] "${hl}" — NO MATCH`);
                unmatchedList.push({ route: route.id, highlight: hl });
                paradas.push({
                    orden: i + 1,
                    nombre: hl,
                    bien_id: null,
                    localidad: null,
                    municipio: null,
                    latitud: null,
                    longitud: null,
                });
            }
        }

        if (!DRY_RUN && paradas.length > 0) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // UPSERT ruta cultural
                const rutaRes = await client.query(`
                    INSERT INTO rutas_culturales (slug, nombre, descripcion, region, pais, tema, centro_lat, centro_lng, zoom, num_paradas, activa)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
                    ON CONFLICT (slug) DO UPDATE SET
                        nombre = EXCLUDED.nombre, tema = EXCLUDED.tema,
                        centro_lat = EXCLUDED.centro_lat, centro_lng = EXCLUDED.centro_lng,
                        zoom = EXCLUDED.zoom, num_paradas = EXCLUDED.num_paradas,
                        updated_at = NOW()
                    RETURNING id
                `, [
                    route.id, route.name, null,
                    null, route.countries[0], route.theme,
                    route.center.lat, route.center.lng, route.zoom,
                    paradas.length,
                ]);
                const rutaId = rutaRes.rows[0].id;

                // Borrar paradas existentes (idempotente)
                await client.query('DELETE FROM rutas_culturales_paradas WHERE ruta_id = $1', [rutaId]);

                // Insertar paradas
                for (const p of paradas) {
                    await client.query(`
                        INSERT INTO rutas_culturales_paradas (ruta_id, bien_id, orden, nombre, localidad, municipio, latitud, longitud)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `, [rutaId, p.bien_id, p.orden, p.nombre, p.localidad, p.municipio, p.latitud, p.longitud]);
                }

                await client.query('COMMIT');
                console.log(`  → Ruta creada (id=${rutaId}) con ${paradas.length} paradas`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`  ERROR en ${route.id}:`, err.message);
            } finally {
                client.release();
            }
        }
    }

    // Resumen
    console.log(`\n========== RESUMEN ==========`);
    console.log(`  Rutas procesadas:  ${routes.length}`);
    console.log(`  Highlights total:  ${totalHighlights}`);
    console.log(`  Matched:           ${totalMatched}  (${(totalMatched / totalHighlights * 100).toFixed(1)}%)`);
    console.log(`  Unmatched:         ${totalUnmatched}`);

    if (unmatchedList.length > 0) {
        console.log(`\n--- Highlights sin match (${unmatchedList.length}) ---`);
        for (const u of unmatchedList) {
            console.log(`  ${u.route}: "${u.highlight}"`);
        }
    }

    if (DRY_RUN) {
        console.log(`\n[DRY-RUN] No se ha modificado nada. Usa --apply para aplicar.`);
    }

    await pool.end();
}

main().catch(err => {
    console.error('Error fatal:', err);
    pool.end();
    process.exit(1);
});
