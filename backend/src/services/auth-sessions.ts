// Server-side sessions, refresh-token rotation with reuse detection, and
// access-token issuance. See docs/audit/AUTHENTICATION.md.
import { sign } from 'hono/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getAccessSecret } from '../security-config';

export const ACCESS_TOKEN_TTL_S = 15 * 60;          // access token lifetime
export const REFRESH_TOKEN_TTL_S = 7 * 24 * 3600;   // idle lifetime of one refresh token
export const SESSION_MAX_TTL_S = 30 * 24 * 3600;    // absolute session lifetime
// A refresh token presented again within this window of its rotation is a
// race between tabs/requests holding the same cookie, not theft: the caller
// gets 409 and retries with the cookie the winning response set. Nothing is
// issued for it. Later reuse revokes the whole session.
export const REUSE_GRACE_MS = 30_000;

export type ClientType = 'browser' | 'native';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newRefreshToken = () => randomBytes(32).toString('base64url');

export function poolOf(c: any): Pool {
  return c.env.DB.getPool() as Pool;
}

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function insertRefreshToken(client: PoolClient, userId: string, sessionId: string): Promise<string> {
  const token = newRefreshToken();
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, session_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, LEAST(CURRENT_TIMESTAMP + make_interval(secs => $5),
                                   (SELECT expires_at FROM auth_sessions WHERE id = $3)))`,
    [randomUUID(), userId, sessionId, hashToken(token), REFRESH_TOKEN_TTL_S],
  );
  return token;
}

/** Start a session for a verified user; returns the first refresh token. */
export async function createSession(pool: Pool, userId: string, meta: { clientType: ClientType; userAgent?: string | null; ip?: string | null }) {
  return inTransaction(pool, async (client) => {
    const sessionId = randomUUID();
    await client.query(
      `INSERT INTO auth_sessions (id, user_id, client_type, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + make_interval(secs => $6))`,
      [sessionId, userId, meta.clientType, (meta.userAgent || '').slice(0, 300) || null, meta.ip || null, SESSION_MAX_TTL_S],
    );
    const refreshToken = await insertRefreshToken(client, userId, sessionId);
    return { sessionId, refreshToken };
  });
}

export type RotateResult =
  | { ok: true; userId: string; sessionId: string; refreshToken: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'reuse_detected' | 'race' | 'inactive' };

/**
 * Exchange a refresh token for its successor, atomically. Exactly one caller
 * can claim a given token; a second presentation is either a race (within
 * REUSE_GRACE_MS: 409, nothing issued) or reuse (session revoked).
 */
export async function rotateRefreshToken(pool: Pool, presented: string): Promise<RotateResult> {
  if (!presented || presented.length > 200) return { ok: false, reason: 'invalid' };
  const hash = hashToken(presented);
  return inTransaction(pool, async (client): Promise<RotateResult> => {
    const claimed = await client.query(
      `UPDATE refresh_tokens rt SET used_at = CURRENT_TIMESTAMP
       FROM auth_sessions s, users u
       WHERE rt.token_hash = $1 AND rt.session_id = s.id AND u.id = rt.user_id
         AND rt.used_at IS NULL AND rt.expires_at > CURRENT_TIMESTAMP
         AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1
       RETURNING rt.user_id, rt.session_id`,
      [hash],
    );
    if (claimed.rowCount) {
      const { user_id: userId, session_id: sessionId } = claimed.rows[0];
      const refreshToken = await insertRefreshToken(client, userId, sessionId);
      await client.query('UPDATE auth_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1', [sessionId]);
      return { ok: true, userId, sessionId, refreshToken };
    }

    // Not claimable: find out why.
    const found = await client.query(
      `SELECT rt.session_id, rt.used_at, rt.expires_at <= CURRENT_TIMESTAMP AS expired,
              s.revoked_at, s.expires_at <= CURRENT_TIMESTAMP AS session_expired, u.is_active,
              EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - rt.used_at)) * 1000 AS used_ms_ago
       FROM refresh_tokens rt
       LEFT JOIN auth_sessions s ON s.id = rt.session_id
       LEFT JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
      [hash],
    );
    const row = found.rows[0];
    if (!row || !row.session_id) return { ok: false, reason: 'invalid' };
    if (row.revoked_at) return { ok: false, reason: 'revoked' };
    if (Number(row.is_active) !== 1) return { ok: false, reason: 'inactive' };
    if (row.used_at) {
      if (Number(row.used_ms_ago) <= REUSE_GRACE_MS) return { ok: false, reason: 'race' };
      await client.query(
        `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'refresh_token_reuse'
         WHERE id = $1 AND revoked_at IS NULL`,
        [row.session_id],
      );
      return { ok: false, reason: 'reuse_detected' };
    }
    return { ok: false, reason: 'expired' };
  });
}

/** The session a refresh token belongs to (without consuming it). */
export async function sessionOfRefreshToken(pool: Pool, presented: string): Promise<string | null> {
  if (!presented || presented.length > 200) return null;
  const r = await pool.query('SELECT session_id FROM refresh_tokens WHERE token_hash = $1', [hashToken(presented)]);
  return r.rows[0]?.session_id ?? null;
}

export async function revokeSession(pool: Pool, sessionId: string, reason: string) {
  await pool.query(
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
  );
}

/** Statement form for callers that batch it with their own changes. */
export function prepareRevokeAllSessions(db: any, userId: string, reason: string) {
  return db.prepare(
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL`,
  ).bind(reason, userId);
}

export async function signAccessToken(userId: string, sessionId: string, pwdVer: number) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, sid: sessionId, typ: 'access', pwd_ver: pwdVer, iat: now, exp: now + ACCESS_TOKEN_TTL_S }, getAccessSecret(), 'HS256');
}

// ── Login throttling (shared across instances via the database) ─────────────
export const LOGIN_FAILURE_WINDOW_S = 15 * 60;
export const MAX_FAILURES_PER_EMAIL_IP = 10;
export const MAX_FAILURES_PER_EMAIL = 50;

export async function isLoginThrottled(pool: Pool, email: string, ip: string | null) {
  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE ip IS NOT DISTINCT FROM $2)::int AS by_ip, COUNT(*)::int AS total
     FROM auth_login_failures WHERE email = $1 AND created_at > CURRENT_TIMESTAMP - make_interval(secs => $3)`,
    [email, ip, LOGIN_FAILURE_WINDOW_S],
  );
  const { by_ip, total } = r.rows[0];
  return by_ip >= MAX_FAILURES_PER_EMAIL_IP || total >= MAX_FAILURES_PER_EMAIL;
}

export async function recordLoginFailure(pool: Pool, email: string, ip: string | null) {
  await pool.query('INSERT INTO auth_login_failures (id, email, ip) VALUES ($1, $2, $3)', [randomUUID(), email, ip]);
  // Keep the table small
  await pool.query(`DELETE FROM auth_login_failures WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`);
}

export async function clearLoginFailures(pool: Pool, email: string, ip: string | null) {
  await pool.query('DELETE FROM auth_login_failures WHERE email = $1 AND ip IS NOT DISTINCT FROM $2', [email, ip]);
}
