import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initPg() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.argv[2];
  if (!connectionString) {
    console.error('Usage: node init_pg_db.mjs <DATABASE_URL>');
    process.exit(1);
  }

  console.log('🔌 Connecting to PostgreSQL database...');
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
  });

  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema_pg.sql'), 'utf8');

  try {
    const client = await pool.connect();
    console.log('⚡ Executing schema_pg.sql...');
    await client.query(schemaSql);
    console.log('✅ PostgreSQL Schema & Seed Data initialized successfully!');
    client.release();
  } catch (err) {
    console.error('❌ Failed to initialize PostgreSQL database:', err);
  } finally {
    await pool.end();
  }
}

initPg();
