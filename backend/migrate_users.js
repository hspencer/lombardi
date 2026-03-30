#!/usr/bin/env node
/**
 * Migración: Crear tablas de usuarios y votos
 *
 * Ejecutar:
 *   node backend/migrate_users.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Usar mismas credenciales que api.js
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'lombardi',
  user: 'os_admin',
  password: 'lombardi_pass'
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('🔄 Iniciando migración de usuarios...\n');

    // Leer el archivo SQL
    const sqlPath = path.join(__dirname, 'schema_users.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    // Ejecutar el schema
    await client.query(sql);

    console.log('✅ Tablas creadas:');
    console.log('   - users');
    console.log('   - verification_votes');
    console.log('   - contradiction_stats (vista)');

    // Verificar que las tablas existen
    const checkTables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'verification_votes')
      ORDER BY table_name
    `);

    console.log('\n📊 Tablas en la base de datos:');
    checkTables.rows.forEach(row => {
      console.log(`   ✓ ${row.table_name}`);
    });

    // Mostrar estadísticas iniciales
    const userCount = await client.query('SELECT COUNT(*) FROM users');
    const voteCount = await client.query('SELECT COUNT(*) FROM verification_votes');

    console.log('\n📈 Estado inicial:');
    console.log(`   - Usuarios: ${userCount.rows[0].count}`);
    console.log(`   - Votos: ${voteCount.rows[0].count}`);

    console.log('\n✨ Migración completada exitosamente\n');

  } catch (err) {
    console.error('❌ Error en migración:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
