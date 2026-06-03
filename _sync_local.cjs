/**
 * Sincroniza con Local todos los cambios aplicados solo en Neon.
 * Ver _pending_local_sync.md para detalle.
 */
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ host: 'localhost', port: 5433, user: 'patrimonio', password: 'patrimonio2026', database: 'patrimonio' });

async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ========== 1) ALTAMIRA: limpiar duplicados, conservar 74468 ==========
        console.log('\n[1] Altamira: limpiando duplicados...');
        await client.query("UPDATE bienes SET municipio='Santillana del Mar' WHERE id=74468");
        for (const id of [74153, 74793, 74645, 265683]) {
            await client.query('UPDATE rutas_culturales_paradas SET bien_id=74468 WHERE bien_id=$1', [id]);
            await client.query('DELETE FROM imagenes WHERE bien_id=$1', [id]);
            await client.query('DELETE FROM wikidata WHERE bien_id=$1', [id]);
            await client.query('DELETE FROM bienes WHERE id=$1', [id]);
        }
        console.log('  OK');

        // ========== 2) BORNES FOREST D'ECOUVES: añadir municipio entre paréntesis ==========
        console.log('\n[2] 80 bornes forêt d\'Ecouves: añadiendo municipio...');
        const bornes = await client.query(`SELECT id, municipio FROM bienes WHERE denominacion ILIKE $1 AND pais=$2`, ['%80 bornes de la forêt%', 'Francia']);
        for (const b of bornes.rows) {
            const muniLimpio = b.municipio.replace(/^(.+)\s+\((Le|La|Les)\)$/i, '$2 $1');
            await client.query("UPDATE bienes SET denominacion=$1 WHERE id=$2",
                [`80 bornes de la forêt d'Ecouves (${muniLimpio})`, b.id]);
        }
        console.log(`  ${bornes.rows.length} OK`);

        // ========== 3) PAÍS VASCO numerados ==========
        console.log('\n[3] País Vasco numerados...');
        const pv = await client.query(`SELECT id, denominacion FROM bienes WHERE denominacion ~ $1 AND municipio IN ($2, $3, $4)`,
            ['^[1-9]\\.? ', 'Oñate', 'Santurce', 'Aracaldo']);
        let pvCount = 0;
        for (const row of pv.rows) {
            const m = row.denominacion.match(/^([1-9])\.?\s+(.+)$/);
            if (m) {
                await client.query('UPDATE bienes SET denominacion=$1 WHERE id=$2', [`${m[2]} (${m[1]})`, row.id]);
                pvCount++;
            }
        }
        console.log(`  ${pvCount} OK`);

        // ========== 4) Ordinales ingleses (1st chapel, 2nd station, etc.) ==========
        console.log('\n[4] Ordinales ingleses...');
        const ordEn = await client.query(`SELECT id, denominacion FROM bienes WHERE denominacion ~ $1`, ['^[0-9]+(st|nd|rd|th) ']);
        let ordEnCount = 0;
        for (const row of ordEn.rows) {
            const m = row.denominacion.match(/^([0-9]+(?:st|nd|rd|th))\s+(.+)$/);
            if (m) {
                const resto = m[2].charAt(0).toUpperCase() + m[2].slice(1);
                await client.query('UPDATE bienes SET denominacion=$1 WHERE id=$2', [`${resto} (${m[1]})`, row.id]);
                ordEnCount++;
            }
        }
        console.log(`  ${ordEnCount} OK`);

        // ========== 5) Españoles numerados (viviendas) ==========
        console.log('\n[5] Españoles numerados (viviendas)...');
        const esp = await client.query(`SELECT id, denominacion FROM bienes WHERE denominacion ~ $1 AND pais=$2`, ['^[0-9]+ ', 'España']);
        let espCount = 0;
        for (const row of esp.rows) {
            const m = row.denominacion.match(/^([0-9]+)\s+(.+)$/);
            if (m) {
                const resto = m[2].charAt(0).toUpperCase() + m[2].slice(1);
                await client.query('UPDATE bienes SET denominacion=$1 WHERE id=$2', [`${resto} (${m[1]})`, row.id]);
                espCount++;
            }
        }
        console.log(`  ${espCount} OK`);

        // ========== 6) Araucárias, moinhos, dragoeiros, palmeira (manual map) ==========
        console.log('\n[6] Árboles monumentales y moinhos...');
        const renames = [
            // Araucárias
            [142717, 'Araucárias no Cemitério do Carmo (2)'],
            [142718, 'Araucárias na Colónia Inglesa (3)'],
            [142720, 'Araucárias na Rua Eduardo Bulcão (2)'],
            [142721, 'Araucárias na Praça da República (3)'],
            [142725, 'Araucária no Jardim Florêncio Terra'],
            [142726, 'Araucária na Rua do Arco'],
            [142728, 'Araucária na Canada das Dutras'],
            [142730, 'Araucária no Largo Duque de Ávila e Bolama'],
            [142734, 'Araucária na Rua Vasco da Gama, 42'],
            [142735, 'Araucária na Rua Conselheiro Medeiros, 2'],
            [142829, 'Araucária no cruzamento da Espalamaca'],
            [142830, 'Araucária na Praceta Luís de Camões (Rotunda da Avenida)'],
            [142844, 'Araucária no logradouro do Hotel Fayal'],
            [142845, 'Araucária na Colónia Alemã'],
            [142946, 'Araucária na Rua Conde de Ávila, Relva'],
            [143059, 'Araucária no adro das Angústias'],
            // Moinhos
            [142744, 'Moinhos de água na Ribeira do Guilherme (moinhos da Câmara) (2)'],
            [142892, 'Moinhos de vento na Lomba (3)'],
            [142889, 'Moinhos de água na Ribeira dos Caldeirões (moinhos da Câmara) (3)'],
            // Dragoeiros
            [142712, 'Dragoeiros no lugar da Praia (4)'],
            [142731, 'Dragoeiro na Rua Médico Avelar'],
            [142732, 'Dragoeiro na Colónia Alemã'],
            [142733, 'Dragoeiro nos jardins da Bagatelle'],
            [142826, 'Dragoeiros no Jardim Florêncio Terra (5)'],
            [143060, 'Dragoeiro na Escola Secundária Manuel de Arriaga'],
            // Palmeira
            [142723, 'Palmeiras-das-Canárias no Largo do Infante (4)'],
            // Rubió rellotges
            [58217, 'Rellotge de sol de l’església de Santa Maria de Rubió (1er)'],
            [58218, 'Rellotge de sol de l’església de Santa Maria de Rubió (2on)'],
            [58219, 'Rellotge de sol de l’església de Santa Maria de Rubió (3er)'],
            // Bornes Halatte y stemmi
            [100837, 'Bornes armoriées en forêt d’Halatte (57)'],
            [207570, 'Stemmi sulla facciata del conservatorio in piazza Vittorio Emanuele (12)'],
            // Caso Can Farigola
            [72856, 'Jaciment a 200 metres a l’oest de Can Farigola'],
        ];
        for (const [id, nuevo] of renames) {
            await client.query('UPDATE bienes SET denominacion=$1 WHERE id=$2', [nuevo, id]);
        }
        console.log(`  ${renames.length} OK`);

        // ========== 7) Borrar 64 Mani, 30SVG327868, Abacus ==========
        console.log('\n[7] Borrar registros no patrimoniales...');
        for (const id of [171008, 20401, 46812]) {
            await client.query('DELETE FROM rutas_culturales_paradas WHERE bien_id=$1', [id]);
            await client.query('DELETE FROM imagenes WHERE bien_id=$1', [id]);
            await client.query('DELETE FROM wikidata WHERE bien_id=$1', [id]);
            await client.query('DELETE FROM bienes WHERE id=$1', [id]);
        }
        console.log('  3 OK (64 Mani, 30SVG327868, Abacus)');

        // ========== 8) Marroquíes Altos/Bajos: nuevas coords ==========
        console.log('\n[8] Marroquíes Altos/Bajos coords correctas...');
        await client.query("UPDATE bienes SET latitud=37.78194444, longitud=-3.78694444 WHERE id IN (20236, 20237)");
        console.log('  OK');

        // ========== 9) Yacimientos con descripción de posición (48 + 21) ==========
        console.log('\n[9] Yacimientos con descripción de posición...');
        const patterns1 = ["^A [0-9]+ ?m ", "^A [0-9]+ ?metros", "^A prop d", "^A ponent d", "^A migdia d", "^A llevant d", "^A tramuntana d", "^A orillas d", "^A la vora", "^A pocos metros", "^A unos metros", "^Al Norte d", "^Al Sur d", "^Al Este d", "^Al Oeste d", "^Al Noroeste d", "^Al Noreste d", "^Al Sureste d", "^Al Suroeste d"];
        const seen1 = new Set();
        let yacRen = 0, yacRecls = 0;
        for (const p of patterns1) {
            const r = await client.query(`SELECT id, denominacion, tipo_monumento FROM bienes WHERE denominacion ~* $1`, [p]);
            for (const row of r.rows) {
                if (seen1.has(row.id)) continue;
                seen1.add(row.id);
                const nuevo = 'Yacimiento ' + row.denominacion.charAt(0).toLowerCase() + row.denominacion.slice(1);
                await client.query('UPDATE bienes SET denominacion=$1 WHERE id=$2', [nuevo, row.id]);
                yacRen++;
                if (row.tipo_monumento !== 'Yacimiento arqueológico') {
                    await client.query("UPDATE bienes SET tipo_monumento='Yacimiento arqueológico' WHERE id=$1", [row.id]);
                    yacRecls++;
                }
            }
        }
        console.log(`  ${yacRen} renombrados, ${yacRecls} reclasificados`);

        // ========== 10) Casos pos2 (catalán/italiano/portugués/Cerca de) ==========
        console.log('\n[10] Casos pos2 (Cerca de, A l\'oest, etc.)...');
        const fix2 = [
            { id: 65384, nuevo: "Jaciment a l'oest del Saió", reclas: 'Yacimiento arqueológico' },
            { id: 201459, nuevo: 'Sito a Nord di Sa Salina (Calasetta)', reclas: 'Yacimiento arqueológico' },
            { id: 146609, nuevo: 'Pinturas murais no Palácio da Inquisição (Évora)', reclas: null },
            { id: 22272, nuevo: 'Yacimiento al lado del aliviadero de la Presa de Giribaile', reclas: 'Yacimiento arqueológico' },
            { id: 16455, nuevo: 'Yacimiento cerca del Risco', reclas: 'Yacimiento arqueológico' },
            { id: 16755, nuevo: 'Yacimiento cerca de los Cantos', reclas: 'Yacimiento arqueológico' },
            { id: 17016, nuevo: 'Yacimiento cerca de la Monea', reclas: 'Yacimiento arqueológico' },
            { id: 17019, nuevo: 'Yacimiento cerca del Águila', reclas: 'Yacimiento arqueológico' },
            { id: 17330, nuevo: 'Yacimiento cerca de Higuera de la Sierra I', reclas: 'Yacimiento arqueológico' },
            { id: 17358, nuevo: 'Yacimiento cerca del Cojo', reclas: 'Yacimiento arqueológico' },
            { id: 17646, nuevo: 'Yacimiento cerca de Atrás', reclas: 'Yacimiento arqueológico' },
            { id: 18539, nuevo: 'Yacimiento cerca del Cura', reclas: 'Yacimiento arqueológico' },
            { id: 19213, nuevo: 'Yacimiento cerca del Cortijo del Gitano', reclas: 'Yacimiento arqueológico' },
            { id: 21615, nuevo: 'Yacimiento cerca de la Central Eléctrica de los Escuderos', reclas: 'Yacimiento arqueológico' },
            { id: 21621, nuevo: 'Yacimiento cerca del Oratorio de Valdecanales', reclas: 'Yacimiento arqueológico' },
            { id: 31150, nuevo: 'Yacimiento cerca de Cadenas', reclas: 'Yacimiento arqueológico' },
            { id: 8959, nuevo: 'Yacimiento cerca de la Villa Vieja', reclas: 'Yacimiento arqueológico' },
            { id: 19193, nuevo: 'Yacimiento cerca del Molino', reclas: 'Yacimiento arqueológico' },
            { id: 21616, nuevo: 'Yacimiento cerca de la Central de los Escuderos', reclas: 'Yacimiento arqueológico' },
            { id: 10811, nuevo: 'Yacimiento cerca de Montemayor (Camino de Córdoba)', reclas: 'Yacimiento arqueológico' },
            { id: 11871, nuevo: 'Yacimiento cerca de la Rambla', reclas: 'Yacimiento arqueológico' },
        ];
        for (const f of fix2) {
            await client.query('UPDATE bienes SET denominacion=$1 WHERE id=$2', [f.nuevo, f.id]);
            if (f.reclas) await client.query('UPDATE bienes SET tipo_monumento=$1 WHERE id=$2', [f.reclas, f.id]);
        }
        console.log(`  ${fix2.length} OK`);

        // ========== 11) Categorías padre eventos (qid_evento_padre) ==========
        console.log('\n[11] Eventos: añadir qid_evento_padre...');
        await client.query(`ALTER TABLE eventos_monumento ADD COLUMN IF NOT EXISTS qid_evento_padre TEXT`);

        const PARENTS = ['Q10859','Q152499','Q150701','Q79791','Q1178424','Q1200506','Q1501724','Q2105495','Q164432','Q51657','Q78994','Q362'];
        const analysis = JSON.parse(fs.readFileSync('C:\\Users\\usuario\\Desktop\\node2\\_eventos_analisis.json', 'utf8'));
        let evCount = 0;
        for (const [qidEv, parents] of Object.entries(analysis.parents)) {
            let padreElegido = null;
            for (const p of parents) if (PARENTS.includes(p.qid)) { padreElegido = p.qid; break; }
            if (PARENTS.includes(qidEv)) padreElegido = qidEv;
            if (padreElegido) {
                const r = await client.query('UPDATE eventos_monumento SET qid_evento_padre=$1 WHERE qid_evento=$2', [padreElegido, qidEv]);
                evCount += r.rowCount;
            }
        }
        for (const qid of PARENTS) {
            const r = await client.query('UPDATE eventos_monumento SET qid_evento_padre=$1 WHERE qid_evento=$1 AND qid_evento_padre IS NULL', [qid]);
            evCount += r.rowCount;
        }
        console.log(`  ${evCount} eventos asignados`);

        await client.query('COMMIT');
        console.log('\n✓ SYNC LOCAL COMPLETO');
    } catch(e) {
        await client.query('ROLLBACK');
        console.error('ERROR:', e.message);
        throw e;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => { process.exit(1); });
