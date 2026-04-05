/**
 * Landscape Sweep — Periodic clustering of events by shared actors
 * Detects containment, merge, and reparent opportunities.
 * Generates suggestions for user review (like "friend requests").
 */

const { Pool } = require('pg');
const { nameSimilarity, dateProximity } = require('./dedup');
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '../data/schema.json');
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
const EXTRACTOR_MODEL = schema.extraction.models.extractor.model;
const OLLAMA_URL = 'http://localhost:11434/api/generate';

const pool = new Pool({
    host: 'localhost', port: 5432, database: 'lombardi',
    user: 'os_admin', password: 'lombardi_pass'
});

// --- DB Setup ---

async function initLandscapeTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS landscape_suggestions (
            id SERIAL PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('containment', 'merge', 'reparent')),
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
            event_a_id TEXT NOT NULL,
            event_a_name TEXT,
            event_b_id TEXT NOT NULL,
            event_b_name TEXT,
            reason TEXT,
            confidence REAL,
            shared_actors TEXT[],
            name_similarity REAL,
            date_proximity REAL,
            suggested_at TIMESTAMPTZ DEFAULT NOW(),
            resolved_at TIMESTAMPTZ,
            resolved_by TEXT
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_landscape_status ON landscape_suggestions(status)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_landscape_events ON landscape_suggestions(event_a_id, event_b_id)`).catch(() => {});
}

// --- Clustering by Shared Actors ---

async function clusterBySharedActors(client) {
    const result = await client.query(`
        SELECT * FROM cypher('lombardi', $$
            MATCH (a:Actor)-[:PARTICIPA]->(e1:Evento),
                  (a)-[:PARTICIPA]->(e2:Evento)
            WHERE e1.id < e2.id
            WITH e1, e2, collect(DISTINCT a.name) AS shared, count(DISTINCT a) AS cnt
            WHERE cnt >= 1
            RETURN e1.id, e1.name, e1.event_type, e1.date,
                   e2.id, e2.name, e2.event_type, e2.date,
                   shared, cnt
            ORDER BY cnt DESC
            LIMIT 100
        $$) as (e1_id agtype, e1_name agtype, e1_type agtype, e1_date agtype,
                e2_id agtype, e2_name agtype, e2_type agtype, e2_date agtype,
                shared agtype, cnt agtype)
    `);

    return result.rows.map(row => ({
        e1: {
            id: JSON.parse(row.e1_id),
            name: JSON.parse(row.e1_name || '""'),
            event_type: JSON.parse(row.e1_type || '""'),
            date: JSON.parse(row.e1_date || '""')
        },
        e2: {
            id: JSON.parse(row.e2_id),
            name: JSON.parse(row.e2_name || '""'),
            event_type: JSON.parse(row.e2_type || '""'),
            date: JSON.parse(row.e2_date || '""')
        },
        sharedActors: JSON.parse(row.shared || '[]'),
        sharedCount: JSON.parse(row.cnt || '0')
    }));
}

// --- Union-Find for Connected Components ---

class UnionFind {
    constructor() { this.parent = new Map(); this.rank = new Map(); }
    find(x) {
        if (!this.parent.has(x)) { this.parent.set(x, x); this.rank.set(x, 0); }
        if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)));
        return this.parent.get(x);
    }
    union(a, b) {
        const ra = this.find(a), rb = this.find(b);
        if (ra === rb) return;
        const rankA = this.rank.get(ra), rankB = this.rank.get(rb);
        if (rankA < rankB) this.parent.set(ra, rb);
        else if (rankA > rankB) this.parent.set(rb, ra);
        else { this.parent.set(rb, ra); this.rank.set(ra, rankA + 1); }
    }
}

function buildClusters(pairs) {
    const uf = new UnionFind();
    const eventMap = new Map(); // id → event data

    for (const pair of pairs) {
        uf.union(pair.e1.id, pair.e2.id);
        eventMap.set(pair.e1.id, pair.e1);
        eventMap.set(pair.e2.id, pair.e2);
    }

    // Group by root
    const clusters = new Map();
    for (const [id] of eventMap) {
        const root = uf.find(id);
        if (!clusters.has(root)) clusters.set(root, []);
        clusters.get(root).push(eventMap.get(id));
    }

    // Attach shared actor info
    const clusterList = [];
    for (const [, events] of clusters) {
        if (events.length < 2) continue;
        // Collect all shared actor pairs for this cluster
        const allShared = new Set();
        for (const pair of pairs) {
            const r1 = uf.find(pair.e1.id), r2 = uf.find(pair.e2.id);
            if (r1 === uf.find(events[0].id)) {
                for (const a of pair.sharedActors) allShared.add(a);
            }
        }
        clusterList.push({ events, sharedActors: [...allShared] });
    }

    return clusterList;
}

// --- LLM Classification ---

function buildClusterPrompt(cluster) {
    const eventList = cluster.events.map(e =>
        `- "${e.name}" [${e.event_type}] ${e.date || 'sin fecha'} (id: ${e.id})`
    ).join('\n');

    return `Eres un analista de eventos noticiosos. Analiza este grupo de eventos que comparten actores.

ACTORES EN COMUN: ${cluster.sharedActors.join(', ')}

EVENTOS:
${eventList}

Determina las relaciones entre estos eventos. Para cada par relevante, indica:
- "containment": un evento es un sub-evento o instancia de otro más amplio
- "merge": son el mismo evento descrito de forma diferente (deben fusionarse)
- "none": son eventos distintos que comparten actores pero no están relacionados jerárquicamente

Responde SOLO con JSON válido:
{
  "suggestions": [
    {
      "type": "containment|merge",
      "parent_id": "id del evento más amplio (solo para containment)",
      "child_id": "id del sub-evento (solo para containment)",
      "event_a_id": "id evento A (para merge)",
      "event_b_id": "id evento B (para merge)",
      "reason": "explicación breve en español",
      "confidence": 0.0-1.0
    }
  ]
}

Si no hay relaciones claras, devuelve: { "suggestions": [] }`;
}

async function classifyCluster(cluster) {
    try {
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(120000),
            body: JSON.stringify({
                model: EXTRACTOR_MODEL,
                prompt: buildClusterPrompt(cluster),
                stream: false,
                options: { temperature: 0.1, num_predict: 1024, num_ctx: 4096 }
            })
        });

        const data = await response.json();
        if (data.error || !data.response) return [];

        let raw = data.response.trim();
        raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return [];

        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.suggestions || [];
    } catch (err) {
        console.error(`[Landscape] LLM error: ${err.message.slice(0, 80)}`);
        return [];
    }
}

// --- Graph Operations ---

function esc(str) {
    if (!str) return '';
    return String(str).slice(0, 500).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '').replace(/[\r\n]+/g, ' ');
}

async function createContainsEdge(client, parentId, childId, by) {
    await client.query(`
        SELECT * FROM cypher('lombardi', $$
            MATCH (parent:Evento {id: '${esc(parentId)}'}), (child:Evento {id: '${esc(childId)}'})
            MERGE (parent)-[r:CONTIENE]->(child)
            SET r.established_at = '${new Date().toISOString()}',
                r.established_by = '${esc(by)}'
            RETURN parent, child
        $$) as (parent agtype, child agtype)
    `);
}

async function mergeEvents(client, absorberId, absorbedId) {
    // 1. Transfer PARTICIPA edges from absorbed to absorber
    await client.query(`
        SELECT * FROM cypher('lombardi', $$
            MATCH (a:Actor)-[r:PARTICIPA]->(absorbed:Evento {id: '${esc(absorbedId)}'})
            MATCH (absorber:Evento {id: '${esc(absorberId)}'})
            MERGE (a)-[r2:PARTICIPA]->(absorber)
            SET r2.role = r.role, r2.impact_direction = r.impact_direction
            RETURN a
        $$) as (a agtype)
    `).catch(() => {});

    // 2. Transfer CONTIENE children from absorbed to absorber
    await client.query(`
        SELECT * FROM cypher('lombardi', $$
            MATCH (absorbed:Evento {id: '${esc(absorbedId)}'})-[r:CONTIENE]->(child:Evento)
            MATCH (absorber:Evento {id: '${esc(absorberId)}'})
            MERGE (absorber)-[r2:CONTIENE]->(child)
            SET r2.established_at = '${new Date().toISOString()}',
                r2.established_by = 'system:merge'
            RETURN child
        $$) as (child agtype)
    `).catch(() => {});

    // 3. Transfer evento_sources
    await pool.query(`
        UPDATE evento_sources SET evento_id = $1
        WHERE evento_id = $2 AND news_link NOT IN (
            SELECT news_link FROM evento_sources WHERE evento_id = $1
        )
    `, [absorberId, absorbedId]);

    // Clean up remaining absorbed sources (duplicates)
    await pool.query(`DELETE FROM evento_sources WHERE evento_id = $1`, [absorbedId]);

    // 4. Delete absorbed event node (and its edges)
    await client.query(`
        SELECT * FROM cypher('lombardi', $$
            MATCH (e:Evento {id: '${esc(absorbedId)}'})
            DETACH DELETE e
        $$) as (result agtype)
    `).catch(() => {});
}

// --- Main Sweep ---

async function runSweep() {
    console.log('[Landscape] Iniciando barrido...');
    const client = await pool.connect();
    let suggestionsCreated = 0;

    try {
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");

        // 1. Find event pairs that share actors
        const pairs = await clusterBySharedActors(client);
        console.log(`[Landscape] ${pairs.length} pares de eventos con actores compartidos.`);

        if (pairs.length === 0) {
            console.log('[Landscape] Nada que analizar.');
            return { suggestions_created: 0 };
        }

        // 2. Build clusters (connected components)
        const clusters = buildClusters(pairs);
        console.log(`[Landscape] ${clusters.length} clusters formados.`);

        // 3. Filter out pairs/clusters where suggestions already exist
        const existingResult = await pool.query(`
            SELECT event_a_id, event_b_id FROM landscape_suggestions
            WHERE status IN ('pending', 'accepted')
        `);
        const existingPairs = new Set(
            existingResult.rows.map(r => [r.event_a_id, r.event_b_id].sort().join('|'))
        );

        // 4. Classify each cluster with LLM
        for (const cluster of clusters) {
            if (cluster.events.length > 10) {
                // Too large — skip or split
                console.log(`[Landscape] Cluster con ${cluster.events.length} eventos omitido (muy grande).`);
                continue;
            }

            const suggestions = await classifyCluster(cluster);

            for (const s of suggestions) {
                if (!s.type || s.type === 'none') continue;

                let eventAId, eventBId, eventAName, eventBName;

                if (s.type === 'containment') {
                    eventAId = s.parent_id;
                    eventBId = s.child_id;
                } else {
                    eventAId = s.event_a_id;
                    eventBId = s.event_b_id;
                }

                if (!eventAId || !eventBId) continue;

                // Check if this pair already has a suggestion
                const pairKey = [eventAId, eventBId].sort().join('|');
                if (existingPairs.has(pairKey)) continue;

                // Find names
                const eventA = cluster.events.find(e => e.id === eventAId);
                const eventB = cluster.events.find(e => e.id === eventBId);
                eventAName = eventA?.name || eventAId;
                eventBName = eventB?.name || eventBId;

                // Compute similarity metrics
                const nSim = nameSimilarity(eventAName, eventBName);
                const dProx = dateProximity(eventA?.date, eventB?.date, 14);

                await pool.query(`
                    INSERT INTO landscape_suggestions
                    (type, event_a_id, event_a_name, event_b_id, event_b_name, reason, confidence, shared_actors, name_similarity, date_proximity)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                `, [s.type, eventAId, eventAName, eventBId, eventBName,
                    s.reason || '', s.confidence || 0.5,
                    cluster.sharedActors, nSim, dProx]);

                existingPairs.add(pairKey);
                suggestionsCreated++;
            }
        }

        console.log(`[Landscape] Barrido completo. ${suggestionsCreated} sugerencias creadas.`);
        return { suggestions_created: suggestionsCreated };
    } catch (err) {
        console.error(`[Landscape] Error: ${err.message}`);
        throw err;
    } finally {
        client.release();
    }
}

// --- Accept/Reject Suggestions ---

async function acceptSuggestion(id, resolvedBy = 'user:manual') {
    const client = await pool.connect();
    try {
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");

        const result = await pool.query(
            `SELECT * FROM landscape_suggestions WHERE id = $1 AND status = 'pending'`, [id]
        );
        if (result.rows.length === 0) throw new Error('Suggestion not found or not pending');

        const s = result.rows[0];

        if (s.type === 'containment') {
            await createContainsEdge(client, s.event_a_id, s.event_b_id, resolvedBy);
        } else if (s.type === 'merge') {
            await mergeEvents(client, s.event_a_id, s.event_b_id);
        }

        await pool.query(
            `UPDATE landscape_suggestions SET status = 'accepted', resolved_at = NOW(), resolved_by = $1 WHERE id = $2`,
            [resolvedBy, id]
        );

        return s;
    } finally {
        client.release();
    }
}

async function rejectSuggestion(id, resolvedBy = 'user:manual') {
    const result = await pool.query(
        `UPDATE landscape_suggestions SET status = 'rejected', resolved_at = NOW(), resolved_by = $1
         WHERE id = $2 AND status = 'pending' RETURNING *`,
        [resolvedBy, id]
    );
    if (result.rows.length === 0) throw new Error('Suggestion not found or not pending');
    return result.rows[0];
}

async function acceptAllSuggestions(resolvedBy = 'user:accept_all') {
    const pending = await pool.query(
        `SELECT id FROM landscape_suggestions WHERE status = 'pending' ORDER BY confidence DESC`
    );
    const results = [];
    for (const row of pending.rows) {
        try {
            const s = await acceptSuggestion(row.id, resolvedBy);
            results.push({ id: row.id, status: 'accepted', type: s.type });
        } catch (err) {
            results.push({ id: row.id, status: 'error', message: err.message });
        }
    }
    return results;
}

async function getPendingSuggestions() {
    const result = await pool.query(`
        SELECT s.*,
            (SELECT COUNT(*)::int FROM evento_sources WHERE evento_id = s.event_a_id) as event_a_sources,
            (SELECT COUNT(*)::int FROM evento_sources WHERE evento_id = s.event_b_id) as event_b_sources
        FROM landscape_suggestions s
        WHERE s.status = 'pending'
        ORDER BY s.confidence DESC, s.suggested_at DESC
    `);
    return result.rows;
}

module.exports = {
    initLandscapeTables,
    runSweep,
    acceptSuggestion,
    rejectSuggestion,
    acceptAllSuggestions,
    getPendingSuggestions,
    createContainsEdge,
    mergeEvents,
    pool
};
