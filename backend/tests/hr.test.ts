// Roadmap wave 4: attendance, commissions, payroll runs and their accounting.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, BRANCH_CL, type TestCtx } from './helpers';
let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });
const now = new Date();
const period = now.toISOString().slice(0, 7);
const day = (d: number) => `${period}-${String(d).padStart(2, '0')}`;

test('attendance: marked per day, a branch marks only its own people, summary per month', async () => {
  const hqE = (await t.api('POST', '/employees', { full_name: 'Att HQ', branch_id: BRANCH_HQ, salary: 260 })).body.id;
  const clE = (await t.api('POST', '/employees', { full_name: 'Att CL', branch_id: BRANCH_CL, salary: 260 })).body.id;
  const r = await t.api('PUT', '/hr/attendance', { date: day(1), records: [{ employeeId: hqE, status: 'PRESENT', checkIn: '08:00' }, { employeeId: clE, status: 'ABSENT' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await t.api('PUT', '/hr/attendance', { date: day(1), records: [{ employeeId: hqE, status: 'LATE', lateMinutes: 20 }] })).status, 200, 'changed the same day');
  const mgr = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['employees.manage'] });
  assert.equal((await t.api('PUT', '/hr/attendance', { date: day(1), records: [{ employeeId: clE, status: 'PRESENT' }] }, mgr.token)).status, 403);
  const list = (await t.api('GET', `/hr/attendance?date=${day(1)}`, undefined, mgr.token)).body.rows;
  assert.ok(list.every((x: any) => x.branch_id === BRANCH_HQ));
  assert.equal(list.find((x: any) => x.employee_id === hqE).status, 'LATE');
  const sum = (await t.api('GET', `/hr/attendance/summary?period=${period}`)).body.rows;
  assert.equal(sum.find((x: any) => x.employee_id === hqE).late, 1); assert.equal(sum.find((x: any) => x.employee_id === clE).absent, 1);
  assert.equal((await t.api('PUT', '/hr/attendance', { date: '2999-01-01', records: [{ employeeId: hqE, status: 'PRESENT' }] })).status, 400, 'not in the future');
  await t.q("UPDATE employees SET status = 'INACTIVE' WHERE id IN ($1, $2)", [hqE, clE]);
});

test('payroll: absences, commission (not on cancelled sales) and advances; approval and payment keep the books balanced', async () => {
  const seller = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const amina = (await t.api('POST', '/employees', { full_name: 'Amina Seller', branch_id: BRANCH_HQ, salary: 520 })).body.id;
  const farah = (await t.api('POST', '/employees', { full_name: 'Farah Driver', branch_id: BRANCH_CL, salary: 260 })).body.id;
  assert.equal((await t.api('PUT', `/hr/employees/${amina}/user`, { userId: seller.id })).status, 200);
  assert.equal((await t.api('PUT', `/hr/employees/${farah}/user`, { userId: seller.id })).status, 409, 'one user, one employee');
  // Amina sells 1,000 (one sale cancelled), commission 5% of net sales
  const p = await t.createProduct({ cost: 100, price: 500 });
  await t.setStock(p, 10, { branchId: BRANCH_HQ });
  const sell = () => t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, isCreditSale: true, initialDeposit: 1000, lines: [{ productId: p, quantity: 2 }] }, seller.token);
  assert.equal((await sell()).status, 201);
  const cancelled = await sell();
  assert.equal((await t.api('POST', `/sales/orders/${cancelled.body.id}/cancel`, { reason: 'test' })).status, 200);
  assert.equal((await t.api('POST', '/hr/commission-rules', { kind: 'PERCENT_REVENUE', rate: 5, employeeId: amina })).status, 201);
  assert.equal((await t.api('POST', '/hr/commission-rules', { kind: 'PERCENT_REVENUE', rate: 150 })).status, 400);
  const comm = (await t.api('GET', `/hr/commissions?period=${period}`)).body.rows;
  assert.equal(comm.find((x: any) => x.employee_id === amina).total, 50, '5% of 1,000; the cancelled sale does not count');
  // Farah: 2 days absent (26 working days → 10 each) and an advance of 30
  await t.api('PUT', '/hr/attendance', { date: day(2), records: [{ employeeId: farah, status: 'ABSENT' }] });
  await t.api('PUT', '/hr/attendance', { date: day(3), records: [{ employeeId: farah, status: 'ABSENT' }, { employeeId: amina, status: 'LEAVE' }] });
  assert.equal((await t.api('POST', `/employees/${farah}/advances`, { kind: 'ADVANCE', amount: 30 })).status, 201);
  // run
  const branchUser = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['payroll.manage', 'payroll.view'] });
  assert.equal((await t.api('POST', '/hr/payroll', { period }, branchUser.token)).status, 403, 'company payroll only');
  const run = await t.api('POST', '/hr/payroll', { period, workingDays: 26 });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  assert.equal((await t.api('POST', '/hr/payroll', { period })).status, 409);
  let view = (await t.api('GET', `/hr/payroll/${run.body.id}`)).body;
  const la = view.lines.find((l: any) => l.employee_id === amina), lf = view.lines.find((l: any) => l.employee_id === farah);
  assert.equal(la.basic, 520); assert.equal(la.attendance_deduction, 0, 'leave is paid'); assert.equal(la.commission, 50); assert.equal(la.net, 570);
  assert.equal(lf.attendance_deduction, 20); assert.equal(lf.advance_deduction, 30); assert.equal(lf.net, 210);
  // a bonus for Farah; too large an advance deduction is refused
  assert.equal((await t.api('PATCH', `/hr/payroll/${run.body.id}/lines/${lf.id}`, { additions: 15 })).body.net, 225);
  assert.equal((await t.api('PATCH', `/hr/payroll/${run.body.id}/lines/${lf.id}`, { advance_deduction: 31 })).status, 400);
  // approve
  const before6090 = await t.accountBalance('6090'), before2060 = await t.accountBalance('2060'), before1080 = await t.accountBalance('1080');
  const ap = await t.api('POST', `/hr/payroll/${run.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body)); assert.equal(ap.body.journal_entries.length >= 2, true, 'one entry per branch');
  assert.equal(r2(await t.accountBalance('6090') - before6090), 775, 'salaries: 520 + 260 - 20 + 15');
  assert.equal(r2(await t.accountBalance('2060') - before2060), -(570 + 225), 'salaries owed');
  assert.equal(r2(await t.accountBalance('1080') - before1080), -30, 'advance taken back');
  const emp = (await t.api('GET', `/employees/${farah}`)).body;
  assert.equal(Number(emp.advance_balance), 0);
  const ded = emp.advances.find((a: any) => a.method === 'SALARY_DEDUCTION');
  assert.equal((await t.api('DELETE', `/employees/${farah}/advances/${ded.id}`)).status, 409, 'stays with the payroll');
  assert.equal((await t.api('PATCH', `/hr/payroll/${run.body.id}/lines/${lf.id}`, { additions: 0 })).status, 400, 'approved payroll is locked');
  // pay: the account must be chosen; a branch account cannot pay another branch
  assert.equal((await t.api('POST', `/hr/payroll/${run.body.id}/pay`, {})).status, 400);
  const clAcc = await t.api('POST', '/accounting/money-accounts', { kind: 'CASH', provider: 'Cash', name: 'CL till', branchId: BRANCH_CL, opening: { amount: 500, source: 'NEW_MONEY' } });
  assert.equal((await t.api('POST', `/hr/payroll/${run.body.id}/pay`, { moneyAccountId: clAcc.body.id })).status, 400);
  assert.equal((await t.api('POST', `/hr/payroll/${run.body.id}/pay`, { moneyAccountId: clAcc.body.id, lineIds: [lf.id] })).body.total, 225);
  const zaad = await t.api('POST', '/accounting/money-accounts', { kind: 'MOBILE_MONEY', provider: 'ZAAD (Telesom)', name: 'Payroll ZAAD', opening: { amount: 1000, source: 'NEW_MONEY' } });
  const pay = await t.api('POST', `/hr/payroll/${run.body.id}/pay`, { moneyAccountId: zaad.body.id });
  assert.equal(pay.status, 200, JSON.stringify(pay.body)); assert.equal(pay.body.total, 570);
  assert.equal(r2(await t.accountBalance('2060') - before2060), 0, 'nothing owed any more');
  view = (await t.api('GET', `/hr/payroll/${run.body.id}`)).body;
  assert.equal(view.status, 'PAID');
  assert.equal((await t.api('POST', `/hr/payroll/${run.body.id}/pay`, { moneyAccountId: zaad.body.id })).status, 400, 'nothing left to pay');
  assert.equal((await t.api('GET', '/accounting/trial-balance')).body.totals.is_balanced, true);
});
const r2 = (n: number) => Math.round(n * 100) / 100;
