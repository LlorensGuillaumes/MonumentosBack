const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function scrapeSIPCA(startUrl, maxPages = 40000) {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    await context.setExtraHTTPHeaders({
        'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
        'referer': 'https://www.sipca.es/'
    });

    await context.addCookies([
        // {
        //     name: '_session_id',
        //     value: 'R0ZQazZWTkRXVWY0aG1wVDJTQk45Ymd5TTZoVkRmZ0t2ci9GekhrZHk4N3gydVBHcFNwZm5tajZTK3lackJiTjBKRHFVNExFbk0wMzloSEkzTW5Xbmc9PS0tRGx0SjFtOUJJVmsrbWZQKzJHR2lKQT09--b5469369ff82e27718a27f5446ae985fd104b6b9',
        //     domain: 'www.sipca.es',
        //     path: '/',
        //     httpOnly: true,
        //     secure: true
        // },
        {
            name: 'JSESSIONID',
            value: '1189514C95CDBBCFA9FDB9C9E0305C2F',
            domain: 'www.sipca.es',
            path: '/',
            httpOnly: true,
            secure: true
        },
        {
            name: 'cookie-assistant-visited',
            value: 'true',
            domain: 'www.sipca.es',
            path: '/'
        }
    ]);

    const page = await context.newPage();

    let currentUrl = startUrl;
    let pagesProcessed = 1205;

    // Crear carpeta "data" si no existe
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }

    try {
        while (currentUrl && pagesProcessed < maxPages) {
            console.log(`📄 Procesando ficha ${pagesProcessed + 1}: ${currentUrl}`);

            await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 60000 });
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(3000);

            try {
                await page.waitForSelector('#siguiente', { timeout: 5000 });
                console.log('➡️ Botón siguiente encontrado');
            } catch (e) {
                console.warn('⚠️ Botón "siguiente" no encontrado (puede que sea la última ficha).');
            }

            const html = await page.content();
            fs.writeFileSync('pagina.html', html);

            const { pageData, urlPattern } = await extractPageData(page);

            // Guardar JSON individual
            const fileName = `sipca_${pagesProcessed + 1}.json`;
            const filePath = path.join(dataDir, fileName);
            fs.writeFileSync(filePath, JSON.stringify(pageData, null, 2));
            console.log(`✅ Guardado: ${fileName}`);

            pagesProcessed++;
            currentUrl = await getNextPageUrl(page, currentUrl, urlPattern);
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await browser.close();
    }

    console.log(`\n📦 Total fichas procesadas: ${pagesProcessed}`);
}

async function extractPageData(page) {
    return await page.evaluate(() => {
        const getText = (selector) => {
            const el = document.querySelector(selector);
            return el ? el.textContent.trim() : null;
        };

        const urlParts = window.location.pathname.split('/');
        const idBien = urlParts[2];
        const nombreFicha = urlParts[3] || '';

        const urlPattern = {
            base: `${window.location.origin}/censo`,
            id: idBien,
            nombre: nombreFicha.includes('.html') ? nombreFicha : `${nombreFicha}.html`
        };

        const pageData = {
            metadata: {
                id: idBien,
                url: window.location.href,
                nombre: nombreFicha.replace('.html', ''),
                timestamp: new Date().toISOString()
            },
            content: {
                title: getText('h1'),
                subtitle: getText('.contenedor-datos-cabecera h2'),
                location: getText('.contenedor-datos-cabecera h4'),
                images: Array.from(document.querySelectorAll('.jcarousel ul li a.fancybox')).map(el => ({
                    url: el.href,
                    thumbnail: el.querySelector('img')?.src,
                    title: el.title
                }))
            }
        };

        return { pageData, urlPattern };
    });
}

async function getNextPageUrl(page, currentUrl, urlPattern) {
    const nextBtn = await page.$('#siguiente');
    if (nextBtn) {
        const onclick = await nextBtn.getAttribute('onclick');
        console.log('🔗 onclick:', onclick);

        const match = onclick?.match(/mostrarBienSig\('(.+?)'\)/);
        if (match) {
            const fichaPath = match[1].replace(/ /g, '%20');
            return `${urlPattern.base}/${fichaPath}.html`;
        }
    }

    const idMatch = currentUrl.match(/(1-INM-[A-Z]+-\d+-\d+-)(\d+)/);
    if (idMatch) {
        const [_, prefix, ficha] = idMatch;
        const nextFichaNum = parseInt(ficha) - 1;

        if (nextFichaNum > 0) {
            const nextFicha = nextFichaNum.toString().padStart(ficha.length, '0');
            const newId = `${prefix}${nextFicha}`;

            if (urlPattern.nombre) {
                const nombreBase = urlPattern.nombre.split('/')[0].replace('.html', '');
                return `${urlPattern.base}/${newId}/${nombreBase}_${nextFicha}.html`;
            } else {
                return `${urlPattern.base}/${newId}`;
            }
        }
    }

    return null;
}

// Ejecutar
(async () => {
    await scrapeSIPCA('https://www.sipca.es/censo/1-INM-HUE-006-021-027/Iglesia%20de%20la%20Asunción.html', 40000);
})();
