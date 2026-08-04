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

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is required');
  process.exit(1);
}

const backupPath = join(__dirname, 'd1_backup.json');
if (!existsSync(backupPath)) {
  console.error('❌  d1_backup.json not found');
  process.exit(1);
}

const d1Data = JSON.parse(readFileSync(backupPath, 'utf8'));

// Tables to migrate in exact dependency order
const AUTH_TABLES = [
  'branches',
  'warehouses',
  'permissions',
  'roles',
  'role_permissions',
  'users',
  'user_roles',
  'fiscal_periods'
];

async function insertRows(client, table, rows) {
  if (!rows || rows.length === 0) return 0;
  let count = 0;

  for (const row of rows) {
    const cols = Object.keys(row);
    const vals = Object.values(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const colNames = cols.map(c => `"${c}"`).join(', ');

    let conflictClause = 'ON CONFLICT DO NOTHING';
    if (table === 'users') {
      conflictClause = 'ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, is_active = EXCLUDED.is_active, password_version = EXCLUDED.password_version';
    } else if (table === 'roles' || table === 'permissions' || table === 'branches' || table === 'warehouses' || table === 'fiscal_periods') {
      conflictClause = 'ON CONFLICT (id) DO NOTHING';
    }

    const sql = `INSERT INTO ${table} (${colNames}) VALUES (${placeholders}) ${conflictClause}`;
    await client.query(sql, vals);
    count++;
  }
  return count;
}

async function main() {
  console.log('🚀 Migrating Auth & Required Structural Data from D1 Backup to Postgres...');

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  const summary = {};

  try {
    await client.query('BEGIN');

    for (const table of AUTH_TABLES) {
      const rows = d1Data[table] || [];
      const migratedCount = await insertRows(client, table, rows);
      summary[table] = migratedCount;
      console.log(`  ✓ ${table.padEnd(20)}: ${migratedCount} rows migrated`);
    }

    await client.query('COMMIT');
    console.log('✅ Auth & Structural Data Migration Completed Successfully!');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
