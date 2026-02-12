const { Pool, types } = require('pg');
require('dotenv').config();

// Parse int8 (bigint) as JavaScript number instead of string
types.setTypeParser(20, parseInt);

let _pool = null;
let _initialized = false;

function getPool() {
    if (!_pool) {
        if (process.env.DATABASE_URL) {
            _pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: { rejectUnauthorized: false },
            });
        } else {
            _pool = new Pool({
                host: process.env.PGHOST || 'localhost',
                port: parseInt(process.env.PGPORT) || 5432,
                user: process.env.PGUSER || 'patrimonio',
                password: process.env.PGPASSWORD || 'patrimonio2026',
                database: process.env.PGDATABASE || 'patrimonio',
            });
        }
    }
    return _pool;
}

// Convert ? placeholders to $1, $2, ... for pg compatibility
function pgParams(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

async function inicializarTablas() {
    const pool = getPool();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS bienes (
            id SERIAL PRIMARY KEY,
            denominacion TEXT NOT NULL,
            tipo TEXT,
            clase TEXT,
            categoria TEXT,
            provincia TEXT,
            comarca TEXT,
            municipio TEXT,
            localidad TEXT,
            latitud DOUBLE PRECISION,
            longitud DOUBLE PRECISION,
            situacion TEXT,
            resolucion TEXT,
            publicacion TEXT,
            fuente_opendata INTEGER DEFAULT 0,
            comunidad_autonoma TEXT DEFAULT 'Aragon',
            codigo_fuente TEXT,
            pais TEXT DEFAULT 'España',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS wikidata (
            id SERIAL PRIMARY KEY,
            bien_id INTEGER UNIQUE REFERENCES bienes(id),
            qid TEXT,
            descripcion TEXT,
            imagen_url TEXT,
            arquitecto TEXT,
            estilo TEXT,
            material TEXT,
            altura DOUBLE PRECISION,
            superficie DOUBLE PRECISION,
            inception TEXT,
            heritage_label TEXT,
            wikipedia_url TEXT,
            commons_category TEXT,
            sipca_code TEXT,
            raw_json TEXT
        );

        CREATE TABLE IF NOT EXISTS sipca (
            id SERIAL PRIMARY KEY,
            bien_id INTEGER UNIQUE REFERENCES bienes(id),
            sipca_id TEXT,
            descripcion_completa TEXT,
            sintesis_historica TEXT,
            datacion TEXT,
            periodo_historico TEXT,
            siglo TEXT,
            ubicacion_detalle TEXT,
            fuentes TEXT,
            bibliografia TEXT,
            meta_description TEXT,
            url TEXT
        );

        CREATE TABLE IF NOT EXISTS imagenes (
            id SERIAL PRIMARY KEY,
            bien_id INTEGER REFERENCES bienes(id),
            url TEXT NOT NULL,
            titulo TEXT,
            autor TEXT,
            fuente TEXT
        );

        CREATE TABLE IF NOT EXISTS usuarios (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            nombre TEXT,
            idioma_por_defecto TEXT DEFAULT 'es',
            google_id TEXT UNIQUE,
            avatar_url TEXT,
            rol TEXT DEFAULT 'user',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_login TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS favoritos (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            bien_id INTEGER NOT NULL REFERENCES bienes(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(usuario_id, bien_id)
        );

        CREATE TABLE IF NOT EXISTS contactos_municipios (
            id SERIAL PRIMARY KEY,
            municipio TEXT NOT NULL,
            provincia TEXT,
            comunidad_autonoma TEXT,
            email_patrimonio TEXT,
            email_general TEXT,
            persona_contacto TEXT,
            cargo TEXT,
            telefono TEXT,
            web TEXT,
            fuente TEXT,
            fecha_actualizacion TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(municipio, provincia)
        );

        CREATE TABLE IF NOT EXISTS notas_contactos (
            id SERIAL PRIMARY KEY,
            contacto_id INTEGER NOT NULL REFERENCES contactos_municipios(id) ON DELETE CASCADE,
            texto TEXT NOT NULL,
            es_tarea INTEGER DEFAULT 0,
            completada INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS login_history (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            login_at TIMESTAMPTZ DEFAULT NOW(),
            method TEXT DEFAULT 'email'
        );
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_bienes_denominacion ON bienes(denominacion);
        CREATE INDEX IF NOT EXISTS idx_bienes_municipio ON bienes(municipio);
        CREATE INDEX IF NOT EXISTS idx_bienes_provincia ON bienes(provincia);
        CREATE INDEX IF NOT EXISTS idx_wikidata_qid ON wikidata(qid);
        CREATE INDEX IF NOT EXISTS idx_wikidata_sipca ON wikidata(sipca_code);
        CREATE INDEX IF NOT EXISTS idx_sipca_sipca_id ON sipca(sipca_id);
        CREATE INDEX IF NOT EXISTS idx_imagenes_bien ON imagenes(bien_id);
        CREATE INDEX IF NOT EXISTS idx_bienes_ccaa ON bienes(comunidad_autonoma);
        CREATE INDEX IF NOT EXISTS idx_bienes_pais ON bienes(pais);
        CREATE INDEX IF NOT EXISTS idx_contactos_municipio ON contactos_municipios(municipio);
        CREATE INDEX IF NOT EXISTS idx_contactos_provincia ON contactos_municipios(provincia);
        CREATE INDEX IF NOT EXISTS idx_contactos_ccaa ON contactos_municipios(comunidad_autonoma);
        CREATE INDEX IF NOT EXISTS idx_notas_contacto ON notas_contactos(contacto_id);
        CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
        CREATE INDEX IF NOT EXISTS idx_usuarios_google ON usuarios(google_id);
        CREATE INDEX IF NOT EXISTS idx_login_history_usuario ON login_history(usuario_id);
        CREATE INDEX IF NOT EXISTS idx_login_history_login_at ON login_history(login_at);
        CREATE INDEX IF NOT EXISTS idx_favoritos_usuario ON favoritos(usuario_id);
        CREATE INDEX IF NOT EXISTS idx_favoritos_bien ON favoritos(bien_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bienes_pais_ccaa_codigo ON bienes(pais, comunidad_autonoma, codigo_fuente);
    `);

    _initialized = true;
}

async function ensureInit() {
    if (!_initialized) await inicializarTablas();
}

// Generic query helper — auto-converts ? placeholders to $1,$2,...
async function query(sql, params = []) {
    await ensureInit();
    return getPool().query(pgParams(sql), params);
}

// Transaction helper
async function transaction(fn) {
    await ensureInit();
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// =========== CRUD bienes ===========

const BIENES_COLS = 'denominacion, tipo, clase, categoria, provincia, comarca, municipio, localidad, latitud, longitud, situacion, resolucion, publicacion, fuente_opendata, comunidad_autonoma, codigo_fuente, pais';
const BIENES_VALS = '$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17';

function bienParams(b) {
    return [b.denominacion, b.tipo, b.clase, b.categoria, b.provincia, b.comarca, b.municipio, b.localidad, b.latitud, b.longitud, b.situacion, b.resolucion, b.publicacion, b.fuente_opendata, b.comunidad_autonoma, b.codigo_fuente, b.pais];
}

async function insertarBien(bien) {
    await ensureInit();
    const result = await getPool().query(
        `INSERT INTO bienes (${BIENES_COLS}) VALUES (${BIENES_VALS}) RETURNING id`,
        bienParams(bien)
    );
    return { lastInsertRowid: result.rows[0].id, changes: result.rowCount };
}

async function insertarBienes(bienes) {
    await transaction(async (client) => {
        for (const bien of bienes) {
            await client.query(
                `INSERT INTO bienes (${BIENES_COLS}) VALUES (${BIENES_VALS})`,
                bienParams(bien)
            );
        }
    });
}

const UPSERT_SET = `denominacion=EXCLUDED.denominacion, tipo=EXCLUDED.tipo, clase=EXCLUDED.clase,
            categoria=EXCLUDED.categoria, provincia=EXCLUDED.provincia, comarca=EXCLUDED.comarca,
            municipio=EXCLUDED.municipio, localidad=EXCLUDED.localidad, latitud=EXCLUDED.latitud,
            longitud=EXCLUDED.longitud, situacion=EXCLUDED.situacion, resolucion=EXCLUDED.resolucion,
            publicacion=EXCLUDED.publicacion, fuente_opendata=EXCLUDED.fuente_opendata,
            updated_at=NOW()`;

async function upsertBien(bien) {
    await ensureInit();
    const result = await getPool().query(
        `INSERT INTO bienes (${BIENES_COLS}) VALUES (${BIENES_VALS})
         ON CONFLICT(pais, comunidad_autonoma, codigo_fuente) DO UPDATE SET ${UPSERT_SET}
         RETURNING id`,
        bienParams(bien)
    );
    return { lastInsertRowid: result.rows[0].id, changes: result.rowCount };
}

async function upsertBienes(bienes) {
    await transaction(async (client) => {
        for (const bien of bienes) {
            await client.query(
                `INSERT INTO bienes (${BIENES_COLS}) VALUES (${BIENES_VALS})
                 ON CONFLICT(pais, comunidad_autonoma, codigo_fuente) DO UPDATE SET ${UPSERT_SET}`,
                bienParams(bien)
            );
        }
    });
}

async function obtenerBien(id) {
    await ensureInit();
    const result = await getPool().query('SELECT * FROM bienes WHERE id = $1', [id]);
    return result.rows[0];
}

async function obtenerTodos() {
    await ensureInit();
    const result = await getPool().query('SELECT * FROM bienes ORDER BY id');
    return result.rows;
}

async function obtenerSinWikidata() {
    await ensureInit();
    const result = await getPool().query(`
        SELECT b.* FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE w.id IS NULL
        ORDER BY b.id
    `);
    return result.rows;
}

async function obtenerBienesPorRegion(ccaa, pais) {
    await ensureInit();
    if (pais) {
        const result = await getPool().query('SELECT * FROM bienes WHERE comunidad_autonoma = $1 AND pais = $2 ORDER BY id', [ccaa, pais]);
        return result.rows;
    }
    const result = await getPool().query('SELECT * FROM bienes WHERE comunidad_autonoma = $1 ORDER BY id', [ccaa]);
    return result.rows;
}

async function obtenerBienesPorPais(pais) {
    await ensureInit();
    const result = await getPool().query('SELECT * FROM bienes WHERE pais = $1 ORDER BY id', [pais]);
    return result.rows;
}

async function obtenerSinWikidataPorRegion(ccaa) {
    await ensureInit();
    const result = await getPool().query(`
        SELECT b.* FROM bienes b
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE (w.id IS NULL OR w.qid IS NULL) AND b.comunidad_autonoma = $1
        ORDER BY b.id
    `, [ccaa]);
    return result.rows;
}

async function limpiarBienesPorRegion(ccaa) {
    await transaction(async (client) => {
        await client.query('DELETE FROM imagenes WHERE bien_id IN (SELECT id FROM bienes WHERE comunidad_autonoma = $1)', [ccaa]);
        await client.query('DELETE FROM sipca WHERE bien_id IN (SELECT id FROM bienes WHERE comunidad_autonoma = $1)', [ccaa]);
        await client.query('DELETE FROM wikidata WHERE bien_id IN (SELECT id FROM bienes WHERE comunidad_autonoma = $1)', [ccaa]);
        await client.query('DELETE FROM bienes WHERE comunidad_autonoma = $1', [ccaa]);
    });
}

async function obtenerSinSipca() {
    await ensureInit();
    const result = await getPool().query(`
        SELECT b.*, w.sipca_code FROM bienes b
        LEFT JOIN sipca s ON b.id = s.bien_id
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE s.id IS NULL
        ORDER BY (CASE WHEN w.sipca_code IS NOT NULL THEN 0 ELSE 1 END), b.id
    `);
    return result.rows;
}

async function obtenerSinSipcaPorRegion(ccaa) {
    await ensureInit();
    const result = await getPool().query(`
        SELECT b.*, w.sipca_code FROM bienes b
        LEFT JOIN sipca s ON b.id = s.bien_id
        LEFT JOIN wikidata w ON b.id = w.bien_id
        WHERE s.id IS NULL AND b.comunidad_autonoma = $1
        ORDER BY (CASE WHEN w.sipca_code IS NOT NULL THEN 0 ELSE 1 END), b.id
    `, [ccaa]);
    return result.rows;
}

async function contarBienes() {
    await ensureInit();
    const result = await getPool().query('SELECT COUNT(*) as total FROM bienes');
    return result.rows[0].total;
}

async function limpiarBienes() {
    await transaction(async (client) => {
        await client.query('DELETE FROM imagenes');
        await client.query('DELETE FROM sipca');
        await client.query('DELETE FROM wikidata');
        await client.query('DELETE FROM bienes');
    });
}

// =========== CRUD wikidata ===========

async function insertarWikidata(data) {
    await ensureInit();
    const result = await getPool().query(`
        INSERT INTO wikidata (bien_id, qid, descripcion, imagen_url, arquitecto, estilo, material, altura, superficie, inception, heritage_label, wikipedia_url, commons_category, sipca_code, raw_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(bien_id) DO UPDATE SET
            qid=EXCLUDED.qid, descripcion=EXCLUDED.descripcion, imagen_url=EXCLUDED.imagen_url,
            arquitecto=EXCLUDED.arquitecto, estilo=EXCLUDED.estilo, material=EXCLUDED.material,
            altura=EXCLUDED.altura, superficie=EXCLUDED.superficie, inception=EXCLUDED.inception,
            heritage_label=EXCLUDED.heritage_label, wikipedia_url=EXCLUDED.wikipedia_url,
            commons_category=EXCLUDED.commons_category, sipca_code=EXCLUDED.sipca_code,
            raw_json=EXCLUDED.raw_json
        RETURNING id
    `, [data.bien_id, data.qid, data.descripcion, data.imagen_url, data.arquitecto, data.estilo, data.material, data.altura, data.superficie, data.inception, data.heritage_label, data.wikipedia_url, data.commons_category, data.sipca_code, data.raw_json]);
    return { lastInsertRowid: result.rows[0].id, changes: result.rowCount };
}

// =========== CRUD sipca ===========

async function insertarSipca(data) {
    await ensureInit();
    const result = await getPool().query(`
        INSERT INTO sipca (bien_id, sipca_id, descripcion_completa, sintesis_historica, datacion, periodo_historico, siglo, ubicacion_detalle, fuentes, bibliografia, meta_description, url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(bien_id) DO UPDATE SET
            sipca_id=EXCLUDED.sipca_id, descripcion_completa=EXCLUDED.descripcion_completa,
            sintesis_historica=EXCLUDED.sintesis_historica, datacion=EXCLUDED.datacion,
            periodo_historico=EXCLUDED.periodo_historico, siglo=EXCLUDED.siglo,
            ubicacion_detalle=EXCLUDED.ubicacion_detalle, fuentes=EXCLUDED.fuentes,
            bibliografia=EXCLUDED.bibliografia, meta_description=EXCLUDED.meta_description,
            url=EXCLUDED.url
        RETURNING id
    `, [data.bien_id, data.sipca_id, data.descripcion_completa, data.sintesis_historica, data.datacion, data.periodo_historico, data.siglo, data.ubicacion_detalle, data.fuentes, data.bibliografia, data.meta_description, data.url]);
    return { lastInsertRowid: result.rows[0].id, changes: result.rowCount };
}

// =========== CRUD imagenes ===========

async function insertarImagen(data) {
    await ensureInit();
    const result = await getPool().query(`
        INSERT INTO imagenes (bien_id, url, titulo, autor, fuente)
        VALUES ($1,$2,$3,$4,$5) RETURNING id
    `, [data.bien_id, data.url, data.titulo, data.autor, data.fuente]);
    return { lastInsertRowid: result.rows[0].id, changes: result.rowCount };
}

async function insertarImagenes(imagenes) {
    await transaction(async (client) => {
        for (const img of imagenes) {
            await client.query(
                `INSERT INTO imagenes (bien_id, url, titulo, autor, fuente) VALUES ($1,$2,$3,$4,$5)`,
                [img.bien_id, img.url, img.titulo, img.autor, img.fuente]
            );
        }
    });
}

async function obtenerImagenes(bienId) {
    await ensureInit();
    const result = await getPool().query('SELECT * FROM imagenes WHERE bien_id = $1', [bienId]);
    return result.rows;
}

// =========== Estadísticas ===========

async function estadisticas() {
    await ensureInit();
    const pool = getPool();
    const [bienes, con_wikidata, con_sipca, imagenes, por_provincia, por_categoria, por_ccaa, por_pais] = await Promise.all([
        pool.query('SELECT COUNT(*) as n FROM bienes'),
        pool.query('SELECT COUNT(*) as n FROM wikidata WHERE qid IS NOT NULL'),
        pool.query('SELECT COUNT(*) as n FROM sipca'),
        pool.query('SELECT COUNT(*) as n FROM imagenes'),
        pool.query('SELECT provincia, COUNT(*) as n FROM bienes GROUP BY provincia ORDER BY n DESC'),
        pool.query('SELECT categoria, COUNT(*) as n FROM bienes GROUP BY categoria ORDER BY n DESC'),
        pool.query('SELECT comunidad_autonoma, COUNT(*) as n FROM bienes GROUP BY comunidad_autonoma ORDER BY n DESC'),
        pool.query('SELECT pais, COUNT(*) as n FROM bienes GROUP BY pais ORDER BY n DESC'),
    ]);
    return {
        bienes: bienes.rows[0].n,
        con_wikidata: con_wikidata.rows[0].n,
        con_sipca: con_sipca.rows[0].n,
        imagenes: imagenes.rows[0].n,
        por_provincia: por_provincia.rows,
        por_categoria: por_categoria.rows,
        por_ccaa: por_ccaa.rows,
        por_pais: por_pais.rows,
    };
}

// =========== CRUD contactos_municipios ===========

async function upsertContacto(data) {
    await ensureInit();
    const result = await getPool().query(`
        INSERT INTO contactos_municipios (municipio, provincia, comunidad_autonoma, email_patrimonio, email_general, persona_contacto, cargo, telefono, web, fuente)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(municipio, provincia) DO UPDATE SET
            email_patrimonio=COALESCE(EXCLUDED.email_patrimonio, contactos_municipios.email_patrimonio),
            email_general=COALESCE(EXCLUDED.email_general, contactos_municipios.email_general),
            persona_contacto=COALESCE(EXCLUDED.persona_contacto, contactos_municipios.persona_contacto),
            cargo=COALESCE(EXCLUDED.cargo, contactos_municipios.cargo),
            telefono=COALESCE(EXCLUDED.telefono, contactos_municipios.telefono),
            web=COALESCE(EXCLUDED.web, contactos_municipios.web),
            fuente=EXCLUDED.fuente,
            fecha_actualizacion=NOW()
        RETURNING id
    `, [data.municipio, data.provincia, data.comunidad_autonoma, data.email_patrimonio, data.email_general, data.persona_contacto, data.cargo, data.telefono, data.web, data.fuente]);
    return { lastInsertRowid: result.rows[0].id, changes: result.rowCount };
}

async function upsertContactos(contactos) {
    await transaction(async (client) => {
        for (const data of contactos) {
            await client.query(`
                INSERT INTO contactos_municipios (municipio, provincia, comunidad_autonoma, email_patrimonio, email_general, persona_contacto, cargo, telefono, web, fuente)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT(municipio, provincia) DO UPDATE SET
                    email_patrimonio=COALESCE(EXCLUDED.email_patrimonio, contactos_municipios.email_patrimonio),
                    email_general=COALESCE(EXCLUDED.email_general, contactos_municipios.email_general),
                    persona_contacto=COALESCE(EXCLUDED.persona_contacto, contactos_municipios.persona_contacto),
                    cargo=COALESCE(EXCLUDED.cargo, contactos_municipios.cargo),
                    telefono=COALESCE(EXCLUDED.telefono, contactos_municipios.telefono),
                    web=COALESCE(EXCLUDED.web, contactos_municipios.web),
                    fuente=EXCLUDED.fuente,
                    fecha_actualizacion=NOW()
            `, [data.municipio, data.provincia, data.comunidad_autonoma, data.email_patrimonio, data.email_general, data.persona_contacto, data.cargo, data.telefono, data.web, data.fuente]);
        }
    });
}

async function obtenerContactos(filtros = {}) {
    await ensureInit();
    let where = [];
    let params = [];
    let i = 1;
    if (filtros.comunidad_autonoma) {
        where.push(`comunidad_autonoma = $${i++}`);
        params.push(filtros.comunidad_autonoma);
    }
    if (filtros.provincia) {
        where.push(`provincia = $${i++}`);
        params.push(filtros.provincia);
    }
    if (filtros.municipio) {
        where.push(`municipio ILIKE $${i++}`);
        params.push(`%${filtros.municipio}%`);
    }
    if (filtros.solo_con_email === true) {
        where.push('(email_patrimonio IS NOT NULL OR email_general IS NOT NULL)');
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const result = await getPool().query(`SELECT * FROM contactos_municipios ${whereClause} ORDER BY comunidad_autonoma, provincia, municipio`, params);
    return result.rows;
}

async function obtenerContacto(municipio, provincia) {
    await ensureInit();
    const result = await getPool().query('SELECT * FROM contactos_municipios WHERE municipio = $1 AND provincia = $2', [municipio, provincia]);
    return result.rows[0];
}

async function estadisticasContactos() {
    await ensureInit();
    const pool = getPool();
    const [total, con_email_patrimonio, con_email_general, con_contacto, por_ccaa] = await Promise.all([
        pool.query('SELECT COUNT(*) as n FROM contactos_municipios'),
        pool.query('SELECT COUNT(*) as n FROM contactos_municipios WHERE email_patrimonio IS NOT NULL'),
        pool.query('SELECT COUNT(*) as n FROM contactos_municipios WHERE email_general IS NOT NULL'),
        pool.query('SELECT COUNT(*) as n FROM contactos_municipios WHERE persona_contacto IS NOT NULL'),
        pool.query('SELECT comunidad_autonoma, COUNT(*) as total, SUM(CASE WHEN email_patrimonio IS NOT NULL OR email_general IS NOT NULL THEN 1 ELSE 0 END) as con_email FROM contactos_municipios GROUP BY comunidad_autonoma ORDER BY total DESC'),
    ]);
    return {
        total: total.rows[0].n,
        con_email_patrimonio: con_email_patrimonio.rows[0].n,
        con_email_general: con_email_general.rows[0].n,
        con_contacto: con_contacto.rows[0].n,
        por_ccaa: por_ccaa.rows,
    };
}

// =========== CRUD usuarios ===========

async function crearUsuario(data) {
    await ensureInit();
    const result = await getPool().query(`
        INSERT INTO usuarios (email, password_hash, nombre, idioma_por_defecto, google_id, avatar_url)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
    `, [data.email, data.password_hash, data.nombre, data.idioma_por_defecto, data.google_id, data.avatar_url]);
    return { lastInsertRowid: result.rows[0].id, changes: result.rowCount };
}

async function obtenerUsuarioPorEmail(email) {
    await ensureInit();
    const result = await getPool().query('SELECT * FROM usuarios WHERE email = $1', [email]);
    return result.rows[0];
}

async function obtenerUsuarioPorId(id) {
    await ensureInit();
    const result = await getPool().query('SELECT id, email, nombre, idioma_por_defecto, google_id, avatar_url, rol, created_at, last_login FROM usuarios WHERE id = $1', [id]);
    return result.rows[0];
}

async function obtenerUsuarioPorGoogleId(googleId) {
    await ensureInit();
    const result = await getPool().query('SELECT * FROM usuarios WHERE google_id = $1', [googleId]);
    return result.rows[0];
}

async function actualizarUsuario(id, data) {
    await ensureInit();
    const campos = [];
    const valores = [];
    let i = 1;
    for (const [key, val] of Object.entries(data)) {
        if (['nombre', 'idioma_por_defecto', 'avatar_url', 'password_hash', 'last_login', 'rol'].includes(key)) {
            campos.push(`${key} = $${i++}`);
            valores.push(val);
        }
    }
    if (campos.length === 0) return null;
    valores.push(id);
    const result = await getPool().query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${i}`, valores);
    return { changes: result.rowCount };
}

async function obtenerUsuarios({ page = 1, limit = 50, search, rol } = {}) {
    await ensureInit();
    const pool = getPool();
    let where = [];
    let params = [];
    let i = 1;
    if (search) {
        where.push(`(u.email ILIKE $${i} OR u.nombre ILIKE $${i + 1})`);
        params.push(`%${search}%`, `%${search}%`);
        i += 2;
    }
    if (rol) {
        where.push(`u.rol = $${i++}`);
        params.push(rol);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countResult = await pool.query(`SELECT COUNT(*) as n FROM usuarios u ${whereClause}`, params);
    const total = countResult.rows[0].n;

    const allParams = [...params, limit, offset];
    const items = await pool.query(
        `SELECT u.id, u.email, u.nombre, u.idioma_por_defecto, u.google_id, u.avatar_url, u.rol,
                CASE WHEN u.password_hash IS NOT NULL THEN 1 ELSE 0 END as has_password,
                u.created_at, u.last_login,
                COALESCE(ls.total_logins, 0) as total_logins,
                COALESCE(ls.logins_today, 0) as logins_today,
                COALESCE(ls.logins_week, 0) as logins_week,
                COALESCE(ls.logins_month, 0) as logins_month
         FROM usuarios u
         LEFT JOIN LATERAL (
            SELECT
                COUNT(*) as total_logins,
                COUNT(*) FILTER (WHERE lh.login_at >= CURRENT_DATE) as logins_today,
                COUNT(*) FILTER (WHERE lh.login_at >= CURRENT_DATE - INTERVAL '7 days') as logins_week,
                COUNT(*) FILTER (WHERE lh.login_at >= CURRENT_DATE - INTERVAL '30 days') as logins_month
            FROM login_history lh WHERE lh.usuario_id = u.id
         ) ls ON true
         ${whereClause}
         ORDER BY u.created_at DESC LIMIT $${i++} OFFSET $${i}`,
        allParams
    );

    return { items: items.rows, total, page, limit, pages: Math.ceil(total / limit) };
}

// =========== Analytics: login_history ===========

async function registrarLogin(usuarioId, method = 'email') {
    await ensureInit();
    await getPool().query(
        'INSERT INTO login_history (usuario_id, method) VALUES ($1, $2)',
        [usuarioId, method]
    );
}

async function obtenerAnalyticsSummary() {
    await ensureInit();
    const pool = getPool();
    const [
        totalUsuarios,
        activosHoy,
        activosSemana,
        activosMes,
        nuevosSemana,
        nuevosMes,
        porRol,
        porMetodo
    ] = await Promise.all([
        pool.query('SELECT COUNT(*) as n FROM usuarios'),
        pool.query(`SELECT COUNT(DISTINCT usuario_id) as n FROM login_history WHERE login_at >= CURRENT_DATE`),
        pool.query(`SELECT COUNT(DISTINCT usuario_id) as n FROM login_history WHERE login_at >= CURRENT_DATE - INTERVAL '7 days'`),
        pool.query(`SELECT COUNT(DISTINCT usuario_id) as n FROM login_history WHERE login_at >= CURRENT_DATE - INTERVAL '30 days'`),
        pool.query(`SELECT COUNT(*) as n FROM usuarios WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'`),
        pool.query(`SELECT COUNT(*) as n FROM usuarios WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'`),
        pool.query(`SELECT rol, COUNT(*) as n FROM usuarios GROUP BY rol ORDER BY n DESC`),
        pool.query(`SELECT method, COUNT(*) as n FROM login_history GROUP BY method ORDER BY n DESC`),
    ]);
    return {
        total_usuarios: totalUsuarios.rows[0].n,
        activos_hoy: activosHoy.rows[0].n,
        activos_semana: activosSemana.rows[0].n,
        activos_mes: activosMes.rows[0].n,
        nuevos_semana: nuevosSemana.rows[0].n,
        nuevos_mes: nuevosMes.rows[0].n,
        por_rol: porRol.rows,
        por_metodo: porMetodo.rows,
    };
}

async function obtenerRegistrosPorTiempo(periodo = 'month') {
    await ensureInit();
    const trunc = periodo === 'week' ? 'week' : 'month';
    const interval = periodo === 'week' ? '6 months' : '12 months';
    const result = await getPool().query(`
        SELECT DATE_TRUNC($1, created_at) as periodo, COUNT(*) as total
        FROM usuarios
        WHERE created_at >= CURRENT_DATE - $2::INTERVAL
        GROUP BY DATE_TRUNC($1, created_at)
        ORDER BY periodo
    `, [trunc, interval]);
    return result.rows;
}

async function obtenerLoginsPorDia(dias = 30) {
    await ensureInit();
    const result = await getPool().query(`
        SELECT DATE(login_at) as dia, COUNT(*) as total
        FROM login_history
        WHERE login_at >= CURRENT_DATE - $1 * INTERVAL '1 day'
        GROUP BY DATE(login_at)
        ORDER BY dia
    `, [dias]);
    return result.rows;
}

async function obtenerUsuariosMasActivos(limit = 10) {
    await ensureInit();
    const result = await getPool().query(`
        SELECT u.id, u.email, u.nombre, u.rol, COUNT(lh.id) as total_logins,
               MAX(lh.login_at) as ultimo_login
        FROM usuarios u
        JOIN login_history lh ON u.id = lh.usuario_id
        GROUP BY u.id, u.email, u.nombre, u.rol
        ORDER BY total_logins DESC
        LIMIT $1
    `, [limit]);
    return result.rows;
}

// =========== CRUD favoritos ===========

async function agregarFavorito(usuarioId, bienId) {
    await ensureInit();
    const result = await getPool().query(
        'INSERT INTO favoritos (usuario_id, bien_id) VALUES ($1, $2) ON CONFLICT(usuario_id, bien_id) DO NOTHING',
        [usuarioId, bienId]
    );
    return { changes: result.rowCount };
}

async function eliminarFavorito(usuarioId, bienId) {
    await ensureInit();
    const result = await getPool().query('DELETE FROM favoritos WHERE usuario_id = $1 AND bien_id = $2', [usuarioId, bienId]);
    return { changes: result.rowCount };
}

async function obtenerFavoritos(usuarioId, { page = 1, limit = 20 } = {}) {
    await ensureInit();
    const pool = getPool();
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*) as n FROM favoritos WHERE usuario_id = $1', [usuarioId]);
    const total = countResult.rows[0].n;
    const result = await pool.query(`
        SELECT b.id, b.denominacion, b.tipo, b.categoria, b.provincia, b.municipio,
               b.comunidad_autonoma, b.pais, b.latitud, b.longitud,
               w.imagen_url, w.qid, w.estilo, w.heritage_label,
               f.created_at as favorito_desde
        FROM favoritos f
        JOIN bienes b ON f.bien_id = b.id
        LEFT JOIN wikidata w ON w.bien_id = b.id
        WHERE f.usuario_id = $1
        ORDER BY f.created_at DESC
        LIMIT $2 OFFSET $3
    `, [usuarioId, limit, offset]);
    return { items: result.rows, total, page, limit, pages: Math.ceil(total / limit) };
}

async function esFavorito(usuarioId, bienId) {
    await ensureInit();
    const result = await getPool().query('SELECT 1 FROM favoritos WHERE usuario_id = $1 AND bien_id = $2', [usuarioId, bienId]);
    return result.rows.length > 0;
}

async function obtenerIdsFavoritos(usuarioId) {
    await ensureInit();
    const result = await getPool().query('SELECT bien_id FROM favoritos WHERE usuario_id = $1', [usuarioId]);
    return result.rows.map(r => r.bien_id);
}

// =========== CRUD contactos: edición y notas ===========

async function actualizarContacto(id, data) {
    await ensureInit();
    const campos = [];
    const valores = [];
    let i = 1;
    for (const [key, val] of Object.entries(data)) {
        if (['email_general', 'email_patrimonio', 'persona_contacto', 'cargo', 'telefono', 'web'].includes(key)) {
            campos.push(`${key} = $${i++}`);
            valores.push(val || null);
        }
    }
    if (campos.length === 0) return null;
    campos.push('fecha_actualizacion = NOW()');
    valores.push(id);
    const result = await getPool().query(`UPDATE contactos_municipios SET ${campos.join(', ')} WHERE id = $${i}`, valores);
    return { changes: result.rowCount };
}

async function obtenerNotasContacto(contactoId) {
    await ensureInit();
    const result = await getPool().query('SELECT * FROM notas_contactos WHERE contacto_id = $1 ORDER BY created_at DESC', [contactoId]);
    return result.rows;
}

async function crearNotaContacto(contactoId, texto, esTarea = false) {
    await ensureInit();
    const pool = getPool();
    const ins = await pool.query(
        'INSERT INTO notas_contactos (contacto_id, texto, es_tarea) VALUES ($1, $2, $3) RETURNING id',
        [contactoId, texto, esTarea ? 1 : 0]
    );
    const result = await pool.query('SELECT * FROM notas_contactos WHERE id = $1', [ins.rows[0].id]);
    return result.rows[0];
}

async function actualizarNota(notaId, data) {
    await ensureInit();
    const pool = getPool();
    const campos = [];
    const valores = [];
    let i = 1;
    if (data.es_tarea !== undefined) { campos.push(`es_tarea = $${i++}`); valores.push(data.es_tarea ? 1 : 0); }
    if (data.completada !== undefined) { campos.push(`completada = $${i++}`); valores.push(data.completada ? 1 : 0); }
    if (data.texto !== undefined) { campos.push(`texto = $${i++}`); valores.push(data.texto); }
    if (campos.length === 0) return null;
    valores.push(notaId);
    await pool.query(`UPDATE notas_contactos SET ${campos.join(', ')} WHERE id = $${i}`, valores);
    const result = await pool.query('SELECT * FROM notas_contactos WHERE id = $1', [notaId]);
    return result.rows[0];
}

async function obtenerTareas(filtros = {}) {
    await ensureInit();
    let where = ['n.es_tarea = 1'];
    let params = [];
    if (filtros.completada === true) { where.push('n.completada = 1'); }
    else if (filtros.completada === false) { where.push('n.completada = 0'); }
    const whereClause = `WHERE ${where.join(' AND ')}`;
    const result = await getPool().query(`
        SELECT n.*, c.municipio, c.provincia, c.comunidad_autonoma, c.email_general, c.email_patrimonio
        FROM notas_contactos n
        JOIN contactos_municipios c ON c.id = n.contacto_id
        ${whereClause}
        ORDER BY n.completada ASC, n.created_at DESC
    `, params);
    return result.rows;
}

async function eliminarNotaContacto(notaId) {
    await ensureInit();
    const result = await getPool().query('DELETE FROM notas_contactos WHERE id = $1', [notaId]);
    return { changes: result.rowCount };
}

// =========== Cerrar ===========

async function cerrar() {
    if (_pool) {
        await _pool.end();
        _pool = null;
        _initialized = false;
    }
}

module.exports = {
    query,
    transaction,
    inicializarTablas,
    insertarBien,
    insertarBienes,
    upsertBien,
    upsertBienes,
    obtenerBien,
    obtenerTodos,
    obtenerBienesPorRegion,
    obtenerBienesPorPais,
    obtenerSinWikidata,
    obtenerSinWikidataPorRegion,
    obtenerSinSipca,
    obtenerSinSipcaPorRegion,
    contarBienes,
    limpiarBienes,
    limpiarBienesPorRegion,
    insertarWikidata,
    insertarSipca,
    insertarImagen,
    insertarImagenes,
    obtenerImagenes,
    estadisticas,
    upsertContacto,
    upsertContactos,
    obtenerContactos,
    obtenerContacto,
    estadisticasContactos,
    actualizarContacto,
    obtenerNotasContacto,
    crearNotaContacto,
    actualizarNota,
    obtenerTareas,
    eliminarNotaContacto,
    crearUsuario,
    obtenerUsuarioPorEmail,
    obtenerUsuarioPorId,
    obtenerUsuarioPorGoogleId,
    actualizarUsuario,
    obtenerUsuarios,
    agregarFavorito,
    eliminarFavorito,
    obtenerFavoritos,
    esFavorito,
    obtenerIdsFavoritos,
    registrarLogin,
    obtenerAnalyticsSummary,
    obtenerRegistrosPorTiempo,
    obtenerLoginsPorDia,
    obtenerUsuariosMasActivos,
    cerrar,
};
