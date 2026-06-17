// =============================================================
// ADMIN — INTEGRACIONES
// =============================================================
// Endpoints per a integracions ETL visuals (Postman + field mapper).
// Codi al repo i desplegat a producció (Render), però bloquejat amb middleware
// `localOnly` que només admet requests originades a localhost (req.ip
// 127.0.0.1 / ::1) i amb header `X-Local-Mode: true`.
// → A producció (frontend Netlify → backend Render) la request mai vindrà
//   de localhost, així que els endpoints retornen 403 invariablement.
// → En dev (frontend Vite local → backend local), tot funciona.
//
// Doble protecció: el frontend `Integraciones` és al .gitignore.
// =============================================================

const express = require('express');
const multer = require('multer');
const { parse: csvParse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const path = require('path');

const router = express.Router();

// ---------- Middleware: només localhost ----------
function localOnly(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || '';
    const isLocalIp = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    const hasHeader = req.headers['x-local-mode'] === 'true';
    if (isLocalIp && hasHeader) return next();
    return res.status(403).json({
        error: 'Localhost only endpoint',
        hint: 'Frontend ha d\'enviar X-Local-Mode: true des de localhost',
    });
}

router.use(localOnly);

// ---------- Multer (memòria, max 25 MB) ----------
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
});

// ---------- Helpers de parsing ----------
function parseFile(buffer, originalName) {
    const ext = path.extname(originalName).toLowerCase();
    if (ext === '.json') {
        const data = JSON.parse(buffer.toString('utf-8'));
        // Si és un objecte amb un array a alguna clau, intentar trobar-lo
        if (Array.isArray(data)) return data;
        const arr = Object.values(data).find(v => Array.isArray(v));
        if (arr) return arr;
        return [data];
    }
    if (ext === '.csv') {
        return csvParse(buffer.toString('utf-8'), {
            columns: true,
            skip_empty_lines: true,
            trim: true,
        });
    }
    if (ext === '.xlsx' || ext === '.xls') {
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        return XLSX.utils.sheet_to_json(sheet, { defval: null });
    }
    throw new Error(`Format no soportat: ${ext}`);
}

function inferSchema(records) {
    if (!records.length) return [];
    const keys = new Set();
    records.slice(0, 100).forEach(r => Object.keys(r || {}).forEach(k => keys.add(k)));
    return [...keys].map(k => {
        const values = records.map(r => r?.[k]).filter(v => v != null && v !== '');
        const types = new Set(values.map(v => typeof v));
        const sample = values.find(v => v != null);
        return {
            field: k,
            type: types.size === 1 ? [...types][0] : 'mixed',
            non_null: values.length,
            sample: sample != null ? String(sample).substring(0, 100) : null,
        };
    });
}

// =============================================================
// POST /upload
// Carrega arxiu (CSV/JSON/XLSX), retorna preview + schema inferit
// =============================================================
router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Falta el fitxer (camp "file")' });
    try {
        const records = parseFile(req.file.buffer, req.file.originalname);
        const schema = inferSchema(records);
        res.json({
            source: 'file',
            name: req.file.originalname,
            size_bytes: req.file.size,
            total: records.length,
            schema,
            preview: records.slice(0, 50),  // primers 50 registres
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// =============================================================
// POST /fetch-api
// Proxy a un endpoint REST extern (evita CORS al frontend).
// Body: { url, method='GET', headers, body }
// =============================================================
router.post('/fetch-api', express.json({ limit: '10mb' }), async (req, res) => {
    const { url, method = 'GET', headers = {}, body } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Falta camp `url`' });
    try {
        const opts = {
            method,
            headers: { 'User-Agent': 'PatrimonioEuropeo-Integraciones/1.0', ...headers },
        };
        if (body && method !== 'GET' && method !== 'HEAD') {
            opts.body = typeof body === 'string' ? body : JSON.stringify(body);
            if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
        }
        const r = await fetch(url, opts);
        const ct = r.headers.get('content-type') || '';
        let data;
        if (ct.includes('application/json')) {
            data = await r.json();
        } else if (ct.includes('text/csv') || url.endsWith('.csv')) {
            const txt = await r.text();
            data = csvParse(txt, { columns: true, skip_empty_lines: true, trim: true });
        } else {
            data = await r.text();
            try { data = JSON.parse(data); } catch { /* keep as text */ }
        }
        // Normalitzar a array
        let records = data;
        if (!Array.isArray(records)) {
            const arr = Object.values(records || {}).find(v => Array.isArray(v));
            records = arr || [data];
        }
        const schema = inferSchema(records);
        res.json({
            source: 'api',
            url,
            method,
            status: r.status,
            total: records.length,
            schema,
            preview: records.slice(0, 50),
        });
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// =============================================================
// GET /health
// Per verificar que el router està actiu (només localhost ho veu).
// =============================================================
router.get('/health', (_, res) => {
    res.json({ status: 'ok', module: 'integraciones', timestamp: new Date().toISOString() });
});

module.exports = router;
