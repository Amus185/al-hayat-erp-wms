import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setupTestApp, ADMIN_ID, BRANCH_HQ, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

test('a backend restart does not reset the admin password to the seeded one', async () => {
  await t.q("UPDATE users SET password_hash = 'changed-by-admin', password_version = 5 WHERE id = $1", [ADMIN_ID]);
  // Simulate a fresh boot: a new process runs the startup migration against the same database.
  execFileSync(process.execPath, ['--import', 'tsx', '-e', `
    const pg = require('pg');
    const { ensurePostgresInit } = require('./src/init-postgres');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    ensurePostgresInit(pool).then(() => pool.end());
  `], { env: process.env, stdio: 'ignore' });
  const row = await t.q('SELECT password_hash, password_version FROM users WHERE id = $1', [ADMIN_ID]);
  // restore the version the admin test token was signed with
  await t.q('UPDATE users SET password_version = 1 WHERE id = $1', [ADMIN_ID]);
  assert.equal(row[0].password_hash, 'changed-by-admin');
  assert.equal(row[0].password_version, 5);
});

test('a user without any permission cannot read the audit log', async () => {
  const id = randomUUID();
  await t.q(`INSERT INTO users (id, email, password_hash, full_name, branch_id) VALUES ($1, $2, 'x', 'No Perms', $3)`, [id, `${id}@t.local`, BRANCH_HQ]);
  const token = await t.tokenFor({ sub: id, permissions: [], branch_id: BRANCH_HQ, role: 'branch_user' });
  const res = await t.api('GET', '/audit', undefined, token);
  assert.equal(res.status, 403);
});

test('deleting a branch never turns its users into unscoped (all-branch) users', async () => {
  const branchId = `br-${randomUUID().slice(0, 8)}`;
  await t.q(`INSERT INTO branches (id, code, name, city) VALUES ($1, $1, 'Temp', 'X')`, [branchId]);
  const userId = randomUUID();
  await t.q(`INSERT INTO users (id, email, password_hash, full_name, branch_id) VALUES ($1, $2, 'x', 'Branch user', $3)`, [userId, `${userId}@t.local`, branchId]);
  const del = await t.api('DELETE', `/branches/${branchId}`);
  assert.notEqual(del.status, 401, JSON.stringify(del.body));
  const row = await t.q('SELECT branch_id, is_active FROM users WHERE id = $1', [userId]);
  assert.ok(row[0].branch_id !== null || row[0].is_active === 0, 'branch user became an all-branch user');
});

test('a customer with financial history cannot be deleted', async () => {
  const customerId = await t.createCustomer();
  const debt = await t.api('POST', `/sales/customers/${customerId}/debts`, { amount: 50, description: 'Old balance' });
  assert.equal(debt.status, 201, JSON.stringify(debt.body));
  const del = await t.api('DELETE', `/sales/customers/${customerId}`);
  assert.equal(del.status, 400, JSON.stringify(del.body));
  assert.equal((await t.q('SELECT COUNT(*)::int AS n FROM customer_debts WHERE customer_id = $1', [customerId]))[0].n, 1);
});

test('a delivery for a cancelled order cannot be completed', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 2, { branchId: BRANCH_HQ });
  const customerId = await t.createCustomer();
  const order = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, customerId, lines: [{ productId: p, quantity: 1, unitPrice: 100 }] });
  await t.api('POST', `/sales/orders/${order.body.id}/complete`);
  const delivery = await t.api('POST', '/deliveries', {
    salesOrderId: order.body.id, customerName: 'A', customerPhone: '1', deliveryAddress: 'Street',
  });
  assert.equal(delivery.status, 201, JSON.stringify(delivery.body));
  assert.equal((await t.api('POST', `/sales/orders/${order.body.id}/cancel`, { reason: 'x' })).status, 200);
  const done = await t.api('POST', `/deliveries/${delivery.body.id}/complete`);
  assert.equal(done.status, 400, JSON.stringify(done.body));
  const so = await t.q('SELECT status FROM sales_orders WHERE id = $1', [order.body.id]);
  assert.equal(so[0].status, 'CANCELLED');
});

test('a branch user cannot cancel another branch\'s order', { todo: 'Branch isolation is enforced only on order list/detail/delete — see AUDIT_REPORT SEC-05' }, async () => {
  const p = await t.createProduct();
  await t.setStock(p, 2, { branchId: 'branch-cl-show' });
  const order = await t.api('POST', '/sales/orders', { branchId: 'branch-cl-show', lines: [{ productId: p, quantity: 1, unitPrice: 100 }] });
  const id = randomUUID();
  await t.q(`INSERT INTO users (id, email, password_hash, full_name, branch_id) VALUES ($1, $2, 'x', 'HQ', $3)`, [id, `${id}@t.local`, BRANCH_HQ]);
  const token = await t.tokenFor({ sub: id, permissions: ['manage_sales'], branch_id: BRANCH_HQ, role: 'branch_user' });
  const res = await t.api('POST', `/sales/orders/${order.body.id}/cancel`, { reason: 'x' }, token);
  assert.equal(res.status, 403);
});
