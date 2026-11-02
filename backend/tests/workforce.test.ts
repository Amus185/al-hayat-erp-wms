// Manual manufacture with reusable item groups, employees with salary
// advances, depreciation in the reports, and incoming transfers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ as HQ, BRANCH_CL as CL, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

test('item groups: save, reuse, edit; a manufacture combines several groups and manual items; reopen and edit', async () => {
  const fadhi = await t.api('POST', '/manufacturing/item-groups', { name: 'Fadhi', items: [{ name: 'Wood frame', price: 120 }, { name: 'Foam', price: 45.5 }, { name: '', price: 9 }] });
  assert.equal(fadhi.status, 201, JSON.stringify(fadhi.body));
  assert.equal(fadhi.body.items.length, 2, 'blank rows are ignored');
  const bed = await t.api('POST', '/manufacturing/item-groups', { name: 'Somali Bed', items: [{ name: 'Bed frame', price: 200 }] });
  assert.equal(bed.status, 201);
  assert.equal((await t.api('POST', '/manufacturing/item-groups', { name: 'fadhi', items: [{ name: 'x', price: 1 }] })).status, 409, 'names are unique');

  const found = await t.api('GET', '/manufacturing/item-groups?q=som');
  assert.deepEqual(found.body.map((g: any) => g.name), ['Somali Bed']);
  assert.equal(found.body[0].items[0].name, 'Bed frame');

  const edited = await t.api('PUT', `/manufacturing/item-groups/${bed.body.id}`, { name: 'Somali Bed', items: [{ name: 'Bed frame', price: 210 }, { name: 'Headboard', price: 40 }] });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.items.length, 2);

  const job = await t.api('POST', '/manufacturing/jobs', {
    items: [
      { name: 'Wood frame', price: 120, group_name: 'Fadhi' }, { name: 'Foam', price: 45.5, group_name: 'Fadhi' },
      { name: 'Bed frame', price: 210, group_name: 'Somali Bed' }, { name: 'Varnish', price: 10 },
    ],
  });
  assert.equal(job.status, 201, JSON.stringify(job.body));
  assert.match(job.body.job_number, /^MF-\d{5}$/);
  assert.equal(job.body.title, 'Fadhi + Somali Bed', 'title defaults to the groups');
  assert.equal(job.body.total, 385.5);

  const reopened = await t.api('GET', `/manufacturing/jobs/${job.body.id}`);
  assert.deepEqual(reopened.body.items.map((i: any) => i.name), ['Wood frame', 'Foam', 'Bed frame', 'Varnish']);
  const upd = await t.api('PUT', `/manufacturing/jobs/${job.body.id}`, { title: 'Order for Ali', items: [...reopened.body.items.slice(0, 3), { name: 'Varnish', price: 15 }] });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.total, 390.5);

  const list = await t.api('GET', '/manufacturing/jobs?page=1&q=Ali');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].groups, 'Fadhi, Somali Bed');
  assert.equal((await t.api('GET', '/manufacturing/jobs?page=1&q=Varnish')).body.total, 1, 'search finds item names');

  assert.equal((await t.api('POST', `/manufacturing/jobs/${job.body.id}/status`, { status: 'DONE' })).body.status, 'DONE');
  assert.equal((await t.api('PUT', `/manufacturing/jobs/${job.body.id}`, { items: [{ name: 'x', price: 1 }] })).status, 400, 'a finished manufacture is not edited');
  assert.equal((await t.api('POST', '/manufacturing/jobs', { items: [{ name: '', price: 3 }] })).status, 400);
  assert.equal((await t.api('DELETE', `/manufacturing/item-groups/${fadhi.body.id}`)).status, 200);
  assert.equal((await t.api('GET', `/manufacturing/item-groups/${fadhi.body.id}`)).status, 404);
});

test('employees: profile, advances and repayments post to the books, balance and history', async () => {
  const emp = await t.api('POST', '/employees', { full_name: 'Hodan Ali', position: 'Cashier', branch_id: HQ, salary: 400, hire_date: '2026-01-10', photo_key: 'uploads/p.jpg', document_key: 'uploads/c.pdf', document_name: 'contract.pdf' });
  assert.equal(emp.status, 201, JSON.stringify(emp.body));
  const id = emp.body.id;
  const adv1 = await t.api('POST', `/employees/${id}/advances`, { amount: 150, entry_date: '2026-03-01', notes: 'Rent' });
  assert.equal(adv1.status, 201, JSON.stringify(adv1.body));
  await t.api('POST', `/employees/${id}/advances`, { amount: 50, method: 'BANK' });
  const rep = await t.api('POST', `/employees/${id}/advances`, { kind: 'REPAYMENT', amount: 80, method: 'SALARY_DEDUCTION' });
  assert.equal(rep.status, 201, JSON.stringify(rep.body));
  assert.equal((await t.api('POST', `/employees/${id}/advances`, { kind: 'REPAYMENT', amount: 500 })).status, 400, 'cannot repay more than owed');
  assert.equal((await t.api('POST', `/employees/${id}/advances`, { amount: 0 })).status, 400);

  const profile = await t.api('GET', `/employees/${id}`);
  assert.equal(Number(profile.body.salary), 400);
  assert.equal(profile.body.total_advances, 200);
  assert.equal(profile.body.total_repaid, 80);
  assert.equal(profile.body.advance_balance, 120);
  assert.equal(profile.body.advances.length, 3);
  assert.equal(profile.body.document_name, 'contract.pdf');
  assert.equal(await t.accountBalance('1080'), 120, 'Employee Advances holds what is still owed');
  assert.equal(await t.accountBalance('6090'), 80, 'deducted from salary is payroll cost');

  // Edit and reopen
  const patched = await t.api('PATCH', `/employees/${id}`, { salary: 450, position: 'Senior cashier' });
  assert.equal(Number(patched.body.salary), 450);
  assert.equal(patched.body.position, 'Senior cashier');
  assert.equal(patched.body.full_name, 'Hodan Ali', 'fields not sent stay');

  const list = await t.api('GET', '/employees?page=1&q=hodan');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.totals.balance, 120);
  assert.equal((await t.api('GET', '/employees?page=1&balance=owing')).body.total, 1);

  // Deleting an advance that repayments depend on is refused; a repayment can be deleted (journal reversed)
  assert.equal((await t.api('DELETE', `/employees/${id}/advances/${adv1.body.id}`)).status, 409);
  assert.equal((await t.api('DELETE', `/employees/${id}/advances/${rep.body.id}`)).status, 200);
  assert.equal(await t.accountBalance('6090'), 0);
  assert.equal(await t.accountBalance('1080'), 200);
  assert.equal((await t.api('DELETE', `/employees/${id}`)).status, 409, 'history is kept: mark inactive instead');

  const repUser = await t.createUser({ branchId: HQ, roleId: 'role-sales-rep', role: 'sales_rep' });
  assert.equal((await t.api('GET', '/employees?page=1', undefined, repUser.token)).status, 403, 'needs user management permission');
});

test('depreciation shows in the income statement (expense) and balance sheet (accumulated depreciation)', async () => {
  const before = await t.api('GET', '/accounting/income-statement');
  const expBefore = Number(before.body.summary.total_expenses);
  const rec = await t.api('POST', '/accounting/depreciation', { asset_name: 'Generator', acquisition_date: new Date().toISOString().slice(0, 10), cost: 6000, useful_life_years: 5, period_depreciation: 100 });
  assert.equal(rec.status, 201, JSON.stringify(rec.body));
  const is = await t.api('GET', '/accounting/income-statement');
  assert.equal(Math.round((Number(is.body.summary.total_expenses) - expBefore) * 100) / 100, 100);
  assert.ok(is.body.expenses.some((e: any) => e.code === '6060' && Number(e.amount) >= 100));
  const bs = await t.api('GET', '/accounting/balance-sheet');
  const acc = bs.body.assets.find((a: any) => a.code === '1501');
  assert.ok(acc && Number(acc.balance) <= -100, `accumulated depreciation reduces assets: ${JSON.stringify(acc)}`);
  assert.equal(bs.body.verification.trial_balance_balanced, true);
  assert.equal(bs.body.totals.is_balanced, true, JSON.stringify(bs.body.totals));
});

test('incoming transfers: the receiving location sees items, quantities, sender and status, and is notified', async () => {
  const pid = await t.createProduct({ price: 10 });
  await t.setStock(pid, 20, { warehouseId: WH_MAIN });
  const receiver = await t.createUser({ branchId: CL, roleId: 'role-branch-user', role: 'branch_user' });
  const tr = await t.api('POST', '/transfers', {
    sourceOwnerType: 'WAREHOUSE', sourceWarehouseId: WH_MAIN, destinationOwnerType: 'BRANCH', destinationBranchId: CL,
    lines: [{ productId: pid, quantityRequested: 4 }],
  });
  assert.equal(tr.status, 201, JSON.stringify(tr.body));
  const incoming = await t.api('GET', '/transfers?page=1&direction=incoming', undefined, receiver.token);
  assert.equal(incoming.status, 200, JSON.stringify(incoming.body));
  const row = incoming.body.items.find((r: any) => r.id === tr.body.id);
  assert.ok(row, 'listed as incoming for the destination branch');
  assert.match(row.items_summary, /^4 × /);
  assert.ok(row.source_name);
  assert.equal((await t.api('GET', '/transfers?page=1&direction=outgoing', undefined, receiver.token)).body.items.some((r: any) => r.id === tr.body.id), false);
  const notes = await t.q(`SELECT title, message FROM notifications WHERE user_id = $1 AND type = 'TRANSFER'`, [receiver.id]);
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /4 × .*Status: PENDING APPROVAL/);
  const disp = await t.api('POST', `/transfers/${tr.body.id}/dispatch`);
  assert.equal(disp.status, 200, JSON.stringify(disp.body));
  assert.equal((await t.q(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'TRANSFER'`, [receiver.id]))[0].n, 2, 'told again when dispatched');
});
