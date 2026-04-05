const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SCHEMA_PATH = path.join(__dirname, '../data/schema.json');
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
const RESOLVER_MODEL = schema.extraction.models.resolver.model;
const OLLAMA_URL = 'http://localhost:11434/api/generate';

const pool = new Pool({
    host: 'localhost', port: 5432, database: 'lombardi',
    user: 'os_admin', password: 'lombardi_pass'
});

function esc(str) {
    if (!str) return '';
    return String(str).slice(0, 500).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '').replace(/[\r\n]+/g, ' ');
}

function parseAgtype(raw) {
    return JSON.parse(String(raw).replace(/::(vertex|edge|path)$/g, ''));
}

const RESOLVER_PROMPT = `You are a contradiction detector for Lombardi. Compare two claims about the same event from different news sources.

RULES:
1. Determine if the two claims CONTRADICT each other, COMPLEMENT each other, or are UNRELATED.
2. If they contradict: explain what specifically differs (facts, numbers, attribution, framing).
3. Assign a tension_score from 0.0 (no tension) to 1.0 (direct factual contradiction).
4. Be precise: different framing is NOT contradiction. Only factual disagreements count as contradiction.
5. Respond in Spanish.

Respond with ONLY valid JSON:
{
  "relation": "CONTRADICE|COMPLEMENTA|UNRELATED",
  "contradiction_type": "fact|actor|attribute|narrative",
  "tension_score": 0.0,
  "analysis": "Breve explicacion de la diferencia o coincidencia",
  "claim_a_bias": "sesgo detectado en la fuente A (o 'neutral')",
  "claim_b_bias": "sesgo detectado en la fuente B (o 'neutral')"
}

contradiction_type (only when relation is CONTRADICE):
- "fact": one says X happened, the other says it did not
- "actor": they disagree on WHO did it
- "attribute": they disagree on quantities, dates, or details
- "narrative": same facts, but framed with opposing interpretations

`;

async function resolveWithOllama(claimA, claimB, sourceA, sourceB) {
    const input = `CLAIM A (${sourceA}):
Subject: ${claimA.subject}
Predicate: ${claimA.predicate}
Object: ${claimA.object}
Evidence: ${claimA.evidence_quote || 'N/A'}

CLAIM B (${sourceB}):
Subject: ${claimB.subject}
Predicate: ${claimB.predicate}
Object: ${claimB.object}
Evidence: ${claimB.evidence_quote || 'N/A'}`;

    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180000), // 3 min for qwen3.5
        body: JSON.stringify({
            model: RESOLVER_MODEL,
            prompt: RESOLVER_PROMPT + input,
            stream: false,
            options: { temperature: 0.1 }
        })
    });

    const data = await response.json();
    const raw = data.response.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resolver no devolvio JSON valido');
    return JSON.parse(jsonMatch[0]);
}

async function findCandidatePairs(client) {
    // Buscar afirmaciones que comparten el mismo evento pero vienen de distintas fuentes
    const result = await client.query(`
        SELECT * FROM cypher('lombardi', $$
            MATCH (n1:Noticia)-[:REPORTA]->(c1:Afirmacion)-[:SOSTIENE]->(e:Evento)<-[:SOSTIENE]-(c2:Afirmacion)<-[:REPORTA]-(n2:Noticia)
            WHERE n1.source <> n2.source AND id(c1) < id(c2)
            RETURN c1, c2, n1.source, n2.source, e.name LIMIT 50
        $$) as (c1 agtype, c2 agtype, s1 agtype, s2 agtype, evt agtype)
    `).catch(() => ({ rows: [] }));

    return result.rows.map(r => ({
        claimA: parseAgtype(r.c1).properties,
        claimB: parseAgtype(r.c2).properties,
        sourceA: JSON.parse(r.s1),
        sourceB: JSON.parse(r.s2),
        eventName: JSON.parse(r.evt)
    }));
}

async function findCandidatesByActor(client) {
    // Afirmaciones que comparten actor pero de distintas fuentes
    const result = await client.query(`
        SELECT * FROM cypher('lombardi', $$
            MATCH (n1:Noticia)-[:REPORTA]->(c1:Afirmacion)-[:INVOLUCRA]->(a:Actor)<-[:INVOLUCRA]-(c2:Afirmacion)<-[:REPORTA]-(n2:Noticia)
            WHERE n1.source <> n2.source AND id(c1) < id(c2)
            RETURN c1, c2, n1.source, n2.source, a.name LIMIT 50
        $$) as (c1 agtype, c2 agtype, s1 agtype, s2 agtype, actor agtype)
    `).catch(err => { console.error('Query error:', err.message); return { rows: [] }; });

    // Filter out already-resolved pairs in JS
    const alreadyResolved = new Set();
    const resolved = await client.query(`
        SELECT * FROM cypher('lombardi', $$
            MATCH (c1)-[:CONTRADICE]->(c2) RETURN c1.id, c2.id
        $$) as (a agtype, b agtype)
    `).catch(() => ({ rows: [] }));
    const complemented = await client.query(`
        SELECT * FROM cypher('lombardi', $$
            MATCH (c1)-[:COMPLEMENTA]->(c2) RETURN c1.id, c2.id
        $$) as (a agtype, b agtype)
    `).catch(() => ({ rows: [] }));

    for (const r of [...resolved.rows, ...complemented.rows]) {
        alreadyResolved.add(`${JSON.parse(r.a)}|${JSON.parse(r.b)}`);
    }

    return result.rows
        .map(r => ({
            claimA: parseAgtype(r.c1).properties,
            claimB: parseAgtype(r.c2).properties,
            sourceA: JSON.parse(r.s1),
            sourceB: JSON.parse(r.s2),
            eventName: JSON.parse(r.actor) + ' (actor compartido)'
        }))
        .filter(p => !alreadyResolved.has(`${p.claimA.id}|${p.claimB.id}`));
}

async function writeRelation(client, claimAId, claimBId, resolution) {
    const relType = resolution.relation;
    if (relType === 'UNRELATED') return;

    if (relType === 'CONTRADICE') {
        await client.query(`
            SELECT * FROM cypher('lombardi', $$
                MATCH (c1:Afirmacion {id: '${esc(claimAId)}'}), (c2:Afirmacion {id: '${esc(claimBId)}'})
                MERGE (c1)-[r:CONTRADICE]->(c2)
                SET r.tension_score = ${parseFloat(resolution.tension_score) || 0},
                    r.contradiction_type = '${esc(resolution.contradiction_type || '')}',
                    r.analysis = '${esc(resolution.analysis || '')}',
                    r.detected_by = '${esc(RESOLVER_MODEL)}',
                    r.detected_at = '${new Date().toISOString()}',
                    r.verification_status = 'pending',
                    r.consensus_score = 0.0,
                    r.vote_agree_count = 0,
                    r.vote_disagree_count = 0,
                    r.vote_uncertain_count = 0
                RETURN c1, c2
            $$) as (c1 agtype, c2 agtype)
        `);
    } else if (relType === 'COMPLEMENTA') {
        await client.query(`
            SELECT * FROM cypher('lombardi', $$
                MATCH (c1:Afirmacion {id: '${esc(claimAId)}'}), (c2:Afirmacion {id: '${esc(claimBId)}'})
                MERGE (c1)-[r:COMPLEMENTA]->(c2)
                SET r.detected_by = '${esc(RESOLVER_MODEL)}',
                    r.detected_at = '${new Date().toISOString()}'
                RETURN c1, c2
            $$) as (c1 agtype, c2 agtype)
        `);
    }
}

async function main() {
    console.log(`=== Lombardi Resolver (${RESOLVER_MODEL}) ===\n`);

    const client = await pool.connect();
    try {
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");

        // Buscar pares candidatos
        console.log('Buscando pares de afirmaciones por evento...');
        let pairs = await findCandidatePairs(client);

        if (pairs.length === 0) {
            console.log('Sin pares por evento. Buscando por actor compartido...');
            pairs = await findCandidatesByActor(client);
        }

        console.log(`Encontrados ${pairs.length} pares para analizar.\n`);

        let contradictions = 0, complements = 0, unrelated = 0, errors = 0;

        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            console.log(`[${i + 1}/${pairs.length}] ${pair.eventName}`);
            console.log(`  A (${pair.sourceA}): ${pair.claimA.subject} → ${pair.claimA.predicate} → ${pair.claimA.object}`);
            console.log(`  B (${pair.sourceB}): ${pair.claimB.subject} → ${pair.claimB.predicate} → ${pair.claimB.object}`);

            try {
                const resolution = await resolveWithOllama(pair.claimA, pair.claimB, pair.sourceA, pair.sourceB);
                console.log(`  => ${resolution.relation} (Sd: ${resolution.tension_score})`);
                if (resolution.analysis) console.log(`     ${resolution.analysis}`);

                await writeRelation(client, pair.claimA.id, pair.claimB.id, resolution);

                if (resolution.relation === 'CONTRADICE') contradictions++;
                else if (resolution.relation === 'COMPLEMENTA') complements++;
                else unrelated++;
            } catch (err) {
                console.error(`  ERROR: ${err.message.slice(0, 80)}`);
                errors++;
            }
            console.log('');
        }

        console.log('=== Resumen ===');
        console.log(`Contradicciones: ${contradictions}`);
        console.log(`Complementos: ${complements}`);
        console.log(`No relacionados: ${unrelated}`);
        console.log(`Errores: ${errors}`);

    } finally {
        client.release();
        pool.end();
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
