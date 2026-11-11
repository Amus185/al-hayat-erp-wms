// Roadmap wave 2: selling price levels, quotations, credit control, performance, targets, sales report.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, BRANCH_CL, type TestCtx } from './helpers';
let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const S = '/sales';
const orderLines = async (id: string) => t.q('SELECT product_id, quantity, unit_price::float AS unit_price, discount_amount::float AS discount_amount FROM sales_order_lines WHERE sales_order_id = $1', [id]);

test('price levels: the level comes from the customer, the Owner sets its prices, a seller cannot choose one', async () => {
  const p = await t.createProduct({ price: 100 }); const other = await t.createProduct({ price: 50 });
  await t.setStock(p, 20, { branchId: BRANCH_HQ }); await t.setStock(other, 20, { branchId: BRANCH_HQ });
  const levels = (await t.api('GET', `${S}/price-levels`)).body.levels;
  assert.deepEqual(levels.map((l: any) => l.name), ['Retail', 'Wholesale', 'Employee', 'Custom']);
  const seller = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal((await t.api('PUT', `${S}/products/${p}/level-prices`, { prices: [{ levelId: 'spl-wholesale', price: 80 }] }, seller.token)).status, 403, 'only the Owner sets prices');
  assert.equal((await t.api('PUT', `${S}/products/${p}/level-prices`, { prices: [{ levelId: 'spl-wholesale', price: 0 }] })).status, 400);
  assert.equal((await t.api('PUT', `${S}/products/${p}/level-prices`, { prices: [{ levelId: 'spl-wholesale', price: 80 }] })).status, 200);
  // a wholesale customer
  const mk = async (name: string) => (await t.api('POST', `${S}/customers`, { name }, seller.token)).body.id as string;
  const cust = await mk('Wholesale buyer');
  assert.equal((await t.api('PUT', `${S}/customers/${cust}/credit`, { priceLevelId: 'spl-wholesale' }, seller.token)).status, 403);
  assert.equal((await t.api('PUT', `${S}/customers/${cust}/credit`, { priceLevelId: 'spl-wholesale' })).status, 200);
  const sale = await t.api('POST', `${S}/orders`, { branchId: BRANCH_HQ, customerId: cust, lines: [{ productId: p, quantity: 2, unitPrice: 1 }, { productId: other, quantity: 1 }] }, seller.token);
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const lines = await orderLines(sale.body.id);
  assert.equal(lines.find((l: any) => l.product_id === p).unit_price, 80, 'wholesale price');
  assert.equal(lines.find((l: any) => l.product_id === other).unit_price, 50, 'no wholesale price set: regular price');
  assert.equal((await t.q('SELECT price_level_id FROM sales_orders WHERE id = $1', [sale.body.id]))[0].price_level_id, 'spl-wholesale');
  // a seller cannot pick a level for a retail customer; the Owner can
  const retail = await mk('Retail buyer');
  const refused = await t.api('POST', `${S}/orders`, { branchId: BRANCH_HQ, customerId: retail, priceLevelId: 'spl-wholesale', lines: [{ productId: p, quantity: 1 }] }, seller.token);
  assert.equal(refused.status, 403);
  const byOwner = await t.api('POST', `${S}/orders`, { branchId: BRANCH_HQ, customerId: retail, priceLevelId: 'spl-wholesale', lines: [{ productId: p, quantity: 1 }] });
  assert.equal((await orderLines(byOwner.body.id))[0].unit_price, 80);
  const plain = await t.api('POST', `${S}/orders`, { branchId: BRANCH_HQ, customerId: retail, lines: [{ productId: p, quantity: 1 }] }, seller.token);
  assert.equal((await orderLines(plain.body.id))[0].unit_price, 100);
});

test('quotations: priced by the server, kept after conversion, converted once, expired ones refused', async () => {
  const p = await t.createProduct({ price: 200 });
  await t.setStock(p, 10, { branchId: BRANCH_HQ });
  const cust = await t.createCustomer();
  const q = await t.api('POST', `${S}/quotations`, { branchId: BRANCH_HQ, customerId: cust, validDays: 7, lines: [{ productId: p, quantity: 2, unitPrice: 1, discountAmount: 20 }] });
  assert.equal(q.status, 201, JSON.stringify(q.body)); assert.equal(q.body.total_amount, 380);
  // the price changes afterwards: the quotation keeps what was quoted
  await t.q('UPDATE products SET selling_price = 250 WHERE id = $1', [p]);
  const other = await t.createCustomer();
  assert.equal((await t.api('POST', `${S}/orders`, { branchId: BRANCH_HQ, customerId: other, quotationId: q.body.id, lines: [{ productId: p, quantity: 2 }] })).status, 400, 'another customer');
  const sale = await t.api('POST', `${S}/orders`, { branchId: BRANCH_HQ, customerId: cust, quotationId: q.body.id, isCreditSale: true, lines: [{ productId: p, quantity: 2 }] });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const l = (await orderLines(sale.body.id))[0];
  assert.equal(l.unit_price, 200); assert.equal(l.discount_amount, 20);
  const view = await t.api('GET', `${S}/quotations/${q.body.id}`);
  assert.equal(view.body.status, 'CONVERTED'); assert.equal(view.body.converted_order_id, sale.body.id); assert.equal(view.body.lines.length, 1);
  assert.equal((await t.api('POST', `${S}/orders`, { branchId: BRANCH_HQ, customerId: cust, quotationId: q.body.id, lines: [{ productId: p, quantity: 2 }] })).status, 409, 'converted once');
  assert.equal((await t.api('PATCH', `${S}/quotations/${q.body.id}`, { status: 'CANCELLED' })).status, 400);
  // expired
  const q2 = await t.api('POST', `${S}/quotations`, { branchId: BRANCH_HQ, customerId: cust, lines: [{ productId: p, quantity: 1 }] });
  assert.equal(q2.body.total_amount, 250);
  await t.q(`UPDATE quotations SET valid_until = now() - interval '1 day' WHERE id = $1`, [q2.body.id]);
  assert.equal((await t.api('GET', `${S}/quotations/${q2.body.id}`)).body.status, 'EXPIRED');
  const late = await t.api('POST', `${S}/orders`, { branchId: BRANCH_HQ, customerId: cust, quotationId: q2.body.id, lines: [{ productId: p, quantity: 1 }] });
  assert.equal(late.status, 400); assert.match(late.body.message, /expired/);
  // another branch does not see it
  const cl = await t.createUser({ branchId: BRANCH_CL, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal((await t.api('GET', `${S}/quotations/${q.body.id}`, undefined, cl.token)).status, 404);
  assert.equal((await t.api('GET', `${S}/quotations`, undefined, cl.token)).body.quotations.length, 0);
  assert.equal((await t.api('GET', '/accounting/trial-balance')).body.totals.is_balanced, true);
});

test('credit control: a credit sale over the limit is refused; the Owner can approve it; overdue is shown', async () => {
  const p = await t.createProduct({ price: 100 });
  await t.setStock(p, 50, { branchId: BRANCH_HQ });
  const seller = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const cust = (await t.api('POST', `${S}/customers`, { name: 'Credit buyer' }, seller.token)).body.id as string;
  const sell = (qty: number, extra: Record<string, unknown> = {}, token?: string) => t.api('POST', `${S}/orders`, { branchId: BRANCH_HQ, customerId: cust, isCreditSale: true, lines: [{ productId: p, quantity: qty }], ...extra }, token);
  assert.equal((await sell(2, {}, seller.token)).status, 201, 'no limit set: nothing is blocked');
  assert.equal((await t.api('PUT', `${S}/customers/${cust}/credit`, { creditLimit: 500, creditDays: 10 })).status, 200);
  assert.equal((await sell(3, {}, seller.token)).status, 201, '200 + 300 = 500 is within the limit');
  const over = await sell(1, {}, seller.token);
  assert.equal(over.status, 400); assert.equal(over.body.code, 'CREDIT_LIMIT'); assert.match(over.body.message, /over the credit limit/);
  assert.equal((await sell(1, { creditOverride: true }, seller.token)).status, 400, 'a seller cannot approve it');
  assert.equal((await sell(1, { initialDeposit: 100 }, seller.token)).status, 201, 'paid in full now: no new debt');
  assert.equal((await sell(1, { creditOverride: true })).status, 201, 'the Owner approves');
  assert.equal((await t.q(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'CREDIT_LIMIT_OVERRIDE'`))[0].n, 1);
  // overdue after the customer's days to pay
  await t.q(`UPDATE invoices SET issued_at = now() - interval '15 days' WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE customer_id = $1)`, [cust]);
  const cr = (await t.api('GET', `${S}/customers/${cust}/credit`)).body;
  assert.equal(cr.outstanding, 600); assert.equal(cr.over_limit, true); assert.equal(cr.overdue_amount, 600); assert.equal(cr.oldest_overdue_days, 5);
  assert.ok((await t.api('GET', `${S}/credit-watch`)).body.customers.some((c: any) => c.customer_id === cust));
});

test('performance, targets and the sales report count invoices less discounts and returns, not cancelled sales', async () => {
  const p = await t.createProduct({ price: 100 });
  await t.setStock(p, 50, { branchId: BRANCH_CL });
  const seller = await t.createUser({ branchId: BRANCH_CL, roleId: 'role-branch-user', role: 'branch_user' });
  const cust = (await t.api('POST', `${S}/customers`, { name: 'Perf customer' }, seller.token)).body.id;
  const sell = (qty: number, discount = 0) => t.api('POST', `${S}/orders`, { branchId: BRANCH_CL, customerId: cust, isCreditSale: true, initialDeposit: qty * 100 - discount, lines: [{ productId: p, quantity: qty, discountAmount: discount }] }, seller.token);
  const a = await sell(5, 50); assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await sell(2); assert.equal(b.status, 201);
  assert.equal((await t.api('POST', `${S}/orders/${b.body.id}/cancel`, { reason: 'test' })).status, 200);
  const perf = await t.api('GET', `${S}/performance?from=${today}&to=${today}`);
  const mine = perf.body.rows.find((r: any) => r.user_id === seller.id);
  assert.equal(mine.sales, 1, 'the cancelled sale does not count'); assert.equal(mine.gross, 500); assert.equal(mine.discounts, 50); assert.equal(mine.net, 450);
  // targets
  assert.equal((await t.api('PUT', `${S}/targets`, { scopeType: 'EMPLOYEE', scopeId: seller.id, period: month, amount: 900 }, seller.token)).status, 403);
  assert.equal((await t.api('PUT', `${S}/targets`, { scopeType: 'EMPLOYEE', scopeId: seller.id, period: month, amount: 900 })).status, 200);
  assert.equal((await t.api('PUT', `${S}/targets`, { scopeType: 'BRANCH', scopeId: BRANCH_CL, period: month, amount: 4500 })).status, 200);
  assert.equal((await t.api('PUT', `${S}/targets`, { scopeType: 'COMPANY', period: month, amount: 100000 })).status, 200);
  const tg = (await t.api('GET', `${S}/targets?period=${month}`)).body.targets;
  const emp = tg.find((x: any) => x.scope_type === 'EMPLOYEE' && x.scope_id === seller.id);
  assert.equal(emp.actual, 450); assert.equal(emp.percent, 50); assert.equal(emp.remaining, 450);
  assert.equal(tg.find((x: any) => x.scope_type === 'BRANCH').percent, 10);
  const own = (await t.api('GET', `${S}/targets?period=${month}`, undefined, seller.token)).body.targets;
  assert.ok(!own.some((x: any) => x.scope_type === 'COMPANY'), 'a branch does not see the company target');
  // sales report: per day and per month, for the branch
  const day = await t.api('GET', `${S}/sales-report?group=day&from=${today}&to=${today}&sellerId=${seller.id}`);
  assert.equal(day.status, 200, JSON.stringify(day.body));
  assert.equal(day.body.rows.length, 1); assert.equal(day.body.totals.gross, 500); assert.equal(day.body.totals.discounts, 50); assert.equal(day.body.totals.net, 450);
  const mon = await t.api('GET', `${S}/sales-report?group=month&from=${month}-01&to=${today}&sellerId=${seller.id}`);
  assert.equal(mon.body.rows[0].period, month);
});
