const puppeteer = require('puppeteer');

async function scrapeSIPCAtoJSON(startUrl, maxPages = 5) {
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // Configuración mejorada para evitar bloqueos
    await page.setViewport({ width: 1200, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setJavaScriptEnabled(true);
    
    let currentUrl = startUrl;
    let allPropertiesData = [];
    let pagesProcessed = 0;

    try {
        while (currentUrl && pagesProcessed < maxPages) {
            console.log(`📄 Procesando ficha ${pagesProcessed + 1}: ${currentUrl}`);
            
            try {
                // Navegación con espera mejorada
                await page.goto(currentUrl, { 
                    waitUntil: 'networkidle2', 
                    timeout: 60000 
                });

                // Extraer datos de la página
                const propertyData = await page.evaluate(() => {
                    // Función auxiliar mejorada
                    const getCleanText = (selector, parent = document) => {
                        const element = parent.querySelector(selector);
                        return element ? element.textContent.trim().replace(/\s+/g, ' ') : null;
                    };

                    // Función para encontrar elemento por texto
                    const findElementByText = (text, tagName = 'dt') => {
                        const elements = Array.from(document.querySelectorAll(tagName));
                        return elements.find(el => el.textContent?.trim().includes(text));
                    };

                    // Función para obtener texto del elemento hermano siguiente
                    const getNextSiblingText = (element, selector = 'dd') => {
                        if (!element) return null;
                        let next = element.nextElementSibling;
                        while (next) {
                            if (next.matches(selector)) {
                                return next.textContent.trim();
                            }
                            next = next.nextElementSibling;
                        }
                        return null;
                    };

                    // Extraer datos básicos
                    const titulo = getCleanText('h1') || 'Sin título';
                    const subtitulo = getCleanText('.contenedor-datos-cabecera h2');
                    const ubicacion = getCleanText('.contenedor-datos-cabecera h4');

                    // Extraer imágenes con filtrado de duplicados
                    const imagenes = [];
                    const imageElements = Array.from(document.querySelectorAll('.jcarousel ul li a.fancybox'));
                    const uniqueUrls = new Set();
                    
                    imageElements.forEach(el => {
                        if (el.href && !uniqueUrls.has(el.href)) {
                            uniqueUrls.add(el.href);
                            imagenes.push({
                                url: el.href,
                                miniatura: el.querySelector('img')?.src || null,
                                titulo: el.title?.replace(/<br\/>/g, ' - ') || null,
                                autor: el.title?.includes('Gobierno de Aragón') ? 'Gobierno de Aragón' : null
                            });
                        }
                    });

                    // Extraer datos específicos
                    const tipoBienElement = findElementByText('Tipología');
                    const tipoBien = getNextSiblingText(tipoBienElement) || 'Arquitectura civil';

                    const estiloElement = findElementByText('Estilo');
                    const estilo = getNextSiblingText(estiloElement) || 'Tradicional';

                    const datacionText = Array.from(document.querySelectorAll('#historiaTabContent h5'))
                        .find(el => el.textContent.includes('CONSTRUCCIÓN'))
                        ?.nextElementSibling?.textContent?.trim() || '';

                    // Extraer coordenadas del mapa
                    let mapaUrl = document.querySelector('div.mapagooglepequeno a.various')?.href || null;
                    let coordenadas = { latitud: null, longitud: null };
                    if (mapaUrl) {
                        const coordsMatch = mapaUrl.match(/q=([0-9.]+),([0-9.]+)/);
                        if (coordsMatch) {
                            coordenadas.latitud = parseFloat(coordsMatch[1]);
                            coordenadas.longitud = parseFloat(coordsMatch[2]);
                        }
                    }

                    return {
                        metadata: {
                            sistema: "SIPCA",
                            idBien: window.location.href.match(/\/1-INM-[A-Z]+-\d+-\d+-\d+/)?.[0]?.replace(/\//g, '') || null,
                            fechaScraping: new Date().toISOString(),
                            urlOrigen: window.location.href
                        },
                        datosGenerales: {
                            denominacion: titulo,
                            subtitulo: subtitulo,
                            tipoBien: tipoBien,
                            periodoHistorico: datacionText.includes('Edad Moderna') ? 'Edad Moderna' : 
                                            datacionText.includes('Edad Media') ? 'Edad Media' :
                                            datacionText.includes('Edad Contemporánea') ? 'Edad Contemporánea' : null,
                            siglo: datacionText.match(/S\.\s*\w+/)?.[0] || null,
                            estilo: estilo,
                            datacion: datacionText
                        },
                        localizacion: {
                            textoUbicacion: ubicacion,
                            provincia: null,
                            comarca: null,
                            municipio: null,
                            localidad: null,
                            coordenadas: coordenadas,
                            mapaUrl: mapaUrl
                        },
                        documentacionVisual: {
                            imagenes: imagenes,
                            videos: []
                        }
                    };
                });

                // Procesar ubicación si está disponible
                if (propertyData.localizacion.textoUbicacion) {
                    const parts = propertyData.localizacion.textoUbicacion.split(/\s*-\s*/);
                    propertyData.localizacion.provincia = parts[0] || null;
                    propertyData.localizacion.comarca = parts[1] || null;
                    propertyData.localizacion.municipio = parts[2] || null;
                    propertyData.localizacion.localidad = parts[3] || null;
                }

                allPropertiesData.push(propertyData);
                pagesProcessed++;

                // Navegación a siguiente ficha - VERSIÓN MEJORADA
               try {
    // Esperar y verificar el botón con más detalle
    await page.waitForSelector('#siguiente', { 
        visible: true,
        timeout: 10000 
    });

    // Diagnóstico completo
    const buttonInfo = await page.evaluate(() => {
        const btn = document.getElementById('siguiente');
        if (!btn) {
            console.error('Botón no encontrado en el DOM');
            return { exists: false };
        }
        
        console.log('Botón encontrado:', btn.outerHTML); // Ver HTML completo del botón
        
        const onclick = btn.getAttribute('onclick');
        if (!onclick) {
            console.error('El botón no tiene atributo onclick');
            return { exists: true, hasOnclick: false };
        }
        
        console.log('Contenido de onclick:', onclick); // Ver contenido exacto
        
        const match = onclick.match(/mostrarBienSig\('(.+?)'\)/);
        if (!match) {
            console.error('El patrón no coincide con onclick:', onclick);
            return { exists: true, hasOnclick: true, patternMatch: false };
        }
        
        return {
            exists: true,
            hasOnclick: true,
            patternMatch: true,
            nextBienId: match[1]
        };
    });

    console.log('Resultado del diagnóstico:', buttonInfo);

    if (buttonInfo.nextBienId) {
        const baseUrl = currentUrl.split('/censo/')[0];
        currentUrl = `${baseUrl}/censo/${buttonInfo.nextBienId}`;
        console.log(`➡️ Navegando a siguiente ficha: ${currentUrl}`);
    } else {
        console.log('✅ Fin del recorrido. Razón:', 
            !buttonInfo.exists ? 'Botón no existe' :
            !buttonInfo.hasOnclick ? 'Sin atributo onclick' :
            'Patrón no coincide');
        currentUrl = null;
    }
} catch (error) {
    console.log('⚠️ Error al buscar el botón:', error.message);
    currentUrl = null;
}

            } catch (error) {
                console.log(`⚠️ Error al procesar la ficha ${pagesProcessed + 1}:`, error.message);
                currentUrl = null;
            }
        }
    } catch (error) {
        console.error('⚠️ Error general:', error);
    } finally {
        await browser.close();
    }

    console.log(`\n🗂️ Total fichas procesadas: ${allPropertiesData.length}`);
    return allPropertiesData;
}

// Ejemplo de uso
const urlInicial = 'https://www.sipca.es/censo/1-INM-TER-029-001-017/Casa/del/Estudiante.html';
scrapeSIPCAtoJSON(urlInicial, 5)
    .then(data => console.log(JSON.stringify(data, null, 2)))
    .catch(err => console.error('Error:', err));