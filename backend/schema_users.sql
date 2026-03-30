-- Schema para gestión de usuarios y votación autenticada
-- PostgreSQL 14+ con extensión AGE ya instalada

-- Tabla de usuarios (OAuth con Google)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    -- OAuth provider data
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT false,
    -- Profile data from Google
    display_name VARCHAR(255) NOT NULL,
    given_name VARCHAR(255),
    family_name VARCHAR(255),
    avatar_url TEXT,
    locale VARCHAR(10),
    -- System fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    reputation_score INTEGER DEFAULT 0,
    -- User customization
    bio TEXT
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_reputation ON users(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login DESC);

-- Tabla de votos de verificación
-- Cada fila representa un voto individual de un usuario sobre una contradicción
CREATE TABLE IF NOT EXISTS verification_votes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- IDs de los nodos en contradicción (edge source -> target)
    contradiction_from_id VARCHAR(255) NOT NULL,
    contradiction_to_id VARCHAR(255) NOT NULL,
    -- Voto del usuario
    vote VARCHAR(20) NOT NULL CHECK (vote IN ('agree', 'disagree', 'uncertain')),
    confidence NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    comment TEXT,
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Constraint: un usuario solo puede votar una vez por contradicción
    CONSTRAINT unique_user_vote UNIQUE (user_id, contradiction_from_id, contradiction_to_id)
);

-- Índices para queries comunes
CREATE INDEX IF NOT EXISTS idx_votes_user ON verification_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_contradiction ON verification_votes(contradiction_from_id, contradiction_to_id);
CREATE INDEX IF NOT EXISTS idx_votes_created ON verification_votes(created_at DESC);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar updated_at en verification_votes
CREATE TRIGGER update_verification_votes_updated_at
    BEFORE UPDATE ON verification_votes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Vista para estadísticas de contradicción
-- Calcula contadores agregados desde verification_votes
CREATE OR REPLACE VIEW contradiction_stats AS
SELECT
    contradiction_from_id,
    contradiction_to_id,
    COUNT(*) as total_votes,
    COUNT(*) FILTER (WHERE vote = 'agree') as vote_agree_count,
    COUNT(*) FILTER (WHERE vote = 'disagree') as vote_disagree_count,
    COUNT(*) FILTER (WHERE vote = 'uncertain') as vote_uncertain_count,
    -- Consensus score: agree / (agree + disagree), ignorando uncertain
    CASE
        WHEN COUNT(*) FILTER (WHERE vote IN ('agree', 'disagree')) > 0 THEN
            CAST(COUNT(*) FILTER (WHERE vote = 'agree') AS NUMERIC) /
            COUNT(*) FILTER (WHERE vote IN ('agree', 'disagree'))
        ELSE 0.5
    END as consensus_score,
    -- Determinar status basado en votos
    CASE
        WHEN COUNT(*) FILTER (WHERE vote IN ('agree', 'disagree')) < 3 THEN 'pending'
        WHEN CAST(COUNT(*) FILTER (WHERE vote = 'agree') AS NUMERIC) /
             COUNT(*) FILTER (WHERE vote IN ('agree', 'disagree')) >= 0.75 THEN 'confirmed'
        WHEN CAST(COUNT(*) FILTER (WHERE vote = 'agree') AS NUMERIC) /
             COUNT(*) FILTER (WHERE vote IN ('agree', 'disagree')) <= 0.25 THEN 'resolved'
        ELSE 'disputed'
    END as verification_status,
    MIN(created_at) as first_vote_at,
    MAX(created_at) as last_vote_at
FROM verification_votes
GROUP BY contradiction_from_id, contradiction_to_id;

COMMENT ON TABLE users IS 'Usuarios registrados del sistema';
COMMENT ON TABLE verification_votes IS 'Votos individuales sobre contradicciones detectadas';
COMMENT ON VIEW contradiction_stats IS 'Vista agregada de estadísticas de votación por contradicción';
