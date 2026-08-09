import { uuidv4 } from '../db';

export interface JournalLineInput {
  accountCode: string; // e.g. '1010', '2010', '4010', '5010'
  description?: string;
  debitAmount: number;
  creditAmount: number;
  branchId?: string | null;
}

export interface PostJournalParams {
  description: string;
  referenceType: 'PURCHASE' | 'SALE' | 'TRANSFER' | 'EXPENSE' | 'DEPRECIATION' | 'CLOSING' | 'INVENTORY_ADJUSTMENT' | 'MANUAL';
  referenceId?: string | null;
  branchId?: string | null;
  entryDate?: string;
  lines: JournalLineInput[];
  userId?: string | null;
  // Pre-fetched context — supplied by callers who batch multiple entries in one request
  // to eliminate duplicate round-trips. Both are optional for backward-compat.
  prefetchedFiscalPeriodId?: string | null;
  prefetchedCoaMap?: Map<string, { id: string; normal_balance: string }>;
}

// ─── Task 3: Bounded in-memory CoA cache (5-minute TTL) ───────────────────────
// Chart of accounts codes change rarely (e.g. once per year at setup).
// We cache the full code→row map so repeat requests within the TTL skip the
// SELECT entirely. We do NOT cache fiscal_period here — see note at bottom.
interface CoaCacheEntry {
  data: Map<string, { id: string; normal_balance: string }>;
  expiresAt: number;
}
let coaCache: CoaCacheEntry | null = null;
const COA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCoaFromCache(): Map<string, { id: string; normal_balance: string }> | null {
  if (coaCache && Date.now() < coaCache.expiresAt) {
    return coaCache.data;
  }
  coaCache = null;
  return null;
}

function setCoaCache(data: Map<string, { id: string; normal_balance: string }>) {
  coaCache = { data, expiresAt: Date.now() + COA_CACHE_TTL_MS };
}

export function invalidateCoaCache() {
  coaCache = null;
}

/**
 * Fetch the full chart_of_accounts as a code→row map, using the bounded cache.
 * On a cache miss, issues a single SELECT * FROM chart_of_accounts query.
 */
async function fetchFullCoaMap(db: any): Promise<Map<string, { id: string; normal_balance: string }>> {
  const cached = getCoaFromCache();
  if (cached) return cached;

  const { results } = await db
    .prepare('SELECT id, code, normal_balance FROM chart_of_accounts')
    .all();

  const map = new Map<string, { id: string; normal_balance: string }>();
  for (const row of (results || []) as any[]) {
    if (row.code) map.set(String(row.code), { id: row.id as string, normal_balance: (row.normal_balance as string) || 'DEBIT' });
    // also index by coa-<code> fallback id pattern
    if (row.id) map.set(String(row.id), { id: row.id as string, normal_balance: (row.normal_balance as string) || 'DEBIT' });
  }

  setCoaCache(map);
  return map;
}

/**
 * Fetch a subset of CoA codes. Returns a map keyed by code.
 * Uses the full-table cache from fetchFullCoaMap to avoid extra round-trips.
 */
export async function fetchCoaMapForCodes(
  db: any,
  codes: string[]
): Promise<Map<string, { id: string; normal_balance: string }>> {
  const full = await fetchFullCoaMap(db);
  const result = new Map<string, { id: string; normal_balance: string }>();
  for (const code of codes) {
    const entry = full.get(code) ?? full.get(`coa-${code}`);
    if (entry) result.set(code, entry);
  }
  return result;
}

/**
 * Fetch open fiscal period for a given date. One call per request — callers
 * that post multiple journal entries should pre-fetch and pass the result in
 * via `prefetchedFiscalPeriodId` to avoid duplicate reads.
 *
 * NOTE: Fiscal period is intentionally NOT added to the CoA cache.
 * A stale/closed fiscal period would silently post to the wrong period —
 * a financial correctness bug, not just a performance issue.
 * Short-lived request-scoped passing (as done here) is the correct pattern.
 * If a caller wants to cache it, they must implement explicit invalidation
 * tied to period rollover — leave that decision to the application layer.
 */
export async function fetchOpenFiscalPeriodId(db: any, entryDate: string): Promise<string | null> {
  const dateStr = entryDate || new Date().toISOString().split('T')[0];
  let fp = await db
    .prepare("SELECT id FROM fiscal_periods WHERE status = 'OPEN' AND ? BETWEEN start_date AND end_date LIMIT 1")
    .bind(dateStr)
    .first()
    .catch(() => null);

  if (fp?.id) return fp.id as string;

  // Fallback 1: Any open fiscal period
  fp = await db
    .prepare("SELECT id FROM fiscal_periods WHERE status = 'OPEN' ORDER BY start_date DESC LIMIT 1")
    .first()
    .catch(() => null);

  if (fp?.id) return fp.id as string;

  // Fallback 2: Auto-create annual period for the entry date's year
  const year = dateStr.split('-')[0] || String(new Date().getFullYear());
  const fpId = `fp-${year}-annual`;
  try {
    await db.prepare(`
      INSERT INTO fiscal_periods (id, name, period_name, period_type, start_date, end_date, status)
      VALUES (?, ?, ?, 'ANNUAL', ?, ?, 'OPEN')
    `).bind(fpId, `FY ${year}`, `FY ${year}`, `${year}-01-01`, `${year}-12-31`).run();
    return fpId;
  } catch (_) {
    return fpId;
  }
}

/**
 * Ensures account existence or fetches account ID by code.
 * Kept for backward-compat with external callers. Uses cache internally.
 */
export async function getAccountIdByCode(
  db: any,
  code: string
): Promise<{ id: string; normal_balance: string } | null> {
  const map = await fetchFullCoaMap(db);
  return map.get(code) ?? map.get(`coa-${code}`) ?? null;
}

/**
 * Dynamic Inventory Costing Extension Point
 * Computes Cost of Goods Sold (COGS) for a sales order using product cost prices.
 * Extension point for FIFO / Weighted Average Valuation.
 */
export async function calculateOrderCogs(db: any, orderId: string): Promise<number> {
  const { results: lines } = await db.prepare(`
    SELECT sol.quantity, p.cost_price
    FROM sales_order_lines sol
    JOIN products p ON p.id = sol.product_id
    WHERE sol.sales_order_id = ?
  `).bind(orderId).all().catch(() => ({ results: [] }));

  let totalCogs = 0;
  for (const line of (lines || []) as any[]) {
    const qty = Number(line.quantity || 0);
    const unitCost = Number(line.cost_price || 0);
    totalCogs += qty * unitCost;
  }
  return totalCogs;
}

/**
 * Creates a balanced Journal Entry, inserts its lines, and posts directly to
 * General Ledger. Idempotent: returns existing ID if already posted.
 */
export async function createAndPostJournalEntry(
  c: any,
  params: PostJournalParams
): Promise<string | null> {
  const db = c.env.DB;

  // ── Idempotency Check: Prevent duplicate postings ─────────────────────────
  if (params.referenceType && params.referenceId && params.referenceType !== 'MANUAL') {
    const existing = await db.prepare(
      "SELECT id FROM journal_entries WHERE reference_type = ? AND reference_id = ? AND status = 'POSTED' LIMIT 1"
    ).bind(params.referenceType, params.referenceId).first().catch(() => null);
    if (existing?.id) {
      // Verify it actually has lines (not an orphan from a previous failed batch)
      const lineCount = await db.prepare(
        'SELECT COUNT(*) AS cnt FROM journal_entry_lines WHERE journal_entry_id = ?'
      ).bind(existing.id).first().catch(() => null);
      const hasLines = Number((lineCount as any)?.cnt || 0) > 0;
      if (hasLines) {
        return existing.id as string; // Genuine duplicate — skip
      }
      // Orphan header (no lines) — delete it and re-post
      await db.prepare('DELETE FROM journal_entries WHERE id = ?').bind(existing.id).run().catch(() => {});
    }
  }


  const entryDate = params.entryDate || new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const entryId = uuidv4();
  const entryNumber = `JE-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

  // ── Task 1a: Use pre-fetched fiscal period if provided ─────────────────────
  const fiscalPeriodId =
    params.prefetchedFiscalPeriodId !== undefined
      ? params.prefetchedFiscalPeriodId
      : await fetchOpenFiscalPeriodId(db, entryDate);

  // ── Task 1b: Resolve CoA from pre-fetched map or cache-backed lookup ────────
  const coaMap: Map<string, { id: string; normal_balance: string }> =
    params.prefetchedCoaMap ?? (await fetchFullCoaMap(db));

  let totalDebit = 0;
  let totalCredit = 0;

  const resolvedLines: {
    lineId: string;
    accountId: string;
    normalBalance: string;
    description: string;
    debitAmount: number;
    creditAmount: number;
    branchId: string | null;
    lineOrder: number;
  }[] = [];

  for (let i = 0; i < params.lines.length; i++) {
    const line = params.lines[i];
    const acc = coaMap.get(line.accountCode) ?? coaMap.get(`coa-${line.accountCode}`);
    if (!acc) {
      console.warn(
        `Accounting Service: Account code ${line.accountCode} not found in chart_of_accounts. Skipping entry.`
      );
      continue;
    }
    const debit = Math.max(0, Number(line.debitAmount || 0));
    const credit = Math.max(0, Number(line.creditAmount || 0));
    totalDebit += debit;
    totalCredit += credit;

    resolvedLines.push({
      lineId: uuidv4(),
      accountId: acc.id,
      normalBalance: acc.normal_balance,
      description: line.description || params.description,
      debitAmount: debit,
      creditAmount: credit,
      branchId: line.branchId || params.branchId || null,
      lineOrder: i + 1,
    });
  }

  if (resolvedLines.length === 0) return null;

  // ── Running balance pre-fetch ─────────────────────────────────────────────
  // Fetch the latest running_balance for each account in this entry.
  // Uses DISTINCT ON (PostgreSQL) to safely get one row per account.
  // Falls back to 0 if no prior GL entry exists for an account (i.e., first posting).
  const accountIds = resolvedLines.map((l) => l.accountId);
  const glBalanceMap = new Map<string, number>();

  try {
    const glPlaceholders = accountIds.map((_, i) => `$${i + 1}`).join(', ');
    const rawDb = (db as any).pool ?? null;
    if (rawDb) {
      // Direct PostgreSQL query for DISTINCT ON support
      const res = await rawDb.query(
        `SELECT DISTINCT ON (account_id) account_id, running_balance
         FROM general_ledger
         WHERE account_id IN (${glPlaceholders})
         ORDER BY account_id, created_at DESC`,
        accountIds
      );
      for (const row of (res.rows || []) as any[]) {
        glBalanceMap.set(row.account_id as string, Number(row.running_balance || 0));
      }
    } else {
      // D1 fallback — simple per-account subquery
      for (const accountId of accountIds) {
        const row = await db.prepare(
          `SELECT running_balance FROM general_ledger WHERE account_id = ? ORDER BY created_at DESC LIMIT 1`
        ).bind(accountId).first().catch(() => null);
        if (row) glBalanceMap.set(accountId, Number((row as any).running_balance || 0));
      }
    }
  } catch (_) {
    // Non-fatal: running_balance defaults to 0 for first-time entries
  }

  const stmts: any[] = [];

  // 1. Insert Journal Entry (status = 'POSTED')
  stmts.push(
    db
      .prepare(
        `INSERT INTO journal_entries (
        id, entry_number, fiscal_period_id, entry_date, description,
        reference_type, reference_id, branch_id, status,
        total_debit, total_credit, created_by, posted_by, posted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entryId,
        entryNumber,
        fiscalPeriodId,
        entryDate,
        params.description,
        params.referenceType,
        params.referenceId || null,
        params.branchId || null,
        totalDebit,
        totalCredit,
        params.userId || null,
        params.userId || null,
        now,
        now,
        now
      )
  );

  // 2. Insert Journal Entry Lines & General Ledger entries
  for (const line of resolvedLines) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO journal_entry_lines (
          id, journal_entry_id, account_id, description, debit_amount, credit_amount, branch_id, line_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          line.lineId,
          entryId,
          line.accountId,
          line.description,
          line.debitAmount,
          line.creditAmount,
          line.branchId,
          line.lineOrder
        )
    );

    // Running balance computed from the pre-fetched map (no extra round-trip)
    let runningBalance = glBalanceMap.get(line.accountId) ?? 0;
    if (line.normalBalance === 'DEBIT') {
      runningBalance += line.debitAmount - line.creditAmount;
    } else {
      runningBalance += line.creditAmount - line.debitAmount;
    }

    const glId = uuidv4();
    stmts.push(
      db
        .prepare(
          `INSERT INTO general_ledger (
          id, account_id, journal_entry_id, line_id, entry_date, description,
          debit_amount, credit_amount, running_balance, branch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          glId,
          line.accountId,
          entryId,
          line.lineId,
          entryDate,
          line.description,
          line.debitAmount,
          line.creditAmount,
          runningBalance,
          line.branchId
        )
    );
  }

  await db.batch(stmts);
  return entryId;
}


/**
 * Journal Entry for Purchase Order Approval / Receipt
 * DR: Inventory Asset (1030)
 * CR: Accounts Payable (2010)
 */
export async function postPurchaseApprovalJournalEntry(
  c: any,
  po: { id: string; po_number: string; branch_id?: string },
  totalAmount: number,
  userId?: string
) {
  return createAndPostJournalEntry(c, {
    description: `Purchase Goods Received #${po.po_number}`,
    referenceType: 'PURCHASE',
    referenceId: po.id,
    branchId: po.branch_id || null,
    userId,
    lines: [
      { accountCode: '1030', debitAmount: totalAmount, creditAmount: 0 },
      { accountCode: '2010', debitAmount: 0, creditAmount: totalAmount },
    ],
  });
}

/**
 * Journal Entry for Purchase Invoice Payment
 * DR: Accounts Payable (2010)
 * CR: Cash & Cash Equivalents (1010)
 */
export async function postPurchasePaymentJournalEntry(
  c: any,
  payment: { id: string; amount: number; paymentDate?: string },
  invoice: { id: string; invoice_number: string; branch_id?: string },
  userId?: string
) {
  return createAndPostJournalEntry(c, {
    description: `Payment to Supplier for Invoice #${invoice.invoice_number}`,
    referenceType: 'PURCHASE',
    referenceId: invoice.id,
    entryDate: payment.paymentDate,
    branchId: invoice.branch_id || null,
    userId,
    lines: [
      { accountCode: '2010', debitAmount: payment.amount, creditAmount: 0 },
      { accountCode: '1010', debitAmount: 0, creditAmount: payment.amount },
    ],
  });
}

/**
 * Journal Entry for Sale Order Completion / Invoice
 * DR: Accounts Receivable (1020)
 * CR: Sales Revenue (4010)
 * Optional COGS: DR COGS (5010), CR Inventory Asset (1030)
 */
export async function postSaleJournalEntry(
  c: any,
  order: { id: string; order_number: string; branch_id?: string },
  totalAmount: number,
  cogsAmount: number = 0,
  userId?: string,
  prefetchedFiscalPeriodId?: string | null,
  prefetchedCoaMap?: Map<string, { id: string; normal_balance: string }>
) {
  const lines: JournalLineInput[] = [
    { accountCode: '1020', debitAmount: totalAmount, creditAmount: 0 },
    { accountCode: '4010', debitAmount: 0, creditAmount: totalAmount },
  ];

  if (cogsAmount > 0) {
    lines.push({ accountCode: '5010', debitAmount: cogsAmount, creditAmount: 0 });
    lines.push({ accountCode: '1030', debitAmount: 0, creditAmount: cogsAmount });
  }

  return createAndPostJournalEntry(c, {
    description: `Sales Order Completed & Invoiced #${order.order_number}`,
    referenceType: 'SALE',
    referenceId: order.id,
    branchId: order.branch_id || null,
    userId,
    prefetchedFiscalPeriodId,
    prefetchedCoaMap,
    lines,
  });
}

/**
 * Journal Entry for Customer Payment
 * DR: Cash & Cash Equivalents (1010)
 * CR: Accounts Receivable (1020)
 */
export async function postCustomerPaymentJournalEntry(
  c: any,
  payment: { id: string; amount: number; paymentDate?: string },
  order: { id: string; order_number: string; branch_id?: string },
  userId?: string,
  prefetchedFiscalPeriodId?: string | null,
  prefetchedCoaMap?: Map<string, { id: string; normal_balance: string }>
) {
  const refId = (payment.id && payment.id !== order.id) ? payment.id : `${order.id}-pay`;
  return createAndPostJournalEntry(c, {
    description: `Customer Payment Received for Order #${order.order_number}`,
    referenceType: 'SALE',
    referenceId: refId,
    entryDate: payment.paymentDate,
    branchId: order.branch_id || null,
    userId,
    prefetchedFiscalPeriodId,
    prefetchedCoaMap,
    lines: [
      { accountCode: '1010', debitAmount: payment.amount, creditAmount: 0 },
      { accountCode: '1020', debitAmount: 0, creditAmount: payment.amount },
    ],
  });
}

/**
 * Journal Entry for Expense Recorded
 * DR: Expense Account (6010 / 6050)
 * CR: Cash & Cash Equivalents (1010)
 */
export async function postExpenseJournalEntry(
  c: any,
  expense: { id: string; title: string; amount: number; category: string; expense_date: string; branch_id?: string },
  userId?: string
) {
  const expenseCode = ['Rent', 'Salaries', 'Utilities', 'Maintenance'].includes(expense.category) ? '6010' : '6050';

  return createAndPostJournalEntry(c, {
    description: `Expense Paid: ${expense.title} (${expense.category})`,
    referenceType: 'EXPENSE',
    referenceId: expense.id,
    entryDate: expense.expense_date,
    branchId: expense.branch_id || null,
    userId,
    lines: [
      { accountCode: expenseCode, debitAmount: expense.amount, creditAmount: 0 },
      { accountCode: '1010', debitAmount: 0, creditAmount: expense.amount },
    ],
  });
}

/**
 * Journal Entry for Inventory Stock Adjustment
 * Positive adjustment (stock increase): DR Inventory (1030), CR Inventory Gain (5030)
 * Negative adjustment (stock decrease): DR Inventory Loss (5020), CR Inventory (1030)
 */
export async function postInventoryAdjustmentJournalEntry(
  c: any,
  adjustment: {
    id: string;
    productId: string;
    quantity: number;
    direction: 'INCREASE' | 'DECREASE';
    unitCost?: number;
    branchId?: string;
  },
  userId?: string
) {
  const estimatedCost = Number(adjustment.unitCost || 10) * adjustment.quantity;
  const isIncrease = adjustment.direction === 'INCREASE';

  return createAndPostJournalEntry(c, {
    description: `Inventory Adjustment (${adjustment.direction}) - Product #${adjustment.productId}`,
    referenceType: 'INVENTORY_ADJUSTMENT',
    referenceId: adjustment.id,
    branchId: adjustment.branchId || null,
    userId,
    lines: isIncrease
      ? [
          { accountCode: '1030', debitAmount: estimatedCost, creditAmount: 0 },
          { accountCode: '5030', debitAmount: 0, creditAmount: estimatedCost },
        ]
      : [
          { accountCode: '5020', debitAmount: estimatedCost, creditAmount: 0 },
          { accountCode: '1030', debitAmount: 0, creditAmount: estimatedCost },
        ],
  });
}

/**
 * Reverse a Journal Entry by ID (Non-destructive cancellation)
 */
export async function reverseJournalEntry(
  c: any,
  journalEntryId: string,
  reason: string,
  userId?: string
) {
  const db = c.env.DB;
  const original = await db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(journalEntryId).first();
  if (!original) return null;

  const { results: lines } = await db.prepare(
    'SELECT jel.*, coa.code as account_code FROM journal_entry_lines jel JOIN chart_of_accounts coa ON coa.id = jel.account_id WHERE jel.journal_entry_id = ?'
  ).bind(journalEntryId).all();

  if (!lines || !lines.length) return null;

  const reverseLines: JournalLineInput[] = lines.map((l: any) => ({
    accountCode: l.account_code,
    debitAmount: l.credit_amount,
    creditAmount: l.debit_amount,
    description: `Reversal: ${l.description || original.description}`,
    branchId: l.branch_id,
  }));

  return createAndPostJournalEntry(c, {
    description: `REVERSAL of JE #${original.entry_number}: ${reason}`,
    referenceType: 'MANUAL',
    referenceId: original.reference_id || original.id,
    branchId: original.branch_id,
    userId,
    lines: reverseLines,
  });
}

/**
 * Reconciles and backfills missing double-entry GL journal entries for existing
 * PAID or INVOICED sales orders that were processed prior to GL sync.
 */
export async function reconcileMissingSalesJournalEntries(c: any): Promise<number> {
  const db = c.env.DB;
  let count = 0;
  try {
    const { results: orders } = await db.prepare(
      "SELECT * FROM sales_orders WHERE status IN ('PAID', 'INVOICED')"
    ).all().catch(() => ({ results: [] }));

    if (!orders || orders.length === 0) return 0;

    const entryDate = new Date().toISOString().split('T')[0];
    const sharedFiscalPeriodId = await fetchOpenFiscalPeriodId(db, entryDate);
    const sharedCoaMap = await fetchCoaMapForCodes(db, ['1010', '1020', '1030', '4010', '5010']);

    for (const order of (orders as any[])) {
      // 1. Sale Journal Entry
      const existingSaleJe = await db.prepare(
        "SELECT id FROM journal_entries WHERE reference_type = 'SALE' AND reference_id = ? AND status = 'POSTED' LIMIT 1"
      ).bind(order.id).first().catch(() => null);

      let saleJeId = existingSaleJe?.id;

      if (!saleJeId) {
        const totalRes = await db.prepare(
          'SELECT COALESCE(SUM(quantity * unit_price - discount_amount), 0) AS total FROM sales_order_lines WHERE sales_order_id = ?'
        ).bind(order.id).first().catch(() => null);

        const total = Number(totalRes?.total || order.total_amount || 0);
        if (total > 0) {
          const cogsAmount = await calculateOrderCogs(db, order.id);
          saleJeId = await postSaleJournalEntry(
            c,
            { id: order.id, order_number: order.order_number || order.id, branch_id: order.branch_id },
            total,
            cogsAmount,
            order.created_by || null,
            sharedFiscalPeriodId || undefined,
            sharedCoaMap
          );
          if (saleJeId) count++;
        }
      }

      // 2. Customer Payment Journal Entry (for PAID status)
      if (order.status === 'PAID') {
        const payRefId = `${order.id}-pay`;
        const existingPayJe = await db.prepare(
          "SELECT id FROM journal_entries WHERE reference_type = 'SALE' AND reference_id = ? AND status = 'POSTED' LIMIT 1"
        ).bind(payRefId).first().catch(() => null);

        if (!existingPayJe) {
          const invoice = await db.prepare(
            'SELECT id, total_amount, discount_amount FROM invoices WHERE sales_order_id = ?'
          ).bind(order.id).first().catch(() => null);

          const invoiceId = invoice?.id || order.id;
          const netTotal = Math.max(0, Number(invoice?.total_amount || order.total_amount || 0) - Number(invoice?.discount_amount || 0));

          if (netTotal > 0) {
            const payJeId = await postCustomerPaymentJournalEntry(
              c,
              { id: invoiceId, amount: netTotal },
              { id: order.id, order_number: order.order_number || order.id, branch_id: order.branch_id },
              order.created_by || null,
              sharedFiscalPeriodId || undefined,
              sharedCoaMap
            );
            if (payJeId) count++;
          }
        }
      }
    }
  } catch (err) {
    console.error('reconcileMissingSalesJournalEntries error:', err);
  }
  return count;
}

// ─── NOTE: Why fiscal_period is not cached here ────────────────────────────────
// Posting to a closed or stale fiscal period silently corrupts financial reports.
// Unlike chart_of_accounts (which is essentially static config), fiscal periods
// transition on a known schedule (monthly). Caching would require explicit
// invalidation wired to the period-close/rollover workflow.
// Decision for app layer: if you want fiscal period caching, add it in the
// period-management route when status changes to 'CLOSED', and call
// invalidateFiscalPeriodCache() there. For now, it stays a live DB read.
