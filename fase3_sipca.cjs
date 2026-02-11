const { chromium } = require('playwright');
const db = require('./db.cjs');

const DELAY_MS = 4000; // Pausa entre paginas para no sobrecargar
const SIPCA_BASE = 'https://www.sipca.es';
const SIPCA_SEARCH = 'https://www.sipca.es/censo/busqueda_simple.html';

async function ejecutar() {
    console.log('=== FASE 3: Scraping SIPCA (Solo Aragon) ===\n');

    // SIPCA solo contiene datos de Aragon, filtrar por region
    const bienes = await db.obtenerSinSipcaPorRegion('Aragon');
    console.log(`Bienes de Aragon pendientes de scraping SIPCA: ${bienes.length}\n`);

    if (bienes.length === 0) {
        console.log('Nada que hacer.');
        await db.cerrar();
        return;
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();

    // Anti-deteccion
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    await context.setExtraHTTPHeaders({
        'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
        'referer': 'https://www.sipca.es/',
    });

    await context.addCookies([
        {
            name: 'cookie-assistant-visited',
            value: 'true',
            domain: 'www.sipca.es',
            path: '/',
        },
    ]);

    const page = await context.newPage();

    let procesados = 0;
    let errores = 0;

    for (let i = 0; i < bienes.length; i++) {
        const bien = bienes[i];
        const sipca_code = bien.sipca_code;

        console.log(`[${i + 1}/${bienes.length}] ${bien.denominacion}...`);

        try {
            let url = null;

            // Estrategia 1: Si tenemos codigo SIPCA directo de Wikidata
            if (sipca_code) {
                url = `${SIPCA_BASE}/censo/${sipca_code}/.html`;
            }

            // Estrategia 2: Buscar por nombre en SIPCA
            if (!url) {
                url = await buscarEnSipca(page, bien.denominacion, bien.municipio);
            }

            if (!url) {
                console.log('  -> No encontrado en SIPCA');
                // Insertar registro vacio para no reintentar
                await db.insertarSipca({
                    bien_id: bien.id,
                    sipca_id: null, descripcion_completa: null,
                    sintesis_historica: null, datacion: null,
                    periodo_historico: null, siglo: null,
                    ubicacion_detalle: null, fuentes: null,
                    bibliografia: null, meta_description: null, url: null,
                });
                continue;
            }

            // Navegar y extraer datos
            const datos = await scrapearFicha(page, url);

            if (datos) {
                await db.insertarSipca({
                    bien_id: bien.id,
                    sipca_id: datos.sipca_id || null,
                    descripcion_completa: datos.descripcion || null,
                    sintesis_historica: datos.sintesis_historica || null,
                    datacion: datos.datacion || null,
                    periodo_historico: datos.periodo_historico || null,
                    siglo: datos.siglo || null,
                    ubicacion_detalle: datos.ubicacion_detalle || null,
                    fuentes: datos.fuentes || null,
                    bibliografia: datos.bibliografia || null,
                    meta_description: datos.meta_description || null,
                    url: url,
                });

                // Guardar imagenes
                if (datos.imagenes && datos.imagenes.length > 0) {
                    const imgs = datos.imagenes.map(img => ({
                        bien_id: bien.id,
                        url: img.url,
                        titulo: img.titulo || null,
                        autor: img.autor || null,
                        fuente: 'sipca',
                    }));
                    await db.insertarImagenes(imgs);
                }

                procesados++;
                console.log(`  -> OK: ${datos.imagenes?.length || 0} imagenes`);
            }
        } catch (err) {
            errores++;
            console.error(`  -> Error: ${err.message}`);
        }

        await sleep(DELAY_MS);
    }

    await browser.close();

    const stats = await db.estadisticas();
    console.log(`\nFase 3 completada:`);
    console.log(`  - Procesados: ${procesados}`);
    console.log(`  - Errores: ${errores}`);
    console.log(`  - Total con SIPCA: ${stats.con_sipca}`);
    console.log(`  - Total imagenes: ${stats.imagenes}`);

    await db.cerrar();
}

async function buscarEnSipca(page, denominacion, municipio) {
    try {
        // Evitar busquedas con nombres demasiado genericos
        const genericos = ['castillo', 'iglesia', 'ermita', 'torre', 'puente', 'muralla', 'casa', 'palacio'];
        const denomLower = denominacion.toLowerCase().trim();
        if (genericos.includes(denomLower)) return null;

        await page.goto(SIPCA_SEARCH, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);

        await page.fill('#texto_busqueda', denominacion);

        // Enviar formulario via JavaScript
        await page.evaluate(() => accion_buscar());
        await page.waitForURL('**/resultados_busqueda_simple**', { timeout: 30000 });
        await page.waitForTimeout(2000);

        // Los resultados usan onclick con mostrarBien('/censo/...', 'page')
        const results = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('[onclick*="mostrarBien"]'));
            const byPath = new Map();
            for (const el of links) {
                const onclick = el.getAttribute('onclick');
                const match = onclick.match(/mostrarBien\('([^']+)'/);
                if (!match) continue;
                const path = match[1];
                if (!byPath.has(path)) {
                    byPath.set(path, { path, texts: [] });
                }
                const text = el.textContent.trim();
                if (text && text !== 'Bien de Interés Cultural' && text !== 'Bien Inventariado') {
                    byPath.get(path).texts.push(text);
                }
            }
            return Array.from(byPath.values()).map(r => ({
                path: r.path,
                text: r.texts.join(' '),
                // Extraer nombre de la URL: /censo/ID/Nombre/Del/Bien.html
                pathName: r.path.replace(/\.html$/, '').split('/').slice(3).join(' ').replace(/%20/g, ' '),
            }));
        });

        if (results.length === 0) return null;

        // Buscar el resultado mas relevante por texto o por nombre en URL
        const denomNorm = denominacion.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        let best = null;

        for (const r of results) {
            const textNorm = r.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
            const pathNorm = r.pathName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
            const combined = textNorm + ' ' + pathNorm;
            if (textNorm === denomNorm || pathNorm === denomNorm) {
                best = r;
                break;
            }
            if (combined.includes(denomNorm) || denomNorm.includes(pathNorm)) {
                if (!best) best = r;
            }
        }

        // Si no hay match exacto o parcial, usar primer resultado solo si hay muy pocos
        if (!best && results.length === 1) {
            best = results[0];
        }

        if (best) {
            return `${SIPCA_BASE}${best.path}`;
        }

        return null;
    } catch {
        return null;
    }
}

async function scrapearFicha(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    return await page.evaluate(() => {
        const getText = (selector) => {
            const el = document.querySelector(selector);
            return el ? el.textContent.trim() : null;
        };

        const getTexts = (selector) => {
            return Array.from(document.querySelectorAll(selector))
                .map(el => el.textContent.trim())
                .filter(t => t.length > 0);
        };

        // ID del bien desde la URL o el formulario
        const idInput = document.querySelector('input[name="idBienActual"]');
        const sipca_id = idInput ? idInput.value : null;

        // Titulo: h2 strong dentro de .section-title
        const titulo = document.querySelector('.section-title h2 strong, .section-title.center h2 strong');
        const denominacion = titulo ? titulo.textContent.trim() : null;

        // Ubicacion: h4 con text-transform none (formato "Huesca - Comarca - Municipio - Localidad")
        const h4s = Array.from(document.querySelectorAll('h4'));
        let ubicacion_detalle = null;
        for (const h4 of h4s) {
            if (h4.style.textTransform === 'none') {
                ubicacion_detalle = h4.textContent.trim().replace(/\s+/g, ' ');
                break;
            }
        }
        // Si no lo encontramos por estilo, buscar cerca del titulo
        if (!ubicacion_detalle) {
            const h4near = document.querySelector('.section-title h4, .section-title.center h4');
            if (h4near) ubicacion_detalle = h4near.textContent.trim().replace(/\s+/g, ' ');
        }

        // Descripcion: contenido del tab de identificacion
        let descripcion = null;
        const descContainer = document.querySelector('#identificacionTabContent .wrapper');
        if (descContainer) {
            descripcion = descContainer.textContent.trim();
        }

        // Meta description como fallback
        const metaDesc = document.querySelector('meta[name="description"]');
        const meta_description = metaDesc ? metaDesc.getAttribute('content') : null;

        // Sintesis historica
        let sintesis_historica = null;
        const histTab = document.querySelector('#historiaTabContent');
        if (histTab) {
            // Primer bloque de texto tras "Sintesis historica"
            const divs = histTab.querySelectorAll(':scope > div');
            for (const div of divs) {
                const text = div.textContent.trim();
                if (text.length > 10 && !text.includes('Datacion') && !text.includes('CONSTRUCCION')) {
                    sintesis_historica = text;
                    break;
                }
            }
        }

        // Datacion: texto tras h5 con "CONSTRUCCION"
        let datacion = null;
        let periodo_historico = null;
        let siglo = null;
        const h5s = Array.from(document.querySelectorAll('#historiaTabContent h5, h5'));
        for (const h5 of h5s) {
            if (h5.textContent.includes('CONSTRUCCI')) {
                // El texto de datacion esta tras el h5
                let next = h5.nextSibling;
                let datText = '';
                while (next && next.nodeName !== 'H5' && next.nodeName !== 'DIV') {
                    if (next.textContent) datText += next.textContent.trim() + ' ';
                    next = next.nextSibling;
                }
                datacion = datText.trim();

                if (datacion) {
                    // Extraer periodo
                    if (datacion.includes('Edad Moderna')) periodo_historico = 'Edad Moderna';
                    else if (datacion.includes('Edad Media')) periodo_historico = 'Edad Media';
                    else if (datacion.includes('Edad Contempor')) periodo_historico = 'Edad Contemporanea';
                    else if (datacion.includes('Edad Antigua')) periodo_historico = 'Edad Antigua';

                    // Extraer siglo
                    const sigloMatch = datacion.match(/S\.\s*[IVXLCDM]+/);
                    siglo = sigloMatch ? sigloMatch[0] : null;
                }
                break;
            }
        }

        // Imagenes del carrusel
        const imageSet = new Set();
        const imagenes = [];
        const imgEls = document.querySelectorAll('.jcarousel ul li a.fancybox');
        for (const el of imgEls) {
            const imgUrl = el.href;
            if (imgUrl && !imageSet.has(imgUrl)) {
                imageSet.add(imgUrl);
                const titleRaw = el.title || '';
                const parts = titleRaw.split(/<br\s*\/?>/i);
                imagenes.push({
                    url: imgUrl,
                    titulo: parts[0] ? parts[0].trim() : null,
                    autor: parts[1] ? parts[1].trim().replace(/;$/, '').trim() : null,
                });
            }
        }

        // Fuentes
        let fuentes = null;
        const fuenteH4 = Array.from(document.querySelectorAll('#collapseBiblioteca h4 strong, #identificacionTabContent h4 strong'));
        for (const h4 of fuenteH4) {
            if (h4.textContent.includes('Fuente')) {
                const list = h4.closest('div')?.parentElement?.querySelector('ul');
                if (list) {
                    fuentes = Array.from(list.querySelectorAll('li'))
                        .map(li => li.textContent.trim())
                        .join(' | ');
                }
                break;
            }
        }

        // Bibliografia
        let bibliografia = null;
        for (const h4 of fuenteH4) {
            if (h4.textContent.includes('Bibliograf')) {
                const list = h4.closest('div')?.parentElement?.querySelector('ul');
                if (list) {
                    bibliografia = Array.from(list.querySelectorAll('li'))
                        .map(li => li.textContent.trim())
                        .join(' | ');
                }
                break;
            }
        }

        // Ubicacion detallada (tras icono mapa)
        const mapMarker = document.querySelector('i.fa-map-marker');
        if (mapMarker) {
            const container = mapMarker.closest('div') || mapMarker.parentElement;
            if (container) {
                const fontEl = container.querySelector('font');
                if (fontEl && fontEl.textContent.trim().length > 5) {
                    // Usar como ubicacion detallada si es mas especifica
                    const detalle = fontEl.textContent.trim();
                    if (!ubicacion_detalle || detalle.length > ubicacion_detalle.length) {
                        ubicacion_detalle = detalle;
                    }
                }
            }
        }

        return {
            sipca_id,
            denominacion,
            descripcion,
            sintesis_historica,
            datacion,
            periodo_historico,
            siglo,
            ubicacion_detalle,
            fuentes,
            bibliografia,
            meta_description,
            imagenes,
        };
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { ejecutar };

if (require.main === module) {
    ejecutar().catch(async err => {
        console.error('Error en Fase 3:', err.message);
        await db.cerrar();
        process.exit(1);
    });
}
