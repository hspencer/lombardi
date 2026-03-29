require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = 3000;
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const ALIASES_PATH = path.join(__dirname, '../data/aliases.json');
const SCHEMA_PATH = path.join(__dirname, '../data/schema.json');
const FEEDS_PATH = path.join(__dirname, '../data/sources/feeds.json');
const TOPICS_PATH = path.join(__dirname, '../data/sources/topics.json');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'lombardi',
    user: 'os_admin',
    password: 'lombardi_pass'
});

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

const MIME = {
    '.html': 'text/html', '.css': 'text/css',
    '.js': 'application/javascript', '.json': 'application/json',
    '.svg': 'image/svg+xml'
};

function parseAgtype(raw) {
    const str = String(raw).replace(/::(vertex|edge|path)$/g, '');
    return JSON.parse(str);
}

function flat(v) {
    return { ...v.properties, label: v.label };
}

function esc(str) {
    return String(str || '').slice(0, 500).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '').replace(/[\r\n]+/g, ' ');
}

function kebab(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50);
}

async function ageQuery(cypher) {
    const client = await pool.connect();
    try {
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");
        const res = await client.query(`SELECT * FROM cypher('lombardi', $$ ${cypher} $$) as (v agtype)`);
        return res.rows.map(r => parseAgtype(r.v));
    } finally {
        client.release();
    }
}

// Multi-column agtype queries
async function ageQuery2(cypher, cols) {
    const client = await pool.connect();
    try {
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");
        const colDef = cols.map(c => `${c} agtype`).join(', ');
        const res = await client.query(`SELECT * FROM cypher('lombardi', $$ ${cypher} $$) as (${colDef})`);
        return res.rows.map(row => {
            const obj = {};
            cols.forEach(c => { obj[c] = parseAgtype(row[c]); });
            return obj;
        });
    } finally {
        client.release();
    }
}

async function handleAPI(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // === DISPUTES: all disputed nodes + contradiction edges + connected actors ===
    if (url.pathname === '/api/disputes') {
        const nodeMap = new Map();
        const edgeList = [];

        // 1. Disputed events/claims
        const disputed = await ageQuery(
            `MATCH (n) WHERE n.is_disputed = true RETURN n`
        ).catch(() => []);

        for (const v of disputed) {
            const n = flat(v);
            n.type = n.type || (n.label === 'Evento' ? 'Event' : n.label);
            n._degree = 0;
            nodeMap.set(n.id, n);
        }

        // 2. CONTRADICE / DESMIENTE edges + their endpoints
        const contradictions = await ageQuery(
            `MATCH (a)-[r]->(b) WHERE type(r) = 'CONTRADICE' OR type(r) = 'DESMIENTE' RETURN a, r, b`
        ).catch(() => []);

        for (const row of contradictions) {
            const a = flat(row[0] || row);
            const r = row[1]?.properties || {};
            const b = flat(row[2] || {});
            const rtype = row[1]?.label || 'CONTRADICE';

            if (a.id && !nodeMap.has(a.id)) {
                a._degree = 0;
                a.type = a.type || (a.label === 'Evento' ? 'Event' : a.label);
                nodeMap.set(a.id, a);
            }
            if (b.id && !nodeMap.has(b.id)) {
                b._degree = 0;
                b.type = b.type || (b.label === 'Evento' ? 'Event' : b.label);
                nodeMap.set(b.id, b);
            }
            if (a.id && b.id) {
                edgeList.push({ source: a.id, target: b.id, type: rtype, ...r });
            }
        }

        // 3. Actors connected to disputed nodes
        const disputedIds = Array.from(nodeMap.keys()).map(id => `'${esc(id)}'`).join(',');
        if (disputedIds.length > 0) {
            const actors = await ageQuery(
                `MATCH (a:Actor)-[r]-(n) WHERE n.id IN [${disputedIds}] RETURN a, r, n`
            ).catch(() => []);

            for (const row of actors) {
                const a = flat(row[0] || row);
                const r = row[1]?.properties || {};
                const n = row[2] || {};
                const rtype = row[1]?.label || 'PARTICIPA';

                if (a.id && !nodeMap.has(a.id)) {
                    a._degree = 1;
                    a.type = a.type || 'Person';
                    nodeMap.set(a.id, a);
                }
                const nid = n.properties?.id || n.id;
                if (a.id && nid) {
                    edgeList.push({ source: a.id, target: nid, type: rtype, ...r });
                }
            }
        }

        const focalIds = disputed.map(v => flat(v).id).filter(Boolean);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            nodes: Array.from(nodeMap.values()),
            edges: edgeList,
            focalIds
        }));
        return;
    }

    // === PANORAMA: N eventos recientes + actores + aristas ===
    if (url.pathname === '/api/panorama') {
        const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || '10')));

        // 1. Eventos más recientes (try dated first, then any)
        let events = await ageQuery(
            `MATCH (e:Evento) WHERE e.date IS NOT NULL AND e.date <> 'null' AND e.date <> '' RETURN e ORDER BY e.date DESC LIMIT ${limit}`
        ).catch(() => []);

        // Fallback: most connected events if no dated ones
        if (!events.length) {
            events = await ageQuery(
                `MATCH (e:Evento)-[r]-() RETURN e, count(r) as c ORDER BY c DESC LIMIT ${limit}`
            ).catch(() => []);
        }

        if (!events.length) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ nodes: [], edges: [], focalIds: [] }));
            return;
        }

        const nodeMap = new Map();
        const focalIds = [];

        for (const v of events) {
            const n = flat(v);
            n.type = 'Event';
            n._degree = 0;
            nodeMap.set(n.id, n);
            focalIds.push(n.id);
        }

        // Enrich events with dates from news_raw if missing
        const client = await pool.connect();
        try {
            for (const [id, n] of nodeMap) {
                if (!n.date || n.date === 'null' || n.date === '') {
                    const newsDate = await client.query(
                        "SELECT pub_date, ingested_at FROM news_raw WHERE link = $1 OR title ILIKE $2 LIMIT 1",
                        [n.source_url || '', `%${(n.name || '').slice(0, 40)}%`]
                    );
                    if (newsDate.rows.length) {
                        n.date = newsDate.rows[0].pub_date || newsDate.rows[0].ingested_at || null;
                    }
                }
            }
        } finally {
            client.release();
        }

        // 2. Actores conectados a esos eventos
        const eventIds = focalIds.map(id => `'${esc(id)}'`).join(',');
        const actors = await ageQuery(
            `MATCH (a:Actor)-[r]-(e:Evento) WHERE e.id IN [${eventIds}] RETURN a`
        ).catch(() => []);

        for (const v of actors) {
            const n = flat(v);
            if (!nodeMap.has(n.id)) {
                n._degree = 1;
                nodeMap.set(n.id, n);
            }
        }

        // 3. Aristas entre todos los nodos
        const allIds = [...nodeMap.keys()].map(id => `'${esc(id)}'`).join(',');
        const edgeRows = await ageQuery(
            `MATCH (a)-[r]-(b) WHERE a.id IN [${allIds}] AND b.id IN [${allIds}] RETURN {source: a.id, target: b.id, type: type(r), role: r.role, tension_score: r.tension_score}`
        ).catch(() => []);

        const edgeMap = new Map();
        for (const e of edgeRows) {
            const key = [e.source, e.target].sort().join('|') + '|' + e.type;
            if (!edgeMap.has(key)) edgeMap.set(key, e);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            nodes: [...nodeMap.values()],
            edges: [...edgeMap.values()],
            focalIds
        }));
        return;
    }

    // === EGOSISTEMA: nodo focal + grado 1 + grado 2 ===
    if (url.pathname === '/api/ego') {
        let focalId = url.searchParams.get('id');
        const maxDegree = Math.min(3, Math.max(1, parseInt(url.searchParams.get('degree') || '2')));

        // Si no hay ID, mostrar el evento más reciente o un actor relevante
        if (!focalId) {
            // Primero intentar evento más reciente (por fecha)
            const recentEvent = await ageQuery("MATCH (e:Evento) WHERE e.date IS NOT NULL RETURN e.id ORDER BY e.date DESC LIMIT 1").catch(() => []);
            if (recentEvent.length) {
                focalId = recentEvent[0];
            } else {
                // Fallback: actor con más conexiones
                const topActor = await ageQuery("MATCH (a:Actor)-[r]-() RETURN a.id, count(r) as c ORDER BY c DESC LIMIT 1").catch(() => []);
                focalId = topActor[0] || null;
            }
            if (!focalId) {
                // Último fallback: cualquier actor
                const any = await ageQuery("MATCH (a:Actor) RETURN a.id LIMIT 1").catch(() => []);
                focalId = any[0] || null;
            }
            if (!focalId) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ focal: null, nodes: [], edges: [] }));
                return;
            }
        }

        const safeId = esc(focalId);

        // Nodo focal
        const focalRaw = await ageQuery(`MATCH (f {id: '${safeId}'}) RETURN f`).catch(() => []);
        if (!focalRaw.length) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ focal: null, nodes: [], edges: [] }));
            return;
        }
        const focal = flat(focalRaw[0]);

        // Build ego graph iteratively by degree
        const nodesMap = new Map();
        nodesMap.set(focal.id, { ...focal, _degree: 0 });

        const edgesSet = new Set();
        const edges = [];

        function addEdge(r) {
            const props = r.properties || {};
            const key = `${r.start_id}-${r.end_id}-${r.label}`;
            if (edgesSet.has(key)) return;
            edgesSet.add(key);
            edges.push({
                _startAgId: r.start_id,
                _endAgId: r.end_id,
                type: r.label,
                ...props
            });
        }

        // Expand degree by degree: each degree = one hop from previous frontier
        for (let deg = 1; deg <= maxDegree; deg++) {
            const frontierIds = [...nodesMap.values()].filter(n => n._degree === deg - 1).map(n => esc(n.id));
            if (frontierIds.length === 0) break;

            const limit = deg === 1 ? 50 : deg === 2 ? 20 : 10;
            for (const nId of frontierIds.slice(0, limit)) {
                const neighbors = await ageQuery2(
                    `MATCH (n1 {id: '${nId}'})-[r]-(n2) WHERE label(n2) IN ['Actor', 'Evento'] RETURN n2, r`,
                    ['n2', 'r']
                ).catch(err => { console.error(`Ego expand deg=${deg} nId=${nId}:`, err.message); return []; });

                for (const row of neighbors) {
                    const n2 = flat(row.n2);
                    if (!nodesMap.has(n2.id)) {
                        nodesMap.set(n2.id, { ...n2, _degree: deg });
                    }
                    addEdge(row.r);
                }
            }
        }

        // Query all edges between known nodes using property IDs
        const allIds = [...nodesMap.keys()].map(id => `'${esc(id)}'`).join(',');

        // Get all edges between known nodes
        const allEdges = await ageQuery(
            `MATCH (a)-[r]-(b) WHERE a.id IN [${allIds}] AND b.id IN [${allIds}] RETURN {source: a.id, target: b.id, type: type(r), role: r.role, tension_score: r.tension_score}`
        ).catch(() => []);

        // Deduplicate edges (undirected queries return both directions)
        const dedupEdges = new Map();
        for (const e of allEdges) {
            const key = [e.source, e.target].sort().join('|') + '|' + e.type;
            if (!dedupEdges.has(key)) dedupEdges.set(key, e);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            focal: focal,
            nodes: [...nodesMap.values()],
            edges: [...dedupEdges.values()]
        }));
        return;
    }

    // === NOTICIAS vinculadas a un nodo (v2: via Evento.source_url) ===
    if (url.pathname === '/api/news' && url.searchParams.get('id')) {
        const id = esc(url.searchParams.get('id'));

        const client = await pool.connect();
        try {
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");

            // Collect source_urls from connected Eventos
            let sourceUrls = [];

            // If it's an Evento: get its own source_url
            const directEvt = await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MATCH (e:Evento {id: '${id}'})
                    RETURN e.source_url, e.name, e.event_type, e.evidence_quote
                $$) as (url agtype, name agtype, etype agtype, quote agtype)
            `).catch(() => ({ rows: [] }));

            const eventMeta = [];
            for (const row of directEvt.rows) {
                const u = JSON.parse(row.url || 'null');
                if (u) {
                    sourceUrls.push(u);
                    eventMeta.push({ url: u, name: JSON.parse(row.name || 'null'), event_type: JSON.parse(row.etype || 'null'), evidence_quote: JSON.parse(row.quote || 'null') });
                }
            }

            // If it's an Actor: find all Eventos it PARTICIPA in
            const actorEvts = await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MATCH (a:Actor {id: '${id}'})-[r:PARTICIPA]->(e:Evento)
                    RETURN e.source_url, e.name, e.event_type, e.evidence_quote, r.role
                $$) as (url agtype, name agtype, etype agtype, quote agtype, role agtype)
            `).catch(() => ({ rows: [] }));

            for (const row of actorEvts.rows) {
                const u = JSON.parse(row.url || 'null');
                if (u && !sourceUrls.includes(u)) {
                    sourceUrls.push(u);
                    eventMeta.push({ url: u, name: JSON.parse(row.name || 'null'), event_type: JSON.parse(row.etype || 'null'), evidence_quote: JSON.parse(row.quote || 'null'), role: JSON.parse(row.role || 'null') });
                }
            }

            // Fetch from SQL by source_url
            const newsItems = [];
            for (const sUrl of sourceUrls) {
                const sqlRow = await client.query(
                    "SELECT * FROM public.news_raw WHERE link = $1 LIMIT 1",
                    [sUrl]
                ).catch(() => ({ rows: [] }));

                if (sqlRow.rows[0]) {
                    const meta = eventMeta.find(m => m.url === sUrl) || {};
                    newsItems.push({
                        ...sqlRow.rows[0],
                        _eventName: meta.name,
                        _eventType: meta.event_type,
                        _evidenceQuote: meta.evidence_quote,
                        _role: meta.role
                    });
                }
            }

            // Sort by date desc
            newsItems.sort((a, b) => {
                const da = a.pub_date ? new Date(a.pub_date) : new Date(0);
                const db = b.pub_date ? new Date(b.pub_date) : new Date(0);
                return db - da;
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(newsItems));
        } finally {
            client.release();
        }
        return;
    }

    // === NODE EDIT: cambiar tipo, nombre, descripción ===
    if (url.pathname === '/api/node/update' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { id, name, type, description, event_type } = body;
        if (!id) { res.writeHead(400); res.end('{"error":"id required"}'); return; }

        const sets = [];
        if (name !== undefined) sets.push(`n.name = '${esc(name)}'`);
        if (type !== undefined) sets.push(`n.type = '${esc(type)}'`);
        if (description !== undefined) sets.push(`n.description = '${esc(description)}'`);
        if (event_type !== undefined) sets.push(`n.event_type = '${esc(event_type)}'`);

        if (sets.length > 0) {
            await ageQuery(`MATCH (n {id: '${esc(id)}'}) SET ${sets.join(', ')} RETURN n`);
        }

        // También actualizar en aliases.json si existe
        const aliasData = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
        if (aliasData.entities[id]) {
            if (name !== undefined) aliasData.entities[id].canonical = name;
            if (type !== undefined) aliasData.entities[id].type = type;
            aliasData.updated_at = new Date().toISOString().slice(0, 10);
            fs.writeFileSync(ALIASES_PATH, JSON.stringify(aliasData, null, 2));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // === NODE TRANSLATE: translate name + description via LLM ===
    if (url.pathname === '/api/node/translate' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { id, lang } = body;
        if (!id || !lang) { res.writeHead(400); res.end('{"error":"id and lang required"}'); return; }

        // Fetch current node
        const rows = await ageQuery(`MATCH (n {id: '${esc(id)}'}) RETURN n`);
        if (!rows.length) { res.writeHead(404); res.end('{"error":"node not found"}'); return; }
        const node = flat(rows[0]);

        const apiKey = process.env.CLAUDE_API_KEY;
        if (!apiKey) { res.writeHead(500); res.end('{"error":"no API key configured"}'); return; }

        const targetLang = lang === 'es' ? 'Spanish' : 'English';
        const fields = { name: node.name || '', description: node.description || '' };
        if (node.evidence_quote) fields.evidence_quote = node.evidence_quote;

        const llmRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 512,
                messages: [{ role: 'user', content:
                    `Translate the following JSON values to ${targetLang}. Keep proper nouns unchanged. Return ONLY valid JSON with the same keys.\n\n${JSON.stringify(fields)}`
                }]
            })
        });
        const llmData = await llmRes.json();
        const text = (llmData.content?.[0]?.text || '').trim();
        let translated;
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            translated = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch(e) { translated = null; }

        if (!translated) { res.writeHead(500); res.end('{"error":"translation failed"}'); return; }

        // Update node in graph
        const sets = [];
        if (translated.name) sets.push(`n.name = '${esc(translated.name)}'`);
        if (translated.description) sets.push(`n.description = '${esc(translated.description)}'`);
        if (translated.evidence_quote) sets.push(`n.evidence_quote = '${esc(translated.evidence_quote)}'`);
        if (sets.length) await ageQuery(`MATCH (n {id: '${esc(id)}'}) SET ${sets.join(', ')} RETURN n`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, translated }));
        return;
    }

    // === NODE CREATE: create a new node ===
    if (url.pathname === '/api/node/create' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { name, type, lang } = body;
        if (!name) { res.writeHead(400); res.end('{"error":"name required"}'); return; }

        const id = kebab(name);
        const label = (type === 'Event' || type === 'Evento') ? 'Evento' : 'Actor';
        const nodeType = type || 'Person';

        const client = await pool.connect();
        try {
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, '$user', public");
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MERGE (n:${label} {id: '${esc(id)}'})
                    SET n.name = '${esc(name)}', n.type = '${esc(nodeType)}', n.lang = '${esc(lang || 'es')}'
                    RETURN n
                $$) as (n agtype)
            `);
        } finally {
            client.release();
        }

        // Also register in aliases.json
        const aliasData = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
        if (!aliasData.entities[id]) {
            aliasData.entities[id] = { canonical: name, type: nodeType, aliases: [] };
            aliasData.updated_at = new Date().toISOString().slice(0, 10);
            fs.writeFileSync(ALIASES_PATH, JSON.stringify(aliasData, null, 2));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id, name, type: nodeType, label }));
        return;
    }

    // === NODE ALIASES: listar aliases de un nodo ===
    if (url.pathname === '/api/node/aliases' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        const aliasData = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
        const entry = aliasData.entities[id] || null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, entry }));
        return;
    }

    // === NODE ALIASES: agregar alias ===
    if (url.pathname === '/api/node/aliases/add' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { id, alias } = body;
        const aliasData = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));

        // Verificar si el alias es el id de otro nodo existente (candidato a merge)
        let mergeCandidate = null;
        for (const [entId, entry] of Object.entries(aliasData.entities)) {
            if (entId === id) continue;
            const allNames = [entry.canonical, ...entry.aliases].map(s => s.toLowerCase());
            if (allNames.includes(alias.toLowerCase()) || entId === alias.toLowerCase()) {
                mergeCandidate = { id: entId, ...entry };
                break;
            }
        }
        // También buscar en el grafo
        if (!mergeCandidate) {
            const graphMatch = await ageQuery(`MATCH (n {id: '${esc(alias)}'}) RETURN n`).catch(() => []);
            if (graphMatch.length > 0) {
                const n = graphMatch[0];
                mergeCandidate = { id: n.properties.id, canonical: n.properties.name, type: n.properties.type };
            }
            // Buscar por nombre
            if (!mergeCandidate) {
                const nameMatch = await ageQuery(`MATCH (n) WHERE toLower(n.name) = '${esc(alias.toLowerCase())}' AND n.id <> '${esc(id)}' RETURN n`).catch(() => []);
                if (nameMatch.length > 0) {
                    const n = nameMatch[0];
                    mergeCandidate = { id: n.properties.id, canonical: n.properties.name, type: n.properties.type };
                }
            }
        }

        if (mergeCandidate) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ merge_candidate: mergeCandidate }));
            return;
        }

        // No merge — just add alias
        if (!aliasData.entities[id]) {
            // Buscar nombre actual en grafo para crear entrada
            const nodeData = await ageQuery(`MATCH (n {id: '${esc(id)}'}) RETURN n`).catch(() => []);
            const props = nodeData[0]?.properties || {};
            aliasData.entities[id] = {
                canonical: props.name || id,
                type: props.type || 'Person',
                aliases: []
            };
        }
        if (!aliasData.entities[id].aliases.includes(alias)) {
            aliasData.entities[id].aliases.push(alias);
        }
        aliasData.updated_at = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(ALIASES_PATH, JSON.stringify(aliasData, null, 2));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, aliases: aliasData.entities[id].aliases }));
        return;
    }

    // === NODE ALIASES: eliminar alias ===
    if (url.pathname === '/api/node/aliases/remove' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { id, alias } = body;
        const aliasData = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
        if (aliasData.entities[id]) {
            aliasData.entities[id].aliases = aliasData.entities[id].aliases.filter(a => a !== alias);
            aliasData.updated_at = new Date().toISOString().slice(0, 10);
            fs.writeFileSync(ALIASES_PATH, JSON.stringify(aliasData, null, 2));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // === MERGE NODES: fusionar dos nodos ===
    if (url.pathname === '/api/node/merge' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { keepId, removeId, canonicalName, canonicalType } = body;

        const client = await pool.connect();
        try {
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");

            // 1. Reasignar todas las aristas del nodo a eliminar al nodo que se queda
            // Aristas entrantes
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MATCH (n {id: '${esc(removeId)}'})<-[r]-(m)
                    WHERE m.id <> '${esc(keepId)}'
                    RETURN m.id, type(r)
                $$) as (mid agtype, rtype agtype)
            `).then(async (result) => {
                for (const row of result.rows) {
                    const mid = JSON.parse(row.mid);
                    const rtype = JSON.parse(row.rtype);
                    // Crear la misma arista hacia keepId
                    await client.query(`
                        SELECT * FROM cypher('lombardi', $$
                            MATCH (m {id: '${esc(mid)}'}), (k {id: '${esc(keepId)}'})
                            MERGE (m)-[:${rtype}]->(k)
                            RETURN m, k
                        $$) as (m agtype, k agtype)
                    `).catch(() => {});
                }
            }).catch(() => {});

            // Aristas salientes
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MATCH (n {id: '${esc(removeId)}'})-[r]->(m)
                    WHERE m.id <> '${esc(keepId)}'
                    RETURN m.id, type(r)
                $$) as (mid agtype, rtype agtype)
            `).then(async (result) => {
                for (const row of result.rows) {
                    const mid = JSON.parse(row.mid);
                    const rtype = JSON.parse(row.rtype);
                    await client.query(`
                        SELECT * FROM cypher('lombardi', $$
                            MATCH (k {id: '${esc(keepId)}'}), (m {id: '${esc(mid)}'})
                            MERGE (k)-[:${rtype}]->(m)
                            RETURN k, m
                        $$) as (k agtype, m agtype)
                    `).catch(() => {});
                }
            }).catch(() => {});

            // 2. Eliminar el nodo viejo (y sus aristas)
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MATCH (n {id: '${esc(removeId)}'})
                    DETACH DELETE n
                $$) as (v agtype)
            `).catch(() => {});

            // 3. Actualizar el nodo que se queda
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MATCH (n {id: '${esc(keepId)}'})
                    SET n.name = '${esc(canonicalName)}', n.type = '${esc(canonicalType)}'
                    RETURN n
                $$) as (v agtype)
            `);

            // 4. Actualizar aliases.json
            const aliasData = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
            const removedAliases = aliasData.entities[removeId]?.aliases || [];
            const removedCanonical = aliasData.entities[removeId]?.canonical || removeId;

            if (!aliasData.entities[keepId]) {
                aliasData.entities[keepId] = { canonical: canonicalName, type: canonicalType, aliases: [] };
            }
            aliasData.entities[keepId].canonical = canonicalName;
            aliasData.entities[keepId].type = canonicalType;
            // Absorber aliases del nodo eliminado
            const allNewAliases = new Set([...aliasData.entities[keepId].aliases, ...removedAliases, removedCanonical, removeId]);
            allNewAliases.delete(keepId);
            allNewAliases.delete(canonicalName);
            aliasData.entities[keepId].aliases = [...allNewAliases];
            delete aliasData.entities[removeId];
            aliasData.updated_at = new Date().toISOString().slice(0, 10);
            fs.writeFileSync(ALIASES_PATH, JSON.stringify(aliasData, null, 2));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, kept: keepId }));
        } finally {
            client.release();
        }
        return;
    }

    // === RANDOM focal node ===
    if (url.pathname === '/api/random') {
        const random = await ageQuery("MATCH (a:Actor) RETURN a.id ORDER BY rand() LIMIT 1").catch(() => []);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: random[0] || null }));
        return;
    }

    // === SEARCH for autocomplete ===
    if (url.pathname === '/api/search') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        if (q.length < 2) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([]));
            return;
        }
        // Search actors and events by name
        const results = await ageQuery(
            `MATCH (n) WHERE toLower(n.name) CONTAINS '${esc(q)}' RETURN n`
        ).catch(() => []);

        const items = results.slice(0, 15).map(r => flat(r));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));
        return;
    }

    // === ENRIQUECER nodo con Wikidata ===
    if (url.pathname === '/api/node/enrich' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { id, name, lang } = body;
        const searchName = name || id;
        const wikiLang = lang || 'es';

        try {
            // 1. Buscar entidad en Wikidata
            const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchName)}&language=${wikiLang}&limit=1&format=json`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();

            if (!searchData.search?.length) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ found: false }));
                return;
            }

            const entity = searchData.search[0];
            const qid = entity.id;

            // 2. Obtener datos completos de la entidad
            const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&languages=${wikiLang},en&props=labels|descriptions|claims&format=json`;
            const entityRes = await fetch(entityUrl);
            const entityData = await entityRes.json();
            const wd = entityData.entities[qid];

            const description = wd.descriptions?.[wikiLang]?.value || wd.descriptions?.en?.value || '';
            const label = wd.labels?.[wikiLang]?.value || wd.labels?.en?.value || searchName;

            // 3. Extraer relaciones clave de los claims
            const PROPERTY_MAP = {
                'P17':  { rel: 'UBICADO_EN',   label: 'país' },
                'P36':  { rel: 'PARTICIPA',    label: 'capital' },
                'P131': { rel: 'UBICADO_EN',   label: 'ubicación administrativa' },
                'P159': { rel: 'UBICADO_EN',   label: 'sede' },
                'P27':  { rel: 'PERTENECE_A',  label: 'ciudadanía' },
                'P39':  { rel: 'PARTICIPA',    label: 'cargo ocupado' },
                'P102': { rel: 'PERTENECE_A',  label: 'partido político' },
                'P108': { rel: 'PERTENECE_A',  label: 'empleador' },
                'P463': { rel: 'PERTENECE_A',  label: 'miembro de' },
                'P530': { rel: 'PARTICIPA',    label: 'relación diplomática' },
                'P37':  { rel: 'PARTICIPA',    label: 'idioma oficial' },
                'P38':  { rel: 'PARTICIPA',    label: 'moneda' },
                'P6':   { rel: 'PARTICIPA',    label: 'jefe de gobierno' },
                'P35':  { rel: 'PARTICIPA',    label: 'jefe de estado' },
                'P150': { rel: 'PARTICIPA',    label: 'subdivisión' },
                'P47':  { rel: 'PARTICIPA',    label: 'frontera con' },
                'P1376': { rel: 'PARTICIPA',   label: 'capital de' }
            };

            // Resolver QIDs de los targets a labels
            const relatedQids = new Set();
            const relations = [];

            for (const [prop, config] of Object.entries(PROPERTY_MAP)) {
                const claims = wd.claims?.[prop] || [];
                for (const claim of claims.slice(0, 3)) { // Max 3 per property
                    const targetQid = claim.mainsnak?.datavalue?.value?.id;
                    if (targetQid) {
                        relatedQids.add(targetQid);
                        relations.push({ prop, ...config, targetQid });
                    }
                }
            }

            // Fetch labels for all related QIDs in batch
            const qidLabels = {};
            if (relatedQids.size > 0) {
                const qids = [...relatedQids].join('|');
                const labelsUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids}&languages=${wikiLang},en&props=labels|descriptions&format=json`;
                const labelsRes = await fetch(labelsUrl);
                const labelsData = await labelsRes.json();

                for (const [qid, data] of Object.entries(labelsData.entities || {})) {
                    qidLabels[qid] = {
                        name: data.labels?.[wikiLang]?.value || data.labels?.en?.value || qid,
                        desc: data.descriptions?.[wikiLang]?.value || data.descriptions?.en?.value || ''
                    };
                }
            }

            // Build enrichment result
            const enrichment = {
                found: true,
                wikidata_id: qid,
                label,
                description,
                relations: relations.map(r => ({
                    relation: r.rel,
                    property_label: r.label,
                    target_id: kebab(qidLabels[r.targetQid]?.name || r.targetQid),
                    target_name: qidLabels[r.targetQid]?.name || r.targetQid,
                    target_desc: qidLabels[r.targetQid]?.desc || ''
                }))
            };

            // 4. Aplicar al grafo si se pidió
            if (body.apply) {
                const client = await pool.connect();
                try {
                    await client.query("LOAD 'age'");
                    await client.query("SET search_path = ag_catalog, public");

                    // Actualizar descripción del nodo
                    await client.query(`
                        SELECT * FROM cypher('lombardi', $$
                            MATCH (n {id: '${esc(id)}'})
                            SET n.description = '${esc(description)}', n.wikidata = '${esc(qid)}'
                            RETURN n
                        $$) as (n agtype)
                    `).catch(() => {});

                    // Crear nodos target y relaciones
                    const VALID_RELS = ['PARTICIPA', 'UBICADO_EN', 'PERTENECE_A'];
                    for (const r of enrichment.relations) {
                        if (!VALID_RELS.includes(r.relation)) continue;

                        // Crear nodo target
                        await client.query(`
                            SELECT * FROM cypher('lombardi', $$
                                MERGE (a:Actor {id: '${esc(r.target_id)}'})
                                SET a.name = '${esc(r.target_name)}', a.description = '${esc(r.target_desc)}'
                                RETURN a
                            $$) as (a agtype)
                        `).catch(() => {});

                        // Crear relación
                        const relQueries = {
                            PARTICIPA:   `MATCH (a {id: '${esc(id)}'}), (b:Actor {id: '${esc(r.target_id)}'}) MERGE (a)-[:PARTICIPA]->(b) RETURN a, b`,
                            UBICADO_EN:  `MATCH (a {id: '${esc(id)}'}), (b:Actor {id: '${esc(r.target_id)}'}) MERGE (a)-[:UBICADO_EN]->(b) RETURN a, b`,
                            PERTENECE_A: `MATCH (a {id: '${esc(id)}'}), (b:Actor {id: '${esc(r.target_id)}'}) MERGE (a)-[:PERTENECE_A]->(b) RETURN a, b`
                        };
                        await client.query(`
                            SELECT * FROM cypher('lombardi', $$ ${relQueries[r.relation]} $$) as (a agtype, b agtype)
                        `).catch(() => {});
                    }
                } finally {
                    client.release();
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(enrichment));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // === UPDATE NODE FIELD ===
    const updateMatch = url.pathname.match(/^\/api\/node\/(.+)\/update$/);
    if (updateMatch && req.method === 'POST') {
        const nodeId = decodeURIComponent(updateMatch[1]);
        const body = JSON.parse(await readBody(req));
        // Build SET clauses for each field
        const setClauses = [];
        for (const [key, val] of Object.entries(body)) {
            if (['name', 'description', 'type', 'event_type', 'evidence_quote'].includes(key)) {
                setClauses.push(`n.${key} = '${esc(String(val))}'`);
            }
        }
        if (!setClauses.length) { res.writeHead(400); res.end('{"error":"no valid fields"}'); return; }
        try {
            await ageQuery(`MATCH (n {id: '${esc(nodeId)}'}) SET ${setClauses.join(', ')}`);
            res.writeHead(200, JSON_H);
            res.end(JSON.stringify({ ok: true, updated: nodeId }));
        } catch (e) {
            res.writeHead(500, JSON_H);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // === DELETE NODE ===
    // === DISCOVER latent relationships ===
    if (url.pathname === '/api/node/discover' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { id } = body;
        if (!id) { res.writeHead(400); res.end('{"error":"id required"}'); return; }

        // SSE for progress
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        const _discoverStart = Date.now();
        const _discoverLog = [];
        function log(msg) {
            const elapsed = ((Date.now() - _discoverStart) / 1000).toFixed(1);
            const line = `[Discover ${id}] ${elapsed}s — ${msg}`;
            _discoverLog.push(line);
            console.log(line);
        }
        function emit(type, data) {
            if (type === 'discovered') {
                const target = data.targetNode?.name || data.edge?.target || '?';
                const edgeType = data.edge?.type || '?';
                const reason = data.reason || '';
                log(`+ ${edgeType} → ${target} (${reason})`);
            } else if (type === 'status') {
                log(data.message);
            } else if (type === 'error') {
                log(`ERROR: ${data.message}`);
            }
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }

        try {
            // 1. Get the focal node
            const focalNodes = await ageQuery(`MATCH (n {id: '${esc(id)}'}) RETURN n`);
            if (!focalNodes.length) {
                emit('error', { message: 'Nodo no encontrado' });
                res.end(); return;
            }
            const focal = focalNodes[0];
            emit('status', { message: `Analizando ${focal.name || id}...` });

            // 2. Get current neighbors (already connected)
            const neighbors = await ageQuery2(
                `MATCH (n {id: '${esc(id)}'})-[r]-(m) RETURN m, r`, ['m', 'r']
            );
            const connectedIds = new Set(neighbors.map(n => n.m.id));
            connectedIds.add(id);

            // 3. NEWS-BASED DISCOVERY — re-extract from related articles
            // Find news that mention this node (by event source_url or text match)
            emit('status', { message: 'Buscando noticias relacionadas...' });

            // Collect source_urls from events connected to this actor
            const eventUrls = [];
            if (!focal.event_type) {
                // Actor: get its events' source_urls
                const events = await ageQuery(`
                    MATCH (a {id: '${esc(id)}'})-[:PARTICIPA]->(e:Evento)
                    RETURN e
                `).catch(() => []) || [];
                events.forEach(e => { if (e.source_url) eventUrls.push(e.source_url); });
            } else {
                // Evento: use its own source_url
                if (focal.source_url) eventUrls.push(focal.source_url);
            }

            // Also search news_raw by name/aliases in title+description
            const aliasDataForSearch = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
            const focalEntrySearch = aliasDataForSearch.entities[id];
            const searchTerms = focalEntrySearch
                ? [focalEntrySearch.canonical, ...(focalEntrySearch.aliases || [])]
                : [focal.name || id.replace(/-/g, ' ')];
            const searchPattern = searchTerms.map(t => t.replace(/'/g, "''")).join('|');

            let relatedNews = [];
            try {
                const newsResult = await pool.query(`
                    SELECT id, source_name, source_lang, title, link, description, pub_date
                    FROM news_raw
                    WHERE (title ~* $1 OR description ~* $1)
                    ORDER BY pub_date DESC LIMIT 20
                `, [searchPattern]);
                relatedNews = newsResult.rows;
                log(`SQL búsqueda con patrón: ${searchPattern.slice(0, 80)}`);
            } catch (err) {
                log(`ERROR buscando en news_raw: ${err.message}`);
            }

            // Add news found by event source_urls (dedup by link)
            const seenLinks = new Set(relatedNews.map(n => n.link));
            for (const url of eventUrls) {
                if (seenLinks.has(url)) continue;
                try {
                    const r = await pool.query('SELECT * FROM news_raw WHERE link = $1', [url]);
                    if (r.rows.length) { relatedNews.push(r.rows[0]); seenLinks.add(url); }
                } catch {}
            }

            emit('status', { message: `${relatedNews.length} noticias encontradas` });

            // Re-extract each news article with focal context
            if (relatedNews.length > 0) {
                const { extractFromNewsFast, extractFromNews } = require('./extractor.js');
                let newsProcessed = 0;

                for (const newsItem of relatedNews.slice(0, 15)) {
                    newsProcessed++;
                    emit('status', { message: `Extrayendo ${newsProcessed}/${Math.min(relatedNews.length, 15)}: ${(newsItem.title || '').slice(0, 50)}...` });

                    let extraction;
                    try {
                        extraction = await extractFromNewsFast(newsItem).catch(e => {
                            log(`  Claude API falló: ${e.message}`);
                            return null;
                        });
                        if (!extraction) {
                            extraction = await extractFromNews(newsItem).catch(e => {
                                log(`  Ollama falló: ${e.message}`);
                                return null;
                            });
                        }
                    } catch (e) { log(`  Extracción falló: ${e.message}`); continue; }
                    if (!extraction?.event) { log(`  Sin evento extraído de: ${(newsItem.title || '').slice(0, 50)}`); continue; }

                    const evt = extraction.event;

                    // Create/merge Evento node — fallback to pub_date if no extracted date
                    const evtDate = evt.date || newsItem.pub_date || '';
                    const evtDateMatch = evtDate.match(/(\d{4}-\d{2}-\d{2})/);
                    const evtNormDate = evtDateMatch ? evtDateMatch[1] : evtDate.slice(0, 10);
                    await ageQuery(`
                        MERGE (e:Evento {id: '${esc(evt.id)}'})
                        SET e.name = '${esc(evt.name)}',
                            e.event_type = '${esc(evt.event_type)}',
                            e.date = '${esc(evtNormDate)}',
                            e.is_disputed = ${evt.is_disputed || false},
                            e.evidence_quote = '${esc(evt.evidence_quote || '')}',
                            e.source = '${esc(newsItem.source_name || '')}',
                            e.source_url = '${esc(newsItem.link || '')}',
                            e.extraction_confidence = ${parseFloat(evt.extraction_confidence) || 0}
                        RETURN e
                    `).catch(() => {});

                    // Create actors + PARTICIPA edges + identify locations
                    for (const actor of (extraction.actors || [])) {
                        await ageQuery(`
                            MERGE (a:Actor {id: '${esc(actor.id)}'})
                            SET a.name = '${esc(actor.name)}',
                                a.type = '${esc(actor.type)}',
                                a.description = '${esc(actor.description || '')}'
                            RETURN a
                        `).catch(() => {});

                        await ageQuery(`
                            MATCH (a:Actor {id: '${esc(actor.id)}'}), (e:Evento {id: '${esc(evt.id)}'})
                            MERGE (a)-[r:PARTICIPA]->(e)
                            SET r.role = '${esc(actor.role || '')}',
                                r.impact_direction = '${esc(actor.impact_direction || 'neutral')}'
                            RETURN r
                        `).catch(() => {});

                        // Track new nodes for the frontend
                        if (!connectedIds.has(actor.id)) {
                            connectedIds.add(actor.id);
                            emit('discovered', {
                                edge: { source: actor.id, target: evt.id, type: 'PARTICIPA', role: actor.role || '' },
                                targetNode: { id: actor.id, name: actor.name, type: actor.type, label: 'Actor' },
                                reason: `extraído de noticia: ${(newsItem.title || '').slice(0, 40)}`
                            });
                        }
                    }

                    // Actor-actor relations (PERTENECE_A, UBICADO_EN)
                    const VALID_RELS = { PERTENECE_A: true, UBICADO_EN: true };
                    for (const rel of (extraction.actor_relations || [])) {
                        const relType = String(rel.relation || '').toUpperCase().replace(/[^A-Z_]/g, '');
                        if (!VALID_RELS[relType]) continue;
                        await ageQuery(`
                            MATCH (a:Actor {id: '${esc(rel.source)}'}), (b:Actor {id: '${esc(rel.target)}'})
                            MERGE (a)-[:${relType}]->(b)
                            RETURN a, b
                        `).catch(() => {});
                    }

                    // Ensure focal node is linked to this event
                    if (!focal.event_type) {
                        // Focal is Actor — check if extraction mentions it, otherwise link contextually
                        const mentionsFocal = (extraction.actors || []).some(a =>
                            a.id === id || a.name?.toLowerCase() === focal.name?.toLowerCase()
                        );
                        if (!mentionsFocal) {
                            await ageQuery(`
                                MATCH (a {id: '${esc(id)}'}), (e:Evento {id: '${esc(evt.id)}'})
                                MERGE (a)-[r:PARTICIPA]->(e)
                                SET r.role = 'mencionado en contexto'
                                RETURN r
                            `).catch(() => {});
                        }
                    }

                    // Track event as discovered
                    if (!connectedIds.has(evt.id)) {
                        connectedIds.add(evt.id);
                        emit('discovered', {
                            edge: { source: id, target: evt.id, type: 'PARTICIPA', role: 'contexto' },
                            targetNode: { id: evt.id, name: evt.name, type: evt.event_type, label: 'Evento' },
                            reason: `evento extraído de ${newsItem.source_name || 'noticia'}`
                        });
                    }
                }

                emit('status', { message: `${newsProcessed} noticias procesadas, actualizando grafo...` });
            }

            // 4. Get ALL nodes in the graph not connected to focal (refresh after news extraction)
            const allNodes = await ageQuery(`MATCH (n) WHERE n.id <> '${esc(id)}' RETURN n`);
            const unconnected = allNodes.filter(n => !connectedIds.has(n.id));

            emit('status', { message: `${connectedIds.size - 1} conexiones actuales, ${unconnected.length} nodos sin vínculo directo` });

            // 5. Alias-based discovery — find synonym matches
            const aliasData = aliasDataForSearch;
            const focalEntry = aliasData.entities[id];
            const focalNames = focalEntry
                ? [focalEntry.canonical, ...(focalEntry.aliases || [])].map(s => s.toLowerCase())
                : [focal.name?.toLowerCase(), id.replace(/-/g, ' ')].filter(Boolean);

            const aliasMatches = [];
            for (const node of unconnected) {
                const nodeEntry = aliasData.entities[node.id];
                const nodeNames = nodeEntry
                    ? [nodeEntry.canonical, ...(nodeEntry.aliases || [])].map(s => s.toLowerCase())
                    : [node.name?.toLowerCase(), String(node.id).replace(/-/g, ' ')].filter(Boolean);

                if (focalNames.some(fn => nodeNames.includes(fn)) || nodeNames.some(nn => focalNames.includes(nn))) {
                    aliasMatches.push(node);
                }
            }

            // Create edges for alias matches (these are the same entity or direct synonyms)
            for (const match of aliasMatches) {
                const focalLabel = focal.label || (focal.event_type ? 'Evento' : 'Actor');
                const matchLabel = match.label || (match.event_type ? 'Evento' : 'Actor');
                // If same label type, they might be duplicates — suggest merge via COMPLEMENTA
                const relType = focalLabel === matchLabel ? 'COMPLEMENTA' : 'PARTICIPA';
                await ageQuery(`
                    MATCH (a {id: '${esc(id)}'}), (b {id: '${esc(match.id)}'})
                    MERGE (a)-[r:${relType}]->(b)
                    SET r.role = 'sinónimo detectado'
                    RETURN r
                `).catch(() => {});
                emit('discovered', {
                    edge: { source: id, target: match.id, type: relType, role: 'sinónimo detectado' },
                    targetNode: match,
                    reason: 'alias match'
                });
            }

            if (aliasMatches.length) {
                emit('status', { message: `${aliasMatches.length} sinónimos vinculados` });
            }

            // 6. Co-occurrence: find nodes that share events with focal's events
            let cooccurrence = [];
            if (focal.label === 'Actor' || !focal.event_type) {
                const shared = await ageQuery2(`
                    MATCH (a {id: '${esc(id)}'})-[:PARTICIPA]->(e:Evento)<-[:PARTICIPA]-(b)
                    WHERE b.id <> '${esc(id)}'
                    RETURN DISTINCT b, count(e) as cnt
                `, ['b', 'cnt']).catch(() => []) || [];

                cooccurrence = shared.filter(s => !connectedIds.has(s.b.id) && s.cnt >= 1);

                // Auto-link co-occurrences (share at least 1 event but no direct edge)
                for (const co of cooccurrence) {
                    await ageQuery(`
                        MATCH (a {id: '${esc(id)}'}), (b {id: '${esc(co.b.id)}'})
                        MERGE (a)-[r:COMPLEMENTA]->(b)
                        SET r.role = 'co-ocurrencia en ${co.cnt} eventos'
                        RETURN r
                    `).catch(() => {});
                    emit('discovered', {
                        edge: { source: id, target: co.b.id, type: 'COMPLEMENTA', role: `co-ocurrencia en ${co.cnt} eventos` },
                        targetNode: co.b,
                        reason: `${co.cnt} eventos compartidos`
                    });
                }
                if (cooccurrence.length) {
                    emit('status', { message: `${cooccurrence.length} co-ocurrencias vinculadas` });
                }
            }

            // 7. LLM-based discovery — ask Claude for semantic relationships
            const apiKey = process.env.CLAUDE_API_KEY;
            let llmDiscovered = [];

            if (apiKey && unconnected.length > 0) {
                emit('status', { message: 'Buscando relaciones semánticas con IA...' });

                // Build context: focal + its neighbors + a sample of unconnected nodes
                const candidateNodes = [
                    ...cooccurrence.map(c => c.b),
                    ...unconnected.filter(n => n.label === 'Actor' || n.event_type).slice(0, 30)
                ];
                // Deduplicate
                const seen = new Set();
                const uniqueCandidates = candidateNodes.filter(n => {
                    if (seen.has(n.id)) return false;
                    if (connectedIds.has(n.id)) return false;
                    seen.add(n.id);
                    return true;
                }).slice(0, 40);

                if (uniqueCandidates.length > 0) {
                    const focalDesc = `${focal.name} (${focal.type || focal.event_type || 'Actor'}): ${focal.description || ''}`;
                    const neighborsDesc = neighbors.slice(0, 10).map(n =>
                        `  - ${n.m.name} (${n.m.type || n.m.event_type || '?'}) [${n.r.label || '?'}]`
                    ).join('\n');
                    const candidatesDesc = uniqueCandidates.map(n =>
                        `  - id:"${n.id}" name:"${n.name}" type:${n.type || n.event_type || '?'} desc:"${n.description || ''}"`
                    ).join('\n');

                    const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/schema.json'), 'utf-8'));
                    const edgeTypes = Object.keys(SCHEMA.graph?.edges || {}).join(', ');

                    const prompt = `You are an ontological analyst for Lombardi, a geopolitical knowledge graph.

FOCAL NODE: ${focalDesc}
CURRENT CONNECTIONS:
${neighborsDesc || '  (none)'}

CANDIDATE NODES (not yet connected to focal):
${candidatesDesc}

EDGE TYPES available: ${edgeTypes}

TASK: Identify which candidates SHOULD be connected to the focal node and WHY.
Only propose relationships that are factually grounded (not speculative).
For each, specify the edge type and direction.

Respond with ONLY valid JSON array:
[{"source":"source-id","target":"target-id","type":"EDGE_TYPE","role":"brief reason in Spanish"}]

If no relationships are warranted, return [].`;

                    try {
                        const llmRes = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-api-key': apiKey,
                                'anthropic-version': '2023-06-01'
                            },
                            signal: AbortSignal.timeout(60000),
                            body: JSON.stringify({
                                model: 'claude-haiku-4-5-20251001',
                                max_tokens: 2048,
                                messages: [{ role: 'user', content: prompt }]
                            })
                        });
                        const llmData = await llmRes.json();
                        const text = (llmData.content?.[0]?.text || '').trim();
                        const jsonMatch = text.match(/\[[\s\S]*\]/);
                        if (jsonMatch) {
                            llmDiscovered = JSON.parse(jsonMatch[0]);
                        }
                    } catch (err) {
                        emit('status', { message: `LLM: ${err.message}` });
                    }
                }
            }

            // 8. Generative LLM phase — propose NEW entities not yet in the graph
            let generatedNodes = [];
            if (apiKey) {
                emit('status', { message: 'Buscando entidades conocidas no representadas...' });

                const currentConnNames = neighbors.slice(0, 15).map(n => n.m.name).filter(Boolean).join(', ');
                const genPrompt = `You are an ontological analyst for a geopolitical knowledge graph.

FOCAL NODE: ${focal.name} (${focal.type || focal.event_type || focal.label || 'Actor'}): ${focal.description || ''}
ALREADY CONNECTED TO: ${currentConnNames || '(none)'}

TASK: What well-known real-world entities should be connected to "${focal.name}" but are likely NOT yet in the graph?
Only propose entities that are clearly, factually related (member organizations, key people, subsidiaries, geographic locations, parent entities).
Do NOT propose entities already listed in ALREADY CONNECTED TO.

For each entity provide:
- id: kebab-case identifier (e.g. "openai", "sam-altman")
- name: proper name
- type: Person | Organization | Location
- description: one-line description in Spanish
- relation: PERTENECE_A | UBICADO_EN | PARTICIPA | COMPLEMENTA
- role: brief reason in Spanish (e.g. "empresa miembro", "fundador")
- direction: "focal->target" or "target->focal"

Return ONLY a valid JSON array. Max 10 entities. If none are warranted, return [].`;

                try {
                    const genRes = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': apiKey,
                            'anthropic-version': '2023-06-01'
                        },
                        signal: AbortSignal.timeout(60000),
                        body: JSON.stringify({
                            model: 'claude-haiku-4-5-20251001',
                            max_tokens: 2048,
                            messages: [{ role: 'user', content: genPrompt }]
                        })
                    });
                    const genData = await genRes.json();
                    const genText = (genData.content?.[0]?.text || '').trim();
                    const genMatch = genText.match(/\[[\s\S]*\]/);
                    if (genMatch) {
                        generatedNodes = JSON.parse(genMatch[0]);
                    }
                } catch (err) {
                    emit('status', { message: `Generative LLM: ${err.message}` });
                }

                // Create new nodes and edges
                const validTypes = ['PARTICIPA', 'CAUSA', 'CONTRADICE', 'COMPLEMENTA', 'DESMIENTE', 'ACTUALIZA', 'UBICADO_EN', 'PERTENECE_A'];
                for (const ent of generatedNodes) {
                    if (!ent.id || !ent.name || !ent.relation) continue;
                    if (!validTypes.includes(ent.relation)) continue;
                    // Skip if already connected
                    if (connectedIds.has(ent.id)) continue;

                    // Create the new Actor node
                    await ageQuery(`
                        MERGE (a:Actor {id: '${esc(ent.id)}'})
                        SET a.name = '${esc(ent.name)}',
                            a.type = '${esc(ent.type || 'Organization')}',
                            a.description = '${esc(ent.description || '')}'
                        RETURN a
                    `).catch(() => {});

                    // Create the edge (respecting direction)
                    const isReverse = ent.direction === 'target->focal' || ent.direction === 'target→focal';
                    const src = isReverse ? ent.id : id;
                    const tgt = isReverse ? id : ent.id;
                    await ageQuery(`
                        MATCH (a {id: '${esc(src)}'}), (b {id: '${esc(tgt)}'})
                        MERGE (a)-[r:${ent.relation}]->(b)
                        SET r.role = '${esc(ent.role || '')}'
                        RETURN r
                    `).catch(() => {});

                    emit('discovered', {
                        edge: { source: src, target: tgt, type: ent.relation, role: ent.role || '' },
                        targetNode: { id: ent.id, name: ent.name, type: ent.type, label: 'Actor' },
                        reason: `generado: ${ent.role || ent.description || ''}`
                    });
                }
            }

            // 9. Write LLM-discovered edges to graph (existing nodes)
            let created = 0;
            for (const rel of llmDiscovered) {
                if (!rel.source || !rel.target || !rel.type) continue;
                // Validate edge type
                const validTypes = ['PARTICIPA', 'CAUSA', 'CONTRADICE', 'COMPLEMENTA', 'DESMIENTE', 'ACTUALIZA', 'UBICADO_EN', 'PERTENECE_A'];
                if (!validTypes.includes(rel.type)) continue;

                await ageQuery(`
                    MATCH (a {id: '${esc(rel.source)}'}), (b {id: '${esc(rel.target)}'})
                    MERGE (a)-[r:${rel.type}]->(b)
                    SET r.role = '${esc(rel.role || '')}'
                    RETURN r
                `).catch(() => {});

                // Find the target node data for the frontend
                const targetNode = unconnected.find(n => n.id === rel.target) || allNodes.find(n => n.id === rel.target);
                emit('discovered', {
                    edge: rel,
                    targetNode: targetNode || { id: rel.target, name: rel.target },
                    reason: rel.role
                });
                created++;
            }

            emit('done', {
                aliasMatches: aliasMatches.length,
                cooccurrences: cooccurrence.length,
                llmDiscovered: created,
                generated: generatedNodes.length,
                total: aliasMatches.length + created + generatedNodes.length
            });
        } catch (err) {
            emit('error', { message: err.message });
        }
        res.end();
        return;
    }

    // --- Manual edge creation ---
    if (url.pathname === '/api/edge/create' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { source, target, type, role, impact_direction, contradiction_type, tension_score } = body;
        if (!source || !target || !type) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end('{"error":"source, target, and type required"}');
            return;
        }
        const validTypes = ['PARTICIPA', 'CAUSA', 'CONTRADICE', 'COMPLEMENTA', 'DESMIENTE', 'ACTUALIZA', 'UBICADO_EN', 'PERTENECE_A'];
        if (!validTypes.includes(type)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(`{"error":"Invalid edge type. Valid: ${validTypes.join(', ')}"}`);
            return;
        }
        try {
            const setParts = [];
            if (role) setParts.push(`r.role = '${esc(role)}'`);
            if (impact_direction) setParts.push(`r.impact_direction = '${esc(impact_direction)}'`);
            if (contradiction_type) setParts.push(`r.contradiction_type = '${esc(contradiction_type)}'`);
            if (tension_score != null) setParts.push(`r.tension_score = ${parseFloat(tension_score) || 0}`);
            const setClause = setParts.length ? `SET ${setParts.join(', ')}` : '';
            await ageQuery(`
                MATCH (a {id: '${esc(source)}'}), (b {id: '${esc(target)}'})
                MERGE (a)-[r:${type}]->(b)
                ${setClause}
                RETURN r
            `);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, source, target, type, role: role || '' }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (url.pathname === '/api/node/delete' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { id } = body;
        if (!id) { res.writeHead(400); res.end('{"error":"id required"}'); return; }

        await ageQuery(`MATCH (n {id: '${esc(id)}'}) DETACH DELETE n`).catch(() => {});

        // Also remove from aliases
        const aliasData = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
        delete aliasData.entities[id];
        aliasData.updated_at = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(ALIASES_PATH, JSON.stringify(aliasData, null, 2));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted: id }));
        return;
    }

    // === BUSCAR NOTICIAS en corpus y procesar ===
    if (url.pathname === '/api/ingest/search' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const keywords = (body.keywords || []).map(k => k.toLowerCase());
        if (!keywords.length) {
            res.writeHead(400); res.end('{"error":"keywords required"}'); return;
        }

        const RAW_DIR = path.join(__dirname, '../data/raw_news');
        const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.endsWith('.extraction.json'));

        const matches = [];
        for (const file of files) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf-8'));
                const text = `${content.title || ''} ${content.description || ''}`.toLowerCase();
                if (keywords.some(k => text.includes(k))) {
                    matches.push({ file, title: content.title, source: content.source_name, pub_date: content.pub_date });
                }
            } catch {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total_pending: files.length, matches: matches.slice(0, 50) }));
        return;
    }

    // === PROCESAR noticias específicas (por archivo) ===
    if (url.pathname === '/api/ingest/process' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const filenames = body.files || [];
        if (!filenames.length) {
            res.writeHead(400); res.end('{"error":"files required"}'); return;
        }

        // Spawn ingest for specific files in background
        const RAW_DIR = path.join(__dirname, '../data/raw_news');
        const { spawn } = require('child_process');

        // Write a temp file with the list of files to process
        const listPath = path.join(__dirname, '../data/.process_queue.json');
        fs.writeFileSync(listPath, JSON.stringify(filenames));

        // Respond immediately, processing happens async
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ queued: filenames.length }));

        // Process in background
        (async () => {
            const { Pool: PgPool } = require('pg');
            const ingestPool = new PgPool({
                host: 'localhost', port: 5432, database: 'lombardi',
                user: 'os_admin', password: 'lombardi_pass'
            });

            for (const filename of filenames) {
                const filePath = path.join(RAW_DIR, filename);
                if (!fs.existsSync(filePath)) continue;

                try {
                    const newsItem = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    const extractionPath = filePath.replace('.json', '.extraction.json');

                    let extraction;
                    if (fs.existsSync(extractionPath)) {
                        extraction = JSON.parse(fs.readFileSync(extractionPath, 'utf-8'));
                    } else {
                        // Call Ollama
                        const ollamaRes = await fetch('http://localhost:11434/api/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            signal: AbortSignal.timeout(120000),
                            body: JSON.stringify({
                                model: 'llama3.1',
                                prompt: newsItem.title + '\n' + newsItem.description,
                                stream: false,
                                options: { temperature: 0.1 }
                            })
                        });
                        const data = await ollamaRes.json();
                        const jsonMatch = data.response?.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            extraction = JSON.parse(jsonMatch[0]);
                            fs.writeFileSync(extractionPath, JSON.stringify(extraction, null, 2));
                        }
                    }

                    if (extraction) {
                        console.log(`[API Ingest] Processed: ${filename}`);
                    }
                } catch (err) {
                    console.error(`[API Ingest] Error ${filename}: ${err.message}`);
                }
            }
            ingestPool.end();
        })();
        return;
    }

    // === FETCH nuevos RSS ===
    if (url.pathname === '/api/ingest/fetch' && req.method === 'POST') {
        const { execFile } = require('child_process');
        execFile('node', [path.join(__dirname, 'rss_fetcher.js')], (err, stdout, stderr) => {
            if (err) console.error('[RSS Fetch]', stderr);
            else console.log('[RSS Fetch]', stdout);
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Fetching RSS feeds in background' }));
        return;
    }

    // === INGEST LOG STREAM (SSE) ===
    if (url.pathname === '/api/ingest/log') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const LOG_PATH = '/tmp/os_ingest.log';
        let lastSize = 0;

        // Send existing tail
        try {
            const stat = fs.statSync(LOG_PATH);
            lastSize = Math.max(0, stat.size - 4000); // last 4KB
            const fd = fs.openSync(LOG_PATH, 'r');
            const buf = Buffer.alloc(stat.size - lastSize);
            fs.readSync(fd, buf, 0, buf.length, lastSize);
            fs.closeSync(fd);
            lastSize = stat.size;
            const lines = buf.toString('utf-8').split('\n').filter(Boolean);
            lines.forEach(line => {
                res.write(`data: ${JSON.stringify({ line })}\n\n`);
            });
        } catch {}

        // Watch for new lines
        const interval = setInterval(() => {
            try {
                const stat = fs.statSync(LOG_PATH);
                if (stat.size > lastSize) {
                    const fd = fs.openSync(LOG_PATH, 'r');
                    const buf = Buffer.alloc(stat.size - lastSize);
                    fs.readSync(fd, buf, 0, buf.length, lastSize);
                    fs.closeSync(fd);
                    lastSize = stat.size;
                    const lines = buf.toString('utf-8').split('\n').filter(Boolean);
                    lines.forEach(line => {
                        res.write(`data: ${JSON.stringify({ line })}\n\n`);
                    });
                }
            } catch {}
        }, 1000);

        req.on('close', () => clearInterval(interval));
        return;
    }

    // === INGEST STATUS ===
    if (url.pathname === '/api/ingest/status') {
        const RAW_DIR = path.join(__dirname, '../data/raw_news');
        const PROCESSED_DIR = path.join(RAW_DIR, '.processed');
        const pending = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.endsWith('.extraction.json')).length;
        const processed = fs.existsSync(PROCESSED_DIR) ? fs.readdirSync(PROCESSED_DIR).filter(f => f.endsWith('.json')).length : 0;
        const extractions = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.extraction.json')).length;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pending, processed, extractions }));
        return;
    }

    // === NEWS FEED (all news with processing status) ===
    if (url.pathname === '/api/news/feed') {
        const page = parseInt(url.searchParams.get('page') || '0');
        const sort = url.searchParams.get('sort') || 'date';
        const limit = 30;
        const offset = page * limit;

        const client = await pool.connect();
        try {
            // Sort: date (most recent) or relevance (processed first, then by connections)
            const orderClause = sort === 'relevance'
                ? 'ORDER BY processed DESC, ingested_at DESC NULLS LAST'
                : 'ORDER BY pub_date DESC NULLS LAST';

            const result = await client.query(
                `SELECT * FROM public.news_raw ${orderClause} LIMIT $1 OFFSET $2`,
                [limit, offset]
            );
            const total = await client.query('SELECT count(*) FROM public.news_raw');

            // Check which have Evento nodes in graph (v2: match by source_url)
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");

            const items = [];
            for (const row of result.rows) {
                const linkEsc = esc(row.link || '');
                const evtResult = await client.query(`
                    SELECT * FROM cypher('lombardi', $$
                        MATCH (e:Evento {source_url: '${linkEsc}'})
                        OPTIONAL MATCH (a:Actor)-[:PARTICIPA]->(e)
                        RETURN e.name, count(a)
                    $$) as (ename agtype, acnt agtype)
                `).catch(() => ({ rows: [] }));

                const inGraph = evtResult.rows.length > 0;
                const evtName = inGraph ? JSON.parse(evtResult.rows[0]?.ename || 'null') : null;
                const actorCount = inGraph ? parseInt(JSON.parse(evtResult.rows[0]?.acnt || '0')) : 0;

                items.push({
                    ...row,
                    _inGraph: inGraph,
                    _eventName: evtName,
                    _actorCount: actorCount
                });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                items,
                total: parseInt(total.rows[0].count),
                page, limit
            }));
        } finally {
            client.release();
        }
        return;
    }

    // === NEWS PROCESS + EGO (process a news item on demand, return its graph) ===
    // === PROCESS NEWS — SSE streaming: emits nodes as they are created ===
    if (url.pathname === '/api/news/process' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { link, title, source, description, contextNodeId } = body;
        if (!link && !title) { res.writeHead(400); res.end('{"error":"link or title required"}'); return; }

        // Setup SSE
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        function emit(type, data) {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }

        const RAW_DIR = path.join(__dirname, '../data/raw_news');
        const PROC_DIR = path.join(RAW_DIR, '.processed');

        // Find the raw file by link or build a newsItem from params
        let newsItem = null;
        let extractionData = null;

        if (link) {
            const allFiles = [...fs.readdirSync(RAW_DIR), ...(fs.existsSync(PROC_DIR) ? fs.readdirSync(PROC_DIR).map(f => '.processed/' + f) : [])];
            for (const file of allFiles) {
                if (!file.endsWith('.json') || file.endsWith('.extraction.json')) continue;
                try {
                    const fullPath = path.join(RAW_DIR, file);
                    const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                    if (content.link === link) {
                        newsItem = content;
                        const extPath = fullPath.replace('.json', '.extraction.json');
                        if (fs.existsSync(extPath)) {
                            extractionData = JSON.parse(fs.readFileSync(extPath, 'utf-8'));
                        }
                        break;
                    }
                } catch {}
            }
        }

        // If not found in raw_news, build from params (web search results)
        if (!newsItem) {
            newsItem = { title: title || '', link: link || '', source_name: source || 'Web', description: description || '', source_lang: 'multi' };
        }

        emit('status', { message: 'Extrayendo con Claude...' });

        // Extract if needed
        if (!extractionData) {
            try {
                const { extractFromNewsFast, extractFromNews } = require('./extractor.js');
                try {
                    extractionData = await extractFromNewsFast(newsItem);
                } catch (fastErr) {
                    emit('status', { message: 'Claude falló, usando Ollama...' });
                    extractionData = await extractFromNews(newsItem);
                }
            } catch (err) {
                emit('error', { message: err.message });
                res.end();
                return;
            }
        }

        if (!extractionData?.event) {
            emit('error', { message: 'No se pudo extraer evento' });
            res.end();
            return;
        }

        // Write to graph, emitting each node as it's created
        const client = await pool.connect();
        try {
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");

            const evt = extractionData.event;
            const actors = extractionData.actors || [];
            const relations = extractionData.actor_relations || [];

            // 1. Create Evento — emit immediately
            await client.query(`
                SELECT * FROM cypher('lombardi', $$
                    MERGE (e:Evento {id: '${esc(evt.id)}'})
                    SET e.name = '${esc(evt.name)}', e.event_type = '${esc(evt.event_type)}',
                        e.date = '${esc(evt.date || '')}', e.source = '${esc(newsItem.source_name)}',
                        e.source_url = '${esc(newsItem.link)}',
                        e.evidence_quote = '${esc(evt.evidence_quote || '')}'
                    RETURN e
                $$) as (e agtype)
            `).catch(() => {});

            const eventNode = { ...evt, label: 'Evento', _degree: 0 };
            emit('focal', { node: eventNode });

            // 2. Create each Actor + PARTICIPA — emit one by one
            for (const a of actors) {
                await client.query(`
                    SELECT * FROM cypher('lombardi', $$
                        MERGE (a:Actor {id: '${esc(a.id)}'})
                        SET a.name = '${esc(a.name)}', a.type = '${esc(a.type)}',
                            a.description = '${esc(a.description || '')}'
                        RETURN a
                    $$) as (a agtype)
                `).catch(() => {});

                await client.query(`
                    SELECT * FROM cypher('lombardi', $$
                        MATCH (a:Actor {id: '${esc(a.id)}'}), (e:Evento {id: '${esc(evt.id)}'})
                        MERGE (a)-[r:PARTICIPA]->(e)
                        SET r.role = '${esc(a.role || '')}'
                        RETURN a, e
                    $$) as (a agtype, e agtype)
                `).catch(() => {});

                emit('node', {
                    node: { ...a, label: 'Actor', _degree: 1 },
                    edge: { source: a.id, target: evt.id, type: 'PARTICIPA', role: a.role }
                });
            }

            // 3. Create actor_relations (PERTENECE_A, UBICADO_EN)
            for (const rel of relations) {
                await client.query(`
                    SELECT * FROM cypher('lombardi', $$
                        MATCH (a {id: '${esc(rel.source)}'}), (b {id: '${esc(rel.target)}'})
                        MERGE (a)-[r:${rel.relation || 'PERTENECE_A'}]->(b)
                        RETURN a, b
                    $$) as (a agtype, b agtype)
                `).catch(() => {});

                emit('edge', { edge: { source: rel.source, target: rel.target, type: rel.relation } });
            }

            // 4. Contextual linking — guarantee link to the node the user searched from
            if (contextNodeId) {
                // Check if context node already appears among extracted actors
                const actorIds = actors.map(a => a.id);
                const alreadyLinked = actorIds.includes(contextNodeId);

                if (!alreadyLinked) {
                    // Check aliases: maybe extraction used a different id for the same entity
                    const aliasesPath = require('path').join(__dirname, '../data/aliases.json');
                    let aliasMatch = false;
                    try {
                        const aliasData = JSON.parse(require('fs').readFileSync(aliasesPath, 'utf-8'));
                        // Get all aliases for contextNodeId
                        const contextEntry = aliasData.entities[contextNodeId];
                        if (contextEntry) {
                            const contextNames = [contextEntry.canonical, ...(contextEntry.aliases || [])].map(s => s.toLowerCase());
                            // Check if any extracted actor name matches any alias
                            for (const a of actors) {
                                const names = [a.name, a.id.replace(/-/g, ' ')].map(s => s.toLowerCase());
                                if (names.some(n => contextNames.includes(n)) || contextNames.some(n => names.includes(n))) {
                                    aliasMatch = true;
                                    // Merge: create edge from contextNodeId to event
                                    await client.query(`
                                        SELECT * FROM cypher('lombardi', $$
                                            MATCH (a {id: '${esc(contextNodeId)}'}), (e:Evento {id: '${esc(evt.id)}'})
                                            MERGE (a)-[r:PARTICIPA]->(e)
                                            SET r.role = '${esc(a.role || 'vinculado')}'
                                            RETURN a, e
                                        $$) as (a agtype, e agtype)
                                    `).catch(() => {});
                                    emit('edge', { edge: { source: contextNodeId, target: evt.id, type: 'PARTICIPA', role: a.role || 'vinculado' } });
                                    break;
                                }
                            }
                        }
                    } catch {}

                    // If no alias match, still create the link — the user explicitly searched from this node
                    if (!aliasMatch) {
                        // Verify the context node exists in the graph
                        const exists = await client.query(`
                            SELECT * FROM cypher('lombardi', $$
                                MATCH (n {id: '${esc(contextNodeId)}'}) RETURN n
                            $$) as (n agtype)
                        `).catch(() => ({ rows: [] }));

                        if (exists.rows.length > 0) {
                            await client.query(`
                                SELECT * FROM cypher('lombardi', $$
                                    MATCH (a {id: '${esc(contextNodeId)}'}), (e:Evento {id: '${esc(evt.id)}'})
                                    MERGE (a)-[r:PARTICIPA]->(e)
                                    SET r.role = 'vinculado por búsqueda'
                                    RETURN a, e
                                $$) as (a agtype, e agtype)
                            `).catch(() => {});
                            emit('edge', { edge: { source: contextNodeId, target: evt.id, type: 'PARTICIPA', role: 'vinculado por búsqueda' } });
                            emit('status', { message: `Vinculado a ${contextNodeId}` });
                        }
                    }
                }
            }

            // 5. Save to news_raw SQL
            await client.query(`
                INSERT INTO public.news_raw (source_name, source_lang, source_region, title, link, description, pub_date, processed)
                VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                ON CONFLICT (link) DO UPDATE SET processed = true
            `, [newsItem.source_name, newsItem.source_lang || '', newsItem.source_region || '',
                newsItem.title, newsItem.link, newsItem.description, newsItem.pubDate || newsItem.pub_date || null
            ]).catch(() => {});

            emit('done', { actorCount: actors.length, eventId: evt.id });
        } finally {
            client.release();
        }
        res.end();
        return;
    }

    // === SOURCES (feeds) ===
    if (url.pathname === '/api/sources' && req.method === 'GET') {
        const data = JSON.parse(fs.readFileSync(FEEDS_PATH, 'utf-8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    if (url.pathname === '/api/sources' && req.method === 'PUT') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        fs.writeFileSync(FEEDS_PATH, JSON.stringify(data, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // === TOPICS ===
    if (url.pathname === '/api/topics' && req.method === 'GET') {
        const data = JSON.parse(fs.readFileSync(TOPICS_PATH, 'utf-8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    if (url.pathname === '/api/topics' && req.method === 'PUT') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        data.updated_at = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(TOPICS_PATH, JSON.stringify(data, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // === STATS ===
    if (url.pathname === '/api/stats') {
        const client = await pool.connect();
        try {
            const total = await client.query("SELECT count(*) FROM news_raw");
            const processed = await client.query("SELECT count(*) FROM news_raw WHERE processed = true");
            const sources = await client.query("SELECT DISTINCT source_name FROM news_raw");
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                total: parseInt(total.rows[0].count),
                processed: parseInt(processed.rows[0].count),
                sources: sources.rows.map(r => r.source_name)
            }));
        } finally {
            client.release();
        }
        return;
    }

    // === SCHEMA ===
    if (url.pathname === '/api/schema') {
        const data = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    // === ALIASES ===
    if (url.pathname === '/api/aliases' && req.method === 'GET') {
        const data = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    if (url.pathname === '/api/aliases' && req.method === 'PUT') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        data.updated_at = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(ALIASES_PATH, JSON.stringify(data, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (url.pathname === '/api/aliases/merge' && req.method === 'POST') {
        const body = await readBody(req);
        const { canonicalId, aliasName } = JSON.parse(body);
        const data = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
        if (data.entities[canonicalId]) {
            if (!data.entities[canonicalId].aliases.includes(aliasName)) {
                data.entities[canonicalId].aliases.push(aliasName);
            }
        }
        data.updated_at = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(ALIASES_PATH, JSON.stringify(data, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, entity: data.entities[canonicalId] }));
        return;
    }

    // === BUSCAR NOTICIAS FRESCAS (Google News RSS) ===
    if (url.pathname === '/api/news/search-web' && req.method === 'GET') {
        const q = url.searchParams.get('q');
        const lang = url.searchParams.get('lang') || 'es';
        if (!q) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing q param' }));
            return;
        }

        try {
            const { XMLParser } = require('fast-xml-parser');
            const xmlParser = new XMLParser();
            const gnUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}&gl=${lang.toUpperCase()}&ceid=${lang.toUpperCase()}:${lang}`;
            const response = await fetch(gnUrl);
            const xmlData = await response.text();
            const parsed = xmlParser.parse(xmlData);
            const items = parsed.rss?.channel?.item || [];

            const results = (Array.isArray(items) ? items : [items]).slice(0, 20).map(item => ({
                title: item.title || '',
                link: item.link || '',
                pubDate: item.pubDate || '',
                source: item.source || ''
            }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
        } catch (err) {
            console.error('Google News RSS error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // === INGESTAR noticia desde URL (on-demand) ===
    if (url.pathname === '/api/news/ingest-url' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { title, link, source, pubDate } = body;
        if (!link) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing link' }));
            return;
        }

        // Fetch the article content
        try {
            const articleResp = await fetch(link);
            const html = await articleResp.text();
            // Extract text from HTML (basic: strip tags)
            const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                             .replace(/<[^>]+>/g, ' ')
                             .replace(/\s+/g, ' ')
                             .trim()
                             .slice(0, 3000);

            // Save as raw_news JSON for the normal ingest pipeline
            const RAW_DIR = path.join(__dirname, '../data/raw_news');
            const fileName = `${Date.now()}-web-search.json`;
            const newsItem = {
                source_name: source || 'Web Search',
                source_lang: 'multi',
                title: title || '',
                link: link,
                description: text,
                pubDate: pubDate || new Date().toISOString()
            };
            fs.writeFileSync(path.join(RAW_DIR, fileName), JSON.stringify(newsItem, null, 2));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, file: fileName, message: 'Noticia guardada para procesamiento' }));
        } catch (err) {
            console.error('Ingest URL error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // --- Graph maintenance / pruning ---
    if (url.pathname === '/api/graph/health' && req.method === 'GET') {
        try {
            const client = await pool.connect();
            try {
                await client.query("LOAD 'age'");
                await client.query("SET search_path = ag_catalog, public");

                // Fast queries only — avoid full-graph scans
                const totalR = await client.query("SELECT count(*) FROM lombardi._ag_label_vertex");
                const edgeR = await client.query("SELECT count(*) FROM lombardi._ag_label_edge");
                const noDateR = await client.query(`SELECT count(*) FROM cypher('lombardi', $$ MATCH (e:Evento) WHERE e.date IS NULL OR e.date = '' OR e.date = 'null' RETURN e $$) as (e agtype)`);
                const orphanR = await client.query(`SELECT count(*) FROM cypher('lombardi', $$ MATCH (n) WHERE NOT EXISTS { (n)-[]-() } RETURN n $$) as (n agtype)`);

                // News stats from SQL
                const newsR = await client.query("SELECT count(*) as total FROM news_raw");
                const sourcesR = await client.query("SELECT count(DISTINCT source_name) as n FROM news_raw");

                const health = {
                    total_nodes: parseInt(totalR.rows[0].count),
                    total_edges: parseInt(edgeR.rows[0].count),
                    orphans: parseInt(orphanR.rows[0].count),
                    events_no_date: parseInt(noDateR.rows[0].count),
                    news_total: parseInt(newsR.rows[0].total),
                    news_sources: parseInt(sourcesR.rows[0].n)
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(health));
            } finally {
                client.release();
            }
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (url.pathname === '/api/graph/prune' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const actions = body.actions || ['orphans', 'mistyped'];
        const dryRun = body.dry_run !== false; // default: dry run
        const results = { removed: [], fixed: [], dry_run: dryRun };

        try {
            // 1. Remove orphan nodes (zero edges)
            if (actions.includes('orphans')) {
                const orphans = await ageQuery('MATCH (n) WHERE NOT EXISTS { (n)-[]-() } RETURN n');
                for (const n of orphans) {
                    results.removed.push({ id: n.id, name: n.name, label: n.label, reason: 'orphan' });
                    if (!dryRun) {
                        await ageQuery(`MATCH (n {id: '${esc(n.id)}'}) DELETE n RETURN true`).catch(() => {});
                    }
                }
            }

            // 2. Fix mistyped actors (type=Event/EVENTO → should be Evento label)
            if (actions.includes('mistyped')) {
                const mistyped = await ageQuery("MATCH (a:Actor) WHERE a.type IN ['Event', 'EVENTO', 'Evento'] RETURN a");
                for (const n of mistyped) {
                    results.fixed.push({ id: n.id, name: n.name, reason: 'actor typed as event' });
                    // Can't relabel in AGE, but we can fix the type to a proper Actor type
                    if (!dryRun) {
                        await ageQuery(`
                            MATCH (a:Actor {id: '${esc(n.id)}'})
                            SET a.type = 'Organization'
                            RETURN a
                        `).catch(() => {});
                    }
                }
            }

            // 3. Remove leaf events with no content (degree 1, no description, no evidence)
            if (actions.includes('thin_events')) {
                const thinEvents = await ageQuery(`
                    MATCH (e:Evento)-[r]-()
                    WITH e, count(r) as deg
                    WHERE deg = 1
                        AND (e.evidence_quote IS NULL OR e.evidence_quote = '')
                        AND (e.name IS NULL OR e.name = '' OR e.name = e.id)
                    RETURN e
                `);
                for (const e of thinEvents) {
                    results.removed.push({ id: e.id, name: e.name, label: 'Evento', reason: 'thin event (no content, degree 1)' });
                    if (!dryRun) {
                        await ageQuery(`MATCH (e:Evento {id: '${esc(e.id)}'})-[r]-() DELETE r, e RETURN true`).catch(() => {});
                    }
                }
            }

            // 4. Remove leaf actors with no description and degree 1
            if (actions.includes('thin_actors')) {
                const thinActors = await ageQuery(`
                    MATCH (a:Actor)-[r]-()
                    WITH a, count(r) as deg
                    WHERE deg = 1
                        AND (a.description IS NULL OR a.description = '')
                        AND (a.type IS NULL OR a.type = '')
                    RETURN a
                `);
                for (const a of thinActors) {
                    results.removed.push({ id: a.id, name: a.name, label: 'Actor', reason: 'thin actor (no description/type, degree 1)' });
                    if (!dryRun) {
                        await ageQuery(`MATCH (a:Actor {id: '${esc(a.id)}'})-[r]-() DELETE r, a RETURN true`).catch(() => {});
                    }
                }
            }

            // 5. Merge duplicate nodes (same canonical name)
            if (actions.includes('duplicates')) {
                const aliasData = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
                const canonicalToIds = {};
                for (const [id, entry] of Object.entries(aliasData.entities)) {
                    const c = entry.canonical.toLowerCase();
                    if (!canonicalToIds[c]) canonicalToIds[c] = [];
                    canonicalToIds[c].push(id);
                }
                for (const [canonical, ids] of Object.entries(canonicalToIds)) {
                    if (ids.length < 2) continue;
                    results.fixed.push({ canonical, ids, reason: 'duplicate canonical name' });
                    // Merge: keep the first, redirect edges from the rest
                    if (!dryRun) {
                        const keep = ids[0];
                        for (const dup of ids.slice(1)) {
                            // Re-point edges from dup → keep
                            const edges = await ageQuery2(
                                `MATCH (n {id: '${esc(dup)}'})-[r]-(m) RETURN r, m`, ['r', 'm']
                            ).catch(() => []);
                            for (const e of (edges || [])) {
                                const edgeType = e.r.label;
                                const otherId = e.m.id;
                                if (otherId === keep) continue;
                                await ageQuery(`
                                    MATCH (a {id: '${esc(keep)}'}), (b {id: '${esc(otherId)}'})
                                    MERGE (a)-[:${edgeType}]->(b)
                                    RETURN a
                                `).catch(() => {});
                            }
                            // Delete dup and its edges
                            await ageQuery(`MATCH (n {id: '${esc(dup)}'})-[r]-() DELETE r, n RETURN true`).catch(() => {});
                            await ageQuery(`MATCH (n {id: '${esc(dup)}'}) DELETE n RETURN true`).catch(() => {});
                        }
                    }
                }
            }

            console.log(`[Prune] ${dryRun ? 'DRY RUN' : 'EXECUTED'}: ${results.removed.length} removed, ${results.fixed.length} fixed`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
        } catch (err) {
            console.error('Prune error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.url.startsWith('/api/')) {
        try {
            await handleAPI(req, res);
        } catch (err) {
            console.error('API error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    filePath = path.join(FRONTEND_DIR, filePath);
    const ext = path.extname(filePath);
    try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        res.end(content);
    } catch {
        res.writeHead(404); res.end('Not found');
    }
});

server.listen(PORT, async () => {
    console.log(`OS API: http://localhost:${PORT}`);

    // Backfill: assign dates to events that lack them, using news_raw pub_date
    try {
        const client = await pool.connect();
        await client.query("LOAD 'age'");
        await client.query("SET search_path = ag_catalog, public");
        const undated = await client.query(`
            SELECT * FROM cypher('lombardi', $$
                MATCH (e:Evento) WHERE e.date IS NULL OR e.date = '' OR e.date = 'null'
                RETURN e
            $$) as (e agtype)
        `);
        let fixed = 0;
        for (const row of undated.rows) {
            const evt = parseAgtype(row.e);
            const url = evt.properties?.source_url;
            if (!url) continue;
            const news = await client.query('SELECT pub_date FROM news_raw WHERE link = $1', [url]);
            if (news.rows.length && news.rows[0].pub_date) {
                const pd = news.rows[0].pub_date;
                const m = pd.match(/(\d{4}-\d{2}-\d{2})/);
                const dateStr = m ? m[1] : pd.slice(0, 10);
                if (dateStr && dateStr.length >= 8) {
                    await client.query(`
                        SELECT * FROM cypher('lombardi', $$
                            MATCH (e:Evento {id: '${esc(evt.properties.id)}'})
                            SET e.date = '${esc(dateStr)}'
                            RETURN e
                        $$) as (e agtype)
                    `);
                    fixed++;
                }
            }
        }
        client.release();
        if (fixed) console.log(`OS: Backfill — ${fixed} eventos recibieron fecha desde news_raw.`);
    } catch (err) {
        console.error('Backfill error:', err.message);
    }
});
