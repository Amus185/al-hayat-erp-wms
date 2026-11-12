// Roadmap wave 5: document layout (Owner only, validated, audited) and per-user dashboard preferences.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, type TestCtx } from './helpers';
let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

test('document layout: defaults, Owner changes it, others only read it', async () => {
  const seller = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const d = await t.api('GET', '/settings/document-layout', undefined, seller.token);
  assert.equal(d.status, 200); assert.equal(d.body.companyName, 'Al Hayat Furniture Group'); assert.equal(d.body.paperSize, 'a4');
  assert.equal((await t.api('PUT', '/settings/document-layout', { companyName: 'X' }, seller.token)).status, 403);
  assert.equal((await t.api('PUT', '/settings/document-layout', { companyName: 'Al Hayat', accentColor: 'green' })).status, 400);
  assert.equal((await t.api('PUT', '/settings/document-layout', { companyName: 'Al Hayat', fontScale: 2 })).status, 400);
  const ok = await t.api('PUT', '/settings/document-layout', { companyName: 'Al Hayat Furniture', phone: '+252 63 4000000', accentColor: '#1d4ed8', paperSize: 'a5', terms: 'Goods sold are not returnable after 7 days.', showSignatures: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const after = (await t.api('GET', '/settings/document-layout', undefined, seller.token)).body;
  assert.equal(after.accentColor, '#1d4ed8'); assert.equal(after.paperSize, 'a5'); assert.equal(after.showSignatures, true); assert.equal(after.showLogo, true);
  assert.equal((await t.q(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'DOCUMENT_LAYOUT_SET'`))[0].n, 1);
});

test('dashboard preferences belong to each person', async () => {
  const a = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const b = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal((await t.api('GET', '/settings/preferences/dashboard', undefined, a.token)).body.value, null);
  assert.equal((await t.api('PUT', '/settings/preferences/dashboard', { value: { widgets: ['sales-today', 'targets', 'sales-today', 'BAD WIDGET'] } }, a.token)).status, 200);
  assert.deepEqual((await t.api('GET', '/settings/preferences/dashboard', undefined, a.token)).body.value.widgets, ['sales-today', 'targets']);
  assert.equal((await t.api('GET', '/settings/preferences/dashboard', undefined, b.token)).body.value, null, 'not shared');
  assert.equal((await t.api('PUT', '/settings/preferences/other', { value: 1 }, a.token)).status, 404);
});
