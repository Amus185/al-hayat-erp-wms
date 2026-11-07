import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { PgAdapter } from '../pg-client';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { has } from '../services/privacy';
import { costInStatements, unitCosts } from '../services/costing';
import { levelPlanner, restoreToLevels } from '../services/price-levels';
import { resolveBranchScope, resolveLoc, locBranch, resolveWriteBranch, branchSql, inScope, ScopeError, customerVisibleSql, hasAllBranchAccess, type BranchScope } from '../services/branch-scope';
import { logAudit, createAuditLogStmt } from '../services/audit';
import { releaseReservationsStmt, returnWebQuantityStmt } from '../services/storefront';
import { csvResponse, dateRange, likeTerm, listRequest, pagedResponse, pagedRows, type ListOptions, type ListRequest } from '../services/listing';
import {
  prepareSaleJournalEntry,
  prepareCustomerPaymentJournalEntry,
  fetchOpenFiscalPeriodId,
  fetchCoaMapForCodes,
  calculateOrderCogs,
  calculateLinesCogs,
  postInstallationPayoutJournalEntry,
  prepareJournalEntryPosting,
  prepareJournalReversal,
} from '../services/accounting-service';

const sales = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

sales.use('/*', authMiddleware);

// ──────────────────────────────────────────────────────────────────────
// SHARED HELPER — compute payment summary for an invoice
// Returns: { amount_paid, balance, payment_status }
// Never stored — always calculated from invoice_payments rows
// ──────────────────────────────────────────────────────────────────────
async function getInvoicePaymentSummary(db: PgAdapter, invoiceId: string, totalAmount: number, discountAmount: number) {
  const res = await db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS amount_paid FROM invoice_payments WHERE invoice_id = ?'
  ).bind(invoiceId).first();
  const amountPaid = Number(res?.amount_paid || 0);
  const netTotal = Math.max(0, totalAmount - discountAmount);
  const balance = Math.max(0, netTotal - amountPaid);
  let payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
  if (amountPaid >= netTotal && netTotal > 0) payment_status = 'PAID';
  else if (amountPaid > 0) payment_status = 'PARTIALLY_PAID';
  return { amount_paid: amountPaid, net_total: netTotal, balance, payment_status };
}

// ──────────────────────────────────────────────────────────────────────
// SHARED HELPER — compute customer unified financial balances
// Balance = Unpaid furniture sales + unpaid manual charges - unallocated account payments
// ──────────────────────────────────────────────────────────────────────
export async function calculateCustomerFinancials(db: any, customerId: string, scope: BranchScope = { kind: 'ALL' }) {
  const invoiceRes = await db.prepare(`
    SELECT 
      COALESCE(SUM(
        GREATEST(0, (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)) - COALESCE((
          SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id
        ), 0))
      ), 0) AS unpaid_sales
    FROM sales_orders so
    JOIN invoices i ON i.sales_order_id = so.id
    WHERE so.customer_id = ? AND so.status != 'CANCELLED' AND i.status != 'CANCELLED' ${branchSql(scope, 'so.branch_id')}
  `).bind(customerId).first().catch(() => ({ unpaid_sales: 0 }));
  const unpaidSales = Number(invoiceRes?.unpaid_sales || 0);

  const manualRes = await db.prepare(`
    SELECT COALESCE(SUM(remaining_balance), 0) AS unpaid_manual
    FROM customer_debts
    WHERE customer_id = ? AND status != 'CANCELLED' ${branchSql(scope, 'branch_id')}
  `).bind(customerId).first().catch(() => ({ unpaid_manual: 0 }));
  const unpaidManual = Number(manualRes?.unpaid_manual || 0);

  const accountRes = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS unallocated
    FROM customer_payments
    WHERE customer_id = ? AND allocation_type = 'ACCOUNT' ${branchSql(scope, 'branch_id')}
  `).bind(customerId).first().catch(() => ({ unallocated: 0 }));
  const unallocated = Number(accountRes?.unallocated || 0);

  const currentBalance = Math.max(0, unpaidSales + unpaidManual - unallocated);
  return {
    unpaid_sales: unpaidSales,
    unpaid_manual: unpaidManual,
    unallocated_payments: unallocated,
    current_balance: currentBalance,
  };
}

// ──────────────────────────────────────────────────────────────────────
// CUSTOMERS
// ──────────────────────────────────────────────────────────────────────
// ── Customers list, paged on the server ──────────────────────────────────
// Per-customer totals are computed once per table (grouped), not per row.
const CUSTOMER_LIST: ListOptions = {
  sortable: { name: 'name', created: 'created_at', orders: 'total_orders', spent: 'total_spent', balance: 'outstanding_balance', phone: 'phone' },
  defaultSort: 'created', defaultDir: 'desc', tieBreaker: 'id',
};

/**
 * A customer, only if the caller's branch deals with them (a shared master
 * record: its identity is central, its visibility is per branch). Company-level
 * users see every customer.
 */
async function customerOr404(c: any, id: string): Promise<any | null> {
  const scope = await resolveBranchScope(c);
  if (scope.kind === 'BRANCH') {
    const ok = await c.env.DB.prepare(`SELECT 1 AS x FROM customers cu WHERE cu.id = ? AND ${customerVisibleSql(scope.branchId)}`).bind(id).first();
    if (!ok) return null;
  }
  return c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
}

async function listCustomers(c: any, r: ListRequest) {
  const scope = await resolveBranchScope(c);
  // Branch names are shown to the company view only (the Owner, even while looking at one branch).
  const showBranches = hasAllBranchAccess(c.get('jwtPayload'));
  const q = (k: string) => (c.req.query(k) || '').trim();
  const withSql = `
    WITH so_agg AS (
      SELECT so.customer_id,
             COUNT(*) AS total_orders,
             SUM(CASE WHEN i.id IS NOT NULL THEN (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0)) + COALESCE(so.installation_fee, 0)
                      ELSE COALESCE(lt.total, 0) + COALESCE(so.installation_fee, 0) END) AS total_spent,
             SUM(CASE WHEN i.id IS NOT NULL AND i.status != 'CANCELLED'
                      THEN GREATEST(0, (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)) - COALESCE(pay.paid, 0))
                      ELSE 0 END) AS unpaid_sales_balance,
             MAX(so.created_at) AS last_order_at
      FROM sales_orders so
      LEFT JOIN invoices i ON i.sales_order_id = so.id
      LEFT JOIN LATERAL (SELECT SUM(ip.amount) AS paid FROM invoice_payments ip WHERE ip.invoice_id = i.id) pay ON TRUE
      LEFT JOIN LATERAL (SELECT SUM(sol.line_total) AS total FROM sales_order_lines sol WHERE sol.sales_order_id = so.id) lt ON TRUE
      WHERE so.status != 'CANCELLED' ${branchSql(scope, 'so.branch_id')}
      GROUP BY so.customer_id
    ), debt_agg AS (
      SELECT cd.customer_id, SUM(cd.remaining_balance) AS unpaid_manual_balance
      FROM customer_debts cd WHERE cd.status != 'CANCELLED' ${branchSql(scope, 'cd.branch_id')}
      GROUP BY cd.customer_id
    ), pay_agg AS (
      SELECT cp.customer_id, SUM(cp.amount) AS unallocated_payments
      FROM customer_payments cp WHERE cp.allocation_type = 'ACCOUNT' ${branchSql(scope, 'cp.branch_id')}
      GROUP BY cp.customer_id
    ), cust AS (
      SELECT cu.*,
             COALESCE(sa.total_orders, 0)::int AS total_orders,
             COALESCE(sa.total_spent, 0) AS total_spent,
             COALESCE(sa.unpaid_sales_balance, 0) AS unpaid_sales_balance,
             COALESCE(da.unpaid_manual_balance, 0) AS unpaid_manual_balance,
             COALESCE(pa.unallocated_payments, 0) AS unallocated_payments,
             GREATEST(0, COALESCE(sa.unpaid_sales_balance, 0) + COALESCE(da.unpaid_manual_balance, 0) - COALESCE(pa.unallocated_payments, 0)) AS outstanding_balance,
             sa.last_order_at,
             ${!showBranches
               // A branch sees only its own customers; other branches' names stay hidden.
               ? 'NULL::text'
               // Company view: the branches the customer belongs to, the one that registered them first.
               : `(SELECT string_agg(b.name, ', ' ORDER BY cb.created_at, b.name) FROM customer_branches cb JOIN branches b ON b.id = cb.branch_id WHERE cb.customer_id = cu.id)`} AS branch_names
      FROM customers cu
      LEFT JOIN so_agg sa ON sa.customer_id = cu.id
      LEFT JOIN debt_agg da ON da.customer_id = cu.id
      LEFT JOIN pay_agg pa ON pa.customer_id = cu.id
    )`;
  const where: string[] = [];
  const params: unknown[] = [];
  if (scope.kind === 'BRANCH') where.push(customerVisibleSql(scope.branchId, 'id'));
  const term = q('q') || q('search');
  if (term) {
    const t = likeTerm(term);
    // A typed phone number is matched on its digits ("063 400 8221" finds
    // "0634008221"); only when the term looks like a phone number, not a name.
    const digits = /^[\d\s+()-]+$/.test(term) ? term.replace(/\D/g, '') : '';
    where.push(`(name ILIKE ? OR email ILIKE ? OR address ILIKE ? OR COALESCE(phone, '') ILIKE ?${digits.length >= 3 ? " OR regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE ?" : ''})`);
    params.push(t, t, t, t);
    if (digits.length >= 3) params.push(`%${digits}%`);
  }
  if (q('balance') === 'owing') where.push('outstanding_balance > 0.005');
  if (q('balance') === 'clear') where.push('outstanding_balance <= 0.005');
  if (q('activity') === 'never') where.push('total_orders = 0');
  if (q('activity') === 'buyers') where.push('total_orders > 0');
  dateRange(c, 'created_at', where, params);
  const base = `FROM cust ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const { rows, total } = await pagedRows(c.env.DB, '*', base, params, r, withSql);
  if (r.csv) {
    return csvResponse(c, 'customers', [
      { label: 'Name', value: (x: any) => x.name },
      { label: 'Phone', value: (x: any) => x.phone },
      { label: 'Email', value: (x: any) => x.email },
      { label: 'Address', value: (x: any) => x.address },
      ...(!showBranches ? [] : [{ label: 'Branch', value: (x: any) => x.branch_names || 'Whole company' }]),
      { label: 'Orders', value: (x: any) => x.total_orders },
      { label: 'Total spent', value: (x: any) => Number(x.total_spent).toFixed(2) },
      { label: 'Outstanding balance', value: (x: any) => Number(x.outstanding_balance).toFixed(2) },
      { label: 'Customer since', value: (x: any) => String(x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at).slice(0, 10) },
    ], rows);
  }
  const sum = await c.env.DB.prepare(`${withSql} SELECT COALESCE(SUM(outstanding_balance), 0) AS owed, COUNT(*) FILTER (WHERE outstanding_balance > 0.005)::int AS owing ${base}`).bind(...params).first() as any;
  return pagedResponse(c, r, rows, total, { totals: { outstanding: Math.round(Number(sum?.owed || 0) * 100) / 100, customersOwing: Number(sum?.owing || 0) } });
}

sales.get('/customers', async (c) => {
  const listReq = listRequest(c, CUSTOMER_LIST);
  if (listReq.paged) return listCustomers(c, listReq);
  const scope = await resolveBranchScope(c);
  const query = `
    SELECT 
      c.*,
      COALESCE((
        SELECT COUNT(*) 
        FROM sales_orders so 
        WHERE so.customer_id = c.id AND so.status != 'CANCELLED' ${branchSql(scope, 'so.branch_id')}
      ), 0) AS total_orders,
      COALESCE((
        SELECT SUM(
          CASE 
            WHEN i.id IS NOT NULL THEN (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0)) + COALESCE(so.installation_fee, 0)
            ELSE (SELECT COALESCE(SUM(sol.line_total), 0) FROM sales_order_lines sol WHERE sol.sales_order_id = so.id) + COALESCE(so.installation_fee, 0)
          END
        )
        FROM sales_orders so
        LEFT JOIN invoices i ON i.sales_order_id = so.id
        WHERE so.customer_id = c.id AND so.status != 'CANCELLED' ${branchSql(scope, 'so.branch_id')}
      ), 0) AS total_spent,
      COALESCE((
        SELECT SUM(
          GREATEST(0, (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)) - COALESCE((
            SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id
          ), 0))
        )
        FROM sales_orders so
        JOIN invoices i ON i.sales_order_id = so.id
        WHERE so.customer_id = c.id AND so.status != 'CANCELLED' AND i.status != 'CANCELLED' ${branchSql(scope, 'so.branch_id')}
      ), 0) AS unpaid_sales_balance,
      COALESCE((
        SELECT SUM(cd.remaining_balance)
        FROM customer_debts cd
        WHERE cd.customer_id = c.id AND cd.status != 'CANCELLED' ${branchSql(scope, 'cd.branch_id')}
      ), 0) AS unpaid_manual_balance,
      COALESCE((
        SELECT SUM(cp.amount)
        FROM customer_payments cp
        WHERE cp.customer_id = c.id AND cp.allocation_type = 'ACCOUNT' ${branchSql(scope, 'cp.branch_id')}
      ), 0) AS unallocated_payments
    FROM customers c
    ${scope.kind === 'BRANCH' ? `WHERE ${customerVisibleSql(scope.branchId, 'c.id')}` : ''}
    ORDER BY c.created_at DESC
    LIMIT 200
  `;
  const { results } = await c.env.DB.prepare(query).all();
  const rows = ((results || []) as any[]).map((row) => ({
    ...row,
    outstanding_balance: Math.max(0, Number(row.unpaid_sales_balance || 0) + Number(row.unpaid_manual_balance || 0) - Number(row.unallocated_payments || 0)),
  }));
  return c.json(rows);
});

sales.post('/customers', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.name.trim()) {
    return c.json({ message: 'Customer name is required.' }, 400);
  }
  const scope = await resolveBranchScope(c);
  const branchId = scope.kind === 'BRANCH' ? scope.branchId : null;
  const digits = String(body.phone || '').replace(/\D/g, '');
  // One customer record for the whole company: the same phone number is the same person.
  if (digits.length >= 6) {
    const known = await c.env.DB.prepare(
      "SELECT * FROM customers WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ? ORDER BY created_at LIMIT 1",
    ).bind(digits).first() as any;
    if (known) {
      if (branchId) await c.env.DB.prepare('INSERT INTO customer_branches (customer_id, branch_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(known.id, branchId).run();
      return c.json({ ...known, already_registered: true }, 200);
    }
  }
  const id = uuidv4();
  const stmts: any[] = [c.env.DB.prepare(`
    INSERT INTO customers (id, name, phone, email, address)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, body.name.trim(), body.phone || null, body.email || null, body.address || null)];
  if (branchId) stmts.push(c.env.DB.prepare('INSERT INTO customer_branches (customer_id, branch_id) VALUES (?, ?)').bind(id, branchId));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

sales.patch('/customers/:id', requirePermissions(['manage_sales']), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<{ name?: string; phone?: string; email?: string; address?: string }>();
  const existing = await customerOr404(c, id as string);
  if (!existing) return c.json({ message: 'Customer not found.' }, 404);

  const fields: string[] = [];
  const vals: any[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); vals.push(body.name.trim()); }
  if (body.phone !== undefined) { fields.push('phone = ?'); vals.push(body.phone || null); }
  if (body.email !== undefined) { fields.push('email = ?'); vals.push(body.email || null); }
  if (body.address !== undefined) { fields.push('address = ?'); vals.push(body.address || null); }
  if (!fields.length) return c.json({ message: 'No fields to update.' }, 400);
  vals.push(id);

  await c.env.DB.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  return c.json(row);
});

sales.delete('/customers/:id', requirePermissions(['manage_sales']), async (c) => {
  const { id } = c.req.param();
  const existing = await customerOr404(c, id as string);
  if (!existing) return c.json({ message: 'Customer not found.' }, 404);
  // Debts and payments cascade-delete with the customer while their journal
  // entries remain, so any financial history blocks deletion.
  const history = await c.env.DB.prepare(`
    SELECT EXISTS (SELECT 1 FROM sales_orders WHERE customer_id = ?)
        OR EXISTS (SELECT 1 FROM customer_debts WHERE customer_id = ?)
        OR EXISTS (SELECT 1 FROM customer_payments WHERE customer_id = ?) AS has_history
  `).bind(id, id, id).first() as any;
  if (history?.has_history) {
    return c.json({ message: 'Cannot delete a customer with orders, charges or payments; their financial history must be kept.' }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(id),
    createAuditLogStmt(c, 'CUSTOMER_DELETE', 'customers', id, existing, null),
  ]);
  return c.json({ success: true });
});

// ──────────────────────────────────────────────────────────────────────
// DEBT DASHBOARD & OVERVIEW
// ──────────────────────────────────────────────────────────────────────
sales.get('/debts/summary', async (c) => {
  const scope = await resolveBranchScope(c);
  const invoiceRes = await c.env.DB.prepare(`
    SELECT 
      so.customer_id,
      COALESCE(SUM(
        GREATEST(0, (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)) - COALESCE((
          SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id
        ), 0))
      ), 0) AS unpaid_sales
    FROM sales_orders so
    JOIN invoices i ON i.sales_order_id = so.id
    WHERE so.status != 'CANCELLED' AND i.status != 'CANCELLED' AND so.customer_id IS NOT NULL ${branchSql(scope, 'so.branch_id')}
    GROUP BY so.customer_id
  `).all();

  const manualRes = await c.env.DB.prepare(`
    SELECT customer_id, COALESCE(SUM(remaining_balance), 0) AS unpaid_manual
    FROM customer_debts
    WHERE status != 'CANCELLED' ${branchSql(scope, 'branch_id')}
    GROUP BY customer_id
  `).all().catch(() => ({ results: [] }));

  const acctRes = await c.env.DB.prepare(`
    SELECT customer_id, COALESCE(SUM(amount), 0) AS unallocated
    FROM customer_payments
    WHERE allocation_type = 'ACCOUNT' ${branchSql(scope, 'branch_id')}
    GROUP BY customer_id
  `).all().catch(() => ({ results: [] }));

  const totalCollectedRes = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total_collected
    FROM customer_payments
    WHERE (notes IS NULL 
       OR (
         notes NOT LIKE '%Full payment via Complete Sale%' 
         AND notes NOT LIKE '%Deposit / Partial payment via Complete Sale%' 
         AND notes NOT LIKE '%Upfront Deposit at Checkout%'
       )) ${branchSql(scope, 'branch_id')}
  `).first().catch(() => ({ total_collected: 0 }));

  const customerBalances = new Map<string, number>();

  for (const row of (invoiceRes.results || []) as any[]) {
    customerBalances.set(row.customer_id, Number(row.unpaid_sales || 0));
  }
  for (const row of (manualRes.results || []) as any[]) {
    const cur = customerBalances.get(row.customer_id) || 0;
    customerBalances.set(row.customer_id, cur + Number(row.unpaid_manual || 0));
  }
  for (const row of (acctRes.results || []) as any[]) {
    const cur = customerBalances.get(row.customer_id) || 0;
    customerBalances.set(row.customer_id, Math.max(0, cur - Number(row.unallocated || 0)));
  }

  let totalOutstandingDebt = 0;
  let activeDebtorsCount = 0;

  for (const bal of customerBalances.values()) {
    if (bal > 0.01) {
      totalOutstandingDebt += bal;
      activeDebtorsCount += 1;
    }
  }

  return c.json({
    total_outstanding_debt: totalOutstandingDebt,
    total_debt_collected: Number(totalCollectedRes?.total_collected || 0),
    total_active_debtors: activeDebtorsCount,
    active_debtors: activeDebtorsCount,
  });
});

sales.get('/debts', async (c) => {
  const scope = await resolveBranchScope(c);
  const { search, status } = c.req.query();

  const query = `
    SELECT 
      c.id, c.name, c.phone, c.email, c.address, c.city,
      COALESCE((
        SELECT SUM(
          GREATEST(0, (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)) - COALESCE((
            SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id
          ), 0))
        )
        FROM sales_orders so
        JOIN invoices i ON i.sales_order_id = so.id
        WHERE so.customer_id = c.id AND so.status != 'CANCELLED' AND i.status != 'CANCELLED' ${branchSql(scope, 'so.branch_id')}
      ), 0) AS unpaid_sales_balance,
      COALESCE((
        SELECT SUM(cd.remaining_balance)
        FROM customer_debts cd
        WHERE cd.customer_id = c.id AND cd.status != 'CANCELLED' ${branchSql(scope, 'cd.branch_id')}
      ), 0) AS unpaid_manual_balance,
      COALESCE((
        SELECT SUM(cp.amount)
        FROM customer_payments cp
        WHERE cp.customer_id = c.id AND cp.allocation_type = 'ACCOUNT' ${branchSql(scope, 'cp.branch_id')}
      ), 0) AS unallocated_payments,
      COALESCE((
        SELECT MAX(payment_date)
        FROM (
          SELECT payment_date FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id JOIN sales_orders so ON so.id = i.sales_order_id WHERE so.customer_id = c.id ${branchSql(scope, 'so.branch_id')}
          UNION ALL
          SELECT payment_date FROM customer_payments cp WHERE cp.customer_id = c.id ${branchSql(scope, 'cp.branch_id')}
        )
      ), NULL) AS last_payment_date
    FROM customers c
    ORDER BY c.name ASC
  `;

  const { results } = await c.env.DB.prepare(query).all();
  let rows = ((results || []) as any[]).map((r) => {
    const curBal = Math.max(0, Number(r.unpaid_sales_balance || 0) + Number(r.unpaid_manual_balance || 0) - Number(r.unallocated_payments || 0));
    return {
      id: r.id,
      customer_id: r.id,
      name: r.name,
      customer_name: r.name,
      phone: r.phone,
      customer_phone: r.phone,
      email: r.email,
      customer_email: r.email,
      address: r.address,
      city: r.city,
      current_balance: curBal,
      outstanding_balance: curBal,
      unpaid_sales: Number(r.unpaid_sales_balance || 0),
      unpaid_sales_balance: Number(r.unpaid_sales_balance || 0),
      unpaid_manual: Number(r.unpaid_manual_balance || 0),
      unpaid_manual_balance: Number(r.unpaid_manual_balance || 0),
      unallocated_payments: Number(r.unallocated_payments || 0),
      last_payment_date: r.last_payment_date,
      last_activity_date: r.last_payment_date,
      active_debts_count: curBal > 0.01 ? 1 : 0,
      debt_status: curBal > 0.01 ? 'DEBT_ACTIVE' : 'CURRENT',
    };
  });

  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(s) || (r.phone || '').includes(s) || (r.email || '').toLowerCase().includes(s));
  }

  if (status && status !== 'ALL') {
    rows = rows.filter((r) => r.debt_status === status);
  } else if (!status) {
    // By default, debts endpoint returns only customers who actually have outstanding debt
    rows = rows.filter((r) => r.current_balance > 0.01);
  }

  return c.json(rows);
});

// ──────────────────────────────────────────────────────────────────────
// MANUAL CUSTOMER DEBTS
// ──────────────────────────────────────────────────────────────────────
sales.get('/customers/:id/debts', async (c) => {
  const scope = await resolveBranchScope(c);
  const customerId = c.req.param('id');
  if (!(await customerOr404(c, customerId))) return c.json({ message: 'Customer not found.' }, 404);
  const { results } = await c.env.DB.prepare(`
    SELECT cd.*, u.full_name AS created_by_name
    FROM customer_debts cd
    LEFT JOIN users u ON u.id = cd.created_by
    WHERE cd.customer_id = ? ${branchSql(scope, 'cd.branch_id')}
    ORDER BY cd.debt_date DESC, cd.created_at DESC
  `).bind(customerId).all();
  return c.json(results || []);
});

sales.post('/customers/:id/debts', requirePermissions(['manage_sales']), async (c) => {
  const customerId = c.req.param('id');
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  const customer = await customerOr404(c, customerId as string);
  if (!customer) return c.json({ message: 'Customer not found.' }, 404);

  // Branch users always charge in their own branch; admins choose (or company-level).
  const debtBranch = await resolveWriteBranch(c, body.branchId);
  const amount = Number(body.amount);
  if (!amount || amount <= 0) return c.json({ message: 'Debt amount must be greater than zero.' }, 400);
  if (!body.description || !body.description.trim()) {
    return c.json({ message: 'Description is required.' }, 400);
  }

  const id = uuidv4();
  const debtNumber = `DEBT-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
  const debtDate = body.debtDate || new Date().toISOString();
  const category = body.category || 'MANUAL';

  const stmts: any[] = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO customer_debts (
      id, debt_number, customer_id, description, category, amount, remaining_balance,
      status, debt_date, branch_id, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?, ?)
  `).bind(
    id,
    debtNumber,
    customerId,
    body.description.trim(),
    category,
    amount,
    amount,
    debtDate,
    debtBranch,
    userId
  ));

  stmts.push(createAuditLogStmt(c, 'CUSTOMER_DEBT_CREATE', 'customer_debts', id, null, {
    debtNumber,
    customerId,
    amount,
    description: body.description.trim(),
    category,
  }));

  // GL: DR Accounts Receivable (1020), CR Sales/Service Revenue (4010) — same transaction as the debt.
  const debtJournal = await prepareJournalEntryPosting(c, {
    description: `Manual Charge #${debtNumber}: ${body.description.trim()}`,
    referenceType: 'SALE',
    referenceId: id,
    entryDate: String(debtDate).split('T')[0],
    branchId: debtBranch,
    userId,
    lines: [
      { accountCode: '1020', debitAmount: amount, creditAmount: 0 },
      { accountCode: '4010', debitAmount: 0, creditAmount: amount },
    ],
  });
  stmts.push(...debtJournal.statements);

  await c.env.DB.batch(stmts);

  const created = await c.env.DB.prepare('SELECT * FROM customer_debts WHERE id = ?').bind(id).first();
  return c.json(created, 201);
});

// ──────────────────────────────────────────────────────────────────────
// UNIFIED CUSTOMER BALANCE & LEDGER
// ──────────────────────────────────────────────────────────────────────
sales.get('/customers/:id/balance', async (c) => {
  const scope = await resolveBranchScope(c);
  const customerId = c.req.param('id');
  const customer = await customerOr404(c, customerId as string);
  if (!customer) return c.json({ message: 'Customer not found.' }, 404);

  const fin = await calculateCustomerFinancials(c.env.DB, customerId, scope);
  return c.json({
    customer_id: customer.id,
    customer_name: customer.name,
    ...fin,
  });
});

sales.get('/customers/:id/ledger', async (c) => {
  const scope = await resolveBranchScope(c);
  const customerId = c.req.param('id');
  const customer = await customerOr404(c, customerId as string);
  if (!customer) return c.json({ message: 'Customer not found.' }, 404);

  // 1. Invoices
  const { results: invoices } = await c.env.DB.prepare(`
    SELECT i.id, i.invoice_number, so.order_number, 
           (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)) AS total_amount,
           i.issued_at, i.status
    FROM invoices i
    JOIN sales_orders so ON so.id = i.sales_order_id
    WHERE so.customer_id = ? AND so.status != 'CANCELLED' AND i.status != 'CANCELLED' ${branchSql(scope, 'so.branch_id')}
  `).bind(customerId).all();

  // 2. Invoice payments
  const { results: invoicePayments } = await c.env.DB.prepare(`
    SELECT ip.id, ip.amount, ip.payment_method, ip.payment_date, ip.created_at, ip.receipt_number, ip.notes,
           i.invoice_number, so.order_number
    FROM invoice_payments ip
    JOIN invoices i ON i.id = ip.invoice_id
    JOIN sales_orders so ON so.id = i.sales_order_id
    WHERE so.customer_id = ? AND so.status != 'CANCELLED' AND i.status != 'CANCELLED' ${branchSql(scope, 'so.branch_id')}
  `).bind(customerId).all();

  // 3. Manual debts
  const { results: manualDebts } = await c.env.DB.prepare(`
    SELECT cd.id, cd.debt_number, cd.description, cd.category, cd.amount, cd.remaining_balance, cd.debt_date, cd.status
    FROM customer_debts cd
    WHERE cd.customer_id = ? AND cd.status != 'CANCELLED' ${branchSql(scope, 'cd.branch_id')}
  `).bind(customerId).all().catch(() => ({ results: [] }));

  // 4. Non-invoice customer payments (manual debt & general account payments)
  const { results: otherPayments } = await c.env.DB.prepare(`
    SELECT cp.id, cp.receipt_number, cp.amount, cp.payment_method, cp.payment_date, cp.created_at, cp.notes, cp.allocation_type,
           cd.debt_number, cd.description AS debt_description
    FROM customer_payments cp
    LEFT JOIN customer_debts cd ON cd.id = cp.manual_debt_id
    WHERE cp.customer_id = ? AND cp.allocation_type != 'INVOICE' ${branchSql(scope, 'cp.branch_id')}
  `).bind(customerId).all().catch(() => ({ results: [] }));

  interface RawLedgerEntry {
    id: string;
    timestamp: number;
    date: string;
    description: string;
    reference: string;
    charge: number;
    payment: number;
    type: 'INVOICE' | 'PAYMENT' | 'MANUAL_DEBT';
  }

  const rawEntries: RawLedgerEntry[] = [];

  for (const inv of (invoices || []) as any[]) {
    const d = inv.issued_at ? new Date(inv.issued_at) : new Date();
    rawEntries.push({
      id: inv.id,
      timestamp: d.getTime(),
      date: inv.issued_at,
      description: `Invoice #${inv.order_number || inv.invoice_number}`,
      reference: inv.invoice_number || inv.order_number,
      charge: Number(inv.total_amount || 0),
      payment: 0,
      type: 'INVOICE',
    });
  }

  for (const pay of (invoicePayments || []) as any[]) {
    const rawDate = pay.payment_date || pay.created_at;
    const d = rawDate ? new Date(rawDate) : new Date();
    const isDeposit = pay.notes && pay.notes.toLowerCase().includes('deposit');
    const methodStr = (pay.payment_method || 'CASH').replace('_', ' ');
    const desc = isDeposit
      ? `Upfront Deposit (${pay.receipt_number || pay.order_number || 'Sale'})`
      : `Payment - ${methodStr}${pay.receipt_number ? ` (${pay.receipt_number})` : ''}`;
    rawEntries.push({
      id: pay.id,
      timestamp: d.getTime() + 1,
      date: rawDate,
      description: desc,
      reference: pay.receipt_number || pay.id,
      charge: 0,
      payment: Number(pay.amount || 0),
      type: 'PAYMENT',
    });
  }

  for (const debt of (manualDebts || []) as any[]) {
    const d = debt.debt_date ? new Date(debt.debt_date) : new Date();
    rawEntries.push({
      id: debt.id,
      timestamp: d.getTime(),
      date: debt.debt_date,
      description: `${debt.description} (${debt.debt_number})`,
      reference: debt.debt_number,
      charge: Number(debt.amount || 0),
      payment: 0,
      type: 'MANUAL_DEBT',
    });
  }

  for (const pay of (otherPayments || []) as any[]) {
    const rawDate = pay.payment_date || pay.created_at;
    const d = rawDate ? new Date(rawDate) : new Date();
    const methodStr = (pay.payment_method || 'CASH').replace('_', ' ');
    const desc = pay.allocation_type === 'ACCOUNT'
      ? `Account Payment - ${methodStr}${pay.receipt_number ? ` (${pay.receipt_number})` : ''}`
      : `Payment - ${methodStr} (${pay.receipt_number || pay.id})${pay.debt_number ? ` for ${pay.debt_number}` : ''}`;
    rawEntries.push({
      id: pay.id,
      timestamp: d.getTime() + 1,
      date: rawDate,
      description: desc,
      reference: pay.receipt_number || pay.id,
      charge: 0,
      payment: Number(pay.amount || 0),
      type: 'PAYMENT',
    });
  }

  rawEntries.sort((a, b) => a.timestamp - b.timestamp);

  let runningBalance = 0;
  const ledger = rawEntries.map((e) => {
    runningBalance += e.charge - e.payment;
    return {
      id: e.id,
      date: e.date,
      description: e.description,
      reference: e.reference,
      charge: e.charge,
      debit: e.charge,
      payment: e.payment,
      credit: e.payment,
      running_balance: runningBalance,
      type: e.type,
    };
  });

  return c.json({
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      current_balance: runningBalance,
    },
    current_balance: runningBalance,
    entries: ledger,
    ledger,
  });
});

// ──────────────────────────────────────────────────────────────────────
// UNIFIED PAYMENT PROCESSING & RECEIPTS
// ──────────────────────────────────────────────────────────────────────
sales.post('/payments', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  const { customerId, allocationType, invoiceId, manualDebtId, amount, paymentMethod, notes } = body;
  const payAmount = Number(amount);

  if (!customerId) return c.json({ message: 'Customer is required.' }, 400);
  if (!payAmount || payAmount <= 0) return c.json({ message: 'Payment amount must be greater than zero.' }, 400);
  if (!['INVOICE', 'MANUAL_DEBT', 'ACCOUNT'].includes(allocationType)) {
    return c.json({ message: 'Invalid allocation type.' }, 400);
  }

  const customer = await customerOr404(c, customerId as string);
  if (!customer) return c.json({ message: 'Customer not found.' }, 404);

  // Branch scope: a payment settles a document of the caller's branch and is
  // booked in the branch of that document (never the cashier's by default).
  const scope = await resolveBranchScope(c, 'ALL');
  let paymentBranch: string | null = null;

  const prevFin = await calculateCustomerFinancials(c.env.DB, customerId, scope);
  const previousBalance = prevFin.current_balance;

  const receiptNumber = `RCP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
  const paymentId = uuidv4();
  const stmts: any[] = [];
  let billNumber: string | null = null;
  let remainingItemBalance = 0;

  if (allocationType === 'INVOICE') {
    if (!invoiceId) return c.json({ message: 'Invoice ID is required for invoice payment.' }, 400);
    const invoice = await c.env.DB.prepare(`
      SELECT i.*, so.order_number, so.branch_id, COALESCE(so.installation_fee, 0) AS installation_fee
      FROM invoices i
      JOIN sales_orders so ON so.id = i.sales_order_id
      WHERE i.id = ? AND so.customer_id = ?
    `).bind(invoiceId, customerId).first() as any;

    if (!invoice || !inScope(scope, invoice.branch_id)) return c.json({ message: 'Invoice not found for this customer.' }, 404);
    paymentBranch = invoice.branch_id || null;

    billNumber = invoice.order_number || invoice.invoice_number;
    const grossTotal = (Number(invoice.total_amount || 0) - Number(invoice.discount_amount || 0)) + Number(invoice.installation_fee || 0);

    const paidRes = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = ?'
    ).bind(invoiceId).first() as any;
    const curPaid = Number(paidRes?.paid || 0);
    const curBalance = Math.max(0, grossTotal - curPaid);

    if (invoice.status === 'CANCELLED') return c.json({ message: 'Cannot record a payment against a cancelled invoice.' }, 400);
    if (payAmount > curBalance + 0.001) {
      return c.json({ message: `Payment of ${payAmount.toFixed(2)} exceeds the invoice balance of ${curBalance.toFixed(2)}.`, balance: curBalance }, 400);
    }

    const newPaid = curPaid + payAmount;
    remainingItemBalance = Math.max(0, grossTotal - newPaid);

    // Serialize concurrent payments on this invoice, then re-check the balance
    // after the lock so a double-submit cannot overpay.
    stmts.push(c.env.DB.prepare('SELECT id FROM invoices WHERE id = ? FOR UPDATE').bind(invoiceId));
    stmts.push(c.env.DB.prepare(`
      SELECT 1 FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id
      WHERE i.id = ? AND i.status != 'CANCELLED'
        AND (i.total_amount - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0))
            - (SELECT COALESCE(SUM(amount), 0) FROM invoice_payments WHERE invoice_id = i.id) >= ? - 0.001
    `).bind(invoiceId, payAmount).mustAffect('Payment exceeds the invoice balance (another payment was just recorded). Please refresh.'));

    const ipId = uuidv4();
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by, receipt_number, previous_balance, running_balance)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
    `).bind(ipId, invoiceId, payAmount, paymentMethod || 'CASH', notes?.trim() || 'Invoice Payment', userId, receiptNumber, curBalance, remainingItemBalance));

    const newStatus = remainingItemBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';
    const paidAtClause = newStatus === 'PAID' ? ', paid_at = CURRENT_TIMESTAMP' : '';
    stmts.push(c.env.DB.prepare(`
      UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP ${paidAtClause} WHERE id = ?
    `).bind(newStatus, invoiceId));

    if (newStatus === 'PAID') {
      stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.sales_order_id));
    }

    stmts.push(c.env.DB.prepare(`
      INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, invoice_id, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by, branch_id)
      VALUES (?, ?, ?, 'INVOICE', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
    `).bind(paymentId, receiptNumber, customerId, invoiceId, payAmount, paymentMethod || 'CASH', previousBalance, Math.max(0, previousBalance - payAmount), notes?.trim() || null, userId, paymentBranch));

  } else if (allocationType === 'MANUAL_DEBT') {
    if (!manualDebtId) return c.json({ message: 'Manual debt ID is required.' }, 400);
    const debt = await c.env.DB.prepare(
      'SELECT * FROM customer_debts WHERE id = ? AND customer_id = ?'
    ).bind(manualDebtId, customerId).first() as any;

    if (!debt || !inScope(scope, debt.branch_id)) return c.json({ message: 'Manual charge record not found for this customer.' }, 404);
    paymentBranch = debt.branch_id || null;
    billNumber = debt.debt_number;

    const curDebtBal = Number(debt.remaining_balance || 0);
    if (debt.status === 'CANCELLED') return c.json({ message: 'Cannot pay a cancelled charge.' }, 400);
    if (payAmount > curDebtBal + 0.001) {
      return c.json({ message: `Payment of ${payAmount.toFixed(2)} exceeds the remaining charge of ${curDebtBal.toFixed(2)}.`, balance: curDebtBal }, 400);
    }
    remainingItemBalance = Math.max(0, curDebtBal - payAmount);

    // Relative, guarded decrement: concurrent payments cannot overdraw the charge.
    stmts.push(c.env.DB.prepare(`
      UPDATE customer_debts
      SET remaining_balance = GREATEST(0, remaining_balance - ?),
          status = CASE WHEN remaining_balance - ? <= 0.001 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status != 'CANCELLED' AND remaining_balance >= ? - 0.001
    `).bind(payAmount, payAmount, manualDebtId, payAmount).mustAffect('Payment exceeds the remaining charge (another payment was just recorded). Please refresh.'));

    stmts.push(c.env.DB.prepare(`
      INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, manual_debt_id, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by, branch_id)
      VALUES (?, ?, ?, 'MANUAL_DEBT', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
    `).bind(paymentId, receiptNumber, customerId, manualDebtId, payAmount, paymentMethod || 'CASH', previousBalance, Math.max(0, previousBalance - payAmount), notes?.trim() || null, userId, paymentBranch));

  } else {
    // General account payment: no document to follow, so it belongs to the
    // receiving branch (branch users: their own; admins: chosen or company-level).
    paymentBranch = await resolveWriteBranch(c, body.branchId);
    stmts.push(c.env.DB.prepare(`
      INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by, branch_id)
      VALUES (?, ?, ?, 'ACCOUNT', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
    `).bind(paymentId, receiptNumber, customerId, payAmount, paymentMethod || 'CASH', previousBalance, Math.max(0, previousBalance - payAmount), notes?.trim() || 'General Customer Account Payment', userId, paymentBranch));
  }

  stmts.push(createAuditLogStmt(c, 'CUSTOMER_PAYMENT_RECORD', 'customer_payments', paymentId, null, {
    receiptNumber,
    customerId,
    allocationType,
    amount: payAmount,
    paymentMethod,
  }));

  // GL: DR Cash, CR Accounts Receivable — committed with the payment itself.
  const paymentJournal = await prepareCustomerPaymentJournalEntry(
    c,
    { id: paymentId, amount: payAmount, paymentDate: new Date().toISOString().split('T')[0] },
    { id: customerId, order_number: billNumber || `CUST-${customerId.slice(0, 6)}`, branch_id: paymentBranch },
    userId
  );
  stmts.push(...paymentJournal.statements);

  await c.env.DB.batch(stmts);

  const newRemainingBalance = Math.max(0, previousBalance - payAmount);

  return c.json({
    success: true,
    receipt: {
      receipt_number: receiptNumber,
      payment_id: paymentId,
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email,
      customer_address: customer.address,
      payment_method: paymentMethod || 'CASH',
      payment_date: new Date().toISOString(),
      amount: payAmount,
      previous_balance: previousBalance,
      remaining_balance: newRemainingBalance,
      bill_number: billNumber,
      remaining_bill_balance: remainingItemBalance,
      allocation_type: allocationType,
      notes: notes || null,
    },
  }, 201);
});

sales.get('/payments/:receiptNumber/receipt', async (c) => {
  const scope = await resolveBranchScope(c);
  const receiptNumber = c.req.param('receiptNumber');
  const payment = await c.env.DB.prepare(`
    SELECT cp.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.address AS customer_address,
           u.full_name AS recorded_by_name
    FROM customer_payments cp
    JOIN customers c ON c.id = cp.customer_id
    LEFT JOIN users u ON u.id = cp.recorded_by
    WHERE cp.receipt_number = ? ${branchSql(scope, 'cp.branch_id')}
  `).bind(receiptNumber).first() as any;

  if (!payment) return c.json({ message: 'Receipt not found.' }, 404);

  return c.json(payment);
});


// ──────────────────────────────────────────────────────────────────────
// ORDERS — LIST & GET
/** Effective status, payment status and balance of an order row (list and export). */
function enrichOrderRow(row: any) {
  const installFee = Number(row.installation_fee || 0);
  const isPickup = (row.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP';
  const computedDeliveryStatus = isPickup ? (row.status === 'DRAFT' ? null : 'DELIVERED') : row.delivery_status;
  const effectiveStatus = isPickup
    ? (row.status === 'DRAFT' ? 'DRAFT' : 'DELIVERED')
    : (row.delivery_status === 'DELIVERED' ? 'DELIVERED' : row.status);

  if (!row.invoice_id) {
    return {
      ...row,
      status: effectiveStatus,
      delivery_status: computedDeliveryStatus,
      fulfillment_type: row.fulfillment_type || 'DELIVERY',
      installation_fee: installFee,
      installer_name: row.installer_name || null,
      installation_status: row.installation_status || 'NONE',
      payment_status: null,
      balance: null,
    };
  }
  const merchandiseNet = Math.max(0, Number(row.invoice_total || 0) - Number(row.invoice_discount || 0));
  const netTotal = merchandiseNet + installFee;
  const amountPaid = Number(row.amount_paid || 0);
  const balance = Math.max(0, netTotal - amountPaid);
  let payment_status = 'UNPAID';
  if (amountPaid >= netTotal && netTotal > 0) payment_status = 'PAID';
  else if (amountPaid > 0) payment_status = 'PARTIALLY_PAID';
  return {
    ...row,
    status: effectiveStatus,
    delivery_status: computedDeliveryStatus,
    fulfillment_type: row.fulfillment_type || 'DELIVERY',
    installation_fee: installFee,
    installer_name: row.installer_name || null,
    installation_status: row.installation_status || 'NONE',
    merchandise_total: merchandiseNet,
    net_total: netTotal,
    balance,
    payment_status,
  };
}

// ── Sales orders list, paged on the server ───────────────────────────────
// Status and payment status are computed in SQL (the same rules as
// enrichOrderRow), so the server can filter, sort and count by them.
const SALES_LIST: ListOptions = {
  sortable: {
    date: 'created_at', number: 'order_number', customer: 'customer_name', branch: 'branch_name',
    total: 'value_total', balance: 'balance_calc', status: 'effective_status', payment: 'payment_status_calc',
  },
  defaultSort: 'date', defaultDir: 'desc', tieBreaker: 'id',
};

async function listSalesOrders(c: any, r: ListRequest, scopedBranchId: string | null) {
  const q = (k: string) => (c.req.query(k) || '').trim();
  const scope: string[] = [];
  const scopeParams: unknown[] = [];
  if (scopedBranchId) { scope.push('so.branch_id = ?'); scopeParams.push(scopedBranchId); }
  else if (q('branchId')) { scope.push('so.branch_id = ?'); scopeParams.push(q('branchId')); }
  const customer = q('customerId') || q('customer_id');
  if (customer) { scope.push('so.customer_id = ?'); scopeParams.push(customer); }
  if (q('id')) { scope.push('so.id = ?'); scopeParams.push(q('id')); }
  // exclude=DELIVERED: orders still to deliver (for the delivery picker)
  const notDelivered = q('open') === 'delivery';

  const withSql = `
    WITH o AS (
      SELECT so.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city,
             b.name AS branch_name, i.id AS invoice_id,
             i.total_amount AS invoice_total, i.discount_amount AS invoice_discount, i.status AS invoice_status,
             COALESCE(pay.paid, 0) AS amount_paid,
             d.status AS delivery_status, d.id AS delivery_id, d.delivery_number, d.delivered_at, d.total_boxes,
             COALESCE(lt.total, 0) AS lines_total,
             CASE
               WHEN UPPER(COALESCE(so.fulfillment_type, 'DELIVERY')) = 'PICKUP' THEN CASE WHEN so.status = 'DRAFT' THEN 'DRAFT' ELSE 'DELIVERED' END
               WHEN d.status = 'DELIVERED' THEN 'DELIVERED'
               ELSE so.status
             END AS effective_status,
             CASE WHEN i.id IS NULL THEN NULL
                  ELSE GREATEST(0, COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0)) + COALESCE(so.installation_fee, 0)
             END AS net_total_calc
      FROM sales_orders so
      LEFT JOIN customers c ON c.id = so.customer_id
      JOIN branches b ON b.id = so.branch_id
      LEFT JOIN invoices i ON i.sales_order_id = so.id
      LEFT JOIN LATERAL (SELECT SUM(ip.amount) AS paid FROM invoice_payments ip WHERE ip.invoice_id = i.id) pay ON TRUE
      LEFT JOIN LATERAL (SELECT SUM(sol.line_total) AS total FROM sales_order_lines sol WHERE sol.sales_order_id = so.id) lt ON TRUE
      LEFT JOIN LATERAL (
        SELECT dd.status, dd.id, dd.delivery_number, dd.delivered_at, dd.total_boxes
        FROM deliveries dd WHERE dd.sales_order_id = so.id AND dd.status != 'CANCELLED'
        ORDER BY dd.created_at DESC LIMIT 1
      ) d ON TRUE
      ${scope.length ? 'WHERE ' + scope.join(' AND ') : ''}
    ), p AS (
      SELECT o.*,
             CASE WHEN net_total_calc IS NULL THEN NULL
                  WHEN amount_paid >= net_total_calc AND net_total_calc > 0 THEN 'PAID'
                  WHEN amount_paid > 0 THEN 'PARTIALLY_PAID'
                  ELSE 'UNPAID' END AS payment_status_calc,
             COALESCE(net_total_calc, lines_total) AS value_total,
             CASE WHEN net_total_calc IS NULL THEN 0 ELSE GREATEST(0, net_total_calc - amount_paid) END AS balance_calc
      FROM o
    )`;

  // Filters other than status (the status tabs show counts across them).
  const where: string[] = [];
  const params: unknown[] = [];
  const term = q('q') || q('search');
  if (term) {
    where.push('(order_number ILIKE ? OR customer_name ILIKE ? OR customer_phone ILIKE ?)');
    const t = likeTerm(term);
    params.push(t, t, t);
  }
  if (q('paymentStatus') === 'NOT_INVOICED') where.push('payment_status_calc IS NULL');
  else if (q('paymentStatus')) { where.push('payment_status_calc = ?'); params.push(q('paymentStatus')); }
  if (q('fulfillment')) { where.push("UPPER(COALESCE(fulfillment_type, 'DELIVERY')) = ?"); params.push(q('fulfillment').toUpperCase()); }
  if (notDelivered) where.push("effective_status NOT IN ('DELIVERED', 'CANCELLED') AND UPPER(COALESCE(fulfillment_type, 'DELIVERY')) <> 'PICKUP'");
  dateRange(c, 'created_at', where, params);

  const statusWhere = [...where];
  const statusParams = [...params];
  if (q('status') && q('status') !== 'ALL') { statusWhere.push('effective_status = ?'); statusParams.push(q('status')); }
  const base = `FROM p ${statusWhere.length ? 'WHERE ' + statusWhere.join(' AND ') : ''}`;

  const { rows, total } = await pagedRows(c.env.DB, '*', base, [...scopeParams, ...statusParams], r, withSql);
  const items = rows.map(enrichOrderRow);

  if (r.csv) {
    return csvResponse(c, 'sales-orders', [
      { label: 'Order', value: (o: any) => o.order_number },
      { label: 'Date', value: (o: any) => String(o.created_at instanceof Date ? o.created_at.toISOString() : o.created_at).slice(0, 10) },
      { label: 'Customer', value: (o: any) => o.customer_name },
      { label: 'Phone', value: (o: any) => o.customer_phone },
      { label: 'Branch', value: (o: any) => o.branch_name },
      { label: 'Fulfillment', value: (o: any) => o.fulfillment_type },
      { label: 'Status', value: (o: any) => o.status },
      { label: 'Payment', value: (o: any) => o.payment_status ?? 'NOT INVOICED' },
      { label: 'Total', value: (o: any) => Number(o.net_total ?? o.lines_total ?? 0).toFixed(2) },
      { label: 'Paid', value: (o: any) => Number(o.amount_paid ?? 0).toFixed(2) },
      { label: 'Balance', value: (o: any) => Number(o.balance ?? 0).toFixed(2) },
    ], items);
  }

  // Counts per status (for the tabs) and money totals, across the same filters.
  const { results: grouped } = await c.env.DB.prepare(`
    ${withSql}
    SELECT effective_status AS status, COUNT(*)::int AS n, COALESCE(SUM(value_total), 0) AS value, COALESCE(SUM(balance_calc), 0) AS balance
    FROM p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY effective_status
  `).bind(...scopeParams, ...params).all();
  const counts: Record<string, number> = { ALL: 0 };
  let value = 0;
  let outstanding = 0;
  for (const g of (grouped || []) as any[]) {
    counts[g.status] = Number(g.n);
    counts.ALL += Number(g.n);
    if (!q('status') || q('status') === 'ALL' || q('status') === g.status) {
      value += Number(g.value);
      outstanding += Number(g.balance);
    }
  }
  return pagedResponse(c, r, items, total, { counts, totals: { value: Math.round(value * 100) / 100, outstanding: Math.round(outstanding * 100) / 100 } });
}

// ──────────────────────────────────────────────────────────────────────
sales.get('/orders', async (c) => {
  const listReq = listRequest(c, SALES_LIST);
  if (listReq.paged) return listSalesOrders(c, listReq, await scopedSalesBranch(c));
  const { search, status, paymentStatus, dateFrom, dateTo, customer_id, customerId } = c.req.query();
  const payload = c.get('jwtPayload');
  const scopedBranchId = await scopedSalesBranch(c);

  let query = `
    SELECT so.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city,
           b.name AS branch_name, i.id AS invoice_id,
           i.total_amount AS invoice_total, i.discount_amount AS invoice_discount, i.status AS invoice_status,
           COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS amount_paid,
           d.status AS delivery_status, d.id AS delivery_id, d.delivery_number, d.delivered_at, d.total_boxes,
           -- the order's own value, for orders not invoiced yet (drafts, web orders)
           (SELECT COALESCE(SUM(sol.line_total), 0) FROM sales_order_lines sol WHERE sol.sales_order_id = so.id) AS lines_total
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    -- the order's latest delivery that is not cancelled (one lookup instead of five)
    LEFT JOIN LATERAL (
      SELECT dd.status, dd.id, dd.delivery_number, dd.delivered_at, dd.total_boxes
      FROM deliveries dd
      WHERE dd.sales_order_id = so.id AND dd.status != 'CANCELLED'
      ORDER BY dd.created_at DESC LIMIT 1
    ) d ON TRUE
    WHERE 1=1
  `;
  const params: any[] = [];

  // Branch isolation — branch users only see their own branch's orders
  if (scopedBranchId) {
    query += ` AND so.branch_id = ?`;
    params.push(scopedBranchId);
  }

  // Filter by customer if requested
  const targetCustomerId = customer_id || customerId;
  if (targetCustomerId) {
    query += ` AND so.customer_id = ?`;
    params.push(targetCustomerId);
  }

  if (search) {
    query += ` AND (so.order_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status && status !== 'ALL') {
    query += ` AND so.status = ?`;
    params.push(status);
  }
  if (dateFrom) {
    query += ` AND date(so.created_at) >= date(?)`;
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND date(so.created_at) <= date(?)`;
    params.push(dateTo);
  }

  query += ` ORDER BY so.created_at DESC LIMIT 200`;

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  // Compute payment_status and balance for each row that has an invoice
  const enriched = (results || []).map(enrichOrderRow);

  // Client-side filter by payment status (computed field — cannot be done in SQL easily)
  if (paymentStatus && paymentStatus !== 'ALL') {
    return c.json(enriched.filter((r: any) => r.payment_status === paymentStatus));
  }

  return c.json(enriched);
});

sales.get('/orders/:id', async (c) => {
  const id = c.req.param('id');
  const payload = c.get('jwtPayload');
  const scopedBranchId = await scopedSalesBranch(c);

  const { results: orders } = await c.env.DB.prepare(`
    SELECT so.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city,
           b.name AS branch_name,
           i.id AS invoice_id, i.invoice_number, i.total_amount AS invoice_total,
           i.discount_amount AS invoice_discount, i.status AS invoice_status, i.issued_at
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    WHERE so.id = ?
  `).bind(id).all();
  
  if (!orders.length) return c.json({ message: 'Not found' }, 404);
  const order = orders[0] as any;

  if (scopedBranchId && order.branch_id !== scopedBranchId) {
    return c.json({ message: "That order belongs to another branch, so you can't change it." }, 403);
  }

  const { results: lines } = await c.env.DB.prepare(`
    SELECT sol.*, COALESCE(sol.fulfillment_type, 'DELIVERY') AS fulfillment_type, p.name AS product_name, p.sku AS product_sku, COALESCE(p.product_type, 'STANDARD') AS product_type
    FROM sales_order_lines sol
    LEFT JOIN products p ON p.id = sol.product_id
    WHERE sol.sales_order_id = ?
  `).bind(id).all();

  const delInfo = await c.env.DB.prepare(
    "SELECT total_boxes, delivered_boxes, remaining_boxes FROM deliveries WHERE sales_order_id = ? AND status != 'CANCELLED' ORDER BY created_at DESC LIMIT 1"
  ).bind(id).first() as any;
  order.total_boxes = delInfo ? delInfo.total_boxes : null;
  order.delivered_boxes = delInfo ? delInfo.delivered_boxes : 0;
  order.remaining_boxes = delInfo ? delInfo.remaining_boxes : null;

  // Enrich with payment summary if invoice exists
  let paymentSummary = null;
  let payments: any[] = [];
  if (order.invoice_id) {
    paymentSummary = await getInvoicePaymentSummary(
      c.env.DB, order.invoice_id,
      Number(order.invoice_total || 0),
      Number(order.invoice_discount || 0)
    );
    const { results: pmts } = await c.env.DB.prepare(`
      SELECT ip.*, u.full_name AS recorded_by_name
      FROM invoice_payments ip
      LEFT JOIN users u ON u.id = ip.recorded_by
      WHERE ip.invoice_id = ?
      ORDER BY ip.created_at DESC
    `).bind(order.invoice_id).all();
    payments = pmts || [];
  }

  // Fetch delivery details for this order
  const { results: dels } = await c.env.DB.prepare(`
    SELECT * FROM deliveries WHERE sales_order_id = ? ORDER BY created_at DESC
  `).bind(id).all();
  const deliveriesList = dels || [];
  const activeDelivery: any = deliveriesList.find((d: any) => d.status !== 'CANCELLED');
  const isPickup = ((order as any).fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP';
  const deliveryStatus = isPickup ? (order.status === 'DRAFT' ? null : 'DELIVERED') : (activeDelivery ? activeDelivery.status : null);
  const effectiveStatus = isPickup
    ? (order.status === 'DRAFT' ? 'DRAFT' : 'DELIVERED')
    : (deliveryStatus === 'DELIVERED' ? 'DELIVERED' : order.status);

  return c.json({
    ...order,
    status: effectiveStatus,
    delivery_status: deliveryStatus,
    fulfillment_type: order.fulfillment_type || 'DELIVERY',
    delivery_id: activeDelivery?.id || null,
    delivery_number: activeDelivery?.delivery_number || null,
    delivered_at: activeDelivery?.delivered_at || null,
    deliveries: deliveriesList,
    lines,
    payment_summary: paymentSummary,
    payments,
  });
});

// Strict branch scope for sales and receivables (services/branch-scope.ts):
// branch-scoped users see their branch only; admins/accountants see all;
// users with neither a branch nor an all-branch role are refused (403).
async function scopedSalesBranch(c: any): Promise<string | null> {
  const loc = await resolveLoc(c);
  if (loc.kind === 'WAREHOUSE') throw new ScopeError(403, 'Sales are recorded by branches.');
  return locBranch(loc);
}

async function assertOrderInScope(c: any, orderId: string | undefined) {
  const branchId = await scopedSalesBranch(c);
  if (!branchId) return;
  const order = await c.env.DB.prepare('SELECT branch_id FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (order && order.branch_id !== branchId) throw new ScopeError(403, "That order belongs to another branch, so you can't change it.");
}

async function assertInvoiceInScope(c: any, invoiceId: string | undefined) {
  const branchId = await scopedSalesBranch(c);
  if (!branchId) return;
  const inv = await c.env.DB.prepare('SELECT so.branch_id FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id WHERE i.id = ?').bind(invoiceId).first();
  if (inv && inv.branch_id !== branchId) throw new ScopeError(403, 'Access denied: invoice belongs to another branch.');
}

// Settle the remaining balance of an order's invoice (installation fee
// included): payment row + its ledger entry + PAID statuses, in one batch.
// The order status change is guarded on `fromStatus`, so a double-submit
// rolls back instead of paying twice.
async function prepareInvoiceSettlement(c: any, orderId: string, fromStatus: string, userId: string, note: string) {
  const invoice = await c.env.DB.prepare(`
    SELECT i.id, i.total_amount, i.discount_amount, so.order_number, so.branch_id, COALESCE(so.installation_fee, 0) AS installation_fee,
           (SELECT COALESCE(SUM(amount), 0) FROM invoice_payments WHERE invoice_id = i.id) AS paid
    FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id
    WHERE i.sales_order_id = ? AND i.status != 'CANCELLED'
  `).bind(orderId).first() as any;
  if (!invoice) return null;

  const due = Number(invoice.total_amount) - Number(invoice.discount_amount || 0) + Number(invoice.installation_fee || 0);
  const remaining = Math.max(0, Math.round((due - Number(invoice.paid || 0)) * 100) / 100);
  const statements: any[] = [
    c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ? AND status = ?").bind(orderId, fromStatus)
      .mustAffect('This order is already being paid or was changed. Please refresh.'),
    c.env.DB.prepare("UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.id),
    createAuditLogStmt(c, 'SALES_ORDER_PAY', 'sales_orders', orderId, { status: fromStatus }, { status: 'PAID', invoiceId: invoice.id, amount: remaining }),
  ];
  if (remaining > 0) {
    const paymentId = uuidv4();
    statements.push(c.env.DB.prepare(`
      INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by)
      VALUES (?, ?, ?, 'CASH', CURRENT_TIMESTAMP, ?, ?)
    `).bind(paymentId, invoice.id, remaining, note, userId));
    const journal = await prepareCustomerPaymentJournalEntry(
      c, { id: paymentId, amount: remaining },
      { id: orderId, order_number: String(invoice.order_number || orderId), branch_id: invoice.branch_id }, userId,
    );
    statements.push(...journal.statements);
  }
  return { invoiceId: invoice.id as string, statements };
}

// Branch stock issue that cannot go negative: under concurrent sales of the
// last units the second transaction matches no row and rolls back (409).
function branchStockIssue(db: PgAdapter, productId: string, qty: number, branchId: string) {
  return db.prepare(`
    UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
    WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ? AND quantity_on_hand >= ?
  `).bind(qty, productId, branchId, qty)
    .mustAffect('Insufficient stock: these units were just sold or moved. Please refresh and try again.');
}

/**
 * Cost of the stock a sale takes: from the price levels, oldest first, for products that have
 * them; otherwise the product's cost. Also stamps each sale line with its unit cost and records
 * the level moves (under the invoice id, so a cancel or return can put the units back).
 */
async function saleIssueCost(db: any, orderId: string, lines: Array<{ product_id: string; quantity: number }>, invoiceId: string, userId: string | null) {
  const perLine: Array<{ line: { product_id: string; quantity: number }; reqs: Array<{ productId: string; quantity: number }> }> = [];
  const ids = new Set<string>();
  // One read per line, all at once (the pool caps how many run together); order is kept.
  const resolved = await Promise.all(lines.map((line) =>
    resolveLinesToInventoryRequirements(db, [{ productId: line.product_id, quantity: Number(line.quantity) }])));
  lines.forEach((line, i) => {
    perLine.push({ line, reqs: resolved[i] });
    resolved[i].forEach((r) => ids.add(r.productId));
  });
  const planner = await levelPlanner(db, [...ids]);
  let cogs = 0;
  const stmts: any[] = [];
  for (const { line, reqs } of perLine) {
    let lineCost = 0;
    for (const r of reqs) lineCost += planner.take(r.productId, r.quantity).cost;
    cogs += lineCost;
    const q = Number(line.quantity) || 1;
    stmts.push(db.prepare('UPDATE sales_order_lines SET unit_cost = ? WHERE sales_order_id = ? AND product_id = ? AND unit_cost IS NULL')
      .bind(Math.round((lineCost / q) * 10000) / 10000, orderId, line.product_id));
  }
  stmts.push(...planner.statements('SALE', invoiceId, userId));
  return { cogs: Math.round(cogs * 100) / 100, stmts };
}

// ──────────────────────────────────────────────────────────────────────
// Helper: Resolve sales lines to inventory requirements (standard vs grouped)
// ──────────────────────────────────────────────────────────────────────
async function resolveLinesToInventoryRequirements(
  db: any,
  lines: Array<{ productId?: string; product_id?: string; quantity: number }>
): Promise<Array<{ productId: string; quantity: number; productName: string }>> {
  if (!lines || lines.length === 0) return [];

  const cleanLines = lines.map((l) => ({
    productId: (l.productId || l.product_id) as string,
    quantity: Number(l.quantity || 1),
  })).filter((l) => Boolean(l.productId));

  if (!cleanLines.length) return [];

  const productIds = Array.from(new Set(cleanLines.map((l) => l.productId)));
  const placeholders = productIds.map(() => '?').join(', ');
  const { results: prods } = await db.prepare(
    `SELECT id, name, COALESCE(product_type, 'STANDARD') AS product_type FROM products WHERE id IN (${placeholders})`
  ).bind(...productIds).all();

  const prodMap = new Map<string, any>();
  for (const p of (prods || []) as any[]) {
    prodMap.set(p.id, p);
  }

  const groupedIds = (prods || []).filter((p: any) => p.product_type === 'GROUPED').map((p: any) => p.id);
  const groupItemsMap = new Map<string, any[]>();
  if (groupedIds.length > 0) {
    const gPlaceholders = groupedIds.map(() => '?').join(', ');
    const { results: gItems } = await db.prepare(`
      SELECT pgi.parent_product_id, pgi.component_product_id, pgi.quantity, cp.name AS component_name
      FROM product_group_items pgi
      JOIN products cp ON cp.id = pgi.component_product_id
      WHERE pgi.parent_product_id IN (${gPlaceholders})
    `).bind(...groupedIds).all();

    for (const gi of (gItems || []) as any[]) {
      const list = groupItemsMap.get(gi.parent_product_id) || [];
      list.push(gi);
      groupItemsMap.set(gi.parent_product_id, list);
    }
  }

  const reqMap = new Map<string, { quantity: number; productName: string }>();
  for (const l of cleanLines) {
    const p = prodMap.get(l.productId);
    if (p?.product_type === 'GROUPED') {
      const components = groupItemsMap.get(l.productId) || [];
      for (const comp of components) {
        const compQty = Math.max(1, Number(comp.quantity || 1)) * l.quantity;
        const existing = reqMap.get(comp.component_product_id) || { quantity: 0, productName: comp.component_name || 'Component' };
        existing.quantity += compQty;
        reqMap.set(comp.component_product_id, existing);
      }
    } else {
      const existing = reqMap.get(l.productId) || { quantity: 0, productName: p?.name || 'Product' };
      existing.quantity += l.quantity;
      reqMap.set(l.productId, existing);
    }
  }

  return Array.from(reqMap.entries()).map(([productId, item]) => ({
    productId,
    quantity: item.quantity,
    productName: item.productName,
  }));
}

// ──────────────────────────────────────────────────────────────────────
// CREATE ORDER — with full input validation
// ──────────────────────────────────────────────────────────────────────

/** Reasons a seller may give when the sold price differs from the product's price. */
const cleanReason = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);

/** Tells the Owner/admins and accountants about price changes on an order's lines (one message per order). */
function priceAdjustmentNotice(db: any, orderId: string, actorId: string | null) {
  return db.prepare(`
    INSERT INTO notifications (id, user_id, title, message, type)
    SELECT gen_random_uuid()::text, u.id, 'Price changed on ' || so.order_number,
           COALESCE(a.full_name, 'A seller') || COALESCE(' (' || b.name || ')', '') || ': ' ||
           (SELECT string_agg(p.name || ' ' || to_char(sol.list_price, 'FM999999990.00') || ' → ' || to_char(sol.unit_price, 'FM999999990.00')
                              || ' (' || CASE WHEN sol.unit_price > sol.list_price THEN '+' ELSE '-' END || to_char(abs(sol.unit_price - sol.list_price), 'FM999999990.00') || ')'
                              || COALESCE(' – ' || sol.adjustment_reason, ''), '; ')
            FROM sales_order_lines sol JOIN products p ON p.id = sol.product_id
            WHERE sol.sales_order_id = so.id AND sol.list_price IS NOT NULL AND abs(sol.unit_price - sol.list_price) > 0.005),
           'PRICE'
    FROM sales_orders so
    LEFT JOIN users a ON a.id = ?::text
    LEFT JOIN branches b ON b.id = so.branch_id
    JOIN users u ON u.is_active = 1 AND u.id IS DISTINCT FROM ?::text AND (
      EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code IN ('admin', 'accountant'))
      OR EXISTS (SELECT 1 FROM user_permissions up JOIN permissions pm ON pm.id = up.permission_id WHERE up.user_id = u.id AND pm.code = 'accounting.view'))
    WHERE so.id = ?
      AND EXISTS (SELECT 1 FROM sales_order_lines x WHERE x.sales_order_id = so.id AND x.list_price IS NOT NULL AND abs(x.unit_price - x.list_price) > 0.005)
  `).bind(actorId, actorId, orderId);
}

sales.post('/orders', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  const payload = c.get('jwtPayload');
  const userId = payload.sub;

  // Branch isolation — branch users can only create orders for their own branch
  const writeScope = await resolveBranchScope(c, 'ALL');
  if (writeScope.kind === 'BRANCH') {
    // The branch comes from who is signed in. A different one is refused, not silently replaced.
    if (body.branchId && body.branchId !== writeScope.branchId) {
      return c.json({ message: 'This sale can only be recorded under the branch you work from. Please reload the page and try again.' }, 403);
    }
    body.branchId = writeScope.branchId;
  }

  // Validate branch
  if (!body.branchId) return c.json({ message: 'Branch is required.' }, 400);

  // The checks and reads below do not depend on each other, so they run at the same time:
  // each one is a round trip to the database, and one after another they made the sale slow.
  // (A request may hold up to 5 connections; this uses 5 at most.)
  const lineProductIds: string[] = Array.from(new Set((Array.isArray(body.lines) ? body.lines : []).map((l: any) => l?.productId).filter(Boolean)));
  const [branch, customer, webRows, pricePlanner, productRows] = await Promise.all([
    c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(body.branchId).first(),
    !body.customerId ? Promise.resolve(true)
      : writeScope.kind === 'BRANCH'
        ? c.env.DB.prepare(`SELECT cu.id FROM customers cu WHERE cu.id = ? AND ${customerVisibleSql(writeScope.branchId)}`).bind(body.customerId).first()
        : c.env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(body.customerId).first(),
    // Quoted website prices: only from a website request that is being converted right now.
    !body.webRequestId ? Promise.resolve({ results: [] as any[] })
      : c.env.DB.prepare(`
      SELECT l.product_id, l.unit_price FROM storefront_request_lines l JOIN storefront_requests r ON r.id = l.request_id
      WHERE r.id = ? AND r.status = 'PROCESSING'
    `).bind(String(body.webRequestId)).all(),
    // Products with price levels: the oldest level's price first (a quantity that crosses into the
    // next level is priced at both, e.g. 5 × 100 + 3 × 120).
    levelPlanner(c.env.DB, lineProductIds),
    // Every product of the order in one read (it used to be one read per line).
    !lineProductIds.length ? Promise.resolve({ results: [] as any[] })
      : c.env.DB.prepare(`SELECT id, name, selling_price, COALESCE(is_active, 1) AS is_active FROM products WHERE id IN (${lineProductIds.map(() => '?').join(', ')})`).bind(...lineProductIds).all(),
  ]);
  if (!branch) return c.json({ message: 'Branch does not exist.' }, 400);
  if (body.customerId && !customer) return c.json({ message: 'Customer does not exist.' }, 400);

  // Validate lines
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: 'At least one order line is required.' }, 400);
  }

  const seenProducts = new Set<string>();
  const webPrices = new Map<string, number>();
  for (const r of ((webRows as any)?.results || []) as any[]) webPrices.set(r.product_id, Number(r.unit_price));
  const productsById = new Map<string, any>((((productRows as any)?.results || []) as any[]).map((r) => [r.id, r]));
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    if (!line.quantity || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      return c.json({ message: `Line ${i + 1}: quantity must be a positive integer.` }, 400);
    }
    if (seenProducts.has(line.productId)) {
      return c.json({ message: `Line ${i + 1}: duplicate product. Combine quantities into one line.` }, 400);
    }
    seenProducts.add(line.productId);

    const product = productsById.get(line.productId);
    if (!product) return c.json({ message: `Line ${i + 1}: product does not exist.` }, 400);
    if (product.is_active === 0) {
      return c.json({ message: `Cannot sell inactive product "${product.name}". Please activate the product before creating new sales orders.` }, 400);
    }

    // Owner rule: a sale always uses the product's current selling price (set by the Owner in
    // Products). Nobody can type a price on a sale; a price sent by the client is ignored.
    // Only a website request being converted keeps the price the customer was quoted.
    line.unitPrice = webPrices.has(line.productId) ? webPrices.get(line.productId)! : Number(product.selling_price || 0);
    line.priceBreakdown = null;
    if (!webPrices.has(line.productId) && pricePlanner.has(line.productId)) {
      const t = pricePlanner.take(line.productId, line.quantity, false);
      if (Number.isFinite(t.unitPrice)) { line.unitPrice = Math.round(t.unitPrice * 10000) / 10000; line.priceBreakdown = t.breakdown; }
    }
    line.listPrice = line.unitPrice;
  }

  const isCreditSale = Boolean(body.isCreditSale);
  const initialDeposit = Math.max(0, Number(body.initialDeposit || 0));
  const depositMethod = body.depositPaymentMethod || 'CASH';

  let invReqs: Array<{ productId: string; quantity: number; productName: string }> = [];
  // If credit sale, do immediate stock check so inventory can be deducted at creation
  if (isCreditSale) {
    invReqs = await resolveLinesToInventoryRequirements(c.env.DB, body.lines);
    if (invReqs.length > 0) {
      const reqProductIds = invReqs.map((r) => r.productId);
      const placeholders = reqProductIds.map(() => '?').join(', ');
      const { results: stockRows } = await c.env.DB.prepare(`
        SELECT s.product_id, s.quantity_on_hand, p.name AS product_name
        FROM inventory_stock s
        JOIN products p ON p.id = s.product_id
        WHERE s.product_id IN (${placeholders}) AND s.owner_type = 'BRANCH' AND s.branch_id = ?
      `).bind(...reqProductIds, body.branchId).all();

      const stockMap = new Map<string, number>();
      for (const row of (stockRows || []) as any[]) {
        stockMap.set(row.product_id, Number(row.quantity_on_hand) || 0);
      }

      const insufficient: string[] = [];
      for (const req of invReqs) {
        const avail = stockMap.get(req.productId) || 0;
        if (avail < req.quantity) {
          insufficient.push(`${req.productName}: need ${req.quantity}, available ${avail}`);
        }
      }
      if (insufficient.length > 0) {
        return c.json({ message: 'Insufficient stock at this branch for credit sale.', details: insufficient }, 400);
      }
    }
  }

  const id = uuidv4();
  const orderNumber = `SO-${Date.now()}`;
  const installFee = Math.max(0, Number(body.installationFee || 0));
  const installerName = body.installerName ? String(body.installerName).trim() : null;
  const installerNotes = body.installerNotes ? String(body.installerNotes).trim() : null;
  const installStatus = installFee > 0 ? 'PENDING' : 'NONE';
  const orderStatus = isCreditSale ? 'CONFIRMED' : 'DRAFT';
  const fulfillmentType = (body.fulfillmentType || body.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? 'PICKUP' : 'DELIVERY';

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO sales_orders (
      id, order_number, customer_id, branch_id, status, created_by,
      installation_fee, installer_name, installation_status, installer_notes,
      is_credit_sale, initial_deposit, fulfillment_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, orderNumber, body.customerId || null, body.branchId, orderStatus, userId,
    installFee, installerName, installStatus, installerNotes,
    isCreditSale ? 1 : 0, initialDeposit, fulfillmentType
  ));

  let subtotal = 0;
  let totalDiscount = 0;

  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    const lineTotal = (line.quantity * line.unitPrice) - discountAmount;
    subtotal += (line.quantity * line.unitPrice);
    totalDiscount += discountAmount;
    const lineFulfillmentType = (line.fulfillmentType || line.fulfillment_type || fulfillmentType).toUpperCase() === 'PICKUP' ? 'PICKUP' : 'DELIVERY';

    stmts.push(c.env.DB.prepare(`
      INSERT INTO sales_order_lines (id, sales_order_id, product_id, quantity, unit_price, discount_amount, line_total, fulfillment_type, list_price, adjustment_reason, price_breakdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitPrice, discountAmount, lineTotal, lineFulfillmentType, line.listPrice, null, line.priceBreakdown || null));
  }

  const netTotal = subtotal - totalDiscount;
  const grandTotal = netTotal + installFee;
  const deposit = Math.min(grandTotal, initialDeposit);
  const remaining = Math.max(0, grandTotal - deposit);

  let invoiceId = uuidv4();
  let receiptNumber: string | null = null;

  if (isCreditSale) {
    // 1. Deduct inventory immediately from physical stock (resolving components for grouped items)
    for (const req of invReqs) {
      stmts.push(branchStockIssue(c.env.DB, req.productId, req.quantity, body.branchId));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), req.productId, -req.quantity, body.branchId, invoiceId, userId));
    }

    // 2. Create invoice
    const invStatus = remaining <= 0 ? 'PAID' : (deposit > 0 ? 'PARTIALLY_PAID' : 'UNPAID');
    const paidAt = remaining <= 0 ? 'CURRENT_TIMESTAMP' : null;

    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount, discount_amount, status, paid_at, installation_fee, is_credit_sale)
      VALUES (?, ?, ?, ?, ?, ?, ${paidAt ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?, 1)
    `).bind(invoiceId, `INV-${Date.now()}`, id, subtotal, totalDiscount, invStatus, installFee));

    // Copy lines to invoice_lines
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, quantity, unit_price)
      SELECT lower(hex(randomblob(16))), ?, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = ?
    `).bind(invoiceId, id));

    // 3. If upfront deposit made at checkout, record payment & unique receipt
    //    (also for walk-in customers: the invoice status above already counts it)
    if (deposit > 0) {
      receiptNumber = `RCP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const paymentId = uuidv4();

      stmts.push(c.env.DB.prepare(`
        INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by, receipt_number, previous_balance, running_balance)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'Upfront Deposit at Checkout', ?, ?, ?, ?)
      `).bind(uuidv4(), invoiceId, deposit, depositMethod, userId, receiptNumber, grandTotal, remaining));

      if (body.customerId) {
        stmts.push(c.env.DB.prepare(`
          INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, invoice_id, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by, branch_id)
          VALUES (?, ?, ?, 'INVOICE', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'Upfront Deposit at Checkout', ?, ?)
        `).bind(paymentId, receiptNumber, body.customerId, invoiceId, deposit, depositMethod, grandTotal, remaining, userId, body.branchId));
      }
    }

    // 4. Revenue/receivable/COGS and the deposit commit with the sale.
    const orderRef = { id, order_number: orderNumber, branch_id: body.branchId };
    const issue = await saleIssueCost(c.env.DB, id, body.lines.map((l: any) => ({ product_id: l.productId, quantity: l.quantity })), invoiceId, userId);
    const cogsAmount = issue.cogs;
    stmts.push(...issue.stmts);
    stmts.push(...(await prepareSaleJournalEntry(c, orderRef, netTotal, cogsAmount, userId, undefined, undefined, installFee)).statements);
    if (deposit > 0) {
      stmts.push(...(await prepareCustomerPaymentJournalEntry(c, { id: invoiceId, amount: deposit }, orderRef, userId)).statements);
    }
  }

  stmts.push(createAuditLogStmt(c, 'SALES_ORDER_CREATE', 'sales_orders', id, null, {
    orderNumber,
    branchId: body.branchId,
    customerId: body.customerId,
    isCreditSale,
    deposit,
    remaining,
    lines: body.lines,
  }));

  await c.env.DB.batch(stmts);

  const { results } = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).all();
  return c.json({
    ...results[0],
    invoice_id: isCreditSale ? invoiceId : null,
    invoice_total: isCreditSale ? grandTotal : null,
    amount_paid: isCreditSale ? deposit : 0,
    balance: isCreditSale ? remaining : grandTotal,
    receipt_number: receiptNumber,
  }, 201);
});

// ──────────────────────────────────────────────────────────────────────
// CONFIRM ORDER — DRAFT → CONFIRMED (strict state machine)
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/confirm', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');
  await assertOrderInScope(c, id);

  // CAS: only transition from DRAFT
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ? AND status = 'DRAFT'"
  ).bind(id).run();

  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare('SELECT status FROM sales_orders WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ message: 'Order not found.' }, 404);
    return c.json({ message: `Cannot confirm: order is currently '${existing.status}'. Only DRAFT orders can be confirmed.` }, 400);
  }

  await logAudit(c, 'SALES_ORDER_CONFIRM', 'sales_orders', id, { status: 'DRAFT' }, { status: 'CONFIRMED' });
  const { results } = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).all();
  return c.json(results[0]);
});

// ──────────────────────────────────────────────────────────────────────
// INVOICE ORDER — CONFIRMED → INVOICED
// Pre-flight stock check, duplicate invoice guard, atomic execution
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/invoice', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');
  await assertOrderInScope(c, orderId);
  const userId = c.get('jwtPayload').sub;

  // CAS: only transition from CONFIRMED
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'INVOICING' WHERE id = ? AND status = 'CONFIRMED'"
  ).bind(orderId).run();

  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare('SELECT status FROM sales_orders WHERE id = ?').bind(orderId).first();
    if (!existing) return c.json({ message: 'Order not found.' }, 404);
    if (existing.status === 'INVOICED' || existing.status === 'PAID') {
      return c.json({ message: 'This order has already been invoiced.' }, 409);
    }
    return c.json({ message: `Cannot invoice: order is currently '${existing.status}'. Only CONFIRMED orders can be invoiced.` }, 400);
  }

  try {
    // Check for existing invoice (belt-and-suspenders)
    const existingInvoice = await c.env.DB.prepare(
      'SELECT id FROM invoices WHERE sales_order_id = ?'
    ).bind(orderId).first();
    if (existingInvoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'An invoice already exists for this order.' }, 409);
    }

    const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
    const branchId = order?.branch_id;

    const { results: lines } = await c.env.DB.prepare(
      'SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).all();

    if (!lines || lines.length === 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'Order has no line items.' }, 400);
    }

    // Pre-flight stock check — single query for all products/components instead of N+1 individual lookups
    const invReqs = await resolveLinesToInventoryRequirements(c.env.DB, lines);
    const productIds = invReqs.map((l: any) => l.productId as string);
    const placeholders = productIds.map(() => '?').join(', ');

    const { results: stockRows } = await c.env.DB.prepare(`
      SELECT s.id, s.product_id, s.quantity_on_hand, p.name AS product_name
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      WHERE s.product_id IN (${placeholders}) AND s.owner_type = 'BRANCH' AND s.branch_id = ?
    `).bind(...productIds, branchId).all();

    const stockMap = new Map<string, { stockId: string; qtyOnHand: number }>();
    const productNameMap = new Map<string, string>();
    for (const row of (stockRows || []) as any[]) {
      stockMap.set(row.product_id, {
        stockId: row.id || '',
        qtyOnHand: Number(row.quantity_on_hand) || 0,
      });
      productNameMap.set(row.product_id, row.product_name || row.product_id);
    }

    const insufficientLines: string[] = [];
    for (const req of invReqs) {
      const pid = req.productId;
      const available = stockMap.get(pid)?.qtyOnHand || 0;
      const requested = req.quantity;
      if (available < requested) {
        insufficientLines.push(`${productNameMap.get(pid) || req.productName || pid}: need ${requested}, available ${available}`);
      }
      if (!stockMap.has(pid)) {
        stockMap.set(pid, { stockId: '', qtyOnHand: 0 });
      }
    }

    if (insufficientLines.length > 0) {
      // Find where stock is available in other locations to guide the user
      const failedPids = invReqs
        .filter((l: any) => (stockMap.get(l.productId)?.qtyOnHand || 0) < l.quantity)
        .map((l: any) => l.productId);

      const altHolders = failedPids.map(() => '?').join(', ');
      const { results: altStocks } = await c.env.DB.prepare(`
        SELECT s.product_id, s.quantity_on_hand, COALESCE(w.name, b.name, 'Other Location') AS location_name
        FROM inventory_stock s
        LEFT JOIN warehouses w ON w.id = s.warehouse_id
        LEFT JOIN branches b ON b.id = s.branch_id
        WHERE s.product_id IN (${altHolders}) AND s.quantity_on_hand > 0 AND NOT (s.owner_type = 'BRANCH' AND s.branch_id = ?)
      `).bind(...failedPids, branchId).all();

      const altLocationMap = new Map<string, string[]>();
      for (const alt of (altStocks || []) as any[]) {
        const list = altLocationMap.get(alt.product_id) || [];
        list.push(`${alt.quantity_on_hand} at ${alt.location_name}`);
        altLocationMap.set(alt.product_id, list);
      }

      const detailedLines = invReqs
        .filter((l: any) => (stockMap.get(l.productId)?.qtyOnHand || 0) < l.quantity)
        .map((l: any) => {
          const pid = l.productId;
          const name = productNameMap.get(pid) || l.productName || pid;
          const available = stockMap.get(pid)?.qtyOnHand || 0;
          const requested = l.quantity;
          const alts = altLocationMap.get(pid);
          const altHint = alts && alts.length > 0 ? ` (Found in other locations: ${alts.join(', ')})` : ' (Out of stock company-wide)';
          return `${name}: need ${requested}, available ${available} at this branch${altHint}`;
        });

      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'Insufficient stock for this sale.', details: detailedLines }, 400);
    }

    // Calculate total and discount from order lines
    const totalRes = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(quantity * unit_price), 0) AS subtotal, COALESCE(SUM(discount_amount), 0) AS total_discount FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).first();
    const subtotal = Number(totalRes?.subtotal || 0);
    const discountAmount = Number(totalRes?.total_discount || 0);
    const total = subtotal - discountAmount;

    // Build atomic batch
    const invoiceId = uuidv4();
    const stmts: any[] = [];

    // Create invoice — total_amount is gross subtotal, discount_amount is discount
    const installFee = Number((order as any)?.installation_fee || 0);
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount, discount_amount, installation_fee)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(invoiceId, `INV-${Date.now()}`, orderId, subtotal, discountAmount, installFee));

    // Copy lines to invoice_lines
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, quantity, unit_price)
      SELECT lower(hex(randomblob(16))), ?, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = ?
    `).bind(invoiceId, orderId));

    // Stock now leaves the branch: free what a website request held for this order.
    stmts.push(releaseReservationsStmt(c.env.DB, { orderId: String(orderId) }, 'Sales order invoiced'));

    // Deduct inventory from branch
    for (const req of invReqs) {
      const qty = req.quantity;

      stmts.push(branchStockIssue(c.env.DB, req.productId, qty, String(branchId)));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), req.productId, -qty, branchId, invoiceId, userId));
    }

    // Flip order to INVOICED
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_INVOICE', 'sales_orders', orderId, { status: 'CONFIRMED' }, { status: 'INVOICED', invoiceId, total }));

    // Revenue, receivable (incl. installation fee) and COGS commit with the invoice.
    const { results: issueLines } = await c.env.DB.prepare('SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?').bind(orderId).all();
    const issue = await saleIssueCost(c.env.DB, orderId as string, (issueLines || []) as any[], invoiceId, userId);
    const cogsAmount = issue.cogs;
    stmts.push(...issue.stmts);
    const orderRef = { id: orderId as string, order_number: String((order as any)?.order_number || orderId), branch_id: branchId ? String(branchId) : null };
    stmts.push(...(await prepareSaleJournalEntry(c, orderRef, total, cogsAmount, userId, undefined, undefined, installFee)).statements);

    await c.env.DB.batch(stmts);

    const { results } = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).all();
    return c.json(results[0], 201);

  } catch (err: any) {
    // Rollback CAS lock
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
    } catch (_) {}
    console.error('Invoice creation failed:', err);
    if (err?.name === 'ConflictError') return c.json({ message: err.message }, 409);
    return c.json({ message: 'Invoice creation failed. Order rolled back to CONFIRMED.', error: err?.message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// PAY ORDER — INVOICED → PAID (CAS-protected duplicate payment guard)
// PRESERVED: existing endpoint, now also inserts a payment record
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/pay', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');
  await assertOrderInScope(c, orderId);
  const userId = c.get('jwtPayload').sub;

  // CAS: atomically claim the order from INVOICED → PAYING
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'PAYING' WHERE id = ? AND status = 'INVOICED'"
  ).bind(orderId).run();

  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare('SELECT status FROM sales_orders WHERE id = ?').bind(orderId).first();
    if (!existing) return c.json({ message: 'Order not found.' }, 404);
    if (existing.status === 'PAID') return c.json({ message: 'This order is already paid.' }, 409);
    if (existing.status === 'PAYING') return c.json({ message: 'Payment is already being processed by another request.' }, 409);
    return c.json({ message: `Cannot pay: order is currently '${existing.status}'. Only INVOICED orders can be paid.` }, 400);
  }

  try {
    const settle = await prepareInvoiceSettlement(c, orderId as string, 'PAYING', userId, 'Full payment via Mark as Paid');
    if (!settle) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'No invoice found for this order.' }, 400);
    }
    await c.env.DB.batch(settle.statements);
    return c.json({ success: true });
  } catch (err: any) {
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId).run();
    } catch (_) {}
    if (err?.name === 'ConflictError') return c.json({ message: err.message }, 409);
    return c.json({ message: 'Payment processing failed. Order rolled back to INVOICED.', error: err?.message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// COMPLETE ORDER — one-click: DRAFT/CONFIRMED → INVOICED → PAID
// Respects the state machine but does it in one step with all guards
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/complete', requirePermissions(['manage_sales']), async (c) => {
  const reqStart = (c as any).reqStartTime || Date.now();
  console.log(`[WATERFALL] +${Date.now() - reqStart}ms | sales.post('/orders/:id/complete') handler start`);
  const orderId = c.req.param('id');
  await assertOrderInScope(c, orderId);
  const userId = c.get('jwtPayload').sub;

  const tOrder0 = Date.now();
  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  console.log(`[WATERFALL] +${Date.now() - reqStart}ms | SELECT sales_orders completed (${Date.now() - tOrder0}ms)`);
  if (!order) return c.json({ message: 'Order not found.' }, 404);
  if (order.status === 'PAID') return c.json({ message: 'Order is already completed.' }, 409);
  if (order.status === 'INVOICED') {
    // Already invoiced, just need to pay
    const invoice = await c.env.DB.prepare('SELECT id, status, total_amount, discount_amount FROM invoices WHERE sales_order_id = ?').bind(orderId).first();
    if (!invoice) return c.json({ message: 'Order is INVOICED but no invoice found.' }, 500);
    if (invoice.status === 'PAID') {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId).run();
      return c.json({ success: true, message: 'Payment recorded.' });
    }
    const settle = await prepareInvoiceSettlement(c, orderId as string, 'INVOICED', userId, 'Full payment via Complete Sale');
    if (!settle) return c.json({ message: 'Order is INVOICED but no invoice found.' }, 500);
    await c.env.DB.batch(settle.statements);
    return c.json({ success: true, invoiceId: settle.invoiceId });
  }

  // Order is DRAFT or CONFIRMED — need to invoice + pay
  // CAS lock
  const validSource = order.status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED';
  const tCas0 = Date.now();
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'PROCESSING' WHERE id = ? AND status = ?"
  ).bind(orderId, validSource).run();
  console.log(`[WATERFALL] +${Date.now() - reqStart}ms | CAS update status = PROCESSING completed (${Date.now() - tCas0}ms)`);

  if (!cas.meta.changes || cas.meta.changes === 0) {
    return c.json({ message: 'Order state changed concurrently. Please refresh and try again.' }, 409);
  }

  try {
    // Duplicate invoice check
    const tDup0 = Date.now();
    const existingInvoice = await c.env.DB.prepare('SELECT id FROM invoices WHERE sales_order_id = ?').bind(orderId).first();
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Duplicate invoice check completed (${Date.now() - tDup0}ms)`);
    if (existingInvoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
      return c.json({ message: 'An invoice already exists for this order.' }, 409);
    }

    const branchId = order.branch_id;
    const tLines0 = Date.now();
    const { results: lines } = await c.env.DB.prepare(
      'SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).all();
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | SELECT sales_order_lines completed (${Date.now() - tLines0}ms)`);

    if (!lines || lines.length === 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
      return c.json({ message: 'Order has no line items.' }, 400);
    }

    // Pre-flight stock check — resolve lines (including grouped/bundled components) and check branch stock
    const invReqs = await resolveLinesToInventoryRequirements(c.env.DB, lines);
    const reqProductIds = Array.from(new Set(invReqs.map((r) => r.productId)));
    const placeholders = reqProductIds.map(() => '?').join(', ');

    const tStock0 = Date.now();
    const stockLookup = new Map<string, { qtyOnHand: number; name: string }>();
    if (reqProductIds.length > 0) {
      const { results: stockRows } = await c.env.DB.prepare(`
        SELECT s.product_id, s.quantity_on_hand, p.name AS product_name
        FROM inventory_stock s
        JOIN products p ON p.id = s.product_id
        WHERE s.product_id IN (${placeholders}) AND s.owner_type = 'BRANCH' AND s.branch_id = ?
      `).bind(...reqProductIds, branchId).all();
      console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Consolidated stock check query completed (${Date.now() - tStock0}ms)`);

      for (const row of (stockRows || []) as any[]) {
        stockLookup.set(row.product_id, {
          qtyOnHand: Number(row.quantity_on_hand) || 0,
          name: row.product_name || row.product_id,
        });
      }
    }

    const insufficientReqs = invReqs.filter((req) => {
      const available = stockLookup.get(req.productId)?.qtyOnHand || 0;
      return available < req.quantity;
    });

    if (insufficientReqs.length > 0) {
      const failedPids = Array.from(new Set(insufficientReqs.map((r) => r.productId)));
      const altHolders = failedPids.map(() => '?').join(', ');
      const { results: altStocks } = await c.env.DB.prepare(`
        SELECT s.product_id, s.quantity_on_hand, COALESCE(w.name, b.name, 'Other Location') AS location_name
        FROM inventory_stock s
        LEFT JOIN warehouses w ON w.id = s.warehouse_id
        LEFT JOIN branches b ON b.id = s.branch_id
        WHERE s.product_id IN (${altHolders}) AND s.quantity_on_hand > 0 AND NOT (s.owner_type = 'BRANCH' AND s.branch_id = ?)
      `).bind(...failedPids, branchId).all();

      const altLocationMap = new Map<string, string[]>();
      for (const alt of (altStocks || []) as any[]) {
        const list = altLocationMap.get(alt.product_id) || [];
        list.push(`${alt.quantity_on_hand} at ${alt.location_name}`);
        altLocationMap.set(alt.product_id, list);
      }

      const detailedLines = insufficientReqs.map((req) => {
        const info = stockLookup.get(req.productId);
        const name = req.productName || info?.name || req.productId;
        const available = info?.qtyOnHand || 0;
        const requested = req.quantity;
        const alts = altLocationMap.get(req.productId);
        const altHint = alts && alts.length > 0 ? ` (Found in other locations: ${alts.join(', ')})` : ' (Out of stock company-wide)';
        return `${name}: need ${requested}, available ${available} at this branch${altHint}`;
      });

      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
      return c.json({ message: 'Insufficient stock for this sale.', details: detailedLines }, 400);
    }

    // Calculate total and discount
    const tTotal0 = Date.now();
    const totalRes = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(quantity * unit_price), 0) AS subtotal, COALESCE(SUM(discount_amount), 0) AS total_discount FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).first();
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | SELECT order total/discount completed (${Date.now() - tTotal0}ms)`);
    const subtotal = Number(totalRes?.subtotal || 0);
    const discountAmount = Number(totalRes?.total_discount || 0);
    const total = subtotal - discountAmount;

    // Build atomic batch
    const invoiceId = uuidv4();
    const stmts: any[] = [];

    const installFee = Number((order as any)?.installation_fee || 0);
    const grandTotal = total + installFee;

    const body = await c.req.json().catch(() => ({}));
    const isCreditSale = Boolean(body.isCreditSale);
    const amountPaid = body.amountPaid !== undefined ? Math.min(grandTotal, Math.max(0, Number(body.amountPaid))) : grandTotal;
    const paymentMethod = body.paymentMethod || 'CASH';
    const isFullPay = amountPaid >= grandTotal;
    const invoiceStatus = isFullPay ? 'PAID' : (amountPaid > 0 ? 'PARTIALLY_PAID' : 'UNPAID');
    const orderFinalStatus = isFullPay ? 'PAID' : 'CONFIRMED';
    const remainingBalance = Math.max(0, grandTotal - amountPaid);
    const receiptNumber = amountPaid > 0 ? `RCP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}` : null;

    // Create invoice
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount, discount_amount, status, paid_at, installation_fee, is_credit_sale)
      VALUES (?, ?, ?, ?, ?, ?, ${isFullPay ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?, ?)
    `).bind(invoiceId, `INV-${Date.now()}`, orderId, subtotal, discountAmount, invoiceStatus, installFee, isCreditSale || !isFullPay ? 1 : 0));

    // Insert payment record if amountPaid > 0
    if (amountPaid > 0) {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by, receipt_number, previous_balance, running_balance)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
      `).bind(uuidv4(), invoiceId, amountPaid, paymentMethod, isFullPay ? 'Full payment via Complete Sale' : 'Deposit / Partial payment via Complete Sale', userId, receiptNumber, grandTotal, remainingBalance));

      if ((order as any).customer_id) {
        stmts.push(c.env.DB.prepare(`
          INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, invoice_id, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by, branch_id)
          VALUES (?, ?, ?, 'INVOICE', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
        `).bind(uuidv4(), receiptNumber, (order as any).customer_id, invoiceId, amountPaid, paymentMethod, grandTotal, remainingBalance, isFullPay ? 'Full payment via Complete Sale' : 'Deposit / Partial payment via Complete Sale', userId, (order as any).branch_id || null));
      }
    }

    // Copy lines
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, quantity, unit_price)
      SELECT lower(hex(randomblob(16))), ?, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = ?
    `).bind(invoiceId, orderId));

    // Stock now leaves the branch: free what a website request held for this order.
    stmts.push(releaseReservationsStmt(c.env.DB, { orderId: String(orderId) }, 'Sales order completed'));

    // Deduct inventory
    for (const req of invReqs) {
      const qty = req.quantity;
      stmts.push(branchStockIssue(c.env.DB, req.productId, qty, String(branchId)));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), req.productId, -qty, branchId, invoiceId, userId));
    }

    // Finalize order status
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = ?, is_credit_sale = ? WHERE id = ?").bind(orderFinalStatus, isCreditSale || !isFullPay ? 1 : 0, orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_COMPLETE', 'sales_orders', orderId, { status: validSource }, { status: orderFinalStatus, invoiceId, total: grandTotal, amountPaid, remainingBalance }));

    // Invoice, stock issue, revenue/COGS, and any customer payment are one
    // accounting event. A journal failure therefore rolls back the sale.
    const entryDate = new Date().toISOString().split('T')[0];
    const [sharedFiscalPeriodId, sharedCoaMap] = await Promise.all([
      fetchOpenFiscalPeriodId(c.env.DB, entryDate),
      fetchCoaMapForCodes(c.env.DB, ['1010', '1020', '1030', '2050', '4010', '5010']),
    ]);
    const { results: issueLines } = await c.env.DB.prepare('SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?').bind(order.id).all();
    const issue = await saleIssueCost(c.env.DB, order.id as string, (issueLines || []) as any[], invoiceId, userId);
    const cogsAmount = issue.cogs;
    stmts.push(...issue.stmts);
    const saleJournal = await prepareJournalEntryPosting(c, {
      description: `Sales Order Completed & Invoiced #${(order as any).order_number || order.id}`,
      referenceType: 'SALE',
      referenceId: order.id as string,
      branchId: (order as any).branch_id ? String((order as any).branch_id) : null,
      userId,
      prefetchedFiscalPeriodId: sharedFiscalPeriodId || undefined,
      prefetchedCoaMap: sharedCoaMap,
      lines: [
        { accountCode: '1020', debitAmount: total + installFee, creditAmount: 0 },
        { accountCode: '4010', debitAmount: 0, creditAmount: total },
        ...(installFee > 0 ? [{ accountCode: '2050', debitAmount: 0, creditAmount: installFee }] : []),
        ...(cogsAmount > 0 ? [
          { accountCode: '5010', debitAmount: cogsAmount, creditAmount: 0 },
          { accountCode: '1030', debitAmount: 0, creditAmount: cogsAmount },
        ] : []),
      ],
    });
    stmts.push(...saleJournal.statements);

    if (amountPaid > 0) {
      const paymentJournal = await prepareJournalEntryPosting(c, {
        description: `Customer Payment Received for Order #${(order as any).order_number || order.id}`,
        referenceType: 'SALE',
        referenceId: invoiceId,
        branchId: (order as any).branch_id ? String((order as any).branch_id) : null,
        userId,
        prefetchedFiscalPeriodId: sharedFiscalPeriodId || undefined,
        prefetchedCoaMap: sharedCoaMap,
        lines: [
          { accountCode: '1010', debitAmount: amountPaid, creditAmount: 0 },
          { accountCode: '1020', debitAmount: 0, creditAmount: amountPaid },
        ],
      });
      stmts.push(...paymentJournal.statements);
    }

    const tBatch0 = Date.now();
    await c.env.DB.batch(stmts);
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Main sale write batch (${stmts.length} stmts) completed (${Date.now() - tBatch0}ms)`);

    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Complete sale request finished! Sending JSON response.`);
    return c.json({ success: true, invoiceId, total, amountPaid, balance: remainingBalance, receipt_number: receiptNumber });

  } catch (err: any) {
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
    } catch (_) {}
    console.error('Order completion failed:', err);
    if (err?.name === 'ConflictError') return c.json({ message: err.message }, 409);
    return c.json({ message: 'Order completion failed. Rolled back.', error: err?.message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// RECORD INVOICE PAYMENT — partial / installment payment
// NEW ENDPOINT — POST /sales/invoices/:id/payments
// ──────────────────────────────────────────────────────────────────────
sales.post('/invoices/:id/payments', requirePermissions(['manage_sales']), async (c) => {
  const invoiceId = c.req.param('id');
  await assertInvoiceInScope(c, invoiceId);
  if (!invoiceId) return c.json({ message: 'Invoice id is required.' }, 400);
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json();

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return c.json({ message: 'Payment amount must be a positive number.' }, 400);
  }

  const paymentMethod = body.paymentMethod || 'CASH';
  const validMethods = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'WIRE'];
  if (!validMethods.includes(paymentMethod)) {
    return c.json({ message: `Invalid payment method. Must be one of: ${validMethods.join(', ')}.` }, 400);
  }

  const paymentDate = body.paymentDate || new Date().toISOString().split('T')[0];

  // Fetch invoice
  const invoice = await c.env.DB.prepare(
    'SELECT i.*, so.id AS order_id, so.branch_id FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id WHERE i.id = ?'
  ).bind(invoiceId).first();
  if (!invoice) return c.json({ message: 'Invoice not found.' }, 404);

  // Compute current balance
  const summary = await getInvoicePaymentSummary(
    c.env.DB, invoiceId,
    Number(invoice.total_amount),
    Number(invoice.discount_amount || 0)
  );

  if (summary.balance <= 0) {
    return c.json({ message: 'This invoice is already fully paid.' }, 400);
  }
  if (amount > summary.balance + 0.001) { // tiny float tolerance
    return c.json({
      message: `Payment of $${amount.toFixed(2)} exceeds remaining balance of $${summary.balance.toFixed(2)}.`,
      balance: summary.balance,
    }, 400);
  }

  const paymentId = uuidv4();
  const isFullyPaid = Math.abs(amount - summary.balance) < 0.01;

  const stmts: any[] = [
    c.env.DB.prepare(`
      INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(paymentId, invoiceId, amount, paymentMethod, paymentDate, body.notes || null, userId),
  ];

  // Auto-close invoice and order if fully paid
  if (isFullyPaid) {
    stmts.push(c.env.DB.prepare(
      "UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(invoiceId));
    stmts.push(c.env.DB.prepare(
      "UPDATE sales_orders SET status = 'PAID' WHERE id = ?"
    ).bind(invoice.order_id));
  }

  stmts.push(createAuditLogStmt(c, 'INVOICE_PAYMENT_RECORD', 'invoices', invoiceId, null, {
    amount, paymentMethod, paymentDate, isFullyPaid
  }));

  const paymentJournal = await prepareJournalEntryPosting(c, {
    description: `Customer Payment Received for Invoice #${(invoice as any).invoice_number || invoiceId}`,
    referenceType: 'SALE',
    referenceId: paymentId,
    entryDate: paymentDate,
    branchId: (invoice as any).branch_id || null,
    userId,
    lines: [
      { accountCode: '1010', debitAmount: amount, creditAmount: 0 },
      { accountCode: '1020', debitAmount: 0, creditAmount: amount },
    ],
  });
  stmts.push(...paymentJournal.statements);

  await c.env.DB.batch(stmts);

  // Return updated summary
  const newSummary = await getInvoicePaymentSummary(
    c.env.DB, invoiceId,
    Number(invoice.total_amount),
    Number(invoice.discount_amount || 0)
  );

  return c.json({ success: true, payment_id: paymentId, invoice_summary: newSummary }, 201);
});

// ──────────────────────────────────────────────────────────────────────
// GET INVOICE PAYMENT HISTORY
// NEW ENDPOINT — GET /sales/invoices/:id/payments
// ──────────────────────────────────────────────────────────────────────
sales.get('/invoices/:id/payments', async (c) => {
  const invoiceId = c.req.param('id');
  await assertInvoiceInScope(c, invoiceId);

  const invoice = await c.env.DB.prepare(
    'SELECT id, total_amount, discount_amount FROM invoices WHERE id = ?'
  ).bind(invoiceId).first();
  if (!invoice) return c.json({ message: 'Invoice not found.' }, 404);

  const { results: payments } = await c.env.DB.prepare(`
    SELECT ip.*, u.full_name AS recorded_by_name
    FROM invoice_payments ip
    LEFT JOIN users u ON u.id = ip.recorded_by
    WHERE ip.invoice_id = ?
    ORDER BY ip.created_at ASC
  `).bind(invoiceId).all();

  // Compute running balance per payment (newest first for display, but calculate ascending)
  const totalAmount = Number(invoice.total_amount);
  const discountAmount = Number(invoice.discount_amount || 0);
  const netTotal = Math.max(0, totalAmount - discountAmount);

  let runningBalance = netTotal;
  const paymentsWithBalance = (payments || []).map((p: any) => {
    runningBalance -= Number(p.amount);
    return { ...p, running_balance: Math.max(0, runningBalance) };
  });

  const summary = await getInvoicePaymentSummary(c.env.DB, invoiceId, totalAmount, discountAmount);

  return c.json({
    payments: paymentsWithBalance.reverse(), // newest first
    summary,
  });
});

// ──────────────────────────────────────────────────────────────────────
// FINANCIAL SUMMARY — outstanding balances for dashboard
// NEW ENDPOINT — GET /sales/summary
// ──────────────────────────────────────────────────────────────────────
sales.get('/summary', async (c) => {
  const payload = c.get('jwtPayload');
  const scopedBranchId = await scopedSalesBranch(c);

  // Total outstanding — scoped to branch if branch user
  let summaryQuery = `
    SELECT i.id, i.total_amount, COALESCE(i.discount_amount, 0) AS discount_amount,
           COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS amount_paid
    FROM invoices i
    JOIN sales_orders so ON so.id = i.sales_order_id
    WHERE i.status != 'CANCELLED'
  `;
  const summaryParams: any[] = [];
  if (scopedBranchId) {
    summaryQuery += ' AND so.branch_id = ?';
    summaryParams.push(scopedBranchId);
  }

  const stmt = c.env.DB.prepare(summaryQuery);
  const { results: invoices } = summaryParams.length > 0 ? await stmt.bind(...summaryParams).all() : await stmt.all();

  let totalOutstandingBalance = 0;
  let countUnpaid = 0;
  let countPartiallyPaid = 0;
  let totalUnpaidAmount = 0;
  let totalPartiallyPaidBalance = 0;

  for (const inv of (invoices || []) as any[]) {
    const netTotal = Math.max(0, Number(inv.total_amount) - Number(inv.discount_amount));
    const paid = Number(inv.amount_paid);
    const balance = Math.max(0, netTotal - paid);
    if (balance <= 0) continue;
    totalOutstandingBalance += balance;
    if (paid === 0) {
      countUnpaid++;
      totalUnpaidAmount += balance;
    } else {
      countPartiallyPaid++;
      totalPartiallyPaidBalance += balance;
    }
  }

  return c.json({
    total_outstanding_balance: totalOutstandingBalance,
    count_unpaid: countUnpaid,
    total_unpaid_amount: totalUnpaidAmount,
    count_partially_paid: countPartiallyPaid,
    total_partially_paid_balance: totalPartiallyPaidBalance,
  });
});

// ──────────────────────────────────────────────────────────────────────
// PRINT INVOICE — returns full invoice data formatted for printing
// UPDATED: now includes discount, amount_paid, balance
// ──────────────────────────────────────────────────────────────────────
sales.get('/invoices/:id/print', async (c) => {
  const invoiceId = c.req.param('id');
  await assertInvoiceInScope(c, invoiceId);

  const invoice = await c.env.DB.prepare(`
    SELECT i.*, so.order_number, so.branch_id,
           c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.address AS customer_address,
           b.name AS branch_name, b.city AS branch_city, b.address AS branch_address, b.phone AS branch_phone
    FROM invoices i
    JOIN sales_orders so ON so.id = i.sales_order_id
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    WHERE i.id = ?
  `).bind(invoiceId).first();

  if (!invoice) return c.json({ message: 'Invoice not found.' }, 404);

  const { results: lines } = await c.env.DB.prepare(`
    SELECT il.*, p.name AS product_name, p.sku AS product_sku, p.barcode AS product_barcode
    FROM invoice_lines il
    JOIN products p ON p.id = il.product_id
    WHERE il.invoice_id = ?
  `).bind(invoiceId).all();

  const summary = await getInvoicePaymentSummary(
    c.env.DB, invoiceId,
    Number(invoice.total_amount),
    Number((invoice as any).discount_amount || 0)
  );

  return c.json({
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      order_number: invoice.order_number,
      status: invoice.status,
      total_amount: invoice.total_amount,
      discount_amount: (invoice as any).discount_amount || 0,
      net_total: summary.net_total,
      amount_paid: summary.amount_paid,
      balance: summary.balance,
      payment_status: summary.payment_status,
      issued_at: invoice.issued_at,
      paid_at: invoice.paid_at,
    },
    customer: {
      name: invoice.customer_name || 'Walk-in Customer',
      phone: invoice.customer_phone || null,
      email: invoice.customer_email || null,
      address: invoice.customer_address || null,
    },
    branch: {
      name: invoice.branch_name,
      city: invoice.branch_city,
      address: invoice.branch_address,
      phone: invoice.branch_phone,
    },
    lines: lines.map((l: any) => ({
      product_name: l.product_name,
      product_sku: l.product_sku,
      product_barcode: l.product_barcode,
      quantity: l.quantity,
      unit_price: l.unit_price,
      subtotal: (l.quantity as number) * (l.unit_price as number),
    })),
  });
});

// ──────────────────────────────────────────────────────────────────────
// INSTALLATION FEE PAYOUT — Record payout to technician for installation service
// DR: 2050 (Installation Payable), CR: 1010 (Cash)
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/installation-payout', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');
  await assertOrderInScope(c, orderId);
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json().catch(() => ({}));

  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return c.json({ message: 'Sales order not found' }, 404);

  const fee = Number((order as any).installation_fee || 0);
  if (fee <= 0) {
    return c.json({ message: 'This order has no installation fee recorded.' }, 400);
  }

  if ((order as any).installation_status === 'PAID_OUT') {
    return c.json({ message: 'Installation fee has already been paid out to the installer.' }, 400);
  }

  const installerName = body.installer_name || (order as any).installer_name || 'Technician';
  const payoutNotes = body.notes || `Paid out to ${installerName} on ${new Date().toLocaleDateString()}`;

  // Post Double-Entry Journal: DR 2050 (Installation Payable), CR 1010 (Cash)
  await postInstallationPayoutJournalEntry(
    c,
    { id: (order as any).id, order_number: (order as any).order_number, branch_id: (order as any).branch_id },
    fee,
    userId
  );

  await c.env.DB.prepare(`
    UPDATE sales_orders
    SET installation_status = 'PAID_OUT',
        installer_name = ?,
        installer_notes = ?
    WHERE id = ?
  `).bind(installerName, payoutNotes, orderId).run();

  await logAudit(c, 'INSTALLATION_FEE_PAYOUT', 'sales_orders', orderId, { status: (order as any).installation_status }, { status: 'PAID_OUT', fee, installerName });

  return c.json({
    success: true,
    message: `Installation fee of $${fee.toFixed(2)} successfully disbursed to ${installerName}.`,
    installation_status: 'PAID_OUT'
  });
});

// ──────────────────────────────────────────────────────────────────────
// CANCEL ORDER — SAFE SALE CANCELLATION
// Restores inventory quantities, voids debts, reverses accounting, audit logged
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/cancel', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');
  await assertOrderInScope(c, orderId);
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3) return c.json({ message: 'Please write the reason for cancelling this sale (it is kept in the record).' }, 400);

  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first() as any;
  if (!order) return c.json({ message: 'Order not found.' }, 404);
  if (order.status === 'CANCELLED') {
    return c.json({ message: 'Order is already cancelled.' }, 400);
  }
  // A cancellation undoes a sale that never completed. Once goods have left, or part was already
  // returned, the right tool is a Return (it counts what actually came back).
  const left = await c.env.DB.prepare(
    "SELECT COUNT(*)::int AS n FROM deliveries WHERE sales_order_id = ? AND status IN ('DISPATCHED', 'PARTIALLY_DELIVERED', 'DELIVERED')",
  ).bind(orderId).first() as any;
  if (Number(left?.n) > 0 || order.status === 'DELIVERED') {
    return c.json({ message: "The goods for this sale have already left or been delivered, so it can't be cancelled. Use Return to record what the customer sends back." }, 409);
  }
  const hasReturns = await c.env.DB.prepare('SELECT 1 AS x FROM sales_returns WHERE sales_order_id = ? LIMIT 1').bind(orderId).first();
  if (hasReturns) return c.json({ message: "Some items of this sale were already returned, so it can't be cancelled. Record a Return for what is left." }, 409);

  const prevStatus = order.status;
  const branchId = order.branch_id;

  // Claim the order first: a concurrent or repeated cancel matches no row and
  // rolls back, so stock is never restored twice.
  const stmts: any[] = [
    c.env.DB.prepare(`
      UPDATE sales_orders
      SET status = 'CANCELLED', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = ?
    `).bind(userId, reason, orderId, prevStatus).mustAffect('This order was just changed or cancelled. Please refresh.'),
  ];

  // Free any stock a website request still holds for this order.
  stmts.push(releaseReservationsStmt(c.env.DB, { orderId: String(orderId) }, 'Sales order cancelled'));
  // ...and give its units back to the products' online quantity.
  stmts.push(returnWebQuantityStmt(c.env.DB, { orderId: String(orderId) }));

  // Check if invoice exists
  const invoice = await c.env.DB.prepare('SELECT * FROM invoices WHERE sales_order_id = ?').bind(orderId).first() as any;
  const paidRow = invoice ? await c.env.DB.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = ?').bind(invoice.id).first() as any : null;
  const refunded = Number(paidRow?.paid || 0);

  // Restore exactly what the sale issued, per the inventory ledger (this covers
  // grouped-product components, and orders that never deducted stock restore nothing).
  if (invoice) {
    const { results: issued } = await c.env.DB.prepare(`
      SELECT product_id, -SUM(quantity) AS qty FROM inventory_transactions
      WHERE transaction_type = 'SALE_ISSUE' AND reference_id = ?
      GROUP BY product_id
    `).bind(invoice.id).all();

    // Stock comes back at the cost it was sold at (sale line), keeping the average cost right.
    const { results: soldCosts } = await c.env.DB.prepare(
      'SELECT product_id, unit_cost FROM sales_order_lines WHERE sales_order_id = ? AND unit_cost IS NOT NULL',
    ).bind(orderId).all();
    const soldCost = new Map(((soldCosts || []) as any[]).map((r) => [r.product_id, Number(r.unit_cost)]));
    for (const line of (issued || []) as any[]) {
      const qty = Number(line.qty || 0);
      if (qty > 0) {
        if (soldCost.has(line.product_id)) {
          stmts.push(...costInStatements(c.env.DB, { productId: line.product_id, quantity: qty, unitCost: soldCost.get(line.product_id)!, source: 'SALE_CANCELLED', referenceId: String(orderId), userId }));
        }
        // Price levels: the units go back into the levels this sale took them from.
        stmts.push(...(await restoreToLevels(c.env.DB, { productId: line.product_id, quantity: qty, fromRefId: invoice.id, refType: 'SALE_CANCELLED', refId: String(orderId), userId })).stmts);
        stmts.push(c.env.DB.prepare(`
          UPDATE inventory_stock
          SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
        `).bind(qty, line.product_id, branchId).mustAffect('The branch stock record for a sold product no longer exists; cannot restore stock.'));

        stmts.push(c.env.DB.prepare(`
          INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_branch_id, dest_owner_type, dest_branch_id, reference_type, reference_id, notes, created_by)
          VALUES (?, ?, 'SALE_CANCEL_RESTORE', ?, 'BRANCH', ?, 'BRANCH', ?, 'ORDER_CANCEL', ?, ?, ?)
        `).bind(uuidv4(), line.product_id, qty, branchId, branchId, orderId, `Restored from cancelled order #${order.order_number}`, userId));
      }
    }
  }

  // Cancel invoice if exists
  if (invoice) {
    stmts.push(c.env.DB.prepare(`
      UPDATE invoices
      SET status = 'CANCELLED', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(userId, invoice.id));
  }

  stmts.push(createAuditLogStmt(c, 'SALES_ORDER_CANCEL', 'sales_orders', orderId, { status: prevStatus }, {
    status: 'CANCELLED',
    reason,
    cancelledBy: userId,
    moneyGivenBack: refunded,
  }));

  // Reverse the order's posted journal entries in the same transaction.
  // (Same selection as before; payments recorded later under their own
  // payment ids are not reversed — see AUDIT_REPORT: refund policy.)
  // Money already collected is given back: the payments' cash entries are reversed with the sale,
  // so cash and receivables both return to zero for this order.
  const payIds: string[] = [];
  if (invoice) {
    const { results: ip } = await c.env.DB.prepare('SELECT id FROM invoice_payments WHERE invoice_id = ?').bind(invoice.id).all();
    const { results: cp } = await c.env.DB.prepare('SELECT id FROM customer_payments WHERE invoice_id = ?').bind(invoice.id).all();
    for (const r of [...(ip || []), ...(cp || [])] as any[]) payIds.push(String(r.id));
  }
  const payMarks = payIds.length ? payIds.map(() => '?').join(', ') : "''";
  const { results: jes } = await c.env.DB.prepare(`
    SELECT id FROM journal_entries
    WHERE status = 'POSTED' AND reference_type != 'MANUAL'
      AND (reference_id = ? OR reference_id = ? OR reference_id LIKE ? OR reference_id IN (${payMarks}))
  `).bind(orderId, invoice?.id || orderId, `${orderId}%`, ...payIds).all();

  for (const je of (jes || []) as any[]) {
    stmts.push(...await prepareJournalReversal(c, je.id, `Reversal due to cancelled order #${order.order_number}: ${reason}`, userId));
  }

  await c.env.DB.batch(stmts);

  return c.json({
    success: true,
    refunded,
    message: refunded > 0
      ? `Sales order cancelled. The stock was put back, the accounting was reversed and ${refunded.toFixed(2)} collected from the customer is to be given back.`
      : 'Sales order cancelled. The stock was put back in the branch and the accounting was reversed.',
  });
});

// ──────────────────────────────────────────────────────────────────────
// DELETE ORDER — Admin / Manage Sales override
// Permanently deletes sales order and associated invoice/payments
// ──────────────────────────────────────────────────────────────────────
sales.delete('/orders/:id', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');
  const payload = c.get('jwtPayload');
  const admin = isAdminUser(payload);
  const scopedBranchId = await scopedSalesBranch(c);

  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  if (!order) return c.json({ message: 'Sales order not found' }, 404);

  if (scopedBranchId && (order as any).branch_id !== scopedBranchId) {
    return c.json({ message: "That order belongs to another branch, so you can't change it." }, 403);
  }

  // Invoiced orders carry posted revenue, stock issues and payments: deleting
  // them would silently erase financial history. They must be cancelled.
  const invoice = await c.env.DB.prepare('SELECT id FROM invoices WHERE sales_order_id = ?').bind(id).first();
  if (invoice) {
    return c.json({ message: "This order already has an invoice, so it can't be deleted. Use Cancel instead: it puts the stock back, reverses the accounting and keeps a record of why." }, 400);
  }

  const stmts = [];
  stmts.push(c.env.DB.prepare('DELETE FROM sales_order_lines WHERE sales_order_id = ?').bind(id));
  stmts.push(c.env.DB.prepare('DELETE FROM sales_orders WHERE id = ?').bind(id));
  stmts.push(createAuditLogStmt(c, 'SALES_ORDER_DELETE', 'sales_orders', id, order, null));

  await c.env.DB.batch(stmts);
  return c.json({ success: true });
});

// ──────────────────────────────────────────────────────────────────────
// EDIT A DRAFT SALE — only drafts: nothing has been invoiced, taken from stock or posted yet.
// Body: { customerId?, lines?: [{productId, quantity, unitPrice, discountAmount?}], installationFee?, installerName?, installerNotes?, fulfillmentType? }
// ──────────────────────────────────────────────────────────────────────
sales.patch('/orders/:id', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id') as string;
  await assertOrderInScope(c, orderId);
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json().catch(() => ({})) as any;
  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first() as any;
  if (!order) return c.json({ message: 'Order not found.' }, 404);
  if (order.status !== 'DRAFT') {
    return c.json({ message: `Only draft sales can be edited. This one is ${String(order.status).toLowerCase()}: to change it, cancel it (before delivery) or record a Return, then enter the sale again.` }, 409);
  }
  const stmts: any[] = [];
  const sets: string[] = [];
  const vals: unknown[] = [];

  if ('customerId' in body) {
    if (body.customerId) {
      const scope = await resolveBranchScope(c, 'ALL');
      const cust = scope.kind === 'BRANCH'
        ? await c.env.DB.prepare(`SELECT cu.id FROM customers cu WHERE cu.id = ? AND ${customerVisibleSql(scope.branchId)}`).bind(body.customerId).first()
        : await c.env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(body.customerId).first();
      if (!cust) return c.json({ message: 'Customer does not exist.' }, 400);
    }
    sets.push('customer_id = ?'); vals.push(body.customerId || null);
  }
  if ('installationFee' in body) {
    const fee = Math.max(0, Number(body.installationFee || 0));
    sets.push('installation_fee = ?', 'installation_status = ?'); vals.push(fee, fee > 0 ? (order.installation_status === 'NONE' ? 'PENDING' : order.installation_status) : 'NONE');
  }
  if ('installerName' in body) { sets.push('installer_name = ?'); vals.push(body.installerName ? String(body.installerName).trim() : null); }
  if ('installerNotes' in body) { sets.push('installer_notes = ?'); vals.push(body.installerNotes ? String(body.installerNotes).trim() : null); }
  if ('fulfillmentType' in body) { sets.push('fulfillment_type = ?'); vals.push(String(body.fulfillmentType).toUpperCase() === 'PICKUP' ? 'PICKUP' : 'DELIVERY'); }

  if (body.lines !== undefined) {
    if (!Array.isArray(body.lines) || body.lines.length === 0) return c.json({ message: 'A sale needs at least one product line.' }, 400);
    const seen = new Set<string>();
    const editPlanner = await levelPlanner(c.env.DB, body.lines.map((l: any) => l.productId));
    for (let i = 0; i < body.lines.length; i++) {
      const l = body.lines[i];
      if (!l.productId) return c.json({ message: `Line ${i + 1}: choose a product.` }, 400);
      if (!Number.isInteger(l.quantity) || l.quantity <= 0) return c.json({ message: `Line ${i + 1}: quantity must be a whole number above 0.` }, 400);
      if (seen.has(l.productId)) return c.json({ message: `Line ${i + 1}: this product is already on the sale. Combine the quantities.` }, 400);
      seen.add(l.productId);
      const pr = await c.env.DB.prepare('SELECT id, name, selling_price, COALESCE(is_active, 1) AS is_active FROM products WHERE id = ?').bind(l.productId).first() as any;
      if (!pr) return c.json({ message: `Line ${i + 1}: that product does not exist.` }, 400);
      // Always the product's current selling price (price levels: oldest first); a price from the client is ignored.
      l.unitPrice = Number(pr.selling_price || 0); l.priceBreakdown = null;
      if (editPlanner.has(l.productId)) {
        const t = editPlanner.take(l.productId, l.quantity, false);
        if (Number.isFinite(t.unitPrice)) { l.unitPrice = Math.round(t.unitPrice * 10000) / 10000; l.priceBreakdown = t.breakdown; }
      }
      if (pr.is_active === 0) return c.json({ message: `"${pr.name}" is inactive and cannot be sold.` }, 400);
    }
    stmts.push(c.env.DB.prepare('DELETE FROM sales_order_lines WHERE sales_order_id = ?').bind(orderId));
    const lineType = String(body.fulfillmentType || order.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
    for (const l of body.lines) {
      const disc = Math.max(0, Number(l.discountAmount || 0));
      stmts.push(c.env.DB.prepare('INSERT INTO sales_order_lines (id, sales_order_id, product_id, quantity, unit_price, discount_amount, line_total, fulfillment_type, list_price, adjustment_reason, price_breakdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(uuidv4(), orderId, l.productId, l.quantity, l.unitPrice, disc, l.quantity * l.unitPrice - disc, lineType, l.unitPrice, null, l.priceBreakdown || null));
    }
  }
  if (!sets.length && body.lines === undefined) return c.json({ message: 'Nothing to change.' }, 400);
  sets.push('updated_at = CURRENT_TIMESTAMP');
  // Claim as DRAFT: if it was confirmed or invoiced meanwhile, nothing is changed.
  stmts.unshift(c.env.DB.prepare(`UPDATE sales_orders SET ${sets.join(', ')} WHERE id = ? AND status = 'DRAFT'`).bind(...vals, orderId)
    .mustAffect('This sale was just confirmed or changed by someone else. Please reload it.'));
  stmts.push(createAuditLogStmt(c, 'SALES_ORDER_EDIT', 'sales_orders', orderId, { status: 'DRAFT' }, { ...body, editedBy: userId }));
  await c.env.DB.batch(stmts);
  return c.json(await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first());
});

// ──────────────────────────────────────────────────────────────────────
// SALES RETURNS — goods the customer brings back after an invoiced sale.
// GET  /orders/:id/returns  → what can still be returned + past returns
// POST /orders/:id/returns  → { reason, lines:[{productId, quantity, condition}], refundMethod? }
// Stock: resaleable items go back to the branch, damaged ones do not.
// Money: the customer's invoice shrinks by the value returned; anything they had
// already paid beyond the new total is refunded (refundMethod required then).
// ──────────────────────────────────────────────────────────────────────
async function returnableLines(db: any, invoiceId: string) {
  const { results } = await db.prepare(`
    SELECT il.product_id, p.name AS product_name, SUM(il.quantity)::int AS sold, MAX(il.unit_price) AS unit_price,
           COALESCE((SELECT SUM(rl.quantity) FROM sales_return_lines rl JOIN sales_returns r ON r.id = rl.return_id
                     WHERE r.invoice_id = il.invoice_id AND rl.product_id = il.product_id), 0)::int AS returned
    FROM invoice_lines il JOIN products p ON p.id = il.product_id
    WHERE il.invoice_id = ? GROUP BY il.product_id, p.name, il.invoice_id
  `).bind(invoiceId).all();
  return ((results || []) as any[]).map((r) => ({ ...r, returnable: Number(r.sold) - Number(r.returned) }));
}

sales.get('/orders/:id/returns', async (c) => {
  const orderId = c.req.param('id') as string;
  await assertOrderInScope(c, orderId);
  const invoice = await c.env.DB.prepare('SELECT id, status FROM invoices WHERE sales_order_id = ?').bind(orderId).first() as any;
  if (!invoice) return c.json({ returnable: [], returns: [] });
  const { results } = await c.env.DB.prepare(`
    SELECT r.*, u.full_name AS created_by_name,
           (SELECT json_agg(json_build_object('product_id', rl.product_id, 'product_name', p.name, 'quantity', rl.quantity, 'condition', rl.condition, 'line_value', rl.line_value))
            FROM sales_return_lines rl JOIN products p ON p.id = rl.product_id WHERE rl.return_id = r.id) AS lines
    FROM sales_returns r LEFT JOIN users u ON u.id = r.created_by WHERE r.sales_order_id = ? ORDER BY r.created_at DESC
  `).bind(orderId).all();
  return c.json({ returnable: invoice.status === 'CANCELLED' ? [] : await returnableLines(c.env.DB, invoice.id), returns: results || [] });
});

sales.post('/orders/:id/returns', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id') as string;
  await assertOrderInScope(c, orderId);
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json().catch(() => ({})) as any;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3) return c.json({ message: 'Please write the reason for the return (it is kept in the record).' }, 400);
  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first() as any;
  if (!order) return c.json({ message: 'Order not found.' }, 404);
  const invoice = await c.env.DB.prepare('SELECT * FROM invoices WHERE sales_order_id = ?').bind(orderId).first() as any;
  if (!invoice || order.status === 'CANCELLED' || invoice.status === 'CANCELLED') {
    return c.json({ message: "Only an invoiced sale that is not cancelled can have items returned. For a sale that hasn't been invoiced, edit or cancel it instead." }, 409);
  }
  if (!Array.isArray(body.lines) || !body.lines.length) return c.json({ message: 'Choose at least one product and quantity to return.' }, 400);

  const avail = new Map((await returnableLines(c.env.DB, invoice.id)).map((r: any) => [r.product_id, r]));
  const picked: Array<{ productId: string; quantity: number; condition: 'RESALEABLE' | 'DAMAGED'; unitPrice: number; name: string }> = [];
  const seen = new Set<string>();
  for (const l of body.lines) {
    const q = Number(l.quantity);
    if (!q) continue;
    const row = avail.get(l.productId) as any;
    if (!row) return c.json({ message: 'One of the products was not on this sale.' }, 400);
    if (seen.has(l.productId)) return c.json({ message: `${row.product_name} is listed twice. Combine the quantities.` }, 400);
    seen.add(l.productId);
    if (!Number.isInteger(q) || q < 0) return c.json({ message: `${row.product_name}: the quantity must be a whole number.` }, 400);
    if (q > row.returnable) return c.json({ message: `${row.product_name}: only ${row.returnable} can still be returned (sold ${row.sold}, already returned ${row.returned}).` }, 400);
    picked.push({ productId: l.productId, quantity: q, condition: l.condition === 'DAMAGED' ? 'DAMAGED' : 'RESALEABLE', unitPrice: Number(row.unit_price), name: row.product_name });
  }
  if (!picked.length) return c.json({ message: 'Enter the quantity being returned.' }, 400);

  // Value: the price the customer actually paid per unit (the sale's discount is shared out pro rata).
  const gross = picked.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const ratio = Number(invoice.total_amount) > 0 ? Number(invoice.discount_amount || 0) / Number(invoice.total_amount) : 0;
  const discountPart = gross * ratio;
  const value = Math.round((gross - discountPart) * 100) / 100;
  const newGross = Number(invoice.total_amount) - gross - (Number(invoice.discount_amount || 0) - discountPart) + Number(invoice.installation_fee || 0);
  const paidRow = await c.env.DB.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = ?').bind(invoice.id).first() as any;
  const paid = Number(paidRow?.paid || 0);
  const refund = Math.max(0, Math.round((paid - Number(invoice.refunded_amount || 0) - Math.max(0, newGross)) * 100) / 100);
  const method = ['CASH', 'BANK', 'MOBILE'].includes(String(body.refundMethod).toUpperCase()) ? String(body.refundMethod).toUpperCase() : null;
  if (refund > 0 && !method) {
    return c.json({ message: `The customer has already paid ${refund.toFixed(2)} more than the remaining sale. Choose how it is refunded (cash, bank or mobile money).`, refundDue: refund, needs: 'refundMethod' }, 400);
  }

  const returnId = uuidv4();
  const stmts: any[] = [
    c.env.DB.prepare('INSERT INTO sales_returns (id, return_number, sales_order_id, invoice_id, branch_id, customer_id, reason, return_value, refund_amount, refund_method, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(returnId, `RET-${Date.now()}`, orderId, invoice.id, order.branch_id, order.customer_id || null, reason, value, refund, refund > 0 ? method : null, userId),
  ];
  const resaleable: Array<{ product_id: string; quantity: number }> = [];
  for (const l of picked) {
    const lineValue = Math.round(l.quantity * l.unitPrice * (1 - ratio) * 100) / 100;
    stmts.push(c.env.DB.prepare('INSERT INTO sales_return_lines (id, return_id, product_id, quantity, unit_price, line_value, condition) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(uuidv4(), returnId, l.productId, l.quantity, l.unitPrice, lineValue, l.condition));
    if (l.condition === 'RESALEABLE') resaleable.push({ product_id: l.productId, quantity: l.quantity });
  }
  // Resaleable goods go back into the branch's stock (a grouped product returns its components).
  // They come back at the cost they were sold at (kept on the sale line), so the books and the
  // average cost stay right even if the cost changed since the sale.
  let returnedCost = 0;
  if (resaleable.length) {
    const nowCosts = await unitCosts(c.env.DB, resaleable.map((r) => r.product_id));
    const { results: soldRows } = await c.env.DB.prepare(
      "SELECT sol.product_id, sol.unit_cost, COALESCE(p.product_type, 'STANDARD') AS product_type FROM sales_order_lines sol JOIN products p ON p.id = sol.product_id WHERE sol.sales_order_id = ?",
    ).bind(orderId).all();
    const sold = new Map(((soldRows || []) as any[]).map((r) => [r.product_id, r]));
    for (const r of resaleable) {
      const row = sold.get(r.product_id) as any;
      const unit = row?.unit_cost != null ? Number(row.unit_cost) : (nowCosts.get(r.product_id) ?? 0);
      // Price levels: the units go back into the levels the sale took them from, at their cost.
      const back = row?.product_type !== 'GROUPED'
        ? await restoreToLevels(c.env.DB, { productId: r.product_id, quantity: r.quantity, fromRefId: invoice.id, refType: 'SALES_RETURN', refId: returnId, userId })
        : { stmts: [], restored: 0, cost: 0 };
      stmts.push(...back.stmts);
      returnedCost += back.cost + (r.quantity - back.restored) * unit;
      if (row?.product_type !== 'GROUPED') {
        stmts.push(...costInStatements(c.env.DB, { productId: r.product_id, quantity: r.quantity, unitCost: unit, source: 'SALES_RETURN', referenceId: returnId, userId }));
      } else {
        for (const comp of await resolveLinesToInventoryRequirements(c.env.DB, [{ productId: r.product_id, quantity: r.quantity }])) {
          stmts.push(...(await restoreToLevels(c.env.DB, { productId: comp.productId, quantity: comp.quantity, fromRefId: invoice.id, refType: 'SALES_RETURN', refId: returnId, userId })).stmts);
        }
      }
    }
  }
  if (resaleable.length) {
    const reqs = await resolveLinesToInventoryRequirements(c.env.DB, resaleable);
    for (const r of reqs) {
      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(r.quantity, r.productId, order.branch_id).mustAffect('The branch stock record for a returned product no longer exists.'));
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_branch_id, dest_owner_type, dest_branch_id, reference_type, reference_id, notes, created_by)
        VALUES (?, ?, 'SALE_RETURN', ?, 'BRANCH', ?, 'BRANCH', ?, 'SALES_RETURN', ?, ?, ?)
      `).bind(uuidv4(), r.productId, r.quantity, order.branch_id, order.branch_id, returnId, `Returned from order #${order.order_number}: ${reason}`, userId));
    }
  }
  // The invoice shrinks by what came back; the status follows what is still owed.
  const paidNow = paid - Number(invoice.refunded_amount || 0) - refund;
  const remaining = Math.max(0, newGross - paidNow);
  const newStatus = remaining <= 0.005 ? 'PAID' : (paidNow > 0 ? 'PARTIALLY_PAID' : 'UNPAID');
  stmts.push(c.env.DB.prepare(`
    UPDATE invoices SET total_amount = total_amount - ?, discount_amount = discount_amount - ?, returned_amount = returned_amount + ?,
      refunded_amount = refunded_amount + ?, status = ?
    WHERE id = ? AND status <> 'CANCELLED'
  `).bind(gross, discountPart, value, refund, newStatus, invoice.id).mustAffect('This sale was just cancelled or changed. Please refresh.'));

  // Books: sales revenue and the customer's receivable go down; stock value and cost of sales are
  // restored for resaleable goods only (damaged goods stay expensed); a refund pays cash out.
  const jBase = { referenceType: 'SALE', branchId: order.branch_id, userId } as const;
  stmts.push(...(await prepareJournalEntryPosting(c, {
    ...jBase, description: `Sales return ${order.order_number}: ${reason}`, referenceId: returnId,
    lines: [{ accountCode: '4010', debitAmount: value, creditAmount: 0 }, { accountCode: '1020', debitAmount: 0, creditAmount: value }],
  })).statements);
  if (resaleable.length) {
    const cost = Math.round(returnedCost * 100) / 100;
    if (cost > 0) stmts.push(...(await prepareJournalEntryPosting(c, {
      ...jBase, description: `Returned stock back in ${order.order_number}`, referenceId: `${returnId}:stock`,
      lines: [{ accountCode: '1030', debitAmount: cost, creditAmount: 0 }, { accountCode: '5010', debitAmount: 0, creditAmount: cost }],
    })).statements);
  }
  if (refund > 0) stmts.push(...(await prepareJournalEntryPosting(c, {
    ...jBase, description: `Refund to customer for ${order.order_number} (${method})`, referenceId: `${returnId}:refund`,
    lines: [{ accountCode: '1020', debitAmount: refund, creditAmount: 0 }, { accountCode: '1010', debitAmount: 0, creditAmount: refund }],
  })).statements);
  stmts.push(createAuditLogStmt(c, 'SALES_RETURN', 'sales_returns', returnId, null, { orderId, reason, value, refund, method, lines: picked }));

  await c.env.DB.batch(stmts);
  return c.json({ success: true, id: returnId, value, refund, invoiceStatus: newStatus,
    message: refund > 0 ? `Return recorded. Refund ${refund.toFixed(2)} to the customer (${method}).` : 'Return recorded. The customer\'s balance was reduced.' }, 201);
});


// Price adjustments: every sale line sold above or below the product's price, and who did it.
sales.get('/price-adjustments', async (c) => {
  const p = c.get('jwtPayload');
  if (!has(p, 'accounting.view') && !isAdminUser(p)) return c.json({ message: "You don't have permission to see price changes." }, 403);
  const scoped = await scopedSalesBranch(c);
  const from = c.req.query('from') || '1970-01-01';
  const to = c.req.query('to') || '2999-12-31';
  const params: unknown[] = [from, `${to} 23:59:59`];
  let where = 'WHERE sol.list_price IS NOT NULL AND abs(sol.unit_price - sol.list_price) > 0.005 AND so.created_at >= ? AND so.created_at <= ?';
  if (scoped) { where += ' AND so.branch_id = ?'; params.push(scoped); }
  const { results } = await c.env.DB.prepare(`
    SELECT so.id AS order_id, so.order_number, so.created_at, b.name AS branch_name, u.full_name AS seller, p.name AS product_name,
           sol.quantity, sol.list_price, sol.unit_price, (sol.unit_price - sol.list_price) AS adjustment,
           ((sol.unit_price - sol.list_price) * sol.quantity) AS adjustment_total, sol.adjustment_reason
    FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.sales_order_id
    JOIN products p ON p.id = sol.product_id LEFT JOIN users u ON u.id = so.created_by LEFT JOIN branches b ON b.id = so.branch_id
    ${where} AND so.status <> 'CANCELLED' ORDER BY so.created_at DESC LIMIT 500
  `).bind(...params).all();
  const rows = (results || []) as any[];
  return c.json({
    rows,
    below: rows.filter((r) => r.adjustment < 0).reduce((a, r) => a + Number(r.adjustment_total), 0),
    above: rows.filter((r) => r.adjustment > 0).reduce((a, r) => a + Number(r.adjustment_total), 0),
  });
});

export default sales;
