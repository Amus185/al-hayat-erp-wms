// Database helpers for sign-in: the request's pg pool, and failed-sign-in
// throttling shared across instances. Sessions themselves are Better Auth's
// (src/auth.ts).
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export function poolOf(c: any): Pool {
  return c.env.DB.getPool() as Pool;
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
