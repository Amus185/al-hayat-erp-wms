// Better Auth: staff sign-in and sessions (tables "user", "session",
// "account", "verification", created by Better Auth's own migration).
//
// Better Auth owns identity: email + password and sessions. The ERP keeps
// authorization: roles, permissions and branch in its own tables, keyed by the
// same user id (users.id = "user".id), read on every request by authMiddleware.
//
// - Browsers sign in at /api/auth/sign-in/email and get an HttpOnly,
//   SameSite=Strict session cookie on the staff app's origin (the API is
//   served same-origin through the Pages proxy).
// - Native clients (mobile) read the session token from the set-auth-token
//   response header and send it as Authorization: Bearer (bearer plugin).
// - Self sign-up is off: administrators create staff in the ERP Users page,
//   which writes the Better Auth rows too (services/identity.ts).
// - admin(): banned users cannot sign in (the Layerbase dashboard's
//   "Disable user"), and authMiddleware also refuses them on every request.
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin, bearer } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';
import * as bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { getAllowedOrigins, getAuthBaseURL, getAuthSecret } from './security-config';
import { clearLoginFailures, isLoginThrottled, recordLoginFailure } from './services/auth-sessions';

export const SESSION_TTL_S = 7 * 24 * 3600;   // idle lifetime; extended at most once a day while used
const BCRYPT_COST = 12;                         // same as the ERP has always used

// Better Auth's own admin API (/api/auth/admin/*) may list, ban and end
// sessions. Creating users, setting passwords, emails or roles, deleting and
// impersonating stay out: those go through the ERP so its tables stay in step
// and every change is audited there.
const ac = createAccessControl(defaultStatements);
const roles = {
  admin: ac.newRole({ user: ['list', 'get', 'ban'], session: ['list', 'revoke'] }),
  user: ac.newRole({ user: [], session: [] }),
};

export const clientIpFrom = (headers?: Headers | null) =>
  headers?.get('x-real-ip') || headers?.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

function createAuth(pool: Pool) {
  return betterAuth({
    database: pool,
    secret: getAuthSecret(),
    baseURL: getAuthBaseURL(),
    basePath: '/api/auth',
    trustedOrigins: getAllowedOrigins(),
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 200,
      // bcrypt, so passwords set before Better Auth keep working.
      password: {
        hash: (password) => bcrypt.hash(password, BCRYPT_COST),
        verify: ({ hash, password }) => bcrypt.compare(password, hash),
      },
    },
    session: { expiresIn: SESSION_TTL_S, updateAge: 24 * 3600 },
    advanced: {
      defaultCookieAttributes: { sameSite: 'strict' },
      ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] },
    },
    plugins: [admin({ ac, roles, defaultRole: 'user', adminRoles: ['admin'] }), bearer()],
    databaseHooks: {
      session: {
        create: {
          // A user deactivated in the ERP cannot start a session.
          before: async (session) => {
            const r = await pool.query('SELECT is_active FROM users WHERE id = $1', [session.userId]);
            if (Number(r.rows[0]?.is_active) !== 1) {
              throw new APIError('FORBIDDEN', { message: 'This account is deactivated. Contact your administrator.' });
            }
          },
          after: async (session) => {
            await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [session.userId]);
          },
        },
      },
    },
    hooks: {
      // Failed sign-ins are counted in the database (per email+IP and per
      // email), so the limit holds across every Worker instance.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const email = String((ctx.body as any)?.email || '').trim().toLowerCase();
        if (email && await isLoginThrottled(pool, email, clientIpFrom(ctx.headers))) {
          throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many failed sign-in attempts. Try again in 15 minutes.' });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const email = String((ctx.body as any)?.email || '').trim().toLowerCase();
        if (!email) return;
        const ip = clientIpFrom(ctx.headers);
        if (ctx.context.newSession) await clearLoginFailures(pool, email, ip);
        else if (ctx.context.returned instanceof APIError && ctx.context.returned.statusCode === 401) await recordLoginFailure(pool, email, ip);
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

// One instance per pool: the Node server has one pool, a Worker one per request.
const instances = new WeakMap<Pool, Auth>();
export function authFor(pool: Pool): Auth {
  let auth = instances.get(pool);
  if (!auth) {
    auth = createAuth(pool);
    instances.set(pool, auth);
  }
  return auth;
}

/** Create or update Better Auth's tables (its own migration, never hand-written DDL). */
export async function migrateAuthSchema(pool: Pool) {
  const { getMigrations } = await import('better-auth/db/migration');
  const { runMigrations } = await getMigrations(authFor(pool).options);
  await runMigrations();
}
