const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SEED_PATH = path.join(__dirname, '../data/seed-knowledge.json');

const pool = new Pool({
    host: 'localhost', port: 5432, database: 'lombardi',
    user: 'os_admin', password: 'lombardi_pass'
});

function esc(str) {
    if (!str) return '';
    return String(str).slice(0, 500).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '').replace(/[\r\n]+/g, ' ');
}

async function run() {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
    const client = await pool.connect();

    try {
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");

        console.log(`Cargando ${seed.entities.length} entidades...`);
        for (const e of seed.entities) {
            try {
                await client.query(`
                    SELECT * FROM cypher('lombardi', $$
                        MERGE (a:Actor {id: '${esc(e.id)}'})
                        SET a.name = '${esc(e.name)}', a.type = '${esc(e.type)}', a.description = '${esc(e.desc)}'
                        RETURN a
                    $$) as (a agtype)
                `);
            } catch (err) {
                console.error(`  Error ${e.id}: ${err.message.slice(0, 60)}`);
            }
        }

        console.log(`Cargando ${seed.relations.length} relaciones...`);
        const VALID = ['PARTICIPA', 'UBICADO_EN', 'PERTENECE_A'];
        for (const r of seed.relations) {
            const rel = r.relation.toUpperCase();
            if (!VALID.includes(rel)) continue;
            const queries = {
                PARTICIPA:   `MATCH (a:Actor {id: '${esc(r.source)}'}), (b:Actor {id: '${esc(r.target)}'}) MERGE (a)-[:PARTICIPA]->(b) RETURN a, b`,
                UBICADO_EN:  `MATCH (a:Actor {id: '${esc(r.source)}'}), (b:Actor {id: '${esc(r.target)}'}) MERGE (a)-[:UBICADO_EN]->(b) RETURN a, b`,
                PERTENECE_A: `MATCH (a:Actor {id: '${esc(r.source)}'}), (b:Actor {id: '${esc(r.target)}'}) MERGE (a)-[:PERTENECE_A]->(b) RETURN a, b`
            };
            try {
                await client.query(`SELECT * FROM cypher('lombardi', $$ ${queries[rel]} $$) as (a agtype, b agtype)`);
            } catch (err) {
                console.error(`  Error ${r.source}->${r.target}: ${err.message.slice(0, 60)}`);
            }
        }

        // También agregar al aliases.json
        const ALIASES_PATH = path.join(__dirname, '../data/aliases.json');
        const aliases = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
        for (const e of seed.entities) {
            if (!aliases.entities[e.id]) {
                aliases.entities[e.id] = { canonical: e.name, type: e.type, aliases: [] };
            }
        }
        aliases.updated_at = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(ALIASES_PATH, JSON.stringify(aliases, null, 2));

        console.log('Seed cargado exitosamente.');
    } finally {
        client.release();
        pool.end();
    }
}

run().catch(err => { console.error('Error:', err); process.exit(1); });
