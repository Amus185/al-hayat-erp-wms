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

// Global router instances...

import { PgAdapter } from './pg-client';
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

// System Operational Data Wipe Endpoint (Protected)
app.post('/api/v1/system/wipe-clean', async (c) => {
  const env = (c.env || {}) as Record<string, any>;
  const secret = c.req.header('x-wipe-secret');
  if (!secret || secret !== env.JWT_ACCESS_SECRET) {
    return c.json({ error: 'Unauthorized system maintenance request' }, 401);
  }

  const pool = env.DB?.getPool ? env.DB.getPool() : null;
  if (!pool) {
    return c.json({ error: 'Database pool not available' }, 500);
  }
  const client = await pool.connect();
  try {
    const tableRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const existing = new Set(tableRes.rows.map((r: any) => r.table_name));

    const TARGET_OPERATIONAL_TABLES = [
      'invoice_payments', 'invoice_lines', 'invoices',
      'sales_order_lines', 'sales_orders', 'quotations',
      'customer_payments', 'customer_debts', 'customers',
      'purchase_invoice_payments', 'purchase_invoices',
      'goods_receipt_lines', 'goods_receipts',
      'purchase_order_lines', 'purchase_orders', 'suppliers',
      'inventory_transactions', 'inventory_stock', 'inventory_period_counts',
      'transfer_lines', 'transfers',
      'delivery_runs', 'delivery_items', 'deliveries',
      'work_order_stages', 'work_order_materials', 'work_order_logs',
      'work_orders', 'bom_items', 'bill_of_materials',
      'journal_entry_lines', 'journal_entries', 'general_ledger', 'expenses',
      'depreciation_schedules', 'rental_payments', 'property_expenses',
      'lease_agreements', 'tenants', 'properties',
      'livestock_expenses', 'livestock_transactions', 'livestock',
      'notifications', 'audit_logs', 'refresh_tokens', 'files',
      'products', 'categories', 'brands',
    ];

    const tablesToWipe = TARGET_OPERATIONAL_TABLES.filter(t => existing.has(t));
    const wipeStats: Record<string, number> = {};

    for (const t of tablesToWipe) {
      try {
        const cnt = await client.query(`SELECT COUNT(*)::int AS count FROM "${t}";`);
        wipeStats[t] = cnt.rows[0].count;
      } catch {
        wipeStats[t] = 0;
      }
    }

    await client.query('BEGIN;');
    if (tablesToWipe.length > 0) {
      const listStr = tablesToWipe.map(t => `"${t}"`).join(', ');
      await client.query(`TRUNCATE TABLE ${listStr} RESTART IDENTITY CASCADE;`);
    }
    await client.query('COMMIT;');

    return c.json({
      success: true,
      message: 'Operational database successfully wiped to clean state.',
      preserved_tables: [
        'users', 'roles', 'permissions', 'user_roles', 'role_permissions',
        'branches', 'warehouses', 'warehouse_locations', 'chart_of_accounts', 'fiscal_periods'
      ],
      wiped_table_counts: wipeStats,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    try { await client.query('ROLLBACK;'); } catch (_) {}
    return c.json({ success: false, error: err.message }, 500);
  } finally {
    client.release();
  }
});

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
