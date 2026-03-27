const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// --- Config ---

const RAW_DIR = path.join(__dirname, '../data/raw_news');
const PROCESSED_DIR = path.join(RAW_DIR, '.processed');
const SCHEMA_PATH = path.join(__dirname, '../data/schema.json');
const ALIASES_PATH = path.join(__dirname, '../data/aliases.json');
const OLLAMA_URL = 'http://localhost:11434/api/generate';

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
const EVENT_TYPES = schema.event_types.map(e => e.id);
const EXTRACTOR_MODEL = schema.extraction.models.extractor.model;
const ENTITY_TYPES = schema.graph.nodes.Actor.properties.type.enum;

// --- Aliases ---

function loadAliases() {
    const raw = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
    const lookup = new Map();
    for (const [id, entry] of Object.entries(raw.entities)) {
        lookup.set(entry.canonical.toLowerCase(), id);
        lookup.set(id, id);
        for (const alias of entry.aliases) lookup.set(alias.toLowerCase(), id);
    }
    return { lookup, entities: raw.entities };
}

let aliasData = loadAliases();

function resolveId(name) {
    return aliasData.lookup.get((name || '').toLowerCase()) || null;
}

// --- Prompt ---

function buildPrompt() {
    const rules = schema.extraction.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
    const lang = schema.extraction.output_language || 'es';

    return `You are an ontological news analyst for OverStand. Extract structured facts.
OUTPUT LANGUAGE: ${lang}

RULES:
${rules}

EVENT TYPES: ${EVENT_TYPES.join(', ')}
ENTITY TYPES: ${ENTITY_TYPES.join(', ')}

Respond with ONLY valid JSON, no markdown:
{
  "event": {
    "id": "kebab-case-descriptivo",
    "name": "Nombre del evento en español",
    "event_type": "EVENT_TYPE",
    "date": "YYYY-MM-DD o null",
    "is_disputed": false,
    "evidence_quote": "cita en idioma original"
  },
  "actors": [
    {
      "id": "kebab-case",
      "name": "Nombre",
      "type": "Person|Organization|Location|Object",
      "description": "descriptor breve en español",
      "role": "verbo en español que describe su participación en el evento"
    }
  ],
  "actor_relations": [
    {"source": "actor-id", "relation": "PERTENECE_A|UBICADO_EN", "target": "actor-id"}
  ]
}

NEWS ITEM:
`;
}

const PROMPT = buildPrompt();

// --- Database ---

const pool = new Pool({
    host: 'localhost', port: 5432, database: 'overstanding',
    user: 'os_admin', password: 'overstanding_pass'
});

function esc(str) {
    if (!str) return '';
    return String(str).slice(0, 500).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '').replace(/[\r\n]+/g, ' ');
}

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS news_raw (
                id SERIAL PRIMARY KEY, source_name TEXT, source_lang TEXT, source_region TEXT,
                title TEXT, link TEXT UNIQUE, description TEXT, pub_date TEXT,
                ingested_at TIMESTAMPTZ DEFAULT NOW(), processed BOOLEAN DEFAULT FALSE
            )
        `);
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");
        // Ensure graph exists
        await client.query("SELECT create_graph('overstanding')").catch(() => {});
        console.log('OS: DB inicializada.');
    } finally {
        client.release();
    }
}

// --- Ollama ---

async function extract(newsItem) {
    const input = `Title: ${newsItem.title}\nSource: ${newsItem.source_name} (${newsItem.source_lang})\nDescription: ${newsItem.description}`;

    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
            model: EXTRACTOR_MODEL,
            prompt: PROMPT + input,
            stream: false,
            options: { temperature: 0.1 }
        })
    });

    const data = await response.json();
    const raw = data.response.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Ollama no devolvio JSON valido');
    return JSON.parse(jsonMatch[0]);
}

// --- Resolve aliases ---

function resolve(extraction) {
    // Resolve actor IDs
    extraction.actors = (extraction.actors || []).map(a => {
        const canonical = resolveId(a.name) || resolveId(a.id);
        if (canonical && aliasData.entities[canonical]) {
            return { ...a, id: canonical, name: aliasData.entities[canonical].canonical };
        }
        return a;
    });

    // Dedup actors
    const seen = new Map();
    extraction.actors = extraction.actors.filter(a => {
        if (seen.has(a.id)) return false;
        seen.set(a.id, true);
        return true;
    });

    // Resolve actor_relations
    extraction.actor_relations = (extraction.actor_relations || []).map(r => ({
        ...r,
        source: resolveId(r.source) || r.source,
        target: resolveId(r.target) || r.target
    }));

    return extraction;
}

// --- Write to Graph ---

async function writeToGraph(client, newsItem, extraction) {
    const evt = extraction.event;
    if (!evt || !evt.id) return;

    // 1. Create Evento node
    try {
        await client.query(`
            SELECT * FROM cypher('overstanding', $$
                MERGE (e:Evento {id: '${esc(evt.id)}'})
                SET e.name = '${esc(evt.name)}',
                    e.event_type = '${esc(evt.event_type)}',
                    e.date = '${esc(evt.date || '')}',
                    e.is_disputed = ${evt.is_disputed || false},
                    e.evidence_quote = '${esc(evt.evidence_quote || '')}',
                    e.source = '${esc(newsItem.source_name)}',
                    e.source_url = '${esc(newsItem.link)}'
                RETURN e
            $$) as (e agtype)
        `);
    } catch (err) {
        console.error(`      [Evento] ${err.message.slice(0, 80)}`);
        return; // Si falla el evento, no tiene sentido seguir
    }

    // 2. Create Actor nodes + PARTICIPA edges
    for (const actor of extraction.actors) {
        try {
            await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MERGE (a:Actor {id: '${esc(actor.id)}'})
                    SET a.name = '${esc(actor.name)}',
                        a.type = '${esc(actor.type)}',
                        a.description = '${esc(actor.description || '')}'
                    RETURN a
                $$) as (a agtype)
            `);

            // PARTICIPA edge with role as metadata
            await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MATCH (a:Actor {id: '${esc(actor.id)}'}), (e:Evento {id: '${esc(evt.id)}'})
                    MERGE (a)-[r:PARTICIPA]->(e)
                    SET r.role = '${esc(actor.role || '')}'
                    RETURN a, e
                $$) as (a agtype, e agtype)
            `);
        } catch (err) {
            console.error(`      [Actor] ${actor.id}: ${err.message.slice(0, 60)}`);
        }
    }

    // 3. Actor-Actor structural relations
    const VALID_RELS = { PERTENECE_A: true, UBICADO_EN: true };
    for (const rel of (extraction.actor_relations || [])) {
        const relType = String(rel.relation || '').toUpperCase().replace(/[^A-Z_]/g, '');
        if (!VALID_RELS[relType]) continue;
        try {
            const q = relType === 'PERTENECE_A'
                ? `MATCH (a:Actor {id: '${esc(rel.source)}'}), (b:Actor {id: '${esc(rel.target)}'}) MERGE (a)-[:PERTENECE_A]->(b) RETURN a, b`
                : `MATCH (a:Actor {id: '${esc(rel.source)}'}), (b:Actor {id: '${esc(rel.target)}'}) MERGE (a)-[:UBICADO_EN]->(b) RETURN a, b`;
            await client.query(`SELECT * FROM cypher('overstanding', $$ ${q} $$) as (a agtype, b agtype)`);
        } catch {}
    }
}

// --- Process File ---

async function processFile(filePath) {
    const fileName = path.basename(filePath);
    if (!fileName.endsWith('.json') || fileName.startsWith('.') || fileName.endsWith('.extraction.json')) return;

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const newsItem = JSON.parse(raw);

        console.log(`\nOS: Procesando "${newsItem.title?.slice(0, 70)}..."`);
        console.log(`    Fuente: ${newsItem.source_name} (${newsItem.source_lang})`);

        // Check for cached extraction
        const extractionPath = filePath.replace('.json', '.extraction.json');
        let rawExtraction;

        if (fs.existsSync(extractionPath)) {
            rawExtraction = JSON.parse(fs.readFileSync(extractionPath, 'utf-8'));
            console.log('    (reusando extracción previa)');
        } else {
            rawExtraction = await extract(newsItem);
            fs.writeFileSync(extractionPath, JSON.stringify(rawExtraction, null, 2));
        }

        const extraction = resolve(rawExtraction);
        const evt = extraction.event;
        console.log(`    Evento: ${evt?.name || '?'} [${evt?.event_type || '?'}] ${evt?.date || ''}`);
        console.log(`    Actores: ${extraction.actors?.map(a => `${a.name} (${a.role || '?'})`).join(', ')}`);

        // Write to SQL (before LOAD 'age')
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO news_raw (source_name, source_lang, source_region, title, link, description, pub_date, processed)
                VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                ON CONFLICT (link) DO UPDATE SET processed = true
            `, [newsItem.source_name, newsItem.source_lang, newsItem.source_region || '',
                newsItem.title, newsItem.link, newsItem.description, newsItem.pub_date]);

            // Write to graph
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");
            await writeToGraph(client, newsItem, extraction);
            console.log('    -> Guardado.');

            // Move to processed
            if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
            if (fs.existsSync(filePath)) {
                fs.renameSync(filePath, path.join(PROCESSED_DIR, fileName));
                if (fs.existsSync(extractionPath)) {
                    fs.renameSync(extractionPath, path.join(PROCESSED_DIR, fileName.replace('.json', '.extraction.json')));
                }
            }
        } catch (err) {
            console.error(`    ERROR: ${err.message.slice(0, 120)}`);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error(`    ERROR: ${error.message}`);
    }
}

// --- Daemon ---

async function processAll() {
    const files = fs.readdirSync(RAW_DIR)
        .filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.endsWith('.extraction.json'))
        .map(f => path.join(RAW_DIR, f));

    console.log(`OS: ${files.length} archivos pendientes.\n`);
    for (const file of files) await processFile(file);
}

async function startWatcher() {
    console.log(`OS: Vigilando ${RAW_DIR}...\n`);
    fs.watch(RAW_DIR, async (eventType, fileName) => {
        if (eventType === 'rename' && fileName?.endsWith('.json') && !fileName.endsWith('.extraction.json')) {
            const filePath = path.join(RAW_DIR, fileName);
            if (fs.existsSync(filePath)) {
                await new Promise(r => setTimeout(r, 500));
                await processFile(filePath);
            }
        }
    });
}

async function main() {
    console.log('=== OverStand — Ingesta v2 ===\n');
    await initDB();
    await processAll();
    await startWatcher();
    console.log('\nOS: Daemon activo. Ctrl+C para detener.');
}

// Allow single-file processing from API
module.exports = { processFile, pool, initDB };

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
