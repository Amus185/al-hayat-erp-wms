import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';
import {
  postSaleJournalEntry,
  postCustomerPaymentJournalEntry,
  fetchOpenFiscalPeriodId,
  fetchCoaMapForCodes,
  calculateOrderCogs,
  postInstallationPayoutJournalEntry,
  createAndPostJournalEntry,
  reverseJournalEntry,
} from '../services/accounting-service';

const sales = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

sales.use('/*', authMiddleware);

// ──────────────────────────────────────────────────────────────────────
// SHARED HELPER — compute payment summary for an invoice
// Returns: { amount_paid, balance, payment_status }
// Never stored — always calculated from invoice_payments rows
// ──────────────────────────────────────────────────────────────────────
async function getInvoicePaymentSummary(db: D1Database, invoiceId: string, totalAmount: number, discountAmount: number) {
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
export async function calculateCustomerFinancials(db: any, customerId: string) {
  const invoiceRes = await db.prepare(`
    SELECT 
      COALESCE(SUM(
        GREATEST(0, (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)) - COALESCE((
          SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id
        ), 0))
      ), 0) AS unpaid_sales
    FROM sales_orders so
    JOIN invoices i ON i.sales_order_id = so.id
    WHERE so.customer_id = ? AND so.status != 'CANCELLED' AND i.status != 'CANCELLED'
  `).bind(customerId).first().catch(() => ({ unpaid_sales: 0 }));
  const unpaidSales = Number(invoiceRes?.unpaid_sales || 0);

  const manualRes = await db.prepare(`
    SELECT COALESCE(SUM(remaining_balance), 0) AS unpaid_manual
    FROM customer_debts
    WHERE customer_id = ? AND status != 'CANCELLED'
  `).bind(customerId).first().catch(() => ({ unpaid_manual: 0 }));
  const unpaidManual = Number(manualRes?.unpaid_manual || 0);

  const accountRes = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS unallocated
    FROM customer_payments
    WHERE customer_id = ? AND allocation_type = 'ACCOUNT'
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
sales.get('/customers', async (c) => {
  const query = `
    SELECT 
      c.*,
      COALESCE((
        SELECT COUNT(*) 
        FROM sales_orders so 
        WHERE so.customer_id = c.id AND so.status != 'CANCELLED'
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
        WHERE so.customer_id = c.id AND so.status != 'CANCELLED'
      ), 0) AS total_spent,
      COALESCE((
        SELECT SUM(
          GREATEST(0, (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)) - COALESCE((
            SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id
          ), 0))
        )
        FROM sales_orders so
        JOIN invoices i ON i.sales_order_id = so.id
        WHERE so.customer_id = c.id AND so.status != 'CANCELLED' AND i.status != 'CANCELLED'
      ), 0) AS unpaid_sales_balance,
      COALESCE((
        SELECT SUM(cd.remaining_balance)
        FROM customer_debts cd
        WHERE cd.customer_id = c.id AND cd.status != 'CANCELLED'
      ), 0) AS unpaid_manual_balance,
      COALESCE((
        SELECT SUM(cp.amount)
        FROM customer_payments cp
        WHERE cp.customer_id = c.id AND cp.allocation_type = 'ACCOUNT'
      ), 0) AS unallocated_payments
    FROM customers c
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
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO customers (id, name, phone, email, address)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, body.name.trim(), body.phone || null, body.email || null, body.address || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

sales.patch('/customers/:id', requirePermissions(['manage_sales']), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<{ name?: string; phone?: string; email?: string; address?: string }>();
  const existing = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
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
  const existing = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ message: 'Customer not found.' }, 404);
  await c.env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ──────────────────────────────────────────────────────────────────────
// DEBT DASHBOARD & OVERVIEW
// ──────────────────────────────────────────────────────────────────────
sales.get('/debts/summary', async (c) => {
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
    WHERE so.status != 'CANCELLED' AND i.status != 'CANCELLED' AND so.customer_id IS NOT NULL
    GROUP BY so.customer_id
  `).all();

  const manualRes = await c.env.DB.prepare(`
    SELECT customer_id, COALESCE(SUM(remaining_balance), 0) AS unpaid_manual
    FROM customer_debts
    WHERE status != 'CANCELLED'
    GROUP BY customer_id
  `).all().catch(() => ({ results: [] }));

  const acctRes = await c.env.DB.prepare(`
    SELECT customer_id, COALESCE(SUM(amount), 0) AS unallocated
    FROM customer_payments
    WHERE allocation_type = 'ACCOUNT'
    GROUP BY customer_id
  `).all().catch(() => ({ results: [] }));

  const totalCollectedRes = await c.env.DB.prepare(`
    SELECT 
      (SELECT COALESCE(SUM(amount), 0) FROM invoice_payments) +
      (SELECT COALESCE(SUM(amount), 0) FROM customer_payments WHERE allocation_type != 'INVOICE') AS total_collected
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
  });
});

sales.get('/debts', async (c) => {
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
        WHERE so.customer_id = c.id AND so.status != 'CANCELLED' AND i.status != 'CANCELLED'
      ), 0) AS unpaid_sales_balance,
      COALESCE((
        SELECT SUM(cd.remaining_balance)
        FROM customer_debts cd
        WHERE cd.customer_id = c.id AND cd.status != 'CANCELLED'
      ), 0) AS unpaid_manual_balance,
      COALESCE((
        SELECT SUM(cp.amount)
        FROM customer_payments cp
        WHERE cp.customer_id = c.id AND cp.allocation_type = 'ACCOUNT'
      ), 0) AS unallocated_payments,
      COALESCE((
        SELECT MAX(payment_date)
        FROM (
          SELECT payment_date FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id JOIN sales_orders so ON so.id = i.sales_order_id WHERE so.customer_id = c.id
          UNION ALL
          SELECT payment_date FROM customer_payments cp WHERE cp.customer_id = c.id
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
      name: r.name,
      phone: r.phone,
      email: r.email,
      address: r.address,
      city: r.city,
      current_balance: curBal,
      unpaid_sales_balance: Number(r.unpaid_sales_balance || 0),
      unpaid_manual_balance: Number(r.unpaid_manual_balance || 0),
      last_payment_date: r.last_payment_date,
      debt_status: curBal > 0.01 ? 'DEBT_ACTIVE' : 'CURRENT',
    };
  });

  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(s) || (r.phone || '').includes(s) || (r.email || '').toLowerCase().includes(s));
  }

  if (status && status !== 'ALL') {
    rows = rows.filter((r) => r.debt_status === status);
  }

  return c.json(rows);
});

// ──────────────────────────────────────────────────────────────────────
// MANUAL CUSTOMER DEBTS
// ──────────────────────────────────────────────────────────────────────
sales.get('/customers/:id/debts', async (c) => {
  const customerId = c.req.param('id');
  const { results } = await c.env.DB.prepare(`
    SELECT cd.*, u.full_name AS created_by_name
    FROM customer_debts cd
    LEFT JOIN users u ON u.id = cd.created_by
    WHERE cd.customer_id = ?
    ORDER BY cd.debt_date DESC, cd.created_at DESC
  `).bind(customerId).all();
  return c.json(results || []);
});

sales.post('/customers/:id/debts', requirePermissions(['manage_sales']), async (c) => {
  const customerId = c.req.param('id');
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  const customer = await c.env.DB.prepare('SELECT id, name FROM customers WHERE id = ?').bind(customerId).first();
  if (!customer) return c.json({ message: 'Customer not found.' }, 404);

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
    body.branchId || null,
    userId
  ));

  stmts.push(createAuditLogStmt(c, 'CUSTOMER_DEBT_CREATE', 'customer_debts', id, null, {
    debtNumber,
    customerId,
    amount,
    description: body.description.trim(),
    category,
  }));

  await c.env.DB.batch(stmts);

  // Post GL Journal Entry: DR Accounts Receivable (1020), CR Sales/Service Revenue (4010)
  try {
    const entryDate = debtDate.split('T')[0];
    const [fpId, coaMap] = await Promise.all([
      fetchOpenFiscalPeriodId(c.env.DB, entryDate),
      fetchCoaMapForCodes(c.env.DB, ['1020', '4010']),
    ]);

    await createAndPostJournalEntry(c, {
      description: `Manual Charge #${debtNumber}: ${body.description.trim()}`,
      referenceType: 'SALE',
      referenceId: id,
      entryDate,
      branchId: body.branchId || null,
      userId,
      prefetchedFiscalPeriodId: fpId,
      prefetchedCoaMap: coaMap,
      lines: [
        { accountCode: '1020', debitAmount: amount, creditAmount: 0 },
        { accountCode: '4010', debitAmount: 0, creditAmount: amount },
      ],
    });
  } catch (glErr) {
    console.warn('Non-fatal GL posting error on manual debt create:', glErr);
  }

  const created = await c.env.DB.prepare('SELECT * FROM customer_debts WHERE id = ?').bind(id).first();
  return c.json(created, 201);
});

// ──────────────────────────────────────────────────────────────────────
// UNIFIED CUSTOMER BALANCE & LEDGER
// ──────────────────────────────────────────────────────────────────────
sales.get('/customers/:id/balance', async (c) => {
  const customerId = c.req.param('id');
  const customer = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first() as any;
  if (!customer) return c.json({ message: 'Customer not found.' }, 404);

  const fin = await calculateCustomerFinancials(c.env.DB, customerId);
  return c.json({
    customer_id: customer.id,
    customer_name: customer.name,
    ...fin,
  });
});

sales.get('/customers/:id/ledger', async (c) => {
  const customerId = c.req.param('id');
  const customer = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first() as any;
  if (!customer) return c.json({ message: 'Customer not found.' }, 404);

  // 1. Invoices
  const { results: invoices } = await c.env.DB.prepare(`
    SELECT i.id, i.invoice_number, so.order_number, 
           (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)) AS total_amount,
           i.issued_at, i.status
    FROM invoices i
    JOIN sales_orders so ON so.id = i.sales_order_id
    WHERE so.customer_id = ? AND so.status != 'CANCELLED' AND i.status != 'CANCELLED'
  `).bind(customerId).all();

  // 2. Invoice payments
  const { results: invoicePayments } = await c.env.DB.prepare(`
    SELECT ip.id, ip.amount, ip.payment_method, ip.payment_date, ip.created_at, ip.receipt_number, ip.notes,
           i.invoice_number, so.order_number
    FROM invoice_payments ip
    JOIN invoices i ON i.id = ip.invoice_id
    JOIN sales_orders so ON so.id = i.sales_order_id
    WHERE so.customer_id = ? AND so.status != 'CANCELLED' AND i.status != 'CANCELLED'
  `).bind(customerId).all();

  // 3. Manual debts
  const { results: manualDebts } = await c.env.DB.prepare(`
    SELECT cd.id, cd.debt_number, cd.description, cd.category, cd.amount, cd.remaining_balance, cd.debt_date, cd.status
    FROM customer_debts cd
    WHERE cd.customer_id = ? AND cd.status != 'CANCELLED'
  `).bind(customerId).all().catch(() => ({ results: [] }));

  // 4. Non-invoice customer payments (manual debt & general account payments)
  const { results: otherPayments } = await c.env.DB.prepare(`
    SELECT cp.id, cp.receipt_number, cp.amount, cp.payment_method, cp.payment_date, cp.created_at, cp.notes, cp.allocation_type,
           cd.debt_number, cd.description AS debt_description
    FROM customer_payments cp
    LEFT JOIN customer_debts cd ON cd.id = cp.manual_debt_id
    WHERE cp.customer_id = ? AND cp.allocation_type != 'INVOICE'
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
      payment: e.payment,
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

  const customer = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first() as any;
  if (!customer) return c.json({ message: 'Customer not found.' }, 404);

  const prevFin = await calculateCustomerFinancials(c.env.DB, customerId);
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

    if (!invoice) return c.json({ message: 'Invoice not found for this customer.' }, 404);

    billNumber = invoice.order_number || invoice.invoice_number;
    const grossTotal = (Number(invoice.total_amount || 0) - Number(invoice.discount_amount || 0)) + Number(invoice.installation_fee || 0);

    const paidRes = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = ?'
    ).bind(invoiceId).first() as any;
    const curPaid = Number(paidRes?.paid || 0);
    const curBalance = Math.max(0, grossTotal - curPaid);

    const newPaid = curPaid + payAmount;
    remainingItemBalance = Math.max(0, grossTotal - newPaid);

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
      INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, invoice_id, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by)
      VALUES (?, ?, ?, 'INVOICE', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `).bind(paymentId, receiptNumber, customerId, invoiceId, payAmount, paymentMethod || 'CASH', previousBalance, Math.max(0, previousBalance - payAmount), notes?.trim() || null, userId));

  } else if (allocationType === 'MANUAL_DEBT') {
    if (!manualDebtId) return c.json({ message: 'Manual debt ID is required.' }, 400);
    const debt = await c.env.DB.prepare(
      'SELECT * FROM customer_debts WHERE id = ? AND customer_id = ?'
    ).bind(manualDebtId, customerId).first() as any;

    if (!debt) return c.json({ message: 'Manual charge record not found for this customer.' }, 404);
    billNumber = debt.debt_number;

    const curDebtBal = Number(debt.remaining_balance || 0);
    remainingItemBalance = Math.max(0, curDebtBal - payAmount);
    const newStatus = remainingItemBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';

    stmts.push(c.env.DB.prepare(`
      UPDATE customer_debts SET remaining_balance = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(remainingItemBalance, newStatus, manualDebtId));

    stmts.push(c.env.DB.prepare(`
      INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, manual_debt_id, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by)
      VALUES (?, ?, ?, 'MANUAL_DEBT', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `).bind(paymentId, receiptNumber, customerId, manualDebtId, payAmount, paymentMethod || 'CASH', previousBalance, Math.max(0, previousBalance - payAmount), notes?.trim() || null, userId));

  } else {
    // General account payment
    stmts.push(c.env.DB.prepare(`
      INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by)
      VALUES (?, ?, ?, 'ACCOUNT', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `).bind(paymentId, receiptNumber, customerId, payAmount, paymentMethod || 'CASH', previousBalance, Math.max(0, previousBalance - payAmount), notes?.trim() || 'General Customer Account Payment', userId));
  }

  stmts.push(createAuditLogStmt(c, 'CUSTOMER_PAYMENT_RECORD', 'customer_payments', paymentId, null, {
    receiptNumber,
    customerId,
    allocationType,
    amount: payAmount,
    paymentMethod,
  }));

  await c.env.DB.batch(stmts);

  // Post GL Journal Entry for customer payment
  try {
    const entryDate = new Date().toISOString().split('T')[0];
    const [fpId, coaMap] = await Promise.all([
      fetchOpenFiscalPeriodId(c.env.DB, entryDate),
      fetchCoaMapForCodes(c.env.DB, ['1010', '1020']),
    ]);

    await postCustomerPaymentJournalEntry(
      c,
      { id: paymentId, amount: payAmount, paymentDate: entryDate },
      { id: customerId, order_number: billNumber || `CUST-${customerId.slice(0, 6)}` },
      userId,
      fpId,
      coaMap
    );
  } catch (glErr) {
    console.warn('Non-fatal GL posting error on customer payment:', glErr);
  }

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
  const receiptNumber = c.req.param('receiptNumber');
  const payment = await c.env.DB.prepare(`
    SELECT cp.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.address AS customer_address,
           u.full_name AS recorded_by_name
    FROM customer_payments cp
    JOIN customers c ON c.id = cp.customer_id
    LEFT JOIN users u ON u.id = cp.recorded_by
    WHERE cp.receipt_number = ?
  `).bind(receiptNumber).first() as any;

  if (!payment) return c.json({ message: 'Receipt not found.' }, 404);

  return c.json(payment);
});


// ──────────────────────────────────────────────────────────────────────
// ORDERS — LIST & GET
// ──────────────────────────────────────────────────────────────────────
sales.get('/orders', async (c) => {
  const { search, status, paymentStatus, dateFrom, dateTo, customer_id, customerId } = c.req.query();
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  let query = `
    SELECT so.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city,
           b.name AS branch_name, i.id AS invoice_id,
           i.total_amount AS invoice_total, i.discount_amount AS invoice_discount, i.status AS invoice_status,
           COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS amount_paid,
           (SELECT d.status FROM deliveries d WHERE d.sales_order_id = so.id AND d.status != 'CANCELLED' ORDER BY d.created_at DESC LIMIT 1) AS delivery_status,
           (SELECT d.id FROM deliveries d WHERE d.sales_order_id = so.id AND d.status != 'CANCELLED' ORDER BY d.created_at DESC LIMIT 1) AS delivery_id,
           (SELECT d.delivery_number FROM deliveries d WHERE d.sales_order_id = so.id AND d.status != 'CANCELLED' ORDER BY d.created_at DESC LIMIT 1) AS delivery_number,
           (SELECT d.delivered_at FROM deliveries d WHERE d.sales_order_id = so.id AND d.status != 'CANCELLED' ORDER BY d.created_at DESC LIMIT 1) AS delivered_at
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
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
  const enriched = (results || []).map((row: any) => {
    const installFee = Number(row.installation_fee || 0);
    // If delivery is completed, mark order status as DELIVERED
    const effectiveStatus = row.delivery_status === 'DELIVERED' ? 'DELIVERED' : row.status;

    if (!row.invoice_id) {
      return {
        ...row,
        status: effectiveStatus,
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
      installation_fee: installFee,
      installer_name: row.installer_name || null,
      installation_status: row.installation_status || 'NONE',
      merchandise_total: merchandiseNet,
      net_total: netTotal,
      balance,
      payment_status,
    };
  });

  // Client-side filter by payment status (computed field — cannot be done in SQL easily)
  if (paymentStatus && paymentStatus !== 'ALL') {
    return c.json(enriched.filter((r: any) => r.payment_status === paymentStatus));
  }

  return c.json(enriched);
});

sales.get('/orders/:id', async (c) => {
  const id = c.req.param('id');
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

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
    return c.json({ message: 'Access denied: order belongs to another branch.' }, 403);
  }

  const { results: lines } = await c.env.DB.prepare(`
    SELECT sol.*, p.name AS product_name, p.sku AS product_sku
    FROM sales_order_lines sol
    LEFT JOIN products p ON p.id = sol.product_id
    WHERE sol.sales_order_id = ?
  `).bind(id).all();

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
  const deliveryStatus = activeDelivery ? activeDelivery.status : null;
  const effectiveStatus = deliveryStatus === 'DELIVERED' ? 'DELIVERED' : order.status;

  return c.json({
    ...order,
    status: effectiveStatus,
    delivery_status: deliveryStatus,
    delivery_id: activeDelivery?.id || null,
    delivery_number: activeDelivery?.delivery_number || null,
    delivered_at: activeDelivery?.delivered_at || null,
    deliveries: deliveriesList,
    lines,
    payment_summary: paymentSummary,
    payments,
  });
});

// ──────────────────────────────────────────────────────────────────────
// CREATE ORDER — with full input validation
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  const payload = c.get('jwtPayload');
  const userId = payload.sub;

  // Branch isolation — branch users can only create orders for their own branch
  if (!isAdminUser(payload)) {
    body.branchId = payload.branch_id;
  }

  // Validate branch
  if (!body.branchId) return c.json({ message: 'Branch is required.' }, 400);
  const branch = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(body.branchId).first();
  if (!branch) return c.json({ message: 'Branch does not exist.' }, 400);

  // Validate customer (optional but if provided must exist)
  if (body.customerId) {
    const customer = await c.env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(body.customerId).first();
    if (!customer) return c.json({ message: 'Customer does not exist.' }, 400);
  }

  // Validate lines
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: 'At least one order line is required.' }, 400);
  }

  const seenProducts = new Set<string>();
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    if (!line.quantity || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      return c.json({ message: `Line ${i + 1}: quantity must be a positive integer.` }, 400);
    }
    if (line.unitPrice === undefined || line.unitPrice === null || Number(line.unitPrice) < 0) {
      return c.json({ message: `Line ${i + 1}: unitPrice cannot be negative.` }, 400);
    }
    if (seenProducts.has(line.productId)) {
      return c.json({ message: `Line ${i + 1}: duplicate product. Combine quantities into one line.` }, 400);
    }
    seenProducts.add(line.productId);

    const product = await c.env.DB.prepare('SELECT id, name, selling_price, COALESCE(is_active, 1) AS is_active FROM products WHERE id = ?').bind(line.productId).first() as any;
    if (!product) return c.json({ message: `Line ${i + 1}: product does not exist.` }, 400);
    if (product.is_active === 0) {
      return c.json({ message: `Cannot sell inactive product "${product.name}". Please activate the product before creating new sales orders.` }, 400);
    }

    // Override client's unitPrice with the actual selling price from DB to prevent price manipulation
    line.unitPrice = product.selling_price;
  }

  const isCreditSale = Boolean(body.isCreditSale);
  const initialDeposit = Math.max(0, Number(body.initialDeposit || 0));
  const depositMethod = body.depositPaymentMethod || 'CASH';

  // If credit sale, do immediate stock check so inventory can be deducted at creation
  if (isCreditSale) {
    const productIds = body.lines.map((l: any) => l.productId as string);
    const placeholders = productIds.map(() => '?').join(', ');
    const { results: stockRows } = await c.env.DB.prepare(`
      SELECT s.product_id, s.quantity_on_hand, p.name AS product_name
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      WHERE s.product_id IN (${placeholders}) AND s.owner_type = 'BRANCH' AND s.branch_id = ?
    `).bind(...productIds, body.branchId).all();

    const stockMap = new Map<string, number>();
    for (const row of (stockRows || []) as any[]) {
      stockMap.set(row.product_id, Number(row.quantity_on_hand) || 0);
    }

    const insufficient: string[] = [];
    for (const l of body.lines) {
      const avail = stockMap.get(l.productId) || 0;
      if (avail < l.quantity) {
        insufficient.push(`Product need ${l.quantity}, available ${avail}`);
      }
    }
    if (insufficient.length > 0) {
      return c.json({ message: 'Insufficient stock at this branch for credit sale.', details: insufficient }, 400);
    }
  }

  const id = uuidv4();
  const orderNumber = `SO-${Date.now()}`;
  const installFee = Math.max(0, Number(body.installationFee || 0));
  const installerName = body.installerName ? String(body.installerName).trim() : null;
  const installerNotes = body.installerNotes ? String(body.installerNotes).trim() : null;
  const installStatus = installFee > 0 ? 'PENDING' : 'NONE';
  const orderStatus = isCreditSale ? 'CONFIRMED' : 'DRAFT';

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO sales_orders (
      id, order_number, customer_id, branch_id, status, created_by,
      installation_fee, installer_name, installation_status, installer_notes,
      is_credit_sale, initial_deposit
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, orderNumber, body.customerId || null, body.branchId, orderStatus, userId,
    installFee, installerName, installStatus, installerNotes,
    isCreditSale ? 1 : 0, initialDeposit
  ));

  let subtotal = 0;
  let totalDiscount = 0;

  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    const lineTotal = (line.quantity * line.unitPrice) - discountAmount;
    subtotal += (line.quantity * line.unitPrice);
    totalDiscount += discountAmount;

    stmts.push(c.env.DB.prepare(`
      INSERT INTO sales_order_lines (id, sales_order_id, product_id, quantity, unit_price, discount_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitPrice, discountAmount, lineTotal));
  }

  const netTotal = subtotal - totalDiscount;
  const grandTotal = netTotal + installFee;
  const deposit = Math.min(grandTotal, initialDeposit);
  const remaining = Math.max(0, grandTotal - deposit);

  let invoiceId = uuidv4();
  let receiptNumber: string | null = null;

  if (isCreditSale) {
    // 1. Deduct inventory immediately from physical stock
    for (const line of body.lines) {
      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(line.quantity, line.productId, body.branchId));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), line.productId, -line.quantity, body.branchId, invoiceId, userId));
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
    if (deposit > 0 && body.customerId) {
      receiptNumber = `RCP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const paymentId = uuidv4();

      stmts.push(c.env.DB.prepare(`
        INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by, receipt_number, previous_balance, running_balance)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'Upfront Deposit at Checkout', ?, ?, ?, ?)
      `).bind(uuidv4(), invoiceId, deposit, depositMethod, userId, receiptNumber, grandTotal, remaining));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, invoice_id, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by)
        VALUES (?, ?, ?, 'INVOICE', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'Upfront Deposit at Checkout', ?)
      `).bind(paymentId, receiptNumber, body.customerId, invoiceId, deposit, depositMethod, grandTotal, remaining, userId));
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

  // Post double-entry GL journal entries for credit sale
  if (isCreditSale) {
    try {
      const entryDate = new Date().toISOString().split('T')[0];
      const [sharedFiscalPeriodId, sharedCoaMap] = await Promise.all([
        fetchOpenFiscalPeriodId(c.env.DB, entryDate),
        fetchCoaMapForCodes(c.env.DB, ['1010', '1020', '2050', '4010']),
      ]);

      const cogsAmount = await calculateOrderCogs(c.env.DB, id);
      await postSaleJournalEntry(
        c,
        { id, order_number: orderNumber, branch_id: body.branchId },
        netTotal,
        cogsAmount,
        userId,
        sharedFiscalPeriodId || undefined,
        sharedCoaMap,
        installFee
      );

      if (deposit > 0) {
        await postCustomerPaymentJournalEntry(
          c,
          { id: invoiceId, amount: deposit },
          { id, order_number: orderNumber, branch_id: body.branchId },
          userId,
          sharedFiscalPeriodId,
          sharedCoaMap
        );
      }
    } catch (glErr) {
      console.warn('Non-fatal GL posting error on credit sale order create:', glErr);
    }
  }

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

    // Pre-flight stock check — single query for all products instead of N+1 individual lookups
    const productIds = lines.map((l: any) => l.product_id as string);
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
    for (const line of lines) {
      const pid = line.product_id as string;
      const available = stockMap.get(pid)?.qtyOnHand || 0;
      const requested = line.quantity as number;
      if (available < requested) {
        insufficientLines.push(`${productNameMap.get(pid) || pid}: need ${requested}, available ${available}`);
      }
      if (!stockMap.has(pid)) {
        stockMap.set(pid, { stockId: '', qtyOnHand: 0 });
      }
    }

    if (insufficientLines.length > 0) {
      // Find where stock is available in other locations to guide the user
      const failedPids = lines
        .filter((l: any) => (stockMap.get(l.product_id as string)?.qtyOnHand || 0) < Number(l.quantity))
        .map((l: any) => l.product_id as string);

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

      const detailedLines = lines
        .filter((l: any) => (stockMap.get(l.product_id as string)?.qtyOnHand || 0) < Number(l.quantity))
        .map((l: any) => {
          const pid = l.product_id as string;
          const name = productNameMap.get(pid) || pid;
          const available = stockMap.get(pid)?.qtyOnHand || 0;
          const requested = Number(l.quantity);
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

    // Deduct inventory from branch
    for (const line of lines) {
      const qty = line.quantity as number;

      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(qty, line.product_id, branchId));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), line.product_id, -qty, branchId, invoiceId, userId));
    }

    // Flip order to INVOICED
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_INVOICE', 'sales_orders', orderId, { status: 'CONFIRMED' }, { status: 'INVOICED', invoiceId, total }));

    await c.env.DB.batch(stmts);

    // Auto-post double-entry journal to Accounting (Must succeed or entire order invoicing fails)
    const cogsAmount = await calculateOrderCogs(c.env.DB, orderId as string);
    await postSaleJournalEntry(c, { id: orderId, order_number: String((order as any)?.order_number || orderId), branch_id: branchId ? String(branchId) : undefined } as any, total, cogsAmount, userId);

    const { results } = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).all();
    return c.json(results[0], 201);

  } catch (err: any) {
    // Rollback CAS lock
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
    } catch (_) {}
    console.error('Invoice creation failed:', err);
    return c.json({ message: 'Invoice creation failed. Order rolled back to CONFIRMED.', error: err?.message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// PAY ORDER — INVOICED → PAID (CAS-protected duplicate payment guard)
// PRESERVED: existing endpoint, now also inserts a payment record
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/pay', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');
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
    // Check invoice exists and is unpaid
    const invoice = await c.env.DB.prepare(
      'SELECT id, status, total_amount, discount_amount FROM invoices WHERE sales_order_id = ?'
    ).bind(orderId).first();
    if (!invoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'No invoice found for this order.' }, 400);
    }
    if (invoice.status === 'PAID') {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'Invoice is already paid.' }, 409);
    }

    // Check if there's already a payment covering the full amount
    const existingPaid = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = ?'
    ).bind(invoice.id).first();
    const alreadyPaid = Number(existingPaid?.paid || 0);
    const netTotal = Math.max(0, Number(invoice.total_amount) - Number(invoice.discount_amount || 0));
    const remaining = Math.max(0, netTotal - alreadyPaid);

    const stmts: any[] = [];

    // Insert a payment record for the remaining balance if any
    if (remaining > 0) {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by)
        VALUES (?, ?, ?, 'CASH', CURRENT_TIMESTAMP, 'Full payment via Mark as Paid', ?)
      `).bind(uuidv4(), invoice.id, remaining, userId));
    }

    // Atomic payment
    stmts.push(c.env.DB.prepare("UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.id));
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_PAY', 'sales_orders', orderId, { status: 'INVOICED' }, { status: 'PAID', invoiceId: invoice.id }));
    await c.env.DB.batch(stmts);

    // Auto-post double-entry journal to Accounting (Must succeed or entire payment fails)
    const orderRow = await c.env.DB.prepare('SELECT order_number, branch_id FROM sales_orders WHERE id = ?').bind(orderId).first() as any;
    await postCustomerPaymentJournalEntry(
      c,
      { id: String((invoice as any).id || orderId), amount: remaining > 0 ? remaining : netTotal },
      { id: orderId, order_number: String(orderRow?.order_number || orderId), branch_id: orderRow?.branch_id ? String(orderRow.branch_id) : undefined } as any,
      userId
    );

    return c.json({ success: true });
  } catch (err: any) {
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId).run();
    } catch (_) {}
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
    const existingPaid = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = ?'
    ).bind(invoice.id).first();
    const alreadyPaid = Number(existingPaid?.paid || 0);
    const netTotal = Math.max(0, Number(invoice.total_amount) - Number(invoice.discount_amount || 0));
    const remaining = Math.max(0, netTotal - alreadyPaid);
    const stmts: any[] = [];
    if (remaining > 0) {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by)
        VALUES (?, ?, ?, 'CASH', CURRENT_TIMESTAMP, 'Full payment via Complete Sale', ?)
      `).bind(uuidv4(), invoice.id, remaining, userId));
    }
    stmts.push(c.env.DB.prepare("UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.id));
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_COMPLETE', 'sales_orders', orderId, { status: 'INVOICED' }, { status: 'PAID', invoiceId: invoice.id }));
    await c.env.DB.batch(stmts);
    return c.json({ success: true, invoiceId: invoice.id });
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
      await c.env.DB.prepare("UPDATE sales_orders SET status = ?").bind(validSource).run();
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

    // Pre-flight stock check — single query for all products instead of N+1 individual lookups
    const productIds = lines.map((l: any) => l.product_id as string);
    const placeholders = productIds.map(() => '?').join(', ');

    const tStock0 = Date.now();
    const { results: stockRows } = await c.env.DB.prepare(`
      SELECT s.product_id, s.quantity_on_hand, p.name AS product_name
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      WHERE s.product_id IN (${placeholders}) AND s.owner_type = 'BRANCH' AND s.branch_id = ?
    `).bind(...productIds, branchId).all();
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Consolidated stock check query completed (${Date.now() - tStock0}ms)`);

    const stockLookup = new Map<string, { qtyOnHand: number; name: string }>();
    for (const row of (stockRows || []) as any[]) {
      stockLookup.set(row.product_id, {
        qtyOnHand: Number(row.quantity_on_hand) || 0,
        name: row.product_name || row.product_id,
      });
    }

    const insufficientLines: string[] = [];
    for (const line of lines) {
      const pid = line.product_id as string;
      const info = stockLookup.get(pid);
      const available = info?.qtyOnHand || 0;
      const requested = line.quantity as number;

      if (available < requested) {
        insufficientLines.push(`${info?.name || pid}: need ${requested}, available ${available}`);
      }
    }

    if (insufficientLines.length > 0) {
      const failedPids = lines
        .filter((l: any) => (stockLookup.get(l.product_id as string)?.qtyOnHand || 0) < Number(l.quantity))
        .map((l: any) => l.product_id as string);

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

      const detailedLines = lines
        .filter((l: any) => (stockLookup.get(l.product_id as string)?.qtyOnHand || 0) < Number(l.quantity))
        .map((l: any) => {
          const pid = l.product_id as string;
          const info = stockLookup.get(pid);
          const name = info?.name || pid;
          const available = info?.qtyOnHand || 0;
          const requested = Number(l.quantity);
          const alts = altLocationMap.get(pid);
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
          INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, invoice_id, amount, payment_method, payment_date, previous_balance, remaining_balance, notes, recorded_by)
          VALUES (?, ?, ?, 'INVOICE', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
        `).bind(uuidv4(), receiptNumber, (order as any).customer_id, invoiceId, amountPaid, paymentMethod, grandTotal, remainingBalance, isFullPay ? 'Full payment via Complete Sale' : 'Deposit / Partial payment via Complete Sale', userId));
      }
    }

    // Copy lines
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, quantity, unit_price)
      SELECT lower(hex(randomblob(16))), ?, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = ?
    `).bind(invoiceId, orderId));

    // Deduct inventory
    for (const line of lines) {
      const qty = line.quantity as number;
      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(qty, line.product_id, branchId));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), line.product_id, -qty, branchId, invoiceId, userId));
    }

    // Finalize order status
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = ?, is_credit_sale = ? WHERE id = ?").bind(orderFinalStatus, isCreditSale || !isFullPay ? 1 : 0, orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_COMPLETE', 'sales_orders', orderId, { status: validSource }, { status: orderFinalStatus, invoiceId, total: grandTotal, amountPaid, remainingBalance }));

    const tBatch0 = Date.now();
    await c.env.DB.batch(stmts);
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Main sale write batch (${stmts.length} stmts) completed (${Date.now() - tBatch0}ms)`);

    // Automatically post double-entry GL journal entries for Sale Completion & Payment
    try {
      const entryDate = new Date().toISOString().split('T')[0];

      const tGlPre0 = Date.now();
      const [sharedFiscalPeriodId, sharedCoaMap] = await Promise.all([
        fetchOpenFiscalPeriodId(c.env.DB, entryDate),
        fetchCoaMapForCodes(c.env.DB, ['1010', '1020', '2050', '4010']),
      ]);
      console.log(`[WATERFALL] +${Date.now() - reqStart}ms | GL pre-fetch (fiscal period + 4 CoA codes) completed (${Date.now() - tGlPre0}ms)`);

      const tGl1_0 = Date.now();
      const cogsAmount = await calculateOrderCogs(c.env.DB, order.id as string);
      await postSaleJournalEntry(
        c,
        { id: order.id as string, order_number: (order as any).order_number as string || (order.id as string), branch_id: (order as any).branch_id ? String((order as any).branch_id) : undefined },
        total,
        cogsAmount,
        userId,
        sharedFiscalPeriodId || undefined,
        sharedCoaMap,
        installFee
      );
      console.log(`[WATERFALL] +${Date.now() - reqStart}ms | postSaleJournalEntry completed (${Date.now() - tGl1_0}ms)`);

      if (amountPaid > 0) {
        const tGl2_0 = Date.now();
        await postCustomerPaymentJournalEntry(
          c,
          { id: invoiceId, amount: amountPaid },
          { id: order.id as string, order_number: (order as any).order_number as string || (order.id as string), branch_id: (order as any).branch_id as string },
          userId,
          sharedFiscalPeriodId,
          sharedCoaMap
        );
        console.log(`[WATERFALL] +${Date.now() - reqStart}ms | postCustomerPaymentJournalEntry completed (${Date.now() - tGl2_0}ms)`);
      }
    } catch (glErr) {
      console.error('Non-fatal GL posting error:', glErr);
    }

    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Complete sale request finished! Sending JSON response.`);
    return c.json({ success: true, invoiceId, total, amountPaid, balance: remainingBalance, receipt_number: receiptNumber });

  } catch (err: any) {
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
    } catch (_) {}
    console.error('Order completion failed:', err);
    return c.json({ message: 'Order completion failed. Rolled back.', error: err?.message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// RECORD INVOICE PAYMENT — partial / installment payment
// NEW ENDPOINT — POST /sales/invoices/:id/payments
// ──────────────────────────────────────────────────────────────────────
sales.post('/invoices/:id/payments', requirePermissions(['manage_sales']), async (c) => {
  const invoiceId = c.req.param('id');
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
    'SELECT i.*, so.id AS order_id FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id WHERE i.id = ?'
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

  await c.env.DB.batch(stmts);

  // Automatically post double-entry GL journal entry for Customer Payment
  try {
    await postCustomerPaymentJournalEntry(
      c,
      { id: paymentId, amount, paymentDate },
      { id: (invoice as any).order_id, order_number: (invoice as any).invoice_number || (invoice as any).id, branch_id: (invoice as any).branch_id },
      userId
    );
  } catch (accErr) {
    console.error('Failed to post customer payment accounting entry:', accErr);
  }

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
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

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
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason?.trim() || 'Order cancelled by authorized staff';

  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first() as any;
  if (!order) return c.json({ message: 'Order not found.' }, 404);
  if (order.status === 'CANCELLED') {
    return c.json({ message: 'Order is already cancelled.' }, 400);
  }

  const prevStatus = order.status;
  const branchId = order.branch_id;
  const stmts: any[] = [];

  // Check if invoice exists
  const invoice = await c.env.DB.prepare('SELECT * FROM invoices WHERE sales_order_id = ?').bind(orderId).first() as any;

  // If order was CONFIRMED, INVOICED, or has invoice (meaning inventory was deducted):
  // We must restore warehouse/branch inventory!
  if (prevStatus === 'CONFIRMED' || prevStatus === 'INVOICED' || prevStatus === 'PAID' || invoice) {
    const { results: lines } = await c.env.DB.prepare(
      'SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).all();

    for (const line of (lines || []) as any[]) {
      const qty = Number(line.quantity || 0);
      if (qty > 0) {
        // Restore physical stock to warehouse/branch inventory
        stmts.push(c.env.DB.prepare(`
          UPDATE inventory_stock
          SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
        `).bind(qty, line.product_id, branchId));

        // Record restore inventory transaction
        stmts.push(c.env.DB.prepare(`
          INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, dest_owner_type, dest_branch_id, reference_type, reference_id, notes, created_by)
          VALUES (?, ?, 'SALE_CANCEL_RESTORE', ?, 'BRANCH', ?, 'ORDER_CANCEL', ?, ?, ?)
        `).bind(uuidv4(), line.product_id, qty, branchId, orderId, `Restored from cancelled order #${order.order_number}`, userId));
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

  // Update sales order status and audit fields
  stmts.push(c.env.DB.prepare(`
    UPDATE sales_orders
    SET status = 'CANCELLED', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(userId, reason, orderId));

  stmts.push(createAuditLogStmt(c, 'SALES_ORDER_CANCEL', 'sales_orders', orderId, { status: prevStatus }, {
    status: 'CANCELLED',
    reason,
    cancelledBy: userId,
  }));

  await c.env.DB.batch(stmts);

  // Reverse double-entry GL journal entries if any were posted
  try {
    const { results: jes } = await c.env.DB.prepare(`
      SELECT id FROM journal_entries
      WHERE reference_id = ? OR reference_id = ? OR reference_id LIKE ?
    `).bind(orderId, invoice?.id || orderId, `${orderId}%`).all();

    for (const je of (jes || []) as any[]) {
      await reverseJournalEntry(c, je.id, `Reversal due to cancelled order #${order.order_number}: ${reason}`, userId);
    }
  } catch (revErr) {
    console.warn('Non-fatal GL reversal error on order cancellation:', revErr);
  }

  return c.json({
    success: true,
    message: 'Sales order cancelled, inventory restored to warehouse, and debt records reversed.',
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
  const scopedBranchId = admin ? null : payload.branch_id;

  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  if (!order) return c.json({ message: 'Sales order not found' }, 404);

  if (scopedBranchId && (order as any).branch_id !== scopedBranchId) {
    return c.json({ message: 'Access denied: order belongs to another branch.' }, 403);
  }

  // Find invoice if any
  const invoice = await c.env.DB.prepare('SELECT id FROM invoices WHERE sales_order_id = ?').bind(id).first();
  const invoiceId = invoice ? (invoice as any).id : null;

  const stmts = [];
  if (invoiceId) {
    stmts.push(c.env.DB.prepare('DELETE FROM invoice_payments WHERE invoice_id = ?').bind(invoiceId));
    stmts.push(c.env.DB.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').bind(invoiceId));
    stmts.push(c.env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(invoiceId));
  }
  stmts.push(c.env.DB.prepare('DELETE FROM sales_order_lines WHERE sales_order_id = ?').bind(id));
  stmts.push(c.env.DB.prepare('DELETE FROM sales_orders WHERE id = ?').bind(id));
  stmts.push(createAuditLogStmt(c, 'SALES_ORDER_DELETE', 'sales_orders', id, order, null));

  await c.env.DB.batch(stmts);
  return c.json({ success: true });
});

export default sales;
