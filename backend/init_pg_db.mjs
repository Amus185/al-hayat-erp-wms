#!/usr/bin/env node
/**
 * init_pg_db.mjs
 * Initialize the Railway Postgres database with the full schema.
 *
 * Usage:
 *   node init_pg_db.mjs
 *
 * Required:
 *   DATABASE_URL  — Railway Postgres connection string (auto-injected in Railway)
 *
 * Safe to run multiple times — uses IF NOT EXISTS and ON CONFLICT DO NOTHING.
 * Does NOT drop existing tables unless --reset flag is passed.
 *
 * With --reset:
 *   node init_pg_db.mjs --reset
 *   WARNING: This DROPS all tables. Only use on a fresh staging instance.
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Auto-load backend/.env or root .env if present
const envPaths = [join(__dirname, '.env'), join(__dirname, '..', '.env')];
for (const p of envPaths) {
  if (existsSync(p)) {
    const lines = readFileSync(p, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;
const RESET = process.argv.includes('--reset');

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is required');
  process.exit(1);
}

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('🐘 Connected to PostgreSQL');

  try {
    // Verify Postgres version supports gen_random_uuid() natively (requires PG 13+)
    const verRes = await client.query('SELECT version()');
    console.log(`   ${verRes.rows[0].version.split(' ').slice(0, 2).join(' ')}`);

    const schemaPath = join(__dirname, 'schema_pg.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    if (RESET) {
      console.log('⚠️  --reset flag: running full schema (includes DROP TABLE CASCADE)');
    }

    // The schema_pg.sql already includes DROP TABLE IF EXISTS ... CASCADE at the top
    // when --reset is used we run it as-is. Without --reset, we skip DROP statements.
    let schemaSql = schema;
    if (!RESET) {
      // Remove DROP TABLE lines so existing data is preserved
      schemaSql = schema
        .split('\n')
        .filter(line => !line.trim().toUpperCase().startsWith('DROP TABLE'))
        .join('\n');
    }

    await client.query(schemaSql);
    console.log('✅  Schema applied successfully');

    // Quick sanity check — count tables
    const tablesRes = await client.query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    console.log(`📋  ${tablesRes.rows[0].cnt} tables present in public schema`);

    // Confirm gen_random_uuid() works (needed for INSERT…SELECT with randomblob translation)
    const uuidRes = await client.query('SELECT gen_random_uuid()::text AS uuid');
    console.log(`🔑  gen_random_uuid() works: ${uuidRes.rows[0].uuid}`);

    console.log('\n✅  Database is ready. Next step: node migrate_d1_to_pg.mjs');

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('❌  Failed to initialize database:', err.message);
  process.exit(1);
});
