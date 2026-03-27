const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = 3000;
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const ALIASES_PATH = path.join(__dirname, '../data/aliases.json');
const SCHEMA_PATH = path.join(__dirname, '../data/schema.json');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'overstanding',
    user: 'os_admin',
    password: 'overstanding_pass'
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
        const res = await client.query(`SELECT * FROM cypher('overstanding', $$ ${cypher} $$) as (v agtype)`);
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
        const res = await client.query(`SELECT * FROM cypher('overstanding', $$ ${cypher} $$) as (${colDef})`);
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

    // === EGOSISTEMA: nodo focal + grado 1 + grado 2 ===
    if (url.pathname === '/api/ego') {
        let focalId = url.searchParams.get('id');

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

        // Grado 1: vecinos directos + aristas
        const g1 = await ageQuery2(
            `MATCH (f {id: '${safeId}'})-[r]-(n1) RETURN n1, r`,
            ['n1', 'r']
        ).catch(() => []);

        const nodesMap = new Map();
        nodesMap.set(focal.id, { ...focal, _degree: 0 });

        const edgesSet = new Set();
        const edges = [];

        function addEdge(r) {
            const props = r.properties || {};
            const key = `${r.start_id}-${r.end_id}-${r.label}`;
            if (edgesSet.has(key)) return;
            edgesSet.add(key);
            // We need to resolve IDs from the nodes we've seen
            edges.push({
                _startAgId: r.start_id,
                _endAgId: r.end_id,
                type: r.label,
                ...props
            });
        }

        for (const row of g1) {
            const n = flat(row.n1);
            if (!nodesMap.has(n.id)) {
                nodesMap.set(n.id, { ...n, _degree: 1 });
            }
            addEdge(row.r);
        }

        // Grado 2: vecinos de los vecinos
        const g1Ids = [...nodesMap.values()].filter(n => n._degree === 1).map(n => esc(n.id));

        if (g1Ids.length > 0) {
            // Batch query for degree 2 — only Actor nodes (filter out Afirmacion/Noticia noise)
            for (const nId of g1Ids.slice(0, 20)) {
                const g2 = await ageQuery2(
                    `MATCH (n1 {id: '${nId}'})-[r]-(n2) WHERE n2.id <> '${safeId}' AND (n2:Actor OR n2:Evento) RETURN n2, r`,
                    ['n2', 'r']
                ).catch(() => []);

                for (const row of g2) {
                    const n2 = flat(row.n2);
                    if (!nodesMap.has(n2.id)) {
                        nodesMap.set(n2.id, { ...n2, _degree: 2 });
                    }
                    addEdge(row.r);
                }
            }
        }

        // Resolve edge source/target from agtype IDs to our property IDs
        // Build agId → propertyId map
        const agIdMap = new Map();
        for (const row of g1) {
            agIdMap.set(row.n1.id, flat(row.n1).id);
        }
        // Also from g2 we need the focal
        agIdMap.set(focalRaw[0].id, focal.id);

        // For degree 2 edges, we need all node agIds
        // Simpler approach: resolve edges by matching source/target in nodesMap
        const resolvedEdges = edges.map(e => {
            const sourceNode = [...nodesMap.values()].find(n => {
                // Match by checking if this node was part of the edge
                return false; // fallback
            });
            return e;
        });

        // Better approach: query edges with property IDs directly
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

    // === NOTICIAS vinculadas a un nodo ===
    if (url.pathname === '/api/news' && url.searchParams.get('id')) {
        const id = esc(url.searchParams.get('id'));

        // Buscar noticias conectadas al nodo via: Noticia-REPORTA->Afirmacion-INVOLUCRA->Actor
        // O directamente si es una Afirmacion o Noticia
        const client = await pool.connect();
        try {
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");

            // Noticias que mencionan a este actor (via afirmaciones)
            const viaActor = await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MATCH (n:Noticia)-[:REPORTA]->(c:Afirmacion)-[:INVOLUCRA]->(a:Actor {id: '${id}'})
                    RETURN {id: n.id, title: n.title, source: n.source, link: n.link, lang: n.lang,
                            claim: c.predicate, subject: c.subject, object: c.object,
                            event_type: c.event_type, is_disputed: c.is_disputed}
                $$) as (v agtype)
            `).catch(() => ({ rows: [] }));

            // Noticias que reportan esta afirmación directamente
            const viaClaim = await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MATCH (n:Noticia)-[:REPORTA]->(c:Afirmacion {id: '${id}'})
                    RETURN {id: n.id, title: n.title, source: n.source, link: n.link, lang: n.lang,
                            claim: c.predicate, subject: c.subject, object: c.object,
                            event_type: c.event_type, is_disputed: c.is_disputed}
                $$) as (v agtype)
            `).catch(() => ({ rows: [] }));

            const allRows = [...viaActor.rows, ...viaClaim.rows];
            const newsItems = allRows.map(r => parseAgtype(r.v));

            // Deduplicar por id de noticia
            const seen = new Map();
            for (const item of newsItems) {
                if (!seen.has(item.id)) seen.set(item.id, item);
            }

            // Enriquecer con pub_date de la tabla SQL
            const newsWithDates = [];
            for (const item of seen.values()) {
                const sqlRow = await client.query(
                    "SELECT pub_date, description FROM news_raw WHERE link = $1 LIMIT 1",
                    [item.link]
                ).catch(() => ({ rows: [] }));

                newsWithDates.push({
                    ...item,
                    pub_date: sqlRow.rows[0]?.pub_date || null,
                    description: sqlRow.rows[0]?.description || null
                });
            }

            // Ordenar por fecha descendente
            newsWithDates.sort((a, b) => {
                const da = a.pub_date ? new Date(a.pub_date) : new Date(0);
                const db = b.pub_date ? new Date(b.pub_date) : new Date(0);
                return db - da;
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(newsWithDates));
        } finally {
            client.release();
        }
        return;
    }

    // === NODE EDIT: cambiar tipo, nombre, descripción ===
    if (url.pathname === '/api/node/update' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { id, name, type, description } = body;
        if (!id) { res.writeHead(400); res.end('{"error":"id required"}'); return; }

        const sets = [];
        if (name !== undefined) sets.push(`n.name = '${esc(name)}'`);
        if (type !== undefined) sets.push(`n.type = '${esc(type)}'`);
        if (description !== undefined) sets.push(`n.description = '${esc(description)}'`);

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
                SELECT * FROM cypher('overstanding', $$
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
                        SELECT * FROM cypher('overstanding', $$
                            MATCH (m {id: '${esc(mid)}'}), (k {id: '${esc(keepId)}'})
                            MERGE (m)-[:${rtype}]->(k)
                            RETURN m, k
                        $$) as (m agtype, k agtype)
                    `).catch(() => {});
                }
            }).catch(() => {});

            // Aristas salientes
            await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MATCH (n {id: '${esc(removeId)}'})-[r]->(m)
                    WHERE m.id <> '${esc(keepId)}'
                    RETURN m.id, type(r)
                $$) as (mid agtype, rtype agtype)
            `).then(async (result) => {
                for (const row of result.rows) {
                    const mid = JSON.parse(row.mid);
                    const rtype = JSON.parse(row.rtype);
                    await client.query(`
                        SELECT * FROM cypher('overstanding', $$
                            MATCH (k {id: '${esc(keepId)}'}), (m {id: '${esc(mid)}'})
                            MERGE (k)-[:${rtype}]->(m)
                            RETURN k, m
                        $$) as (k agtype, m agtype)
                    `).catch(() => {});
                }
            }).catch(() => {});

            // 2. Eliminar el nodo viejo (y sus aristas)
            await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MATCH (n {id: '${esc(removeId)}'})
                    DETACH DELETE n
                $$) as (v agtype)
            `).catch(() => {});

            // 3. Actualizar el nodo que se queda
            await client.query(`
                SELECT * FROM cypher('overstanding', $$
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
                        SELECT * FROM cypher('overstanding', $$
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
                            SELECT * FROM cypher('overstanding', $$
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
                            SELECT * FROM cypher('overstanding', $$ ${relQueries[r.relation]} $$) as (a agtype, b agtype)
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

    // === DELETE NODE ===
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
                host: 'localhost', port: 5432, database: 'overstanding',
                user: 'os_admin', password: 'overstanding_pass'
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
        const limit = 30;
        const offset = page * limit;

        const client = await pool.connect();
        try {
            // Get news from SQL table (most recent first)
            const result = await client.query(
                `SELECT * FROM news_raw ORDER BY pub_date DESC NULLS LAST LIMIT $1 OFFSET $2`,
                [limit, offset]
            );
            const total = await client.query('SELECT count(*) FROM news_raw');

            // Check which have graph nodes
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");

            const items = [];
            for (const row of result.rows) {
                const newsId = Buffer.from(row.link || '').toString('base64').slice(0, 20);
                // Check if noticia node exists in graph
                const inGraph = await client.query(`
                    SELECT * FROM cypher('overstanding', $$
                        MATCH (n:Noticia {id: '${esc(newsId)}'}) RETURN count(n)
                    $$) as (c agtype)
                `).catch(() => ({ rows: [{ c: '0' }] }));

                const claimCount = await client.query(`
                    SELECT * FROM cypher('overstanding', $$
                        MATCH (n:Noticia {id: '${esc(newsId)}'})-[:REPORTA]->(c:Afirmacion) RETURN count(c)
                    $$) as (c agtype)
                `).catch(() => ({ rows: [{ c: '0' }] }));

                items.push({
                    ...row,
                    _newsId: newsId,
                    _inGraph: parseInt(JSON.parse(inGraph.rows[0]?.c || '0')) > 0,
                    _claimCount: parseInt(JSON.parse(claimCount.rows[0]?.c || '0'))
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
    if (url.pathname === '/api/news/process' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const { link } = body;
        if (!link) { res.writeHead(400); res.end('{"error":"link required"}'); return; }

        const RAW_DIR = path.join(__dirname, '../data/raw_news');
        const PROC_DIR = path.join(RAW_DIR, '.processed');

        // Find the raw file by link
        const allFiles = [...fs.readdirSync(RAW_DIR), ...(fs.existsSync(PROC_DIR) ? fs.readdirSync(PROC_DIR).map(f => '.processed/' + f) : [])];
        let newsItem = null;
        let extractionData = null;

        for (const file of allFiles) {
            if (!file.endsWith('.json') || file.endsWith('.extraction.json')) continue;
            try {
                const fullPath = path.join(RAW_DIR, file);
                const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                if (content.link === link) {
                    newsItem = content;
                    // Check for extraction
                    const extPath = fullPath.replace('.json', '.extraction.json');
                    if (fs.existsSync(extPath)) {
                        extractionData = JSON.parse(fs.readFileSync(extPath, 'utf-8'));
                    }
                    break;
                }
            } catch {}
        }

        if (!newsItem) {
            res.writeHead(404); res.end('{"error":"news not found"}'); return;
        }

        // If no extraction, process with Ollama now
        if (!extractionData) {
            try {
                const { extract } = require('./ingest-extract.js');
                // Inline extraction using Ollama
                const ollamaRes = await fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(120000),
                    body: JSON.stringify({
                        model: JSON.parse(fs.readFileSync(path.join(__dirname, '../data/schema.json'), 'utf-8')).extraction.models.extractor.model,
                        prompt: `Extract event and actors from: Title: ${newsItem.title}\nSource: ${newsItem.source_name}\nDescription: ${newsItem.description}`,
                        stream: false,
                        options: { temperature: 0.1 }
                    })
                });
                const data = await ollamaRes.json();
                const jsonMatch = data.response?.match(/\{[\s\S]*\}/);
                if (jsonMatch) extractionData = JSON.parse(jsonMatch[0]);
            } catch (err) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Extraction failed: ' + err.message }));
                return;
            }
        }

        if (!extractionData?.event) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ focal: null, nodes: [], edges: [], extraction: extractionData }));
            return;
        }

        // Write to graph
        const client = await pool.connect();
        try {
            await client.query("LOAD 'age'");
            await client.query("SET search_path = ag_catalog, public");

            const evt = extractionData.event;
            const actors = extractionData.actors || [];

            // Create event
            await client.query(`
                SELECT * FROM cypher('overstanding', $$
                    MERGE (e:Evento {id: '${esc(evt.id)}'})
                    SET e.name = '${esc(evt.name)}', e.event_type = '${esc(evt.event_type)}',
                        e.date = '${esc(evt.date || '')}', e.source = '${esc(newsItem.source_name)}',
                        e.source_url = '${esc(newsItem.link)}'
                    RETURN e
                $$) as (e agtype)
            `).catch(() => {});

            // Create actors + PARTICIPA
            for (const a of actors) {
                await client.query(`
                    SELECT * FROM cypher('overstanding', $$
                        MERGE (a:Actor {id: '${esc(a.id)}'})
                        SET a.name = '${esc(a.name)}', a.type = '${esc(a.type)}', a.description = '${esc(a.description || '')}'
                        RETURN a
                    $$) as (a agtype)
                `).catch(() => {});

                await client.query(`
                    SELECT * FROM cypher('overstanding', $$
                        MATCH (a:Actor {id: '${esc(a.id)}'}), (e:Evento {id: '${esc(evt.id)}'})
                        MERGE (a)-[r:PARTICIPA]->(e)
                        SET r.role = '${esc(a.role || '')}'
                        RETURN a, e
                    $$) as (a agtype, e agtype)
                `).catch(() => {});
            }

            // Return the ego of the event
            const nodesMap = new Map();
            const eventNode = { ...evt, label: 'Evento', _degree: 0 };
            nodesMap.set(evt.id, eventNode);
            const edgesList = [];

            for (const a of actors) {
                nodesMap.set(a.id, { ...a, label: 'Actor', _degree: 1 });
                edgesList.push({ source: a.id, target: evt.id, type: 'PARTICIPA', role: a.role });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                focal: eventNode,
                nodes: [...nodesMap.values()],
                edges: edgesList
            }));
        } finally {
            client.release();
        }
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

server.listen(PORT, () => console.log(`OS API: http://localhost:${PORT}`));
