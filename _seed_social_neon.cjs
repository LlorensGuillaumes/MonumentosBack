// Temporal: crear tabla social_accounts en Neon y poblarla
require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(20, parseInt);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

const ACCOUNTS = [
    // ALWAYS
    {u:'europanostraeu',d:'Europa Nostra',s:'always',p:null,r:null,t:'patrimonio',f:10000},
    {u:'unescoworldheritage',d:'UNESCO World Heritage',s:'always',p:null,r:null,t:'patrimonio',f:46000},
    {u:'europeanheritagedays',d:'European Heritage Days',s:'always',p:null,r:null,t:'patrimonio',f:9660},
    {u:'visiteuworldheritage',d:'World Heritage Journeys EU',s:'always',p:null,r:null,t:'patrimonio',f:5000},
    {u:'european_heritage',d:'European Heritage',s:'always',p:null,r:null,t:'patrimonio',f:5000},
    {u:'culturetourist',d:'Culture Tourist',s:'always',p:null,r:null,t:'turismo_cultural',f:5000},
    {u:'culturetrip',d:'Culture Trip',s:'always',p:null,r:null,t:'turismo_cultural',f:614000},
    // COUNTRY ESPAÑA
    {u:'spain',d:'Spain (Turespaña)',s:'country',p:'España',r:null,t:'turismo',f:1000000},
    {u:'hispanianostra_',d:'Hispania Nostra',s:'country',p:'España',r:null,t:'patrimonio',f:19000},
    {u:'patrimnacional',d:'Patrimonio Nacional',s:'country',p:'España',r:null,t:'patrimonio',f:235000},
    {u:'redpatrimoniohistorico',d:'Red Patrimonio Histórico',s:'country',p:'España',r:null,t:'patrimonio',f:15000},
    {u:'lospueblosmbe',d:'Pueblos Más Bonitos España',s:'country',p:'España',r:null,t:'pueblos',f:217000},
    {u:'castlesofspain',d:'Castillos de España',s:'country',p:'España',r:null,t:'castillos',f:65000},
    {u:'sitiosdeespana',d:'Sitios de España',s:'country',p:'España',r:null,t:'turismo',f:10000},
    // COUNTRY FRANCIA
    {u:'explorefrance',d:'Explore France',s:'country',p:'Francia',r:null,t:'turismo',f:307000},
    // COUNTRY PORTUGAL
    {u:'visitportugal',d:'Visit Portugal',s:'country',p:'Portugal',r:null,t:'turismo',f:638000},
    // THEME
    {u:'romanicoespana',d:'Románico en España',s:'theme',p:'España',r:null,t:'romanico',f:5000},
    {u:'artesacroorg',d:'Arte Sacro',s:'theme',p:null,r:null,t:'religioso',f:5000},
    {u:'redcastillosypalacios',d:'Red Castillos y Palacios',s:'theme',p:'España',r:null,t:'castillos',f:3287},
    {u:'casashistoricasespana',d:'Casas Históricas España',s:'theme',p:'España',r:null,t:'patrimonio',f:5000},
    {u:'academiaplay',d:'Academia Play',s:'theme',p:null,r:null,t:'divulgacion',f:126000},
    {u:'culturizando',d:'Culturizando',s:'theme',p:null,r:null,t:'divulgacion',f:1000000},
    {u:'elcodigoromanico',d:'El Código Románico',s:'theme',p:'España',r:null,t:'romanico',f:5000},
    // THEME MONUMENTOS
    {u:'alhambra_oficial',d:'Alhambra de Granada',s:'theme',p:'España',r:'Andalucia',t:'monumento',f:126000},
    {u:'basilicasagradafamilia',d:'Basílica Sagrada Família',s:'theme',p:'España',r:'Catalunya',t:'monumento',f:428000},
    {u:'parcocolosseo',d:'Parco Colosseo',s:'theme',p:'Italia',r:null,t:'monumento',f:74000},
    {u:'chateauversailles',d:'Château de Versailles',s:'theme',p:'Francia',r:null,t:'monumento',f:1000000},
    {u:'museelouvre',d:'Musée du Louvre',s:'theme',p:'Francia',r:null,t:'monumento',f:5000000},
    {u:'uffizigalleries',d:'Gallerie degli Uffizi',s:'theme',p:'Italia',r:null,t:'monumento',f:842000},
    {u:'parquesdesintra',d:'Parques de Sintra',s:'theme',p:'Portugal',r:null,t:'monumento',f:50000},
    // REGION ESPAÑA
    {u:'visita_madrid',d:'Visit Madrid',s:'region',p:'España',r:'Comunidad de Madrid',t:'turismo',f:460000},
    {u:'viveandalucia',d:'Vive Andalucía',s:'region',p:'España',r:'Andalucia',t:'turismo',f:158000},
    {u:'catalunyaexperience',d:'Catalunya Experience',s:'region',p:'España',r:'Catalunya',t:'turismo',f:523000},
    {u:'visitbarcelona',d:'Visit Barcelona',s:'region',p:'España',r:'Catalunya',t:'turismo',f:579000},
    {u:'cylesvida',d:'Castilla y León es Vida',s:'region',p:'España',r:'Castilla y Leon',t:'turismo',f:63000},
    {u:'leonturismo',d:'Turismo de León',s:'region',p:'España',r:'Castilla y Leon',t:'turismo',f:7652},
    {u:'visiteuskadi',d:'Visit Euskadi',s:'region',p:'España',r:'Pais Vasco',t:'turismo',f:115000},
    {u:'turismoaragon',d:'Turismo de Aragón',s:'region',p:'España',r:'Aragon',t:'turismo',f:72000},
    {u:'turismodegalicia',d:'Turismo de Galicia',s:'region',p:'España',r:'Galicia',t:'turismo',f:185000},
    {u:'comunitat_valenciana',d:'Comunitat Valenciana',s:'region',p:'España',r:'Comunitat Valenciana',t:'turismo',f:190000},
];

async function main() {
    console.log('Creando tabla social_accounts en Neon...');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS social_accounts (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            platform VARCHAR(20) NOT NULL DEFAULT 'instagram',
            display_name VARCHAR(200),
            scope VARCHAR(20) NOT NULL DEFAULT 'always',
            pais VARCHAR(50),
            region VARCHAR(100),
            theme VARCHAR(50),
            followers_approx INTEGER,
            url TEXT,
            notas TEXT,
            activa BOOLEAN NOT NULL DEFAULT TRUE,
            use_count INTEGER NOT NULL DEFAULT 0,
            last_used TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(platform, username)
        )
    `);

    console.log('Tabla creada. Insertando cuentas...');

    let inserted = 0;
    for (const a of ACCOUNTS) {
        await pool.query(`
            INSERT INTO social_accounts (username, platform, display_name, scope, pais, region, theme, followers_approx)
            VALUES ($1, 'instagram', $2, $3, $4, $5, $6, $7)
            ON CONFLICT (platform, username) DO UPDATE SET
                display_name=EXCLUDED.display_name, scope=EXCLUDED.scope, pais=EXCLUDED.pais,
                region=EXCLUDED.region, theme=EXCLUDED.theme, followers_approx=EXCLUDED.followers_approx
        `, [a.u, a.d, a.s, a.p, a.r, a.t, a.f]);
        inserted++;
        process.stdout.write('.');
    }

    console.log(`\n${inserted} cuentas insertadas.`);

    const { rows } = await pool.query('SELECT scope, COUNT(*) as total FROM social_accounts WHERE activa=TRUE GROUP BY scope ORDER BY scope');
    console.log('\nCuentas por scope:');
    rows.forEach(r => console.log(`  ${r.scope}: ${r.total}`));

    await pool.end();
    console.log('\nHecho. Puedes borrar este script.');
}

main().catch(err => { console.error(err); pool.end(); process.exit(1); });
