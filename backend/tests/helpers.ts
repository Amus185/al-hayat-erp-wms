// Test harness: runs the real Hono app against a disposable local Postgres.
// Each test file gets its own freshly created database, bootstrapped with the
// same startup migration production runs (ensurePostgresInit).
import pg from 'pg';
import { sign } from 'hono/jwt';
import { randomUUID } from 'node:crypto';

export const ADMIN_ID = '88888888-8888-8888-8888-888888888888';
export const BRANCH_HQ = 'branch-hq-main';
export const BRANCH_CL = 'branch-cl-show';
export const WH_MAIN = 'wh-main-01';
export const WH_NORTH = 'wh-north-02';
const ALL_PERMISSIONS = ['manage_users', 'manage_inventory', 'manage_transfers', 'manage_purchasing', 'manage_sales', 'view_reports'];

export type TestCtx = Awaited<ReturnType<typeof setupTestApp>>;

export async function setupTestApp() {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('TEST_DATABASE_URL is required: point it at a local, disposable Postgres server.');
  const url = new URL(base);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(`Refusing to run tests against non-local database host "${url.hostname}".`);
  }

  const dbName = `erp_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  url.pathname = `/${dbName}`;

  process.env.DATABASE_URL = url.toString();
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

  const pool = new pg.Pool({ connectionString: url.toString() });
  const { ensurePostgresInit } = await import('../src/init-postgres');
  await ensurePostgresInit(pool);
  const { default: app } = await import('../src/index');

  // A real server-side session plus a session-bound access token. Role,
  // branch and permission claims are deliberately ignored by the server (it
  // reads them from the database); they are kept here only to prove that.
  const tokenFor = async (claims: { sub: string; permissions?: string[]; branch_id?: string | null; role?: string }) => {
    const sid = randomUUID();
    await pool.query(
      `INSERT INTO auth_sessions (id, user_id, client_type, expires_at) VALUES ($1, $2, 'browser', CURRENT_TIMESTAMP + INTERVAL '1 day')`,
      [sid, claims.sub],
    );
    const pv = (await pool.query('SELECT COALESCE(password_version, 1) AS v FROM users WHERE id = $1', [claims.sub])).rows[0]?.v ?? 1;
    return sign({
      sub: claims.sub,
      sid,
      typ: 'access',
      permissions: claims.permissions ?? ALL_PERMISSIONS,
      branch_id: claims.branch_id ?? null,
      role: claims.role ?? 'admin',
      pwd_ver: Number(pv),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }, 'test-access-secret', 'HS256');
  };

  const adminToken = await tokenFor({ sub: ADMIN_ID });

  async function api(method: string, path: string, body?: unknown, token = adminToken) {
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }

  const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

  async function createProduct(opts: { cost?: number; price?: number; type?: 'STANDARD' | 'GROUPED' } = {}) {
    const id = randomUUID();
    await q(
      `INSERT INTO products (id, sku, name, cost_price, selling_price, product_type) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, `SKU-${id.slice(0, 8)}`, `Product ${id.slice(0, 4)}`, opts.cost ?? 40, opts.price ?? 100, opts.type ?? 'STANDARD'],
    );
    return id;
  }

  async function setStock(productId: string, qty: number, where: { branchId?: string; warehouseId?: string }) {
    const ownerType = where.branchId ? 'BRANCH' : 'WAREHOUSE';
    await q(
      `INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), productId, ownerType, where.warehouseId ?? null, where.branchId ?? null, qty],
    );
  }

  async function stockOf(productId: string, where: { branchId?: string; warehouseId?: string }) {
    const rows = await q(
      `SELECT COALESCE(SUM(quantity_on_hand), 0)::int AS qty FROM inventory_stock
       WHERE product_id = $1 AND branch_id IS NOT DISTINCT FROM $2 AND warehouse_id IS NOT DISTINCT FROM $3`,
      [productId, where.branchId ?? null, where.warehouseId ?? null],
    );
    return rows[0].qty as number;
  }

  async function createCustomer() {
    const res = await api('POST', '/sales/customers', { name: `Customer ${Date.now()}` });
    return res.body.id as string;
  }

  /** Net balance of a GL account from posted journal lines (debit-normal sign). */
  async function accountBalance(code: string) {
    const rows = await q(
      `SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0)::float AS bal
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('POSTED', 'REVERSED')
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       WHERE coa.code = $1`,
      [code],
    );
    return Math.round(rows[0].bal * 100) / 100;
  }

  /** A real user row with a real role, so the server derives scope from the database. */
  async function createUser(opts: { branchId: string | null; roleId: string; role: string }) {
    const id = randomUUID();
    await q(`INSERT INTO users (id, email, password_hash, full_name, branch_id) VALUES ($1, $2, 'x', $3, $4)`,
      [id, `${id}@test.local`, `User ${opts.role}`, opts.branchId]);
    await q('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [id, opts.roleId]);
    const token = await tokenFor({ sub: id, branch_id: opts.branchId, role: opts.role, permissions: ALL_PERMISSIONS });
    return { id, token };
  }

  async function journalCount() {
    return Number((await q('SELECT COUNT(*) AS n FROM journal_entries'))[0].n);
  }

  async function teardown() {
    await pool.end();
    if (process.env.KEEP_TEST_DB) { console.log(`Kept test database: ${dbName}`); return; }
    const a = new pg.Client({ connectionString: base });
    await a.connect();
    await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await a.end();
  }

  return { app, api, q, pool, tokenFor, adminToken, createUser, createProduct, setStock, stockOf, createCustomer, accountBalance, journalCount, teardown, ensurePostgresInit };
}
