/**
 * Inserta contactos de turismo, museos, patronatos y asociaciones en contactos_municipios.
 * Todos verificados con datos reales de búsquedas web (abril 2026).
 * Ejecutar: node _seed_contactos_turismo.cjs
 */
require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(20, parseInt);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\s+/g, ''),
    ssl: { rejectUnauthorized: false },
});

const CONTACTOS = [
    // ===================== TURISMO - OFICINAS CCAA =====================
    // Andalucía
    { municipio: 'Oficina Turismo Andalucía - Málaga', provincia: 'Málaga', comunidad_autonoma: 'Andalucia', email_general: 'otmalaga@andalucia.org', tipo: 'turismo', web: 'https://www.andalucia.org', fuente: 'spain.info' },
    { municipio: 'Oficina Turismo Andalucía - Sevilla', provincia: 'Sevilla', comunidad_autonoma: 'Andalucia', email_general: 'otjusta@andalucia.org', tipo: 'turismo', web: 'https://www.andalucia.org', fuente: 'spain.info' },
    { municipio: 'Oficina Turismo Andalucía - Granada', provincia: 'Granada', comunidad_autonoma: 'Andalucia', email_general: 'otalhambra@andalucia.org', tipo: 'turismo', web: 'https://www.andalucia.org', fuente: 'spain.info' },
    { municipio: 'Oficina Turismo Andalucía - Córdoba', provincia: 'Córdoba', comunidad_autonoma: 'Andalucia', email_general: 'otcordoba@andalucia.org', tipo: 'turismo', web: 'https://www.andalucia.org', fuente: 'spain.info' },
    { municipio: 'Oficina Turismo Andalucía - Cádiz', provincia: 'Cádiz', comunidad_autonoma: 'Andalucia', email_general: 'otcadiz@andalucia.org', tipo: 'turismo', web: 'https://www.andalucia.org', fuente: 'spain.info' },
    { municipio: 'Oficina Turismo Andalucía - Almería', provincia: 'Almería', comunidad_autonoma: 'Andalucia', email_general: 'otalmeria@andalucia.org', tipo: 'turismo', web: 'https://www.andalucia.org', fuente: 'spain.info' },
    { municipio: 'Oficina Turismo Andalucía - Huelva', provincia: 'Huelva', comunidad_autonoma: 'Andalucia', email_general: 'othuelva@andalucia.org', tipo: 'turismo', web: 'https://www.andalucia.org', fuente: 'spain.info' },
    { municipio: 'Oficina Turismo Andalucía - Jaén', provincia: 'Jaén', comunidad_autonoma: 'Andalucia', email_general: 'otjaen@andalucia.org', tipo: 'turismo', web: 'https://www.andalucia.org', fuente: 'spain.info' },
    // Extremadura
    { municipio: 'Dirección General de Turismo de Extremadura', provincia: 'Badajoz', comunidad_autonoma: 'Extremadura', email_general: 'turismoextremadura@juntaex.es', telefono: '924332461', tipo: 'turismo', web: 'https://turismoextremadura.gobex.es', fuente: 'juntaex.es' },
    // Navarra
    { municipio: 'Turismo de Navarra', provincia: 'Navarra', comunidad_autonoma: 'Navarra', email_general: 'turismo@navarra.es', telefono: '948012012', tipo: 'turismo', web: 'https://www.visitnavarra.es', fuente: 'visitnavarra.es' },
    { municipio: 'Oficina de Turismo de Pamplona', provincia: 'Navarra', comunidad_autonoma: 'Navarra', email_general: 'oficinaturismo@pamplona.es', telefono: '948420700', tipo: 'turismo', web: 'https://www.visitnavarra.es', fuente: 'visitnavarra.es' },
    // Castilla y León
    { municipio: 'Turismo de Castilla y León - Madrid', provincia: 'Madrid', comunidad_autonoma: 'Castilla y Leon', email_general: 'oficinademadridfundacionsiglo@gmail.com', telefono: '915780324', tipo: 'turismo', web: 'https://www.turismocastillayleon.com', fuente: 'turismocastillayleon.com' },
    // Comunitat Valenciana
    { municipio: 'Turisme Comunitat Valenciana', provincia: 'Valencia', comunidad_autonoma: 'Comunitat Valenciana', email_general: null, telefono: null, tipo: 'turismo', web: 'https://www.comunitatvalenciana.com', fuente: 'comunitatvalenciana.com' },
    // País Vasco
    { municipio: 'Basquetour - Agencia Vasca de Turismo', provincia: 'Vizcaya', comunidad_autonoma: 'Pais Vasco', email_general: null, telefono: null, tipo: 'turismo', web: 'https://basquetour.eus', fuente: 'basquetour.eus' },

    // ===================== PATRONATOS Y ORGANISMOS PATRIMONIO =====================
    { municipio: 'Patronato de la Alhambra y Generalife', provincia: 'Granada', comunidad_autonoma: 'Andalucia', email_general: 'informacion.alhambra.pag@juntadeandalucia.es', telefono: '958027900', tipo: 'patronato', web: 'https://www.alhambra-patronato.es', fuente: 'juntadeandalucia.es' },
    { municipio: 'Patrimonio Nacional', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: 'agp@patrimonionacional.es', telefono: null, tipo: 'patronato', web: 'https://www.patrimonionacional.es', fuente: 'patrimonionacional.es' },
    { municipio: 'Instituto del Patrimonio Cultural de España (IPCE)', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: 'ipce.biblioteca@cultura.gob.es', telefono: '915504436', tipo: 'patronato', web: 'https://ipce.cultura.gob.es', fuente: 'cultura.gob.es' },
    { municipio: 'Real Alcázar de Sevilla', provincia: 'Sevilla', comunidad_autonoma: 'Andalucia', email_general: null, telefono: null, tipo: 'patronato', web: 'https://alcazarsevilla.org', fuente: 'alcazarsevilla.org' },

    // ===================== MUSEOS =====================
    { municipio: 'Museo Nacional del Prado', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: 'cav@museodelprado.es', telefono: '910683001', tipo: 'museo', web: 'https://www.museodelprado.es', fuente: 'museodelprado.es' },
    { municipio: 'Museo Arqueológico Nacional', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: 'info.man@cultura.gob.es', telefono: '915777912', tipo: 'museo', web: 'https://www.man.es', fuente: 'man.es' },
    { municipio: 'Museo Nacional Centro de Arte Reina Sofía', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: null, telefono: null, tipo: 'museo', web: 'https://www.museoreinasofia.es', fuente: 'museoreinasofia.es' },
    { municipio: 'Museo Nacional Thyssen-Bornemisza', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: null, telefono: null, tipo: 'museo', web: 'https://www.museothyssen.org', fuente: 'museothyssen.org' },

    // ===================== ASOCIACIONES =====================
    { municipio: 'Hispania Nostra', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: 'secretaria@hispanianostra.org', persona_contacto: null, cargo: 'Secretaría', telefono: '915424135', tipo: 'asociacion', web: 'https://www.hispanianostra.org', fuente: 'hispanianostra.org' },
    { municipio: 'Hispania Nostra - Asociaciones', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: 'asociaciones@hispanianostra.org', telefono: '912969143', tipo: 'asociacion', web: 'https://www.asociaciones.hispanianostra.org', fuente: 'hispanianostra.org' },
    { municipio: 'Hispania Nostra - Lista Roja Patrimonio', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: 'listaroja@hispanianostra.org', telefono: '637725687', tipo: 'asociacion', web: 'https://listarojapatrimonio.org', fuente: 'hispanianostra.org' },
    { municipio: 'Asociación Española de Amigos de los Castillos', provincia: 'Madrid', comunidad_autonoma: 'Comunidad de Madrid', email_general: null, telefono: null, tipo: 'asociacion', web: null, fuente: 'instagram' },
    { municipio: 'Red de Patrimonio Histórico de España', provincia: null, comunidad_autonoma: null, email_general: null, telefono: null, tipo: 'asociacion', web: null, fuente: 'instagram' },
];

async function main() {
    console.log('Insertando contactos de turismo, museos, patronatos y asociaciones...\n');

    let inserted = 0;
    let skipped = 0;

    for (const c of CONTACTOS) {
        try {
            // Check if already exists (by municipio + tipo)
            const existing = await pool.query(
                'SELECT id FROM contactos_municipios WHERE municipio = $1 AND tipo = $2',
                [c.municipio, c.tipo]
            );
            if (existing.rows.length > 0) {
                // Update
                await pool.query(`
                    UPDATE contactos_municipios SET
                        provincia = COALESCE($2, provincia),
                        comunidad_autonoma = COALESCE($3, comunidad_autonoma),
                        email_general = COALESCE($4, email_general),
                        telefono = COALESCE($5, telefono),
                        web = COALESCE($6, web),
                        fuente = COALESCE($7, fuente),
                        persona_contacto = COALESCE($8, persona_contacto),
                        cargo = COALESCE($9, cargo),
                        fecha_actualizacion = NOW()
                    WHERE id = $1
                `, [existing.rows[0].id, c.provincia, c.comunidad_autonoma, c.email_general, c.telefono, c.web, c.fuente, c.persona_contacto || null, c.cargo || null]);
                console.log(`  ↻ ${c.municipio} (actualizado)`);
            } else {
                // Insert
                await pool.query(`
                    INSERT INTO contactos_municipios (municipio, provincia, comunidad_autonoma, email_general, telefono, web, fuente, tipo, pais, persona_contacto, cargo, fecha_actualizacion)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'España', $9, $10, NOW())
                `, [c.municipio, c.provincia, c.comunidad_autonoma, c.email_general, c.telefono, c.web, c.fuente, c.tipo, c.persona_contacto || null, c.cargo || null]);
                console.log(`  ✓ ${c.municipio} (${c.tipo})`);
            }
            inserted++;
        } catch (err) {
            console.error(`  ✗ ${c.municipio}: ${err.message}`);
            skipped++;
        }
    }

    console.log(`\n${inserted} procesados, ${skipped} errores.\n`);

    // Stats
    const { rows } = await pool.query(`
        SELECT tipo, COUNT(*) as total, COUNT(email_general) as con_email
        FROM contactos_municipios
        GROUP BY tipo
        ORDER BY total DESC
    `);
    console.log('Contactos por tipo:');
    rows.forEach(r => console.log(`  ${r.tipo}: ${r.total} (${r.con_email} con email)`));

    await pool.end();
}

main().catch(err => { console.error(err); pool.end(); process.exit(1); });
