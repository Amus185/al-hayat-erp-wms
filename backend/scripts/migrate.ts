// Bring a Postgres database up to the current schema: the same migration the
// Node server runs on startup (ensurePostgresInit). The Worker does not run it,
// so run this against the production database before each deploy:
//
//   DATABASE_URL=postgres://... npm --workspace backend run db:migrate
//
// Safe to run repeatedly: every step is CREATE ... IF NOT EXISTS, ADD COLUMN
// IF NOT EXISTS or ON CONFLICT DO NOTHING.
import pg from 'pg';
import { ensurePostgresInit } from '../src/init-postgres';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;
if (!url) {
  console.error('Set DATABASE_URL to the database to migrate.');
  process.exit(1);
}
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
const pool = new pg.Pool({ connectionString: url, max: 1, ssl: isLocal ? false : { rejectUnauthorized: false } });

// ensurePostgresInit logs a failed step and carries on (so the server still
// starts); here any logged failure must fail the run.
let failures = 0;
const logError = console.error;
console.error = (...args: unknown[]) => { failures++; logError(...args); };

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
