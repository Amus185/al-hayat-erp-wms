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

const app = new Hono();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
  credentials: true,
}));

app.get('/api/v1/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

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

export default app;
