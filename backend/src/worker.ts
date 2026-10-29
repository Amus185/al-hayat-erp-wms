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

type WorkerEnv = {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  STORAGE?: unknown;
  [key: string]: unknown;
};

export default {
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
