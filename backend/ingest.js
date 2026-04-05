const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { findDuplicateEvent } = require('./dedup');

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

    return `You are an ontological news analyst for Lombardi. Extract structured facts.
OUTPUT LANGUAGE: ${lang}

RULES:
${rules}

EVENT TYPES: ${EVENT_TYPES.join(', ')}

ENTITY CLASSIFICATION (STRICT):
- Person: individual humans (politicians, executives, activists). NOT groups.
- Organization: companies, governments, parties, military forces, NGOs, media outlets, international bodies (NATO, ONU, G7).
- Location: countries, cities, regions, geographic features (Strait of Hormuz, Mar Negro).
- Object: ONLY physical objects or specific products (a ship, a weapon, a currency, a document). Use sparingly.

CRITICAL: Do NOT create actors for abstract concepts, strategies, policies, sanctions, or events. Those are the EVENT itself, not actors. Example: "Bloqueo de EE.UU." is an EVENT (SANCION_ECONOMICA), not an Object actor.

EVENT TYPE GUIDE:
- ACCION_ARMADA: any military attack, bombing, airstrike, shelling — NOT a declaration about an attack
- AMENAZA_COERCION: explicit threats, ultimatums, warnings of military action
- DECLARACION_PUBLICA: ONLY when the core news IS the statement itself (press conference, official speech)
- SANCION_ECONOMICA: economic sanctions, trade bans, asset freezes, embargoes
- RUPTURA_DIPLOMATICA: expulsion of diplomats, withdrawal from treaties, breaking relations
- PROTESTA_SOCIAL: demonstrations, strikes, civil unrest
- DENUNCIA_ACUSACION: formal legal charges, criminal accusations, tribunal proceedings

If in doubt between DECLARACION_PUBLICA and another type, choose the other type. DECLARACION_PUBLICA is a last resort.

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
      "type": "Person|Organization|Location",
      "description": "descriptor breve en español (rol, cargo, o qué es)",
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
    host: 'localhost', port: 5432, database: 'lombardi',
    user: 'os_admin', password: 'lombardi_pass'
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
                ingested_at TIMESTAMPTZ DEFAULT NOW(), processed BOOLEAN DEFAULT FALSE,
                content_hash TEXT
            )
        `);
        await client.query(`ALTER TABLE news_raw ADD COLUMN IF NOT EXISTS content_hash TEXT`).catch(() => {});
        await client.query(`CREATE INDEX IF NOT EXISTS idx_news_content_hash ON news_raw(content_hash)`).catch(() => {});

        // evento_sources: multi-source tracking (RESPALDA semantic)
        await client.query(`
            CREATE TABLE IF NOT EXISTS evento_sources (
                id SERIAL PRIMARY KEY,
                evento_id TEXT NOT NULL,
                news_raw_id INTEGER REFERENCES news_raw(id),
                news_link TEXT NOT NULL,
                source_name TEXT,
                title TEXT,
                linked_at TIMESTAMPTZ DEFAULT NOW(),
                linked_by TEXT DEFAULT 'system:ingestion',
                UNIQUE(evento_id, news_link)
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_evento_sources_evento ON evento_sources(evento_id)`).catch(() => {});

        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");
        // Ensure graph exists
        await client.query("SELECT create_graph('lombardi')").catch(() => {});
        console.log('OS: DB inicializada.');
    } finally {
        client.release();
    }
}

// --- Ollama ---

async function extract(newsItem) {
    const content = newsItem.description || newsItem.summary || '';
    const input = `Title: ${newsItem.title}\nSource: ${newsItem.source_name} (${newsItem.source_lang})\nContent: ${content.slice(0, 4000)}`;

    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify({
            model: EXTRACTOR_MODEL,
            prompt: PROMPT + input,
            stream: false,
            options: {
                temperature: 0.1,
                num_predict: 2048,
                num_ctx: 4096
            }
        })
    });

    const data = await response.json();
    if (data.error) throw new Error(`Ollama error: ${data.error}`);
    if (!data.response) throw new Error(`Ollama: respuesta vacía (modelo: ${EXTRACTOR_MODEL})`);
    let raw = data.response.trim();
    // Strip qwen3 <think>...</think> blocks if present
    raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
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

async function writeToGraph(client, newsItem, extraction, newsRawId) {
    const evt = extraction.event;
    if (!evt || !evt.id) return;

    // Fallback: use pub_date from the news item if LLM didn't extract a date
    const eventDate = evt.date || newsItem.pub_date || '';
    // Normalize: extract YYYY-MM-DD from various date formats
    const dateMatch = eventDate.match(/(\d{4}-\d{2}-\d{2})/);
    const normalizedDate = dateMatch ? dateMatch[1] : eventDate.slice(0, 10);

    // 0. Semantic dedup: check if a similar event already exists
    let deduplicated = false;
    try {
        const dup = await findDuplicateEvent(client, {
            id: evt.id,
            name: evt.name,
            event_type: evt.event_type,
            date: normalizedDate
        });
        if (dup) {
            console.log(`    -> Dedup: "${evt.name}" coincide con "${dup.name}" (score ${dup.score.toFixed(2)})`);
            evt.id = dup.id; // Redirect to existing event
            deduplicated = true;
        }
    } catch (err) {
        console.error(`      [Dedup] ${err.message.slice(0, 80)}`);
    }

    // 1. Create/update Evento node (skip overwrite if deduplicated)
    if (!deduplicated) {
        try {
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MERGE (e:Evento {id: '${esc(evt.id)}'})
                    SET e.name = '${esc(evt.name)}',
                        e.event_type = '${esc(evt.event_type)}',
                        e.date = '${esc(normalizedDate)}',
                        e.is_disputed = ${evt.is_disputed || false},
                        e.evidence_quote = '${esc(evt.evidence_quote || '')}',
                        e.source = '${esc(newsItem.source_name)}',
                        e.source_url = '${esc(newsItem.link)}',
                        e.extraction_confidence = ${parseFloat(evt.extraction_confidence) || 0}
                    RETURN e
                $$) as (e agtype)
            `);
        } catch (err) {
            console.error(`      [Evento] ${err.message.slice(0, 80)}`);
            return; // Si falla el evento, no tiene sentido seguir
        }
    }

    // 1b. Track source in evento_sources (RESPALDA semantic)
    try {
        await client.query(`
            INSERT INTO public.evento_sources (evento_id, news_raw_id, news_link, source_name, title, linked_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (evento_id, news_link) DO NOTHING
        `, [evt.id, newsRawId || null, newsItem.link, newsItem.source_name, newsItem.title,
            deduplicated ? 'system:dedup' : 'system:ingestion']);
    } catch (err) {
        console.error(`      [EventoSource] ${err.message.slice(0, 80)}`);
    }

    // 2. Create Actor nodes + PARTICIPA edges
    for (const actor of extraction.actors) {
        try {
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MERGE (a:Actor {id: '${esc(actor.id)}'})
                    SET a.name = '${esc(actor.name)}',
                        a.type = '${esc(actor.type)}',
                        a.description = '${esc(actor.description || '')}'
                    RETURN a
                $$) as (a agtype)
            `);

            // PARTICIPA edge with role + impact_direction
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MATCH (a:Actor {id: '${esc(actor.id)}'}), (e:Evento {id: '${esc(evt.id)}'})
                    MERGE (a)-[r:PARTICIPA]->(e)
                    SET r.role = '${esc(actor.role || '')}',
                        r.impact_direction = '${esc(actor.impact_direction || 'neutral')}'
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
            await client.query(`SELECT * FROM cypher('lombardi', $$ ${q} $$) as (a agtype, b agtype)`);
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
            const contentHash = crypto.createHash('sha256')
                .update(newsItem.description || newsItem.title || '')
                .digest('hex');
            const insertResult = await client.query(`
                INSERT INTO public.news_raw (source_name, source_lang, source_region, title, link, description, pub_date, processed, content_hash)
                VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
                ON CONFLICT (link) DO UPDATE SET processed = true, content_hash = EXCLUDED.content_hash
                RETURNING id
            `, [newsItem.source_name, newsItem.source_lang, newsItem.source_region || '',
                newsItem.title, newsItem.link, newsItem.description, newsItem.pub_date, contentHash]);
            const newsRawId = insertResult.rows[0]?.id;

            // Write to graph
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");
            await writeToGraph(client, newsItem, extraction, newsRawId);
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
    console.log('=== Lombardi — Ingesta v2 ===\n');
    await initDB();
    await processAll();
    await startWatcher();
    console.log('\nOS: Daemon activo. Ctrl+C para detener.');
}

// Allow single-file processing from API
module.exports = { processFile, pool, initDB };

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
