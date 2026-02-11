/**
 * Explora l'estructura de l'IPAC per descobrir l'API
 */
const { chromium } = require('playwright');

async function explorar() {
    console.log('Explorant IPAC...\n');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Capturar peticions de xarxa
    const apiRequests = [];
    page.on('request', request => {
        const url = request.url();
        if (url.includes('api') || url.includes('cerca') || url.includes('search')) {
            apiRequests.push({
                url: url,
                method: request.method(),
                postData: request.postData()
            });
        }
    });

    page.on('response', async response => {
        const url = response.url();
        if (url.includes('api') || url.includes('Cerca') || url.includes('elements')) {
            console.log(`Response: ${response.status()} ${url}`);
            try {
                const text = await response.text();
                if (text.length < 2000) {
                    console.log(`  Body: ${text.substring(0, 500)}`);
                } else {
                    console.log(`  Body length: ${text.length} chars`);
                    // Try to parse as JSON
                    try {
                        const json = JSON.parse(text);
                        console.log(`  JSON keys: ${Object.keys(json).join(', ')}`);
                        if (json.totalElements) console.log(`  Total elements: ${json.totalElements}`);
                        if (json.content && Array.isArray(json.content)) {
                            console.log(`  Content array length: ${json.content.length}`);
                            if (json.content[0]) {
                                console.log(`  First item keys: ${Object.keys(json.content[0]).join(', ')}`);
                            }
                        }
                    } catch(e) {}
                }
            } catch(e) {}
        }
    });

    try {
        // Anar a la pàgina principal
        console.log('1. Carregant pàgina principal...');
        await page.goto('https://invarquit.cultura.gencat.cat/', {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        // Esperar que carregui l'app Angular
        await page.waitForTimeout(3000);

        // Buscar el botó o enllaç de cerca
        console.log('\n2. Buscant funcionalitat de cerca...');

        // Intentar clicar a "Cerca" o similar
        const cercaLink = await page.$('a[href*="Cerca"], button:has-text("Cerca"), a:has-text("Cerca")');
        if (cercaLink) {
            console.log('   Trobat enllaç de cerca, clicant...');
            await cercaLink.click();
            await page.waitForTimeout(3000);
        }

        // Fer una cerca simple
        console.log('\n3. Provant cerca simple...');
        const searchInput = await page.$('input[type="text"], input[type="search"]');
        if (searchInput) {
            await searchInput.fill('església');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(5000);
        }

        console.log('\n=== Peticions API capturades ===');
        apiRequests.forEach(req => {
            console.log(`${req.method} ${req.url}`);
            if (req.postData) console.log(`  POST: ${req.postData.substring(0, 200)}`);
        });

        // Capturar URL actual
        console.log('\nURL actual:', page.url());

    } catch (err) {
        console.error('Error:', err.message);
    }

    await browser.close();
}

explorar();
