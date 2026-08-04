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

import { D1RemoteClient } from './d1-remote-client';
import { PgAdapter } from './pg-client';

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
    }
    envObj.DB = globalPgAdapter;
  } else if (!envObj.DB && typeof process !== 'undefined' && (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_ACCOUNT_ID)) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || 'c3066ec07528b261e192b4530cca58bf';
    const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || '1cae6841-1519-4131-9636-161a5039c3c5';
    const apiToken = process.env.CLOUDFLARE_API_TOKEN || '';

    envObj.DB = new D1RemoteClient({ accountId, databaseId, apiToken });
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

app.get('/api/v1/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/api/v1/admin/dump-d1', async (c) => {
  const tables = [
    'branches', 'warehouses', 'permissions', 'roles', 'role_permissions',
    'users', 'user_roles', 'refresh_tokens', 'warehouse_locations',
    'chart_of_accounts', 'categories', 'brands', 'products', 'inventory_stock',
    'inventory_transactions', 'customers', 'suppliers', 'sales_orders',
    'sales_order_lines', 'quotations', 'invoices', 'invoice_lines',
    'invoice_payments', 'purchase_orders', 'purchase_order_lines',
    'goods_receipts', 'goods_receipt_lines', 'purchase_invoices',
    'purchase_invoice_payments', 'transfers', 'transfer_lines',
    'journal_entries', 'journal_entry_lines', 'general_ledger',
    'fiscal_periods', 'notifications', 'audit_logs', 'files'
  ];

  const dump: Record<string, any[]> = {};
  for (const table of tables) {
    try {
      const { results } = await c.env.DB.prepare(`SELECT * FROM ${table}`).all();
      dump[table] = results || [];
    } catch (e: any) {
      dump[table] = [];
    }
  }
  return c.json(dump);
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

