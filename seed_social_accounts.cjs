/**
 * Crea la tabla social_accounts y la puebla con cuentas de Instagram verificadas.
 * Ejecutar: node seed_social_accounts.cjs
 *
 * La tabla almacena cuentas de Instagram relevantes para mencionar en publicaciones
 * de monumentos. El campo `scope` indica cuándo mencionar la cuenta:
 *   - 'always': se puede mencionar en cualquier post (rotando)
 *   - 'country': solo cuando el monumento sea del país indicado
 *   - 'theme': solo cuando el monumento encaje con la temática
 *   - 'region': solo cuando el monumento sea de la región indicada
 *
 * El campo `last_used` + `use_count` permiten el algoritmo de rotación
 * para evitar mencionar siempre las mismas cuentas.
 */

require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(20, parseInt);

// Docker maps postgres to port 5433 externally
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: 5433,
    user: process.env.PGUSER || 'patrimonio',
    password: process.env.PGPASSWORD || 'patrimonio2026',
    database: process.env.PGDATABASE || 'patrimonio',
});

const ACCOUNTS = [
    // ============== SCOPE: ALWAYS (patrimonio europeo general) ==============
    {
        username: 'europanostraeu',
        platform: 'instagram',
        display_name: 'Europa Nostra',
        scope: 'always',
        pais: null,
        region: null,
        theme: 'patrimonio',
        followers_approx: 10000,
        url: 'https://www.instagram.com/europanostraeu/',
        notas: 'ONG europea de patrimonio cultural. Verificada.',
    },
    {
        username: 'unescoworldheritage',
        platform: 'instagram',
        display_name: 'UNESCO World Heritage',
        scope: 'always',
        pais: null,
        region: null,
        theme: 'patrimonio',
        followers_approx: 46000,
        url: 'https://www.instagram.com/unescoworldheritage/',
        notas: 'Cuenta oficial UNESCO patrimonio mundial. 1223 sitios.',
    },
    {
        username: 'europeanheritagedays',
        platform: 'instagram',
        display_name: 'European Heritage Days',
        scope: 'always',
        pais: null,
        region: null,
        theme: 'patrimonio',
        followers_approx: 9660,
        url: 'https://www.instagram.com/europeanheritagedays/',
        notas: 'Jornadas Europeas del Patrimonio. Eventos culturales participativos.',
    },
    {
        username: 'visiteuworldheritage',
        platform: 'instagram',
        display_name: 'World Heritage Journeys EU',
        scope: 'always',
        pais: null,
        region: null,
        theme: 'patrimonio',
        followers_approx: 5000,
        url: 'https://www.instagram.com/visiteuworldheritage/',
        notas: 'Viajes patrimonio mundial UE.',
    },
    {
        username: 'european_heritage',
        platform: 'instagram',
        display_name: 'European Heritage',
        scope: 'always',
        pais: null,
        region: null,
        theme: 'patrimonio',
        followers_approx: 5000,
        url: 'https://www.instagram.com/european_heritage/',
        notas: 'Patrimonio europeo general.',
    },
    {
        username: 'culturetourist',
        platform: 'instagram',
        display_name: 'Culture Tourist',
        scope: 'always',
        pais: null,
        region: null,
        theme: 'turismo_cultural',
        followers_approx: 5000,
        url: 'https://www.instagram.com/culturetourist/',
        notas: 'Historiadora del arte, turismo cultural Europa. Basada en Amsterdam.',
    },
    {
        username: 'culturetrip',
        platform: 'instagram',
        display_name: 'Culture Trip',
        scope: 'always',
        pais: null,
        region: null,
        theme: 'turismo_cultural',
        followers_approx: 614000,
        url: 'https://www.instagram.com/culturetrip/',
        notas: 'Guías de aventura cultural y viajes en grupo. Muy grande.',
    },

    // ============== SCOPE: COUNTRY - ESPAÑA ==============
    {
        username: 'spain',
        platform: 'instagram',
        display_name: 'Spain (Turespaña)',
        scope: 'country',
        pais: 'España',
        region: null,
        theme: 'turismo',
        followers_approx: 1000000,
        url: 'https://www.instagram.com/spain/',
        notas: 'Cuenta oficial turismo España (Turespaña). Muy grande.',
    },
    {
        username: 'hispanianostra_',
        platform: 'instagram',
        display_name: 'Hispania Nostra',
        scope: 'country',
        pais: 'España',
        region: null,
        theme: 'patrimonio',
        followers_approx: 19000,
        url: 'https://www.instagram.com/hispanianostra_/',
        notas: 'Asociación defensa patrimonio cultural y natural España. 2499 posts.',
    },
    {
        username: 'patrimnacional',
        platform: 'instagram',
        display_name: 'Patrimonio Nacional',
        scope: 'country',
        pais: 'España',
        region: null,
        theme: 'patrimonio',
        followers_approx: 235000,
        url: 'https://www.instagram.com/patrimnacional/',
        notas: 'Patrimonio Nacional: palacios reales y sitios históricos de España.',
    },
    {
        username: 'redpatrimoniohistorico',
        platform: 'instagram',
        display_name: 'Red Patrimonio Histórico',
        scope: 'country',
        pais: 'España',
        region: null,
        theme: 'patrimonio',
        followers_approx: 15000,
        url: 'https://www.instagram.com/redpatrimoniohistorico/',
        notas: 'Red de Patrimonio Histórico de España. Turismo cultural y experiencial.',
    },
    {
        username: 'lospueblosmbe',
        platform: 'instagram',
        display_name: 'Pueblos Más Bonitos de España',
        scope: 'country',
        pais: 'España',
        region: null,
        theme: 'pueblos',
        followers_approx: 217000,
        url: 'https://www.instagram.com/lospueblosmbe/',
        notas: 'Asociación oficial. 11K posts. Muy activa.',
    },
    {
        username: 'castlesofspain',
        platform: 'instagram',
        display_name: 'Castillos de España',
        scope: 'country',
        pais: 'España',
        region: null,
        theme: 'castillos',
        followers_approx: 65000,
        url: 'https://www.instagram.com/castlesofspain/',
        notas: 'Castillos y fortalezas de España. Valor histórico y patrimonial.',
    },
    {
        username: 'sitiosdeespana',
        platform: 'instagram',
        display_name: 'Sitios de España',
        scope: 'country',
        pais: 'España',
        region: null,
        theme: 'turismo',
        followers_approx: 10000,
        url: 'https://www.instagram.com/sitiosdeespana/',
        notas: 'Lugares y sitios de interés de España.',
    },

    // ============== SCOPE: COUNTRY - FRANCIA ==============
    {
        username: 'explorefrance',
        platform: 'instagram',
        display_name: 'Explore France',
        scope: 'country',
        pais: 'Francia',
        region: null,
        theme: 'turismo',
        followers_approx: 307000,
        url: 'https://www.instagram.com/explorefrance/',
        notas: 'Cuenta oficial turismo Francia (Office du Tourisme).',
    },

    // ============== SCOPE: COUNTRY - ITALIA ==============
    // No se verificó una cuenta grande específica. Se pueden añadir más adelante.

    // ============== SCOPE: COUNTRY - PORTUGAL ==============
    {
        username: 'visitportugal',
        platform: 'instagram',
        display_name: 'Visit Portugal',
        scope: 'country',
        pais: 'Portugal',
        region: null,
        theme: 'turismo',
        followers_approx: 638000,
        url: 'https://www.instagram.com/visitportugal/',
        notas: 'Cuenta oficial turismo Portugal. 3052 posts.',
    },

    // ============== SCOPE: THEME (temáticas especializadas) ==============
    {
        username: 'romanicoespana',
        platform: 'instagram',
        display_name: 'Románico en España',
        scope: 'theme',
        pais: 'España',
        region: null,
        theme: 'romanico',
        followers_approx: 5000,
        url: 'https://www.instagram.com/romanicoespana/',
        notas: 'Arte y arquitectura románica en España.',
    },
    {
        username: 'artesacroorg',
        platform: 'instagram',
        display_name: 'Arte Sacro',
        scope: 'theme',
        pais: null,
        region: null,
        theme: 'religioso',
        followers_approx: 5000,
        url: 'https://www.instagram.com/artesacroorg/',
        notas: 'Arte sacro y religioso.',
    },
    {
        username: 'redcastillosypalacios',
        platform: 'instagram',
        display_name: 'Red Castillos y Palacios',
        scope: 'theme',
        pais: 'España',
        region: null,
        theme: 'castillos',
        followers_approx: 3287,
        url: 'https://www.instagram.com/redcastillosypalacios/',
        notas: 'Red de Patrimonio Histórico - Castillos y Palacios de España.',
    },
    {
        username: 'casashistoricasespana',
        platform: 'instagram',
        display_name: 'Casas Históricas de España',
        scope: 'theme',
        pais: 'España',
        region: null,
        theme: 'patrimonio',
        followers_approx: 5000,
        url: 'https://www.instagram.com/casashistoricasespana/',
        notas: 'Asociación defensa patrimonio histórico privado. Desde 1994.',
    },

    // ============== SCOPE: THEME - DIVULGACIÓN ==============
    {
        username: 'academiaplay',
        platform: 'instagram',
        display_name: 'Academia Play',
        scope: 'theme',
        pais: null,
        region: null,
        theme: 'divulgacion',
        followers_approx: 126000,
        url: 'https://www.instagram.com/academiaplay/',
        notas: 'Divulgación histórica. 1850 posts. Muy activa.',
    },
    {
        username: 'culturizando',
        platform: 'instagram',
        display_name: 'Culturizando',
        scope: 'theme',
        pais: null,
        region: null,
        theme: 'divulgacion',
        followers_approx: 1000000,
        url: 'https://www.instagram.com/culturizando/',
        notas: 'Curiosidades y cultura general. 1M seguidores. 34K posts.',
    },
    {
        username: 'elcodigoromanico',
        platform: 'instagram',
        display_name: 'El Código Románico',
        scope: 'theme',
        pais: 'España',
        region: null,
        theme: 'romanico',
        followers_approx: 5000,
        url: 'https://www.instagram.com/elcodigoromanico/',
        notas: 'José María Sadia. Divulgador de arte románico.',
    },

    // ============== SCOPE: REGION - MADRID ==============
    {
        username: 'visita_madrid',
        platform: 'instagram',
        display_name: 'Visit Madrid',
        scope: 'region',
        pais: 'España',
        region: 'Comunidad de Madrid',
        theme: 'turismo',
        followers_approx: 460000,
        url: 'https://www.instagram.com/visita_madrid/',
        notas: 'Oficina de turismo de Madrid oficial.',
    },
];

async function main() {
    console.log('Creando tabla social_accounts...');

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

    console.log('Tabla creada. Insertando cuentas verificadas...');

    let inserted = 0;
    let skipped = 0;

    for (const acc of ACCOUNTS) {
        try {
            await pool.query(`
                INSERT INTO social_accounts (username, platform, display_name, scope, pais, region, theme, followers_approx, url, notas)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (platform, username) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    scope = EXCLUDED.scope,
                    pais = EXCLUDED.pais,
                    region = EXCLUDED.region,
                    theme = EXCLUDED.theme,
                    followers_approx = EXCLUDED.followers_approx,
                    url = EXCLUDED.url,
                    notas = EXCLUDED.notas
            `, [acc.username, acc.platform, acc.display_name, acc.scope, acc.pais, acc.region, acc.theme, acc.followers_approx, acc.url, acc.notas]);
            inserted++;
            console.log(`  ✓ @${acc.username} (${acc.scope}${acc.pais ? ' / ' + acc.pais : ''})`);
        } catch (err) {
            console.error(`  ✗ @${acc.username}: ${err.message}`);
            skipped++;
        }
    }

    console.log(`\nResumen: ${inserted} insertadas, ${skipped} errores.`);

    // Mostrar tabla resumen
    const { rows } = await pool.query(`
        SELECT scope, COUNT(*) as total
        FROM social_accounts
        WHERE activa = TRUE
        GROUP BY scope
        ORDER BY scope
    `);
    console.log('\nCuentas por scope:');
    rows.forEach(r => console.log(`  ${r.scope}: ${r.total}`));

    await pool.end();
}

main().catch(err => {
    console.error('Error:', err);
    pool.end();
    process.exit(1);
});
