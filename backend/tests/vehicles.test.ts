// Company vehicles (Employees section) and picking one on a delivery.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ as HQ, BRANCH_CL as CL, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });
const tag = randomUUID().slice(0, 5).toUpperCase();

test('vehicles: a branch manager registers, edits and deactivates their own; plates are unique; others cannot touch them', async () => {
  const hq = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const cl = await t.createUser({ branchId: CL, roleId: 'role-branch-user', role: 'branch_user' });
  const driver = (await t.api('POST', '/employees', { full_name: `Driver ${tag}`, phone: '0634111222', branch_id: HQ })).body;

  const created = await t.api('POST', '/vehicles', { plate_number: `HG ${tag} 1`, make: 'Isuzu', model: 'NPR', vehicle_type: 'TRUCK', default_driver_id: driver.id }, hq.token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.branch_id, HQ, 'registered under the manager\'s own branch');
  assert.equal(created.body.driver_name, `Driver ${tag}`, 'the usual driver\'s name comes from the employee');
  assert.equal(created.body.driver_phone, '0634111222');
  const dup = await t.api('POST', '/vehicles', { plate_number: `hg${tag}1` }, cl.token);
  assert.equal(dup.status, 409, 'the same plate (any case or spacing) cannot be registered twice');
  assert.equal((await t.api('POST', '/vehicles', { plate_number: `hg-${tag}-1` }, cl.token)).status, 409, 'hyphens do not make a different plate');
  assert.match(dup.body.message, /already registered/);
  assert.equal((await t.api('POST', '/vehicles', { make: 'x' }, hq.token)).status, 400, 'a plate is required');

  // another branch can neither see nor change it
  assert.ok(!(await t.api('GET', '/vehicles', undefined, cl.token)).body.some((v: any) => v.id === created.body.id));
  assert.equal((await t.api('PATCH', `/vehicles/${created.body.id}`, { make: 'hijack' }, cl.token)).status, 404);
  assert.equal((await t.api('DELETE', `/vehicles/${created.body.id}`, undefined, cl.token)).status, 404);
  // the owner sees it; a shared (company) vehicle is visible to every branch but changed only by the company view
  assert.ok((await t.api('GET', '/vehicles')).body.some((v: any) => v.id === created.body.id));
  const shared = await t.api('POST', '/vehicles', { plate_number: `SH ${tag}` });
  assert.equal(shared.status, 201);
  assert.equal(shared.body.branch_id, null);
  assert.ok((await t.api('GET', '/vehicles', undefined, cl.token)).body.some((v: any) => v.id === shared.body.id), 'shared vehicles are seen by every branch');
  assert.equal((await t.api('PATCH', `/vehicles/${shared.body.id}`, { make: 'x' }, cl.token)).status, 404, 'but not changed by a branch');

  // a salesperson can pick vehicles for deliveries but not register them
  const rep = await t.createUser({ branchId: HQ, roleId: 'role-sales-rep', role: 'sales_rep' });
  assert.equal((await t.api('GET', '/vehicles?status=ACTIVE', undefined, rep.token)).status, 200);
  const denied = await t.api('POST', '/vehicles', { plate_number: `NO ${tag}` }, rep.token);
  assert.equal(denied.status, 403);
  assert.match(denied.body.message, /ask the Owner or your manager/i, 'a plain explanation, not "Forbidden"');

  // deliveries: choose a vehicle; the plate is copied, the driver defaults to the usual one but can differ
  const prod = await t.createProduct({ price: 10 });
  await t.setStock(prod, 5, { branchId: HQ });
  const order = await t.api('POST', '/sales/orders', { customerId: await t.createCustomer(), lines: [{ productId: prod, quantity: 1, unitPrice: 10 }] }, hq.token).catch(() => null);
  const cust = (await t.api('POST', '/sales/customers', { name: `V Cust ${tag}`, phone: `06${Math.floor(10000000 + Math.random() * 8999999)}` }, hq.token)).body.id;
  const so = await t.api('POST', '/sales/orders', { customerId: cust, lines: [{ productId: prod, quantity: 1, unitPrice: 10 }] }, hq.token);
  assert.equal(so.status, 201, JSON.stringify(so.body));
  const del = await t.api('POST', '/deliveries', { salesOrderId: so.body.id, vehicleId: created.body.id }, hq.token);
  assert.equal(del.status, 201, JSON.stringify(del.body));
  assert.equal(del.body.vehicle_plate, `HG ${tag} 1`);
  assert.equal(del.body.vehicle_id, created.body.id);
  assert.equal(del.body.driver_name, `Driver ${tag}`, 'defaults to the vehicle\'s usual driver');
  const other = await t.api('PATCH', `/deliveries/${del.body.id}`, { driverName: 'Substitute Driver' }, hq.token);
  assert.equal(other.status, 200);
  assert.equal((await t.api('GET', `/deliveries/${del.body.id}`, undefined, hq.token)).body.driver_name, 'Substitute Driver', 'the driver of this trip can differ');

  // a vehicle of another branch cannot be used; an inactive one neither
  const so2 = await t.api('POST', '/sales/orders', { customerId: cust, lines: [{ productId: prod, quantity: 1, unitPrice: 10 }] }, hq.token);
  const clVeh = await t.api('POST', '/vehicles', { plate_number: `CL ${tag}` }, cl.token);
  assert.equal((await t.api('POST', '/deliveries', { salesOrderId: so2.body.id, vehicleId: clVeh.body.id }, hq.token)).status, 400);
  await t.api('PATCH', `/vehicles/${created.body.id}`, { status: 'INACTIVE' }, hq.token);
  assert.equal((await t.api('POST', '/deliveries', { salesOrderId: so2.body.id, vehicleId: created.body.id }, hq.token)).status, 400, 'inactive vehicles are not offered');
  assert.ok(!(await t.api('GET', '/vehicles?status=ACTIVE', undefined, hq.token)).body.some((v: any) => v.id === created.body.id));
  // a vehicle with delivery history is deactivated, never deleted
  const del2 = await t.api('DELETE', `/vehicles/${created.body.id}`, undefined, hq.token);
  assert.equal(del2.status, 409);
  assert.match(del2.body.message, /Inactive instead/);
  // an unused one can be deleted
  assert.equal((await t.api('DELETE', `/vehicles/${clVeh.body.id}`, undefined, cl.token)).status, 200);
  assert.equal((await t.q(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action IN ('VEHICLE_CREATE','VEHICLE_UPDATE','VEHICLE_DELETE')`))[0].n >= 4, true, 'changes are audited');
});
