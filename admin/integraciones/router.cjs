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
const { XMLParser } = require('fast-xml-parser');
const path = require('path');
const db = require('../../db.cjs');

const router = express.Router();

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    parseTagValue: true,
    trimValues: true,
    removeNSPrefix: true, // simplifica accés a soap:Envelope → Envelope
});

// Taules a què el panel pot escriure (whitelist per evitar escapatòries)
const ALLOWED_TABLES = [
    'bienes',
    'wikidata',
    'contactos_municipios',
    'rutas_culturales_paradas',
    'imagenes',
];

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
    if (ext === '.xml' || ext === '.rss' || ext === '.atom' || ext === '.kml' || ext === '.gpx') {
        const parsed = xmlParser.parse(buffer.toString('utf-8'));
        return toArrayOfRecords(parsed);
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

// ---------- Helpers de protocol ----------

// Naviga `obj` seguint un path tipus "feed.entries" o "Envelope.Body.0.Items.Item"
function extractByPath(obj, dataPath) {
    if (!dataPath) return obj;
    const parts = String(dataPath).split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return null;
        cur = Array.isArray(cur) ? cur[parseInt(p, 10) || 0] : cur[p];
    }
    return cur;
}

// Normalitza qualsevol resultat a array de records.
// Treu metadades XML (`?xml`, atributs `@_*`) i descendeix si hi ha un sol
// fill-objecte (wrapper típic de SOAP/XML <bienes><bien>...).
function toArrayOfRecords(data, depth = 0) {
    if (depth > 6) return [data];
    if (Array.isArray(data)) return data;
    if (data == null) return [];
    if (typeof data !== 'object') return [data];

    const clean = {};
    for (const [k, v] of Object.entries(data)) {
        if (k === '?xml' || k.startsWith('@_')) continue;
        clean[k] = v;
    }

    const arrays = Object.values(clean).filter(Array.isArray);
    if (arrays.length) {
        return arrays.reduce((a, b) => (a.length >= b.length ? a : b));
    }
    const keys = Object.keys(clean);
    if (keys.length === 1 && typeof clean[keys[0]] === 'object') {
        return toArrayOfRecords(clean[keys[0]], depth + 1);
    }
    return [clean];
}

// Parseja el text de resposta segons content-type / url / hint manual
function parseResponseText(text, contentType, urlOrName, hint) {
    const ct = (contentType || '').toLowerCase();
    const lower = (urlOrName || '').toLowerCase();
    const force = (hint || '').toLowerCase();

    if (force === 'json' || (!force && (ct.includes('json') || lower.endsWith('.json')))) {
        return JSON.parse(text);
    }
    if (force === 'xml' || (!force && (ct.includes('xml') || ct.includes('soap') || lower.endsWith('.xml')))) {
        return xmlParser.parse(text);
    }
    if (force === 'csv' || (!force && (ct.includes('csv') || lower.endsWith('.csv')))) {
        return csvParse(text, { columns: true, skip_empty_lines: true, trim: true });
    }
    // Fallback: intenta JSON, sinó XML, sinó text cru
    try { return JSON.parse(text); } catch (_) { /* */ }
    try { return xmlParser.parse(text); } catch (_) { /* */ }
    return text;
}

// =============================================================
// POST /fetch
// Endpoint unificat per a tots els protocols externs.
//
// Body:
//   { protocol, url, headers?, data_path?, response_type?, ...protocolSpecific }
//
// Protocols suportats:
//   - rest    : { method, body }                      JSON / CSV / XML / text
//   - graphql : { query, variables, operation_name }  POST + Content-Type JSON
//   - soap    : { envelope, soap_action }             POST text/xml
//   - xml     : { method='GET' }                      força parse com a XML
//   - odata   : { query }                             GET amb $format=json
//
// data_path: ruta dins de la resposta on viu el array (ex: "feed.entries",
//   "Envelope.Body.GetResponse.Items.Item", "value" per a OData).
// response_type: 'json'|'xml'|'csv'|'auto' (default auto via Content-Type).
// =============================================================
async function handleFetch(req, res) {
    const b = req.body || {};
    const { protocol = 'rest', url, headers = {}, data_path: dataPath, response_type } = b;
    if (!url) return res.status(400).json({ error: 'Falta camp `url`' });

    try {
        const reqHeaders = { 'User-Agent': 'PatrimonioEuropeo-Integraciones/1.0', ...headers };
        let method = 'GET';
        let body;
        let finalUrl = url;

        switch (protocol) {
            case 'rest': {
                method = b.method || 'GET';
                if (b.body && method !== 'GET' && method !== 'HEAD') {
                    body = typeof b.body === 'string' ? b.body : JSON.stringify(b.body);
                    if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
                }
                break;
            }
            case 'graphql': {
                if (!b.query) return res.status(400).json({ error: 'GraphQL: falta `query`' });
                method = 'POST';
                body = JSON.stringify({
                    query: b.query,
                    variables: b.variables || {},
                    operationName: b.operation_name || undefined,
                });
                reqHeaders['Content-Type'] = 'application/json';
                if (!reqHeaders['Accept']) reqHeaders['Accept'] = 'application/json';
                break;
            }
            case 'soap': {
                if (!b.envelope) return res.status(400).json({ error: 'SOAP: falta `envelope`' });
                method = 'POST';
                body = b.envelope;
                reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'text/xml; charset=utf-8';
                if (b.soap_action) reqHeaders['SOAPAction'] = b.soap_action;
                break;
            }
            case 'xml': {
                method = b.method || 'GET';
                reqHeaders['Accept'] = reqHeaders['Accept'] || 'application/xml, text/xml';
                break;
            }
            case 'odata': {
                method = 'GET';
                const sep = url.includes('?') ? '&' : '?';
                finalUrl = url + sep + '$format=json' + (b.query ? '&' + b.query : '');
                reqHeaders['Accept'] = reqHeaders['Accept'] || 'application/json';
                break;
            }
            default:
                return res.status(400).json({ error: `Protocol desconegut: ${protocol}` });
        }

        const r = await fetch(finalUrl, { method, headers: reqHeaders, body });
        const text = await r.text();
        const ct = r.headers.get('content-type') || '';

        // Força XML per SOAP/XML; auto per la resta
        const forceType = (protocol === 'soap' || protocol === 'xml') ? 'xml'
                        : (response_type === 'auto' ? null : response_type);

        let parsed;
        try {
            parsed = parseResponseText(text, ct, finalUrl, forceType);
        } catch (e) {
            return res.status(502).json({
                error: `Resposta no parseejable (${e.message}). Status: ${r.status}`,
                status: r.status,
                content_type: ct,
                raw_preview: text.substring(0, 500),
            });
        }

        // GraphQL: si hi ha errors, els retornem
        if (protocol === 'graphql' && parsed?.errors) {
            return res.status(502).json({
                error: 'GraphQL errors',
                graphql_errors: parsed.errors,
                status: r.status,
            });
        }

        // Aplica data_path si donat
        const extracted = dataPath ? extractByPath(parsed, dataPath) : parsed;
        const records = toArrayOfRecords(extracted);
        const schema = inferSchema(records);

        res.json({
            source: protocol,
            url: finalUrl,
            method,
            status: r.status,
            content_type: ct,
            data_path: dataPath || null,
            total: records.length,
            schema,
            preview: records.slice(0, 50),
            raw_top_keys: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? Object.keys(parsed).slice(0, 20) : null,
        });
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
}

router.post('/fetch', express.json({ limit: '10mb' }), handleFetch);

// Alias backward-compat — MVP 1 i els scripts antics fan servir /fetch-api per a REST
router.post('/fetch-api', express.json({ limit: '10mb' }), (req, res) => {
    req.body = { protocol: 'rest', ...req.body };
    return handleFetch(req, res);
});

// =============================================================
// GET /schema-bd?table=bienes
// Retorna les columnes de la taula destí amb tipus PG (per al mapper).
// =============================================================
router.get('/schema-bd', async (req, res) => {
    const table = (req.query.table || 'bienes').toString();
    if (!ALLOWED_TABLES.includes(table)) {
        return res.status(400).json({
            error: `Taula no permesa. Tria una de: ${ALLOWED_TABLES.join(', ')}`,
        });
    }
    try {
        const result = await db.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = ?
            ORDER BY ordinal_position
        `, [table]);
        const columns = result.rows.map(r => ({
            name: r.column_name,
            type: r.data_type,
            nullable: r.is_nullable === 'YES',
            has_default: r.column_default != null,
            // No mostrem cap "primary key" → frontend els amaga del mapper
            is_serial: r.column_default && String(r.column_default).startsWith('nextval'),
        }));
        res.json({ table, allowed_tables: ALLOWED_TABLES, columns });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// =============================================================
// POST /transform-preview
// Aplica un mapping { sourceField: targetColumn } a uns records i
// retorna els 5 primers transformats + recompte d'errors per camp.
// No toca BD: és un dry-run en memòria per validar el mapper.
//
// Body: { records: [...], mapping: { [src]: tgt }, table: 'bienes' }
// =============================================================
router.post('/transform-preview', express.json({ limit: '10mb' }), async (req, res) => {
    const { records = [], mapping = {}, table = 'bienes' } = req.body || {};
    if (!ALLOWED_TABLES.includes(table)) {
        return res.status(400).json({ error: 'Taula no permesa' });
    }
    if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'records buit o no és array' });
    }
    // Carrega tipus de la taula per a casting
    let columns = {};
    try {
        const r = await db.query(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ?`,
            [table]
        );
        columns = Object.fromEntries(r.rows.map(c => [c.column_name, c.data_type]));
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }

    const errors = {};   // { columnName: nº de fallades }
    const transformed = records.slice(0, 5).map((row, idx) => {
        const out = {};
        for (const [src, tgt] of Object.entries(mapping)) {
            if (!tgt || tgt === '__ignore__') continue;
            const raw = row?.[src];
            const cast = castValue(raw, columns[tgt]);
            if (cast.error) {
                errors[tgt] = (errors[tgt] || 0) + 1;
                if (idx === 0) out[tgt] = { __error__: cast.error, __raw__: raw };
                else out[tgt] = null;
            } else {
                out[tgt] = cast.value;
            }
        }
        return out;
    });

    res.json({ table, total_records: records.length, preview: transformed, errors });
});

function castValue(raw, pgType) {
    if (raw == null || raw === '') return { value: null };
    const t = (pgType || '').toLowerCase();
    try {
        if (t === 'integer' || t === 'bigint' || t === 'smallint') {
            const n = parseInt(raw, 10);
            if (isNaN(n)) return { error: `No es pot convertir "${raw}" a ${t}` };
            return { value: n };
        }
        if (t === 'double precision' || t === 'real' || t === 'numeric') {
            const n = parseFloat(String(raw).replace(',', '.'));
            if (isNaN(n)) return { error: `No es pot convertir "${raw}" a ${t}` };
            return { value: n };
        }
        if (t === 'boolean') {
            const s = String(raw).toLowerCase().trim();
            if (['true', '1', 'yes', 'si', 'sí', 'y'].includes(s)) return { value: true };
            if (['false', '0', 'no', 'n'].includes(s)) return { value: false };
            return { error: `No es pot convertir "${raw}" a boolean` };
        }
        // text / varchar / etc.
        return { value: String(raw) };
    } catch (e) {
        return { error: e.message };
    }
}

// =============================================================
// GET /health
// Per verificar que el router està actiu (només localhost ho veu).
// =============================================================
router.get('/health', (_, res) => {
    res.json({ status: 'ok', module: 'integraciones', timestamp: new Date().toISOString() });
});

module.exports = router;
