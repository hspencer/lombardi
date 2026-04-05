const { Pool } = require('pg');

/**
 * Migración: Agregar campos de verificación colaborativa a aristas CONTRADICE existentes
 *
 * Campos agregados:
 * - verification_status: 'pending' (default)
 * - consensus_score: 0.0 (default)
 * - vote_agree_count: 0 (default)
 * - vote_disagree_count: 0 (default)
 * - vote_uncertain_count: 0 (default)
 *
 * Uso: node backend/migrate_contradice.js
 */

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'lombardi',
    user: 'os_admin',
    password: 'lombardi_pass'
});

function parseAgtype(raw) {
    return JSON.parse(String(raw).replace(/::(vertex|edge|path)$/g, ''));
}

async function main() {
    console.log('=== Migración de aristas CONTRADICE ===\n');

    const client = await pool.connect();
    try {
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");

        // 1. Contar aristas CONTRADICE existentes
        const countResult = await client.query(`
            SELECT * FROM cypher('lombardi', $$
                MATCH ()-[r:CONTRADICE]->()
                RETURN count(r) as total
            $$) as (total agtype)
        `);
        const total = JSON.parse(countResult.rows[0]?.total || '0');
        console.log(`Encontradas ${total} aristas CONTRADICE para migrar.\n`);

        if (total === 0) {
            console.log('No hay aristas CONTRADICE. Nada que migrar.');
            return;
        }

        // 2. Obtener todas las aristas CONTRADICE
        const edgesResult = await client.query(`
            SELECT * FROM cypher('lombardi', $$
                MATCH (a)-[r:CONTRADICE]->(b)
                RETURN id(r) as edge_id, a.id as from_id, b.id as to_id, r
            $$) as (edge_id agtype, from_id agtype, to_id agtype, r agtype)
        `);

        console.log('Actualizando campos de verificación...\n');

        let updated = 0;
        let skipped = 0;

        for (const row of edgesResult.rows) {
            const edgeId = JSON.parse(row.edge_id);
            const fromId = JSON.parse(row.from_id);
            const toId = JSON.parse(row.to_id);
            const edge = parseAgtype(row.r);

            // Verificar si ya tiene los campos (evitar sobreescribir)
            if (edge.properties.verification_status !== undefined) {
                console.log(`  [SKIP] Arista ${fromId} -> ${toId} ya migrada`);
                skipped++;
                continue;
            }

            // Actualizar la arista con los nuevos campos
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MATCH (a {id: '${fromId}'})-[r:CONTRADICE]->(b {id: '${toId}'})
                    SET r.verification_status = 'pending',
                        r.consensus_score = 0.0,
                        r.vote_agree_count = 0,
                        r.vote_disagree_count = 0,
                        r.vote_uncertain_count = 0
                    RETURN r
                $$) as (r agtype)
            `);

            console.log(`  [OK] Arista ${fromId} -> ${toId} migrada`);
            updated++;
        }

        console.log(`\n✓ Migración completada:`);
        console.log(`  - ${updated} aristas actualizadas`);
        console.log(`  - ${skipped} aristas ya migradas (skipped)`);

    } catch (err) {
        console.error('Error durante la migración:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
