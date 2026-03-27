const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// --- Configuracion ---

const RAW_DIR = path.join(__dirname, '../data/raw_news');
const PROCESSED_DIR = path.join(__dirname, '../data/raw_news/.processed');
const SCHEMA_PATH = path.join(__dirname, '../data/schema.json');
const ALIASES_PATH = path.join(__dirname, '../data/aliases.json');
const OLLAMA_URL = 'http://localhost:11434/api/generate';

// Cargar schema como fuente de verdad
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
const EVENT_DICTIONARY = schema.event_types.map(e => e.id);
const EXTRACTOR_MODEL = schema.extraction.models.extractor.model;
const ENTITY_TYPES = schema.graph.nodes.Actor.properties.type.enum;

// Cargar diccionario de aliases
function loadAliases() {
    const raw = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
    const lookup = new Map(); // alias (lowercase) → canonical id
    for (const [id, entry] of Object.entries(raw.entities)) {
        // El canonical name también es un alias de sí mismo
        lookup.set(entry.canonical.toLowerCase(), id);
        lookup.set(id, id); // el propio ID
        for (const alias of entry.aliases) {
            lookup.set(alias.toLowerCase(), id);
        }
    }
    return { lookup, entities: raw.entities };
}

let aliasData = loadAliases();

function resolveEntity(entity) {
    // Buscar por nombre o id en el diccionario
    const key = (entity.name || entity.id || '').toLowerCase();
    const idKey = (entity.id || '').toLowerCase();
    const canonicalId = aliasData.lookup.get(key) || aliasData.lookup.get(idKey);

    if (canonicalId && aliasData.entities[canonicalId]) {
        const canonical = aliasData.entities[canonicalId];
        return {
            id: canonicalId,
            name: canonical.canonical,
            type: canonical.type || entity.type
        };
    }
    return entity; // No match, devolver tal cual
}

function resolveExtraction(extraction) {
    // Resolver entidades
    extraction.entities = (extraction.entities || []).map(resolveEntity);

    // Deduplicar entidades por id (post-merge)
    const seen = new Map();
    extraction.entities = extraction.entities.filter(e => {
        if (seen.has(e.id)) return false;
        seen.set(e.id, true);
        return true;
    });

    // Resolver subject/object en claims
    extraction.claims = (extraction.claims || []).map(claim => {
        const subKey = (claim.subject || '').toLowerCase();
        const objKey = (claim.object || '').toLowerCase();
        return {
            ...claim,
            subject: aliasData.lookup.get(subKey) || claim.subject,
            object: aliasData.lookup.get(objKey) || claim.object
        };
    });

    // Resolver entity_relations
    extraction.entity_relations = (extraction.entity_relations || []).map(rel => ({
        ...rel,
        source: aliasData.lookup.get((rel.source || '').toLowerCase()) || rel.source,
        target: aliasData.lookup.get((rel.target || '').toLowerCase()) || rel.target
    }));

    return extraction;
}

function buildExtractionPrompt() {
    const rules = schema.extraction.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
    const eventList = EVENT_DICTIONARY.join(', ');
    const entityTypes = ENTITY_TYPES.join('|');
    const lang = schema.extraction.output_language || 'es';

    return `You are an ontological news analyst for OverStand (OS). Extract atomic facts from the news item below.
OUTPUT LANGUAGE: ${lang} (all predicates and generic entity names MUST be in this language)

RULES:
${rules}

EVENT TYPES: ${eventList}
ENTITY TYPES: ${entityTypes}

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "event_type": "EVENT_TYPE",
  "entities": [
    {"id": "kebab-case-id", "name": "Nombre (propios intactos)", "type": "${entityTypes}", "desc": "descriptor breve en español (ej: presidente de Venezuela, ciudad portuaria de Ucrania)"}
  ],
  "entity_relations": [
    {"source": "entity-id", "relation": "PARTICIPA|UBICADO_EN|PERTENECE_A", "target": "entity-id"}
  ],
  "claims": [
    {
      "subject": "entity-id",
      "predicate": "verbo en español",
      "object": "entity-id o valor",
      "is_disputed": false,
      "evidence_quote": "cita textual en idioma original de la fuente"
    }
  ]
}

NEWS ITEM:
`;
}

const EXTRACTION_PROMPT = buildExtractionPrompt();

// --- Database ---

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'overstanding',
    user: 'os_admin',
    password: 'overstanding_pass'
});

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");

        // Crear tabla SQL para el texto completo de noticias (Full Text Search)
        await client.query(`
            CREATE TABLE IF NOT EXISTS news_raw (
                id SERIAL PRIMARY KEY,
                source_name TEXT,
                source_lang TEXT,
                source_region TEXT,
                title TEXT,
                link TEXT UNIQUE,
                description TEXT,
                pub_date TEXT,
                ingested_at TIMESTAMPTZ DEFAULT NOW(),
                processed BOOLEAN DEFAULT FALSE
            )
        `);
        console.log('OS: Base de datos inicializada.');
    } finally {
        client.release();
    }
}

// --- Ollama ---

async function extractWithOllama(newsItem) {
    const input = `Title: ${newsItem.title}\nSource: ${newsItem.source_name} (${newsItem.source_lang})\nDescription: ${newsItem.description}`;

    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000), // 2 min timeout
        body: JSON.stringify({
            model: EXTRACTOR_MODEL,
            prompt: EXTRACTION_PROMPT + input,
            stream: false,
            options: { temperature: 0.1 }
        })
    });

    const data = await response.json();
    const raw = data.response.trim();

    // Intentar parsear JSON limpiando posibles artefactos
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Ollama no devolvio JSON valido');

    return JSON.parse(jsonMatch[0]);
}

// --- Graph Writing ---

async function writeToGraph(client, newsItem, extraction) {
    // 1. Guardar noticia en tabla SQL (full text)
    await client.query(`
        INSERT INTO news_raw (source_name, source_lang, source_region, title, link, description, pub_date, processed)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        ON CONFLICT (link) DO UPDATE SET processed = true
    `, [
        newsItem.source_name,
        newsItem.source_lang,
        newsItem.source_region || '',
        newsItem.title,
        newsItem.link,
        newsItem.description,
        newsItem.pub_date
    ]);

    // 2. Crear nodos de entidades en el grafo (con descriptor)
    for (const entity of extraction.entities) {
        try {
            await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MERGE (a:Actor {id: '${esc(entity.id)}'})
                    SET a.name = '${esc(entity.name)}', a.type = '${esc(entity.type)}', a.description = '${esc(entity.desc || '')}'
                    RETURN a
                $$) as (a agtype)
            `);
        } catch (err) {
            console.error(`      [Actor] ${entity.id}: ${err.message.slice(0, 80)}`);
        }
    }

    // 2b. Crear relaciones implícitas entre entidades (entity_relations)
    const VALID_RELATIONS = ['PARTICIPA', 'UBICADO_EN', 'PERTENECE_A'];
    for (const rel of (extraction.entity_relations || [])) {
        if (!rel.source || !rel.target || !rel.relation) continue;
        const relType = String(rel.relation).toUpperCase().replace(/[^A-Z_]/g, '');
        if (!VALID_RELATIONS.includes(relType)) continue;

        // AGE requiere labels estáticos — usamos queries por tipo
        const queries = {
            PARTICIPA:    `MATCH (a:Actor {id: '${esc(rel.source)}'}), (b:Actor {id: '${esc(rel.target)}'}) MERGE (a)-[:PARTICIPA]->(b) RETURN a, b`,
            UBICADO_EN:   `MATCH (a:Actor {id: '${esc(rel.source)}'}), (b:Actor {id: '${esc(rel.target)}'}) MERGE (a)-[:UBICADO_EN]->(b) RETURN a, b`,
            PERTENECE_A:  `MATCH (a:Actor {id: '${esc(rel.source)}'}), (b:Actor {id: '${esc(rel.target)}'}) MERGE (a)-[:PERTENECE_A]->(b) RETURN a, b`
        };

        await client.query(`
            SELECT * FROM cypher('overstanding', $$ ${queries[relType]} $$) as (a agtype, b agtype)
        `).catch(() => {});
    }

    // 3. Crear nodo de Noticia en el grafo
    const newsId = Buffer.from(newsItem.link).toString('base64').slice(0, 20);
    try {
        await client.query(`
            SELECT * FROM cypher('overstanding', $$
                MERGE (n:Noticia {id: '${esc(newsId)}'})
                SET n.title = '${esc(newsItem.title)}',
                    n.source = '${esc(newsItem.source_name)}',
                    n.link = '${esc(newsItem.link)}',
                    n.lang = '${esc(newsItem.source_lang)}'
                RETURN n
            $$) as (n agtype)
        `);
    } catch (err) {
        console.error(`      [Noticia] ${err.message.slice(0, 80)}`);
    }

    // 4. Crear nodos de Afirmacion y relaciones
    for (let i = 0; i < extraction.claims.length; i++) {
        const claim = extraction.claims[i];
        const claimId = `${newsId}-c${i}`;

        try {
            // Crear Afirmacion
            await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MERGE (c:Afirmacion {id: '${esc(claimId)}'})
                    SET c.subject = '${esc(claim.subject)}',
                        c.predicate = '${esc(claim.predicate)}',
                        c.object = '${esc(claim.object)}',
                        c.is_disputed = ${claim.is_disputed || false},
                        c.evidence_quote = '${esc(claim.evidence_quote || '')}',
                        c.event_type = '${esc(extraction.event_type)}'
                    RETURN c
                $$) as (c agtype)
            `);

            // Noticia -[:REPORTA]-> Afirmacion
            await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MATCH (n:Noticia {id: '${esc(newsId)}'}), (c:Afirmacion {id: '${esc(claimId)}'})
                    MERGE (n)-[:REPORTA]->(c)
                    RETURN n, c
                $$) as (n agtype, c agtype)
            `);

            // Afirmacion -[:INVOLUCRA]-> Actor (subject y object)
            for (const entityId of [claim.subject, claim.object]) {
                if (!entityId) continue;
                await client.query(`
                    SELECT * FROM cypher('overstanding', $$
                        MATCH (c:Afirmacion {id: '${esc(claimId)}'}), (a:Actor {id: '${esc(entityId)}'})
                        MERGE (c)-[:INVOLUCRA]->(a)
                        RETURN c, a
                    $$) as (c agtype, a agtype)
                `).catch(() => {});
            }
        } catch (err) {
            console.error(`      [Claim ${i}] ${err.message.slice(0, 80)}`);
        }
    }
}

// Sanitizar string para Cypher dentro de comillas simples en $$ blocks
function esc(str) {
    if (!str) return '';
    return String(str)
        .slice(0, 500)          // Limitar longitud
        .replace(/\\/g, '\\\\') // Backslashes primero
        .replace(/'/g, "\\'")   // Comillas simples
        .replace(/\$/g, '')     // Evitar romper $$ delimiters
        .replace(/[\r\n]+/g, ' '); // Newlines a espacio
}

// --- File Processing ---

async function processFile(filePath) {
    const fileName = path.basename(filePath);
    if (!fileName.endsWith('.json') || fileName.startsWith('.')) return;

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const newsItem = JSON.parse(raw);

        console.log(`\nOS: Procesando "${newsItem.title?.slice(0, 60)}..."`);
        console.log(`    Fuente: ${newsItem.source_name} (${newsItem.source_lang})`);

        // Verificar si ya existe extracción persistente
        const extractionPath = filePath.replace('.json', '.extraction.json');
        let rawExtraction;

        if (fs.existsSync(extractionPath)) {
            // Reusar extracción previa (no re-inferir)
            rawExtraction = JSON.parse(fs.readFileSync(extractionPath, 'utf-8'));
            console.log('    (reusando extracción previa)');
        } else {
            // Extraer ontología con Ollama
            rawExtraction = await extractWithOllama(newsItem);
            // Persistir extracción
            fs.writeFileSync(extractionPath, JSON.stringify(rawExtraction, null, 2));
        }

        const extraction = resolveExtraction(rawExtraction);
        console.log(`    Evento: ${extraction.event_type}`);
        console.log(`    Entidades: ${extraction.entities?.map(e => `${e.name}${e.desc ? ' (' + e.desc + ')' : ''}`).join(', ')}`);
        console.log(`    Claims: ${extraction.claims?.length || 0}`);
        console.log(`    Relations: ${extraction.entity_relations?.length || 0}`);

        // Escribir en el grafo
        const client = await pool.connect();
        try {
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");
            await writeToGraph(client, newsItem, extraction);
            console.log('    -> Guardado en grafo.');
            // Mover a procesados
            if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
            fs.renameSync(filePath, path.join(PROCESSED_DIR, fileName));
        } catch (graphErr) {
            console.error(`    GRAPH ERROR: ${graphErr.message.slice(0, 120)}`);
            // Extracción se guardó, archivo queda en raw para reintentar
        } finally {
            client.release();
        }

    } catch (error) {
        console.error(`    ERROR: ${error.message}`);
    }
}

// --- Daemon ---

async function processExistingFiles() {
    const files = fs.readdirSync(RAW_DIR)
        .filter(f => f.endsWith('.json') && !f.startsWith('.'))
        .map(f => path.join(RAW_DIR, f));

    console.log(`OS: ${files.length} archivos pendientes de procesar.\n`);

    for (const file of files) {
        await processFile(file);
    }
}

async function startWatcher() {
    console.log(`OS: Vigilando ${RAW_DIR} para nuevas noticias...\n`);

    fs.watch(RAW_DIR, async (eventType, fileName) => {
        if (eventType === 'rename' && fileName?.endsWith('.json')) {
            const filePath = path.join(RAW_DIR, fileName);
            if (fs.existsSync(filePath)) {
                // Esperar a que el archivo se termine de escribir
                await new Promise(r => setTimeout(r, 500));
                await processFile(filePath);
            }
        }
    });
}

async function main() {
    console.log('=== OverStand (OS) - Daemon de Ingesta ===\n');

    await initDB();
    await processExistingFiles();
    await startWatcher();

    console.log('\nOS: Daemon activo. Ctrl+C para detener.');
}

main().catch(err => {
    console.error('OS Fatal:', err);
    process.exit(1);
});
