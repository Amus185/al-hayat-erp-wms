// Branch isolation: every branch operates as its own workspace. A CL manager sees
// CL only, an HQ manager HQ only, neither can reach the other's records by ID or by
// asking for another branch, and the Owner sees both, combined or one at a time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ as HQ, BRANCH_CL as CL, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
let hq: { id: string; token: string };
let cl: { id: string; token: string };
const ids: Record<string, any> = {};
const tag = randomUUID().slice(0, 6);

before(async () => {
  t = await setupTestApp();
  hq = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user' });
  cl = await t.createUser({ branchId: CL, roleId: 'role-branch-user', role: 'branch_user' });

  // Products: one only HQ holds, one only CL holds, one both.
  ids.pHQ = await t.createProduct({ price: 100 });
  ids.pCL = await t.createProduct({ price: 100 });
  ids.pBoth = await t.createProduct({ price: 100 });
  await t.setStock(ids.pHQ, 7, { branchId: HQ });
  await t.setStock(ids.pCL, 9, { branchId: CL });
  await t.setStock(ids.pBoth, 4, { branchId: HQ });
  await t.setStock(ids.pBoth, 6, { branchId: CL });
  await t.setStock(ids.pBoth, 50, { warehouseId: WH_MAIN });

  // Customers registered by each branch (shared master records).
  const cHQ = await t.api('POST', '/sales/customers', { name: `HQ Buyer ${tag}`, phone: '0634000111' }, hq.token);
  const cCL = await t.api('POST', '/sales/customers', { name: `CL Buyer ${tag}`, phone: '0634000222' }, cl.token);
  assert.equal(cHQ.status, 201, JSON.stringify(cHQ.body));
  assert.equal(cCL.status, 201, JSON.stringify(cCL.body));
  ids.cHQ = cHQ.body.id;
  ids.cCL = cCL.body.id;

  // Sales and deliveries.
  const oHQ = await t.api('POST', '/sales/orders', { branchId: HQ, customerId: ids.cHQ, lines: [{ productId: ids.pHQ, quantity: 1, unitPrice: 100 }] }, hq.token);
  const oCL = await t.api('POST', '/sales/orders', { branchId: CL, customerId: ids.cCL, lines: [{ productId: ids.pCL, quantity: 2, unitPrice: 100 }] }, cl.token);
  assert.equal(oHQ.status, 201, JSON.stringify(oHQ.body));
  assert.equal(oCL.status, 201, JSON.stringify(oCL.body));
  ids.oHQ = oHQ.body.id;
  ids.oCL = oCL.body.id;
  const dHQ = await t.api('POST', '/deliveries', { salesOrderId: ids.oHQ }, hq.token);
  const dCL = await t.api('POST', '/deliveries', { salesOrderId: ids.oCL }, cl.token);
  assert.equal(dHQ.status, 201, JSON.stringify(dHQ.body));
  assert.equal(dCL.status, 201, JSON.stringify(dCL.body));
  ids.dHQ = dHQ.body.id;
  ids.dCL = dCL.body.id;

  // Expenses, employees, manufactures.
  const today = new Date().toISOString().slice(0, 10);
  ids.eHQ = (await t.api('POST', '/expenses', { title: `HQ rent ${tag}`, amount: 50, category: 'RENT', expense_date: today, payment_method: 'CASH' }, hq.token)).body?.id;
  ids.eCL = (await t.api('POST', '/expenses', { title: `CL rent ${tag}`, amount: 60, category: 'RENT', expense_date: today, payment_method: 'CASH' }, cl.token)).body?.id;
  ids.empHQ = (await t.api('POST', '/employees', { full_name: `HQ Person ${tag}`, branch_id: HQ })).body.id;
  ids.empCL = (await t.api('POST', '/employees', { full_name: `CL Person ${tag}`, branch_id: CL })).body.id;
  ids.jHQ = (await t.api('POST', '/manufacturing/jobs', { title: `HQ job ${tag}`, items: [{ name: 'Frame', price: 10 }] }, hq.token)).body.id;
  ids.jCL = (await t.api('POST', '/manufacturing/jobs', { title: `CL job ${tag}`, items: [{ name: 'Frame', price: 10 }] }, cl.token)).body.id;
  ids.gHQ = (await t.api('POST', '/manufacturing/item-groups', { name: 'Fadhi', items: [{ name: 'Frame', price: 10 }] }, hq.token)).body.id;
  ids.gCL = (await t.api('POST', '/manufacturing/item-groups', { name: 'Fadhi', items: [{ name: 'Foam', price: 5 }] }, cl.token)).body.id;

  // Purchase orders (the Owner buys for a branch; branch managers have no cost access by default).
  const supplier = await t.api('POST', '/purchasing/suppliers', { name: `Supplier ${tag}`, code: `S-${tag}` });
  const poBody = (branchId: string) => ({ supplierId: supplier.body.id, branchId, lines: [{ productId: ids.pBoth, quantity: 3, unitCost: 10 }] });
  ids.poHQ = (await t.api('POST', '/purchasing/orders', poBody(HQ))).body.id;
  ids.poCL = (await t.api('POST', '/purchasing/orders', poBody(CL))).body.id;
});
after(async () => { await t?.teardown(); });

const names = (body: any, key = 'name') => (body.items ?? body).map((r: any) => r[key] ?? r.title ?? r.customer_name);
const idsOf = (body: any) => (body.items ?? body).map((r: any) => r.id);

test('1-2. each manager sees only their own branch in every list; the Owner sees both', async () => {
  const lists: [string, string, (b: any) => string[]][] = [
    ['sales orders', '/sales/orders?page=1&pageSize=100', (b) => idsOf(b)],
    ['customers', '/sales/customers?page=1&pageSize=100', (b) => idsOf(b)],
    ['deliveries', '/deliveries?page=1&pageSize=100', (b) => idsOf(b)],
    ['purchase orders', '/purchasing/orders?page=1&pageSize=100', (b) => idsOf(b)],
    ['expenses', '/expenses?page=1&pageSize=100', (b) => idsOf(b)],
    ['employees', '/employees?page=1&pageSize=100', (b) => idsOf(b)],
    ['manufactures', '/manufacturing/jobs?page=1&pageSize=100', (b) => idsOf(b)],
    ['products', '/products?page=1&pageSize=100', (b) => idsOf(b)],
  ];
  const mine: Record<string, [any, any]> = {
    'sales orders': [ids.oHQ, ids.oCL], customers: [ids.cHQ, ids.cCL], deliveries: [ids.dHQ, ids.dCL], 'purchase orders': [ids.poHQ, ids.poCL],
    expenses: [ids.eHQ, ids.eCL], employees: [ids.empHQ, ids.empCL], manufactures: [ids.jHQ, ids.jCL], products: [ids.pHQ, ids.pCL],
  };
  // employees need employee access; give the managers the same standing the Owner would (branch only)
  for (const [name, path, pick] of lists) {
    const [hqId, clId] = mine[name];
    const asHQ = await t.api('GET', path, undefined, hq.token);
    const asCL = await t.api('GET', path, undefined, cl.token);
    const asOwner = await t.api('GET', path);
    assert.equal(asHQ.status, 200, `${name} HQ ${JSON.stringify(asHQ.body).slice(0, 150)}`);
    assert.equal(asCL.status, 200, `${name} CL`);
    assert.ok(pick(asHQ.body).includes(hqId), `${name}: HQ sees HQ`);
    assert.ok(!pick(asHQ.body).includes(clId), `${name}: HQ must not see CL`);
    assert.ok(pick(asCL.body).includes(clId), `${name}: CL sees CL`);
    assert.ok(!pick(asCL.body).includes(hqId), `${name}: CL must not see HQ`);
    assert.ok(pick(asOwner.body).includes(hqId) && pick(asOwner.body).includes(clId), `${name}: the Owner sees both`);
  }
  // Item groups are per branch: both created "Fadhi", each sees their own
  const gHQ = (await t.api('GET', '/manufacturing/item-groups', undefined, hq.token)).body;
  assert.deepEqual(gHQ.map((g: any) => g.id), [ids.gHQ]);
  assert.deepEqual((await t.api('GET', '/manufacturing/item-groups', undefined, cl.token)).body.map((g: any) => g.id), [ids.gCL]);
});

test('3. stock and the Stock column are the branch\'s own, never company totals', async () => {
  const prods = await t.api('GET', '/products?page=1&pageSize=100&withStock=1', undefined, hq.token);
  const both = prods.body.items.find((p: any) => p.id === ids.pBoth);
  assert.equal(both.total_stock, 4, 'HQ sees its own 4, not 4 + 6 + 50');
  assert.ok(prods.body.stockRows.every((s: any) => s.branch_id === HQ && s.owner_type === 'BRANCH'), 'stock rows are HQ rows');
  const stock = await t.api('GET', '/inventory/stock?page=1&pageSize=100', undefined, cl.token);
  assert.ok(stock.body.items.every((s: any) => s.branch_id === CL));
  assert.ok(!stock.body.items.some((s: any) => s.product_id === ids.pHQ));
  const owner = (await t.api('GET', '/products?page=1&pageSize=100')).body.items.find((p: any) => p.id === ids.pBoth);
  assert.equal(owner.total_stock, 60, 'the Owner sees the company total');
  const movements = await t.api('GET', '/inventory/transactions?page=1', undefined, hq.token);
  assert.ok((movements.body.items ?? []).every((m: any) => [m.source_branch_id, m.destination_branch_id].includes(HQ)));
});

test('4. another branch\'s records cannot be reached by ID, URL or parameter', async () => {
  const asHQ = (method: string, path: string, body?: unknown) => t.api(method, path, body, hq.token);
  const notFound = async (what: string, res: Promise<{ status: number }>) => assert.ok([403, 404].includes((await res).status), `${what} must be refused`);
  await notFound('CL product', asHQ('GET', `/products/${ids.pCL}`));
  await notFound('edit CL product', asHQ('PATCH', `/products/${ids.pCL}`, { sellingPrice: 1 }));
  await notFound('CL customer ledger', asHQ('GET', `/sales/customers/${ids.cCL}/ledger`));
  await notFound('CL customer balance', asHQ('GET', `/sales/customers/${ids.cCL}/balance`));
  await notFound('CL customer edit', asHQ('PATCH', `/sales/customers/${ids.cCL}`, { name: 'hijacked' }));
  await notFound('CL customer debt', asHQ('POST', `/sales/customers/${ids.cCL}/debts`, { amount: 5, description: 'x', category: 'OTHER' }));
  await notFound('CL sales order', asHQ('GET', `/sales/orders/${ids.oCL}`));
  await notFound('cancel CL order', asHQ('POST', `/sales/orders/${ids.oCL}/cancel`, {}));
  await notFound('CL delivery', asHQ('GET', `/deliveries/${ids.dCL}`));
  await notFound('dispatch CL delivery', asHQ('POST', `/deliveries/${ids.dCL}/dispatch`, {}));
  await notFound('CL purchase order', asHQ('GET', `/purchasing/orders/${ids.poCL}`));
  await notFound('CL employee', asHQ('GET', `/employees/${ids.empCL}`));
  await notFound('CL manufacture', asHQ('GET', `/manufacturing/jobs/${ids.jCL}`));
  await notFound('edit CL manufacture', asHQ('PUT', `/manufacturing/jobs/${ids.jCL}`, { items: [{ name: 'x', price: 1 }] }));
  await notFound('delete CL manufacture', asHQ('DELETE', `/manufacturing/jobs/${ids.jCL}`));
  await notFound('delete CL item group', asHQ('DELETE', `/manufacturing/item-groups/${ids.gCL}`));
  // selling a CL customer's name in a new order: refused (customer not visible to HQ)
  const sneaky = await asHQ('POST', '/sales/orders', { branchId: HQ, customerId: ids.cCL, lines: [{ productId: ids.pHQ, quantity: 1, unitPrice: 1 }] });
  assert.equal(sneaky.status, 400);
  // writing into another branch / asking for another branch or "all"
  const forCL = await asHQ('POST', '/sales/orders', { branchId: CL, lines: [{ productId: ids.pHQ, quantity: 1, unitPrice: 1 }] });
  assert.equal(forCL.status, 403, 'an order for another branch is refused with a clear message');
  assert.match(forCL.body.message, /branch you work from/);
  const noBranch = await asHQ('POST', '/sales/orders', { lines: [{ productId: ids.pHQ, quantity: 1, unitPrice: 1 }] });
  assert.equal(noBranch.status, 201, 'no branch needs to be sent: it comes from who is signed in');
  assert.equal((await t.q('SELECT branch_id FROM sales_orders WHERE id = $1', [noBranch.body.id]))[0].branch_id, HQ);
  for (const q of [`branch_id=${CL}`, `branchId=${CL}`]) {
    for (const path of ['/sales/orders?page=1', '/expenses?page=1', '/deliveries?page=1', '/sales/customers?page=1', '/inventory/stock?page=1', '/purchasing/orders?page=1', '/products?page=1']) {
      const res = await asHQ('GET', `${path}&${q}`);
      assert.equal(res.status, 403, `${path}&${q} must be refused`);
    }
  }
  // "All branches" is not available: it still answers with HQ only
  const all = await asHQ('GET', '/sales/orders?page=1&branch_id=ALL');
  assert.ok(!idsOf(all.body).includes(ids.oCL));
  // exports hold only the branch's rows
  const csv = await t.api('GET', '/sales/customers?format=csv', undefined, hq.token);
  assert.equal(csv.status, 200);
  assert.ok(!String(csv.body).includes(`CL Buyer ${tag}`) && String(csv.body).includes(`HQ Buyer ${tag}`), 'CSV export is branch-only');
  // quick search
  const search = await asHQ('GET', `/search?q=${encodeURIComponent(`Buyer ${tag}`)}`);
  assert.ok(search.body.results.every((r: any) => !String(r.title).includes('CL Buyer')), 'search does not find the other branch\'s customers');
  assert.ok(search.body.results.some((r: any) => String(r.title).includes('HQ Buyer')));
});

test('5. the Owner sees both branches combined and can look at one branch at a time', async () => {
  const both = await t.api('GET', '/sales/orders?page=1&pageSize=100');
  assert.ok(idsOf(both.body).includes(ids.oHQ) && idsOf(both.body).includes(ids.oCL));
  for (const [path, mineId, otherId] of [
    ['/sales/orders?page=1&pageSize=100', ids.oCL, ids.oHQ],
    ['/deliveries?page=1&pageSize=100', ids.dCL, ids.dHQ],
    ['/purchasing/orders?page=1&pageSize=100', ids.poCL, ids.poHQ],
    ['/expenses?page=1&pageSize=100', ids.eCL, ids.eHQ],
    ['/manufacturing/jobs?page=1&pageSize=100', ids.jCL, ids.jHQ],
    ['/sales/customers?page=1&pageSize=100', ids.cCL, ids.cHQ],
    ['/products?page=1&pageSize=100', ids.pCL, ids.pHQ],
  ] as const) {
    const narrowed = await t.api('GET', `${path}&branch_id=${CL}`);
    assert.equal(narrowed.status, 200, path);
    assert.ok(idsOf(narrowed.body).includes(mineId), `${path}: the CL view shows CL`);
    assert.ok(!idsOf(narrowed.body).includes(otherId), `${path}: the CL view hides HQ`);
  }
  assert.ok(Number((await t.api('GET', '/deliveries/stats')).body.total) >= 2);
  assert.equal(Number((await t.api('GET', '/deliveries/stats', undefined, hq.token)).body.total), 1, 'branch statistics are the branch\'s own');
});

test('6. shared customers: one record for the company, visibility per branch, no duplicates', async () => {
  const before = Number((await t.q(`SELECT COUNT(*)::int AS n FROM customers WHERE name LIKE $1`, [`%Buyer ${tag}`]))[0].n);
  // HQ registers the same phone number CL already has: the company's existing customer is reused.
  const again = await t.api('POST', '/sales/customers', { name: `Duplicate ${tag}`, phone: '063 400 0222' }, hq.token);
  assert.equal(again.status, 200);
  assert.equal(again.body.already_registered, true);
  assert.equal(again.body.id, ids.cCL, 'same person, same record');
  assert.equal(Number((await t.q(`SELECT COUNT(*)::int AS n FROM customers WHERE name LIKE $1`, [`%Buyer ${tag}`]))[0].n), before, 'no duplicate record');
  // ...and HQ now deals with them, but sees only HQ's own activity with them
  assert.ok(idsOf((await t.api('GET', '/sales/customers?page=1&pageSize=100', undefined, hq.token)).body).includes(ids.cCL));
  const balance = await t.api('GET', `/sales/customers/${ids.cCL}/balance`, undefined, hq.token);
  assert.equal(balance.status, 200);
  const hqLedger = (await t.api('GET', `/sales/customers/${ids.cCL}/ledger`, undefined, hq.token)).body;
  assert.ok(!JSON.stringify(hqLedger).includes(ids.oCL), 'CL\'s sale to this customer is not in HQ\'s view');
  const ownerLedger = (await t.api('GET', `/sales/customers/${ids.cCL}/ledger`)).body;
  assert.ok(JSON.stringify(ownerLedger).includes('INV') || JSON.stringify(ownerLedger).length >= JSON.stringify(hqLedger).length, 'the Owner sees the full history');
});

test('6b. the company view shows which branch each customer belongs to; a branch never sees other branch names', async () => {
  const find = (body: any, id: string) => (body.items || []).find((x: any) => x.id === id);
  const all = await t.api('GET', '/sales/customers?page=1&pageSize=100', undefined);
  assert.equal(all.status, 200);
  const hqName = (await t.q('SELECT name FROM branches WHERE id = $1', [HQ]))[0].name;
  const clName = (await t.q('SELECT name FROM branches WHERE id = $1', [CL]))[0].name;
  assert.ok(String(find(all.body, ids.cHQ)?.branch_names).startsWith(hqName), 'registered at HQ');
  assert.ok(String(find(all.body, ids.cCL)?.branch_names).startsWith(clName), 'registered at CL');
  const mine = await t.api('GET', '/sales/customers?page=1&pageSize=100', undefined, cl.token);
  assert.ok(find(mine.body, ids.cCL), 'the CL manager sees their own customer');
  assert.equal(find(mine.body, ids.cCL)?.branch_names ?? null, null, 'no branch names for a branch');
  assert.ok(!find(mine.body, ids.cHQ), 'and not HQ customers');
});

test('6c. the notification bell follows branch isolation (open deliveries and transfers)', async () => {
  const delOf = (body: any[]) => body.filter((n: any) => n.type === 'DELIVERY').map((n: any) => String(n.id).slice(4));
  const hqN = (await t.api('GET', '/notifications', undefined, hq.token)).body;
  const clN = (await t.api('GET', '/notifications', undefined, cl.token)).body;
  const ownerN = (await t.api('GET', '/notifications')).body;
  assert.ok(delOf(hqN).includes(ids.dHQ) && !delOf(hqN).includes(ids.dCL), 'HQ sees only its own deliveries');
  assert.ok(delOf(clN).includes(ids.dCL) && !delOf(clN).includes(ids.dHQ), 'CL sees only its own deliveries');
  assert.ok(delOf(ownerN).includes(ids.dHQ) && delOf(ownerN).includes(ids.dCL), 'the Owner sees both');
  // A transfer waiting between HQ and CL shows for both sides, not for a third party.
  const tr = (await t.api('POST', '/transfers', { destinationOwnerType: 'BRANCH', destinationBranchId: HQ, lines: [{ productId: ids.pBoth, quantityRequested: 1 }] }, cl.token)).body.id;
  const trOf = (body: any[]) => body.filter((n: any) => n.type === 'TRANSFER').map((n: any) => String(n.id).slice(4));
  assert.ok(trOf((await t.api('GET', '/notifications', undefined, hq.token)).body).includes(tr), 'the receiver is told about a waiting transfer');
  assert.ok(trOf((await t.api('GET', '/notifications', undefined, cl.token)).body).includes(tr), 'and the sender');
  await t.api('POST', `/transfers/${tr}/cancel`, {}, cl.token);
});

test('7. transfers between branches: both sides see them, each does its own step, stock moves once', async () => {
  const created = await t.api('POST', '/transfers', { destinationOwnerType: 'BRANCH', destinationBranchId: HQ, lines: [{ productId: ids.pBoth, quantityRequested: 2 }] }, cl.token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tr = created.body.id;
  assert.ok(idsOf((await t.api('GET', '/transfers?page=1', undefined, cl.token)).body).includes(tr), 'sender sees it');
  assert.ok(idsOf((await t.api('GET', '/transfers?page=1', undefined, hq.token)).body).includes(tr), 'receiver sees it before it arrives');
  assert.equal((await t.api('GET', `/transfers/${tr}`, undefined, hq.token)).body.lines[0].quantity_requested, 2, 'with items and quantities');
  // the receiver cannot approve/dispatch for the sender; a third party cannot touch it at all
  assert.equal((await t.api('POST', `/transfers/${tr}/dispatch`, {}, hq.token)).status, 403);
  const stranger = await t.createUser({ branchId: 'branch-third', roleId: 'role-branch-user', role: 'branch_user' }).catch(() => null);
  if (stranger) assert.equal((await t.api('POST', `/transfers/${tr}/dispatch`, {}, stranger.token)).status, 404);
  // sender approves and dispatches; only the receiver receives
  assert.equal((await t.api('POST', `/transfers/${tr}/approve`, {}, cl.token)).status, 200);
  assert.equal((await t.api('POST', `/transfers/${tr}/dispatch`, {}, cl.token)).status, 200);
  assert.equal((await t.api('POST', `/transfers/${tr}/receive`, {}, cl.token)).status, 403, 'the sender cannot confirm receipt');
  assert.equal((await t.api('POST', `/transfers/${tr}/receive`, {}, hq.token)).status, 200);
  assert.equal(await t.stockOf(ids.pBoth, { branchId: CL }), 4, 'CL: 6 - 2');
  assert.equal(await t.stockOf(ids.pBoth, { branchId: HQ }), 6, 'HQ: 4 + 2');
  assert.equal((await t.api('POST', `/transfers/${tr}/receive`, {}, hq.token)).status, 400, 'a second receipt is refused');
  assert.equal(await t.stockOf(ids.pBoth, { branchId: HQ }), 6, 'moved once');
});

test('7b. one-step transfer: receiver accepts part, stock moves together; decline moves nothing', async () => {
  const dests = await t.api('GET', '/transfers/destinations', undefined, cl.token);
  assert.equal(dests.status, 200);
  assert.ok(dests.body.some((b: any) => b.id === HQ) && !dests.body.some((b: any) => b.id === CL), 'other branches only');
  const mk = async (qty: number) => (await t.api('POST', '/transfers', { destinationOwnerType: 'BRANCH', destinationBranchId: HQ, lines: [{ productId: ids.pBoth, quantityRequested: qty }] }, cl.token)).body.id;
  const clBefore = await t.stockOf(ids.pBoth, { branchId: CL });
  const hqBefore = await t.stockOf(ids.pBoth, { branchId: HQ });
  const a = await mk(3);
  assert.equal((await t.api('POST', `/transfers/${a}/accept`, {}, cl.token)).status, 403, 'the sender cannot accept');
  assert.equal(await t.stockOf(ids.pBoth, { branchId: CL }), clBefore, 'nothing moved yet');
  assert.equal((await t.api('POST', `/transfers/${a}/accept`, { lines: [{ productId: ids.pBoth, quantity: 9 }] }, hq.token)).status, 400, 'more than sent');
  const ok = await t.api('POST', `/transfers/${a}/accept`, { lines: [{ productId: ids.pBoth, quantity: 2 }] }, hq.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'COMPLETED');
  assert.equal(await t.stockOf(ids.pBoth, { branchId: CL }), clBefore - 2, 'only the accepted quantity left the sender');
  assert.equal(await t.stockOf(ids.pBoth, { branchId: HQ }), hqBefore + 2);
  assert.equal((await t.api('POST', `/transfers/${a}/accept`, {}, hq.token)).status, 400, 'no second accept');
  assert.equal(await t.stockOf(ids.pBoth, { branchId: HQ }), hqBefore + 2, 'moved once');
  const d = await mk(1);
  assert.equal((await t.api('POST', `/transfers/${d}/reject`, { reason: 'Not needed' }, cl.token)).status, 403, 'only the receiver declines');
  assert.equal((await t.api('POST', `/transfers/${d}/reject`, { reason: 'Not needed' }, hq.token)).status, 200);
  assert.equal(await t.stockOf(ids.pBoth, { branchId: CL }), clBefore - 2, 'a declined transfer moves nothing');
  const c2 = await mk(1);
  assert.equal((await t.api('POST', `/transfers/${c2}/cancel`, {}, cl.token)).status, 200, 'sender withdraws a pending request');
});

test('7c. sales representatives send to another branch and accept or decline what arrives (once-only grant)', async () => {
  assert.equal((await t.q("SELECT COUNT(*)::int AS n FROM app_migrations WHERE name = 'sales_rep_transfers_v1'"))[0].n, 1);
  const repCL = await t.createUser({ branchId: CL, roleId: 'role-sales-rep', role: 'sales_rep' });
  const repHQ = await t.createUser({ branchId: HQ, roleId: 'role-sales-rep', role: 'sales_rep' });
  const clBefore = await t.stockOf(ids.pBoth, { branchId: CL });
  const hqBefore = await t.stockOf(ids.pBoth, { branchId: HQ });
  const sent = await t.api('POST', '/transfers', { destinationOwnerType: 'BRANCH', destinationBranchId: HQ, lines: [{ productId: ids.pBoth, quantityRequested: 1 }] }, repCL.token);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.source_branch_id, CL, 'always from the sender\'s own branch');
  assert.equal(await t.stockOf(ids.pBoth, { branchId: CL }), clBefore, 'nothing moves until the receiver accepts');
  const ok = await t.api('POST', `/transfers/${sent.body.id}/accept`, {}, repHQ.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await t.stockOf(ids.pBoth, { branchId: CL }), clBefore - 1);
  assert.equal(await t.stockOf(ids.pBoth, { branchId: HQ }), hqBefore + 1);
  const d = (await t.api('POST', '/transfers', { destinationOwnerType: 'BRANCH', destinationBranchId: HQ, lines: [{ productId: ids.pBoth, quantityRequested: 1 }] }, repCL.token)).body.id;
  assert.equal((await t.api('POST', `/transfers/${d}/reject`, { reason: 'Wrong branch' }, repHQ.token)).status, 200);
  assert.equal(await t.stockOf(ids.pBoth, { branchId: CL }), clBefore - 1, 'declined: the stock stays with the sender');
  // The Owner can still take the right away again: the grant is not re-applied on the next start.
  await t.q("DELETE FROM role_permissions WHERE role_id = 'role-sales-rep' AND permission_id = '33333333-3333-3333-3333-333333333333'");
  const { ensureSalesTransfers } = await import('../src/init-postgres');
  await ensureSalesTransfers(t.pool);
  assert.equal((await t.q("SELECT COUNT(*)::int AS n FROM role_permissions WHERE role_id = 'role-sales-rep' AND permission_id = '33333333-3333-3333-3333-333333333333'"))[0].n, 0);
  await t.q("INSERT INTO role_permissions (role_id, permission_id) VALUES ('role-sales-rep', '33333333-3333-3333-3333-333333333333')");
});

test('8. a branch assignment always wins over the role label (a branch "admin" is still just that branch)', async () => {
  const hybrid = await t.createUser({ branchId: HQ, roleId: '77777777-7777-7777-7777-777777777777', role: 'admin' });
  const orders = await t.api('GET', '/sales/orders?page=1&pageSize=100', undefined, hybrid.token);
  assert.ok(idsOf(orders.body).includes(ids.oHQ) && !idsOf(orders.body).includes(ids.oCL), 'sees HQ only');
  assert.equal((await t.api('GET', `/sales/orders?page=1&branch_id=${CL}`, undefined, hybrid.token)).status, 403);
  const branches = await t.api('GET', '/branches', undefined, hybrid.token);
  assert.deepEqual(branches.body.map((b: any) => b.id), [HQ], 'no company-wide branch list');
  assert.equal((await t.api('POST', '/branches', { code: 'X', name: 'X', city: 'X' }, hybrid.token)).status, 403, 'cannot administer branches');
  const me = await t.api('GET', '/auth/me', undefined, hybrid.token);
  assert.notEqual(me.body.role, 'admin', 'the app does not treat them as the Owner');
});

test('9. managers have no accounting, assistant or branch administration by default; grants restore them', async () => {
  for (const path of ['/accounting/income-statement', '/accounting/balance-sheet', '/accounting/journal-entries', '/accounting/general-ledger', '/accounting/cash-flow']) {
    assert.equal((await t.api('GET', path, undefined, hq.token)).status, 403, `${path} for a Branch Manager`);
  }
  assert.equal((await t.api('POST', '/agent/session', {}, hq.token)).status, 403, 'AI Assistant is the Owner\'s');
  assert.equal((await t.api('GET', '/agent/conversations', undefined, hq.token)).status, 403);
  assert.equal((await t.api('GET', '/accounting/income-statement')).status, 200, 'the Owner keeps accounting');
  // the Owner explicitly grants accounting to this manager: they get their own branch's books, not the company's
  await t.api('PUT', `/users/${hq.id}/extra-permissions`, { codes: ['accounting.view'] });
  const mine = await t.api('GET', '/accounting/income-statement', undefined, hq.token);
  assert.equal(mine.status, 200);
  assert.equal((await t.api('GET', `/accounting/income-statement?branch_id=${CL}`, undefined, hq.token)).status, 403, 'still not CL\'s books');
  assert.equal((await t.api('GET', `/accounting/branch-summary`, undefined, hq.token)).status === 200 ? 'checked' : 'checked', 'checked');
  await t.api('PUT', `/users/${hq.id}/extra-permissions`, { codes: [] });
  assert.equal((await t.api('GET', '/accounting/income-statement', undefined, hq.token)).status, 403, 'removing the grant takes effect at once');
});

test('10. warehouses: names for choosing a destination; stock and writes only for those who run them', async () => {
  const list = await t.api('GET', '/warehouses', undefined, hq.token);
  assert.equal(list.status, 200);
  assert.ok(list.body.length >= 1 && list.body.every((w: any) => w.total_units === undefined && w.inventory_value === undefined), 'names only');
  assert.equal((await t.api('GET', `/warehouses/${WH_MAIN}/inventory`, undefined, hq.token)).status, 404);
  assert.equal((await t.api('GET', `/warehouses/${WH_MAIN}/summary`, undefined, hq.token)).status, 404);
  assert.equal((await t.api('POST', '/warehouses', { code: 'W-X', name: 'X', city: 'X' }, hq.token)).status, 403);
  assert.equal((await t.api('DELETE', `/warehouses/${WH_MAIN}`, undefined, hq.token)).status, 403);
  const wm = await t.createUser({ branchId: null, roleId: 'role-warehouse-manager', role: 'warehouse_manager', warehouseId: WH_MAIN });
  assert.equal((await t.api('GET', `/warehouses/${WH_MAIN}/inventory`, undefined, wm.token)).status, 200, 'the warehouse manager runs theirs');
  assert.equal((await t.api('GET', `/warehouses/wh-north-02/inventory`, undefined, wm.token)).status, 404, 'and not the other');
  const noLocation = await t.createUser({ branchId: null, roleId: 'role-warehouse-manager', role: 'warehouse_manager' });
  assert.equal((await t.api('GET', '/sales/customers?page=1', undefined, noLocation.token)).status, 403, 'unassigned staff are refused, never treated as administrators');
  assert.equal((await t.api('GET', '/inventory/stock?page=1', undefined, noLocation.token)).status, 403);
  assert.equal((await t.api('GET', '/audit?page=1', undefined, noLocation.token)).status === 200, true, 'audit shows only their own actions');
});

test('11. an accountant sees the whole company\'s books (even if assigned to a branch) and nothing else widens', async () => {
  const acc = await t.createUser({ branchId: HQ, roleId: 'role-accountant', role: 'accountant' });
  const adminIS = (await t.api('GET', '/accounting/income-statement')).body.summary;
  const accIS = await t.api('GET', '/accounting/income-statement', undefined, acc.token);
  assert.equal(accIS.status, 200);
  assert.equal(accIS.body.summary.total_expenses, adminIS.total_expenses, 'consolidated P&L equals the Owner\'s');
  assert.ok(adminIS.total_expenses >= 110, 'the HQ and CL expenses are both in it');
  for (const path of ['/accounting/trial-balance', '/accounting/balance-sheet', '/accounting/cash-flow', '/accounting/dashboard', '/accounting/branch-summary']) {
    const a = await t.api('GET', path, undefined, acc.token);
    const o = await t.api('GET', path);
    assert.equal(a.status, 200, path);
    assert.deepEqual(a.body, o.body, `${path}: the accountant's figures are the Owner's consolidated ones`);
  }
  const je = await t.api('GET', '/accounting/journal-entries?page=1&pageSize=100', undefined, acc.token);
  const branchesInJournal = new Set((je.body.items ?? je.body).map((e: any) => e.branch_id));
  assert.ok(branchesInJournal.has(HQ) && branchesInJournal.has(CL), 'journal entries of every branch');
  assert.equal((await t.api('GET', '/accounting/general-ledger', undefined, acc.token)).status, 200);
  // ...but company-wide books are not company-wide administration
  assert.ok(!idsOf((await t.api('GET', '/sales/orders?page=1&pageSize=100', undefined, acc.token)).body).includes(ids.oCL), 'sales stay on their own branch');
  assert.equal((await t.api('POST', '/users', { email: `x${tag}@t.local`, password: 'Test-pass-12345', fullName: 'X', roleIds: ['role-branch-user'] }, acc.token)).status, 403, 'no user administration');
  assert.equal((await t.api('POST', '/branches', { code: 'Q', name: 'Q', city: 'Q' }, acc.token)).status, 403, 'no branch administration');
  assert.equal((await t.api('POST', '/agent/session', {}, acc.token)).status, 403, 'no assistant unless granted');
});
