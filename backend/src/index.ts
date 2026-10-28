import { Hono } from 'hono';
import { cors } from 'hono/cors';

import auth from './routes/auth';
import products from './routes/products';
import inventory from './routes/inventory';
import warehouses from './routes/warehouses';
import branches from './routes/branches';
import transfers from './routes/transfers';
import purchasing from './routes/purchasing';
import sales from './routes/sales';
import reports from './routes/reports';
import users from './routes/users';
import notifications from './routes/notifications';
import audit from './routes/audit';
import files from './routes/files';
import accounting from './routes/accounting';
import expenses from './routes/expenses';
import assets from './routes/assets';
import deliveries from './routes/deliveries';
import manufacturing from './routes/manufacturing';
import storefront from './routes/storefront';
import storefrontAdmin from './routes/storefront-admin';
import agent from './routes/agent';

// Global router instances...

import { PgAdapter } from './pg-client';
import { getAccessSecret, isAllowedOrigin, isProductionRuntime } from './security-config';
import { ensurePostgresInit } from './init-postgres';

const app = new Hono();

let globalPgAdapter: PgAdapter | null = null;

// ⚡ LIGHTWEIGHT HEALTH CHECK ROUTE (Must run BEFORE any middleware/DB init for instant 200 OK!)
app.get('/', (c) => c.json({
  service: 'Al Hayat ERP & WMS Backend API',
  version: '1.2.0',
  status: 'active',
  environment: 'production',
  healthCheck: '/api/v1/health',
}));

app.get('/api/v1/health', (c) => c.json({
  status: 'ok',
  dbEngine: 'postgres',
  timestamp: new Date().toISOString()
}));

// CORS: only listed origins (CORS_ORIGINS). In production the browser calls
// the API same-origin through the Pages proxy, so CORS applies only to direct
// cross-origin calls (local development, or an old cached bundle).
app.use('*', cors({
  origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Protection', 'X-Client-Type'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
}));

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
});

// Environment & Database Binding Middleware for Railway / Node.js
app.use('*', async (c, next) => {
  const envObj = (c.env || {}) as Record<string, any>;
  (c as any).env = envObj;

  // Fail closed: without a strong signing secret in production, no API
  // request is served (anyone could otherwise forge a token).
  try {
    getAccessSecret();
  } catch (err: any) {
    console.error(JSON.stringify({ level: 'error', service: 'al-hayat-api', event: 'CONFIG_ERROR', error: err.message }));
    return c.json({ message: 'Service misconfigured. Contact the administrator.' }, 503);
  }

  const pgConnStr = typeof process !== 'undefined' ? (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL) : undefined;

  if (pgConnStr) {
    if (!globalPgAdapter) {
      console.log('⚡ Initializing native PostgreSQL Connection Pool adapter...');
      globalPgAdapter = new PgAdapter(pgConnStr);
      // Run DB initialization non-blocking so health checks respond instantly
      ensurePostgresInit(globalPgAdapter.getPool()).catch(err => {
        console.error('PostgreSQL init error:', err);
      });
    }
    envObj.DB = globalPgAdapter;
  } else if (!envObj.DB) {
    throw new Error('Fatal Error: DATABASE_URL is missing. Backend runs 100% on PostgreSQL.');
  }

  await next();
});

app.route('/api/v1/auth', auth);
app.route('/api/v1/products', products);
app.route('/api/v1/inventory', inventory);
app.route('/api/v1/warehouses', warehouses);
app.route('/api/v1/branches', branches);
app.route('/api/v1/transfers', transfers);
app.route('/api/v1/purchasing', purchasing);
app.route('/api/v1/sales', sales);
app.route('/api/v1/reports', reports);
app.route('/api/v1/users', users);
app.route('/api/v1/notifications', notifications);
app.route('/api/v1/audit', audit);
app.route('/api/v1/files', files);
app.route('/api/v1/accounting', accounting);
app.route('/api/v1/expenses', expenses);
app.route('/api/v1/assets', assets);
app.route('/api/v1/deliveries', deliveries);
app.route('/api/v1/manufacturing', manufacturing);
// Public storefront (no login; whitelisted fields) and its staff-side management
app.route('/api/v1/storefront', storefront);
app.route('/api/v1/storefront-admin', storefrontAdmin);
app.route('/api/v1/agent', agent);

// Global Error Handler - Structured JSON Logging for Cloudflare Workers Observability
app.onError((err, c) => {
  if (err.name === 'ConflictError') {
    return c.json({ message: err.message, status: 409 }, 409);
  }
  if (err.name === 'ScopeError') {
    const status = (err as any).status === 400 ? 400 : 403;
    return c.json({ message: err.message, status }, status);
  }
  const errorPayload = {
    level: 'error',
    timestamp: new Date().toISOString(),
    service: 'al-hayat-api',
    path: c.req.url,
    method: c.req.method,
    error: err.message,
    name: err.name,
    stack: err.stack,
    headers: {
      userAgent: c.req.header('user-agent'),
      ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
    },
  };

  console.error(JSON.stringify(errorPayload));

  return c.json(
    {
      // Internal details (SQL, stack) stay in the server log, not the response
      error: isProductionRuntime() ? 'Internal Server Error' : (err.message || 'Internal Server Error'),
      status: 500,
    },
    500
  );
});

// 404 Not Found Handler
app.notFound((c) => {
  console.warn(
    JSON.stringify({
      level: 'warn',
      timestamp: new Date().toISOString(),
      service: 'al-hayat-api',
      event: 'NOT_FOUND',
      path: c.req.url,
      method: c.req.method,
    })
  );
  return c.json({ error: 'Route not found', status: 404 }, 404);
});

export default app;
