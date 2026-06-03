/**
 * API REST para Patrimonio Europeo
 * Endpoints para acceder a los datos de monumentos desde el frontend
 */
require('dotenv').config();

// Global error handlers — evitar que el proceso muera por errores no capturados
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message);
    console.error(err.stack);
    // No matamos el proceso, solo logueamos
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason);
    // No matamos el proceso, solo logueamos
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const db = require('./db.cjs');

// Multer: recibir archivos en memoria (sin escribir a disco)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB por archivo
});

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'patrimonio-europeo-secret-key-2026';
const JWT_EXPIRES_IN = '30d';

// ============== SECURITY MIDDLEWARE ==============

// CORS whitelist
const ALLOWED_ORIGINS = [
    'https://patrimonio-europeo.netlify.app',
    'https://patrimonio-europeo-v2.netlify.app',
    'https://shiny-licorice-a01ea4.netlify.app',
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : []),
];

// localhost/127.0.0.1 with any port is allowed (dev environments)
const isLocalhost = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const isAllowed = (origin) => ALLOWED_ORIGINS.includes(origin) || isLocalhost(origin);

// Block unauthorized origins (server-side enforcement, not just CORS headers)
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowed(origin)) {
        return res.status(403).json({ error: 'Origin not allowed' });
    }
    next();
});

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || isAllowed(origin)) return callback(null, true);
        callback(null, false);
    },
}));

// Security headers (disable CSP and COEP for JSON API compatibility)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

// Anti-bot: block known scraper user-agents
const BLOCKED_UA = /scrapy|python-urllib|wget|go-http-client|java\/|libwww-perl|httpclient|httpunit|phpcrawl/i;
app.use((req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    if (BLOCKED_UA.test(ua)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
});

// ============== IP BLOCKING + RATE LIMIT ALERTS ==============
// IPs que violan rate limits N veces consecutivas se bloquean temporalmente.
// Cuando una IP se bloquea, se envía email de alerta (vía Gmail SMTP existente).
// In-memory: se resetea con redeploy (suficiente para ataques cortos).

const RL_VIOLATIONS_WINDOW_MS = 10 * 60 * 1000;    // 10 min para contar violaciones
const RL_VIOLATIONS_TO_BLOCK = 10;                 // 10 violaciones consecutivas (no 3 — demasiado agresivo)
const RL_BLOCK_DURATION_MS = 30 * 60 * 1000;       // bloqueo de 30min (no 1h)
const HIT_ALERT_COOLDOWN_MS = 30 * 60 * 1000;      // 1 email "hit" cada 30min por IP
const BLOCK_ALERT_COOLDOWN_MS = 60 * 60 * 1000;    // 1 email "block" cada 1h por IP

const ipViolations = new Map(); // ip → { count, firstViolation, blockedUntil, lastHitAlertSent, lastBlockAlertSent }

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim()
        || req.headers['x-real-ip']
        || req.socket?.remoteAddress
        || 'unknown';
}

async function sendSecurityAlert(ip, reason, details = {}) {
    const recipient = process.env.SECURITY_ALERT_EMAIL || process.env.GMAIL_USER;
    if (!recipient || !process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        console.log(`[SECURITY] Alert skipped (no GMAIL config): ${reason} IP=${ip}`);
        return;
    }
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
            connectionTimeout: 10000,
            socketTimeout: 15000,
        });
        await transporter.sendMail({
            from: `"Patrimonio Europeo - Security" <${process.env.GMAIL_USER}>`,
            to: recipient,
            subject: `🚨 Security alert: ${reason}`,
            text: `Una IP ha sido bloqueada en el backend de Patrimonio Europeo.\n\n` +
                  `IP: ${ip}\n` +
                  `Razón: ${reason}\n` +
                  `Hora: ${new Date().toISOString()}\n` +
                  `Detalles: ${JSON.stringify(details, null, 2)}\n\n` +
                  `La IP estará bloqueada durante ${RL_BLOCK_DURATION_MS / 60000} minutos.\n` +
                  `Si crees que es un falso positivo, reinicia el backend para limpiar el bloqueo (in-memory).`,
        });
        console.log(`[SECURITY] Alert email sent to ${recipient} for IP=${ip}`);
    } catch (e) {
        console.error(`[SECURITY] Failed to send alert email: ${e.message}`);
    }
}

function recordViolation(ip, endpoint) {
    const now = Date.now();
    let v = ipViolations.get(ip);
    if (!v || now - v.firstViolation > RL_VIOLATIONS_WINDOW_MS) {
        v = { count: 0, firstViolation: now, blockedUntil: null, lastHitAlertSent: 0, lastBlockAlertSent: 0 };
    }
    v.count++;
    ipViolations.set(ip, v);
    console.log(`[SECURITY] Rate limit hit: IP=${ip} endpoint=${endpoint} count=${v.count}/${RL_VIOLATIONS_TO_BLOCK}`);

    // Alerta en cada violación (con cooldown 30min/IP). En uso normal NADIE debería
    // superar rate limit, por lo que cualquier violación es señal a investigar.
    if (now - v.lastHitAlertSent > HIT_ALERT_COOLDOWN_MS) {
        v.lastHitAlertSent = now;
        ipViolations.set(ip, v);
        sendSecurityAlert(ip, `Rate limit superado (${endpoint})`, {
            endpoint,
            violations_in_window: v.count,
            window_minutes: RL_VIOLATIONS_WINDOW_MS / 60000,
            will_block_at: RL_VIOLATIONS_TO_BLOCK,
        });
    }

    if (v.count >= RL_VIOLATIONS_TO_BLOCK && !v.blockedUntil) {
        v.blockedUntil = now + RL_BLOCK_DURATION_MS;
        ipViolations.set(ip, v);
        console.log(`[SECURITY] 🚫 IP BLOCKED: ${ip} until ${new Date(v.blockedUntil).toISOString()}`);
        if (now - v.lastBlockAlertSent > BLOCK_ALERT_COOLDOWN_MS) {
            v.lastBlockAlertSent = now;
            sendSecurityAlert(ip, '🚫 IP BLOQUEADA tras violaciones repetidas', {
                endpoint,
                violations: v.count,
                blocked_until: new Date(v.blockedUntil).toISOString(),
                block_duration_minutes: RL_BLOCK_DURATION_MS / 60000,
            });
        }
    }
}

// Middleware GLOBAL que comprueba bloqueo antes de cualquier route
app.use((req, res, next) => {
    const ip = getClientIp(req);
    const v = ipViolations.get(ip);
    if (v && v.blockedUntil && Date.now() < v.blockedUntil) {
        return res.status(429).json({
            error: 'IP temporally blocked due to suspicious activity',
            retry_after_ms: v.blockedUntil - Date.now(),
        });
    }
    next();
});

// Handler común para rate limiters: registra violación + bloqueo automático
function makeRateLimitHandler(endpointLabel) {
    return (req, res, next, options) => {
        recordViolation(getClientIp(req), endpointLabel);
        res.status(options.statusCode).json(options.message);
    };
}

// Rate limiting — general: 150 req/min per IP (frontend SPA hace muchos requests por navegación)
const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    handler: makeRateLimitHandler('general'),
    message: { error: 'Too many requests. Try again in a minute.' },
});
app.use('/api', generalLimiter);

// Rate limiting — bulk data endpoints: 60 req/min per IP (map + search + filtros disparan en bursts)
const dataLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: makeRateLimitHandler('data'),
    message: { error: 'Too many data requests. Try again in a minute.' },
});
app.use('/api/monumentos', dataLimiter);
app.use('/api/geojson', dataLimiter);
app.use('/api/ccaa-resumen', dataLimiter);
app.use('/api/municipios', dataLimiter);

// Rate limiting — auth endpoints: 10 req/min per IP (5 era agresivo, usuario con typo bloquea)
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: makeRateLimitHandler('auth'),
    message: { error: 'Too many auth attempts. Try again in a minute.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

app.use(express.json());

// ============== CLASIFICACION DE MONUMENTOS ==============

const CLASIFICACION_GRUPOS = {
    religiosa: ['Iglesia / Ermita', 'Catedral', 'Monasterio / Convento', 'Arte religioso', 'Mezquita / Sinagoga', 'Cruz / Crucero', 'Cementerio'],
    militar: ['Castillo / Fortaleza', 'Torre', 'Muralla'],
    civil: ['Edificio civil', 'Edificio histórico', 'Conjunto arquitectónico', 'Elemento arquitectónico', 'Palacio', 'Casa señorial / Mansión', 'Teatro', 'Museo', 'Monumento conmemorativo', 'Monumento'],
    arqueologica: ['Yacimiento arqueológico', 'Megalítico'],
    etnologica: ['Arquitectura rural', 'Molino', 'Patrimonio etnográfico'],
    infraestructura: ['Puente', 'Acueducto', 'Fuente', 'Faro', 'Obra hidráulica', 'Plaza de toros', 'Balneario / Termas', 'Patrimonio industrial'],
};

const ALL_CLASSIFIED_TIPOS = Object.values(CLASIFICACION_GRUPOS).flat();

// ============== NORMALIZACIÓN DE ESTILOS ==============
// Mapa: valor crudo (lowercase) → valor normalizado en español
const ESTILO_NORMALIZACION = {
    // Arquitectura popular
    'arquitectura popular': 'Arquitectura popular',
    'arquitetura vernacular': 'Arquitectura popular',
    'architecture vernaculaire': 'Arquitectura popular',
    // Barroco
    'arquitectura barroca': 'Barroco', 'architettura barocca': 'Barroco',
    'architecture baroque': 'Barroco', 'arquitetura barroca': 'Barroco',
    'barocco': 'Barroco', 'barroco': 'Barroco', 'arte barocca': 'Barroco',
    'architettura barocca italiana': 'Barroco', 'barocco siciliano': 'Barroco',
    'barocco napoletano': 'Barroco', 'barroco español': 'Barroco',
    'barroco português': 'Barroco', 'barroco joanino': 'Barroco',
    'barocco a milano': 'Barroco', 'barocco genovese': 'Barroco',
    'barocco leccese': 'Barroco', 'arquitectura barroca en españa': 'Barroco',
    'protobarroco': 'Barroco',
    // Románico
    'arquitectura románica': 'Románico', 'architettura romanica': 'Románico',
    'architecture romane': 'Románico', 'arte románico': 'Románico',
    'arte romanica': 'Románico', 'art roman': 'Románico',
    'arquitetura românica': 'Románico', 'romanico': 'Románico',
    'arte românica': 'Románico', 'romanico lombardo': 'Románico',
    'romanico pisano': 'Románico', 'romanico pugliese': 'Románico',
    'architettura romanica in italia': 'Románico', 'art roman provençal': 'Románico',
    'art roman auvergnat': 'Románico', 'art roman lombard': 'Románico',
    'arquitectura románica en españa': 'Románico', 'arte románico en cataluña': 'Románico',
    'arte románico en aragón': 'Románico', 'arquitetura românica em portugal': 'Románico',
    'románico gallego': 'Románico', 'románico asturiano': 'Románico',
    'romanico fiorentino': 'Románico', 'primer románico': 'Románico',
    'architettura romanica in sardegna': 'Románico',
    // Gótico
    'arquitectura gótica': 'Gótico', 'architettura gotica': 'Gótico',
    'architecture gothique': 'Gótico', 'arquitetura gótica': 'Gótico',
    'gotico': 'Gótico', 'estilo gótico': 'Gótico', 'arte gótico': 'Gótico',
    'escultura gótica': 'Gótico', 'architettura gotica italiana': 'Gótico',
    'gótico tardío': 'Gótico', 'tardo gotico': 'Gótico',
    'gótico flamígero': 'Gótico', 'gótico isabelino': 'Gótico',
    'gothique méridional': 'Gótico', 'gothique flamboyant': 'Gótico',
    'gótico valenciano': 'Gótico', 'gótico catalán': 'Gótico',
    'gótico internacional': 'Gótico', 'art gothique': 'Gótico',
    'gotico spagnolo': 'Gótico', 'gotico chiaramontano': 'Gótico',
    'gotico catalano': 'Gótico', 'gothique classique': 'Gótico',
    'gothique rayonnant': 'Gótico', 'architecture gothique française': 'Gótico',
    'protogótico': 'Gótico', 'gótico inicial': 'Gótico',
    'gothique catalan': 'Gótico', 'flamboyant': 'Gótico',
    'architettura gotica in abruzzo': 'Gótico', 'protogotico': 'Gótico',
    'arquitectura gótica en españa': 'Gótico',
    // Renacimiento
    'arquitectura del renacimiento': 'Renacimiento', 'architettura rinascimentale': 'Renacimiento',
    'architecture de la renaissance': 'Renacimiento', 'renacimiento': 'Renacimiento',
    'rinascimento': 'Renacimiento', 'arte del rinascimento': 'Renacimiento',
    'rinascimento italiano': 'Renacimiento', 'renacimiento español': 'Renacimiento',
    'renaissance': 'Renacimiento', 'renaissance française': 'Renacimiento',
    'architecture renaissance française': 'Renacimiento', 'style renaissance': 'Renacimiento',
    'arquitetura do renascimento': 'Renacimiento', 'renascimento': 'Renacimiento',
    'rinascimento ferrarese': 'Renacimiento', 'rinascimento lombardo': 'Renacimiento',
    'alto rinascimento': 'Renacimiento', 'arquitectura renacentista española': 'Renacimiento',
    'arquitectura renacentista de zaragoza': 'Renacimiento',
    // Neoclásico
    'arquitectura neoclásica': 'Neoclásico', 'architettura neoclassica': 'Neoclásico',
    'architecture néoclassique': 'Neoclásico', 'neoclasicismo': 'Neoclásico',
    'neoclassicismo': 'Neoclásico', 'neoclassicalism': 'Neoclásico',
    'arquitetura neoclássica': 'Neoclásico', 'neoclassicismo a milano': 'Neoclásico',
    'néo-classicisme': 'Neoclásico', 'architettura neoclassica italiana': 'Neoclásico',
    'architecture néoclassique en france': 'Neoclásico', 'architettura classica': 'Neoclásico',
    'classicisme': 'Neoclásico', 'classicismo': 'Neoclásico',
    'clasicismo': 'Neoclásico', 'academicismo': 'Neoclásico',
    // Modernismo / Art Nouveau
    'arquitectura modernista': 'Modernismo', 'architettura art nouveau': 'Modernismo',
    'architecture art nouveau': 'Modernismo', 'arquitectura art nouveau': 'Modernismo',
    'arquitetura modernista': 'Modernismo', 'modernismo': 'Modernismo',
    'modernismo catalán': 'Modernismo', 'modernismo valenciano': 'Modernismo',
    'stile liberty': 'Modernismo', 'liberty a milano': 'Modernismo',
    'modernismo em portugal': 'Modernismo', 'architettura liberty in italia': 'Modernismo',
    'arquitectura modernista del bajo aragón': 'Modernismo',
    // Ecléctico
    'ecléctico': 'Ecléctico', 'eclettismo': 'Ecléctico',
    'eclecticismo': 'Ecléctico', 'éclectisme': 'Ecléctico',
    'arquitetura eclética': 'Ecléctico', 'architettura eclettica': 'Ecléctico',
    'éclectisme égyptien': 'Ecléctico',
    // Mudéjar
    'arquitectura mudéjar': 'Mudéjar', 'arte mudéjar': 'Mudéjar',
    'neomudéjar': 'Mudéjar', 'arquitectura mudéjar de aragón': 'Mudéjar',
    // Medieval
    'arquitectura medieval': 'Medieval', 'architettura medievale': 'Medieval',
    'architecture médiévale': 'Medieval', 'arquitetura da idade média': 'Medieval',
    'medioevo': 'Medieval',
    // Manierismo
    'manierismo': 'Manierismo', 'maneirismo': 'Manierismo',
    'architettura manierista': 'Manierismo', 'arquitectura maneirista': 'Manierismo',
    'arquitectura manierista': 'Manierismo', 'architecture maniériste': 'Manierismo',
    // Art Déco
    'art déco': 'Art Déco', 'arquitectura art déco': 'Art Déco',
    'architecture art déco': 'Art Déco', 'art déco valenciano': 'Art Déco',
    // Racionalismo
    'racionalismo': 'Racionalismo', 'razionalismo italiano': 'Racionalismo',
    'razionalismo lariano': 'Racionalismo', 'racionalismo valenciano': 'Racionalismo',
    'fonctionnalisme': 'Racionalismo', 'funcionalismo': 'Racionalismo',
    // Movimiento Moderno
    'movimiento moderno': 'Movimiento Moderno', 'movimento moderno': 'Movimiento Moderno',
    'mouvement moderne': 'Movimiento Moderno', 'arquitectura moderna': 'Movimiento Moderno',
    // Historicismo
    'arquitectura historicista': 'Historicismo', 'arquitetura historicista': 'Historicismo',
    'historicismo': 'Historicismo',
    // Rococó
    'rococó': 'Rococó', 'rococò': 'Rococó', 'architettura rococò': 'Rococó',
    'arquitetura rococó': 'Rococó', 'arquitectura rococó': 'Rococó', 'rococo': 'Rococó',
    // Neogótico
    'arquitectura neogótica': 'Neogótico', 'architettura neogotica': 'Neogótico',
    'style néogothique': 'Neogótico', 'neogótico': 'Neogótico',
    // Neorrománico
    'architettura neoromanica': 'Neorrománico', 'style néo-roman': 'Neorrománico',
    'neorromânico': 'Neorrománico',
    // Neobarroco
    'neobarroco': 'Neobarroco', 'architettura neobarocca': 'Neobarroco',
    // Neorrenacentista
    'architettura neorinascimentale': 'Neorrenacentista',
    'architecture néo-renaissance': 'Neorrenacentista',
    // Prerrománico
    'arquitectura prerrománica': 'Prerrománico', 'arte prerrománico': 'Prerrománico',
    'architettura preromanica': 'Prerrománico', 'art préroman': 'Prerrománico',
    'arte preromanica': 'Prerrománico', 'arte asturiano': 'Prerrománico',
    'architecture préromane de tradition wisigothique': 'Prerrománico',
    'arte de repoblación': 'Prerrománico', 'iglesias de repoblación': 'Prerrománico',
    // Paleocristiano
    'arte paleocristiana': 'Paleocristiano', 'arte paleocristiano': 'Paleocristiano',
    'architettura paleocristiana': 'Paleocristiano',
    'architecture paléochrétienne': 'Paleocristiano', 'arquitectura paleocristiana': 'Paleocristiano',
    // Islámico
    'arquitectura islámica': 'Islámico', 'arte emiral y califal': 'Islámico',
    'arte andalusí': 'Islámico', 'arquitectura nazarí': 'Islámico',
    'arte taifa': 'Islámico', 'arquitectura almohade en españa': 'Islámico',
    'imperio almohade': 'Islámico', 'arquitetura islâmica': 'Islámico',
    'arquitectura neoárabe': 'Islámico', 'arquitectura morisca': 'Islámico',
    'arquitetura mourisca': 'Islámico', 'architecture néo-mauresque': 'Islámico',
    'estilo neoislâmico': 'Islámico', 'arquitectura árabe': 'Islámico',
    // Romano
    'arquitectura de la antigua roma': 'Romano', 'architettura romana': 'Romano',
    'architecture romaine': 'Romano', 'arquitetura da roma antiga': 'Romano',
    'antigua roma': 'Romano',
    // Bizantino
    'architettura bizantina': 'Bizantino', 'architettura neobizantina': 'Bizantino',
    'architecture néo-byzantine': 'Bizantino', 'arquitectura neobizantina': 'Bizantino',
    'arte bizantina': 'Bizantino', 'arquitetura neobizantina': 'Bizantino',
    // Cisterciense
    'arte cisterciense': 'Cisterciense', 'architettura cistercense': 'Cisterciense',
    'art cistercien': 'Cisterciense',
    // Herreriano
    'arquitectura herreriana': 'Herreriano',
    // Manuelino
    'estilo manuelino': 'Manuelino', 'estilo neomanuelino': 'Manuelino',
    // Plateresco
    'plateresco': 'Plateresco', 'arquitectura neoplateresca': 'Plateresco',
    'estilo cisneros': 'Plateresco',
    // Brutalismo
    'brutalismo': 'Brutalismo', 'brutalisme': 'Brutalismo',
    'arquitetura brutalista': 'Brutalismo',
    // Novecentismo
    'novecentismo': 'Novecentismo', 'novecento': 'Novecentismo',
    // Mozárabe
    'arte mozárabe': 'Mozárabe', 'arquitectura mozárabe': 'Mozárabe', 'mozárabe': 'Mozárabe',
    // Visigodo
    'arquitectura visigoda': 'Visigodo', 'arquitectura visigótica': 'Visigodo',
    'arte visigótica': 'Visigodo',
    // Normando
    'architettura normanna': 'Normando', 'architettura normanna in sicilia': 'Normando',
    'architettura arabo-normanna': 'Normando', 'architecture normande': 'Normando',
    'normanno': 'Normando',
    // Palladianismo
    'palladianesimo': 'Palladianismo', 'palladianismo': 'Palladianismo',
    'palladianisme': 'Palladianismo',
    // Clasicismo francés
    'architecture classique': 'Clasicismo francés', 'style second empire': 'Clasicismo francés',
    'style empire': 'Clasicismo francés', 'style louis xiii': 'Clasicismo francés',
    'style louis xiv': 'Clasicismo francés', 'style louis xv': 'Clasicismo francés',
    'style louis xvi': 'Clasicismo francés', 'stile impero': 'Clasicismo francés',
    'estilo segundo imperio': 'Clasicismo francés', 'style directoire': 'Clasicismo francés',
    // Beaux-Arts
    'beaux-arts': 'Beaux-Arts', 'style beaux-arts': 'Beaux-Arts', 'beaux arts': 'Beaux-Arts',
    // Industrial
    'architettura industriale': 'Industrial', 'arquitetura industrial': 'Industrial',
    'arquitectura industrial': 'Industrial', 'arquitectura en hierro': 'Industrial',
    // Estilos portugueses
    'estilo português suave': 'Estilo Portugués Suave', 'estilo chão': 'Estilo Portugués Suave',
    'estilo pombalino': 'Estilo Portugués Suave',
    // Monumentalismo
    'monumentalismo': 'Monumentalismo', 'architettura fascista': 'Monumentalismo',
    'stile littorio': 'Monumentalismo',
    // Neovasco
    'neovasco': 'Neovasco', 'style néobasque': 'Neovasco',
    // Romanticismo
    'romanticismo': 'Romanticismo', 'romantic architecture': 'Romanticismo',
    'arte romantica': 'Romanticismo', 'romantismo': 'Romanticismo',
    // Regionalismo
    'arquitectura regionalista': 'Regionalismo', 'regionalismo': 'Regionalismo',
    'régionalisme': 'Regionalismo',
    // Longobardo
    'architettura longobarda': 'Longobardo',
    // Estilo Internacional
    'estilo internacional': 'Estilo Internacional', 'international style': 'Estilo Internacional',
};

// Valores a excluir (no son estilos arquitectónicos)
const ESTILO_EXCLUIR = new Set([
    'carl junker', 'antonio foschini', 'ars arquitectos',
    'bien cultural de interés local', 'tipo z', 'tipo b',
    'iglesia matriz', 'militar', 'fortaleza', 'fortificación',
    'tejado a cuatro aguas', 'tejado a dos aguas', 'ingles',
]);

// Normalización de religiones a categorías macro
// Mapa: cualquier label raw (lowercased y trim) → categoría
const RELIGION_MACRO_MAP = (() => {
    const m = new Map();
    const add = (cat, ...labels) => labels.forEach(l => m.set(l.toLowerCase().trim(), cat));
    add('Catolicismo',
        'catolicismo', 'iglesia católica', 'católico latino', 'católico', 'iglesia latina',
        'catolicismo tradicionalista', 'iglesia católica en francia', 'rito romano',
        'rito ambrosiano', 'catolicismo n° 140, agosto de 1962',
        'orden de san agustín', 'orden de la inmaculada concepción', 'orden del císter',
        'iglesia católica armenia');
    add('Cristianismo ortodoxo',
        'cristianismo ortodoxo', 'iglesia ortodoxa', 'iglesia ortodoxa rumana',
        'iglesia ortodoxa rusa', 'iglesia ortodoxa copta', 'iglesia apostólica armenia',
        'iglesia greco-católica ucraniana', 'iglesia greco-católica melquita',
        'rito bizantino');
    add('Protestantismo',
        'protestantismo', 'luteranismo', 'anglicanismo', 'calvinismo', 'presbiterianismo',
        'iglesia de inglaterra', 'iglesia episcopal en los estados unidos',
        'iglesia protestante unida de francia', 'iglesia española reformada episcopal',
        'iglesia evangélica española', 'la iglesia de jesucristo de los santos de los últimos días',
        'protestant church of augsburg confession of alsace and lorraine',
        'evangelical lutheran church – synod of france and belgium',
        'església reformada suissa');
    add('Cristianismo', 'cristianismo', 'cristianismo primitivo');
    add('Judaísmo', 'judaísmo');
    add('Islam', 'islam');
    add('Hinduismo', 'hinduismo');
    add('Budismo', 'budismo', 'budismo tibetano');
    add('Sijismo', 'sijismo', 'sijismo en españa');
    add('Bahaísmo', 'bahaísmo');
    add('Religiones antiguas', 'mitraísmo', 'politeismo celta', 'religión de la antigua roma');
    return m;
})();

// Mapa inverso: categoría macro → array de labels raw originales
const RELIGION_MACRO_TO_RAW = (() => {
    const inv = new Map();
    for (const [raw, macro] of RELIGION_MACRO_MAP.entries()) {
        if (!inv.has(macro)) inv.set(macro, []);
        inv.get(macro).push(raw);
    }
    return inv;
})();

// Dado un valor de filtro (puede ser una macro como "Catolicismo" o un valor raw),
// devuelve el array de labels raw a buscar en BD
function expandirReligionParaFiltro(filtroValor) {
    if (!filtroValor) return [];
    const variantes = RELIGION_MACRO_TO_RAW.get(filtroValor);
    if (variantes && variantes.length > 0) return variantes;
    // No es macro → buscar el valor tal cual (case-insensitive vs BD)
    return [filtroValor.toLowerCase().trim()];
}

function normalizarReligiones(rawRows) {
    const agrupados = {};
    for (const row of rawRows) {
        const key = (row.value || '').toLowerCase().trim();
        const macro = RELIGION_MACRO_MAP.get(key) || (row.value.charAt(0).toUpperCase() + row.value.slice(1));
        if (!agrupados[macro]) agrupados[macro] = 0;
        agrupados[macro] += parseInt(row.count, 10) || 0;
    }
    return Object.entries(agrupados)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
}

function normalizarEstilos(rawRows) {
    const agrupados = {};
    for (const row of rawRows) {
        const key = row.value.toLowerCase();
        if (ESTILO_EXCLUIR.has(key) || /^q\d+$/.test(key)) continue;
        const normalizado = ESTILO_NORMALIZACION[key]
            || row.value.charAt(0).toUpperCase() + row.value.slice(1);
        if (!agrupados[normalizado]) {
            agrupados[normalizado] = { value: normalizado, count: 0 };
        }
        agrupados[normalizado].count += parseInt(row.count, 10);
    }
    return Object.values(agrupados).sort((a, b) => b.count - a.count);
}

function applyClasificacionFilter(clasificacion, where, params, piRef) {
    // Soporta valor único ("religiosa") o múltiples separados por comas ("religiosa,militar")
    const keys = String(clasificacion).split(',').map(s => s.trim()).filter(Boolean);
    if (keys.length === 0) return;

    const includeOtros = keys.includes('otros');
    const tiposExplicitos = new Set();
    for (const k of keys) {
        if (k === 'otros') continue;
        const valores = CLASIFICACION_GRUPOS[k];
        if (valores) valores.forEach(v => tiposExplicitos.add(v));
    }

    const tiposArr = Array.from(tiposExplicitos);
    const conditions = [];

    if (tiposArr.length > 0) {
        const placeholders = tiposArr.map(() => `$${piRef.value++}`);
        conditions.push(`b.tipo_monumento IN (${placeholders.join(',')})`);
        params.push(...tiposArr);
    }

    if (includeOtros) {
        const placeholders = ALL_CLASSIFIED_TIPOS.map(() => `$${piRef.value++}`);
        conditions.push(`(b.tipo_monumento IS NULL OR b.tipo_monumento NOT IN (${placeholders.join(',')}))`);
        params.push(...ALL_CLASSIFIED_TIPOS);
    }

    if (conditions.length === 1) {
        where.push(conditions[0]);
    } else if (conditions.length > 1) {
        where.push(`(${conditions.join(' OR ')})`);
    }
}

// ============== AUTH MIDDLEWARE ==============

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    let token = null;
    if (header && header.startsWith('Bearer ')) {
        token = header.split(' ')[1];
    } else if (req.query.token) {
        token = req.query.token;
    }
    if (!token) {
        return res.status(401).json({ error: 'Token requerido' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

function optionalAuth(req, res, next) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        try {
            const token = header.split(' ')[1];
            req.user = jwt.verify(token, JWT_SECRET);
        } catch (err) { /* ignore */ }
    }
    next();
}

function generarToken(usuario) {
    return jwt.sign(
        { id: usuario.id, email: usuario.email, rol: usuario.rol || 'user' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

async function adminMiddleware(req, res, next) {
    try {
        const usuario = await db.obtenerUsuarioPorId(req.user.id);
        if (!usuario || usuario.rol !== 'admin') {
            return res.status(403).json({ error: 'Acceso denegado: se requiere rol admin' });
        }
        req.user.rol = usuario.rol;
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function premiumMiddleware(req, res, next) {
    try {
        const usuario = await db.obtenerUsuarioPorId(req.user.id);
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
        const isPremium = usuario.premium && (!usuario.premium_hasta || new Date(usuario.premium_hasta) > new Date());
        if (!isPremium && usuario.rol !== 'admin') {
            return res.status(403).json({ error: 'Función premium requerida', code: 'PREMIUM_REQUIRED' });
        }
        req.isPremium = true;
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ============== AUTH ENDPOINTS ==============

/**
 * POST /api/auth/register
 * Registro con email y contraseña
 */
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, nombre, idioma_por_defecto } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        const existing = await db.obtenerUsuarioPorEmail(email);
        if (existing) {
            return res.status(409).json({ error: 'Ya existe un usuario con este email' });
        }

        const password_hash = bcrypt.hashSync(password, 12);
        const result = await db.crearUsuario({
            email,
            password_hash,
            nombre: nombre || null,
            idioma_por_defecto: idioma_por_defecto || 'es',
            google_id: null,
            avatar_url: null,
        });

        const usuario = await db.obtenerUsuarioPorId(result.lastInsertRowid);
        const token = generarToken(usuario);

        res.status(201).json({ token, user: usuario });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/auth/login
 * Login con email y contraseña
 */
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
        }

        const usuario = await db.obtenerUsuarioPorEmail(email);
        if (!usuario) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        if (!usuario.password_hash) {
            return res.status(401).json({ error: 'Esta cuenta usa login con Google' });
        }

        const valid = bcrypt.compareSync(password, usuario.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        await db.actualizarUsuario(usuario.id, { last_login: new Date().toISOString() });
        await db.registrarLogin(usuario.id, 'email');
        const token = generarToken(usuario);
        const user = await db.obtenerUsuarioPorId(usuario.id);

        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/auth/google
 * Login/registro con Google (recibe token de Google ID)
 */
app.post('/api/auth/google', async (req, res) => {
    try {
        const { credential, email, name, picture, googleId, idioma_por_defecto } = req.body;

        if (!email || !googleId) {
            return res.status(400).json({ error: 'Datos de Google incompletos' });
        }

        let usuario = await db.obtenerUsuarioPorGoogleId(googleId);

        if (!usuario) {
            // Check if email already exists (merge account)
            usuario = await db.obtenerUsuarioPorEmail(email);
            if (usuario) {
                // Link Google to existing account
                await db.query(
                    'UPDATE usuarios SET google_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?',
                    [googleId, picture || null, usuario.id]
                );
            } else {
                // Create new user
                const result = await db.crearUsuario({
                    email,
                    password_hash: null,
                    nombre: name || null,
                    idioma_por_defecto: idioma_por_defecto || 'es',
                    google_id: googleId,
                    avatar_url: picture || null,
                });
                usuario = await db.obtenerUsuarioPorId(result.lastInsertRowid);
            }
        }

        await db.actualizarUsuario(usuario.id, {
            last_login: new Date().toISOString(),
            avatar_url: picture || usuario.avatar_url,
        });
        await db.registrarLogin(usuario.id, 'google');

        const user = await db.obtenerUsuarioPorId(usuario.id);
        const token = generarToken(user);

        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/auth/me
 * Obtener datos del usuario actual
 */
app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const user = await db.obtenerUsuarioPorId(req.user.id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/auth/me
 * Actualizar perfil (nombre, idioma)
 */
app.put('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const { nombre, idioma_por_defecto } = req.body;
        const updates = {};
        if (nombre !== undefined) updates.nombre = nombre;
        if (idioma_por_defecto !== undefined) updates.idioma_por_defecto = idioma_por_defecto;

        await db.actualizarUsuario(req.user.id, updates);
        const user = await db.obtenerUsuarioPorId(req.user.id);
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== CHANGE PASSWORD ==============

/**
 * PUT /api/auth/me/password
 * Cambiar contraseña (cuenta con email/password)
 */
app.put('/api/auth/me/password', authMiddleware, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Contraseña actual y nueva son obligatorias' });
        }
        if (new_password.length < 6) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
        }

        const usuario = await db.obtenerUsuarioPorEmail(req.user.email);
        if (!usuario || !usuario.password_hash) {
            return res.status(400).json({ error: 'Esta cuenta no tiene contraseña (usa login con Google)' });
        }

        const valid = bcrypt.compareSync(current_password, usuario.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
        }

        const new_hash = bcrypt.hashSync(new_password, 12);
        await db.actualizarUsuario(usuario.id, { password_hash: new_hash });

        res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== ADMIN ENDPOINTS ==============

/**
 * GET /api/admin/usuarios
 * Lista de usuarios con paginación y filtros (solo admin)
 */
app.get('/api/admin/usuarios', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const search = req.query.search || undefined;
        const rol = req.query.rol || undefined;
        const premium = req.query.premium || undefined;

        const result = await db.obtenerUsuarios({ page, limit, search, rol, premium });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/admin/usuarios/:id/rol
 * Cambiar rol de un usuario (solo admin)
 */
app.patch('/api/admin/usuarios/:id/rol', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rol } = req.body;
        if (!['user', 'admin', 'colaborador'].includes(rol)) {
            return res.status(400).json({ error: 'Rol inválido. Valores permitidos: user, admin, colaborador' });
        }

        const userId = parseInt(req.params.id);
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
        }

        const usuario = await db.obtenerUsuarioPorId(userId);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        await db.actualizarUsuario(userId, { rol });
        const updated = await db.obtenerUsuarioPorId(userId);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/admin/usuarios/:id/premium
 * Cambiar estado premium de un usuario (solo admin)
 */
app.patch('/api/admin/usuarios/:id/premium', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { premium, premium_hasta } = req.body;
        if (typeof premium !== 'boolean') {
            return res.status(400).json({ error: 'El campo premium debe ser true o false' });
        }

        const userId = parseInt(req.params.id);
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'No puedes modificar tu propio estado premium' });
        }

        const usuario = await db.obtenerUsuarioPorId(userId);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const updateData = { premium };
        if (premium_hasta !== undefined) {
            updateData.premium_hasta = premium_hasta;
        }

        await db.actualizarUsuario(userId, updateData);
        const updated = await db.obtenerUsuarioPorId(userId);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== ADMIN ANALYTICS ENDPOINTS ==============

/**
 * POST /api/admin/chat
 * MVP zero-cost RAG: busca monumentos relevantes a la pregunta + llama a Groq con contexto
 * Si no hay GROQ_API_KEY, devuelve solo los monumentos relevantes (modo "fuentes sin LLM")
 */
const STOPWORDS_ES = new Set(['el','la','los','las','un','una','de','del','en','y','o','que','a','por','con','para','sobre','este','esta','ese','esa','qué','quién','cómo','cuándo','dónde','hay','tienen','tiene']);

function extraerPalabrasClave(question) {
    return question
        .toLowerCase()
        .replace(/[¿?¡!.,;:()"']/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOPWORDS_ES.has(w));
}

async function buscarMonumentosRelevantes(question, limit = 5) {
    const palabras = extraerPalabrasClave(question);
    if (palabras.length === 0) return [];

    // 1. Buscar en aliases (BD search) — devuelve set de bien_ids
    let bienIdsDesdeAlias = [];
    const searchPool = db.getSearchPool();
    if (searchPool) {
        try {
            const aliasConds = palabras.map((_, i) => `alias ILIKE $${i + 1}`).join(' OR ');
            const aliasParams = palabras.map(p => `%${p}%`);
            aliasParams.push(question);
            const idxQ = aliasParams.length;
            const aRes = await searchPool.query(`
                SELECT bien_id, MAX(similarity(LOWER(alias), LOWER($${idxQ}))) AS sim
                FROM bien_aliases WHERE ${aliasConds}
                GROUP BY bien_id ORDER BY sim DESC LIMIT ${limit * 3}
            `, aliasParams);
            bienIdsDesdeAlias = aRes.rows.map(r => ({ id: r.bien_id, sim: r.sim }));
        } catch (e) { console.error('alias search error:', e.message); }
    }

    // 2. Match en BD primaria: denominacion + municipio/provincia/comarca + bien_personas.nombre
    const ilikeConds = palabras.map((_, i) => `b.denominacion ILIKE $${i + 1}`).join(' OR ');
    const geoConds = palabras.map((_, i) => `(b.municipio ILIKE $${i + 1} OR b.provincia ILIKE $${i + 1} OR b.comarca ILIKE $${i + 1})`).join(' OR ');
    const personaConds = palabras.map((_, i) => `bp.nombre ILIKE $${i + 1}`).join(' OR ');
    const params = palabras.map(p => `%${p}%`);
    const qParamIdx = params.length + 1;
    params.push(question);

    let aliasUnion = '';
    if (bienIdsDesdeAlias.length > 0) {
        const aliasIds = bienIdsDesdeAlias.map(x => x.id).join(',');
        aliasUnion = `UNION SELECT id, sim, 'alias' AS via FROM (VALUES ${
            bienIdsDesdeAlias.map(x => `(${x.id}::int, ${(x.sim || 0.4).toFixed(3)}::float)`).join(',')
        }) AS t(id, sim)`;
    }

    const r = await db.query(`
        WITH matches AS (
            -- Match en denominación (peso alto via similarity real)
            SELECT b.id, similarity(LOWER(b.denominacion), LOWER($${qParamIdx})) AS sim, 'denom' AS via
            FROM bienes b WHERE ${ilikeConds}
            UNION
            -- Match en municipio/provincia/comarca (peso medio - solo si alguna palabra coincide con denom o persona)
            SELECT b.id, 0.35 AS sim, 'geo' AS via
            FROM bienes b WHERE ${geoConds}
            UNION
            -- Match en persona asociada
            SELECT DISTINCT bp.bien_id AS id,
                   GREATEST(similarity(LOWER(bp.nombre), LOWER($${qParamIdx})), 0.4) AS sim,
                   'persona' AS via
            FROM bien_personas bp WHERE ${personaConds}
            ${aliasUnion}
        ),
        -- Bonus: si un bien aparece en múltiples fuentes, sumar score
        ranked AS (
            SELECT id,
                   MAX(sim) + (COUNT(DISTINCT via) - 1) * 0.15 AS sim,
                   STRING_AGG(DISTINCT via, ',' ORDER BY via) AS via_list
            FROM matches GROUP BY id
            ORDER BY 2 DESC
            LIMIT ${limit * 3}
        )
        SELECT b.id, b.denominacion, b.municipio, b.provincia, b.pais,
               b.tipo_monumento, b.periodo, b.latitud, b.longitud,
               b.heritage_world,
               w.qid, w.wikipedia_url, w.descripcion AS wd_desc,
               w.arquitecto, w.estilo AS wd_estilo, w.material, w.altura, w.superficie,
               w.inception, w.heritage_label,
               w.religion, w.dedicado_a, w.parte_de, w.propietario,
               r.sim, r.via_list
        FROM ranked r
        JOIN bienes b ON b.id = r.id
        LEFT JOIN wikidata w ON b.id = w.bien_id
        ORDER BY r.sim DESC
    `, params);

    return r.rows.slice(0, limit).map(row => ({
        bien_id: row.id,
        denominacion: row.denominacion,
        municipio: row.municipio,
        provincia: row.provincia,
        pais: row.pais,
        tipo_monumento: row.tipo_monumento,
        periodo: row.periodo,
        latitud: row.latitud,
        longitud: row.longitud,
        heritage_world: row.heritage_world,
        qid: row.qid,
        wikipedia_url: row.wikipedia_url,
        wd_desc: row.wd_desc,
        arquitecto: row.arquitecto,
        wd_estilo: row.wd_estilo,
        material: row.material,
        altura: row.altura,
        superficie: row.superficie,
        inception: row.inception,
        heritage_label: row.heritage_label,
        religion: row.religion,
        dedicado_a: row.dedicado_a,
        parte_de: row.parte_de,
        propietario: row.propietario,
        similarity: row.sim,
        via: row.via_list,
    }));
}

async function obtenerAliasesYEventos(bienIds) {
    const result = { aliases: {}, eventos: {} };
    if (bienIds.length === 0) return result;

    const searchPool = db.getSearchPool();
    if (searchPool) {
        try {
            const aRes = await searchPool.query(`
                SELECT bien_id, alias, lang FROM bien_aliases
                WHERE bien_id = ANY($1::int[]) AND es_principal = FALSE
                ORDER BY bien_id, lang
            `, [bienIds]);
            for (const r of aRes.rows) {
                if (!result.aliases[r.bien_id]) result.aliases[r.bien_id] = [];
                result.aliases[r.bien_id].push(`${r.alias} (${r.lang})`);
            }
        } catch (e) { console.error('aliases lookup:', e.message); }
    }

    try {
        const eRes = await db.query(`
            SELECT bien_id, evento, qid_evento_padre FROM eventos_monumento
            WHERE bien_id = ANY($1::int[])
            ORDER BY bien_id
        `, [bienIds]);
        for (const r of eRes.rows) {
            if (!result.eventos[r.bien_id]) result.eventos[r.bien_id] = [];
            result.eventos[r.bien_id].push(r.evento);
        }
    } catch (e) { console.error('eventos lookup:', e.message); }

    return result;
}

async function obtenerExtractoWiki(bien_id, lang = 'es') {
    try {
        const enrPool = db.getEnrichmentPool ? db.getEnrichmentPool(lang) : null;
        if (!enrPool) return null;
        const r = await enrPool.query(
            `SELECT extract, full_text FROM wikipedia_extracts WHERE bien_id = $1`,
            [bien_id]
        );
        return r.rows[0] || null;
    } catch { return null; }
}

// ===== TOOLS para function calling =====
const CHAT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'buscar_por_filtros',
            description: 'Busca monumentos en el catálogo aplicando filtros estructurados. Útil para preguntas como "castillos del s.XV en España", "iglesias mudéjares en Aragón", "monumentos UNESCO en Cataluña".',
            parameters: {
                type: 'object',
                properties: {
                    pais: { type: 'string', description: 'País: España, Italia, Francia, Portugal' },
                    region: { type: 'string', description: 'Comunidad autónoma o región (Cataluña, Aragón, Andalucía, Toscana, etc.)' },
                    provincia: { type: 'string' },
                    comarca: { type: 'string', description: 'Comarca (en Cataluña: Alt Penedès, Conca de Barberà, Garrotxa, Empordà, Selva, etc.). Solo disponible en Cataluña por ahora.' },
                    municipio: { type: 'string' },
                    tipo_monumento: { type: 'string', description: 'Tipo exacto: Castillo / Fortaleza, Iglesia / Ermita, Catedral, Monasterio / Convento, Palacio, Casa señorial / Mansión, Yacimiento arqueológico, Megalítico, Torre, Muralla, Puente, Acueducto, Faro, Molino, Cruz / Crucero, etc.' },
                    periodo: { type: 'string', description: 'Periodo: Prehistoria, Antiguo / Romano, Prerrománico, Románico, Gótico, Mudéjar, Mozárabe, Renacimiento, Barroco, Neoclásico, Modernismo, Contemporáneo' },
                    estilo: { type: 'string' },
                    religion: { type: 'string', description: 'Catolicismo, Cristianismo ortodoxo, Protestantismo, Islam, Judaísmo, Budismo, etc.' },
                    dedicado_a: { type: 'string', description: 'Advocación o dedicatoria (Virgen María, Santiago el Mayor, San Pedro, etc.)' },
                    parte_de: { type: 'string', description: 'Conjunto al que pertenece (Camino de Santiago, Red Natura 2000, etc.)' },
                    propietario: { type: 'string' },
                    heritage_world: { type: 'string', enum: ['unesco', 'european'], description: 'unesco = Patrimonio Mundial UNESCO; european = European Heritage Label' },
                    limit: { type: 'integer', description: 'Máximo de resultados (1-15)', default: 10 },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'buscar_por_persona',
            description: 'Busca monumentos asociados a una persona (arquitecto, escultor, autor, creador). Útil para preguntas como "obras de Gaudí", "quién es Cañas", "esculturas de Mariano Benlliure".',
            parameters: {
                type: 'object',
                properties: {
                    nombre: { type: 'string', description: 'Nombre o apellido de la persona' },
                    limit: { type: 'integer', default: 10 },
                },
                required: ['nombre'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'buscar_por_texto',
            description: 'Búsqueda textual fuzzy en nombres de monumentos. Usa esta cuando el usuario pregunte por un monumento concreto o no esté claro qué filtros aplicar.',
            parameters: {
                type: 'object',
                properties: {
                    texto: { type: 'string', description: 'Palabras clave o nombre del monumento' },
                    limit: { type: 'integer', default: 8 },
                },
                required: ['texto'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'info_monumento',
            description: 'Obtiene la ficha completa de UN monumento por su id (incluye descripción Wikipedia, personas asociadas, propiedades). Usa cuando el usuario te dé un #id concreto o pida profundizar en uno.',
            parameters: {
                type: 'object',
                properties: {
                    bien_id: { type: 'integer' },
                },
                required: ['bien_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'buscar_por_descripcion',
            description: 'Busca monumentos cuyo TEXTO Wikipedia menciona ciertos conceptos. Imprescindible para comarcas catalanas (Conca de Barberà, Penedès, Empordà), referencias históricas, contexto geográfico ampliado, o palabras clave que NO aparecen en el nombre del monumento. Ej: "Conca de Barberà", "ruta del Cister", "época visigoda".',
            parameters: {
                type: 'object',
                properties: {
                    texto: { type: 'string', description: 'Palabras o frase a buscar en la descripción Wikipedia' },
                    limit: { type: 'integer', default: 10 },
                },
                required: ['texto'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'buscar_cercanos_a',
            description: 'Busca monumentos cercanos a un punto de referencia (ciudad, municipio o monumento) dentro de un radio. ÚSALA cuando el usuario planee un viaje, día de visita, escapada o pregunte "qué visitar cerca de X" / "a una hora en coche de Y". Permite filtrar por tipo de monumento.',
            parameters: {
                type: 'object',
                properties: {
                    centro: { type: 'string', description: 'Nombre de ciudad, municipio o monumento de referencia (ej: "Zaragoza", "Toledo", "Catedral de Sevilla")' },
                    radio_km: { type: 'integer', description: 'Radio en km desde el centro (5-200). Día de visita ≈ 50km, escapada fin de semana ≈ 100-150km.', default: 80 },
                    tipo_monumento: { type: 'string', description: 'Filtro opcional por tipo' },
                    periodo: { type: 'string', description: 'Filtro opcional por periodo' },
                    solo_estrella: { type: 'boolean', description: 'Si true, prioriza UNESCO + monumentos con Wikipedia (recomendado para turismo)', default: true },
                    limit: { type: 'integer', default: 12 },
                },
                required: ['centro'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'buscar_rutas',
            description: 'Busca rutas culturales temáticas curadas (Camino de Santiago, Ruta del Cister, etc.). Para preguntas de viaje, USA SIEMPRE el parámetro cerca_de en lugar de texto, para filtrar por proximidad geográfica real y evitar mezclar rutas de otras regiones.',
            parameters: {
                type: 'object',
                properties: {
                    texto: { type: 'string', description: 'Nombre, tema o región (úsalo SOLO cuando no haya base geográfica)' },
                    cerca_de: { type: 'string', description: 'Ciudad/municipio de referencia. Si se da, devuelve solo rutas con paradas dentro de radio_km. PREFERIDO para preguntas de viaje.' },
                    radio_km: { type: 'integer', description: 'Radio en km cuando se usa cerca_de', default: 200 },
                    limit: { type: 'integer', default: 8 },
                },
                required: [],
            },
        },
    },
];

// Ejecutores de tools
async function toolBuscarPorFiltros(args) {
    const filtros = [];
    const params = [];
    let p = 1;
    const add = (col, val, op = '=') => {
        if (!val) return;
        if (op === 'LIKE') { filtros.push(`LOWER(${col}) LIKE $${p++}`); params.push(`%${val.toLowerCase()}%`); }
        else { filtros.push(`${col} = $${p++}`); params.push(val); }
    };
    add('b.pais', args.pais);
    add('b.comunidad_autonoma', args.region, 'LIKE');
    add('b.provincia', args.provincia, 'LIKE');
    add('b.comarca', args.comarca, 'LIKE');
    add('b.municipio', args.municipio, 'LIKE');
    add('b.tipo_monumento', args.tipo_monumento);
    add('b.periodo', args.periodo);
    add('w.estilo', args.estilo, 'LIKE');
    add('b.heritage_world', args.heritage_world);
    if (args.religion) {
        const variantes = expandirReligionParaFiltro(args.religion);
        const orParts = variantes.map(() => `LOWER(w.religion) LIKE $${p++}`);
        filtros.push(`(${orParts.join(' OR ')})`);
        for (const v of variantes) params.push(`%${v.toLowerCase()}%`);
    }
    if (args.dedicado_a) { filtros.push(`LOWER(w.dedicado_a) LIKE $${p++}`); params.push(`%${args.dedicado_a.toLowerCase()}%`); }
    if (args.parte_de) { filtros.push(`LOWER(w.parte_de) LIKE $${p++}`); params.push(`%${args.parte_de.toLowerCase()}%`); }
    if (args.propietario) { filtros.push(`LOWER(w.propietario) LIKE $${p++}`); params.push(`%${args.propietario.toLowerCase()}%`); }

    if (filtros.length === 0) return { error: 'Sin filtros, especifica al menos uno.' };

    const limit = Math.min(args.limit || 10, 15);
    // Orden por importancia: UNESCO → heritage_label → wikipedia → resto
    const sql = `
        SELECT b.id, b.denominacion, b.municipio, b.provincia, b.pais,
               b.tipo_monumento, b.periodo, w.estilo, w.inception, w.religion,
               w.dedicado_a, b.heritage_world, w.heritage_label, w.wikipedia_url
        FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE ${filtros.join(' AND ')}
        ORDER BY
            (CASE WHEN b.heritage_world IS NOT NULL THEN 0
                  WHEN w.heritage_label IS NOT NULL THEN 1
                  WHEN w.wikipedia_url IS NOT NULL THEN 2
                  ELSE 3 END),
            b.id
        LIMIT ${limit}
    `;
    const r = await db.query(sql, params);
    return { count: r.rows.length, monumentos: r.rows };
}

async function toolBuscarPorPersona(args) {
    const limit = Math.min(args.limit || 10, 15);
    const r = await db.query(`
        SELECT DISTINCT b.id, b.denominacion, b.municipio, b.provincia, b.pais,
               b.tipo_monumento, b.periodo, bp.nombre AS persona, bp.rol
        FROM bien_personas bp JOIN bienes b ON b.id = bp.bien_id
        WHERE LOWER(bp.nombre) LIKE $1
        ORDER BY b.id LIMIT ${limit}
    `, [`%${args.nombre.toLowerCase()}%`]);
    return { count: r.rows.length, monumentos: r.rows };
}

async function toolBuscarPorTexto(args) {
    const results = await buscarMonumentosRelevantes(args.texto, Math.min(args.limit || 8, 15));
    return {
        count: results.length,
        monumentos: results.map(s => ({
            id: s.bien_id, denominacion: s.denominacion, municipio: s.municipio,
            provincia: s.provincia, pais: s.pais, tipo_monumento: s.tipo_monumento,
            periodo: s.periodo, similarity: s.similarity?.toFixed(2),
        })),
    };
}

async function toolInfoMonumento(args) {
    const id = parseInt(args.bien_id);
    if (!id) return { error: 'bien_id inválido' };
    const r = await db.query(`
        SELECT b.id, b.denominacion, b.municipio, b.provincia, b.pais,
               b.tipo_monumento, b.periodo, b.latitud, b.longitud, b.heritage_world,
               w.qid, w.descripcion AS wd_desc, w.arquitecto, w.estilo AS wd_estilo,
               w.material, w.altura, w.superficie, w.inception, w.heritage_label,
               w.religion, w.dedicado_a, w.parte_de, w.propietario, w.wikipedia_url
        FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.id = $1
    `, [id]);
    if (r.rows.length === 0) return { error: 'Monumento no encontrado' };
    const m = r.rows[0];

    const wiki = await obtenerExtractoWiki(id, 'es');
    if (wiki?.full_text) m.descripcion_wikipedia = wiki.full_text.substring(0, 2000);
    else if (wiki?.extract) m.descripcion_wikipedia = wiki.extract;

    const personas = await db.query(
        `SELECT nombre, rol FROM bien_personas WHERE bien_id = $1`, [id]
    );
    if (personas.rows.length > 0) m.personas = personas.rows;

    return m;
}

async function toolBuscarPorDescripcion(args) {
    const texto = (args.texto || '').trim();
    if (texto.length < 3) return { error: 'Texto muy corto' };
    const limit = Math.min(args.limit || 10, 15);

    // Fase 1: buscar FRASE EXACTA en full_text (mucho más preciso para nombres compuestos)
    const fraseLower = `%${texto.toLowerCase()}%`;
    const langs = ['es', 'ca', 'en', 'fr', 'it', 'pt'];
    const bienIds = new Set();

    for (const lang of langs) {
        if (bienIds.size >= limit) break;
        const pool = db.getEnrichmentPool(lang);
        if (!pool) continue;
        try {
            const r = await pool.query(`
                SELECT bien_id FROM wikipedia_extracts
                WHERE LOWER(full_text) LIKE $1 OR LOWER(extract) LIKE $1
                LIMIT ${limit}
            `, [fraseLower]);
            r.rows.forEach(row => bienIds.add(row.bien_id));
        } catch (e) { console.error(`enrich ${lang} frase:`, e.message); }
    }

    // Fase 2: si la frase exacta no devuelve nada, fallback a AND de palabras
    if (bienIds.size === 0) {
        const palabras = extraerPalabrasClave(texto);
        if (palabras.length >= 1) {
            for (const lang of langs) {
                if (bienIds.size >= limit) break;
                const pool = db.getEnrichmentPool(lang);
                if (!pool) continue;
                try {
                    const ilikeConds = palabras.map((_, i) => `(LOWER(full_text) LIKE $${i + 1} OR LOWER(extract) LIKE $${i + 1})`).join(' AND ');
                    const params = palabras.map(p => `%${p.toLowerCase()}%`);
                    const r = await pool.query(`
                        SELECT bien_id FROM wikipedia_extracts
                        WHERE ${ilikeConds}
                        LIMIT ${limit}
                    `, params);
                    r.rows.forEach(row => bienIds.add(row.bien_id));
                } catch (e) { console.error(`enrich ${lang} AND:`, e.message); }
            }
        }
    }

    if (bienIds.size === 0) return { count: 0, monumentos: [] };

    const ids = Array.from(bienIds);
    const r = await db.query(`
        SELECT b.id, b.denominacion, b.municipio, b.provincia, b.pais,
               b.tipo_monumento, b.periodo, w.estilo, w.inception
        FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.id = ANY($1::int[]) LIMIT ${limit}
    `, [ids]);
    return { count: r.rows.length, monumentos: r.rows };
}

async function toolBuscarRutas(args) {
    const limit = Math.min(args.limit || 8, 12);

    // Modo proximidad: si viene cerca_de, filtra rutas con al menos una parada en el radio
    if (args.cerca_de) {
        const centro = await resolverCentroCoords(args.cerca_de);
        if (centro) {
            const radioKm = Math.max(20, Math.min(parseInt(args.radio_km) || 200, 400));
            const r = await db.query(`
                WITH cerca AS (
                    SELECT DISTINCT rcp.ruta_id,
                           MIN(ST_Distance(
                              ST_SetSRID(ST_MakePoint(rcp.longitud, rcp.latitud), 4326)::geography,
                              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                           ) / 1000)::numeric AS min_dist_km
                    FROM rutas_culturales_paradas rcp
                    WHERE rcp.latitud IS NOT NULL AND rcp.longitud IS NOT NULL
                      AND ST_DWithin(
                         ST_SetSRID(ST_MakePoint(rcp.longitud, rcp.latitud), 4326)::geography,
                         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                         $3
                      )
                    GROUP BY rcp.ruta_id
                )
                SELECT rc.id, rc.slug, rc.nombre, rc.descripcion, rc.region, rc.pais, rc.tema, rc.num_paradas,
                       ROUND(c.min_dist_km, 0) AS dist_km
                FROM cerca c
                JOIN rutas_culturales rc ON rc.id = c.ruta_id
                WHERE rc.activa = true
                ORDER BY c.min_dist_km
                LIMIT ${limit}
            `, [centro.lon, centro.lat, radioKm * 1000]);
            return {
                centro_resuelto: { lat: centro.lat.toFixed(4), lon: centro.lon.toFixed(4) },
                radio_km: radioKm,
                count: r.rows.length,
                rutas: r.rows.map(row => ({
                    ...row,
                    descripcion: row.descripcion ? row.descripcion.substring(0, 300) : null,
                })),
            };
        }
        // Si no resuelve el centro, fallback a búsqueda por texto del propio cerca_de
        if (!args.texto) args.texto = args.cerca_de;
    }

    const palabras = extraerPalabrasClave(args.texto || '');
    if (palabras.length === 0) {
        const r = await db.query(`SELECT id, slug, nombre, descripcion, region, pais, tema, num_paradas FROM rutas_culturales WHERE activa = true LIMIT ${limit}`);
        return { count: r.rows.length, rutas: r.rows };
    }

    const params = palabras.map(p => `%${p.toLowerCase()}%`);
    const condRC = palabras.map((_, i) => `(LOWER(rc.nombre) LIKE $${i + 1} OR LOWER(COALESCE(rc.descripcion, '')) LIKE $${i + 1} OR LOWER(COALESCE(rc.region, '')) LIKE $${i + 1} OR LOWER(COALESCE(rc.tema, '')) LIKE $${i + 1})`).join(' OR ');
    const condParada = palabras.map((_, i) => `(LOWER(COALESCE(rcp.nombre, '')) LIKE $${i + 1} OR LOWER(COALESCE(rcp.localidad, '')) LIKE $${i + 1} OR LOWER(COALESCE(rcp.municipio, '')) LIKE $${i + 1})`).join(' OR ');
    const condBien = palabras.map((_, i) => `(LOWER(COALESCE(b.denominacion, '')) LIKE $${i + 1} OR LOWER(COALESCE(b.municipio, '')) LIKE $${i + 1} OR LOWER(COALESCE(b.comarca, '')) LIKE $${i + 1} OR LOWER(COALESCE(b.provincia, '')) LIKE $${i + 1} OR LOWER(COALESCE(b.comunidad_autonoma, '')) LIKE $${i + 1})`).join(' OR ');

    // Buscar en propiedades de la ruta + en las paradas (nombre/localidad/municipio) + en los bienes asociados (denominacion/municipio/comarca/region)
    const r = await db.query(`
        WITH candidatas AS (
            SELECT rc.id, 'ruta' AS via FROM rutas_culturales rc WHERE rc.activa = true AND (${condRC})
            UNION
            SELECT DISTINCT rcp.ruta_id AS id, 'parada' AS via
            FROM rutas_culturales_paradas rcp
            WHERE ${condParada}
            UNION
            SELECT DISTINCT rcp.ruta_id AS id, 'bien' AS via
            FROM rutas_culturales_paradas rcp
            JOIN bienes b ON b.id = rcp.bien_id
            WHERE ${condBien}
        )
        SELECT rc.id, rc.slug, rc.nombre, rc.descripcion, rc.region, rc.pais, rc.tema, rc.num_paradas,
               STRING_AGG(DISTINCT c.via, ',') AS via_list
        FROM candidatas c
        JOIN rutas_culturales rc ON rc.id = c.id
        WHERE rc.activa = true
        GROUP BY rc.id, rc.slug, rc.nombre, rc.descripcion, rc.region, rc.pais, rc.tema, rc.num_paradas
        ORDER BY rc.num_paradas DESC NULLS LAST
        LIMIT ${limit}
    `, params);

    return {
        count: r.rows.length,
        rutas: r.rows.map(row => ({
            ...row,
            descripcion: row.descripcion ? row.descripcion.substring(0, 300) : null,
        })),
    };
}

async function resolverCentroCoords(centro) {
    const q = String(centro || '').trim();
    if (!q) return null;
    // 1) Probar como municipio exacto (unaccent) con coords promedio
    const m = await db.query(`
        SELECT AVG(b.latitud)::float AS lat, AVG(b.longitud)::float AS lon, COUNT(*)::int AS n
        FROM bienes b
        WHERE unaccent(LOWER(b.municipio)) = unaccent(LOWER($1))
          AND b.latitud IS NOT NULL AND b.longitud IS NOT NULL
    `, [q]);
    if (m.rows[0]?.n > 0 && m.rows[0].lat) {
        return { lat: m.rows[0].lat, lon: m.rows[0].lon, fuente: 'municipio', n: m.rows[0].n };
    }
    // 2) Match por denominación (primer bien que coincida con esa palabra)
    const d = await db.query(`
        SELECT b.latitud AS lat, b.longitud AS lon
        FROM bienes b
        WHERE unaccent(LOWER(b.denominacion)) LIKE unaccent(LOWER($1))
          AND b.latitud IS NOT NULL AND b.longitud IS NOT NULL
        ORDER BY b.id LIMIT 1
    `, [`%${q}%`]);
    if (d.rows[0]?.lat) return { lat: d.rows[0].lat, lon: d.rows[0].lon, fuente: 'denominacion' };
    return null;
}

async function toolBuscarCercanos(args) {
    const centro = await resolverCentroCoords(args.centro);
    if (!centro) return { error: `No localizo "${args.centro}". Prueba con un municipio más concreto.` };
    const radioKm = Math.max(5, Math.min(parseInt(args.radio_km) || 150, 300));
    const limit = Math.max(3, Math.min(parseInt(args.limit) || 25, 30));

    const where = [
        `b.latitud IS NOT NULL AND b.longitud IS NOT NULL`,
        `ST_DWithin(
            ST_SetSRID(ST_MakePoint(b.longitud, b.latitud), 4326)::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3
        )`,
    ];
    const params = [centro.lon, centro.lat, radioKm * 1000];
    let p = 4;
    if (args.tipo_monumento) { where.push(`b.tipo_monumento = $${p++}`); params.push(args.tipo_monumento); }
    if (args.periodo)         { where.push(`b.periodo = $${p++}`);         params.push(args.periodo); }

    // Bias estrella: si solo_estrella !== false → priorizar UNESCO + heritage_label + wikipedia_url
    const solo = args.solo_estrella !== false;
    const orderBias = solo
        ? `(CASE WHEN b.heritage_world IS NOT NULL THEN 0
                  WHEN w.heritage_label IS NOT NULL THEN 1
                  WHEN w.wikipedia_url IS NOT NULL THEN 2
                  ELSE 3 END),`
        : '';

    // Diversidad por banda de distancia (20 km cada una) para no saturar con la
    // ciudad-base. Cada banda devuelve hasta 3 candidatos ordenados por importancia.
    // Así Loarre (78km), Piedra (90km), Veruela (62km), San Juan de la Peña (96km),
    // Albarracín (145km) sí llegan al top en sus respectivas bandas.
    const sql = `
        WITH cand AS (
            SELECT b.id, b.denominacion, b.municipio, b.provincia, b.comunidad_autonoma,
                   b.tipo_monumento, b.periodo, b.heritage_world,
                   w.heritage_label, w.wikipedia_url,
                   ROUND((ST_Distance(
                        ST_SetSRID(ST_MakePoint(b.longitud, b.latitud), 4326)::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                   ) / 1000)::numeric, 1) AS dist_km,
                   COALESCE(w.wiki_lang_count, 0) AS wiki_langs,
                   -- Bias por popularidad real: número de idiomas Wikipedia (proxy
                   -- de fama). Loarre/Aljafería ~7 idiomas → bias 0, Castillo
                   -- de Erla 1 idioma → cae fuera del filtro.
                   (CASE
                        WHEN b.heritage_world IS NOT NULL THEN 0
                        WHEN COALESCE(w.wiki_lang_count, 0) >= 4 AND b.tipo_monumento IN ('Catedral','Monasterio / Convento','Castillo / Fortaleza','Palacio','Conjunto histórico') THEN 0
                        WHEN COALESCE(w.wiki_lang_count, 0) >= 4 THEN 1
                        WHEN COALESCE(w.wiki_lang_count, 0) >= 2 AND b.tipo_monumento IN ('Catedral','Monasterio / Convento','Castillo / Fortaleza','Palacio','Conjunto histórico') THEN 2
                        ELSE 99
                    END) AS bias
            FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id
            WHERE ${where.join(' AND ')}
        ),
        filtrado AS (
            -- Modo turístico: UNESCO + ≥4 idiomas (cualquier tipo) + ≥2 idiomas
            -- (tipos top). Esto elimina los castillos menores con 1 idioma o
            -- ninguno (Erla, Almudevar, Agón...) que solo tienen heritage_label.
            SELECT * FROM cand
            ${solo ? 'WHERE bias <= 2' : ''}
        ),
        diverso AS (
            SELECT *,
                   -- Diversidad por (banda 25km, provincia, bias). Garantiza que
                   -- dentro de cada banda+provincia haya hasta 2 UNESCO y 2 BIC
                   -- + wiki. Así una banda saturada por sites UNESCO Mudéjar no
                   -- excluye Veruela/Piedra/Loarre (BIC famosos).
                   ROW_NUMBER() OVER (
                       PARTITION BY FLOOR(dist_km / 25), provincia, bias
                       ORDER BY dist_km
                   ) AS rk_banda
            FROM filtrado
        )
        SELECT id, denominacion, municipio, provincia, comunidad_autonoma,
               tipo_monumento, periodo, heritage_world, heritage_label, wikipedia_url,
               wiki_langs, dist_km
        FROM diverso
        WHERE rk_banda <= 3
        ORDER BY ${solo ? '(bias * 15 + dist_km)' : 'dist_km'}
        LIMIT ${limit}
    `;
    const r = await db.query(sql, params);
    // Particiona el resultado en "ciudad_base" (<15km) y "alrededores" (>=15km)
    // para que el LLM vea estructuralmente que tiene que diversificar geográficamente.
    const ciudad = [];
    const alrededores = [];
    for (const row of r.rows) {
        if (parseFloat(row.dist_km) < 15) ciudad.push(row);
        else alrededores.push(row);
    }
    return {
        centro_resuelto: { lat: centro.lat.toFixed(4), lon: centro.lon.toFixed(4), fuente: centro.fuente },
        radio_km: radioKm,
        count: r.rows.length,
        ciudad_base: ciudad.slice(0, 8),
        alrededores: alrededores,
        // Compatibilidad: campo plano por si el LLM lo pide
        monumentos: r.rows,
    };
}

const TOOL_EXECUTORS = {
    buscar_por_filtros: toolBuscarPorFiltros,
    buscar_por_persona: toolBuscarPorPersona,
    buscar_por_texto: toolBuscarPorTexto,
    info_monumento: toolInfoMonumento,
    buscar_por_descripcion: toolBuscarPorDescripcion,
    buscar_rutas: toolBuscarRutas,
    buscar_cercanos_a: toolBuscarCercanos,
};

// Proveedor LLM intercambiable via env CHAT_PROVIDER. Default: groq.
// Para usar Cerebras: setear CHAT_PROVIDER=cerebras y CEREBRAS_API_KEY en Render.
// Para volver atrás: quitar CHAT_PROVIDER (o ponerlo a groq).
const LLM_PROVIDERS = {
    groq: {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        envKey: 'GROQ_API_KEY',
        model: 'llama-3.3-70b-versatile',
        adapter: 'openai',
    },
    cerebras: {
        url: 'https://api.cerebras.ai/v1/chat/completions',
        envKey: 'CEREBRAS_API_KEY',
        model: 'gpt-oss-120b',
        adapter: 'openai',
    },
    gemini: {
        // El path lleva el modelo + acción; lo sustituimos en runtime.
        url: 'https://generativelanguage.googleapis.com/v1beta/models/MODEL:generateContent',
        envKey: 'GEMINI_API_KEY',
        model: 'gemini-2.5-flash',
        adapter: 'gemini',
    },
};

// Adapta el array de mensajes estilo OpenAI al formato de Gemini.
function openAIToGemini(messages, useTools) {
    const systemMsg = messages.find(m => m.role === 'system');
    const contents = [];
    for (const m of messages) {
        if (m.role === 'system') continue;
        if (m.role === 'user') {
            contents.push({ role: 'user', parts: [{ text: m.content || '' }] });
        } else if (m.role === 'assistant') {
            const parts = [];
            if (m.content) parts.push({ text: m.content });
            if (m.tool_calls) {
                for (const tc of m.tool_calls) {
                    let args = {};
                    try { args = JSON.parse(tc.function.arguments); } catch {}
                    parts.push({ functionCall: { name: tc.function.name, args } });
                }
            }
            if (parts.length > 0) contents.push({ role: 'model', parts });
        } else if (m.role === 'tool') {
            let response;
            try { response = JSON.parse(m.content); } catch { response = { content: m.content }; }
            contents.push({
                role: 'user',
                parts: [{ functionResponse: { name: m.name || 'unknown', response } }],
            });
        }
    }
    const body = {
        contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
    };
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    if (useTools) {
        body.tools = [{
            functionDeclarations: CHAT_TOOLS.map(t => ({
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
            })),
        }];
    }
    return body;
}

function geminiToOpenAI(data, model) {
    const cand = data.candidates?.[0];
    const message = { role: 'assistant', content: '' };
    const toolCalls = [];
    let tcCounter = 0;
    for (const part of cand?.content?.parts || []) {
        if (typeof part.text === 'string') message.content += part.text;
        if (part.functionCall) {
            toolCalls.push({
                id: `call_gem_${++tcCounter}`,
                type: 'function',
                function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args || {}),
                },
            });
        }
    }
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    return {
        model,
        choices: [{ message }],
        usage: {
            prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
            completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        },
    };
}

async function llamarGroqRaw(messages, useTools = false) {
    const providerName = (process.env.CHAT_PROVIDER || 'groq').toLowerCase();
    const cfg = LLM_PROVIDERS[providerName];
    if (!cfg) throw new Error(`CHAT_PROVIDER desconocido: ${providerName}`);
    const apiKey = process.env[cfg.envKey];
    if (!apiKey) throw new Error(`${cfg.envKey} no configurada`);
    const model = process.env.CHAT_MODEL || cfg.model;

    if (cfg.adapter === 'gemini') {
        const body = openAIToGemini(messages, useTools);
        const url = cfg.url.replace('MODEL', model);
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`${providerName} ${res.status}: ${errBody.substring(0, 300)}`);
        }
        const data = await res.json();
        return geminiToOpenAI(data, model);
    }

    // OpenAI-compatible (groq, cerebras)
    const body = { model, messages, temperature: 0.3, max_tokens: 2000 };
    if (useTools) {
        body.tools = CHAT_TOOLS;
        body.tool_choice = 'auto';
    } else {
        body.tool_choice = 'none';
    }
    const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`${providerName} ${res.status}: ${errBody.substring(0, 300)}`);
    }
    return await res.json();
}

function rankearFuentes(allMonumentos, answerText) {
    const citedIds = new Set();
    const re = /#(\d{1,7})/g;
    let m;
    while ((m = re.exec(answerText || '')) !== null) citedIds.add(parseInt(m[1], 10));

    const arr = Array.from(allMonumentos.values()).map(m => {
        const cited = citedIds.has(m.bien_id);
        const score =
            (cited ? 100 : 0) +
            (m.heritage_world ? 30 : 0) +
            (m.heritage_label ? 15 : 0) +
            (m.wikipedia_url ? 8 : 0) +
            (m.similarity ? Math.min(parseFloat(m.similarity) * 5, 5) : 0);
        return { ...m, _score: score, _cited: cited };
    });
    arr.sort((a, b) => b._score - a._score);
    return arr.slice(0, 8).map(({ _score, ...rest }) => rest);
}

async function chatConToolUse(question) {
    const systemPrompt = `Eres un asistente experto en patrimonio histórico y arquitectónico europeo, especializado en el catálogo "Patrimonio Europeo" (316k+ monumentos en España, Italia, Francia, Portugal).

Tienes acceso a 7 funciones (tools) que puedes invocar para consultar la base de datos:
- buscar_por_filtros: filtros estructurados (tipo, periodo, religión, ubicación, dedicatoria, UNESCO, etc.)
- buscar_por_persona: arquitectos/escultores/autores (P84 architect, P170 creator, etc.)
- buscar_por_texto: búsqueda fuzzy por nombre o ubicación (incluye municipio/provincia/comarca)
- buscar_por_descripcion: busca en el TEXTO Wikipedia. ÚSALA para comarcas catalanas o conceptos no estructurados.
- buscar_rutas: rutas culturales temáticas (Camino Santiago, Ruta del Cister, etc.)
- buscar_cercanos_a: monumentos cercanos a un punto + radio. ÚSALA SIEMPRE para preguntas turísticas con zona base ("estaré en Zaragoza", "qué visitar cerca de Toledo", "a 1h en coche de X").
- info_monumento: ficha completa de UN monumento por su id

REGLAS CRÍTICAS:
1. **Idiomas**: el usuario puede preguntar en cualquier idioma. Los VALORES de filtros en BD están en ESPAÑOL. Traduce los conceptos:
   - "castle"/"castillo"/"castell" → tipo_monumento="Castillo / Fortaleza"
   - "church"/"iglesia"/"església" → tipo_monumento="Iglesia / Ermita"
   - "Romanesque"/"románico" → periodo="Románico"
   - "Catalonia"/"Cataluña"/"Catalunya" → region="Cataluña"
   - Responde al usuario en su mismo idioma.

2. **VIAJES Y VISITAS (regla principal — OBLIGATORIA)**: si el usuario menciona estancia con base + duración + transporte (ej: "estaré una semana en Zaragoza en coche", "fin de semana en Toledo", "tres días por Cádiz"), TIENES QUE:
   a) Llamar OBLIGATORIAMENTE a buscar_cercanos_a({centro: "ciudad_base", radio_km: X, limit: 15}) — NUNCA buscar_por_texto sola en estos casos. Radio según duración:
      - día/escapada corta: 50 km
      - fin de semana: 80-100 km
      - semana en coche: 120-150 km
   b) Llamar también a buscar_rutas con cerca_de="ciudad_base" para que devuelva solo rutas con paradas en la zona (no rutas de otras regiones).
   c) **OBLIGATORIO: organizar la respuesta como un itinerario por DÍAS agrupados por zona geográfica**. Reglas estrictas:
      - **MÁXIMO 2 DÍAS EN LA CIUDAD-BASE**. La tool buscar_cercanos_a devuelve un campo "ciudad_base" (sitios a menos de 15km del centro) y un campo "alrededores" (sitios a 15km o más). Usa "ciudad_base" para los 1-2 primeros días. Los demás días DEBEN venir de "alrededores", agrupados por municipios/comarcas próximas entre sí.
      - **CADA DÍA DEBE TENER AL MENOS 2 MONUMENTOS**. Si solo hay 1 para un día, fusiónalo con otro.
      - Etiqueta cada día con NOMBRES REALES de municipios/comarcas (ej: "Día 3 — Huesca y Castillo de Loarre"). NUNCA direcciones cardinales inventadas.
      - Prioriza UNESCO, catedrales, castillos, monasterios y conjuntos históricos. La lista que recibes ya está ordenada por importancia (UNESCO + nº idiomas Wikipedia + tipo).
      - NO gastes un día entero "consultando rutas" ni "regresando a base". Esos no cuentan.

   Formato:

   **Día 1 — Zaragoza ciudad**
   Visita la Catedral del Salvador (#XXXX) y el Castillo de la Aljafería (#YYYY)…

   **Día 2 — Loarre y Sos del Rey Católico**
   Castillo de Loarre (#ZZZZ), Sos del Rey Católico (#AAAA)…

   **Día 3 — Monasterio de Piedra y Calatayud**
   …

   Crea entre 3 y 6 días según la estancia. Cita siempre con #id. Al final, una línea opcional sobre 1-2 rutas culturales relevantes si la tool buscar_rutas las devolvió.

3. **Búsquedas vagas**: usa buscar_por_texto con palabras de tipo + ubicación juntas.

4. **Combina tools cuando ayude**: para comarcas catalanas (Conca de Barberà, Penedès, Empordà, Garrotxa...) usa buscar_por_descripcion porque el campo comarca está vacío. Para profundizar en un monumento usa info_monumento.

5. **Cita SIEMPRE los monumentos con #id**. Sé conciso (máx 5 párrafos), pero para preguntas de viaje puedes extenderte hasta 8.

6. **PROHIBIDO INVENTAR**: NO menciones nada que no haya aparecido en los resultados de tus tools. Si una tool devuelve count=0, dilo claramente y sugiere refinar.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
    ];

    const toolsUsed = [];
    let totalTokensIn = 0, totalTokensOut = 0;
    const allMonumentos = new Map();
    const t0 = Date.now();

    // Loop máx 5 iteraciones tool use (gpt-oss tiende a llamar más tools)
    for (let iter = 0; iter < 5; iter++) {
        const result = await llamarGroqRaw(messages, true);
        totalTokensIn += result.usage?.prompt_tokens || 0;
        totalTokensOut += result.usage?.completion_tokens || 0;
        const msg = result.choices[0].message;
        messages.push(msg);

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
            // Respuesta final del LLM
            return {
                answer: msg.content || '',
                tools_used: toolsUsed,
                sources: rankearFuentes(allMonumentos, msg.content),
                meta: {
                    model: result.model,
                    tokens_in: totalTokensIn,
                    tokens_out: totalTokensOut,
                    elapsed_ms: Date.now() - t0,
                    iterations: iter + 1,
                },
            };
        }

        // Ejecutar cada tool call
        for (const call of msg.tool_calls) {
            const fnName = call.function.name;
            let args = {};
            try { args = JSON.parse(call.function.arguments); } catch {}
            const executor = TOOL_EXECUTORS[fnName];
            let toolResult;
            try {
                if (!executor) toolResult = { error: `Tool ${fnName} desconocida` };
                else toolResult = await executor(args);
            } catch (e) {
                toolResult = { error: e.message };
            }
            toolsUsed.push({ name: fnName, args, count: toolResult?.count, error: toolResult?.error });

            // Acumular monumentos para "Fuentes" del UI (con metadatos para ranking)
            if (toolResult?.monumentos) {
                for (const m of toolResult.monumentos.slice(0, 8)) {
                    if (!allMonumentos.has(m.id)) {
                        allMonumentos.set(m.id, {
                            bien_id: m.id,
                            denominacion: m.denominacion,
                            municipio: m.municipio,
                            similarity: m.similarity,
                            heritage_world: m.heritage_world || null,
                            heritage_label: m.heritage_label || null,
                            wikipedia_url: m.wikipedia_url || null,
                        });
                    }
                }
            } else if (toolResult?.id && !allMonumentos.has(toolResult.id)) {
                allMonumentos.set(toolResult.id, {
                    bien_id: toolResult.id,
                    denominacion: toolResult.denominacion,
                    municipio: toolResult.municipio,
                    heritage_world: toolResult.heritage_world || null,
                    heritage_label: toolResult.heritage_label || null,
                    wikipedia_url: toolResult.wikipedia_url || null,
                });
            }

            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                name: fnName, // necesario para el adaptador Gemini (functionResponse.name)
                content: JSON.stringify(toolResult).substring(0, 6000),
            });
        }
    }

    // Si llegó al límite de iteraciones, forzar respuesta final sin tools
    const finalResult = await llamarGroqRaw(messages, false);
    totalTokensIn += finalResult.usage?.prompt_tokens || 0;
    totalTokensOut += finalResult.usage?.completion_tokens || 0;
    const finalAnswer = finalResult.choices[0]?.message?.content || '(respuesta vacía tras 3 iteraciones)';
    return {
        answer: finalAnswer,
        tools_used: toolsUsed,
        sources: rankearFuentes(allMonumentos, finalAnswer),
        meta: {
            model: finalResult.model,
            tokens_in: totalTokensIn,
            tokens_out: totalTokensOut,
            elapsed_ms: Date.now() - t0,
            iterations: 5,
            forced_final: true,
        },
    };
}

// Debug temporal: lista modelos disponibles del proveedor LLM activo.
// Útil para descubrir el id exacto de modelo cuando Cerebras/Groq cambian su catálogo.
app.get('/api/admin/chat/models', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const providerName = (process.env.CHAT_PROVIDER || 'groq').toLowerCase();
        const cfg = LLM_PROVIDERS[providerName];
        if (!cfg) return res.status(400).json({ error: `Provider desconocido: ${providerName}` });
        const apiKey = process.env[cfg.envKey];
        if (!apiKey) return res.status(500).json({ error: `${cfg.envKey} no configurada` });
        const modelsUrl = cfg.url.replace('/chat/completions', '/models');
        const r = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
        const text = await r.text();
        let body; try { body = JSON.parse(text); } catch { body = text; }
        res.json({
            provider: providerName,
            model_actual_configurado: process.env.CHAT_MODEL || cfg.model,
            url: modelsUrl,
            status: r.status,
            response: body,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/chat', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { question } = req.body;
        if (!question || question.trim().length < 3) {
            return res.status(400).json({ error: 'Pregunta muy corta (mín 3 caracteres)' });
        }
        const providerName = (process.env.CHAT_PROVIDER || 'groq').toLowerCase();
        const expectedKey = LLM_PROVIDERS[providerName]?.envKey || 'GROQ_API_KEY';
        if (!process.env[expectedKey]) {
            return res.status(500).json({ error: `${expectedKey} no configurada en Render` });
        }
        const result = await chatConToolUse(question);
        res.json(result);
    } catch (err) {
        console.error('Chat error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/analytics/summary
 * KPIs: total usuarios, activos, nuevos, distribución roles y métodos
 */
app.get('/api/admin/analytics/summary', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const data = await db.obtenerAnalyticsSummary();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/analytics/registrations?periodo=week|month
 * Registros agrupados por semana o mes
 */
app.get('/api/admin/analytics/registrations', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const periodo = req.query.periodo === 'week' ? 'week' : 'month';
        const data = await db.obtenerRegistrosPorTiempo(periodo);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/analytics/logins-per-day?dias=30
 * Logins por día (últimos N días)
 */
app.get('/api/admin/analytics/logins-per-day', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const dias = Math.min(365, Math.max(1, parseInt(req.query.dias) || 30));
        const data = await db.obtenerLoginsPorDia(dias);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/analytics/top-users?limit=10
 * Top usuarios por nº de logins
 */
app.get('/api/admin/analytics/top-users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
        const data = await db.obtenerUsuariosMasActivos(limit);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== ANALYTICS DE TRAFICO (ingesta + agregados admin) ==============

const crypto = require('crypto');

function hashIp(ip) {
    if (!ip) return null;
    return crypto.createHash('sha256').update(ip + JWT_SECRET).digest('hex');
}

function detectDevice(userAgent) {
    if (!userAgent) return null;
    if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent)) return 'tablet';
    if (/Mobile|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) return 'mobile';
    return 'desktop';
}

// Elimina parámetros de tracking de la URL para que /monumento/X?fbclid=A y
// /monumento/X?fbclid=B se cuenten como la misma página en analytics.
const TRACKING_PARAMS = new Set([
    'fbclid', 'gclid', 'msclkid', 'dclid', 'igshid',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    '_ga', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'ref_url',
]);

function cleanUrl(url) {
    if (!url) return null;
    try {
        // base dummy permite parsear paths relativos ("/foo?x=1")
        const u = new URL(url, 'https://x.local');
        for (const p of [...u.searchParams.keys()]) {
            if (TRACKING_PARAMS.has(p)) u.searchParams.delete(p);
        }
        const search = u.searchParams.toString();
        return u.pathname + (search ? '?' + search : '') + (u.hash || '');
    } catch {
        return String(url).slice(0, 500);
    }
}

const ALLOWED_EVENT_TYPES = new Set([
    'pageview', 'monument_view', 'favorite_add', 'favorite_remove',
    'route_create', 'route_save', 'search', 'external_click',
    'compare_monuments', 'curated_route_view',
]);

/**
 * POST /api/track
 * Ingesta de eventos. Anónimo aceptado; si llega token Bearer válido, se asocia al usuario.
 * Body: { event_type, url?, bien_id?, ruta_id?, metadata?, session_id? }
 */
app.post('/api/track', optionalAuth, async (req, res) => {
    try {
        const { event_type, url, bien_id, ruta_id, metadata, session_id } = req.body || {};
        if (!event_type || !ALLOWED_EVENT_TYPES.has(event_type)) {
            return res.status(400).json({ error: 'event_type inválido' });
        }
        const referrer = (req.body && req.body.referrer) || req.headers['referer'] || null;
        const country = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || null;
        const ip = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
        const ipHash = hashIp(ip);
        const device = detectDevice(req.headers['user-agent']);
        const usuario_id = req.user?.id || null;
        await db.trackEvent({
            event_type,
            url: url ? cleanUrl(String(url)).slice(0, 500) : null,
            usuario_id,
            bien_id: bien_id ? parseInt(bien_id) : null,
            ruta_id: ruta_id ? parseInt(ruta_id) : null,
            metadata: metadata || null,
            referrer: referrer ? String(referrer).slice(0, 500) : null,
            country: country ? String(country).slice(0, 2).toUpperCase() : null,
            device,
            ip_hash: ipHash,
            session_id: session_id ? String(session_id).slice(0, 40) : null,
        });
        res.status(204).end();
    } catch (err) {
        console.error('track error:', err.message);
        // No queremos romper la UI por un fallo de analytics — devolver 204 igual
        res.status(204).end();
    }
});

/**
 * GET /api/admin/analytics/traffic/summary?dias=30
 */
app.get('/api/admin/analytics/traffic/summary', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const dias = Math.min(365, Math.max(1, parseInt(req.query.dias) || 30));
        const data = await db.obtenerTraficoSummary(dias);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/analytics/traffic/by-day?dias=30
 */
app.get('/api/admin/analytics/traffic/by-day', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const dias = Math.min(365, Math.max(1, parseInt(req.query.dias) || 30));
        const data = await db.obtenerTraficoPorDia(dias);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/analytics/traffic/top-urls?dias=30&limit=15
 */
app.get('/api/admin/analytics/traffic/top-urls', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const dias = Math.min(365, Math.max(1, parseInt(req.query.dias) || 30));
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 15));
        const data = await db.obtenerTopUrls(dias, limit);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/analytics/traffic/top-referrers?dias=30&limit=15
 */
app.get('/api/admin/analytics/traffic/top-referrers', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const dias = Math.min(365, Math.max(1, parseInt(req.query.dias) || 30));
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 15));
        const data = await db.obtenerTopReferrers(dias, limit);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/analytics/traffic/top-monumentos?dias=30&limit=15
 */
app.get('/api/admin/analytics/traffic/top-monumentos', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const dias = Math.min(365, Math.max(1, parseInt(req.query.dias) || 30));
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 15));
        const data = await db.obtenerTopMonumentos(dias, limit);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/analytics/traffic/top-acciones?dias=30
 */
app.get('/api/admin/analytics/traffic/top-acciones', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const dias = Math.min(365, Math.max(1, parseInt(req.query.dias) || 30));
        const data = await db.obtenerTopAcciones(dias);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== FAVORITOS ENDPOINTS ==============

/**
 * GET /api/favoritos
 * Lista de favoritos del usuario
 */
app.get('/api/favoritos', authMiddleware, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const result = await db.obtenerFavoritos(req.user.id, { page, limit });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/favoritos/ids
 * IDs de todos los favoritos (para marcar en listas)
 */
app.get('/api/favoritos/ids', authMiddleware, async (req, res) => {
    try {
        const ids = await db.obtenerIdsFavoritos(req.user.id);
        res.json(ids);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/favoritos/:bienId
 * Añadir a favoritos
 */
app.post('/api/favoritos/:bienId', authMiddleware, async (req, res) => {
    try {
        const bienId = parseInt(req.params.bienId);
        const bien = await db.obtenerBien(bienId);
        if (!bien) return res.status(404).json({ error: 'Monumento no encontrado' });

        await db.agregarFavorito(req.user.id, bienId);
        res.json({ ok: true, favorito: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/favoritos/:bienId
 * Quitar de favoritos
 */
app.delete('/api/favoritos/:bienId', authMiddleware, async (req, res) => {
    try {
        const bienId = parseInt(req.params.bienId);
        await db.eliminarFavorito(req.user.id, bienId);
        res.json({ ok: true, favorito: false });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Opciones de ordenación (whitelist para evitar SQL injection)
const RELEVANCE_SCORE = `(
    CASE
        WHEN w.heritage_label ILIKE '%patrimonio de la humanidad%'
          OR w.heritage_label ILIKE '%world heritage%'
          OR w.heritage_label ILIKE '%parte de un sitio Patrimonio%'
          OR w.heritage_label ILIKE '%patrimoine mondial%'
          OR w.heritage_label ILIKE '%patrimonio dell''umanità%'
          OR w.heritage_label ILIKE '%Património Mundial%' THEN 20
        WHEN w.heritage_label ILIKE '%classé%'
          OR w.heritage_label = 'bien de interés cultural'
          OR w.heritage_label = 'BIC'
          OR w.heritage_label ILIKE '%Monumento Nacional%'
          OR w.heritage_label ILIKE '%Monumento de Interesse Público%' THEN 15
        WHEN w.heritage_label ILIKE '%inscrit%'
          OR w.heritage_label ILIKE '%Interesse Público%'
          OR w.heritage_label ILIKE '%bene culturale%'
          OR w.heritage_label ILIKE '%Bien cultural%'
          OR w.heritage_label ILIKE '%notevole interesse%' THEN 12
        WHEN w.heritage_label IS NOT NULL THEN 8
        ELSE 0
    END
    + CASE WHEN w.wikipedia_url IS NOT NULL THEN 10 ELSE 0 END
    + CASE
        WHEN LENGTH(COALESCE(w.descripcion,'')) > 500 THEN 5
        WHEN LENGTH(COALESCE(w.descripcion,'')) > 100 THEN 3
        WHEN LENGTH(COALESCE(w.descripcion,'')) > 0 THEN 1
        ELSE 0
    END
    + CASE WHEN w.imagen_url IS NOT NULL THEN 10 ELSE 0 END
    + CASE WHEN b.latitud IS NOT NULL THEN 5 ELSE 0 END
    + CASE WHEN w.estilo IS NOT NULL THEN 3 ELSE 0 END
    + CASE WHEN w.arquitecto IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN w.inception IS NOT NULL THEN 3 ELSE 0 END
    + CASE WHEN w.commons_category IS NOT NULL THEN 3 ELSE 0 END
    + CASE
        WHEN b.heritage_world = 'both'    THEN 50
        WHEN b.heritage_world = 'unesco'  THEN 40
        WHEN b.heritage_world = 'european' THEN 25
        ELSE 0
    END
    + CASE
        WHEN LENGTH(b.denominacion) <= 25 THEN 8
        WHEN LENGTH(b.denominacion) <= 40 THEN 4
        WHEN LENGTH(b.denominacion) >= 60 THEN -3
        ELSE 0
    END
)`;

// Quita caracteres iniciales no alfabéticos (comillas, paréntesis, etc.)
// para que el ordenamiento alfabético funcione correctamente
const NORM_NAME = `LOWER(regexp_replace(b.denominacion, '^[^a-zA-Z0-9áéíóúñçàèìòùäëïöüÁÉÍÓÚÑÇÀÈÌÒÙÄËÏÖÜ]+', '', 'g'))`;
const NORM_MUN = `LOWER(regexp_replace(b.municipio, '^[^a-zA-Z0-9áéíóúñçàèìòùäëïöüÁÉÍÓÚÑÇÀÈÌÒÙÄËÏÖÜ]+', '', 'g'))`;

const SORT_OPTIONS = {
    'relevancia':     `${RELEVANCE_SCORE} DESC, ${NORM_NAME} ASC`,
    'nombre_asc':     `${NORM_NAME} ASC`,
    'nombre_desc':    `${NORM_NAME} DESC`,
    'municipio_asc':  `${NORM_MUN} ASC, ${NORM_NAME} ASC`,
    'municipio_desc': `${NORM_MUN} DESC, ${NORM_NAME} ASC`,
};

// ============== ENDPOINTS ==============

/**
 * GET /api/stats
 * Estadísticas generales de la base de datos
 */
app.get('/api/stats', async (req, res) => {
    try {
        const [totalR, conCoordsR, conWikidataR, imagenesR, porPaisR, porRegionR, porCategoriaR, porTipoR] = await Promise.all([
            db.query('SELECT COUNT(*) as n FROM bienes'),
            db.query('SELECT COUNT(*) as n FROM bienes WHERE latitud IS NOT NULL'),
            db.query('SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL'),
            db.query('SELECT COUNT(*) as n FROM imagenes'),
            db.query(`
                SELECT pais, COUNT(*) as total,
                       SUM(CASE WHEN latitud IS NOT NULL THEN 1 ELSE 0 END) as con_coords
                FROM bienes GROUP BY pais
            `),
            db.query(`
                SELECT comunidad_autonoma as region, pais, COUNT(*) as total,
                       SUM(CASE WHEN latitud IS NOT NULL THEN 1 ELSE 0 END) as con_coords
                FROM bienes
                WHERE comunidad_autonoma IS NOT NULL AND comunidad_autonoma != ''
                GROUP BY comunidad_autonoma, pais
            `),
            db.query(`
                SELECT categoria, COUNT(*) as total FROM bienes
                WHERE categoria IS NOT NULL GROUP BY categoria ORDER BY total DESC LIMIT 20
            `),
            db.query(`
                SELECT tipo, COUNT(*) as total FROM bienes
                WHERE tipo IS NOT NULL GROUP BY tipo ORDER BY total DESC LIMIT 20
            `),
        ]);

        res.json({
            total: totalR.rows[0].n,
            con_coordenadas: conCoordsR.rows[0].n,
            con_wikidata: conWikidataR.rows[0].n,
            imagenes: imagenesR.rows[0].n,
            por_pais: porPaisR.rows,
            por_region: porRegionR.rows,
            por_categoria: porCategoriaR.rows,
            por_tipo: porTipoR.rows,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/monumentos
 * Lista de monumentos con paginación y filtros
 */
app.get('/api/monumentos', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        let where = [];
        let params = [];
        let pi = 1;

        if (req.query.pais) {
            where.push(`b.pais = $${pi++}`);
            params.push(req.query.pais);
        }
        if (req.query.region) {
            where.push(`b.comunidad_autonoma = $${pi++}`);
            params.push(req.query.region);
        }
        if (req.query.provincia) {
            where.push(`b.provincia = $${pi++}`);
            params.push(req.query.provincia);
        }
        if (req.query.municipio) {
            where.push(`b.municipio = $${pi++}`);
            params.push(req.query.municipio);
        }
        if (req.query.categoria) {
            where.push(`b.categoria ILIKE $${pi++}`);
            params.push(`%${req.query.categoria}%`);
        }
        if (req.query.tipo) {
            where.push(`b.tipo ILIKE $${pi++}`);
            params.push(`%${req.query.tipo}%`);
        }
        if (req.query.estilo) {
            where.push(`w.estilo ILIKE $${pi++}`);
            params.push(`%${req.query.estilo}%`);
        }
        if (req.query.tipo_monumento) {
            where.push(`b.tipo_monumento = $${pi++}`);
            params.push(req.query.tipo_monumento);
        }
        if (req.query.clasificacion) {
            const tokens = String(req.query.clasificacion).split(',').map(s => s.trim()).filter(Boolean);
            const validTokens = tokens.filter(t => CLASIFICACION_GRUPOS[t] || t === 'otros');
            if (validTokens.length > 0) {
                const piRef = { value: pi };
                applyClasificacionFilter(validTokens.join(','), where, params, piRef);
                pi = piRef.value;
            }
        }
        if (req.query.periodo) {
            where.push(`b.periodo = $${pi++}`);
            params.push(req.query.periodo);
        }
        if (req.query.evento) {
            where.push(`EXISTS (SELECT 1 FROM eventos_monumento em WHERE em.bien_id = b.id AND em.qid_evento = $${pi++})`);
            params.push(req.query.evento);
        }
        if (req.query.evento_padre) {
            where.push(`EXISTS (SELECT 1 FROM eventos_monumento em WHERE em.bien_id = b.id AND em.qid_evento_padre = $${pi++})`);
            params.push(req.query.evento_padre);
        }
        if (req.query.con_eventos === 'true') {
            where.push('EXISTS (SELECT 1 FROM eventos_monumento em WHERE em.bien_id = b.id)');
        }
        if (req.query.q) {
            const qTokenized = String(req.query.q).trim().split(/\s+/).filter(Boolean).join('%');
            if (qTokenized) {
                // Buscar también en bien_aliases (BD search) para nombres alternativos
                let aliasBienIds = [];
                const searchPool = db.getSearchPool && db.getSearchPool();
                if (searchPool) {
                    try {
                        const r = await searchPool.query(
                            `SELECT DISTINCT bien_id FROM bien_aliases
                             WHERE unaccent(LOWER(alias)) ILIKE unaccent(LOWER($1)) LIMIT 200`,
                            [`%${qTokenized}%`]
                        );
                        aliasBienIds = r.rows.map(x => x.bien_id);
                    } catch (e) { console.error('alias search:', e.message); }
                }
                if (aliasBienIds.length > 0) {
                    where.push(`(unaccent(b.denominacion) ILIKE unaccent($${pi}) OR b.id = ANY($${pi + 1}::int[]))`);
                    params.push(`%${qTokenized}%`, aliasBienIds);
                    pi += 2;
                } else {
                    where.push(`unaccent(b.denominacion) ILIKE unaccent($${pi++})`);
                    params.push(`%${qTokenized}%`);
                }
            }
        }
        if (req.query.solo_coords === 'true') {
            where.push('b.latitud IS NOT NULL');
        }
        if (req.query.solo_wikidata === 'true') {
            where.push('w.qid IS NOT NULL');
        }
        if (req.query.solo_imagen === 'true') {
            where.push('w.imagen_url IS NOT NULL');
        }
        if (req.query.sin_imagen === 'true') {
            where.push('(w.imagen_url IS NULL AND NOT EXISTS (SELECT 1 FROM imagenes WHERE bien_id = b.id))');
        }
        // Oleada B — propiedades Wikidata estructuradas (ILIKE %value% para match en valores concatenados con " | ")
        if (req.query.propietario) {
            where.push(`w.propietario ILIKE $${pi++}`);
            params.push(`%${req.query.propietario}%`);
        }
        if (req.query.religion) {
            // Si es macro (Catolicismo, etc.) expandir a variantes raw; sino usar tal cual
            const variantes = expandirReligionParaFiltro(req.query.religion);
            const orParts = variantes.map(() => `w.religion ILIKE $${pi++}`);
            where.push(`(${orParts.join(' OR ')})`);
            for (const v of variantes) params.push(`%${v}%`);
        }
        if (req.query.dedicado_a) {
            where.push(`w.dedicado_a ILIKE $${pi++}`);
            params.push(`%${req.query.dedicado_a}%`);
        }
        if (req.query.parte_de) {
            where.push(`w.parte_de ILIKE $${pi++}`);
            params.push(`%${req.query.parte_de}%`);
        }
        if (req.query.heritage_world) {
            const hw = req.query.heritage_world;
            if (hw === 'any') {
                where.push('b.heritage_world IS NOT NULL');
            } else if (['unesco', 'european'].includes(hw)) {
                where.push(`(b.heritage_world = $${pi++} OR b.heritage_world = 'both')`);
                params.push(hw);
            }
        }
        if (req.query.bbox) {
            const [minLon, minLat, maxLon, maxLat] = req.query.bbox.split(',').map(parseFloat);
            if (!isNaN(minLon) && !isNaN(minLat) && !isNaN(maxLon) && !isNaN(maxLat)) {
                where.push(`b.longitud >= $${pi} AND b.longitud <= $${pi+1} AND b.latitud >= $${pi+2} AND b.latitud <= $${pi+3}`);
                params.push(minLon, maxLon, minLat, maxLat);
                pi += 4;
            }
        }

        const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        // Count total
        const countResult = await db.query(
            `SELECT COUNT(*) as total FROM bienes b LEFT JOIN wikidata w ON b.id = w.bien_id ${whereClause}`,
            params
        );
        const total = countResult.rows[0].total;

        // Get items
        const allParams = [...params, limit, offset];
        const sortKey = req.query.sort || 'relevancia';
        const useInterleave = sortKey === 'relevancia' && !req.query.pais;

        let query;
        if (useInterleave) {
            query = `
                WITH scored AS (
                    SELECT
                        b.id, b.denominacion, b.tipo, b.clase, b.categoria,
                        b.provincia, b.comarca, b.municipio, b.localidad,
                        b.latitud, b.longitud, b.coords_precision,
                        b.comunidad_autonoma, b.pais,
                        b.tipo_monumento, b.periodo, b.heritage_world,
                        w.qid, w.descripcion, COALESCE(w.imagen_url, img.url) as imagen_url, w.estilo, w.arquitecto,
                        w.heritage_label, w.wikipedia_url,
                        ${RELEVANCE_SCORE} as _score,
                        ROW_NUMBER() OVER (PARTITION BY b.pais ORDER BY ${RELEVANCE_SCORE} DESC, LOWER(b.denominacion)) as country_rank
                    FROM bienes b
                    LEFT JOIN wikidata w ON b.id = w.bien_id
                    LEFT JOIN LATERAL (SELECT url FROM imagenes WHERE bien_id = b.id LIMIT 1) img ON true
                    ${whereClause}
                )
                SELECT id, denominacion, tipo, clase, categoria, provincia, comarca,
                       municipio, localidad, latitud, longitud, coords_precision,
                       comunidad_autonoma, pais,
                       tipo_monumento, periodo, heritage_world,
                       qid, descripcion, imagen_url, estilo, arquitecto, heritage_label, wikipedia_url
                FROM scored
                ORDER BY country_rank, _score DESC, LOWER(denominacion)
                LIMIT $${pi++} OFFSET $${pi}
            `;
        } else {
            query = `
                SELECT
                    b.id, b.denominacion, b.tipo, b.clase, b.categoria,
                    b.provincia, b.comarca, b.municipio, b.localidad,
                    b.latitud, b.longitud, b.coords_precision,
                    b.comunidad_autonoma, b.pais,
                    b.tipo_monumento, b.periodo, b.heritage_world,
                    w.qid, w.descripcion, COALESCE(w.imagen_url, img.url) as imagen_url, w.estilo, w.arquitecto,
                    w.heritage_label, w.wikipedia_url
                FROM bienes b
                LEFT JOIN wikidata w ON b.id = w.bien_id
                LEFT JOIN LATERAL (SELECT url FROM imagenes WHERE bien_id = b.id LIMIT 1) img ON true
                ${whereClause}
                ORDER BY ${SORT_OPTIONS[sortKey] || SORT_OPTIONS['relevancia']}
                LIMIT $${pi++} OFFSET $${pi}
            `;
        }

        const items = await db.query(query, allParams);

        res.json({
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit),
            items: items.rows,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/monumentos/radio?lat=...&lng=...&km=...
 * Buscar monumentos en un radio desde un punto
 */
app.get('/api/monumentos/radio', async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        const km = Math.min(200, Math.max(1, parseInt(req.query.km) || 50));
        const limit = Math.min(200, parseInt(req.query.limit) || 100);

        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({ error: 'lat y lng requeridos' });
        }

        let extraWhere = '';
        let extraParams = [lat, lng, km, limit];
        let pi = 5;

        if (req.query.pais) {
            extraWhere += ` AND b.pais = $${pi++}`;
            extraParams.push(req.query.pais);
        }
        if (req.query.categoria) {
            extraWhere += ` AND b.categoria ILIKE $${pi++}`;
            extraParams.push(`%${req.query.categoria}%`);
        }
        if (req.query.tipo_monumento) {
            extraWhere += ` AND b.tipo_monumento = $${pi++}`;
            extraParams.push(req.query.tipo_monumento);
        }
        if (req.query.periodo) {
            extraWhere += ` AND b.periodo = $${pi++}`;
            extraParams.push(req.query.periodo);
        }

        const result = await db.query(`
            SELECT b.id, b.denominacion, b.categoria, b.municipio, b.provincia, b.pais,
                   b.latitud, b.longitud, b.comunidad_autonoma,
                   b.tipo_monumento, b.periodo,
                   COALESCE(w.imagen_url, img.url) as imagen_url, w.descripcion, w.estilo, w.inception, w.arquitecto, w.wikipedia_url,
                   (6371 * acos(
                       cos(radians($1)) * cos(radians(b.latitud)) *
                       cos(radians(b.longitud) - radians($2)) +
                       sin(radians($1)) * sin(radians(b.latitud))
                   )) AS distancia_km
            FROM bienes b
            LEFT JOIN wikidata w ON b.id = w.bien_id
            LEFT JOIN LATERAL (SELECT url FROM imagenes WHERE bien_id = b.id LIMIT 1) img ON true
            WHERE b.latitud IS NOT NULL AND b.longitud IS NOT NULL
              AND (6371 * acos(
                  cos(radians($1)) * cos(radians(b.latitud)) *
                  cos(radians(b.longitud) - radians($2)) +
                  sin(radians($1)) * sin(radians(b.latitud))
              )) <= $3
              ${extraWhere}
            ORDER BY distancia_km
            LIMIT $4
        `, extraParams);

        res.json({
            centro: { lat, lng },
            radio_km: km,
            total: result.rows.length,
            items: result.rows,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/monumentos/:id
 * Detalle completo de un monumento
 */
app.get('/api/monumentos/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const bienResult = await db.query(`
            SELECT b.*, w.qid, w.descripcion as wiki_descripcion, w.imagen_url,
                   w.arquitecto, w.estilo, w.material, w.altura, w.superficie,
                   w.inception, w.heritage_label, w.wikipedia_url, w.commons_category,
                   s.descripcion_completa, s.sintesis_historica, s.datacion,
                   s.periodo_historico, s.siglo, s.ubicacion_detalle, s.fuentes,
                   s.bibliografia, s.url as sipca_url
            FROM bienes b
            LEFT JOIN wikidata w ON b.id = w.bien_id
            LEFT JOIN sipca s ON b.id = s.bien_id
            WHERE b.id = ?
        `, [id]);

        const bien = bienResult.rows[0];
        if (!bien) {
            return res.status(404).json({ error: 'Monumento no encontrado' });
        }

        const [imagenesResult, eventos] = await Promise.all([
            db.query(
                `SELECT url, titulo, autor, fuente, metadata
                 FROM (
                   SELECT DISTINCT ON (url) url, titulo, autor, fuente, metadata, id
                   FROM imagenes
                   WHERE bien_id = ?
                     AND url <> COALESCE(?, '')
                   ORDER BY url, id
                 ) sub
                 ORDER BY
                   CASE LOWER(COALESCE(fuente, ''))
                     WHEN 'wikidata' THEN 1
                     WHEN 'wikimedia commons' THEN 1
                     WHEN 'commons' THEN 1
                     WHEN 'sipca' THEN 2
                     WHEN 'diba' THEN 3
                     WHEN 'europeana' THEN 4
                     ELSE 5
                   END,
                   COALESCE((metadata->>'score')::int, 0) DESC NULLS LAST,
                   id`,
                [id, bien.imagen_url || null]
            ),
            db.obtenerEventosMonumento(id),
        ]);

        res.json({
            ...bien,
            imagenes: imagenesResult.rows,
            eventos,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/geojson
 * Exportar monumentos como GeoJSON (para mapas)
 */
app.get('/api/geojson', async (req, res) => {
    try {
        let where = ['b.latitud IS NOT NULL'];
        let params = [];
        let pi = 1;

        if (req.query.pais) {
            where.push(`b.pais = $${pi++}`);
            params.push(req.query.pais);
        }
        if (req.query.region) {
            where.push(`b.comunidad_autonoma = $${pi++}`);
            params.push(req.query.region);
        }
        if (req.query.provincia) {
            where.push(`b.provincia = $${pi++}`);
            params.push(req.query.provincia);
        }
        if (req.query.municipio) {
            where.push(`b.municipio = $${pi++}`);
            params.push(req.query.municipio);
        }
        if (req.query.categoria) {
            where.push(`b.categoria ILIKE $${pi++}`);
            params.push(`%${req.query.categoria}%`);
        }
        if (req.query.tipo) {
            where.push(`b.tipo ILIKE $${pi++}`);
            params.push(`%${req.query.tipo}%`);
        }
        if (req.query.estilo) {
            where.push(`w.estilo ILIKE $${pi++}`);
            params.push(`%${req.query.estilo}%`);
        }
        if (req.query.tipo_monumento) {
            where.push(`b.tipo_monumento = $${pi++}`);
            params.push(req.query.tipo_monumento);
        }
        if (req.query.clasificacion) {
            const tokens = String(req.query.clasificacion).split(',').map(s => s.trim()).filter(Boolean);
            const validTokens = tokens.filter(t => CLASIFICACION_GRUPOS[t] || t === 'otros');
            if (validTokens.length > 0) {
                const piRef = { value: pi };
                applyClasificacionFilter(validTokens.join(','), where, params, piRef);
                pi = piRef.value;
            }
        }
        if (req.query.periodo) {
            where.push(`b.periodo = $${pi++}`);
            params.push(req.query.periodo);
        }
        if (req.query.evento) {
            where.push(`EXISTS (SELECT 1 FROM eventos_monumento em WHERE em.bien_id = b.id AND em.qid_evento = $${pi++})`);
            params.push(req.query.evento);
        }
        if (req.query.evento_padre) {
            where.push(`EXISTS (SELECT 1 FROM eventos_monumento em WHERE em.bien_id = b.id AND em.qid_evento_padre = $${pi++})`);
            params.push(req.query.evento_padre);
        }
        if (req.query.con_eventos === 'true') {
            where.push('EXISTS (SELECT 1 FROM eventos_monumento em WHERE em.bien_id = b.id)');
        }
        if (req.query.q) {
            const qTokenized = String(req.query.q).trim().split(/\s+/).filter(Boolean).join('%');
            if (qTokenized) {
                // Buscar también en bien_aliases (BD search) para nombres alternativos
                let aliasBienIds = [];
                const searchPool = db.getSearchPool && db.getSearchPool();
                if (searchPool) {
                    try {
                        const r = await searchPool.query(
                            `SELECT DISTINCT bien_id FROM bien_aliases
                             WHERE unaccent(LOWER(alias)) ILIKE unaccent(LOWER($1)) LIMIT 200`,
                            [`%${qTokenized}%`]
                        );
                        aliasBienIds = r.rows.map(x => x.bien_id);
                    } catch (e) { console.error('alias search:', e.message); }
                }
                if (aliasBienIds.length > 0) {
                    where.push(`(unaccent(b.denominacion) ILIKE unaccent($${pi}) OR b.id = ANY($${pi + 1}::int[]))`);
                    params.push(`%${qTokenized}%`, aliasBienIds);
                    pi += 2;
                } else {
                    where.push(`unaccent(b.denominacion) ILIKE unaccent($${pi++})`);
                    params.push(`%${qTokenized}%`);
                }
            }
        }
        if (req.query.solo_coords === 'true') {
            where.push('b.latitud IS NOT NULL');
        }
        if (req.query.solo_wikidata === 'true') {
            where.push('w.qid IS NOT NULL');
        }
        if (req.query.solo_imagen === 'true') {
            where.push('w.imagen_url IS NOT NULL');
        }
        if (req.query.sin_imagen === 'true') {
            where.push('(w.imagen_url IS NULL AND NOT EXISTS (SELECT 1 FROM imagenes WHERE bien_id = b.id))');
        }
        // Oleada B — propiedades Wikidata estructuradas
        if (req.query.propietario) {
            where.push(`w.propietario ILIKE $${pi++}`);
            params.push(`%${req.query.propietario}%`);
        }
        if (req.query.religion) {
            // Si es macro (Catolicismo, etc.) expandir a variantes raw; sino usar tal cual
            const variantes = expandirReligionParaFiltro(req.query.religion);
            const orParts = variantes.map(() => `w.religion ILIKE $${pi++}`);
            where.push(`(${orParts.join(' OR ')})`);
            for (const v of variantes) params.push(`%${v}%`);
        }
        if (req.query.dedicado_a) {
            where.push(`w.dedicado_a ILIKE $${pi++}`);
            params.push(`%${req.query.dedicado_a}%`);
        }
        if (req.query.parte_de) {
            where.push(`w.parte_de ILIKE $${pi++}`);
            params.push(`%${req.query.parte_de}%`);
        }
        if (req.query.bbox) {
            const [minLon, minLat, maxLon, maxLat] = req.query.bbox.split(',').map(parseFloat);
            if (!isNaN(minLon) && !isNaN(minLat) && !isNaN(maxLon) && !isNaN(maxLat)) {
                where.push(`b.longitud >= $${pi} AND b.longitud <= $${pi+1} AND b.latitud >= $${pi+2} AND b.latitud <= $${pi+3}`);
                params.push(minLon, maxLon, minLat, maxLat);
                pi += 4;
            }
        }

        const limit = Math.min(2000, parseInt(req.query.limit) || 2000);

        let orderBy = '';
        if (req.query.bbox) {
            const [minLon, minLat, maxLon, maxLat] = req.query.bbox.split(',').map(parseFloat);
            const bboxArea = Math.abs((maxLon - minLon) * (maxLat - minLat));
            if (bboxArea > 100) {
                orderBy = 'ORDER BY b.comunidad_autonoma, RANDOM()';
            } else {
                orderBy = 'ORDER BY b.id';
            }
        } else {
            orderBy = 'ORDER BY b.comunidad_autonoma, RANDOM()';
        }

        params.push(limit);
        const query = `
            SELECT
                b.id, b.denominacion, b.tipo, b.categoria,
                b.municipio, b.provincia, b.comunidad_autonoma, b.pais,
                b.latitud, b.longitud, b.coords_precision,
                b.tipo_monumento, b.periodo, b.heritage_world,
                w.qid, w.imagen_url, w.estilo
            FROM bienes b
            LEFT JOIN wikidata w ON b.id = w.bien_id
            WHERE ${where.join(' AND ')}
            ${orderBy}
            LIMIT $${pi}
        `;

        const result = await db.query(query, params);

        const geojson = {
            type: 'FeatureCollection',
            features: result.rows.map(item => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [item.longitud, item.latitud],
                },
                properties: {
                    id: item.id,
                    nombre: item.denominacion,
                    tipo: item.tipo,
                    categoria: item.categoria,
                    municipio: item.municipio,
                    provincia: item.provincia,
                    region: item.comunidad_autonoma,
                    pais: item.pais,
                    qid: item.qid,
                    imagen: item.imagen_url,
                    estilo: item.estilo,
                    tipo_monumento: item.tipo_monumento,
                    periodo: item.periodo,
                    coords_precision: item.coords_precision,
                    heritage_world: item.heritage_world,
                },
            })),
        };

        res.json(geojson);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/filtros
 * Valores disponibles para filtros (provincias, municipios, etc.)
 */
app.get('/api/filtros', async (req, res) => {
    try {
        const { pais, region, provincia } = req.query;
        const religionActiva = req.query.religion;
        const dedicadoActivo = req.query.dedicado_a;
        const parteActiva = req.query.parte_de;
        const propActivo = req.query.propietario;

        // ========= CASCADA UNIFICADA =========
        // Devuelve subquery "SELECT DISTINCT b.id FROM ... WHERE ..." con TODOS los filtros activos
        // EXCEPTO el campo que se está calculando. Cada query del endpoint hace b.id IN (subquery).
        function buildBienIdSubquery(excludeField) {
            const parts = ['1=1'];
            const params = [];
            let p = 1;
            let needsWikidata = false;
            let needsEventos = false;

            // GEO
            if (pais && excludeField !== 'pais') {
                parts.push(`b.pais = $${p++}`);
                params.push(pais);
            }
            if (region && excludeField !== 'region') {
                parts.push(`b.comunidad_autonoma = $${p++}`);
                params.push(region);
            }
            if (provincia && excludeField !== 'provincia') {
                parts.push(`b.provincia = $${p++}`);
                params.push(provincia);
            }

            // CLASIFICACIÓN (expandida a IN de tipos via CLASIFICACION_GRUPOS)
            // Sí se aplica al calcular tipo_monumento: si has elegido religiosa, los tipos disponibles son los religiosos
            if (req.query.clasificacion && excludeField !== 'clasificacion') {
                const tokens = String(req.query.clasificacion).split(',').map(s => s.trim()).filter(Boolean);
                const validTokens = tokens.filter(t => CLASIFICACION_GRUPOS[t] || t === 'otros');
                if (validTokens.length > 0) {
                    const tiposExp = new Set();
                    let includeOtros = false;
                    for (const t of validTokens) {
                        if (t === 'otros') includeOtros = true;
                        else CLASIFICACION_GRUPOS[t].forEach(v => tiposExp.add(v));
                    }
                    const tiposArr = Array.from(tiposExp);
                    const conds = [];
                    if (tiposArr.length > 0) {
                        const ph = tiposArr.map(() => `$${p++}`);
                        conds.push(`b.tipo_monumento IN (${ph.join(',')})`);
                        params.push(...tiposArr);
                    }
                    if (includeOtros) {
                        const ph = ALL_CLASSIFIED_TIPOS.map(() => `$${p++}`);
                        conds.push(`(b.tipo_monumento IS NULL OR b.tipo_monumento NOT IN (${ph.join(',')}))`);
                        params.push(...ALL_CLASSIFIED_TIPOS);
                    }
                    if (conds.length > 0) parts.push(`(${conds.join(' OR ')})`);
                }
            }

            // TIPO MONUMENTO
            if (req.query.tipo_monumento && excludeField !== 'tipo_monumento') {
                parts.push(`b.tipo_monumento = $${p++}`);
                params.push(req.query.tipo_monumento);
            }

            // PERIODO
            if (req.query.periodo && excludeField !== 'periodo') {
                parts.push(`b.periodo = $${p++}`);
                params.push(req.query.periodo);
            }

            // ESTILO (JOIN wikidata)
            if (req.query.estilo && excludeField !== 'estilo') {
                needsWikidata = true;
                parts.push(`w.estilo = $${p++}`);
                params.push(req.query.estilo);
            }

            // EVENTO_PADRE (JOIN eventos_monumento)
            if (req.query.evento_padre && excludeField !== 'evento_padre' && excludeField !== 'evento') {
                needsEventos = true;
                parts.push(`em.qid_evento_padre = $${p++}`);
                params.push(req.query.evento_padre);
            }

            // EVENTO
            if (req.query.evento && excludeField !== 'evento') {
                needsEventos = true;
                parts.push(`em.qid_evento = $${p++}`);
                params.push(req.query.evento);
            }

            // OLEADA B
            const olApply = (col, valor, expandir = null) => {
                needsWikidata = true;
                const valores = expandir ? expandir(valor) : [valor];
                const orParts = [];
                for (const v of valores) {
                    const low = v.toLowerCase();
                    orParts.push(
                        `LOWER(${col}) = $${p} OR LOWER(${col}) LIKE $${p + 1} OR LOWER(${col}) LIKE $${p + 2} OR LOWER(${col}) LIKE $${p + 3}`
                    );
                    params.push(low, `${low}|%`, `%|${low}|%`, `%|${low}`);
                    p += 4;
                }
                parts.push(`(${orParts.join(' OR ')})`);
            };
            if (religionActiva && excludeField !== 'religion') {
                olApply('w.religion', religionActiva, expandirReligionParaFiltro);
            }
            if (dedicadoActivo && excludeField !== 'dedicado_a') olApply('w.dedicado_a', dedicadoActivo);
            if (parteActiva && excludeField !== 'parte_de') olApply('w.parte_de', parteActiva);
            if (propActivo && excludeField !== 'propietario') olApply('w.propietario', propActivo);

            // Si no hay ningún filtro activo aparte del 1=1, retornar null (no filtrar)
            if (parts.length === 1) return null;

            let fromClause = 'FROM bienes b';
            if (needsWikidata) fromClause += ' LEFT JOIN wikidata w ON b.id = w.bien_id';
            if (needsEventos) fromClause += ' LEFT JOIN eventos_monumento em ON b.id = em.bien_id';

            return {
                sql: `SELECT DISTINCT b.id ${fromClause} WHERE ${parts.join(' AND ')}`,
                params,
            };
        }

        // Helper: aplica cascada a una query base
        // Devuelve { whereExtra, params } - whereExtra es "AND b.id IN (subquery)" o cadena vacía
        function applyCascada(excludeField, tableAlias = 'b') {
            const sub = buildBienIdSubquery(excludeField);
            if (!sub) return { whereExtra: '', params: [] };
            return {
                whereExtra: ` AND ${tableAlias}.${tableAlias === 'b' ? 'id' : 'bien_id'} IN (${sub.sql})`,
                params: sub.params,
            };
        }

        // Legacy: whereClause solo geográfico (mantenido para queries que no migraron aún)
        let whereParams = [];
        let whereParts = [];
        let pi = 1;
        if (pais) { whereParts.push(`b.pais = $${pi++}`); whereParams.push(pais); }
        if (region) { whereParts.push(`b.comunidad_autonoma = $${pi++}`); whereParams.push(region); }
        if (provincia) { whereParts.push(`b.provincia = $${pi++}`); whereParams.push(provincia); }
        const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : '1=1';

        // Países con cascada
        const cascPais = applyCascada('pais');
        const paisesR = await db.query(`
            SELECT pais as value, COUNT(*) as count
            FROM bienes b WHERE pais IS NOT NULL ${cascPais.whereExtra}
            GROUP BY pais ORDER BY LOWER(pais)
        `, cascPais.params);

        // Regiones con cascada
        const cascReg = applyCascada('region');
        const regionesR = await db.query(`
            SELECT comunidad_autonoma as value, pais, COUNT(*) as count
            FROM bienes b WHERE comunidad_autonoma IS NOT NULL ${cascReg.whereExtra}
            GROUP BY comunidad_autonoma, pais ORDER BY LOWER(comunidad_autonoma)
        `, cascReg.params);

        // Provincias con cascada
        const cascProv = applyCascada('provincia');
        const provinciasR = await db.query(`
            SELECT provincia as value, comunidad_autonoma as region, pais, COUNT(*) as count
            FROM bienes b WHERE provincia IS NOT NULL ${cascProv.whereExtra}
            GROUP BY provincia, comunidad_autonoma, pais ORDER BY LOWER(provincia)
        `, cascProv.params);

        // Estilos filtrados (con cascada — excluye estilo)
        const cascEstilo = applyCascada('estilo');
        const estilosR = await db.query(`
            SELECT w.estilo as value, COUNT(*) as count
            FROM wikidata w
            JOIN bienes b ON w.bien_id = b.id
            WHERE w.estilo IS NOT NULL AND w.estilo != '' ${cascEstilo.whereExtra}
            GROUP BY w.estilo ORDER BY LOWER(w.estilo)
        `, cascEstilo.params);
        const estilos = normalizarEstilos(estilosR.rows);

        // Tipos de monumento filtrados
        const cascTipo = applyCascada('tipo_monumento');
        const tiposMonumentoR = await db.query(`
            SELECT b.tipo_monumento as value, COUNT(*) as count
            FROM bienes b
            WHERE b.tipo_monumento IS NOT NULL ${cascTipo.whereExtra}
            GROUP BY b.tipo_monumento ORDER BY LOWER(b.tipo_monumento)
        `, cascTipo.params);

        // Periodos filtrados
        const cascPer = applyCascada('periodo');
        const periodosR = await db.query(`
            SELECT b.periodo as value, COUNT(*) as count
            FROM bienes b
            WHERE b.periodo IS NOT NULL ${cascPer.whereExtra}
            GROUP BY b.periodo ORDER BY LOWER(b.periodo)
        `, cascPer.params);

        // Municipios filtrados (solo si hay al menos un filtro geográfico para evitar queries masivas)
        let municipiosR;
        if (pais || region || provincia) {
            const cascMun = applyCascada('municipio');
            municipiosR = await db.query(`
                SELECT b.municipio as value, b.provincia as provincia,
                       b.comunidad_autonoma as region, b.pais, COUNT(*) as count
                FROM bienes b
                WHERE b.municipio IS NOT NULL AND b.municipio != '' ${cascMun.whereExtra}
                GROUP BY b.municipio, b.provincia, b.comunidad_autonoma, b.pais
                ORDER BY LOWER(b.municipio)
            `, cascMun.params);
        } else {
            municipiosR = { rows: [] };
        }

        // Eventos históricos (con cascada)
        const cascEv = applyCascada('evento');
        const eventosR = await db.query(`
            SELECT em.qid_evento as value,
                   em.qid_evento_padre as padre,
                   MIN(em.evento) as label,
                   COUNT(DISTINCT em.bien_id) as count
            FROM eventos_monumento em
            JOIN bienes b ON em.bien_id = b.id
            WHERE em.qid_evento IS NOT NULL AND em.qid_evento_padre IS NOT NULL ${cascEv.whereExtra}
            GROUP BY em.qid_evento, em.qid_evento_padre
            ORDER BY LOWER(MIN(em.evento))
        `, cascEv.params);

        const cascEvP = applyCascada('evento_padre');
        const eventosPadresR = await db.query(`
            SELECT em.qid_evento_padre as value,
                   COUNT(DISTINCT em.bien_id) as count
            FROM eventos_monumento em
            JOIN bienes b ON em.bien_id = b.id
            WHERE em.qid_evento_padre IS NOT NULL ${cascEvP.whereExtra}
            GROUP BY em.qid_evento_padre
        `, cascEvP.params);

        // Hardcoded labels para las categorías padre (fallback si i18n no traduce)
        const PADRE_LABELS = {
            'Q10859':   'Guerra Civil Española',
            'Q152499':  'Guerra de Independencia Española',
            'Q150701':  'Guerra de Sucesión Española',
            'Q79791':   'Reconquista',
            'Q1178424': 'Guerras Carlistas',
            'Q1501724': 'Guerra de Restauración portuguesa',
            'Q2105495': 'Crisis de 1383-1385',
            'Q164432':  'Guerra de los Ochenta Años',
            'Q51657':   'Cruzada albigense',
            'Q78994':   'Guerras Napoleónicas',
            'Q362':     'Segunda Guerra Mundial',
            'Q1200506': 'Desamortización española',
            'Q6534':    'Revolución Francesa',
            'Q66344':   'Revolución Industrial',
            'Q166713':  'Risorgimento',
            'Q8065':    'Desastres naturales',
        };
        for (const row of eventosPadresR.rows) {
            row.label = PADRE_LABELS[row.value] || row.value;
        }
        eventosPadresR.rows.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));

        // Oleada B con cascada extendida (incluye geo + clasif + tipo + estilo + periodo + evento + otros Oleada B)
        const cascProp = applyCascada('propietario');
        const propietariosR = await db.query(`
            SELECT value, COUNT(*) as count FROM (
              SELECT TRIM(unnest(string_to_array(w.propietario, '|'))) as value
              FROM wikidata w JOIN bienes b ON w.bien_id = b.id
              WHERE w.propietario IS NOT NULL AND w.propietario != '' ${cascProp.whereExtra}
            ) sub
            WHERE value <> '' AND value !~ '^Q[0-9]+$'
            GROUP BY value
            ORDER BY count DESC LIMIT 100
        `, cascProp.params).catch(() => ({ rows: [] }));

        const cascRel = applyCascada('religion');
        const religionesRawR = await db.query(`
            SELECT value, COUNT(*) as count FROM (
              SELECT TRIM(unnest(string_to_array(w.religion, '|'))) as value
              FROM wikidata w JOIN bienes b ON w.bien_id = b.id
              WHERE w.religion IS NOT NULL AND w.religion != '' ${cascRel.whereExtra}
            ) sub
            WHERE value <> '' AND value !~ '^Q[0-9]+$'
            GROUP BY value
        `, cascRel.params).catch(() => ({ rows: [] }));

        const religionesR = { rows: normalizarReligiones(religionesRawR.rows) };

        const cascDed = applyCascada('dedicado_a');
        const dedicacionesR = await db.query(`
            SELECT value, COUNT(*) as count FROM (
              SELECT TRIM(unnest(string_to_array(w.dedicado_a, '|'))) as value
              FROM wikidata w JOIN bienes b ON w.bien_id = b.id
              WHERE w.dedicado_a IS NOT NULL AND w.dedicado_a != '' ${cascDed.whereExtra}
            ) sub
            WHERE value <> '' AND value !~ '^Q[0-9]+$'
            GROUP BY value
            ORDER BY count DESC LIMIT 100
        `, cascDed.params).catch(() => ({ rows: [] }));

        const cascParte = applyCascada('parte_de');
        const partesDeR = await db.query(`
            SELECT value, COUNT(*) as count FROM (
              SELECT TRIM(unnest(string_to_array(w.parte_de, '|'))) as value
              FROM wikidata w JOIN bienes b ON w.bien_id = b.id
              WHERE w.parte_de IS NOT NULL AND w.parte_de != '' ${cascParte.whereExtra}
            ) sub
            WHERE value <> '' AND value !~ '^Q[0-9]+$'
            GROUP BY value
            ORDER BY count DESC LIMIT 200
        `, cascParte.params).catch(() => ({ rows: [] }));

        // Capitalizar primera letra + reordenar alfabético (post-capitalize) en JS
        const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        const alphaSort = (a, b) => a.value.localeCompare(b.value, 'es', { sensitivity: 'base' });
        for (const arr of [propietariosR.rows, dedicacionesR.rows, partesDeR.rows]) {
            for (const row of arr) row.value = capitalize(row.value);
            arr.sort(alphaSort);
        }
        religionesR.rows.sort(alphaSort);

        res.json({
            paises: paisesR.rows,
            regiones: regionesR.rows,
            provincias: provinciasR.rows,
            municipios: municipiosR.rows,
            estilos,
            tipos_monumento: tiposMonumentoR.rows,
            periodos: periodosR.rows,
            eventos: eventosR.rows,
            eventos_padres: eventosPadresR.rows,
            propietarios: propietariosR.rows,
            religiones: religionesR.rows,
            dedicaciones: dedicacionesR.rows,
            partes_de: partesDeR.rows,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/ccaa-resumen
 * Resumen por CCAA para el mapa (1 punto por región con conteo)
 */
app.get('/api/ccaa-resumen', async (req, res) => {
    try {
        let where = ['b.comunidad_autonoma IS NOT NULL', 'b.latitud IS NOT NULL'];
        let params = [];
        let pi = 1;
        if (req.query.pais)       { where.push(`b.pais = $${pi++}`);              params.push(req.query.pais); }
        if (req.query.region)     { where.push(`b.comunidad_autonoma = $${pi++}`); params.push(req.query.region); }
        if (req.query.provincia)  { where.push(`b.provincia = $${pi++}`);          params.push(req.query.provincia); }
        if (req.query.municipio)  { where.push(`b.municipio = $${pi++}`);          params.push(req.query.municipio); }
        if (req.query.tipo_monumento) { where.push(`b.tipo_monumento = $${pi++}`); params.push(req.query.tipo_monumento); }
        if (req.query.periodo)    { where.push(`b.periodo = $${pi++}`);            params.push(req.query.periodo); }
        if (req.query.clasificacion) {
            const tokens = String(req.query.clasificacion).split(',').map(s => s.trim()).filter(Boolean);
            const validTokens = tokens.filter(t => CLASIFICACION_GRUPOS[t] || t === 'otros');
            if (validTokens.length > 0) {
                const piRef = { value: pi };
                applyClasificacionFilter(validTokens.join(','), where, params, piRef);
                pi = piRef.value;
            }
        }
        if (req.query.estilo) {
            where.push(`EXISTS (SELECT 1 FROM wikidata w WHERE w.bien_id = b.id AND w.estilo ILIKE $${pi++})`);
            params.push(`%${req.query.estilo}%`);
        }
        if (req.query.evento) {
            where.push(`EXISTS (SELECT 1 FROM eventos_monumento em WHERE em.bien_id = b.id AND em.qid_evento = $${pi++})`);
            params.push(req.query.evento);
        }
        if (req.query.evento_padre) {
            where.push(`EXISTS (SELECT 1 FROM eventos_monumento em WHERE em.bien_id = b.id AND em.qid_evento_padre = $${pi++})`);
            params.push(req.query.evento_padre);
        }
        if (req.query.q) {
            // Tokenize by whitespace and join with % so "castillo olite" matches "Castillo de Olite"
            const qTokenized = String(req.query.q).trim().split(/\s+/).filter(Boolean).join('%');
            if (qTokenized) {
                where.push(`unaccent(b.denominacion) ILIKE unaccent($${pi++})`);
                params.push(`%${qTokenized}%`);
            }
        }
        if (req.query.solo_wikidata === 'true') {
            where.push('EXISTS (SELECT 1 FROM wikidata w WHERE w.bien_id = b.id AND w.qid IS NOT NULL)');
        }
        if (req.query.solo_imagen === 'true') {
            where.push('EXISTS (SELECT 1 FROM imagenes i WHERE i.bien_id = b.id)');
        }

        const resumenR = await db.query(`
            SELECT
                b.comunidad_autonoma as region,
                b.pais,
                COUNT(*) as total,
                COUNT(*) as con_coords,
                AVG(b.latitud) as lat_centro,
                AVG(b.longitud) as lon_centro
            FROM bienes b
            WHERE ${where.join(' AND ')}
            GROUP BY b.comunidad_autonoma, b.pais
            ORDER BY total DESC
        `, params);

        // Centros aproximados de cada CCAA/región
        const centros = {
            'Catalunya': [41.8, 1.6],
            'Andalucia': [37.5, -4.5],
            'Navarra': [42.7, -1.65],
            'Castilla-La Mancha': [39.3, -3.0],
            'Comunidad de Madrid': [40.4, -3.7],
            'Castilla y Leon': [41.6, -4.0],
            'Illes Balears': [39.6, 2.9],
            'Pais Vasco': [43.0, -2.5],
            'Aragon': [41.5, -0.9],
            'Galicia': [42.7, -8.0],
            'Region de Murcia': [38.0, -1.5],
            'Canarias': [28.3, -15.8],
            'Extremadura': [39.0, -6.0],
            'Cantabria': [43.2, -4.0],
            'Comunitat Valenciana': [39.5, -0.5],
            'Asturias': [43.3, -6.0],
            'La Rioja': [42.3, -2.5],
            'Lisboa': [38.7, -9.1],
            'Porto': [41.15, -8.6],
            'Braga': [41.55, -8.4],
            'Setúbal': [38.5, -8.9],
            'Aveiro': [40.6, -8.7],
            'Faro': [37.0, -7.9],
            'Leiria': [39.7, -8.8],
            'Coimbra': [40.2, -8.4],
            'Santarém': [39.2, -8.7],
            'Viseu': [40.7, -7.9],
            'Évora': [38.6, -7.9],
            'Guarda': [40.5, -7.3],
            'Beja': [38.0, -7.9],
            'Bragança': [41.8, -6.8],
            'Vila Real': [41.3, -7.7],
            'Viana do Castelo': [41.7, -8.8],
            'Castelo Branco': [39.8, -7.5],
            'Portalegre': [39.3, -7.4],
            'Açores': [38.7, -27.2],
            'Madeira': [32.7, -17.0],
            'Île-de-France': [48.86, 2.35],
            'Nouvelle-Aquitaine': [45.2, 0.0],
            'Auvergne-Rhône-Alpes': [45.4, 4.4],
            'Occitanie': [43.6, 1.44],
            'Grand Est': [48.6, 6.2],
            'Hauts-de-France': [49.9, 2.8],
            'Bretagne': [48.2, -2.8],
            'Bourgogne-Franche-Comté': [47.0, 5.0],
            'Normandie': [49.0, -0.4],
            'Pays de la Loire': [47.5, -1.0],
            'Centre-Val de Loire': [47.4, 1.5],
            'Provence-Alpes-Côte d\'Azur': [43.5, 5.4],
            'Corse': [42.2, 9.1],
        };

        const features = resumenR.rows.map(r => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: centros[r.region] ? [centros[r.region][1], centros[r.region][0]] : [r.lon_centro, r.lat_centro],
            },
            properties: {
                region: r.region,
                pais: r.pais,
                total: r.total,
                con_coords: r.con_coords,
            },
        }));

        res.json({
            type: 'FeatureCollection',
            features,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/municipios
 * Lista de municipios (para autocomplete)
 */
app.get('/api/municipios', async (req, res) => {
    try {
        let where = ['municipio IS NOT NULL'];
        let params = [];
        let pi = 1;

        if (req.query.pais) {
            where.push(`pais = $${pi++}`);
            params.push(req.query.pais);
        }
        if (req.query.region) {
            where.push(`comunidad_autonoma = $${pi++}`);
            params.push(req.query.region);
        }
        if (req.query.provincia) {
            where.push(`provincia = $${pi++}`);
            params.push(req.query.provincia);
        }
        if (req.query.q) {
            where.push(`municipio ILIKE $${pi++}`);
            params.push(`${req.query.q}%`);
        }

        const limit = Math.min(100, parseInt(req.query.limit) || 50);
        params.push(limit);

        const result = await db.query(`
            SELECT DISTINCT municipio as value, provincia, comunidad_autonoma as region, COUNT(*) as count
            FROM bienes
            WHERE ${where.join(' AND ')}
            GROUP BY municipio, provincia, comunidad_autonoma
            ORDER BY count DESC
            LIMIT $${pi}
        `, params);

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/contactos
 * Crear un nuevo contacto
 */
app.post('/api/contactos', async (req, res) => {
    try {
        const { municipio, provincia, comunidad_autonoma, email_general, email_patrimonio, persona_contacto, cargo, telefono, web, fuente, tipo, pais } = req.body;
        if (!municipio) return res.status(400).json({ error: 'El nombre/municipio es obligatorio' });

        const result = await db.query(`
            INSERT INTO contactos_municipios (municipio, provincia, comunidad_autonoma, email_general, email_patrimonio, persona_contacto, cargo, telefono, web, fuente, tipo, pais, fecha_actualizacion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
            RETURNING *
        `, [municipio, provincia || null, comunidad_autonoma || null, email_general || null, email_patrimonio || null, persona_contacto || null, cargo || null, telefono || null, web || null, fuente || null, tipo || 'otro', pais || 'España']);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/contactos
 * Lista de contactos de municipios con filtros y paginación
 */
app.get('/api/contactos', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, parseInt(req.query.limit) || 50);
        const offset = (page - 1) * limit;

        let where = [];
        let params = [];
        let pi = 1;

        if (req.query.region) {
            where.push(`comunidad_autonoma = $${pi++}`);
            params.push(req.query.region);
        }
        if (req.query.provincia) {
            where.push(`provincia = $${pi++}`);
            params.push(req.query.provincia);
        }
        if (req.query.municipio) {
            where.push(`municipio ILIKE $${pi++}`);
            params.push(`%${req.query.municipio}%`);
        }
        if (req.query.solo_con_email === 'true') {
            where.push('(email_patrimonio IS NOT NULL OR email_general IS NOT NULL)');
        }
        if (req.query.solo_sin_email === 'true') {
            where.push('email_patrimonio IS NULL AND email_general IS NULL');
        }
        if (req.query.solo_con_telefono === 'true') {
            where.push('telefono IS NOT NULL');
        }
        if (req.query.solo_sin_telefono === 'true') {
            where.push('telefono IS NULL');
        }
        if (req.query.tipo) {
            where.push(`tipo = $${pi++}`);
            params.push(req.query.tipo);
        }

        const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const CONTACT_SORT = {
            'nombre_asc': 'LOWER(municipio) ASC',
            'nombre_desc': 'LOWER(municipio) DESC',
            'provincia_asc': 'LOWER(provincia) ASC, LOWER(municipio) ASC',
            'ccaa_asc': 'LOWER(comunidad_autonoma) ASC, LOWER(municipio) ASC',
        };
        const orderBy = CONTACT_SORT[req.query.sort] || CONTACT_SORT['nombre_asc'];

        const countParams = [...params];
        params.push(limit, offset);

        const totalR = await db.query(`SELECT COUNT(*) as n FROM contactos_municipios ${whereClause}`, countParams);
        const total = totalR.rows[0].n;

        const itemsR = await db.query(
            `SELECT * FROM contactos_municipios ${whereClause} ORDER BY ${orderBy} LIMIT $${pi++} OFFSET $${pi}`,
            params
        );

        res.json({ page, limit, total, total_pages: Math.ceil(total / limit), items: itemsR.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/contactos/stats
 * Estadísticas de contactos recopilados
 */
app.get('/api/contactos/stats', async (req, res) => {
    try {
        res.json(await db.estadisticasContactos());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/contactos/:id
 * Editar campos de un contacto
 */
app.patch('/api/contactos/:id', async (req, res) => {
    try {
        const result = await db.actualizarContacto(parseInt(req.params.id), req.body);
        if (!result || result.changes === 0) return res.status(404).json({ error: 'Contacto no encontrado' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/contactos/:id/notas
 * Obtener notas de un contacto
 */
app.get('/api/contactos/:id/notas', async (req, res) => {
    try {
        res.json(await db.obtenerNotasContacto(parseInt(req.params.id)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/contactos/:id/notas
 * Crear una nota en un contacto
 */
app.post('/api/contactos/:id/notas', async (req, res) => {
    try {
        const { texto, es_tarea } = req.body;
        if (!texto || !texto.trim()) return res.status(400).json({ error: 'Texto requerido' });
        const nota = await db.crearNotaContacto(parseInt(req.params.id), texto.trim(), !!es_tarea);
        res.status(201).json(nota);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/contactos/:id/notas/:notaId
 * Actualizar una nota (es_tarea, completada)
 */
app.patch('/api/contactos/:id/notas/:notaId', async (req, res) => {
    try {
        const nota = await db.actualizarNota(parseInt(req.params.notaId), req.body);
        if (!nota) return res.status(404).json({ error: 'Nota no encontrada' });
        res.json(nota);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/contactos/:id/notas/:notaId
 * Eliminar una nota
 */
app.delete('/api/contactos/:id/notas/:notaId', async (req, res) => {
    try {
        await db.eliminarNotaContacto(parseInt(req.params.notaId));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/tareas
 * Listar todas las notas marcadas como tarea
 */
app.get('/api/tareas', async (req, res) => {
    try {
        const filtros = {};
        if (req.query.completada === 'true') filtros.completada = true;
        if (req.query.completada === 'false') filtros.completada = false;
        res.json(await db.obtenerTareas(filtros));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== EMAIL MASIVO ==============

/**
 * Genera un PDF en memoria con el listado de monumentos de un municipio
 * @param {string} municipio - Nombre del municipio
 * @returns {Promise<Buffer>} Buffer del PDF generado
 */
async function generarPDFMonumentos(municipio) {
    const result = await db.query(`
        SELECT b.denominacion, b.categoria, b.tipo, w.estilo
        FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE b.municipio = $1
        ORDER BY LOWER(b.denominacion) ASC
    `, [municipio]);

    const monumentos = result.rows;

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Título
        doc.fontSize(18).font('Helvetica-Bold')
           .text(`Monumentos de ${municipio}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(9).font('Helvetica').fillColor('#666')
           .text(`Generado el ${new Date().toLocaleDateString('es-ES')} - ${monumentos.length} monumento${monumentos.length !== 1 ? 's' : ''}`, { align: 'center' });
        doc.moveDown(1);

        if (monumentos.length === 0) {
            doc.fontSize(11).font('Helvetica').fillColor('#333')
               .text('No se encontraron monumentos registrados para este municipio.');
        } else {
            // Cabecera de tabla
            const startX = 50;
            const colWidths = [210, 120, 100, 65];
            const headers = ['Denominacion', 'Categoria', 'Tipo', 'Estilo'];
            let y = doc.y;

            doc.fontSize(8).font('Helvetica-Bold').fillColor('#333');
            headers.forEach((h, i) => {
                const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
                doc.text(h, x, y, { width: colWidths[i], continued: false });
            });
            y = doc.y + 4;
            doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y).strokeColor('#ccc').stroke();
            y += 6;

            // Filas
            doc.font('Helvetica').fontSize(7.5).fillColor('#333');
            for (const m of monumentos) {
                if (y > 760) {
                    doc.addPage();
                    y = 50;
                }
                const values = [
                    m.denominacion || '--',
                    m.categoria || '--',
                    m.tipo || '--',
                    m.estilo || '--',
                ];
                values.forEach((v, i) => {
                    const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
                    doc.text(v, x, y, { width: colWidths[i] - 5, lineBreak: false });
                });
                y = doc.y + 3;
            }
        }

        // Pie
        doc.moveDown(2);
        doc.fontSize(8).font('Helvetica').fillColor('#999')
           .text('Fuente: Patrimonio Europeo', { align: 'center' });

        doc.end();
    });
}

// Estado global del envío en curso
let emailJob = null;

/**
 * POST /api/email/send
 * Envía emails secuencialmente a los contactos seleccionados
 */
app.post('/api/email/send', upload.array('archivos', 10), async (req, res) => {
    try {
        if (emailJob && emailJob.running) {
            return res.status(409).json({ error: 'Ya hay un envío en curso. Espera a que termine.' });
        }

        // Con multipart, los campos texto llegan como strings
        const contacto_ids = JSON.parse(req.body.contacto_ids || '[]');
        const { asunto, cuerpo, gmail_user, gmail_pass } = req.body;
        const incluir_pdf_monumentos = req.body.incluir_pdf_monumentos === 'true';

        if (!contacto_ids?.length) return res.status(400).json({ error: 'No hay contactos seleccionados' });
        if (!asunto || !cuerpo) return res.status(400).json({ error: 'Asunto y cuerpo requeridos' });
        if (!gmail_user || !gmail_pass) return res.status(400).json({ error: 'Credenciales Gmail requeridas' });

        // Archivos adjuntos genéricos (iguales para todos los destinatarios)
        const archivosComunes = (req.files || []).map(f => ({
            filename: f.originalname,
            content: f.buffer,
        }));

        // Obtener contactos con email
        const placeholders = contacto_ids.map((_, idx) => `$${idx + 1}`).join(',');
        const contactosR = await db.query(
            `SELECT * FROM contactos_municipios WHERE id IN (${placeholders}) AND (email_general IS NOT NULL OR email_patrimonio IS NOT NULL)`,
            contacto_ids
        );
        const contactos = contactosR.rows;

        if (contactos.length === 0) {
            return res.status(400).json({ error: 'Ninguno de los contactos seleccionados tiene email' });
        }

        // Crear transporter con Gmail
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmail_user, pass: gmail_pass },
            pool: true,
            maxConnections: 1,
            maxMessages: 3,
            rateDelta: 20000,
            rateLimit: 1,
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 30000,
        });

        // Iniciar job - responder inmediatamente (Render tiene timeout de 30s)
        emailJob = {
            running: true,
            total: contactos.length,
            sent: 0,
            failed: 0,
            errors: [],
            started_at: new Date().toISOString(),
        };

        res.json({ ok: true, total: contactos.length, message: `Iniciando envío a ${contactos.length} contactos` });

        // Verificar credenciales y enviar en background
        (async () => {
            // Verificar credenciales antes de enviar
            try {
                await Promise.race([
                    transporter.verify(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout conectando a Gmail SMTP (15s)')), 15000))
                ]);
            } catch (err) {
                transporter.close();
                emailJob.running = false;
                emailJob.failed = contactos.length;
                emailJob.errors.push({ municipio: '(todos)', email: '-', error: `Autenticación Gmail fallida: ${err.message}` });
                emailJob.finished_at = new Date().toISOString();
                console.error(`[Email] Auth failed: ${err.message}`);
                return;
            }

            for (let i = 0; i < contactos.length; i++) {
                if (!emailJob.running) break;

                const c = contactos[i];
                const email = c.email_patrimonio || c.email_general;
                const asuntoFinal = asunto.replace(/\{municipio\}/gi, c.municipio);
                const cuerpoFinal = cuerpo.replace(/\{municipio\}/gi, c.municipio);

                // Construir adjuntos para este email
                const attachments = [...archivosComunes];

                // PDF específico por municipio
                if (incluir_pdf_monumentos) {
                    try {
                        const pdfBuffer = await generarPDFMonumentos(c.municipio);
                        const safeNombre = c.municipio.replace(/[^a-zA-Z0-9áéíóúñüÁÉÍÓÚÑÜ ]/g, '_');
                        attachments.push({
                            filename: `Monumentos_de_${safeNombre}.pdf`,
                            content: pdfBuffer,
                            contentType: 'application/pdf',
                        });
                    } catch (pdfErr) {
                        console.error(`[Email] Error generando PDF para ${c.municipio}: ${pdfErr.message}`);
                    }
                }

                try {
                    const firma = `
<br><br>
<table cellpadding="0" cellspacing="0" style="border-top: 2px solid #3b82f6; padding-top: 12px; margin-top: 20px; font-family: Arial, sans-serif;">
  <tr>
    <td style="vertical-align: middle; padding-right: 14px; font-size: 36px;">🏛️</td>
    <td style="vertical-align: middle;">
      <strong style="color: #1a365d; font-size: 15px;">Patrimonio Europeo</strong><br>
      <span style="color: #64748b; font-size: 12px;">Descubre el patrimonio arquitectónico de Europa</span><br>
      <a href="https://patrimonio-europeo.netlify.app" style="color: #3b82f6; font-size: 13px; text-decoration: none;">patrimonio-europeo.netlify.app</a>
    </td>
  </tr>
</table>`;
                    const htmlBody = cuerpoFinal.replace(/\n/g, '<br>') + firma;
                    const textBody = cuerpoFinal + '\n\n---\n🏛️ Patrimonio Europeo\nDescubre el patrimonio arquitectónico de Europa\nhttps://patrimonio-europeo.netlify.app';

                    await transporter.sendMail({
                        from: gmail_user,
                        to: email,
                        subject: asuntoFinal,
                        text: textBody,
                        html: htmlBody,
                        attachments,
                    });
                    emailJob.sent++;
                    const maskEmail = (e) => e ? e.replace(/^(.{2})[^@]*(@.*)$/, '$1***$2') : 'unknown';
                    console.log(`[Email ${i + 1}/${contactos.length}] OK -> ${maskEmail(email)} (${c.municipio})${attachments.length ? ` [${attachments.length} adjunto${attachments.length !== 1 ? 's' : ''}]` : ''}`);
                } catch (err) {
                    emailJob.failed++;
                    emailJob.errors.push({ municipio: c.municipio, email, error: err.message });
                    const maskEmail = (e) => e ? e.replace(/^(.{2})[^@]*(@.*)$/, '$1***$2') : 'unknown';
                    console.error(`[Email ${i + 1}/${contactos.length}] ERROR -> ${maskEmail(email)}: ${err.message}`);
                }

                // Delay entre emails
                if (i < contactos.length - 1 && emailJob.running) {
                    const delay = 15000 + Math.random() * 10000;
                    await new Promise(r => setTimeout(r, delay));
                }
            }
            emailJob.running = false;
            emailJob.finished_at = new Date().toISOString();
            transporter.close();
            console.log(`[Email] Envío completado: ${emailJob.sent} enviados, ${emailJob.failed} fallidos`);
        })();

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/email/status
 * Estado del envío en curso
 */
app.get('/api/email/status', (req, res) => {
    if (!emailJob) return res.json({ running: false });
    res.json(emailJob);
});

/**
 * POST /api/email/cancel
 * Cancelar envío en curso
 */
app.post('/api/email/cancel', (req, res) => {
    if (emailJob && emailJob.running) {
        emailJob.running = false;
        return res.json({ ok: true, message: 'Envío cancelado' });
    }
    res.json({ ok: true, message: 'No hay envío en curso' });
});

// ============== CONTACT FORM ==============

/**
 * POST /api/contact
 * Guarda un mensaje de contacto en la base de datos
 */
app.post('/api/contact', upload.array('archivos', 5), async (req, res) => {
    try {
        const { email, asunto, mensaje } = req.body;

        if (!email || !asunto || !mensaje) {
            return res.status(400).json({ error: 'Email, asunto y mensaje son obligatorios' });
        }

        const result = await db.query(
            'INSERT INTO mensajes_contacto (email, asunto, mensaje) VALUES ($1, $2, $3) RETURNING id',
            [email, asunto, mensaje]
        );
        const mensajeId = result.rows[0].id;

        // Guardar archivos adjuntos
        for (const f of (req.files || [])) {
            await db.query(
                'INSERT INTO mensajes_archivos (mensaje_id, nombre, tipo, tamano, contenido) VALUES ($1, $2, $3, $4, $5)',
                [mensajeId, f.originalname, f.mimetype, f.size, f.buffer]
            );
        }

        const maskEmail = (e) => e ? e.replace(/^(.{2})[^@]*(@.*)$/, '$1***$2') : 'unknown';
        console.log(`[Contact] Mensaje guardado de ${maskEmail(email)}: "${asunto.slice(0, 40)}..." (${(req.files || []).length} adjuntos)`);
        res.json({ ok: true });
    } catch (err) {
        console.error('[Contact] Error:', err.message);
        res.status(500).json({ error: 'Error al guardar el mensaje' });
    }
});

// ============== ADMIN: MENSAJES ==============

/**
 * GET /api/admin/mensajes
 * Lista de mensajes de contacto (paginado)
 */
app.get('/api/admin/mensajes', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        let where = [];
        let params = [];
        let pi = 1;

        if (req.query.leido === 'true') { where.push(`leido = TRUE`); }
        if (req.query.leido === 'false') { where.push(`leido = FALSE`); }

        const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const countR = await db.query(`SELECT COUNT(*) as n FROM mensajes_contacto ${whereClause}`, params);
        const total = countR.rows[0].n;

        params.push(limit, offset);
        const itemsR = await db.query(`
            SELECT m.*,
                   (SELECT COUNT(*) FROM mensajes_archivos WHERE mensaje_id = m.id) as num_archivos
            FROM mensajes_contacto m
            ${whereClause}
            ORDER BY m.created_at DESC
            LIMIT $${pi++} OFFSET $${pi}
        `, params);

        res.json({
            page, limit, total,
            total_pages: Math.ceil(total / limit),
            items: itemsR.rows,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/mensajes/count
 * Número de mensajes no leídos
 */
app.get('/api/admin/mensajes/count', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const r = await db.query('SELECT COUNT(*) as n FROM mensajes_contacto WHERE leido = FALSE');
        res.json({ unread: r.rows[0].n });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/mensajes/:id
 * Detalle de un mensaje con info de archivos
 */
app.get('/api/admin/mensajes/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const msgR = await db.query('SELECT * FROM mensajes_contacto WHERE id = $1', [id]);
        if (msgR.rows.length === 0) return res.status(404).json({ error: 'Mensaje no encontrado' });

        const archivosR = await db.query(
            'SELECT id, nombre, tipo, tamano FROM mensajes_archivos WHERE mensaje_id = $1',
            [id]
        );

        // Marcar como leído automáticamente
        if (!msgR.rows[0].leido) {
            await db.query('UPDATE mensajes_contacto SET leido = TRUE WHERE id = $1', [id]);
        }

        res.json({ ...msgR.rows[0], leido: true, archivos: archivosR.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/admin/mensajes/:id
 * Actualizar estado de un mensaje (leido, respondido)
 */
app.patch('/api/admin/mensajes/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const sets = [];
        const params = [];
        let pi = 1;

        if (req.body.leido !== undefined) { sets.push(`leido = $${pi++}`); params.push(!!req.body.leido); }
        if (req.body.respondido !== undefined) { sets.push(`respondido = $${pi++}`); params.push(!!req.body.respondido); }

        if (sets.length === 0) return res.status(400).json({ error: 'Sin campos para actualizar' });

        params.push(id);
        await db.query(`UPDATE mensajes_contacto SET ${sets.join(', ')} WHERE id = $${pi}`, params);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/admin/mensajes/:id
 * Eliminar un mensaje y sus archivos
 */
app.delete('/api/admin/mensajes/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await db.query('DELETE FROM mensajes_contacto WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/mensajes/:id/archivos/:archivoId
 * Descargar un archivo adjunto
 */
app.get('/api/admin/mensajes/:id/archivos/:archivoId', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const archivoId = parseInt(req.params.archivoId);
        const mensajeId = parseInt(req.params.id);
        const r = await db.query(
            'SELECT nombre, tipo, contenido FROM mensajes_archivos WHERE id = $1 AND mensaje_id = $2',
            [archivoId, mensajeId]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Archivo no encontrado' });

        const archivo = r.rows[0];
        res.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre}"`);
        res.setHeader('Content-Type', archivo.tipo || 'application/octet-stream');
        res.send(archivo.contenido);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== PROPUESTAS: USER ENDPOINTS ==============

/**
 * POST /api/propuestas
 * Crear una propuesta de monumento (multipart, max 5 imágenes)
 */
app.post('/api/propuestas', authMiddleware, upload.array('imagenes', 5), async (req, res) => {
    try {
        const { denominacion, pais } = req.body;
        if (!denominacion || !pais) {
            return res.status(400).json({ error: 'Nombre y país son obligatorios' });
        }

        const propuestaId = await db.crearPropuesta({
            usuario_id: req.user.id,
            denominacion,
            tipo: req.body.tipo || null,
            categoria: req.body.categoria || null,
            provincia: req.body.provincia || null,
            comarca: req.body.comarca || null,
            municipio: req.body.municipio || null,
            localidad: req.body.localidad || null,
            latitud: req.body.latitud ? parseFloat(req.body.latitud) : null,
            longitud: req.body.longitud ? parseFloat(req.body.longitud) : null,
            comunidad_autonoma: req.body.comunidad_autonoma || null,
            pais,
            descripcion: req.body.descripcion || null,
            estilo: req.body.estilo || null,
            material: req.body.material || null,
            inception: req.body.inception || null,
            arquitecto: req.body.arquitecto || null,
            wikipedia_url: req.body.wikipedia_url || null,
        });

        // Save uploaded images
        for (const f of (req.files || [])) {
            await db.insertarPropuestaImagen({
                propuesta_id: propuestaId,
                nombre: f.originalname,
                tipo: f.mimetype,
                tamano: f.size,
                contenido: f.buffer,
                url: null,
            });
        }

        // Save URL images
        const imageUrls = req.body.image_urls ? JSON.parse(req.body.image_urls) : [];
        for (const url of imageUrls) {
            if (url && url.trim()) {
                await db.insertarPropuestaImagen({
                    propuesta_id: propuestaId,
                    nombre: url.split('/').pop() || 'imagen',
                    tipo: null,
                    tamano: null,
                    contenido: null,
                    url: url.trim(),
                });
            }
        }

        res.status(201).json({ ok: true, id: propuestaId });
    } catch (err) {
        console.error('[Propuesta] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/propuestas/mis
 * Listar propuestas del usuario actual
 */
app.get('/api/propuestas/mis', authMiddleware, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const data = await db.obtenerMisPropuestas(req.user.id, { page, limit });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== PROPUESTAS: ADMIN ENDPOINTS ==============

/**
 * GET /api/admin/propuestas
 * Listar todas las propuestas (filtro por estado)
 */
app.get('/api/admin/propuestas', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const estado = req.query.estado || undefined;
        const data = await db.obtenerPropuestasAdmin({ page, limit, estado });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/propuestas/count
 * Contar propuestas pendientes (para badge)
 */
app.get('/api/admin/propuestas/count', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const count = await db.contarPropuestasPendientes();
        res.json({ pendientes: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/propuestas/:id
 * Detalle de una propuesta con imágenes
 */
app.get('/api/admin/propuestas/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const data = await db.obtenerPropuesta(parseInt(req.params.id));
        if (!data) return res.status(404).json({ error: 'Propuesta no encontrada' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/admin/propuestas/:id
 * Editar campos de una propuesta antes de aprobar
 */
app.patch('/api/admin/propuestas/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await db.actualizarPropuesta(parseInt(req.params.id), req.body);
        if (!result) return res.status(400).json({ error: 'Sin campos válidos para actualizar' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/propuestas/:id/aprobar
 * Aprobar propuesta: crea bien + wikidata + imagenes en transacción
 */
app.post('/api/admin/propuestas/:id/aprobar', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const bienId = await db.aprobarPropuesta(parseInt(req.params.id), req.user.id);
        res.json({ ok: true, bien_id: bienId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * POST /api/admin/propuestas/:id/rechazar
 * Rechazar propuesta con motivo
 */
app.post('/api/admin/propuestas/:id/rechazar', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { notas } = req.body;
        await db.rechazarPropuesta(parseInt(req.params.id), req.user.id, notas || null);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * GET /api/admin/propuestas/:id/imagenes/:imgId
 * Descargar imagen de una propuesta
 */
app.get('/api/admin/propuestas/:id/imagenes/:imgId', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const img = await db.obtenerPropuestaImagen(parseInt(req.params.imgId));
        if (!img || !img.contenido) return res.status(404).json({ error: 'Imagen no encontrada' });
        res.setHeader('Content-Type', img.tipo || 'image/jpeg');
        res.send(img.contenido);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== WIKIDATA SEARCH (ADMIN) ==============

/**
 * GET /api/admin/wikidata/search?q=...&pais=...
 * Buscar en Wikidata por nombre + país
 */
app.get('/api/admin/wikidata/search', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { q, pais } = req.query;
        if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });

        const paisQids = {
            'España': 'Q29',
            'Francia': 'Q142',
            'Portugal': 'Q45',
            'Italia': 'Q38',
        };
        const paisQid = paisQids[pais] || '';
        const paisFilter = paisQid ? `?item wdt:P17 wd:${paisQid} .` : '';

        const sparql = `
            SELECT ?item ?itemLabel ?itemDescription ?image ?article ?coord WHERE {
                ?item rdfs:label ?label . FILTER(CONTAINS(LCASE(?label), LCASE("${q.replace(/"/g, '\\"')}")))
                ${paisFilter}
                OPTIONAL { ?item wdt:P18 ?image }
                OPTIONAL { ?item wdt:P625 ?coord }
                OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://es.wikipedia.org/> }
                SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,fr,pt,it" }
            } LIMIT 10
        `;

        const wdResponse = await fetch(
            `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}`,
            {
                headers: {
                    'Accept': 'application/sparql-results+json',
                    'User-Agent': 'PatrimonioEuropeo/1.0',
                },
            }
        );

        if (!wdResponse.ok) {
            return res.status(502).json({ error: 'Error consultando Wikidata' });
        }

        const wdData = await wdResponse.json();
        const results = (wdData.results?.bindings || []).map(b => {
            const itemUri = b.item?.value || '';
            const qid = itemUri.split('/').pop();
            let lat = null, lng = null;
            if (b.coord?.value) {
                const match = b.coord.value.match(/Point\(([^ ]+) ([^ ]+)\)/);
                if (match) { lng = parseFloat(match[1]); lat = parseFloat(match[2]); }
            }
            return {
                qid,
                label: b.itemLabel?.value || '',
                description: b.itemDescription?.value || '',
                image: b.image?.value || null,
                wikipedia_url: b.article?.value || null,
                lat,
                lng,
            };
        });

        // Deduplicate by QID
        const seen = new Set();
        const unique = results.filter(r => {
            if (seen.has(r.qid)) return false;
            seen.add(r.qid);
            return true;
        });

        res.json(unique);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== NOTAS DE MONUMENTO ==============

/**
 * GET /api/monumentos/:id/notas
 * Obtener notas de un monumento (público)
 */
app.get('/api/monumentos/:id/notas', async (req, res) => {
    try {
        const notas = await db.obtenerNotasMonumento(parseInt(req.params.id));
        res.json(notas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/monumentos/:id/notas
 * Añadir una nota a un monumento (requiere login)
 */
app.post('/api/monumentos/:id/notas', authMiddleware, async (req, res) => {
    try {
        const { tipo, texto } = req.body;
        if (!texto || !texto.trim()) return res.status(400).json({ error: 'Texto requerido' });
        const validTypes = ['horario', 'precio', 'nota'];
        const notaTipo = validTypes.includes(tipo) ? tipo : 'nota';
        const nota = await db.crearNotaMonumento(parseInt(req.params.id), req.user.id, notaTipo, texto.trim());
        // Fetch with user info
        const notas = await db.obtenerNotasMonumento(parseInt(req.params.id));
        const full = notas.find(n => n.id === nota.id);
        res.status(201).json(full || nota);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/monumentos/:id/notas/:notaId
 * Eliminar una nota propia (o cualquier nota si admin)
 */
app.delete('/api/monumentos/:id/notas/:notaId', authMiddleware, async (req, res) => {
    try {
        const notaId = parseInt(req.params.notaId);
        const user = await db.obtenerUsuarioPorId(req.user.id);
        let deleted;
        if (user.rol === 'admin') {
            deleted = await db.eliminarNotaMonumentoAdmin(notaId);
        } else {
            deleted = await db.eliminarNotaMonumento(notaId, req.user.id);
        }
        if (!deleted) return res.status(404).json({ error: 'Nota no encontrada' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== VALORACIONES ==============

/**
 * GET /api/monumentos/:id/valoraciones
 * Obtener resumen de valoraciones + la del usuario actual si logueado
 */
app.get('/api/monumentos/:id/valoraciones', optionalAuth, async (req, res) => {
    try {
        const bienId = parseInt(req.params.id);
        const summary = await db.obtenerValoracionesMonumento(bienId);
        let user_rating = null;
        if (req.user) {
            user_rating = await db.obtenerValoracionUsuario(bienId, req.user.id);
        }
        res.json({ ...summary, user_rating });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/monumentos/:id/valoraciones
 * Crear o actualizar valoración (requiere login)
 */
app.post('/api/monumentos/:id/valoraciones', authMiddleware, async (req, res) => {
    try {
        const { general, conservacion, accesibilidad } = req.body;
        if (!general || general < 1 || general > 5) {
            return res.status(400).json({ error: 'Valoración general (1-5) requerida' });
        }
        const rating = await db.upsertValoracion(
            parseInt(req.params.id),
            req.user.id,
            general,
            conservacion || null,
            accesibilidad || null
        );
        res.json(rating);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== EVENTOS HISTÓRICOS ==============

/**
 * GET /api/monumentos/:id/eventos
 * Eventos históricos de un monumento (P793)
 */
app.get('/api/monumentos/:id/eventos', async (req, res) => {
    try {
        const eventos = await db.obtenerEventosMonumento(parseInt(req.params.id));
        res.json(eventos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== PERSONAS (autores, arquitectos, escultores) — público ==============

/**
 * GET /api/personas?q=...&limit=...
 * Devuelve personas (arquitectos, creadores, autores) con número de bienes asociados.
 * Soporta búsqueda fuzzy (trigram + unaccent) sobre el nombre.
 */
app.get('/api/personas', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

        let sql, params;
        if (q.length >= 2) {
            sql = `
                SELECT nombre,
                       STRING_AGG(DISTINCT rol, ',' ORDER BY rol) AS roles,
                       COUNT(DISTINCT bien_id) AS n_bienes,
                       MAX(qid_persona) AS qid
                FROM bien_personas
                WHERE unaccent(LOWER(nombre)) ILIKE unaccent(LOWER($1))
                GROUP BY nombre
                ORDER BY n_bienes DESC, nombre
                LIMIT ${limit}
            `;
            params = [`%${q}%`];
        } else {
            // Sin q → top personas con más bienes
            sql = `
                SELECT nombre,
                       STRING_AGG(DISTINCT rol, ',' ORDER BY rol) AS roles,
                       COUNT(DISTINCT bien_id) AS n_bienes,
                       MAX(qid_persona) AS qid
                FROM bien_personas
                GROUP BY nombre
                ORDER BY n_bienes DESC
                LIMIT ${limit}
            `;
            params = [];
        }
        const r = await db.query(sql, params);
        res.json({ count: r.rows.length, personas: r.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/personas/:qid/bienes
 * Devuelve los bienes asociados a una persona (por QID Wikidata).
 */
app.get('/api/personas/:qid/bienes', async (req, res) => {
    try {
        const qid = String(req.params.qid);
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const r = await db.query(`
            SELECT b.id, b.denominacion, b.municipio, b.provincia, b.comarca, b.pais,
                   b.tipo_monumento, b.periodo, b.latitud, b.longitud,
                   bp.rol, bp.nombre AS persona, w.qid, w.imagen_url
            FROM bien_personas bp
            JOIN bienes b ON b.id = bp.bien_id
            LEFT JOIN wikidata w ON b.id = w.bien_id
            WHERE bp.qid_persona = $1
            ORDER BY b.id
            LIMIT ${limit}
        `, [qid]);
        res.json({ count: r.rows.length, bienes: r.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== RUTAS CULTURALES (público) ==============

/**
 * GET /api/rutas-culturales
 * Listar rutas culturales activas
 */
app.get('/api/rutas-culturales', async (req, res) => {
    try {
        const lang = req.query.lang;
        const rutas = await db.obtenerRutasCulturales();
        // Si se pide un idioma, hacer JOIN con traducciones (fallback a original si no hay)
        if (lang && lang !== 'es') {
            const ids = rutas.map(r => r.id);
            if (ids.length === 0) return res.json(rutas);
            const tradsR = await db.query(
                `SELECT ruta_id, nombre, descripcion FROM rutas_culturales_traducciones
                 WHERE lang = $1 AND ruta_id = ANY($2::int[])`,
                [lang, ids]
            );
            const trads = Object.fromEntries(tradsR.rows.map(t => [t.ruta_id, t]));
            const out = rutas.map(r => trads[r.id]
                ? { ...r, nombre: trads[r.id].nombre, descripcion: trads[r.id].descripcion }
                : r
            );
            return res.json(out);
        }
        res.json(rutas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/rutas-culturales/:slug
 * Detalle de ruta cultural con paradas y fotos
 */
app.get('/api/rutas-culturales/:slug', async (req, res) => {
    try {
        const ruta = await db.obtenerRutaCultural(req.params.slug);
        if (!ruta) return res.status(404).json({ error: 'Ruta cultural no encontrada' });
        res.json(ruta);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== RUTAS ==============

/**
 * POST /api/rutas
 * Crear una ruta nueva (premium)
 */
app.post('/api/rutas', authMiddleware, premiumMiddleware, async (req, res) => {
    try {
        const { nombre, centro_lat, centro_lng, radio_km, paradas } = req.body;
        if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
        if (!paradas || !paradas.length) return res.status(400).json({ error: 'Al menos una parada requerida' });
        if (paradas.length > 25) return res.status(400).json({ error: 'Máximo 25 paradas' });

        const ruta = await db.crearRuta(req.user.id, nombre, centro_lat, centro_lng, radio_km);
        await db.guardarParadasRuta(ruta.id, paradas.map((p, i) => ({
            bien_id: p.bien_id,
            orden: p.orden ?? i + 1,
            notas: p.notas,
        })));
        const full = await db.obtenerRuta(ruta.id);
        res.status(201).json(full);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/rutas
 * Obtener mis rutas
 */
app.get('/api/rutas', authMiddleware, async (req, res) => {
    try {
        const rutas = await db.obtenerRutasUsuario(req.user.id);
        res.json(rutas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/rutas/:id
 * Obtener una ruta con paradas
 */
app.get('/api/rutas/:id', authMiddleware, async (req, res) => {
    try {
        const ruta = await db.obtenerRuta(parseInt(req.params.id));
        if (!ruta) return res.status(404).json({ error: 'Ruta no encontrada' });
        if (ruta.usuario_id !== req.user.id) {
            const user = await db.obtenerUsuarioPorId(req.user.id);
            if (user.rol !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
        }
        res.json(ruta);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/rutas/:id
 * Eliminar una ruta propia
 */
app.delete('/api/rutas/:id', authMiddleware, async (req, res) => {
    try {
        const deleted = await db.eliminarRuta(parseInt(req.params.id), req.user.id);
        if (!deleted) return res.status(404).json({ error: 'Ruta no encontrada' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/rutas/optimizar
 * Optimizar orden de paradas usando OSRM (público demo server)
 */
app.post('/api/rutas/optimizar', authMiddleware, premiumMiddleware, async (req, res) => {
    try {
        const { paradas } = req.body;
        if (!paradas || paradas.length < 2) return res.status(400).json({ error: 'Mínimo 2 paradas' });
        if (paradas.length > 25) return res.status(400).json({ error: 'Máximo 25 paradas' });

        // Build coordinates string for OSRM
        // source=first: mantenemos el primer monumento como punto de partida (UX esperado)
        // destination=any: dejamos que OSRM elija el final óptimo
        const coords = paradas.map(p => `${p.longitud},${p.latitud}`).join(';');
        const osrmUrl = `https://router.project-osrm.org/trip/v1/driving/${coords}?roundtrip=false&source=first&destination=any&geometries=geojson&overview=full`;

        const osrmRes = await fetch(osrmUrl);
        if (!osrmRes.ok) {
            return res.status(502).json({ error: 'Error consultando servicio de rutas' });
        }

        const osrmData = await osrmRes.json();
        if (osrmData.code !== 'Ok') {
            return res.status(502).json({ error: 'No se pudo calcular la ruta', detail: osrmData.code });
        }

        const trip = osrmData.trips?.[0];
        if (!trip) return res.status(502).json({ error: 'No se encontró ruta' });

        // OSRM devuelve waypoints en orden de entrada con waypoint_index = posición en el trip.
        // Convertimos a "índices de paradas originales en el orden optimizado del trip".
        const waypoints = osrmData.waypoints || [];
        const order = waypoints
            .map((wp, originalIdx) => ({ originalIdx, tripPos: wp.waypoint_index }))
            .sort((a, b) => a.tripPos - b.tripPos)
            .map(x => x.originalIdx);

        res.json({
            distancia_km: Math.round(trip.distance / 1000 * 10) / 10,
            duracion_min: Math.round(trip.duration / 60),
            orden_optimizado: order,
            geometria: trip.geometry,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/rutas/:id/pdf
 * Generar PDF de una ruta
 */
app.get('/api/rutas/:id/pdf', authMiddleware, premiumMiddleware, async (req, res) => {
    try {
        const ruta = await db.obtenerRuta(parseInt(req.params.id));
        if (!ruta) return res.status(404).json({ error: 'Ruta no encontrada' });
        if (ruta.usuario_id !== req.user.id) {
            const user = await db.obtenerUsuarioPorId(req.user.id);
            if (user.rol !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
        }

        const doc = new PDFDocument({ size: 'A4', margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="ruta-${ruta.id}.pdf"`);
        doc.pipe(res);

        // --- Cover page ---
        doc.fontSize(28).font('Helvetica-Bold').text('Patrimonio Europeo', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(20).font('Helvetica').text(ruta.nombre, { align: 'center' });
        doc.moveDown(1);
        doc.fontSize(12).fillColor('#666')
           .text(`${ruta.paradas.length} monumentos | Radio: ${ruta.radio_km || '?'} km`, { align: 'center' });
        doc.moveDown(0.3);
        doc.text(`Generado: ${new Date().toLocaleDateString('es-ES')}`, { align: 'center' });
        doc.moveDown(2);

        // --- Index ---
        doc.fillColor('#333').fontSize(14).font('Helvetica-Bold').text('Itinerario');
        doc.moveDown(0.5);
        ruta.paradas.forEach((p, i) => {
            doc.fontSize(10).font('Helvetica')
               .fillColor('#444')
               .text(`${i + 1}. ${p.denominacion} — ${[p.municipio, p.provincia].filter(Boolean).join(', ')}`, {
                   indent: 10,
               });
        });

        // --- Monument pages ---
        for (let i = 0; i < ruta.paradas.length; i++) {
            const p = ruta.paradas[i];
            doc.addPage();

            // Header
            doc.fontSize(18).font('Helvetica-Bold').fillColor('#1a365d')
               .text(`${i + 1}. ${p.denominacion}`);
            doc.moveDown(0.3);

            // Location
            doc.fontSize(10).font('Helvetica').fillColor('#666')
               .text(`📍 ${[p.municipio, p.provincia, p.pais].filter(Boolean).join(', ')}`);
            doc.moveDown(0.5);

            // Metadata
            if (p.categoria) {
                doc.fontSize(9).fillColor('#888').text(`Categoría: ${p.categoria}`);
            }
            if (p.estilo) {
                doc.fontSize(9).fillColor('#888').text(`Estilo: ${p.estilo}`);
            }
            if (p.inception) {
                doc.fontSize(9).fillColor('#888').text(`Época: ${p.inception}`);
            }
            if (p.arquitecto) {
                doc.fontSize(9).fillColor('#888').text(`Arquitecto: ${p.arquitecto}`);
            }
            doc.moveDown(0.5);

            // Description
            const desc = p.descripcion || '';
            if (desc) {
                doc.fontSize(10).fillColor('#333').font('Helvetica')
                   .text(desc.length > 800 ? desc.slice(0, 800) + '...' : desc, {
                       lineGap: 3,
                   });
                doc.moveDown(0.5);
            }

            // Coordinates
            if (p.latitud && p.longitud) {
                doc.fontSize(8).fillColor('#999')
                   .text(`Coordenadas: ${p.latitud}, ${p.longitud}`);
            }

            // Wikipedia URL
            if (p.wikipedia_url) {
                doc.fontSize(8).fillColor('#2b6cb0')
                   .text(`Wikipedia: ${p.wikipedia_url}`, { link: p.wikipedia_url });
            }

            // Notes from route
            if (p.notas) {
                doc.moveDown(0.5);
                doc.fontSize(9).fillColor('#c05621').font('Helvetica-Oblique')
                   .text(`Nota: ${p.notas}`);
            }
        }

        // --- Back page ---
        doc.addPage();
        doc.fontSize(12).font('Helvetica').fillColor('#666')
           .text('Ruta generada con Patrimonio Europeo', { align: 'center' });
        doc.moveDown(1);
        doc.fontSize(10)
           .text('www.patrimonio-europeo.com', { align: 'center' });

        doc.end();
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

// ============== SOCIAL HISTORY ==============

/**
 * GET /api/admin/social-history
 * Obtener IDs de monumentos ya publicados (últimos 90 días)
 */
app.get('/api/admin/social-history', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const ids = await db.obtenerSocialHistoryIds(90);
        res.json({ ids });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/social-history
 * Registrar un monumento como publicado
 */
app.post('/api/admin/social-history', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { bien_id, platform } = req.body;
        if (!bien_id) return res.status(400).json({ error: 'bien_id requerido' });
        const entry = await db.crearSocialHistory(bien_id, platform || null);
        res.json(entry);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== SERVE UPLOADED IMAGES ==============

/**
 * GET /api/imagenes/:id/archivo
 * Servir imagen BYTEA almacenada localmente
 */
app.get('/api/imagenes/:id/archivo', async (req, res) => {
    try {
        const img = await db.obtenerImagenArchivo(parseInt(req.params.id));
        if (!img || !img.contenido) return res.status(404).json({ error: 'Imagen no encontrada' });
        // Try to determine content type from url/titulo
        let contentType = 'image/jpeg';
        const name = (img.titulo || '').toLowerCase();
        if (name.endsWith('.png')) contentType = 'image/png';
        else if (name.endsWith('.webp')) contentType = 'image/webp';
        else if (name.endsWith('.gif')) contentType = 'image/gif';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(img.contenido);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== WIKIPEDIA ENRICHMENT ==============

/**
 * GET /api/monumentos/:id/wikipedia
 * Obtiene el extracto de Wikipedia para un monumento
 */
app.get('/api/monumentos/:id/wikipedia', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const requestedLang = req.query.lang || 'es';

        const result = await db.query(
            'SELECT wikipedia_url, qid, descripcion FROM wikidata WHERE bien_id = $1',
            [id]
        );
        const row = result.rows[0];

        if (!row || !row.wikipedia_url) {
            return res.status(404).json({ error: 'No hay URL de Wikipedia para este monumento' });
        }

        // Extraer idioma y título de la URL guardada
        const urlMatch = row.wikipedia_url.match(/^https?:\/\/([a-z]+)\.wikipedia\.org\/wiki\/(.+)$/i);
        if (!urlMatch) {
            return res.status(400).json({ error: 'URL de Wikipedia no válida' });
        }

        const cachedLang = urlMatch[1];
        const cachedTitle = urlMatch[2];

        // Lookup en BDs secundarias por idioma. Primero intentamos en el idioma
        // pedido; si no hay, caemos a ES como universal fallback. Cada BD secundaria
        // (Neon project independiente) contiene Wikipedia extracts en SU idioma.
        let enrichRow = null;
        let enrichLang = null;

        // 1) Primer intento: pool del idioma pedido
        const tryRes1 = await db.queryEnrichment(
            requestedLang,
            'SELECT extract, full_text, lang FROM wikipedia_extracts WHERE bien_id = $1',
            [id]
        );
        if (tryRes1 && tryRes1.rows[0] && tryRes1.rows[0].full_text && tryRes1.rows[0].full_text.length > 200) {
            enrichRow = tryRes1.rows[0];
            enrichLang = enrichRow.lang || requestedLang;
        }

        // 2) Fallback: pool ES si no encontramos en el lang pedido
        if (!enrichRow && requestedLang !== 'es') {
            const tryRes2 = await db.queryEnrichment(
                'es',
                'SELECT extract, full_text, lang FROM wikipedia_extracts WHERE bien_id = $1',
                [id]
            );
            if (tryRes2 && tryRes2.rows[0] && tryRes2.rows[0].full_text && tryRes2.rows[0].full_text.length > 200) {
                enrichRow = tryRes2.rows[0];
                enrichLang = enrichRow.lang || 'es';
            }
        }

        // Si la secundaria está en el idioma pedido: respuesta directa
        if (enrichRow && enrichLang === requestedLang) {
            return res.json({
                extract: enrichRow.extract || enrichRow.full_text.slice(0, 1500),
                full_text: enrichRow.full_text,
                source: 'enrichment',
                lang: enrichLang,
            });
        }

        // Cache primario (wikidata.descripcion): solo válido si idioma coincide
        if (requestedLang === cachedLang && row.descripcion && row.descripcion.length > 200) {
            const response = { extract: row.descripcion, source: 'cache', lang: cachedLang };
            // Si hay enrichment en otro idioma, ofrecerlo como full_text con su lang
            if (enrichRow) {
                response.full_text = enrichRow.full_text;
                response.full_text_lang = enrichLang;
            }
            return res.json(response);
        }

        // Resolver título en idioma pedido vía Wikidata sitelinks (si el QID existe)
        let targetLang = cachedLang;
        let targetTitle = cachedTitle;
        if (requestedLang !== cachedLang && row.qid) {
            try {
                const wd = await fetch(
                    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${row.qid}&props=sitelinks&sitefilter=${requestedLang}wiki&format=json`,
                    { headers: { 'User-Agent': 'PatrimonioEuropeo/1.0' } }
                );
                if (wd.ok) {
                    const wdJson = await wd.json();
                    const sitelink = wdJson?.entities?.[row.qid]?.sitelinks?.[`${requestedLang}wiki`];
                    if (sitelink?.title) {
                        targetLang = requestedLang;
                        targetTitle = encodeURIComponent(sitelink.title.replace(/ /g, '_'));
                    }
                }
            } catch (e) {
                // Fallback a la URL original
            }
        }

        // Llamar Wikipedia REST API
        const wikiResponse = await fetch(
            `https://${targetLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(decodeURIComponent(targetTitle))}`,
            { headers: { 'User-Agent': 'PatrimonioEuropeo/1.0' } }
        );

        if (!wikiResponse.ok) {
            // Si hay enrichment en otro idioma, usarlo como fallback completo
            if (enrichRow) {
                return res.json({
                    extract: enrichRow.extract || enrichRow.full_text.slice(0, 1500),
                    full_text: enrichRow.full_text,
                    source: 'enrichment-fallback',
                    lang: enrichLang,
                });
            }
            // Si Wikipedia da 429 o similar y tenemos cache (en cualquier idioma), devolverlo como fallback
            if (row.descripcion && row.descripcion.length > 100) {
                return res.json({ extract: row.descripcion, source: 'cache-fallback', lang: cachedLang });
            }
            return res.status(502).json({ error: 'Error al obtener datos de Wikipedia', upstream: wikiResponse.status });
        }

        const wikiData = await wikiResponse.json();
        const extract = wikiData.extract;

        if (!extract) {
            // Fallback al enrichment si existe
            if (enrichRow) {
                return res.json({
                    extract: enrichRow.extract || enrichRow.full_text.slice(0, 1500),
                    full_text: enrichRow.full_text,
                    source: 'enrichment-fallback',
                    lang: enrichLang,
                });
            }
            return res.status(404).json({ error: 'No se encontró extracto en Wikipedia' });
        }

        // Solo cachear si servimos en el mismo idioma que la URL original
        if (targetLang === cachedLang) {
            try {
                await db.query(
                    'UPDATE wikidata SET descripcion = $1 WHERE bien_id = $2',
                    [extract, id]
                );
            } catch (dbErr) {
                console.error(`[Wikipedia] Error guardando cache bien_id=${id}: ${dbErr.message}`);
            }
        }

        // Respuesta híbrida: extract en idioma pedido + full_text de enrichment (otro idioma)
        const response = { extract, source: 'wikipedia', lang: targetLang };
        if (enrichRow) {
            response.full_text = enrichRow.full_text;
            response.full_text_lang = enrichLang;
        }
        res.json(response);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== SOCIAL ACCOUNTS (menciones para publicaciones) ==============

/**
 * GET /api/admin/social-accounts/suggest
 * Sugiere cuentas de Instagram para mencionar en un post, basándose en:
 *   - pais del monumento
 *   - region del monumento (comunidad_autonoma)
 *   - tema (estilo, tipo de monumento → mapeado a theme)
 *   - algoritmo de rotación: prioriza las menos usadas recientemente
 *
 * Query params: pais, region, theme, limit (default 5)
 */
app.get('/api/admin/social-accounts/suggest', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { pais, region, theme, limit = 5 } = req.query;
        const maxAccounts = Math.min(parseInt(limit) || 5, 10);

        // 1. Get "always" accounts (rotated: least recently used first)
        const always = await db.query(`
            SELECT * FROM social_accounts
            WHERE activa = TRUE AND scope = 'always'
            ORDER BY use_count ASC, last_used ASC NULLS FIRST, followers_approx DESC
            LIMIT 3
        `);

        // 2. Get country-matching accounts
        let countryAccounts = [];
        if (pais) {
            const r = await db.query(`
                SELECT * FROM social_accounts
                WHERE activa = TRUE AND scope = 'country' AND pais = $1
                ORDER BY use_count ASC, last_used ASC NULLS FIRST, followers_approx DESC
                LIMIT 3
            `, [pais]);
            countryAccounts = r.rows;
        }

        // 3. Get region-matching accounts
        let regionAccounts = [];
        if (region) {
            const r = await db.query(`
                SELECT * FROM social_accounts
                WHERE activa = TRUE AND scope = 'region' AND region = $1
                ORDER BY use_count ASC, last_used ASC NULLS FIRST, followers_approx DESC
                LIMIT 2
            `, [region]);
            regionAccounts = r.rows;
        }

        // 4. Get theme-matching accounts
        let themeAccounts = [];
        if (theme) {
            const r = await db.query(`
                SELECT * FROM social_accounts
                WHERE activa = TRUE AND scope = 'theme' AND (theme = $1 OR pais = $2 OR pais IS NULL)
                ORDER BY use_count ASC, last_used ASC NULLS FIRST, followers_approx DESC
                LIMIT 2
            `, [theme, pais || '']);
            themeAccounts = r.rows;
        }

        // 5. Merge and deduplicate, respecting the limit
        const seen = new Set();
        const result = [];

        // Interleave: 2 always + 2 country + 1 region/theme
        for (const list of [always.rows, countryAccounts, regionAccounts, themeAccounts]) {
            for (const acc of list) {
                if (!seen.has(acc.id) && result.length < maxAccounts) {
                    seen.add(acc.id);
                    result.push(acc);
                }
            }
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/social-accounts/mark-used
 * Marca cuentas como "usadas" para el algoritmo de rotación.
 * Body: { account_ids: [1, 2, 3] }
 */
app.post('/api/admin/social-accounts/mark-used', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { account_ids } = req.body;
        if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
            return res.status(400).json({ error: 'account_ids es obligatorio (array)' });
        }

        const placeholders = account_ids.map((_, i) => `$${i + 1}`).join(',');
        await db.query(`
            UPDATE social_accounts
            SET use_count = use_count + 1, last_used = NOW()
            WHERE id IN (${placeholders})
        `, account_ids);

        res.json({ ok: true, marked: account_ids.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/admin/social-accounts
 * Lista todas las cuentas (para gestión en admin).
 */
app.get('/api/admin/social-accounts', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT * FROM social_accounts
            ORDER BY scope, pais NULLS LAST, display_name
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`API Patrimonio Europeo corriendo en http://localhost:${PORT}`);
    console.log(`Endpoints disponibles:`);
    console.log(`  GET  /api/stats            - Estadísticas`);
    console.log(`  GET  /api/monumentos       - Lista con filtros y paginación`);
    console.log(`  GET  /api/monumentos/:id   - Detalle de un monumento`);
    console.log(`  GET  /api/geojson          - GeoJSON para mapas`);
    console.log(`  GET  /api/filtros          - Valores para filtros`);
    console.log(`  GET  /api/municipios       - Autocomplete municipios`);
    console.log(`  GET  /api/contactos        - Contactos de ayuntamientos`);
    console.log(`  POST /api/auth/register    - Registro`);
    console.log(`  POST /api/auth/login       - Login`);
    console.log(`  POST /api/auth/google      - Login con Google`);
    console.log(`  GET  /api/auth/me          - Perfil usuario`);
    console.log(`  PUT  /api/auth/me          - Actualizar perfil`);
    console.log(`  PUT  /api/auth/me/password - Cambiar contraseña`);
    console.log(`  GET  /api/admin/usuarios   - Listar usuarios (admin)`);
    console.log(`  PATCH /api/admin/usuarios/:id/rol - Cambiar rol (admin)`);
    console.log(`  GET  /api/favoritos        - Listar favoritos`);
    console.log(`  POST /api/favoritos/:id    - Añadir favorito`);
    console.log(`  DELETE /api/favoritos/:id  - Quitar favorito`);
    console.log(`  GET  /api/monumentos/:id/wikipedia - Extracto Wikipedia`);
    console.log(`  POST /api/contact              - Formulario de contacto`);
});
