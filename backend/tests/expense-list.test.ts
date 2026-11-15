// The company expense list: the Owner / accountant keep it and give each branch or warehouse its
// own expenses; staff record only those, and the category, account and class come with them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, BRANCH_CL, WH_MAIN, type TestCtx } from './helpers';
let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });
const today = new Date().toISOString().slice(0, 10);

test('owner keeps the list, assigns it per branch and warehouse; staff use only their own expenses', async () => {
  const hq = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['expenses.manage'] });
  const cl = await t.createUser({ branchId: BRANCH_CL, roleId: 'role-branch-user', role: 'branch_user', grants: ['expenses.manage'] });
  const wh = await t.createUser({ branchId: null, warehouseId: WH_MAIN, roleId: 'role-warehouse-manager', role: 'warehouse_manager', grants: ['expenses.manage'] });

  // only the Owner / accountant manage the list
  assert.equal((await t.api('POST', '/expenses/types', { name: 'Fuel', category: 'Transport' }, hq.token)).status, 403);
  const cls = await t.api('POST', '/accounting/classes', { name: 'Delivery' });
  const fuel = await t.api('POST', '/expenses/types', { name: 'Fuel for delivery motorbike', category: 'Transport', classId: cls.body.id });
  assert.equal(fuel.status, 201, JSON.stringify(fuel.body));
  const accounts = (await t.api('GET', '/expenses/accounts')).body as any[];
  const rentAcc = accounts.find((a) => /rent/i.test(a.name)) || accounts[0];
  const rent = await t.api('POST', '/expenses/types', { name: 'Shop rent', category: 'Rent', expenseAccountId: rentAcc.id });
  const forklift = await t.api('POST', '/expenses/types', { name: 'Forklift diesel', category: 'Transport' });
  assert.equal((await t.api('POST', '/expenses/types', { name: 'shop RENT', category: 'Rent' })).status, 400, 'no duplicates');

  // assign: HQ gets fuel + rent, the warehouse gets forklift diesel; CL gets nothing yet
  assert.equal((await t.api('PUT', '/expenses/types/assignments', { branchId: BRANCH_HQ, typeIds: [fuel.body.id, rent.body.id] })).body.saved, 2);
  assert.equal((await t.api('PUT', '/expenses/types/assignments', { warehouseId: WH_MAIN, typeIds: [forklift.body.id] })).body.saved, 1);
  assert.deepEqual((await t.api('GET', `/expenses/types/assignments?branchId=${BRANCH_HQ}`)).body.typeIds.sort(), [fuel.body.id, rent.body.id].sort());
  assert.equal((await t.api('PUT', '/expenses/types/assignments', { branchId: BRANCH_HQ, typeIds: [fuel.body.id] }, hq.token)).status, 403);

  // each person sees only their own list
  const names = async (tok: string) => (await t.api('GET', '/expenses/types', undefined, tok)).body.types.map((x: any) => x.name).sort();
  assert.deepEqual(await names(hq.token), ['Fuel for delivery motorbike', 'Shop rent']);
  assert.deepEqual(await names(cl.token), []);
  assert.deepEqual(await names(wh.token), ['Forklift diesel']);

  // HQ records fuel: title, category and class come from the list; the branch is theirs
  const e = await t.api('POST', '/expenses', { expenseTypeId: fuel.body.id, amount: 10, expense_date: today, category: 'Rent', classId: null }, hq.token);
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal(e.body.title, 'Fuel for delivery motorbike'); assert.equal(e.body.category, 'Transport');
  assert.equal(e.body.class_id, cls.body.id); assert.equal(e.body.branch_id, BRANCH_HQ);
  const r = await t.api('POST', '/expenses', { expenseTypeId: rent.body.id, amount: 200, expense_date: today, payment_method: 'UNPAID' }, hq.token);
  assert.equal(r.body.expense_account_id, rentAcc.id); assert.equal(r.body.payment_method, 'UNPAID');

  // not on their list / no list item at all: refused
  assert.equal((await t.api('POST', '/expenses', { expenseTypeId: forklift.body.id, amount: 5, expense_date: today }, hq.token)).status, 403);
  assert.equal((await t.api('POST', '/expenses', { title: 'Tea', category: 'Other', amount: 5, expense_date: today }, hq.token)).status, 400);
  assert.equal((await t.api('POST', '/expenses', { expenseTypeId: fuel.body.id, amount: 5, expense_date: today }, cl.token)).status, 403);

  // the warehouse person records forklift diesel for their warehouse and sees only it
  const w = await t.api('POST', '/expenses', { expenseTypeId: forklift.body.id, amount: 30, expense_date: today }, wh.token);
  assert.equal(w.status, 201, JSON.stringify(w.body));
  assert.equal(w.body.warehouse_id, WH_MAIN); assert.equal(w.body.branch_id, null);
  const wl = (await t.api('GET', '/expenses?page=1&pageSize=50', undefined, wh.token)).body;
  assert.deepEqual(wl.items.map((x: any) => x.id), [w.body.id]);
  assert.equal(wl.items[0].branch_name, (await t.q('SELECT name FROM warehouses WHERE id = $1', [WH_MAIN]))[0].name);
  assert.equal((await t.api('DELETE', `/expenses/${e.body.id}`, undefined, wh.token)).status, 404, 'not theirs');

  // HQ changes the expense to another one of their list
  const ch = await t.api('PATCH', `/expenses/${e.body.id}`, { expenseTypeId: rent.body.id, title: '' }, hq.token);
  assert.equal(ch.status, 200, JSON.stringify(ch.body));
  const row = (await t.q('SELECT title, category, expense_account_id, expense_type_id FROM expenses WHERE id = $1', [e.body.id]))[0];
  assert.equal(row.category, 'Rent'); assert.equal(row.expense_account_id, rentAcc.id); assert.equal(row.expense_type_id, rent.body.id);

  // a stopped expense can no longer be recorded; the Owner still records anything
  await t.api('PATCH', `/expenses/types/${fuel.body.id}`, { is_active: false });
  assert.equal((await t.api('POST', '/expenses', { expenseTypeId: fuel.body.id, amount: 5, expense_date: today }, hq.token)).status, 400);
  assert.equal((await t.api('POST', '/expenses', { title: 'Owner one-off', category: 'Other', amount: 7, expense_date: today, branch_id: BRANCH_CL })).status, 201);
  assert.equal((await t.api('GET', '/accounting/trial-balance')).body.totals.is_balanced, true);
});
