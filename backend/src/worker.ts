// Cloudflare Workers entry point. server.ts is the Node entry (local
// development and tests); both serve the same Hono app from index.ts.
//
// Secrets and vars reach the app through process.env (nodejs_compat populates
// it from the Worker's environment). The database is reached through the
// HYPERDRIVE binding, which pools connections in front of Postgres; without
// it, DATABASE_URL is used directly.
import type { ExecutionContext } from 'hono';
import app from './index';
import { PgAdapter } from './pg-client';
import { expireStaleRequests } from './services/storefront';

type WorkerEnv = {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  STORAGE?: unknown;
  [key: string]: unknown;
};

function databaseFor(env: WorkerEnv): PgAdapter | null {
  const hyperdrive = env.HYPERDRIVE?.connectionString;
  const connectionString = hyperdrive || env.DATABASE_URL;
  if (!connectionString) return null;
  return hyperdrive
    ? new PgAdapter(connectionString, { perRequest: true })
    : new PgAdapter(connectionString, { perRequest: true, ssl: true });
}

export default {
  /** Cron Trigger (wrangler.jsonc "triggers"): housekeeping that must happen even when nobody is using the app. */
  async scheduled(_controller: unknown, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const db = databaseFor(env);
    if (!db) return;
    try {
      const n = await expireStaleRequests(db);
      if (n) console.log(JSON.stringify({ level: 'info', service: 'al-hayat-api', event: 'WEB_ORDERS_EXPIRED', count: n }));
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', service: 'al-hayat-api', event: 'SCHEDULED_FAILED', error: String(err) }));
    } finally {
      ctx.waitUntil(db.close().catch(() => {}));
    }
  },

  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    // Health checks answer without opening a database connection.
    if (pathname === '/' || pathname === '/api/v1/health') return app.fetch(request, env, ctx);

    const hyperdrive = env.HYPERDRIVE?.connectionString;
    const connectionString = hyperdrive || env.DATABASE_URL;
    if (!connectionString) {
      console.error(JSON.stringify({ level: 'error', service: 'al-hayat-api', event: 'CONFIG_ERROR', error: 'No HYPERDRIVE binding or DATABASE_URL' }));
      return Response.json({ message: 'Service misconfigured. Contact the administrator.' }, { status: 503 });
    }

    // Hyperdrive speaks plain Postgres inside Cloudflare's network; a direct
    // DATABASE_URL gets the same SSL settings as the Node server.
    const db = hyperdrive
      ? new PgAdapter(connectionString, { perRequest: true })
      : new PgAdapter(connectionString, { perRequest: true, ssl: true });
    try {
      return await app.fetch(request, { ...env, DB: db }, ctx);
    } finally {
      ctx.waitUntil(db.close().catch(() => {}));
    }
  },
};
