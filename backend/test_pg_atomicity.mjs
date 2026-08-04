import { PgAdapter } from './src/pg-client.js';
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

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL required');
  process.exit(1);
}

async function main() {
  console.log('=== Step 4.3: PostgreSQL Transaction Atomicity & Rollback Test ===\n');

  const db = new PgAdapter(DATABASE_URL);

  const SETUP_ID = 'test-pg-atomicity-setup-' + Date.now();
  const PHANTOM_ID = 'test-pg-atomicity-phantom-' + Date.now();

  try {
    // 1. Create a setup row
    console.log('1. Creating setup row...');
    await db.batch([
      db.prepare("INSERT INTO audit_logs (id, action, entity_type, entity_id) VALUES (?, 'SETUP', 'test', 'test')").bind(SETUP_ID)
    ]);
    console.log(`   ✅ Setup row created: ${SETUP_ID}`);

    // 2. Run batch where stmt 1 is valid, stmt 2 collides on PK
    console.log('\n2. Attempting batch transaction with intentional PK collision on stmt 2...');
    let batchFailed = false;
    try {
      await db.batch([
        db.prepare("INSERT INTO audit_logs (id, action, entity_type, entity_id) VALUES (?, 'PHANTOM', 'test', 'test')").bind(PHANTOM_ID),
        db.prepare("INSERT INTO audit_logs (id, action, entity_type, entity_id) VALUES (?, 'DUPLICATE', 'test', 'test')").bind(SETUP_ID)
      ]);
    } catch (err) {
      batchFailed = true;
      console.log(`   ✅ Batch thrown as expected: ${err.message}`);
    }

    if (!batchFailed) {
      console.error('   ❌ Batch failed to throw an error!');
      process.exit(1);
    }

    // 3. Verify PHANTOM_ID was rolled back completely
    console.log('\n3. Checking if stmt 1 (PHANTOM_ID) was rolled back...');
    const checkPhantom = await db.prepare('SELECT id FROM audit_logs WHERE id = ?').bind(PHANTOM_ID).first();

    if (checkPhantom) {
      console.error('   ❌ ATOMICITY FAILURE: Phantom row exists! Transaction did NOT roll back.');
      process.exit(1);
    } else {
      console.log('   ✅ ATOMICITY CONFIRMED: Phantom row does NOT exist. Postgres transaction rolled back 100% cleanly!');
    }

    // 4. Cleanup setup row
    await db.prepare('DELETE FROM audit_logs WHERE id = ?').bind(SETUP_ID).run();
    console.log('\n4. Cleanup finished.');

  } finally {
    await db.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
