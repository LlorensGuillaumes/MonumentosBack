// Análisis del tráfico capturado en analytics_events
require('dotenv').config();
const db = require('./db.cjs');

async function main() {
  const dias = 30;
  console.log(`\n========== ANÁLISIS DE TRÁFICO (últimos ${dias} días) ==========\n`);

  const summary = await db.obtenerTraficoSummary(dias);
  console.log('--- RESUMEN ---');
  console.log(`Eventos totales: ${summary.total_events}`);
  console.log(`Pageviews: ${summary.total_pageviews}`);
  console.log(`Visitantes únicos (por ip_hash): ${summary.unique_visitors}`);
  console.log(`Usuarios logueados distintos: ${summary.unique_users_logged}`);
  console.log(`Eventos hoy: ${summary.events_hoy}`);
  console.log(`Pageviews hoy: ${summary.pageviews_hoy}`);

  console.log('\n--- POR TIPO DE EVENTO ---');
  summary.by_event_type.forEach(r => console.log(`  ${r.event_type.padEnd(20)} ${r.n}`));

  console.log('\n--- POR PAÍS ---');
  if (summary.by_country.length === 0) console.log('  (sin datos — necesita proxy CF-IPCountry)');
  else summary.by_country.forEach(r => console.log(`  ${r.country.padEnd(4)} ${r.n}`));

  console.log('\n--- POR DISPOSITIVO ---');
  if (summary.by_device.length === 0) console.log('  (sin datos)');
  else summary.by_device.forEach(r => console.log(`  ${(r.device || 'unknown').padEnd(12)} ${r.n}`));

  const byDay = await db.obtenerTraficoPorDia(dias);
  console.log('\n--- EVOLUCIÓN DIARIA ---');
  if (byDay.length === 0) console.log('  (sin datos)');
  else byDay.forEach(r => {
    const dia = new Date(r.dia).toISOString().slice(0, 10);
    console.log(`  ${dia}  pv=${String(r.pageviews).padStart(4)} uniq=${String(r.uniques).padStart(4)} log=${String(r.users_logged).padStart(3)}`);
  });

  const topUrls = await db.obtenerTopUrls(dias, 20);
  console.log('\n--- TOP URLs ---');
  if (topUrls.length === 0) console.log('  (sin datos)');
  else topUrls.forEach(r => console.log(`  ${String(r.views).padStart(4)} (${String(r.uniques).padStart(3)} uniq)  ${r.url}`));

  const topReferrers = await db.obtenerTopReferrers(dias, 15);
  console.log('\n--- TOP REFERRERS EXTERNOS ---');
  if (topReferrers.length === 0) console.log('  (sin referrers externos detectados)');
  else topReferrers.forEach(r => console.log(`  ${String(r.visits).padStart(3)}  ${r.referrer}`));

  const topMon = await db.obtenerTopMonumentos(dias, 15);
  console.log('\n--- TOP MONUMENTOS VISTOS ---');
  if (topMon.length === 0) console.log('  (sin eventos monument_view)');
  else topMon.forEach(r => console.log(`  ${String(r.views).padStart(3)} (${String(r.uniques).padStart(2)} uniq)  #${r.bien_id}  ${r.denominacion || '???'}  ·  ${[r.municipio, r.pais].filter(Boolean).join(', ')}`));

  const topAcc = await db.obtenerTopAcciones(dias);
  console.log('\n--- ACCIONES (no pageviews) ---');
  if (topAcc.length === 0) console.log('  (sin acciones)');
  else topAcc.forEach(r => console.log(`  ${r.event_type.padEnd(20)} total=${String(r.total).padStart(4)}  usuarios=${r.usuarios_distintos}`));

  console.log('\n========== FIN ==========\n');
  await db.cerrar();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
