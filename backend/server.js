#!/usr/bin/env node
/**
 * Servidor Express con autenticación OAuth
 * Feature: public-debate
 *
 * Ejecutar:
 *   node backend/server.js
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { passport, requireAuth, getCurrentUser } = require('./auth');

// Pool de PostgreSQL
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'lombardi',
    user: 'os_admin',
    password: 'lombardi_pass'
});

// Funciones helper reutilizadas de api.js
function parseAgtype(raw) {
    const str = String(raw).replace(/::(vertex|edge|path)$/g, '');
    return JSON.parse(str);
}

function flat(v) {
    if (!v || typeof v !== 'object') return v;
    return Object.keys(v).reduce((acc, k) => ({ ...acc, [k]: v[k] instanceof Object && 'value' in v[k] ? v[k].value : v[k] }), {});
}

function esc(str) {
    return String(str).replace(/'/g, "''");
}

async function ageQuery(cypher) {
    const result = await pool.query(`SELECT * FROM ag_catalog.cypher('lombardi', $$ ${cypher} $$) as (v ag_catalog.agtype);`, []);
    return result.rows.map(r => parseAgtype(r.v));
}

async function ageQuery2(cypher, cols) {
    const colDef = cols.map(c => `${c} ag_catalog.agtype`).join(', ');
    const result = await pool.query(`SELECT * FROM ag_catalog.cypher('lombardi', $$ ${cypher} $$) as (${colDef});`, []);
    return result.rows.map(row => {
        const obj = {};
        cols.forEach(c => { obj[c] = parseAgtype(row[c]); });
        return obj;
    });
}

// Crear app Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurar sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || 'lombardi-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS en producción
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
    }
}));

// Inicializar Passport
app.use(passport.initialize());
app.use(passport.session());

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// ============================================================================
// RUTAS DE AUTENTICACIÓN
// ============================================================================

// Iniciar flujo OAuth con Google
app.get('/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email']
}));

// Callback de Google OAuth
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
        // Autenticación exitosa, redirigir al home
        res.redirect('/?login=success');
    }
);

// Cerrar sesión
app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Error al cerrar sesión:', err);
            return res.status(500).json({ error: 'Error al cerrar sesión' });
        }
        res.redirect('/');
    });
});

// Obtener usuario actual
app.get('/auth/me', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ authenticated: false, user: null });
    }

    // Enviar datos públicos del usuario
    const user = {
        id: req.user.id,
        email: req.user.email,
        displayName: req.user.display_name,
        avatarUrl: req.user.avatar_url,
        reputationScore: req.user.reputation_score
    };

    res.json({ authenticated: true, user });
});

// ============================================================================
// RUTAS API
// ============================================================================

// GET /api/disputes - Obtener subgrafo de controversias
app.get('/api/disputes', async (req, res) => {
    try {
        const result = await ageQuery2(`
            MATCH (a)-[r:CONTRADICE]->(b)
            RETURN a, r, b
        `, ['a', 'r', 'b']);

        const nodes = new Map();
        const edges = [];

        result.forEach(row => {
            const aNode = flat(row.a);
            const bNode = flat(row.b);
            const edge = flat(row.r);

            if (!nodes.has(aNode.id)) nodes.set(aNode.id, aNode);
            if (!nodes.has(bNode.id)) nodes.set(bNode.id, bNode);

            edges.push({
                source: aNode.id,
                target: bNode.id,
                type: 'CONTRADICE',
                ...edge
            });
        });

        res.json({
            nodes: Array.from(nodes.values()),
            edges
        });

    } catch (err) {
        console.error('Error en /api/disputes:', err);
        res.status(500).json({ error: 'Error al obtener controversias' });
    }
});

// POST /api/disputes/:fromId/:toId/verify - Votar en una controversia
app.post('/api/disputes/:fromId/:toId/verify', async (req, res) => {
    // Verificar autenticación
    if (!requireAuth(req, res)) return;

    const { fromId, toId } = req.params;
    const { vote, confidence, comment } = req.body;
    const user = getCurrentUser(req);

    // Validaciones
    if (!['agree', 'disagree', 'uncertain'].includes(vote)) {
        return res.status(400).json({ error: 'Voto inválido' });
    }

    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
        return res.status(400).json({ error: 'Confianza debe estar entre 0 y 1' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Insertar o actualizar voto (UPSERT)
        await client.query(`
            INSERT INTO verification_votes
                (user_id, contradiction_from_id, contradiction_to_id, vote, confidence, comment)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id, contradiction_from_id, contradiction_to_id)
            DO UPDATE SET
                vote = EXCLUDED.vote,
                confidence = EXCLUDED.confidence,
                comment = EXCLUDED.comment,
                updated_at = CURRENT_TIMESTAMP
        `, [user.id, fromId, toId, vote, confidence, comment || null]);

        // Obtener estadísticas actualizadas desde la vista
        const stats = await client.query(`
            SELECT * FROM contradiction_stats
            WHERE contradiction_from_id = $1 AND contradiction_to_id = $2
        `, [fromId, toId]);

        if (stats.rows.length === 0) {
            throw new Error('No se pudieron obtener estadísticas');
        }

        const {
            vote_agree_count,
            vote_disagree_count,
            vote_uncertain_count,
            consensus_score,
            verification_status
        } = stats.rows[0];

        // Actualizar campos agregados en la arista del grafo
        const updateCypher = `
            MATCH (a {id: '${esc(fromId)}'})-[r:CONTRADICE]->(b {id: '${esc(toId)}'})
            SET r.vote_agree_count = ${vote_agree_count},
                r.vote_disagree_count = ${vote_disagree_count},
                r.vote_uncertain_count = ${vote_uncertain_count},
                r.consensus_score = ${consensus_score},
                r.verification_status = '${esc(verification_status)}'
            RETURN r
        `;

        await ageQuery(updateCypher);

        await client.query('COMMIT');

        res.json({
            ok: true,
            vote_agree_count: parseInt(vote_agree_count),
            vote_disagree_count: parseInt(vote_disagree_count),
            vote_uncertain_count: parseInt(vote_uncertain_count),
            consensus_score: parseFloat(consensus_score),
            verification_status
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error en /verify:', err);
        res.status(500).json({ error: 'Error al registrar voto', details: err.message });
    } finally {
        client.release();
    }
});

// GET /api/node - Obtener información completa de un nodo
app.get('/api/node', async (req, res) => {
    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ error: 'ID requerido' });
    }

    try {
        const nodes = await ageQuery(`MATCH (n {id: '${esc(id)}'}) RETURN n`);

        if (nodes.length === 0) {
            return res.status(404).json({ error: 'Nodo no encontrado' });
        }

        res.json(flat(nodes[0]));

    } catch (err) {
        console.error('Error en /api/node:', err);
        res.status(500).json({ error: 'Error al obtener nodo' });
    }
});

// ============================================================================
// SERVIR ARCHIVOS ESTÁTICOS
// ============================================================================

const FRONTEND_DIR = path.join(__dirname, '../frontend');
const DATA_DIR = path.join(__dirname, '../data');

// Servir archivos estáticos del frontend
app.use(express.static(FRONTEND_DIR));
app.use('/data', express.static(DATA_DIR));

// Ruta raíz sirve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   Lombardi Server (OAuth Edition)                         ║
║   Feature: public-debate                                   ║
║                                                            ║
║   🌐 URL: http://localhost:${PORT}                          ║
║   🔐 OAuth: /auth/google                                   ║
║   📊 API: /api/*                                           ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});
