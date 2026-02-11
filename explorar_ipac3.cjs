/**
 * Explora l'IPAC capturant totes les peticions de xarxa
 */
const { chromium } = require('playwright');

async function explorar() {
    console.log('Explorant IPAC (v3) - capturant tot el tràfic...\n');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Capturar TOTES les peticions
    page.on('request', request => {
        const url = request.url();
        if (!url.includes('.js') && !url.includes('.css') && !url.includes('.png') &&
            !url.includes('.jpg') && !url.includes('.woff') && !url.includes('piwik')) {
            console.log(`>> ${request.method()} ${url}`);
            if (request.postData()) {
                console.log(`   POST data: ${request.postData().substring(0, 300)}`);
            }
        }
    });

    page.on('response', async response => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json') && !url.includes('piwik')) {
            console.log(`<< ${response.status()} ${url}`);
            try {
                const json = await response.json();
                console.log(`   Response: ${JSON.stringify(json).substring(0, 300)}`);
            } catch(e) {}
        }
    });

    try {
        // Anar directament a la pàgina de cerca amb un paràmetre
        console.log('Accedint a cerca avançada...');
        await page.goto('https://invarquit.cultura.gencat.cat/Cerca', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForTimeout(3000);

        // Tancar popup de cookies si existeix
        const cookieBtn = await page.$('[id*="accept"], button:has-text("Accepta"), button:has-text("Tanca")');
        if (cookieBtn) {
            await cookieBtn.click({ force: true });
            await page.waitForTimeout(1000);
        }

        // Buscar el formulari de cerca i interactuar
        console.log('\nBuscant formulari...');

        // Intentar diferents selectors
        const selectors = [
            'input[formcontrolname]',
            'input[placeholder*="nom"]',
            'input[placeholder*="cerca"]',
            'select',
            'button'
        ];

        for (const sel of selectors) {
            const elements = await page.$$(sel);
            console.log(`  ${sel}: ${elements.length} elements`);
        }

        // Obtenir tot el HTML per analitzar
        const html = await page.content();

        // Buscar mencions a API
        const apiMatches = html.match(/api\/[a-zA-Z\/]+/g);
        if (apiMatches) {
            console.log('\nEndpoints API trobats al codi:');
            [...new Set(apiMatches)].forEach(m => console.log(`  ${m}`));
        }

        // Esperar i veure
        console.log('\nEsperant interacció manual (10 segons)...');
        await page.waitForTimeout(10000);

    } catch (err) {
        console.error('Error:', err.message);
    }

    await browser.close();
}

explorar();
