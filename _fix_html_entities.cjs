/**
 * _fix_html_entities.cjs
 * Neteja entitats HTML a les descripcions de la taula wikidata
 * Exemples: &#147; → ", &amp;ordm; → º, &amp;ldquo; → "
 */

const db = require('./db.cjs');

// Mapa d'entitats HTML comunes
const ENTITY_MAP = {
    '&quot;': '"',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
    '&ordm;': 'º',
    '&ordf;': 'ª',
    '&ntilde;': 'ñ',
    '&Ntilde;': 'Ñ',
    '&aacute;': 'á',
    '&eacute;': 'é',
    '&iacute;': 'í',
    '&oacute;': 'ó',
    '&uacute;': 'ú',
    '&Aacute;': 'Á',
    '&Eacute;': 'É',
    '&Iacute;': 'Í',
    '&Oacute;': 'Ó',
    '&Uacute;': 'Ú',
    '&uuml;': 'ü',
    '&Uuml;': 'Ü',
    '&iquest;': '¿',
    '&iexcl;': '¡',
    '&laquo;': '«',
    '&raquo;': '»',
    '&ldquo;': '\u201C',
    '&rdquo;': '\u201D',
    '&lsquo;': '\u2018',
    '&rsquo;': '\u2019',
    '&mdash;': '\u2014',
    '&ndash;': '\u2013',
    '&hellip;': '\u2026',
    '&deg;': '°',
    '&ccedil;': 'ç',
    '&Ccedil;': 'Ç',
    '&agrave;': 'à',
    '&egrave;': 'è',
    '&igrave;': 'ì',
    '&ograve;': 'ò',
    '&ugrave;': 'ù',
};

function decodeHtmlEntities(text) {
    if (!text) return text;

    let result = text;

    // Pas 1: descodificar doble-encoding (&amp;ordm; → &ordm;)
    // Repetir fins que no hi hagi canvis (pot haver-hi triple encoding)
    let prev;
    do {
        prev = result;
        result = result.replace(/&amp;/g, '&');
    } while (result !== prev);

    // Pas 2: entitats amb nom
    for (const [entity, char] of Object.entries(ENTITY_MAP)) {
        result = result.replaceAll(entity, char);
    }

    // Pas 3: entitats numèriques decimals (&#147; &#148; etc.)
    result = result.replace(/&#(\d+);/g, (_, code) => {
        const n = parseInt(code);
        // Windows-1252 → Unicode mapping per codis 128-159
        const win1252 = {
            128: '\u20AC', 130: '\u201A', 131: '\u0192', 132: '\u201E',
            133: '\u2026', 134: '\u2020', 135: '\u2021', 136: '\u02C6',
            137: '\u2030', 138: '\u0160', 139: '\u2039', 140: '\u0152',
            142: '\u017D', 145: '\u2018', 146: '\u2019', 147: '\u201C',
            148: '\u201D', 149: '\u2022', 150: '\u2013', 151: '\u2014',
            152: '\u02DC', 153: '\u2122', 154: '\u0161', 155: '\u203A',
            156: '\u0153', 158: '\u017E', 159: '\u0178',
        };
        if (win1252[n]) return win1252[n];
        return String.fromCharCode(n);
    });

    // Pas 4: entitats numèriques hexadecimals (&#x201C; etc.)
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });

    return result;
}

async function main() {
    console.log('=== Neteja d\'entitats HTML a descripcions ===\n');

    // Buscar descripcions amb entitats
    const rows = (await db.query(`
        SELECT bien_id, descripcion
        FROM wikidata
        WHERE descripcion IS NOT NULL
          AND (descripcion LIKE '%&%' OR descripcion LIKE '%&#%')
    `)).rows;

    console.log(`Files amb possibles entitats: ${rows.length}`);

    let changed = 0;
    const examples = [];

    await db.transaction(async (client) => {
        for (const row of rows) {
            const cleaned = decodeHtmlEntities(row.descripcion);
            if (cleaned !== row.descripcion) {
                await client.query('UPDATE wikidata SET descripcion = $1 WHERE bien_id = $2', [cleaned, row.bien_id]);
                changed++;
                if (examples.length < 5) {
                    // Trobar la primera diferència per mostrar context
                    const original = row.descripcion.substring(0, 120);
                    const fixed = cleaned.substring(0, 120);
                    examples.push({ bien_id: row.bien_id, original, fixed });
                }
            }
        }
    });

    console.log(`\nDescripcions actualitzades: ${changed}`);
    console.log(`Sense canvis: ${rows.length - changed}`);

    if (examples.length > 0) {
        console.log('\nExemples de canvis:');
        for (const ex of examples) {
            console.log(`\n  bien_id ${ex.bien_id}:`);
            console.log(`    Abans: ${ex.original}...`);
            console.log(`    Ara:   ${ex.fixed}...`);
        }
    }

    // Verificar que no queden entitats
    const remaining = (await db.query(`
        SELECT COUNT(*) as n
        FROM wikidata
        WHERE descripcion IS NOT NULL
          AND (descripcion LIKE '%&#%' OR descripcion LIKE '%&amp;%')
    `)).rows[0].n;

    console.log(`\nEntitats restants: ${remaining}`);

    await db.cerrar();
}

main();
