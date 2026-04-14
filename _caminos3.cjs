const data = require('./tmp_caminos.json');

// Dedupe by QID, prefer entries with image and length
const map = new Map();
for (const r of data) {
    const qid = r.item.value.split('/').pop();
    const cur = map.get(qid);
    const score = (r.length ? 2 : 0) + (r.img ? 1 : 0) + (r.web ? 1 : 0) + (r.desc ? 1 : 0);
    if (!cur || score > cur._score) {
        map.set(qid, { ...r, _score: score });
    }
}
const dedup = Array.from(map.values());
console.log('Únicas tras dedupe:', dedup.length);

// Classify: routes (have length, or name contains "Camino"/"Way"/"Chemin"/"Cammino"/"Caminho")
const isRoute = r => {
    if (r.length) return true;
    const n = (r.itemLabel?.value || '').toLowerCase();
    return /\b(camino|caminos|chemin|cammino|caminho|via|way of|ruta|jakobsweg|jakobswege)\b/.test(n);
};

const rutas = dedup.filter(isRoute);
const monumentos = dedup.filter(r => !isRoute(r));

console.log('\nRutas (probable):', rutas.length);
console.log('Monumentos/otros:', monumentos.length);

// Group routes by country
const porPais = {};
rutas.forEach(r => {
    const c = r.countryLabel?.value || '?';
    porPais[c] = porPais[c] || [];
    porPais[c].push(r);
});

console.log('\n=== RUTAS POR PAÍS ===');
for (const [pais, lista] of Object.entries(porPais).sort((a,b) => b[1].length - a[1].length)) {
    console.log(`\n--- ${pais} (${lista.length}) ---`);
    lista.sort((a,b) => b._score - a._score).forEach(r => {
        const km = r.length ? (parseFloat(r.length.value)/1000).toFixed(0)+'km' : '   -  ';
        const img = r.img ? '🖼' : ' ';
        const w = r.web ? '🌐' : ' ';
        const qid = r.item.value.split('/').pop();
        console.log('  ' + qid.padEnd(11) + ' ' + (r.itemLabel?.value || '?').substring(0,55).padEnd(55) + ' ' + km.padStart(7) + ' ' + img + w);
        if (r.desc?.value) console.log('              ' + r.desc.value.substring(0,110));
    });
}
