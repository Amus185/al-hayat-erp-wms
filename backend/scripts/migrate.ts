// Bring a Postgres database up to the current schema: the same migration the
// Node server runs on startup (ensurePostgresInit). The Worker does not run it,
// so run this against the production database before each deploy:
//
//   DATABASE_URL=postgres://... npm --workspace backend run db:migrate
//
// or with DATABASE_URL in backend/.env. Also creates Better Auth's tables
// (user, session, account, verification) with Better Auth's own migration and
// gives every existing ERP user a Better Auth identity with their password.
//
// Safe to run repeatedly: every step is CREATE ... IF NOT EXISTS, ADD COLUMN
// IF NOT EXISTS or ON CONFLICT DO NOTHING.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { ensurePostgresInit } from '../src/init-postgres';

// backend/.env, if present (values already in the environment win).
const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;
if (!url) {
  console.error('Set DATABASE_URL to the database to migrate.');
  process.exit(1);
}
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
const pool = new pg.Pool({ connectionString: url, max: 1, ssl: isLocal ? false : { rejectUnauthorized: false } });

// ensurePostgresInit logs a failed step (prefixed ❌) and carries on, so the
// server still starts; here any such failure must fail the run. Other
// console.error output, such as pg's sslmode warning, is not a failure.
let failures = 0;
const logError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('❌')) failures++;
  logError(...args);
};

async function main() {
  try {
    await ensurePostgresInit(pool);
    if (failures) {
      logError(`Migration reported ${failures} error(s); see above.`);
      process.exitCode = 1;
    } else {
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
      console.log(`Schema is up to date (${rows[0].n} tables).`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logError(err);
  process.exitCode = 1;
});
