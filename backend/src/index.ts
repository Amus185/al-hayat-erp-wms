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

import { PgAdapter } from './pg-client';
import { ensurePostgresInit } from './init-postgres';

const app = new Hono();

let globalPgAdapter: PgAdapter | null = null;

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
  credentials: true,
}));

// Environment & Database Binding Middleware for Railway / Node.js
app.use('*', async (c, next) => {
  const envObj = (c.env || {}) as Record<string, any>;
  (c as any).env = envObj;

  // Populate secrets from process.env if available (Railway / Node.js)
  envObj.JWT_ACCESS_SECRET = envObj.JWT_ACCESS_SECRET || (typeof process !== 'undefined' ? process.env.JWT_ACCESS_SECRET : undefined) || 'dev-access-secret-1234567890123456';
  envObj.JWT_REFRESH_SECRET = envObj.JWT_REFRESH_SECRET || (typeof process !== 'undefined' ? process.env.JWT_REFRESH_SECRET : undefined) || 'dev-refresh-secret-1234567890123456';
  envObj.JWT_ACCESS_EXPIRY = envObj.JWT_ACCESS_EXPIRY || (typeof process !== 'undefined' ? process.env.JWT_ACCESS_EXPIRY : undefined) || '15m';
  envObj.JWT_REFRESH_EXPIRY = envObj.JWT_REFRESH_EXPIRY || (typeof process !== 'undefined' ? process.env.JWT_REFRESH_EXPIRY : undefined) || '7d';

  const pgConnStr = typeof process !== 'undefined' ? (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL) : undefined;

  if (pgConnStr) {
    if (!globalPgAdapter) {
      console.log('⚡ Initializing native PostgreSQL Connection Pool adapter...');
      globalPgAdapter = new PgAdapter(pgConnStr);
      await ensurePostgresInit(globalPgAdapter.getPool());
    }
    envObj.DB = globalPgAdapter;
  } else if (!envObj.DB) {
    throw new Error('Fatal Error: DATABASE_URL is missing. Backend runs 100% on PostgreSQL.');
  }

  await next();
});


app.get('/', (c) => c.json({
  service: 'Al Hayat ERP & WMS Backend API',
  version: '1.0.0',
  status: 'active',
  environment: 'production',
  healthCheck: '/api/v1/health',
}));

app.get('/api/v1/health', (c) => c.json({
  status: 'ok',
  dbEngine: globalPgAdapter ? 'postgres' : 'd1',
  timestamp: new Date().toISOString()
}));

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

// Global Error Handler - Structured JSON Logging for Cloudflare Workers Observability
app.onError((err, c) => {
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
      error: err.message || 'Internal Server Error',
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

