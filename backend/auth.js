/**
 * Módulo de Autenticación con Google OAuth 2.0
 *
 * Configuración de Passport.js con estrategia de Google
 * para autenticación sin contraseñas.
 */

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { Pool } = require('pg');

// Pool de conexión a PostgreSQL
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'lombardi',
    user: 'os_admin',
    password: 'lombardi_pass'
});

// Configuración de OAuth (deben estar en variables de entorno en producción)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_CLIENT_ID';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:3000/auth/google/callback';

/**
 * Configurar estrategia de Google OAuth
 */
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Extraer datos del perfil de Google
        const googleId = profile.id;
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const emailVerified = profile.emails && profile.emails[0] ? profile.emails[0].verified : false;
        const displayName = profile.displayName || 'Usuario';
        const givenName = profile.name && profile.name.givenName ? profile.name.givenName : null;
        const familyName = profile.name && profile.name.familyName ? profile.name.familyName : null;
        const avatarUrl = profile.photos && profile.photos[0] ? profile.photos[0].value : null;
        const locale = profile._json.locale || 'en';

        if (!email) {
            return done(new Error('No se pudo obtener el email del perfil de Google'));
        }

        // Buscar o crear usuario
        const client = await pool.connect();
        try {
            // Intentar encontrar usuario existente
            let result = await client.query(
                'SELECT * FROM users WHERE google_id = $1',
                [googleId]
            );

            let user;

            if (result.rows.length > 0) {
                // Usuario existe, actualizar last_login y datos del perfil
                user = result.rows[0];
                await client.query(
                    `UPDATE users
                     SET last_login = CURRENT_TIMESTAMP,
                         display_name = $1,
                         given_name = $2,
                         family_name = $3,
                         avatar_url = $4,
                         locale = $5,
                         email_verified = $6
                     WHERE id = $7`,
                    [displayName, givenName, familyName, avatarUrl, locale, emailVerified, user.id]
                );

                console.log(`✓ Usuario autenticado: ${email} (ID: ${user.id})`);
            } else {
                // Usuario nuevo, crear
                result = await client.query(
                    `INSERT INTO users
                     (google_id, email, email_verified, display_name, given_name, family_name, avatar_url, locale, last_login)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
                     RETURNING *`,
                    [googleId, email, emailVerified, displayName, givenName, familyName, avatarUrl, locale]
                );

                user = result.rows[0];
                console.log(`✓ Usuario nuevo registrado: ${email} (ID: ${user.id})`);
            }

            return done(null, user);

        } finally {
            client.release();
        }

    } catch (err) {
        console.error('Error en autenticación OAuth:', err);
        return done(err, null);
    }
}));

/**
 * Serialización: guardar user.id en sesión
 */
passport.serializeUser((user, done) => {
    done(null, user.id);
});

/**
 * Deserialización: recuperar usuario completo desde DB usando ID de sesión
 */
passport.deserializeUser(async (id, done) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return done(new Error('Usuario no encontrado'));
        }
        done(null, result.rows[0]);
    } catch (err) {
        done(err, null);
    }
});

/**
 * Middleware: verificar que el usuario está autenticado
 */
function requireAuth(req, res) {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No autenticado', loginUrl: '/auth/google' }));
        return false;
    }
    return true;
}

/**
 * Obtener usuario actual desde la request
 */
function getCurrentUser(req) {
    return req.user || null;
}

module.exports = {
    passport,
    requireAuth,
    getCurrentUser,
    pool
};
