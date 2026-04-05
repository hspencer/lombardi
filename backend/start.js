#!/usr/bin/env node
/**
 * Lombardi — Unified Process Manager
 *
 * Starts and supervises all backend processes:
 *   1. API server  (api.js)         — HTTP :3000
 *   2. RSS fetcher (rss_fetcher.js) — periodic cycle (default 15 min)
 *   3. Ingest daemon (ingest.js)    — file watcher + Ollama extraction
 *
 * Usage:
 *   node backend/start.js              # start all
 *   node backend/start.js --no-fetch   # skip RSS fetcher
 *   node backend/start.js --no-ingest  # skip ingest daemon
 *
 * Environment:
 *   FETCH_INTERVAL_MIN=15    RSS fetch cycle interval in minutes
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FETCH_INTERVAL_MIN = parseInt(process.env.FETCH_INTERVAL_MIN || '15', 10);

const args = process.argv.slice(2);
const skipFetch = args.includes('--no-fetch');
const skipIngest = args.includes('--no-ingest');

const processes = new Map(); // name → { proc, restarts, lastRestart }
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60000; // Reset restart count after 1 min of stability

// --- Logging ---

function log(tag, msg) {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] [${tag}] ${msg}`);
}

function logError(tag, msg) {
    const ts = new Date().toLocaleTimeString();
    console.error(`[${ts}] [${tag}] ${msg}`);
}

// --- Process Supervisor ---

function startProcess(name, script, nodeArgs = []) {
    const entry = processes.get(name) || { proc: null, restarts: 0, lastRestart: 0 };

    const proc = spawn('node', [path.join(__dirname, script), ...nodeArgs], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '1' }
    });

    proc.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) console.log(`  [${name}] ${line}`);
    });

    proc.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) console.error(`  [${name}] ${line}`);
    });

    proc.on('exit', (code, signal) => {
        if (signal === 'SIGTERM' || signal === 'SIGINT') {
            log(name, `Detenido (${signal}).`);
            return; // Clean shutdown, don't restart
        }

        logError(name, `Salió con código ${code}. Evaluando reinicio...`);

        const now = Date.now();
        // Reset restart counter if process was stable for a while
        if (now - entry.lastRestart > RESTART_WINDOW_MS) {
            entry.restarts = 0;
        }

        if (entry.restarts >= MAX_RESTARTS) {
            logError(name, `Reinicio cancelado: ${MAX_RESTARTS} reinicios en ${RESTART_WINDOW_MS / 1000}s. Intervención manual requerida.`);
            return;
        }

        entry.restarts++;
        entry.lastRestart = now;
        const delay = Math.min(2000 * Math.pow(2, entry.restarts - 1), 30000);
        log(name, `Reiniciando en ${delay}ms (intento ${entry.restarts}/${MAX_RESTARTS})...`);

        setTimeout(() => {
            startProcess(name, script, nodeArgs);
        }, delay);
    });

    entry.proc = proc;
    processes.set(name, entry);
    log(name, `Iniciado (PID ${proc.pid}).`);
    return proc;
}

// --- RSS Fetch Scheduler ---

let fetchTimer = null;

async function scheduleFetch() {
    // Run first cycle immediately
    log('fetch', `Ejecutando ciclo de descarga...`);
    const fetchProc = spawn('node', [path.join(__dirname, 'rss_fetcher.js')], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
    });

    fetchProc.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) console.log(`  [fetch] ${line}`);
    });
    fetchProc.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) console.error(`  [fetch] ${line}`);
    });

    fetchProc.on('exit', (code) => {
        if (code !== 0) logError('fetch', `Ciclo terminó con código ${code}.`);
        log('fetch', `Próximo ciclo en ${FETCH_INTERVAL_MIN} minutos.`);
    });

    // Schedule next cycle
    fetchTimer = setTimeout(() => scheduleFetch(), FETCH_INTERVAL_MIN * 60 * 1000);
}

// --- Health Monitor ---

async function checkHealth() {
    const status = {};

    // Check Ollama
    try {
        const resp = await fetch('http://localhost:11434/api/tags', {
            signal: AbortSignal.timeout(3000)
        });
        status.ollama = resp.ok ? 'ok' : 'error';
    } catch {
        status.ollama = 'unreachable';
    }

    // Check PostgreSQL
    try {
        const { Pool } = require('pg');
        const pool = new Pool({
            host: 'localhost', port: 5432, database: 'lombardi',
            user: 'os_admin', password: 'lombardi_pass',
            connectionTimeoutMillis: 3000
        });
        await pool.query('SELECT 1');
        status.postgres = 'ok';
        await pool.end();
    } catch {
        status.postgres = 'unreachable';
    }

    // Check processes
    for (const [name, entry] of processes) {
        status[name] = entry.proc && !entry.proc.killed ? 'running' : 'stopped';
    }

    return status;
}

// --- Graceful Shutdown ---

function shutdown(signal) {
    log('main', `Recibido ${signal}. Deteniendo procesos...`);

    if (fetchTimer) clearTimeout(fetchTimer);

    for (const [name, entry] of processes) {
        if (entry.proc && !entry.proc.killed) {
            log(name, 'Enviando SIGTERM...');
            entry.proc.kill('SIGTERM');
        }
    }

    // Force kill after 5s
    setTimeout(() => {
        log('main', 'Forzando salida.');
        process.exit(0);
    }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Main ---

(async () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║     Lombardi — Process Manager v1      ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    // Pre-flight health check
    const health = await checkHealth();
    log('main', `PostgreSQL: ${health.postgres}`);
    log('main', `Ollama: ${health.ollama}`);

    if (health.postgres !== 'ok') {
        logError('main', 'PostgreSQL no disponible. Ejecuta: npm run db:up');
        process.exit(1);
    }

    if (health.ollama !== 'ok') {
        logError('main', 'Ollama no disponible. La ingesta esperará a que esté listo.');
    }

    // 1. Start API server
    startProcess('api', 'api.js');

    // 2. Start ingest daemon (with supervised restart)
    if (!skipIngest) {
        startProcess('ingest', 'ingest.js');
    } else {
        log('main', 'Ingesta omitida (--no-ingest).');
    }

    // 3. Schedule RSS fetch cycles
    if (!skipFetch) {
        log('fetch', `Ciclo cada ${FETCH_INTERVAL_MIN} minutos.`);
        await scheduleFetch();
    } else {
        log('main', 'Fetch RSS omitido (--no-fetch).');
    }

    // Periodic health check (every 5 min)
    setInterval(async () => {
        const h = await checkHealth();
        const issues = Object.entries(h).filter(([, v]) => v !== 'ok' && v !== 'running');
        if (issues.length > 0) {
            logError('health', `Problemas: ${issues.map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
    }, 5 * 60 * 1000);

    console.log('');
    log('main', 'Todos los procesos iniciados. Ctrl+C para detener.');
    console.log('');
})();
