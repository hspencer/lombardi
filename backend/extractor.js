/**
 * Shared extraction module — used by both ingest.js (batch) and api.js (on-demand)
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '../data/schema.json');

function loadSchema() {
    return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
}

function buildPrompt(schema) {
    const EVENT_TYPES = schema.event_types.map(e => e.id);
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
    "evidence_quote": "cita en idioma original",
    "extraction_confidence": 0.85
  },
  "actors": [
    {
      "id": "kebab-case",
      "name": "Nombre",
      "type": "Person|Organization|Location",
      "description": "descriptor breve en español (rol, cargo, o qué es)",
      "role": "verbo en español que describe su participación en el evento",
      "impact_direction": "positive|negative|neutral"
    }
  ],
  "actor_relations": [
    {"source": "actor-id", "relation": "PERTENECE_A|UBICADO_EN", "target": "actor-id"}
  ]
}

extraction_confidence: Rate your confidence in the overall extraction quality from 0.0 (very uncertain) to 1.0 (very clear, unambiguous news item).
impact_direction: For each actor, indicate if their participation has a positive, negative, or neutral impact on the event.

NEWS ITEM:
`;
}

async function extractFromNews(newsItem) {
    const schema = loadSchema();
    const prompt = buildPrompt(schema);
    const model = schema.extraction.models.extractor.model;

    const input = `Title: ${newsItem.title}\nSource: ${newsItem.source_name || ''} (${newsItem.source_lang || ''})\nDate: ${newsItem.pubDate || newsItem.pub_date || ''}\nContent: ${(newsItem.description || '').slice(0, 2000)}`;

    const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
            model,
            prompt: prompt + input,
            stream: false,
            options: { temperature: 0.1 }
        })
    });

    const data = await response.json();
    if (data.error) throw new Error(`Ollama error: ${data.error}`);
    const text = (data.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Ollama response');
    return JSON.parse(jsonMatch[0]);
}

/**
 * Fast extraction using Claude API (for on-demand / interactive use)
 */
async function extractFromNewsFast(newsItem) {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('CLAUDE_API_KEY not set');

    const schema = loadSchema();
    const prompt = buildPrompt(schema);
    const content = newsItem.description || newsItem.summary || '';
    const input = `Title: ${newsItem.title}\nSource: ${newsItem.source_name || ''} (${newsItem.source_lang || ''})\nDate: ${newsItem.pubDate || newsItem.pub_date || ''}\nContent: ${content.slice(0, 4000)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{
                role: 'user',
                content: prompt + input
            }]
        })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    const text = (data.content?.[0]?.text || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');
    return JSON.parse(jsonMatch[0]);
}

// --- Batch extraction ---

function buildBatchPrompt(schema, graphContext) {
    const EVENT_TYPES = schema.event_types.map(e => e.id);
    const rules = schema.extraction.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
    const lang = schema.extraction.output_language || 'es';

    const contextLines = (graphContext?.nodes || [])
        .map(n => `  ${n.id}: ${n.name} (${n.type})`)
        .join('\n');

    return `You are an ontological news analyst for Lombardi. You will receive MULTIPLE news articles about a related topic. Extract a UNIFIED graph — one event, all actors, all relations.
OUTPUT LANGUAGE: ${lang}

RULES:
${rules}
${rules.includes('mention_count') ? '' : `${schema.extraction.rules.length + 1}. For each actor, include mention_count: in how many of the provided articles this actor is mentioned.
${schema.extraction.rules.length + 2}. For each relation, include evidence_count: how many articles support this relation.
${schema.extraction.rules.length + 3}. Actors/places mentioned in 2+ articles are CONFIRMED (overlapping signal). Actors in only 1 article are NOVEL.
${schema.extraction.rules.length + 4}. Use existing graph IDs when the entity matches an existing node below.
${schema.extraction.rules.length + 5}. Places are the strongest anchors — always extract locations.`}

EVENT TYPES: ${EVENT_TYPES.join(', ')}

ENTITY CLASSIFICATION (STRICT):
- Person: individual humans (politicians, executives, activists). NOT groups.
- Organization: companies, governments, parties, military forces, NGOs, media outlets, international bodies.
- Location: countries, cities, regions, geographic features.
- Object: ONLY physical objects or specific products. Use sparingly.

CRITICAL: Do NOT create actors for abstract concepts, strategies, policies, sanctions, or events.

${contextLines ? `EXISTING GRAPH CONTEXT (reuse these IDs if the entity matches):
${contextLines}
` : ''}Respond with ONLY valid JSON, no markdown:
{
  "event": {
    "id": "kebab-case-descriptivo",
    "name": "Nombre del evento en español",
    "event_type": "EVENT_TYPE",
    "date": "YYYY-MM-DD o null",
    "is_disputed": false,
    "evidence_quotes": [
      {"quote": "cita en idioma original", "source_name": "Nombre fuente", "source_url": "https://..."}
    ],
    "extraction_confidence": 0.85
  },
  "actors": [
    {
      "id": "kebab-case",
      "name": "Nombre",
      "type": "Person|Organization|Location",
      "description": "descriptor breve en español",
      "role": "verbo en español",
      "impact_direction": "positive|negative|neutral",
      "mention_count": 3
    }
  ],
  "actor_relations": [
    {"source": "actor-id", "relation": "PERTENECE_A|UBICADO_EN", "target": "actor-id", "evidence_count": 2}
  ],
  "provenance": [
    {"source_url": "https://...", "contributed_actor_ids": ["id1"], "is_sole_source_for": ["id2"]}
  ]
}

NEWS ARTICLES:
`;
}

async function extractBatchFast(newsItems, graphContext) {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('CLAUDE_API_KEY not set');

    const schema = loadSchema();
    const prompt = buildBatchPrompt(schema, graphContext);

    const articles = newsItems.map((item, i) => {
        const content = item.content || item.description || '';
        return `[Article ${i + 1}]\nTitle: ${item.title}\nSource: ${item.source_name || item.source || ''} (${item.source_lang || ''})\nDate: ${item.pubDate || item.pub_date || ''}\nURL: ${item.link || ''}\nContent: ${content.slice(0, 3000)}`;
    }).join('\n\n---\n\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        signal: AbortSignal.timeout(90000),
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt + articles }]
        })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    const text = (data.content?.[0]?.text || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude batch response');
    return JSON.parse(jsonMatch[0]);
}

async function extractBatch(newsItems, graphContext) {
    const schema = loadSchema();
    const prompt = buildBatchPrompt(schema, graphContext);
    const model = schema.extraction.models.extractor.model;

    const articles = newsItems.map((item, i) => {
        const content = item.content || item.description || '';
        return `[Article ${i + 1}]\nTitle: ${item.title}\nSource: ${item.source_name || item.source || ''}\nDate: ${item.pubDate || item.pub_date || ''}\nURL: ${item.link || ''}\nContent: ${content.slice(0, 1500)}`;
    }).join('\n\n---\n\n');

    const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(300000),
        body: JSON.stringify({
            model,
            prompt: prompt + articles,
            stream: false,
            options: { temperature: 0.1 }
        })
    });

    const data = await response.json();
    if (data.error) throw new Error(`Ollama error: ${data.error}`);
    const text = (data.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Ollama batch response');
    return JSON.parse(jsonMatch[0]);
}

module.exports = { loadSchema, buildPrompt, extractFromNews, extractFromNewsFast, buildBatchPrompt, extractBatchFast, extractBatch };
