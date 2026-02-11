/**
 * Explora l'IPAC amb gestió del popup de cookies
 */
const { chromium } = require('playwright');

async function explorar() {
    console.log('Explorant IPAC (v2)...\n');

    const browser = await chromium.launch({ headless: false }); // Visible per debug
    const context = await browser.newContext();
    const page = await context.newPage();

    // Capturar totes les peticions API
    const apiCalls = [];
    page.on('response', async response => {
        const url = response.url();
        if (url.includes('/api/')) {
            const data = {
                url: url,
                status: response.status(),
                method: response.request().method()
            };
            try {
                const text = await response.text();
                if (text.length > 0) {
                    try {
                        data.json = JSON.parse(text);
                    } catch(e) {
                        data.text = text.substring(0, 200);
                    }
                }
            } catch(e) {}
            apiCalls.push(data);
            console.log(`API: ${data.method} ${url.replace('https://invarquit.cultura.gencat.cat', '')}`);
        }
    });

    try {
        await page.goto('https://invarquit.cultura.gencat.cat/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Acceptar cookies si apareix el popup
        await page.waitForTimeout(2000);
        try {
            const acceptBtn = await page.$('button:has-text("Acceptar"), button:has-text("Accept"), #ppms_cm_accept');
            if (acceptBtn) {
                console.log('Acceptant cookies...');
                await acceptBtn.click();
                await page.waitForTimeout(1000);
            }
        } catch(e) {}

        // Navegar a cerca
        console.log('\nNavegant a cerca...');
        await page.goto('https://invarquit.cultura.gencat.cat/Cerca', {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        await page.waitForTimeout(3000);

        // Buscar tots els elements
        console.log('\nFent cerca sense filtres (tots els elements)...');

        // Buscar botó de cercar
        const searchBtn = await page.$('button:has-text("Cercar"), button[type="submit"]');
        if (searchBtn) {
            await searchBtn.click();
            await page.waitForTimeout(5000);
        }

        console.log('\n=== Peticions API capturades ===');
        apiCalls.forEach(call => {
            console.log(`\n${call.method} ${call.url}`);
            if (call.json) {
                if (call.json.totalElements) {
                    console.log(`  Total elements: ${call.json.totalElements}`);
                }
                if (call.json.content) {
                    console.log(`  Content length: ${call.json.content.length}`);
                    if (call.json.content[0]) {
                        console.log(`  First item: ${JSON.stringify(call.json.content[0], null, 2).substring(0, 500)}`);
                    }
                }
                console.log(`  Keys: ${Object.keys(call.json).join(', ')}`);
            }
        });

    } catch (err) {
        console.error('Error:', err.message);
    }

    // Esperar un moment per veure
    await page.waitForTimeout(5000);
    await browser.close();
}

explorar();
