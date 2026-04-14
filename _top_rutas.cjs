const data = require('./tmp_candidatas_v2.json');

function esRutaDeCalidad(b) {
    const r = b.ruta;
    const n = (r.nombre || '').toLowerCase();
    const d = (r.desc || '').toLowerCase();

    // Descripción al menos útil
    if (!r.desc || r.desc.length < 15) return false;
    // Imagen recomendable (pero no obligatoria si tiene otros metadatos)
    const hasMeta = (r.imagen?1:0) + (r.web?1:0) + (r.longitud_km>0.5?1:0);
    if (hasMeta < 1) return false;

    // Nombre con keyword conocida (evita "chemin de X" locales sin identidad)
    const keywords = /\b(via|sentiero|cammino|ruta|route|chemin|way|francig|appia|romea|emilia|flaminia|aurelia|cassia|amerina|amalf|levada|rota|traject|camino|cami|caminho|rota|sendero|trail|gr[-\s\d])/i;
    if (!keywords.test(r.nombre || '')) return false;

    // Excluir áreas metropolitanas que se escaparon
    if (/\b(metropolitan|metropolita|área metropolitana|area metropolitana|urban area|área urbana|aire urbaine|comprende)\b/.test(d)) return false;

    // Excluir rutas genéricas "chemin + nombre propio" sin personalidad
    if (/^chemin\s+(de|d'|du|des|le|la|les)\s+[a-zà-ÿ]/.test(n) && !r.longitud_km) return false;
    // Excluir chemines urbanos genéricos de Nantes (es un dataset masivo de nombres de calles)
    if ((r.desc||'').toLowerCase().includes('chemin de nantes')) return false;
    if ((r.desc||'').toLowerCase() === 'chemin de randonnée' && !r.longitud_km) return false;

    // Excluir "trail N" numerados genéricos
    if (/trail\s+\d+$/i.test(r.nombre)) return false;

    return true;
}

const seleccion = data.filter(esRutaDeCalidad);

// Score final
seleccion.sort((a, b) => {
    const sa = Math.log(a.totalParadas+1)*12 + (a.ruta.imagen?20:0) + (a.ruta.longitud_km?15:0) + (a.ruta.web?15:0) + (a.ruta.desc ? a.ruta.desc.length/10 : 0);
    const sb = Math.log(b.totalParadas+1)*12 + (b.ruta.imagen?20:0) + (b.ruta.longitud_km?15:0) + (b.ruta.web?15:0) + (b.ruta.desc ? b.ruta.desc.length/10 : 0);
    return sb - sa;
});

console.log('Total seleccionadas:', seleccion.length);
const porPais = {};
seleccion.forEach(b => porPais[b.ruta.pais] = (porPais[b.ruta.pais]||0)+1);
console.log('Por país:', porPais);

console.log('\n=== SELECCIÓN FINAL ===\n');
seleccion.forEach((b, idx) => {
    const r = b.ruta;
    const km = r.longitud_km ? r.longitud_km.toFixed(0)+'km' : '   -  ';
    const img = r.imagen ? '🖼' : ' ';
    const w = r.web ? '🌐' : ' ';
    console.log(
        String(idx+1).padStart(3) + '. ' +
        '[' + r.pais.substring(0,8).padEnd(8) + '] ' +
        r.qid.padEnd(11) + ' ' +
        (r.nombre||'?').substring(0,45).padEnd(45) + ' ' +
        String(b.totalParadas).padStart(3) + 'p ' +
        km.padStart(6) + ' ' + img + w
    );
    if (r.desc) console.log('              ' + r.desc.substring(0, 130));
});

require('fs').writeFileSync('./tmp_top_rutas.json', JSON.stringify(seleccion, null, 2));
