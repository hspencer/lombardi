/**
 * Deduplicacion semantica de eventos
 * Compara un evento propuesto contra eventos existentes del mismo tipo
 * para detectar duplicados antes de crear uno nuevo.
 */

// --- Utilidades de similitud ---

/**
 * Normalizar texto: minusculas, sin acentos, sin puntuacion extra
 */
function normalize(str) {
    return (str || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Generar trigramas de un texto
 */
function trigrams(str) {
    const n = normalize(str);
    const set = new Set();
    for (let i = 0; i <= n.length - 3; i++) {
        set.add(n.slice(i, i + 3));
    }
    return set;
}

/**
 * Similitud de nombre por trigramas (Jaccard)
 * @returns {number} 0.0-1.0
 */
function nameSimilarity(a, b) {
    const tA = trigrams(a);
    const tB = trigrams(b);
    if (tA.size === 0 && tB.size === 0) return 1.0;
    if (tA.size === 0 || tB.size === 0) return 0.0;
    let intersection = 0;
    for (const t of tA) {
        if (tB.has(t)) intersection++;
    }
    return intersection / (tA.size + tB.size - intersection);
}

/**
 * Proximidad temporal: 1.0 = mismo dia, 0.0 = fuera de ventana
 * @param {string|null} a - fecha YYYY-MM-DD
 * @param {string|null} b - fecha YYYY-MM-DD
 * @param {number} windowDays - ventana en dias (default 7)
 * @returns {number} 0.0-1.0
 */
function dateProximity(a, b, windowDays = 7) {
    if (!a || !b) return 0.5; // incertidumbre
    const dA = new Date(a);
    const dB = new Date(b);
    if (isNaN(dA) || isNaN(dB)) return 0.5;
    const diffDays = Math.abs(dA - dB) / (1000 * 60 * 60 * 24);
    if (diffDays > windowDays) return 0.0;
    return 1.0 - (diffDays / windowDays);
}

// --- Configuracion ---

const DEDUP_CONFIG = {
    nameWeight: 0.5,
    dateWeight: 0.3,
    typeWeight: 0.2,
    overallThreshold: 0.70,
    dateWindowDays: 7,
    maxCandidates: 20
};

/**
 * Buscar un evento duplicado en el grafo
 * @param {object} client - PostgreSQL client (con AGE cargado)
 * @param {object} proposedEvent - { id, name, event_type, date }
 * @returns {object|null} - { id, name, score } del mejor match, o null
 */
async function findDuplicateEvent(client, proposedEvent) {
    const { name, event_type, date } = proposedEvent;
    if (!name || !event_type) return null;

    try {
        // Query eventos del mismo tipo
        const result = await client.query(`
            SELECT * FROM cypher('lombardi', $$
                MATCH (e:Evento)
                WHERE e.event_type = '${event_type.replace(/'/g, "''")}'
                RETURN e.id, e.name, e.date
            $$) as (id agtype, name agtype, date agtype)
        `);

        let bestMatch = null;
        let bestScore = 0;

        for (const row of result.rows) {
            const candidateId = JSON.parse(row.id);
            const candidateName = JSON.parse(row.name || '""');
            const candidateDate = JSON.parse(row.date || '""');

            // Skip self
            if (candidateId === proposedEvent.id) continue;

            const nSim = nameSimilarity(name, candidateName);
            const dProx = dateProximity(date, candidateDate, DEDUP_CONFIG.dateWindowDays);
            const typeMatch = 1.0; // Already filtered by type

            const score = (nSim * DEDUP_CONFIG.nameWeight)
                        + (dProx * DEDUP_CONFIG.dateWeight)
                        + (typeMatch * DEDUP_CONFIG.typeWeight);

            if (score > bestScore && score >= DEDUP_CONFIG.overallThreshold) {
                bestScore = score;
                bestMatch = { id: candidateId, name: candidateName, score };
            }
        }

        return bestMatch;
    } catch (err) {
        console.error(`[Dedup] Error: ${err.message.slice(0, 80)}`);
        return null;
    }
}

module.exports = { nameSimilarity, dateProximity, findDuplicateEvent, normalize, DEDUP_CONFIG };
