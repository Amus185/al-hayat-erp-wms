// Financial privacy (Owner decisions D3 and D4): cost prices, purchase costs
// and stock value only for people with costs.view; salaries, advances and
// employment documents only for people with payroll access. Enforced by the
// server, including exports, sorting and per-person grants.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ as HQ, BRANCH_CL as CL, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

const hasKeyDeep = (v: unknown, keys: string[]): boolean => {
  if (Array.isArray(v)) return v.some((x) => hasKeyDeep(x, keys));
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => keys.includes(k) || hasKeyDeep(x, keys));
  return false;
};
const COSTS = ['cost_price', 'inventory_value', 'cost_value', 'total_cost_value', 'unit_cost'];

test('D4: a Warehouse Manager sees quantities but no cost prices or stock value, anywhere', async () => {
  const pid = await t.createProduct({ price: 100 });
  await t.q('UPDATE products SET cost_price = 60 WHERE id = $1', [pid]);
  await t.setStock(pid, 5, { warehouseId: WH_MAIN });
  const wm = await t.createUser({ branchId: null, roleId: 'role-warehouse-manager', role: 'warehouse_manager', warehouseId: WH_MAIN });

  const products = await t.api('GET', '/products?page=1', undefined, wm.token);
  assert.equal(products.status, 200);
  assert.ok(products.body.items.length > 0);
  assert.equal(hasKeyDeep(products.body, COSTS), false, 'products list has no cost');
  assert.equal(hasKeyDeep((await t.api('GET', `/products/${pid}`, undefined, wm.token)).body, COSTS), false, 'product detail has no cost');

  const stock = await t.api('GET', `/inventory/stock?page=1&location=W:${WH_MAIN}`, undefined, wm.token);
  assert.equal(stock.status, 200);
  assert.ok(stock.body.items.some((r: any) => r.product_id === pid && r.quantity_on_hand === 5), 'quantities are visible');
  assert.equal(hasKeyDeep(stock.body.items, COSTS), false);
  assert.equal(stock.body.totals.value, undefined, 'no stock value total');

  assert.equal(hasKeyDeep((await t.api('GET', '/warehouses', undefined, wm.token)).body, COSTS), false, 'warehouse cards have no value');
  assert.equal(hasKeyDeep((await t.api('GET', `/warehouses/${WH_MAIN}/inventory`, undefined, wm.token)).body, COSTS), false);
  const purchSummary = await t.api('GET', '/purchasing/summary', undefined, wm.token);
  assert.equal(purchSummary.status, 200);
  assert.equal(hasKeyDeep(purchSummary.body, ['total_outstanding_balance', 'deposits_total']), false, 'no supplier balances');
  assert.ok(hasKeyDeep((await t.api('GET', '/purchasing/summary')).body, ['total_outstanding_balance']), 'the Owner sees them');

  // Ordering by cost would leak it: falls back to the default order.
  const sorted = await t.api('GET', '/products?page=1&sort=cost&dir=desc', undefined, wm.token);
  assert.equal(sorted.status, 200);

  // Cannot set a cost it cannot see; cannot create priced purchase orders.
  await t.api('PATCH', `/products/${pid}`, { costPrice: 1 }, wm.token);
  assert.equal(Number((await t.q('SELECT cost_price FROM products WHERE id = $1', [pid]))[0].cost_price), 60, 'cost unchanged');
  assert.equal((await t.api('POST', '/purchasing/orders', { supplierId: 'x', lines: [] }, wm.token)).status, 403);

  // The Owner sees everything.
  const asAdmin = await t.api('GET', `/inventory/stock?page=1&location=W:${WH_MAIN}`);
  assert.ok(asAdmin.body.items.some((r: any) => r.product_id === pid && Number(r.cost_price) === 60));
  assert.ok(asAdmin.body.totals.value >= 300);
});

test('D4: the Owner can grant cost access to one Warehouse Manager; only the Owner can grant', async () => {
  const pid = await t.createProduct({ price: 50 });
  await t.q('UPDATE products SET cost_price = 20 WHERE id = $1', [pid]);
  const wm = await t.createUser({ branchId: null, roleId: 'role-warehouse-manager', role: 'warehouse_manager', warehouseId: WH_MAIN });
  const other = await t.createUser({ branchId: null, roleId: 'role-warehouse-manager', role: 'warehouse_manager', warehouseId: WH_MAIN });

  const grantable = await t.api('GET', '/users/grantable-permissions');
  assert.deepEqual(grantable.body.map((p: any) => p.code).sort(), ['accounting.view', 'assistant.use', 'costs.view', 'employees.manage', 'payroll.manage', 'payroll.view']);

  const granted = await t.api('PUT', `/users/${wm.id}/extra-permissions`, { codes: ['costs.view'] });
  assert.equal(granted.status, 200, JSON.stringify(granted.body));
  const seen = await t.api('GET', `/products/${pid}`, undefined, wm.token);
  assert.equal(Number(seen.body.cost_price), 20, 'the granted manager now sees cost (permissions are read on every request)');
  assert.equal((await t.api('GET', `/products/${pid}`, undefined, other.token)).body.cost_price, undefined, 'other managers still do not');
  assert.equal((await t.q(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'USER_EXTRA_PERMISSIONS' AND entity_id = $1`, [wm.id]))[0].n, 1, 'the grant is audited');

  assert.equal((await t.api('PUT', `/users/${wm.id}/extra-permissions`, { codes: ['manage_users'] })).status, 400, 'only the privacy permissions can be granted this way');
  const branchManager = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal((await t.api('PUT', `/users/${other.id}/extra-permissions`, { codes: ['costs.view'] }, branchManager.token)).status, 403);

  await t.api('PUT', `/users/${wm.id}/extra-permissions`, { codes: [] });
  assert.equal((await t.api('GET', `/products/${pid}`, undefined, wm.token)).body.cost_price, undefined, 'removing the grant takes effect at once');
});

test('D4: Sales staff and Branch Managers do not see stock value or profit; accountants do; a grant restores it', async () => {
  const rep = await t.createUser({ branchId: HQ, roleId: 'role-sales-rep', role: 'sales_rep' });
  const valuation = await t.api('GET', '/reports/inventory-valuation', undefined, rep.token);
  assert.equal(valuation.status, 200);
  assert.equal(hasKeyDeep(valuation.body, COSTS), false);
  const profit = await t.api('GET', '/reports/sales-profit', undefined, rep.token);
  assert.equal(hasKeyDeep(profit.body, ['gross_profit', 'profit', 'cost_price']), false);

  const manager = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal(hasKeyDeep((await t.api('GET', '/reports/inventory-valuation', undefined, manager.token)).body, ['total_cost_value']), false, 'not by default');
  assert.equal((await t.api('POST', '/purchasing/orders', { supplierId: 'x', lines: [] }, manager.token)).status, 403, 'priced purchase orders need cost access');
  await t.api('PUT', `/users/${manager.id}/extra-permissions`, { codes: ['costs.view'] });
  assert.ok(hasKeyDeep((await t.api('GET', '/reports/inventory-valuation', undefined, manager.token)).body, ['total_cost_value']), 'granted by the Owner');
  assert.notEqual((await t.api('POST', '/purchasing/orders', { supplierId: 'x', lines: [] }, manager.token)).status, 403);
  const accountant = await t.createUser({ branchId: null, roleId: 'role-accountant', role: 'accountant' });
  assert.ok(hasKeyDeep((await t.api('GET', '/reports/inventory-valuation', undefined, accountant.token)).body, ['total_cost_value']));
});

test('D3: Branch Managers manage their own branch employees without seeing pay; payroll is Owner-only unless granted', async () => {
  const manager = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const created = await t.api('POST', '/employees', { full_name: 'Amina Yusuf', position: 'Sales', salary: 999, branch_id: CL, document_key: 'x.pdf' }, manager.token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const row = (await t.q('SELECT branch_id, salary, document_key FROM employees WHERE id = $1', [id]))[0];
  assert.equal(row.branch_id, HQ, 'added to the manager’s own branch, not the one asked for');
  assert.equal(Number(row.salary), 0, 'a manager cannot set pay');
  assert.equal(row.document_key, null, 'nor the employment document');
  assert.equal(created.body.salary, undefined, 'the answer has no pay');

  // The Owner sets the salary and records an advance.
  assert.equal(Number((await t.api('PATCH', `/employees/${id}`, { salary: 450 })).body.salary), 450);
  assert.equal((await t.api('POST', `/employees/${id}/advances`, { amount: 100 })).status, 201);

  const list = await t.api('GET', '/employees?page=1', undefined, manager.token);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((e: any) => e.id === id));
  assert.equal(hasKeyDeep(list.body, ['salary', 'advance_balance', 'total_advances']), false);
  assert.equal(list.body.totals, undefined);
  const profile = await t.api('GET', `/employees/${id}`, undefined, manager.token);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.full_name, 'Amina Yusuf');
  assert.equal(hasKeyDeep(profile.body, ['salary', 'advances', 'advance_balance', 'document_key']), false);
  assert.equal((await t.api('POST', `/employees/${id}/advances`, { amount: 10 }, manager.token)).status, 403);
  await t.api('PATCH', `/employees/${id}`, { salary: 1, position: 'Senior sales' }, manager.token);
  const after = (await t.q('SELECT salary, position FROM employees WHERE id = $1', [id]))[0];
  assert.equal(Number(after.salary), 450, 'pay unchanged');
  assert.equal(after.position, 'Senior sales', 'ordinary details changed');

  // Other branches' employees are invisible.
  const clEmp = (await t.api('POST', '/employees', { full_name: 'CL Person', branch_id: CL })).body.id;
  assert.equal((await t.api('GET', `/employees/${clEmp}`, undefined, manager.token)).status, 404);
  assert.equal((await t.api('PATCH', `/employees/${clEmp}`, { position: 'x' }, manager.token)).status, 404);
  assert.ok(!(await t.api('GET', '/employees?page=1', undefined, manager.token)).body.items.some((e: any) => e.id === clEmp));

  // Sales staff have no employee access.
  const rep = await t.createUser({ branchId: HQ, roleId: 'role-sales-rep', role: 'sales_rep' });
  assert.equal((await t.api('GET', '/employees?page=1', undefined, rep.token)).status, 403);

  // The Owner grants payroll viewing to this manager.
  await t.api('PUT', `/users/${manager.id}/extra-permissions`, { codes: ['payroll.view'] });
  const withPay = await t.api('GET', `/employees/${id}`, undefined, manager.token);
  assert.equal(Number(withPay.body.salary), 450);
  assert.equal(withPay.body.advance_balance, 100);
  assert.equal((await t.api('POST', `/employees/${id}/advances`, { amount: 10 }, manager.token)).status, 403, 'viewing is not managing');
});

test('D3: employment documents need payroll access; photos need employee access in the same branch', async () => {
  const doc = `doc-${randomUUID()}.pdf`;
  const photo = `photo-${randomUUID()}.jpg`;
  await t.q(`INSERT INTO employees (id, full_name, branch_id, document_key, photo_key) VALUES ($1, 'Files Person', $2, $3, $4)`, [randomUUID(), HQ, doc, photo]);
  const manager = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const otherBranch = await t.createUser({ branchId: CL, roleId: 'role-branch-user', role: 'branch_user' });
  const rep = await t.createUser({ branchId: HQ, roleId: 'role-sales-rep', role: 'sales_rep' });
  // 404 = refused (as if the file did not exist); 503 = allowed, but no file storage in tests.
  assert.equal((await t.api('GET', `/files/${doc}`, undefined, manager.token)).status, 404, 'no payroll access → no document');
  assert.equal((await t.api('GET', `/files/${photo}`, undefined, manager.token)).status, 503, 'own branch photo allowed');
  assert.equal((await t.api('GET', `/files/${photo}`, undefined, otherBranch.token)).status, 404, 'another branch → refused');
  assert.equal((await t.api('GET', `/files/${photo}`, undefined, rep.token)).status, 404, 'no employee access → refused');
  assert.equal((await t.api('GET', `/files/${doc}`)).status, 503, 'the Owner may open it');
});
