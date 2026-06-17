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

// ---------- Taula d'auditoria d'integracions ----------
// Es crea al primer ús per evitar tocar inicializarTablas(). Guarda traça
// completa de cada modificació feta des d'una integració (per a auditoria,
// rollback i evitar dobles integracions de la mateixa font+codi).
let _tableReady = false;
async function ensureIntegrationTable() {
    if (_tableReady) return;
    await db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`, []).catch(() => {});
    await db.query(`
        CREATE TABLE IF NOT EXISTS integration_matches (
            id SERIAL PRIMARY KEY,
            bien_id INTEGER REFERENCES bienes(id) ON DELETE SET NULL,
            fuente TEXT NOT NULL,
            codigo_externo TEXT,
            accion TEXT NOT NULL CHECK (accion IN ('INSERT','UPDATE','LINK','SKIP')),
            tabla TEXT,
            campos_modificados JSONB,
            valores_anteriors JSONB,
            confianza REAL,
            revisado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_intmatch_bien ON integration_matches(bien_id);
        CREATE INDEX IF NOT EXISTS idx_intmatch_fuente ON integration_matches(fuente);
        CREATE INDEX IF NOT EXISTS idx_intmatch_codigo ON integration_matches(fuente, codigo_externo);

        CREATE TABLE IF NOT EXISTS denominaciones_alternativas (
            id SERIAL PRIMARY KEY,
            bien_id INTEGER NOT NULL REFERENCES bienes(id) ON DELETE CASCADE,
            denominacion TEXT NOT NULL,
            idioma TEXT,
            fuente TEXT,
            es_principal BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(bien_id, denominacion)
        );
        CREATE INDEX IF NOT EXISTS idx_denom_alt_bien ON denominaciones_alternativas(bien_id);
        CREATE INDEX IF NOT EXISTS idx_denom_alt_trgm
            ON denominaciones_alternativas USING gin (denominacion gin_trgm_ops);
    `, []);
    _tableReady = true;
}

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
    'sipca',
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

// Aplana objectes anidats amb dot notation per fer-los mapejables:
//   { coordenadas: { lat: 42, lng: 1 } } → { 'coordenadas.lat': 42, 'coordenadas.lng': 1 }
// Conserva arrays i strings tal qual (KML <coordinates> queda com a string CSV).
function flattenRecord(obj, prefix = '', out = {}, depth = 0) {
    if (depth > 4 || obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
        if (prefix) out[prefix] = obj;
        return out;
    }
    const entries = Object.entries(obj);
    if (!entries.length) {
        if (prefix) out[prefix] = obj;
        return out;
    }
    for (const [k, v] of entries) {
        const key = k.startsWith('@_') ? `${prefix || ''}${prefix ? '.' : ''}${k.slice(2)}` // treu prefix XML attribute
                  : prefix ? `${prefix}.${k}` : k;
        if (v != null && typeof v === 'object' && !Array.isArray(v)) {
            flattenRecord(v, key, out, depth + 1);
        } else {
            out[key] = v;
        }
    }
    return out;
}

function flattenAll(records) {
    if (!Array.isArray(records)) return records;
    return records.map(r => (r && typeof r === 'object' && !Array.isArray(r)) ? flattenRecord(r) : r);
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
        const raw = parseFile(req.file.buffer, req.file.originalname);
        const records = flattenAll(raw);
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
        const records = flattenAll(toArrayOfRecords(extracted));
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
// Retorna columnes amb tipus PG. Sense `table` retorna TOTES les taules
// whitelisted (per al mapper multi-taula).
// =============================================================
router.get('/schema-bd', async (req, res) => {
    const tableFilter = req.query.table?.toString();
    if (tableFilter && !ALLOWED_TABLES.includes(tableFilter)) {
        return res.status(400).json({
            error: `Taula no permesa. Tria una de: ${ALLOWED_TABLES.join(', ')}`,
        });
    }
    const tables = tableFilter ? [tableFilter] : ALLOWED_TABLES;
    try {
        const result = await db.query(`
            SELECT table_name, column_name, data_type, is_nullable, column_default,
                   ordinal_position
            FROM information_schema.columns
            WHERE table_name = ANY(?)
            ORDER BY table_name, ordinal_position
        `, [tables]);
        const byTable = {};
        for (const r of result.rows) {
            const isSerial = r.column_default && String(r.column_default).startsWith('nextval');
            if (!byTable[r.table_name]) byTable[r.table_name] = [];
            byTable[r.table_name].push({
                name: r.column_name,
                qualified: `${r.table_name}.${r.column_name}`,
                type: r.data_type,
                nullable: r.is_nullable === 'YES',
                has_default: r.column_default != null,
                is_serial: isSerial,
            });
        }
        res.json({
            allowed_tables: ALLOWED_TABLES,
            primary_table: 'bienes', // taula d'on surt el bien_id per a la resta
            link_columns: { wikidata: 'bien_id', sipca: 'bien_id', imagenes: 'bien_id' },
            tables: byTable,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// =============================================================
// POST /transform-preview
// Aplica un mapping { sourceField: "table.column" } a uns records i
// retorna els 5 primers transformats AGRUPATS per taula.
// No toca BD: és un dry-run en memòria per validar el mapper.
//
// Body: { records: [...], mapping: { [src]: "table.column" } }
//   mapping pot tenir entrades sense punt → assumeix taula primary 'bienes'
//   per backward-compat.
// =============================================================
router.post('/transform-preview', express.json({ limit: '10mb' }), async (req, res) => {
    const { records = [], mapping = {} } = req.body || {};
    if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'records buit o no és array' });
    }

    // Normalitza mapping: { src: "table.col" } | { src: "col" → "bienes.col" }
    const normalized = {};
    for (const [src, tgt] of Object.entries(mapping)) {
        if (!tgt || tgt === '__ignore__') continue;
        const [table, ...rest] = tgt.includes('.') ? tgt.split('.') : ['bienes', tgt];
        const column = rest.length ? rest.join('.') : tgt;
        if (!ALLOWED_TABLES.includes(table)) {
            return res.status(400).json({ error: `Taula no permesa: ${table}` });
        }
        normalized[src] = { table, column };
    }

    // Carrega tipus PG de totes les taules implicades
    const tables = [...new Set(Object.values(normalized).map(t => t.table))];
    let columnsByTable = {};
    try {
        const r = await db.query(
            `SELECT table_name, column_name, data_type
             FROM information_schema.columns
             WHERE table_name = ANY(?)`,
            [tables]
        );
        for (const row of r.rows) {
            if (!columnsByTable[row.table_name]) columnsByTable[row.table_name] = {};
            columnsByTable[row.table_name][row.column_name] = row.data_type;
        }
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }

    const errors = {}; // { "table.column": nº de fallades }
    const transformed = records.slice(0, 5).map((row, idx) => {
        const out = {}; // { bienes: {...}, wikidata: {...}, ... }
        for (const [src, { table, column }] of Object.entries(normalized)) {
            const raw = row?.[src];
            if (!out[table]) out[table] = {};

            // Cas especial: metadata_externa (JSONB). Si l'usuari mapa
            // `taula.metadata_externa` (sense subcol), tots aquests camps
            // s'agrupen en un únic JSONB { source_field: value }.
            if (column === 'metadata_externa' || column.startsWith('metadata_externa.')) {
                const subKey = column === 'metadata_externa' ? src : column.slice('metadata_externa.'.length);
                if (!out[table].metadata_externa) out[table].metadata_externa = {};
                out[table].metadata_externa[subKey] = raw;
                continue;
            }

            const pgType = columnsByTable[table]?.[column];
            const cast = castValue(raw, pgType);
            const key = `${table}.${column}`;
            if (cast.error) {
                errors[key] = (errors[key] || 0) + 1;
                if (idx === 0) out[table][column] = { __error__: cast.error, __raw__: raw };
                else out[table][column] = null;
            } else {
                out[table][column] = cast.value;
            }
        }
        return out;
    });

    res.json({
        tables_used: tables,
        primary_table: 'bienes',
        total_records: records.length,
        preview: transformed,
        errors,
    });
});

// Per passar valors a node-pg: objectes (JSONB) cal stringify manual
function pgValue(v) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        return JSON.stringify(v);
    }
    return v;
}

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
// POST /match-candidates
// Per cada record (ja transformat amb estructura { bienes: {...}, wikidata: {...} })
// busca candidats existents a bienes amb 3 estratègies combinables.
//
// Body:
//   { records: [{ bienes: {...}, wikidata: {...} }],
//     fuente: 'HN',
//     strategies: {
//       code: true,                         // codigo_fuente exacte
//       coords: { radius_m: 200 },          // Haversine
//       name_muni: { similarity: 0.45 }     // pg_trgm + municipi
//     } }
//
// Retorna: { results: [{ idx, suggested_action, suggested_candidate_id, candidates: [...] }] }
// =============================================================
router.post('/match-candidates', express.json({ limit: '10mb' }), async (req, res) => {
    const { records = [], fuente, strategies = {} } = req.body || {};
    if (!Array.isArray(records) || !records.length) {
        return res.status(400).json({ error: 'records buit' });
    }
    const stratCode = strategies.code !== false;
    const radius = strategies.coords?.radius_m || 200;
    const useCoords = strategies.coords !== false;
    const similarity = strategies.name_muni?.similarity ?? 0.45;
    const useNameMuni = strategies.name_muni !== false;

    try {
        await ensureIntegrationTable();
        const results = [];

        // pg_trgm ha d'estar carregat (al inicializarTablas ja es fa CREATE EXTENSION unaccent;
        // pg_trgm cal carregar-la per a similarity())
        await db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`, []).catch(() => {});

        for (let i = 0; i < records.length; i++) {
            const r = records[i] || {};
            const b = r.bienes || {};
            const candidatesById = new Map(); // dedup per bien_id

            // 1) Codi extern
            if (stratCode && b.codigo_fuente && fuente) {
                const codeRes = await db.query(
                    `SELECT id, denominacion, municipio, provincia, latitud, longitud,
                            codigo_fuente, comunidad_autonoma
                       FROM bienes WHERE codigo_fuente = ? LIMIT 5`,
                    [String(b.codigo_fuente)]
                );
                for (const row of codeRes.rows) {
                    candidatesById.set(row.id, {
                        ...row, score: 1.0, strategy: 'code', distance_m: null,
                    });
                }
            }

            // 2) Coordenades (Haversine)
            if (useCoords && typeof b.latitud === 'number' && typeof b.longitud === 'number') {
                const lat = b.latitud, lng = b.longitud;
                const dDeg = (radius / 1000) / 111.0 * 1.5; // buffer una mica generós per al bbox
                const coordRes = await db.query(`
                    SELECT id, denominacion, municipio, provincia, latitud, longitud,
                           codigo_fuente, comunidad_autonoma,
                           (6371000 * 2 * ASIN(SQRT(
                               POWER(SIN(RADIANS((? - latitud)/2.0)), 2) +
                               COS(RADIANS(latitud)) * COS(RADIANS(?)) *
                               POWER(SIN(RADIANS((? - longitud)/2.0)), 2)
                           ))) AS distance_m
                      FROM bienes
                     WHERE latitud BETWEEN ? AND ?
                       AND longitud BETWEEN ? AND ?
                       AND latitud IS NOT NULL AND longitud IS NOT NULL
                     ORDER BY distance_m ASC
                     LIMIT 10
                `, [lat, lat, lng, lat - dDeg, lat + dDeg, lng - dDeg, lng + dDeg]);
                for (const row of coordRes.rows) {
                    if (row.distance_m > radius) continue;
                    const score = Math.max(0.5, 1 - row.distance_m / radius);
                    const prev = candidatesById.get(row.id);
                    if (!prev || prev.score < score) {
                        candidatesById.set(row.id, {
                            ...row, score, strategy: prev ? `${prev.strategy}+coords` : 'coords',
                            distance_m: Math.round(row.distance_m),
                        });
                    } else {
                        prev.strategy = `${prev.strategy}+coords`;
                        prev.distance_m = Math.round(row.distance_m);
                    }
                }
            }

            // 3) Nom + municipi (similarity)
            if (useNameMuni && b.denominacion && b.municipio) {
                const nameRes = await db.query(`
                    SELECT id, denominacion, municipio, provincia, latitud, longitud,
                           codigo_fuente, comunidad_autonoma,
                           similarity(unaccent(denominacion), unaccent(?)) AS sim
                      FROM bienes
                     WHERE unaccent(municipio) ILIKE unaccent(?)
                       AND similarity(unaccent(denominacion), unaccent(?)) > ?
                     ORDER BY sim DESC
                     LIMIT 10
                `, [String(b.denominacion), String(b.municipio), String(b.denominacion), similarity]);
                for (const row of nameRes.rows) {
                    const score = row.sim;
                    const prev = candidatesById.get(row.id);
                    if (!prev || prev.score < score) {
                        candidatesById.set(row.id, {
                            ...row, score,
                            strategy: prev ? `${prev.strategy}+name_muni` : 'name_muni',
                        });
                    } else {
                        prev.strategy = `${prev.strategy}+name_muni`;
                    }
                }
            }

            // 4) Denominacions alternatives (sinònims, multi-idioma)
            if (useNameMuni && b.denominacion) {
                const altRes = await db.query(`
                    SELECT b.id, b.denominacion, b.municipio, b.provincia,
                           b.latitud, b.longitud, b.codigo_fuente, b.comunidad_autonoma,
                           da.denominacion AS alt_match,
                           similarity(unaccent(da.denominacion), unaccent(?)) AS sim
                      FROM denominaciones_alternativas da
                      JOIN bienes b ON b.id = da.bien_id
                     WHERE similarity(unaccent(da.denominacion), unaccent(?)) > ?
                     ORDER BY sim DESC
                     LIMIT 10
                `, [String(b.denominacion), String(b.denominacion), similarity]);
                for (const row of altRes.rows) {
                    // Score lleugerament reduït vs nom directe (és coincidència via alies)
                    const score = row.sim * 0.95;
                    const prev = candidatesById.get(row.id);
                    if (!prev || prev.score < score) {
                        candidatesById.set(row.id, {
                            ...row, score,
                            strategy: prev ? `${prev.strategy}+altname` : 'altname',
                            alt_match: row.alt_match,
                        });
                    } else {
                        prev.strategy = `${prev.strategy}+altname`;
                        prev.alt_match = row.alt_match;
                    }
                }
            }

            const candidates = [...candidatesById.values()]
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);

            // Acció suggerida
            let suggested_action = 'INSERT';
            let suggested_candidate_id = null;
            if (candidates.length) {
                suggested_candidate_id = candidates[0].id;
                suggested_action = candidates[0].score >= 0.9 ? 'UPDATE' : 'REVIEW';
            }
            results.push({ idx: i, suggested_action, suggested_candidate_id, candidates });
        }

        res.json({
            total: results.length,
            with_candidates: results.filter(r => r.candidates.length > 0).length,
            results,
        });
    } catch (e) {
        res.status(500).json({ error: e.message, stack: e.stack });
    }
});

// =============================================================
// POST /dry-run
// Simula què passaria amb les decisions de l'usuari (sense tocar BD).
//
// Body:
//   { records: [...transformed],
//     decisions: [{ idx, action: 'INSERT'|'UPDATE'|'LINK'|'SKIP',
//                   target_bien_id?, field_choices: { 'tabla.col': 'origen'|'bd'|<text> } }],
//     fuente: 'HN' }
//
// Retorna: { summary, per_row: [{ idx, action, sql_summary, conflicts }] }
// =============================================================
router.post('/dry-run', express.json({ limit: '10mb' }), async (req, res) => {
    const { records = [], decisions = [], fuente } = req.body || {};
    if (!Array.isArray(decisions)) return res.status(400).json({ error: 'decisions requerit' });

    try {
        const summary = { INSERT: 0, UPDATE: 0, LINK: 0, SKIP: 0, errors: 0 };
        const per_row = [];

        for (const dec of decisions) {
            const rec = records[dec.idx] || {};
            const tablesAffected = Object.keys(rec).filter(t => Object.keys(rec[t] || {}).length);

            if (dec.action === 'SKIP') {
                summary.SKIP++;
                per_row.push({ idx: dec.idx, action: 'SKIP', tables: [] });
                continue;
            }

            if (dec.action === 'LINK') {
                if (!dec.target_bien_id) {
                    summary.errors++;
                    per_row.push({ idx: dec.idx, action: 'LINK', error: 'Falta target_bien_id' });
                    continue;
                }
                summary.LINK++;
                per_row.push({
                    idx: dec.idx, action: 'LINK', bien_id: dec.target_bien_id,
                    tables: ['integration_matches'],
                });
                continue;
            }

            if (dec.action === 'INSERT') {
                if (!rec.bienes || !rec.bienes.denominacion) {
                    summary.errors++;
                    per_row.push({ idx: dec.idx, action: 'INSERT', error: 'Falta denominacion a bienes' });
                    continue;
                }
                summary.INSERT++;
                per_row.push({
                    idx: dec.idx, action: 'INSERT', tables: tablesAffected,
                    fields_inserted: Object.fromEntries(tablesAffected.map(t => [t, Object.keys(rec[t])])),
                });
                continue;
            }

            if (dec.action === 'UPDATE') {
                if (!dec.target_bien_id) {
                    summary.errors++;
                    per_row.push({ idx: dec.idx, action: 'UPDATE', error: 'Falta target_bien_id' });
                    continue;
                }
                // Llegeix valors actuals per veure el diff
                const cur = await db.query('SELECT * FROM bienes WHERE id = ?', [dec.target_bien_id]);
                if (!cur.rows.length) {
                    summary.errors++;
                    per_row.push({ idx: dec.idx, action: 'UPDATE', error: `bien_id ${dec.target_bien_id} no existeix` });
                    continue;
                }
                const choices = dec.field_choices || {};
                const changes = {};
                const altNames = [];
                const concats = [];
                for (const [key, choice] of Object.entries(choices)) {
                    if (!choice || choice === 'bd') continue;
                    const [table, col] = key.split('.');
                    const origVal = rec[table]?.[col];
                    if (choice === 'altname') {
                        if (col === 'denominacion' && origVal) altNames.push(origVal);
                        continue;
                    }
                    if (choice === 'concat') {
                        if (origVal) concats.push({ field: key, new: origVal });
                        continue;
                    }
                    const newVal = choice === 'origen' ? origVal : choice;
                    if (!changes[table]) changes[table] = {};
                    changes[table][col] = newVal;
                }
                summary.UPDATE++;
                per_row.push({
                    idx: dec.idx, action: 'UPDATE', bien_id: dec.target_bien_id,
                    changes, alt_names: altNames, concats,
                    tables: [...new Set([...Object.keys(changes), ...(altNames.length ? ['denominaciones_alternativas'] : []), ...concats.map(c => c.field.split('.')[0])])],
                });
                continue;
            }

            summary.errors++;
            per_row.push({ idx: dec.idx, error: `Acció desconeguda: ${dec.action}` });
        }
        res.json({ summary, total_decisions: decisions.length, fuente: fuente || null, per_row });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// =============================================================
// POST /apply
// Executa realment les decisions a la BD dins UNA transacció.
// Requereix { confirm: true } per evitar disparar per error.
// Cada modificació es registra a integration_matches per a auditoria.
// =============================================================
router.post('/apply', express.json({ limit: '10mb' }), async (req, res) => {
    const { records = [], decisions = [], fuente, confirm } = req.body || {};
    if (confirm !== true) {
        return res.status(400).json({ error: 'Falta confirm=true. Aplicació no executada per seguretat.' });
    }
    if (!fuente) return res.status(400).json({ error: 'Falta fuente (etiqueta de procedència)' });
    if (!decisions.length) return res.status(400).json({ error: 'decisions buit' });

    try {
        await ensureIntegrationTable();

        const result = await db.transaction(async (client) => {
            const summary = { INSERT: 0, UPDATE: 0, LINK: 0, SKIP: 0 };
            const applied = [];

            for (const dec of decisions) {
                const rec = records[dec.idx] || {};
                const codigoExt = rec.bienes?.codigo_fuente || null;

                if (dec.action === 'SKIP') {
                    summary.SKIP++;
                    await client.query(
                        `INSERT INTO integration_matches (bien_id, fuente, codigo_externo, accion)
                         VALUES ($1, $2, $3, 'SKIP')`,
                        [dec.target_bien_id || null, fuente, codigoExt]
                    );
                    continue;
                }

                if (dec.action === 'LINK') {
                    summary.LINK++;
                    await client.query(
                        `INSERT INTO integration_matches (bien_id, fuente, codigo_externo, accion)
                         VALUES ($1, $2, $3, 'LINK')`,
                        [dec.target_bien_id, fuente, codigoExt]
                    );
                    applied.push({ idx: dec.idx, action: 'LINK', bien_id: dec.target_bien_id });
                    continue;
                }

                if (dec.action === 'INSERT') {
                    const bienes = rec.bienes || {};
                    const cols = Object.keys(bienes).filter(c => bienes[c] !== undefined);
                    if (!cols.length || !bienes.denominacion) {
                        throw new Error(`row ${dec.idx}: INSERT sense denominacion`);
                    }
                    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
                    const ins = await client.query(
                        `INSERT INTO bienes (${cols.join(',')}) VALUES (${placeholders}) RETURNING id`,
                        cols.map(c => pgValue(bienes[c]))
                    );
                    const newId = ins.rows[0].id;

                    // Tables secundàries (wikidata, sipca, imagenes) si tenen camps
                    const linkCols = { wikidata: 'bien_id', sipca: 'bien_id', imagenes: 'bien_id' };
                    for (const [table, fk] of Object.entries(linkCols)) {
                        const block = rec[table];
                        if (!block || !Object.keys(block).length) continue;
                        const c2 = Object.keys(block);
                        const p2 = c2.map((_, i) => `$${i + 2}`).join(',');
                        await client.query(
                            `INSERT INTO ${table} (${fk}, ${c2.join(',')}) VALUES ($1, ${p2})`,
                            [newId, ...c2.map(c => pgValue(block[c]))]
                        );
                    }

                    await client.query(
                        `INSERT INTO integration_matches
                         (bien_id, fuente, codigo_externo, accion, campos_modificados)
                         VALUES ($1, $2, $3, 'INSERT', $4)`,
                        [newId, fuente, codigoExt, JSON.stringify(rec)]
                    );
                    summary.INSERT++;
                    applied.push({ idx: dec.idx, action: 'INSERT', bien_id: newId });
                    continue;
                }

                if (dec.action === 'UPDATE') {
                    if (!dec.target_bien_id) throw new Error(`row ${dec.idx}: UPDATE sense target_bien_id`);
                    const choices = dec.field_choices || {};
                    const changes = {};
                    const altNamesToAdd = []; // { denominacion }
                    const concatOps = []; // { table, col, newVal }
                    for (const [key, choice] of Object.entries(choices)) {
                        if (!choice || choice === 'bd') continue;
                        const [table, col] = key.split('.');
                        const origVal = rec[table]?.[col];

                        if (choice === 'altname') {
                            // Només sentit per a denominacion. Preserva BD + afegeix alternativa.
                            if (col === 'denominacion' && origVal != null && String(origVal).trim()) {
                                altNamesToAdd.push(String(origVal).trim());
                            }
                            continue;
                        }
                        if (choice === 'concat') {
                            if (origVal != null && String(origVal).trim()) {
                                concatOps.push({ table, col, newVal: String(origVal).trim() });
                            }
                            continue;
                        }
                        const newVal = choice === 'origen' ? origVal : choice;
                        if (!changes[table]) changes[table] = {};
                        changes[table][col] = newVal;
                    }

                    // Llegeix valors anteriors per a rollback
                    const prev = await client.query('SELECT * FROM bienes WHERE id = $1', [dec.target_bien_id]);
                    const prevRow = prev.rows[0] || {};
                    const valoresAnt = {};
                    if (changes.bienes) {
                        for (const c of Object.keys(changes.bienes)) valoresAnt[`bienes.${c}`] = prevRow[c];
                    }

                    // UPDATE bienes
                    if (changes.bienes && Object.keys(changes.bienes).length) {
                        const sets = Object.keys(changes.bienes).map((c, i) => `${c} = $${i + 1}`).join(', ');
                        const params = [...Object.values(changes.bienes).map(pgValue), dec.target_bien_id];
                        await client.query(
                            `UPDATE bienes SET ${sets}, updated_at = NOW() WHERE id = $${params.length}`,
                            params
                        );
                    }

                    // UPSERT sobre taules secundàries (wikidata, sipca)
                    for (const table of ['wikidata', 'sipca']) {
                        if (!changes[table]) continue;
                        const c2 = Object.keys(changes[table]);
                        const sets = c2.map((c, i) => `${c} = $${i + 2}`).join(', ');
                        const exists = await client.query(`SELECT 1 FROM ${table} WHERE bien_id = $1`, [dec.target_bien_id]);
                        if (exists.rows.length) {
                            await client.query(
                                `UPDATE ${table} SET ${sets} WHERE bien_id = $1`,
                                [dec.target_bien_id, ...c2.map(c => pgValue(changes[table][c]))]
                            );
                        } else {
                            const ph = c2.map((_, i) => `$${i + 2}`).join(',');
                            await client.query(
                                `INSERT INTO ${table} (bien_id, ${c2.join(',')}) VALUES ($1, ${ph})`,
                                [dec.target_bien_id, ...c2.map(c => pgValue(changes[table][c]))]
                            );
                        }
                    }

                    // Concat: per cada camp marcat, append text amb separador.
                    for (const op of concatOps) {
                        await client.query(
                            `UPDATE ${op.table}
                                SET ${op.col} = CASE
                                    WHEN ${op.col} IS NULL OR ${op.col} = ''
                                        THEN $1
                                    ELSE ${op.col} || E'\\n\\n' || $1
                                END
                              WHERE ${op.table === 'bienes' ? 'id' : 'bien_id'} = $2`,
                            [op.newVal, dec.target_bien_id]
                        );
                    }

                    // Alternativas: afegeix noves denominacions sense modificar bienes
                    for (const denom of altNamesToAdd) {
                        await client.query(
                            `INSERT INTO denominaciones_alternativas (bien_id, denominacion, fuente)
                             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                            [dec.target_bien_id, denom, fuente]
                        );
                    }

                    await client.query(
                        `INSERT INTO integration_matches
                         (bien_id, fuente, codigo_externo, accion, tabla, campos_modificados, valores_anteriors)
                         VALUES ($1, $2, $3, 'UPDATE', 'multi', $4, $5)`,
                        [dec.target_bien_id, fuente, codigoExt,
                         JSON.stringify({ ...changes, ...(altNamesToAdd.length && { _alt_names: altNamesToAdd }), ...(concatOps.length && { _concat: concatOps }) }),
                         JSON.stringify(valoresAnt)]
                    );
                    summary.UPDATE++;
                    applied.push({ idx: dec.idx, action: 'UPDATE', bien_id: dec.target_bien_id,
                                   alt_names: altNamesToAdd.length, concat: concatOps.length });
                }
            }
            return { summary, applied };
        });

        res.json({ ok: true, ...result });
    } catch (e) {
        console.error('[Integraciones /apply] ROLLBACK:', e.message);
        res.status(500).json({ error: e.message, rolled_back: true });
    }
});

// =============================================================
// GET /search-bd?q=text&limit=20
// Cerca lliure sobre bienes per linkar manualment (cas: nom completament
// diferent però l'usuari sap que existeix). ILIKE + pg_trgm.
// =============================================================
router.get('/search-bd', async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    if (q.length < 1) return res.json({ results: [] });
    const asInt = /^\d+$/.test(q) ? parseInt(q, 10) : null;
    try {
        const r = await db.query(`
            SELECT id, denominacion, municipio, provincia, comunidad_autonoma,
                   latitud, longitud, codigo_fuente, tipo, categoria,
                   CASE WHEN id = ? THEN 1.0
                        ELSE similarity(unaccent(denominacion), unaccent(?)) END as score
              FROM bienes
             WHERE id = ?
                OR unaccent(denominacion) ILIKE unaccent(?)
                OR unaccent(municipio) ILIKE unaccent(?)
                OR codigo_fuente = ?
             ORDER BY score DESC NULLS LAST, id ASC
             LIMIT ?
        `, [asInt, q, asInt, `%${q}%`, `%${q}%`, q, limit]);
        res.json({ q, total: r.rows.length, results: r.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// =============================================================
// GET /column-samples?table=X
// Per a cada columna de la taula, retorna 3 valors no-null reals
// d'exemple. Útil per fer tooltips informatius al mapper.
// =============================================================
router.get('/column-samples', async (req, res) => {
    const table = (req.query.table || 'bienes').toString();
    if (!ALLOWED_TABLES.includes(table)) {
        return res.status(400).json({ error: 'Taula no permesa' });
    }
    try {
        const colsRes = await db.query(
            `SELECT column_name, data_type FROM information_schema.columns
             WHERE table_name = ? ORDER BY ordinal_position`,
            [table]
        );
        const samples = {};
        for (const c of colsRes.rows) {
            if (c.column_name === 'id' || c.column_name.endsWith('_at')) continue;
            try {
                const r = await db.query(
                    `SELECT DISTINCT ${c.column_name} as v FROM ${table}
                     WHERE ${c.column_name} IS NOT NULL
                       AND ${c.column_name}::text != ''
                     ORDER BY ${c.column_name}::text
                     LIMIT 3`,
                    []
                );
                samples[c.column_name] = {
                    type: c.data_type,
                    samples: r.rows.map(row => row.v),
                };
            } catch (_e) { /* tipus que no es pot text-cast: ignorar */ }
        }
        res.json({ table, samples });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// =============================================================
// SPRINTS — execució de scripts d'enriquiment en background
// =============================================================
// Llista whitelisted (no permetem execució arbitrària de qualsevol script).
// Cada entrada: { id, label, description, file, estimated_min }
const SPRINTS = [
    { id: 'qid_tipo', label: '🏛️ QID → tipo_monumento', description: 'P31 → categoria conservadora (esglésies, castells, palaus…)', file: '_sprint_B_qid_tipo.cjs', estimated_min: 5 },
    { id: 'wikipedia', label: '📖 Wikipedia extracts (descripció)', description: 'Descarrega descripcions Wikipedia per a tots els bienes amb wikipedia_url', file: '_sprint_wikipedia_extracts.cjs', estimated_min: 10 },
    { id: 'imatges', label: '🖼️ Imatges Wikidata P18', description: 'Imatges principals via Wikidata Property P18', file: '_sprint_imatges_p18.cjs', estimated_min: 8 },
    { id: 'arquitectos', label: '🧑‍💼 Arquitectos / autores', description: 'Persones associades via Wikidata P84/P170', file: '_sprint_arquitectos_v2.cjs', estimated_min: 6 },
    { id: 'inception', label: '📅 Inception (any/segle construcció)', description: 'Data P571 inception', file: '_sprint_C_inception.cjs', estimated_min: 4 },
];

const { spawn } = require('child_process');
const path2 = require('path');

// In-memory registry. Cap persistència — si el server reinicia, taskes perduts.
const tasks = new Map(); // taskId → { sprintId, pid, status, startedAt, endedAt, log }
let _taskCounter = 0;

router.get('/sprints', (_, res) => {
    res.json({ sprints: SPRINTS });
});

router.get('/sprint-tasks', (_, res) => {
    const out = [...tasks.entries()].map(([id, t]) => ({
        task_id: id, sprint_id: t.sprintId, status: t.status,
        started_at: t.startedAt, ended_at: t.endedAt,
        log_lines: t.log.length, log_tail: t.log.slice(-20),
    })).sort((a, b) => b.started_at - a.started_at).slice(0, 20);
    res.json({ tasks: out });
});

router.get('/sprint-tasks/:taskId', (req, res) => {
    const t = tasks.get(req.params.taskId);
    if (!t) return res.status(404).json({ error: 'task not found' });
    res.json({
        task_id: req.params.taskId,
        sprint_id: t.sprintId,
        status: t.status,
        started_at: t.startedAt,
        ended_at: t.endedAt,
        pid: t.pid,
        log: t.log.slice(-200), // últims 200 lines
    });
});

router.post('/run-sprint', express.json({ limit: '1mb' }), (req, res) => {
    const sprintId = (req.body?.sprint_id || '').toString();
    const sprint = SPRINTS.find(s => s.id === sprintId);
    if (!sprint) return res.status(400).json({ error: `sprint_id desconegut. Disponibles: ${SPRINTS.map(s => s.id).join(', ')}` });

    // Evita llançar el mateix sprint si ja n'hi ha un running
    for (const [, t] of tasks) {
        if (t.sprintId === sprintId && t.status === 'running') {
            return res.status(409).json({ error: `Sprint '${sprintId}' ja s'està executant`, task_id: t.taskId });
        }
    }

    const taskId = `task_${++_taskCounter}_${Date.now()}`;
    const scriptPath = path2.join(__dirname, '..', '..', sprint.file);

    const child = spawn(process.execPath, [scriptPath], {
        cwd: path2.join(__dirname, '..', '..'),
        env: process.env,
    });

    const task = {
        sprintId, taskId, pid: child.pid,
        status: 'running',
        startedAt: Date.now(), endedAt: null,
        log: [`[START] ${new Date().toISOString()} pid=${child.pid} script=${sprint.file}`],
    };
    tasks.set(taskId, task);

    const onLine = (prefix) => (chunk) => {
        const text = chunk.toString();
        for (const line of text.split(/\r?\n/)) {
            if (line.trim()) task.log.push(`[${prefix}] ${line}`);
        }
        // Limita a 5000 línies per evitar OOM
        if (task.log.length > 5000) task.log = task.log.slice(-5000);
    };
    child.stdout.on('data', onLine('OUT'));
    child.stderr.on('data', onLine('ERR'));
    child.on('exit', (code, signal) => {
        task.status = code === 0 ? 'done' : 'failed';
        task.endedAt = Date.now();
        task.log.push(`[EXIT] code=${code} signal=${signal} duration_s=${Math.round((task.endedAt - task.startedAt) / 1000)}`);
    });
    child.on('error', (err) => {
        task.status = 'failed';
        task.endedAt = Date.now();
        task.log.push(`[ERROR] ${err.message}`);
    });

    res.json({ task_id: taskId, sprint_id: sprintId, pid: child.pid, status: 'running' });
});

// =============================================================
// POST /wikidata-lookup
// Cerca candidats a Wikidata per (denominacion + opcionalment coords).
// Útil per a INSERTs de nous bens: l'usuari pot triar el QID i, post-INSERT,
// l'enrichment automàtic omplirà descripcion, arquitecto, estilo, imatges.
//
// Body: { denominacion, lat?, lng?, radius_km?, languages? = ['es','ca','en'] }
// =============================================================
router.post('/wikidata-lookup', express.json({ limit: '1mb' }), async (req, res) => {
    const { denominacion, lat, lng, radius_km = 5, languages = ['es', 'ca', 'en', 'fr', 'pt'] } = req.body || {};
    if (!denominacion || String(denominacion).trim().length < 3) {
        return res.status(400).json({ error: 'denominacion massa curta (mín 3 caràcters)' });
    }
    const q = String(denominacion).trim().replace(/"/g, '\\"');
    const langClause = languages.map(l => `'${l}'`).join(',');
    const labelLangs = languages.join(',');

    // SPARQL principal: label exacte en qualsevol idioma + opcionalment coords properes
    const hasCoords = lat != null && lng != null && Number.isFinite(+lat) && Number.isFinite(+lng);
    let coordsClause = '';
    if (hasCoords) {
        // Busca dins d'una bounding box ample (radius_km arrodonit a graus aprox)
        const dDeg = (radius_km / 111.0);
        coordsClause = `
          ?item wdt:P625 ?coord .
          FILTER(geof:distance(?coord, "Point(${+lng} ${+lat})"^^geo:wktLiteral) < ${radius_km})
        `;
    }
    // SPARQL optimitzat: cerca per label exacte als idiomes principals.
    // El CONTAINS sobre tots els labels és inacceptable lent a Wikidata.
    // L'usuari potser cal posar el nom prou específic, sinó pot retornar 0.
    const sparql = hasCoords ? `
      # Amb coords: filtra primer per àrea (molt selectiu) i després per label
      SELECT DISTINCT ?item ?itemLabel ?itemDescription ?coord ?image ?instanceOfLabel WHERE {
        SERVICE wikibase:around {
          ?item wdt:P625 ?coord .
          bd:serviceParam wikibase:center "Point(${+lng} ${+lat})"^^geo:wktLiteral .
          bd:serviceParam wikibase:radius "${radius_km}" .
        }
        ?item rdfs:label ?lbl .
        FILTER(LANG(?lbl) IN (${langClause}))
        FILTER(CONTAINS(LCASE(STR(?lbl)), LCASE("${q.substring(0, 60)}")))
        OPTIONAL { ?item wdt:P18 ?image }
        OPTIONAL { ?item wdt:P31 ?instanceOf }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "${labelLangs}" }
      }
      LIMIT 15
    ` : `
      # Sense coords: només label exacte (ràpid via index)
      SELECT DISTINCT ?item ?itemLabel ?itemDescription ?coord ?image ?instanceOfLabel WHERE {
        { ?item rdfs:label "${q}"@es } UNION
        { ?item rdfs:label "${q}"@ca } UNION
        { ?item rdfs:label "${q}"@en }
        OPTIONAL { ?item wdt:P625 ?coord }
        OPTIONAL { ?item wdt:P18 ?image }
        OPTIONAL { ?item wdt:P31 ?instanceOf }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "${labelLangs}" }
      }
      LIMIT 15
    `;
    const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql);
    try {
        const r = await fetch(url, {
            headers: {
                'User-Agent': 'PatrimonioEuropeo-Integraciones/1.0 (webdepatrimonio@gmail.com)',
                'Accept': 'application/sparql-results+json',
            },
            // SPARQL Wikidata pot tardar. Límit 20s.
            signal: AbortSignal.timeout(20000),
        });
        if (!r.ok) {
            const txt = await r.text();
            return res.status(502).json({ error: `Wikidata SPARQL ${r.status}: ${txt.substring(0, 200)}` });
        }
        const data = await r.json();
        const candidates = (data.results?.bindings || []).map(b => {
            const itemUri = b.item?.value || '';
            const qid = itemUri.split('/').pop();
            return {
                qid,
                label: b.itemLabel?.value || null,
                description: b.itemDescription?.value || null,
                coord: b.coord?.value || null,
                image: b.image?.value || null,
                instance_of: b.instanceOfLabel?.value || null,
                wikipedia: `https://es.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(b.itemLabel?.value || qid)}`,
            };
        }).filter(c => c.qid && c.qid.startsWith('Q'));

        // Dedup per qid (la query UNION pot retornar duplicats)
        const seen = new Set();
        const unique = candidates.filter(c => seen.has(c.qid) ? false : seen.add(c.qid));

        res.json({ query: denominacion, has_coords: hasCoords, total: unique.length, candidates: unique.slice(0, 10) });
    } catch (e) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
            return res.status(504).json({ error: 'Wikidata SPARQL timeout (>20s). Prova amb un nom més específic.' });
        }
        res.status(502).json({ error: e.message });
    }
});

// =============================================================
// GET /sample-monument
// Retorna un bé real amb totes les taules joined, perquè l'usuari pugui
// veure quina info hi va a cada camp (per a mappings manuals informats).
// Tria un bien que tingui més registres complerts.
// =============================================================
router.get('/sample-monument', async (req, res) => {
    try {
        const r = await db.query(`
            SELECT b.id FROM bienes b
            JOIN wikidata w ON w.bien_id = b.id AND w.qid IS NOT NULL
                            AND w.descripcion IS NOT NULL AND w.estilo IS NOT NULL
            LEFT JOIN sipca s ON s.bien_id = b.id
            LEFT JOIN imagenes i ON i.bien_id = b.id
            WHERE b.denominacion IS NOT NULL AND b.municipio IS NOT NULL
              AND b.latitud IS NOT NULL AND w.arquitecto IS NOT NULL
              AND w.heritage_label IS NOT NULL
            ORDER BY b.id LIMIT 1
        `, []);
        if (!r.rows.length) return res.status(404).json({ error: 'Cap bien amb totes les taules complertes' });
        const bid = r.rows[0].id;
        const [bienes, wikidata, sipca, imagenes] = await Promise.all([
            db.query('SELECT * FROM bienes WHERE id = ?', [bid]),
            db.query('SELECT * FROM wikidata WHERE bien_id = ?', [bid]),
            db.query('SELECT * FROM sipca WHERE bien_id = ?', [bid]),
            db.query('SELECT * FROM imagenes WHERE bien_id = ? LIMIT 3', [bid]),
        ]);
        res.json({
            bien_id: bid,
            bienes: bienes.rows[0] || null,
            wikidata: wikidata.rows[0] || null,
            sipca: sipca.rows[0] || null,
            imagenes: imagenes.rows,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
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
