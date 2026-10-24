// LOCAL DEVELOPMENT ONLY: give admin@alhayat.com a fresh random password in a
// local database and print it in this terminal. Refuses any database that is
// not on this computer, so it can never touch production.
//
//   DATABASE_URL=postgresql://postgres:...@localhost:5432/alhayat_local node backend/scripts/dev-set-admin-password.mjs
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const raw = process.env.DATABASE_URL;
if (!raw) { console.error('Set DATABASE_URL to your LOCAL database first.'); process.exit(1); }
const url = new URL(raw);
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
  console.error(`Refusing: "${url.hostname}" is not a local database. This script is for local testing only.`);
  process.exit(1);
}

const db = new pg.Client(raw);
await db.connect();
const found = await db.query("SELECT id FROM users WHERE email = 'admin@alhayat.com'");
if (!found.rowCount) {
  console.error('No admin user yet. Start the backend once against this database so it creates the tables and the admin.');
  process.exit(1);
}
const password = 'Local-' + crypto.randomBytes(6).toString('hex');
await db.query(
  "UPDATE users SET password_hash = $1, password_version = COALESCE(password_version, 1) + 1 WHERE email = 'admin@alhayat.com'",
  [bcrypt.hashSync(password, 10)],
);
await db.end();
console.log('Local staff login (this database only):');
console.log('  email:    admin@alhayat.com');
console.log('  password: ' + password);
