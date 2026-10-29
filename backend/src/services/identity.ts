// Keeps Better Auth's identity rows ("user" and its credential "account") in
// step with the ERP's users table. Both share one id. The ERP creates and
// edits staff (Users page, branch accounts); these statements run in the same
// batch, so the two never disagree. Better Auth's own sign-up is off.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

const isAdminSql = `CASE WHEN EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = 'admin') THEN 'admin' ELSE 'user' END`;

/**
 * Statements that copy one ERP user (email, name, admin flag) into "user", and
 * set the credential password when a bcrypt hash is given. Run them after the
 * ERP's own insert/update and after any user_roles change, in the same batch.
 */
export function syncIdentityStatements(db: any, userId: string, passwordHash?: string) {
  const stmts = [
    db.prepare(`
      INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
      SELECT u.id, u.full_name, LOWER(u.email), TRUE, ${isAdminSql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM users u WHERE u.id = ?
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, "updatedAt" = CURRENT_TIMESTAMP
    `).bind(userId),
  ];
  if (passwordHash) {
    stmts.push(
      db.prepare(`UPDATE account SET password = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "userId" = ? AND "providerId" = 'credential'`)
        .bind(passwordHash, userId),
      db.prepare(`
        INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        SELECT ?, ?, 'credential', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE NOT EXISTS (SELECT 1 FROM account WHERE "userId" = ? AND "providerId" = 'credential')
      `).bind(randomUUID(), userId, userId, passwordHash, userId),
    );
  }
  return stmts;
}

/** Ends every Better Auth session of a user (password change, deactivation, logout everywhere). */
export function revokeSessionsStatement(db: any, userId: string) {
  return db.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(userId);
}

/**
 * One-off and on every boot: give every ERP user that has no Better Auth
 * identity yet a "user" row and a credential account holding their existing
 * bcrypt hash, so current passwords keep working. Existing rows are left alone.
 */
export async function backfillIdentities(pool: Pool) {
  const users = await pool.query(`
    INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    SELECT u.id, u.full_name, LOWER(u.email), TRUE, ${isAdminSql}, COALESCE(u.created_at, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM "user" b WHERE b.id = u.id)
      AND NOT EXISTS (SELECT 1 FROM "user" b WHERE b.email = LOWER(u.email))
  `);
  const accounts = await pool.query(`
    INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, u.id, 'credential', u.id, u.password_hash, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM users u JOIN "user" b ON b.id = u.id
    WHERE u.password_hash LIKE '$2%'
      AND NOT EXISTS (SELECT 1 FROM account a WHERE a."userId" = u.id AND a."providerId" = 'credential')
  `);
  if (users.rowCount || accounts.rowCount) {
    console.log(`✅ Better Auth identities created for ${users.rowCount} users (${accounts.rowCount} passwords carried over)`);
  }
}
