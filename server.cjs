/**
 * API REST para Patrimonio Europeo
 * Endpoints para acceder a los datos de monumentos desde el frontend
 */

const express = require('express');
const cors = require('cors');
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

// Middleware
app.use(cors());
app.use(express.json());

// ============== AUTH MIDDLEWARE ==============

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requerido' });
    }
    try {
        const token = header.split(' ')[1];
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

        const password_hash = bcrypt.hashSync(password, 10);
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

        const new_hash = bcrypt.hashSync(new_password, 10);
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

        const result = await db.obtenerUsuarios({ page, limit, search, rol });
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

// ============== ADMIN ANALYTICS ENDPOINTS ==============

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
          OR w.heritage_label ILIKE '%parte de un sitio Patrimonio%' THEN 20
        WHEN w.heritage_label ILIKE '%classé%'
          OR w.heritage_label = 'bien de interés cultural'
          OR w.heritage_label = 'BIC'
          OR w.heritage_label = 'Monumento' THEN 15
        WHEN w.heritage_label ILIKE '%inscrit%'
          OR w.heritage_label ILIKE '%Interesse Público%'
          OR w.heritage_label ILIKE '%bene culturale%' THEN 12
        WHEN w.heritage_label IS NOT NULL THEN 8
        ELSE 0
    END
    + CASE WHEN w.wikipedia_url IS NOT NULL THEN 10 ELSE 0 END
    + CASE
        WHEN LENGTH(COALESCE(w.descripcion,'')) > 2000 THEN 15
        WHEN LENGTH(COALESCE(w.descripcion,'')) > 500 THEN 12
        WHEN LENGTH(COALESCE(w.descripcion,'')) > 100 THEN 8
        WHEN LENGTH(COALESCE(w.descripcion,'')) > 0 THEN 3
        ELSE 0
    END
    + CASE WHEN w.imagen_url IS NOT NULL THEN 10 ELSE 0 END
    + CASE WHEN b.latitud IS NOT NULL THEN 5 ELSE 0 END
    + CASE WHEN w.estilo IS NOT NULL THEN 5 ELSE 0 END
    + CASE WHEN w.arquitecto IS NOT NULL THEN 4 ELSE 0 END
    + CASE WHEN w.inception IS NOT NULL THEN 3 ELSE 0 END
    + CASE WHEN w.commons_category IS NOT NULL THEN 3 ELSE 0 END
)`;

const SORT_OPTIONS = {
    'relevancia':     `${RELEVANCE_SCORE} DESC, LOWER(b.denominacion) ASC`,
    'nombre_asc':     'LOWER(b.denominacion) ASC',
    'nombre_desc':    'LOWER(b.denominacion) DESC',
    'municipio_asc':  'LOWER(b.municipio) ASC, LOWER(b.denominacion) ASC',
    'municipio_desc': 'LOWER(b.municipio) DESC, LOWER(b.denominacion) ASC',
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
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
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
        if (req.query.q) {
            where.push(`b.denominacion ILIKE $${pi++}`);
            params.push(`%${req.query.q}%`);
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
        const query = `
            SELECT
                b.id, b.denominacion, b.tipo, b.clase, b.categoria,
                b.provincia, b.comarca, b.municipio, b.localidad,
                b.latitud, b.longitud, b.comunidad_autonoma, b.pais,
                w.qid, w.descripcion, w.imagen_url, w.estilo, w.arquitecto,
                w.heritage_label, w.wikipedia_url
            FROM bienes b
            LEFT JOIN wikidata w ON b.id = w.bien_id
            ${whereClause}
            ORDER BY ${SORT_OPTIONS[req.query.sort] || SORT_OPTIONS['relevancia']}
            LIMIT $${pi++} OFFSET $${pi}
        `;

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

        const imagenesResult = await db.query(
            'SELECT url, titulo, autor, fuente FROM imagenes WHERE bien_id = ?',
            [id]
        );

        res.json({
            ...bien,
            imagenes: imagenesResult.rows,
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
        if (req.query.solo_imagen === 'true') {
            where.push('w.imagen_url IS NOT NULL');
        }
        if (req.query.bbox) {
            const [minLon, minLat, maxLon, maxLat] = req.query.bbox.split(',').map(parseFloat);
            if (!isNaN(minLon) && !isNaN(minLat) && !isNaN(maxLon) && !isNaN(maxLat)) {
                where.push(`b.longitud >= $${pi} AND b.longitud <= $${pi+1} AND b.latitud >= $${pi+2} AND b.latitud <= $${pi+3}`);
                params.push(minLon, maxLon, minLat, maxLat);
                pi += 4;
            }
        }

        const limit = Math.min(10000, parseInt(req.query.limit) || 10000);

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
                b.latitud, b.longitud,
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

        // Build WHERE for filtered queries
        let whereParams = [];
        let whereParts = [];
        let pi = 1;
        if (pais) {
            whereParts.push(`b.pais = $${pi++}`);
            whereParams.push(pais);
        }
        if (region) {
            whereParts.push(`b.comunidad_autonoma = $${pi++}`);
            whereParams.push(region);
        }
        if (provincia) {
            whereParts.push(`b.provincia = $${pi++}`);
            whereParams.push(provincia);
        }
        const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : '1=1';

        // Países disponibles
        const paisesR = await db.query(`
            SELECT pais as value, COUNT(*) as count
            FROM bienes WHERE pais IS NOT NULL
            GROUP BY pais ORDER BY LOWER(pais)
        `);

        // Regiones filtradas por país
        let regionesR;
        if (pais) {
            regionesR = await db.query(`
                SELECT comunidad_autonoma as value, pais, COUNT(*) as count
                FROM bienes WHERE comunidad_autonoma IS NOT NULL AND pais = ?
                GROUP BY comunidad_autonoma, pais ORDER BY LOWER(comunidad_autonoma)
            `, [pais]);
        } else {
            regionesR = await db.query(`
                SELECT comunidad_autonoma as value, pais, COUNT(*) as count
                FROM bienes WHERE comunidad_autonoma IS NOT NULL
                GROUP BY comunidad_autonoma, pais ORDER BY LOWER(comunidad_autonoma)
            `);
        }

        // Provincias filtradas
        let provWhere = 'provincia IS NOT NULL';
        let provParams = [];
        let provPi = 1;
        if (pais) {
            provWhere += ` AND pais = $${provPi++}`;
            provParams.push(pais);
        }
        if (region) {
            provWhere += ` AND comunidad_autonoma = $${provPi++}`;
            provParams.push(region);
        }
        const provinciasR = await db.query(`
            SELECT provincia as value, comunidad_autonoma as region, pais, COUNT(*) as count
            FROM bienes WHERE ${provWhere}
            GROUP BY provincia, comunidad_autonoma, pais ORDER BY LOWER(provincia)
        `, provParams);

        // Categorías filtradas
        const categoriasR = await db.query(`
            SELECT b.categoria as value, COUNT(*) as count
            FROM bienes b
            WHERE b.categoria IS NOT NULL AND b.categoria != '' AND ${whereClause}
            GROUP BY b.categoria ORDER BY LOWER(b.categoria)
        `, whereParams);

        // Tipos filtrados
        const tiposR = await db.query(`
            SELECT b.tipo as value, COUNT(*) as count
            FROM bienes b
            WHERE b.tipo IS NOT NULL AND b.tipo != '' AND ${whereClause}
            GROUP BY b.tipo ORDER BY LOWER(b.tipo)
        `, whereParams);

        // Estilos filtrados
        const estilosR = await db.query(`
            SELECT w.estilo as value, COUNT(*) as count
            FROM wikidata w
            JOIN bienes b ON w.bien_id = b.id
            WHERE w.estilo IS NOT NULL AND w.estilo != '' AND ${whereClause}
            GROUP BY w.estilo ORDER BY LOWER(w.estilo)
        `, whereParams);
        const estilos = estilosR.rows.map(e => ({
            ...e,
            value: e.value.charAt(0).toUpperCase() + e.value.slice(1),
        }));

        // Municipios filtrados (solo si hay al menos un filtro geográfico para evitar queries masivas)
        let municipiosR;
        if (pais || region || provincia) {
            municipiosR = await db.query(`
                SELECT b.municipio as value, b.provincia as provincia,
                       b.comunidad_autonoma as region, b.pais, COUNT(*) as count
                FROM bienes b
                WHERE b.municipio IS NOT NULL AND b.municipio != '' AND ${whereClause}
                GROUP BY b.municipio, b.provincia, b.comunidad_autonoma, b.pais
                ORDER BY LOWER(b.municipio)
            `, whereParams);
        } else {
            municipiosR = { rows: [] };
        }

        res.json({
            paises: paisesR.rows,
            regiones: regionesR.rows,
            provincias: provinciasR.rows,
            municipios: municipiosR.rows,
            categorias: categoriasR.rows,
            tipos: tiposR.rows,
            estilos,
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
        let whereExtra = '';
        let queryParams = [];
        let pi = 1;
        if (req.query.pais) {
            whereExtra = ` AND pais = $${pi++}`;
            queryParams.push(req.query.pais);
        }

        const resumenR = await db.query(`
            SELECT
                comunidad_autonoma as region,
                pais,
                COUNT(*) as total,
                SUM(CASE WHEN latitud IS NOT NULL THEN 1 ELSE 0 END) as con_coords,
                AVG(latitud) as lat_centro,
                AVG(longitud) as lon_centro
            FROM bienes
            WHERE comunidad_autonoma IS NOT NULL AND latitud IS NOT NULL${whereExtra}
            GROUP BY comunidad_autonoma, pais
            ORDER BY total DESC
        `, queryParams);

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
        });

        // Verificar credenciales
        try {
            await transporter.verify();
        } catch (err) {
            return res.status(401).json({ error: `Error de autenticación Gmail: ${err.message}` });
        }

        // Iniciar job
        emailJob = {
            running: true,
            total: contactos.length,
            sent: 0,
            failed: 0,
            errors: [],
            started_at: new Date().toISOString(),
        };

        res.json({ ok: true, total: contactos.length, message: `Iniciando envío a ${contactos.length} contactos` });

        // Enviar secuencialmente en background
        (async () => {
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
                    await transporter.sendMail({
                        from: gmail_user,
                        to: email,
                        subject: asuntoFinal,
                        text: cuerpoFinal,
                        html: cuerpoFinal.replace(/\n/g, '<br>'),
                        attachments,
                    });
                    emailJob.sent++;
                    console.log(`[Email ${i + 1}/${contactos.length}] OK -> ${email} (${c.municipio})${attachments.length ? ` [${attachments.length} adjunto${attachments.length !== 1 ? 's' : ''}]` : ''}`);
                } catch (err) {
                    emailJob.failed++;
                    emailJob.errors.push({ municipio: c.municipio, email, error: err.message });
                    console.error(`[Email ${i + 1}/${contactos.length}] ERROR -> ${email}: ${err.message}`);
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
});
