require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
  ssl: { rejectUnauthorized: false },
});

const MOSAICS_START = "2026-05-27 12:30:00";

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ANÁLISIS TRÁFICO POST-MOSAICS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('🗓️  ÚLTIMOS 7 DÍAS\n');
  const r14 = await pool.query(`
    SELECT
      TO_CHAR(DATE(created_at AT TIME ZONE 'Europe/Madrid'), 'YYYY-MM-DD Dy') AS dia,
      COUNT(*) AS eventos,
      COUNT(DISTINCT session_id) AS sesiones,
      COUNT(DISTINCT ip_hash) AS ips
    FROM analytics_events
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY DATE(created_at AT TIME ZONE 'Europe/Madrid')
    ORDER BY 1 DESC
  `);
  console.log('Día                | Eventos | Sesiones | IPs únicas');
  r14.rows.forEach(r => console.log(
    r.dia.padEnd(20) + '| ' + String(r.eventos).padStart(7) + ' | ' +
    String(r.sesiones).padStart(8) + ' | ' + String(r.ips).padStart(10)
  ));

  console.log('\n⏰  HORA A HORA DESDE EMISIÓN MOSAICS\n');
  const rh = await pool.query(`
    SELECT
      TO_CHAR(DATE_TRUNC('hour', created_at AT TIME ZONE 'Europe/Madrid'), 'DD/MM HH24h') AS hora,
      COUNT(*) AS eventos,
      COUNT(DISTINCT session_id) AS sesiones
    FROM analytics_events
    WHERE created_at > $1::timestamptz
    GROUP BY DATE_TRUNC('hour', created_at AT TIME ZONE 'Europe/Madrid')
    ORDER BY 1
  `, [MOSAICS_START]);
  console.log('Hora        | Eventos | Sesiones');
  rh.rows.forEach(r => console.log(
    r.hora.padEnd(12) + '| ' + String(r.eventos).padStart(7) + ' | ' + String(r.sesiones).padStart(8)
  ));

  console.log('\n🌐  REFERRERS DESDE MOSAICS\n');
  const rref = await pool.query(`
    SELECT
      CASE
        WHEN referrer IS NULL OR referrer = '' THEN '(directo)'
        WHEN referrer ~* 'netlify.app' THEN '(navegación interna)'
        WHEN referrer ~* 'eixdiari' THEN 'eixdiari.cat'
        WHEN referrer ~* 'instagram' THEN 'Instagram'
        WHEN referrer ~* 'facebook' THEN 'Facebook'
        WHEN referrer ~* 'linkedin' THEN 'LinkedIn'
        WHEN referrer ~* 'whatsapp' THEN 'WhatsApp'
        WHEN referrer ~* 'google' THEN 'Google'
        WHEN referrer ~* 'rtvelvendrell' THEN 'RTV El Vendrell'
        WHEN referrer ~* 'rtvvilafranca' THEN 'RTV Vilafranca'
        WHEN referrer ~* 'xtec' THEN 'XTEC'
        WHEN referrer ~* 'el3de|3de8' THEN '3 de 8'
        ELSE referrer
      END AS source,
      COUNT(*) AS hits,
      COUNT(DISTINCT session_id) AS sesiones
    FROM analytics_events
    WHERE created_at > $1::timestamptz
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 15
  `, [MOSAICS_START]);
  console.log('Fuente                          | Hits  | Sesiones');
  rref.rows.forEach(r => console.log(
    String(r.source).slice(0, 32).padEnd(32) + '| ' +
    String(r.hits).padStart(5) + ' | ' + String(r.sesiones).padStart(8)
  ));

  console.log('\n📄  PÁGINAS DESDE MOSAICS\n');
  const rurl = await pool.query(`
    SELECT url, COUNT(*) AS hits, COUNT(DISTINCT session_id) AS sesiones
    FROM analytics_events
    WHERE created_at > $1::timestamptz AND event_type = 'pageview'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 15
  `, [MOSAICS_START]);
  console.log('URL                                            | Hits | Sesiones');
  rurl.rows.forEach(r => console.log(
    String(r.url).slice(0, 47).padEnd(47) + '| ' +
    String(r.hits).padStart(4) + ' | ' + String(r.sesiones).padStart(8)
  ));

  console.log('\n🏛️  BIENES MÁS VISTOS DESDE MOSAICS\n');
  const rb = await pool.query(`
    SELECT b.id, b.denominacion, b.comunidad_autonoma,
           COUNT(*) AS views, COUNT(DISTINCT e.session_id) AS sesiones
    FROM analytics_events e
    INNER JOIN bienes b ON b.id = e.bien_id
    WHERE e.created_at > $1::timestamptz AND e.bien_id IS NOT NULL
    GROUP BY b.id, b.denominacion, b.comunidad_autonoma
    ORDER BY views DESC LIMIT 12
  `, [MOSAICS_START]);
  console.log('Bien                                              | CCAA          | Views | Sesiones');
  rb.rows.forEach(r => console.log(
    ('#' + r.id + ' ' + String(r.denominacion).slice(0, 38)).padEnd(50) + '| ' +
    String(r.comunidad_autonoma || '-').slice(0, 13).padEnd(13) + ' | ' +
    String(r.views).padStart(5) + ' | ' + String(r.sesiones).padStart(8)
  ));

  console.log('\n👤  REGISTROS USUARIOS últimos 7 días\n');
  const ru = await pool.query(`
    SELECT TO_CHAR(DATE(created_at AT TIME ZONE 'Europe/Madrid'), 'YYYY-MM-DD Dy') AS dia, COUNT(*) AS n
    FROM usuarios
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY DATE(created_at AT TIME ZONE 'Europe/Madrid')
    ORDER BY 1 DESC
  `);
  if (ru.rows.length === 0) console.log('  (sin registros)');
  ru.rows.forEach(r => console.log('  ' + r.dia + '  ' + r.n + ' registro(s)'));

  console.log('\n🔬  ENGAGEMENT POR SESIÓN DESDE MOSAICS\n');
  const rdepth = await pool.query(`
    WITH depth AS (
      SELECT session_id, COUNT(*) AS events_per_session
      FROM analytics_events
      WHERE created_at > $1::timestamptz
      GROUP BY session_id
    )
    SELECT
      CASE
        WHEN events_per_session = 1 THEN '1 evento (rebote)'
        WHEN events_per_session BETWEEN 2 AND 3 THEN '2-3 eventos'
        WHEN events_per_session BETWEEN 4 AND 7 THEN '4-7 eventos'
        WHEN events_per_session BETWEEN 8 AND 15 THEN '8-15 eventos'
        ELSE '16+ (engagement alto)'
      END AS bucket,
      COUNT(*) AS sesiones,
      ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
    FROM depth
    GROUP BY 1
    ORDER BY MIN(events_per_session)
  `, [MOSAICS_START]);
  rdepth.rows.forEach(r => console.log(
    '  ' + String(r.bucket).padEnd(30) +
    String(r.sesiones).padStart(4) + ' sesiones  (' + r.pct + '%)'
  ));

  console.log('\n🌍  PAÍSES DESDE MOSAICS\n');
  const rc = await pool.query(`
    SELECT COALESCE(country, '(no detectado)') AS country, COUNT(DISTINCT session_id) AS sesiones
    FROM analytics_events
    WHERE created_at > $1::timestamptz
    GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  `, [MOSAICS_START]);
  rc.rows.forEach(r => console.log('  ' + String(r.country).padEnd(20) + String(r.sesiones).padStart(4) + ' sesiones'));

  console.log('\n📱  DISPOSITIVOS DESDE MOSAICS\n');
  const rd = await pool.query(`
    SELECT COALESCE(device, '(no detectado)') AS device, COUNT(DISTINCT session_id) AS sesiones
    FROM analytics_events
    WHERE created_at > $1::timestamptz
    GROUP BY 1 ORDER BY 2 DESC
  `, [MOSAICS_START]);
  rd.rows.forEach(r => console.log('  ' + String(r.device).padEnd(20) + String(r.sesiones).padStart(4) + ' sesiones'));

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
