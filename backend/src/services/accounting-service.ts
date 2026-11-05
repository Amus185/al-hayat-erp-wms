import { unitCosts } from './costing';
import { uuidv4 } from '../db';
import { ConflictError } from '../pg-client';

export interface JournalLineInput {
  accountCode: string; // e.g. '1010', '2010', '4010', '5010'
  description?: string;
  debitAmount: number;
  creditAmount: number;
  branchId?: string | null;
}

export interface PostJournalParams {
  description: string;
  referenceType: 'PURCHASE' | 'SALE' | 'TRANSFER' | 'EXPENSE' | 'DEPRECIATION' | 'CLOSING' | 'INVENTORY_ADJUSTMENT' | 'MANUAL' | 'MANUFACTURING' | 'OPENING' | 'PAYROLL';
  referenceId?: string | null;
  branchId?: string | null;
  entryDate?: string;
  lines: JournalLineInput[];
  userId?: string | null;
  // Pre-fetched context — supplied by callers who batch multiple entries in one request
  // to eliminate duplicate round-trips. Both are optional for backward-compat.
  prefetchedFiscalPeriodId?: string | null;
  prefetchedCoaMap?: Map<string, { id: string; normal_balance: string }>;
  // Re-posting after a reversal in the same batch (the old entry is still
  // POSTED when this is prepared, so the duplicate guard must be skipped).
  skipIdempotency?: boolean;
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
  // A closed/locked period covering the date locks it, even if another
  // (e.g. annual) period covering the same date is still open.
  const { results: covering } = await db
    .prepare("SELECT id, status, period_name FROM fiscal_periods WHERE ? BETWEEN start_date AND end_date ORDER BY start_date DESC")
    .bind(dateStr)
    .all();
  const locked = (covering || []).find((p: any) => p.status !== 'OPEN');
  if (locked) {
    throw new ConflictError(`Fiscal period ${locked.period_name || locked.id} is ${locked.status}; postings dated ${dateStr} are not allowed.`);
  }
  if (covering?.length) return covering[0].id as string;

  // No period covers the date: auto-create the annual period for that year
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
 * Computes Cost of Goods Sold (COGS) for a sales order at each product's
 * running-average cost (kept up to date by goods coming in).
 */
export async function calculateOrderCogs(db: any, orderId: string): Promise<number> {
  const { results } = await db.prepare(
    'SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?'
  ).bind(orderId).all();
  return calculateLinesCogs(db, results || []);
}

/** COGS for order lines that may not be saved yet (prepared before the batch). */
export async function calculateLinesCogs(db: any, orderLines: Array<{ product_id: string; quantity: number }>): Promise<number> {
  if (!orderLines.length) return 0;
  // Running-average cost now (see services/costing.ts); grouped = sum of components.
  const costs = await unitCosts(db, orderLines.map((l) => l.product_id));
  return orderLines.reduce((sum, l) => sum + Number(l.quantity || 0) * (costs.get(l.product_id) ?? 0), 0);
}

/**
 * Creates a balanced Journal Entry, inserts its lines, and posts directly to
 * General Ledger. Idempotent: returns existing ID if already posted.
 */
export async function prepareJournalEntryPosting(
  c: any,
  params: PostJournalParams
): Promise<{ entryId: string | null; statements: any[] }> {
  const db = c.env.DB;

  // ── Idempotency Check: Prevent duplicate postings ─────────────────────────
  if (params.referenceType && params.referenceId && params.referenceType !== 'MANUAL' && !params.skipIdempotency) {
    const existing = await db.prepare(
      "SELECT id FROM journal_entries WHERE reference_type = ? AND reference_id = ? AND status = 'POSTED' LIMIT 1"
    ).bind(params.referenceType, params.referenceId).first().catch(() => null);
    if (existing?.id) {
      const lineCount = await db.prepare(
        'SELECT COUNT(*) AS cnt FROM journal_entry_lines WHERE journal_entry_id = ?'
      ).bind(existing.id).first().catch(() => null);
      if (Number((lineCount as any)?.cnt || 0) > 0) {
        return { entryId: existing.id as string, statements: [] };
      }
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

    // One entry = one branch: branch reports filter on lines, so a line in a
    // different branch would split the entry across two sets of books.
    const entryBranch = params.branchId || null;
    if (line.branchId && line.branchId !== entryBranch) {
      throw new Error(`Journal entry "${params.description}" mixes branches (${entryBranch ?? 'unassigned'} / ${line.branchId}); post one entry per branch.`);
    }

    resolvedLines.push({
      lineId: uuidv4(),
      accountId: acc.id,
      normalBalance: acc.normal_balance,
      description: line.description || params.description,
      debitAmount: debit,
      creditAmount: credit,
      branchId: entryBranch,
      lineOrder: i + 1,
    });
  }

  if (resolvedLines.length === 0 || Math.abs(totalDebit - totalCredit) > 0.0001) {
    throw new Error(`Journal entry is not balanced or has no valid lines: ${params.description}`);
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

  // 2. Insert Journal Entry Lines. They are the single source of truth: the
  // general ledger is a view over them, and running balances are computed
  // when the ledger is read (within the requested branch scope).
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
  }

  return { entryId, statements: stmts };
}

/**
 * Creates and posts a journal entry in its own transaction. Use
 * prepareJournalEntryPosting when it must commit with another business event.
 */
export async function createAndPostJournalEntry(
  c: any,
  params: PostJournalParams
): Promise<string | null> {
  const prepared = await prepareJournalEntryPosting(c, params);
  if (prepared.statements.length > 0) {
    await c.env.DB.batch(prepared.statements);
  }
  return prepared.entryId;
}


/**
 * Journal Entry for Sale Order Completion / Invoice
 * DR: Accounts Receivable (1020)
 * CR: Sales Revenue (4010)
 * Optional COGS: DR COGS (5010), CR Inventory Asset (1030)
 */
export async function postSaleJournalEntry(...args: Parameters<typeof saleJournalParams>) {
  return createAndPostJournalEntry(args[0], saleJournalParams(...args));
}

/** Same as postSaleJournalEntry, but returns statements for the caller's batch. */
export async function prepareSaleJournalEntry(...args: Parameters<typeof saleJournalParams>) {
  return prepareJournalEntryPosting(args[0], saleJournalParams(...args));
}

function saleJournalParams(
  c: any,
  order: { id: string; order_number: string; branch_id?: string | null },
  totalAmount: number,
  cogsAmount: number = 0,
  userId?: string | null,
  prefetchedFiscalPeriodId?: string | null,
  prefetchedCoaMap?: Map<string, { id: string; normal_balance: string }>,
  installationFee: number = 0
): PostJournalParams {
  const installFee = Number(installationFee || 0);
  const totalReceivable = totalAmount + installFee;

  const lines: JournalLineInput[] = [
    { accountCode: '1020', debitAmount: totalReceivable, creditAmount: 0 },
    { accountCode: '4010', debitAmount: 0, creditAmount: totalAmount },
  ];

  if (installFee > 0) {
    // Pass-through liability: technician installation fee does NOT count as company revenue
    lines.push({ accountCode: '2050', debitAmount: 0, creditAmount: installFee });
  }

  if (cogsAmount > 0) {
    lines.push({ accountCode: '5010', debitAmount: cogsAmount, creditAmount: 0 });
    lines.push({ accountCode: '1030', debitAmount: 0, creditAmount: cogsAmount });
  }

  return {
    description: `Sales Order Completed & Invoiced #${order.order_number}`,
    referenceType: 'SALE',
    referenceId: order.id,
    branchId: order.branch_id || null,
    userId,
    prefetchedFiscalPeriodId,
    prefetchedCoaMap,
    lines,
  };
}

/**
 * Journal Entry for Installation Fee Paid to Technician
 * DR: Technician Installation Fees Payable (2050)
 * CR: Cash & Cash Equivalents (1010), or Accounts Payable (2010) when the
 * expense payment method records a supplier balance.
 */
export async function postInstallationPayoutJournalEntry(
  c: any,
  order: { id: string; order_number: string; branch_id?: string },
  amount: number,
  userId?: string
) {
  if (amount <= 0) return null;
  return createAndPostJournalEntry(c, {
    description: `Technician Installation Fee Payout for Order #${order.order_number}`,
    referenceType: 'SALE',
    referenceId: `${order.id}-install-pay`,
    branchId: order.branch_id || null,
    userId,
    lines: [
      { accountCode: '2050', debitAmount: amount, creditAmount: 0 },
      { accountCode: '1010', debitAmount: 0, creditAmount: amount },
    ],
  });
}

/**
 * Journal Entry for Customer Payment
 * DR: Cash & Cash Equivalents (1010)
 * CR: Accounts Receivable (1020)
 */
export async function postCustomerPaymentJournalEntry(...args: Parameters<typeof customerPaymentJournalParams>) {
  return createAndPostJournalEntry(args[0], customerPaymentJournalParams(...args));
}

/** Same as postCustomerPaymentJournalEntry, but returns statements for the caller's batch. */
export async function prepareCustomerPaymentJournalEntry(...args: Parameters<typeof customerPaymentJournalParams>) {
  return prepareJournalEntryPosting(args[0], customerPaymentJournalParams(...args));
}

function customerPaymentJournalParams(
  c: any,
  payment: { id: string; amount: number; paymentDate?: string },
  order: { id: string; order_number: string; branch_id?: string | null },
  userId?: string | null,
  prefetchedFiscalPeriodId?: string | null,
  prefetchedCoaMap?: Map<string, { id: string; normal_balance: string }>
): PostJournalParams {
  const refId = (payment.id && payment.id !== order.id) ? payment.id : `${order.id}-pay`;
  return {
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
  };
}

/**
 * Journal Entry for Expense Recorded
 * DR: Expense Account (6010 / 6050)
 * CR: Cash & Cash Equivalents (1010)
 */
export async function prepareExpenseJournal(
  c: any,
  expense: { id: string; title: string; amount: number; category: string; expense_date: string; branch_id?: string | null; payment_method?: string | null },
  userId?: string | null,
  skipIdempotency = false
) {
  const expenseCode = ['Rent', 'Salaries', 'Utilities', 'Maintenance'].includes(String(expense.category).trim()) ? '6010' : '6050';
  const method = String(expense.payment_method || 'CASH').toUpperCase();
  const payable = ['CREDIT', 'ON_ACCOUNT', 'UNPAID', 'PAYABLE'].includes(method);

  return prepareJournalEntryPosting(c, {
    skipIdempotency,
    description: `Expense Paid: ${expense.title} (${expense.category})`,
    referenceType: 'EXPENSE',
    referenceId: expense.id,
    entryDate: expense.expense_date,
    branchId: expense.branch_id || null,
    userId,
    lines: [
      { accountCode: expenseCode, debitAmount: expense.amount, creditAmount: 0 },
      { accountCode: payable ? '2010' : '1010', debitAmount: 0, creditAmount: expense.amount },
    ],
  });
}

/**
 * Journal Entry for Inventory Stock Adjustment
 * Positive adjustment (stock increase): DR Inventory (1030), CR Inventory Gain (5030)
 * Negative adjustment (stock decrease): DR Inventory Loss (5020), CR Inventory (1030)
 */
export async function prepareInventoryAdjustmentJournalEntry(
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
  const estimatedCost = Number(adjustment.unitCost || 0) * adjustment.quantity;
  const isIncrease = adjustment.direction === 'INCREASE';

  return prepareJournalEntryPosting(c, {
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
 * Prepare the statements that reverse a posted journal entry (non-destructive):
 * flag the original REVERSED (guarded, so a second reversal conflicts) and post
 * a mirror entry with its own GL rows. Reports count both, which nets to zero.
 * Run the result inside the same batch as the business change it belongs to.
 */
export async function prepareJournalReversal(
  c: any,
  journalEntryId: string,
  reason: string,
  userId?: string | null
): Promise<any[]> {
  const db = c.env.DB;
  const original = await db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(journalEntryId).first();
  if (!original) return [];

  const { results: lines } = await db.prepare(
    'SELECT jel.*, coa.code as account_code FROM journal_entry_lines jel JOIN chart_of_accounts coa ON coa.id = jel.account_id WHERE jel.journal_entry_id = ? ORDER BY jel.line_order'
  ).bind(journalEntryId).all();

  if (!lines || !lines.length) return [];

  const reversal = await prepareJournalEntryPosting(c, {
    description: `REVERSAL of JE #${original.entry_number}: ${reason}`,
    referenceType: 'MANUAL',
    referenceId: original.id,
    branchId: original.branch_id,
    userId,
    lines: lines.map((l: any) => ({
      accountCode: l.account_code,
      debitAmount: Number(l.credit_amount || 0),
      creditAmount: Number(l.debit_amount || 0),
      description: `Reversal: ${l.description || original.description}`,
      branchId: l.branch_id,
    })),
  });

  return [
    db.prepare("UPDATE journal_entries SET status = 'REVERSED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'POSTED'")
      .bind(journalEntryId)
      .mustAffect(`Journal entry ${original.entry_number} has already been reversed.`),
    ...reversal.statements,
  ];
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
        // Payments are journaled under the payment id (invoice_payments /
        // customer_payments), the invoice id (checkout) or `${order}-pay`
        // (legacy). Any of them means the payment is already in the ledger.
        const payRefId = `${order.id}-pay`;
        const existingPayJe = await db.prepare(`
          SELECT je.id FROM journal_entries je
          WHERE je.reference_type = 'SALE' AND je.status = 'POSTED' AND (
            je.reference_id = ?
            OR je.reference_id IN (SELECT i.id FROM invoices i WHERE i.sales_order_id = ?)
            OR je.reference_id IN (SELECT ip.id FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id WHERE i.sales_order_id = ?)
            OR je.reference_id IN (SELECT cp.id FROM customer_payments cp JOIN invoices i ON i.id = cp.invoice_id WHERE i.sales_order_id = ?)
          )
          LIMIT 1
        `).bind(payRefId, order.id, order.id, order.id).first();

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

/**
 * Backfills only goods receipts whose value is absent from 1030. Legacy
 * entries were keyed to a purchase order, so their value is allocated to the
 * earliest receipts first. Ambiguous partial values are reported, never
 * guessed or posted as a balancing adjustment.
 */
export async function reconcileMissingReceiptJournalEntries(c: any): Promise<{
  created: number;
  coveredByLegacyEntries: number;
  exceptions: { receipt_id: string; receipt_number: string; receipt_value: number; legacy_unallocated_value: number }[];
}> {
  const db = c.env.DB;
  const { results: receiptRows } = await db.prepare(`
    SELECT gr.id, gr.receipt_number, gr.purchase_order_id, gr.received_at,
           po.po_number, po.branch_id,
           COALESCE(SUM(grl.line_total), 0) AS receipt_value
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id = gr.purchase_order_id
    JOIN goods_receipt_lines grl ON grl.goods_receipt_id = gr.id
    WHERE COALESCE(gr.status, 'COMPLETED') != 'CANCELLED'
    GROUP BY gr.id, gr.receipt_number, gr.purchase_order_id, gr.received_at, po.po_number, po.branch_id
    ORDER BY gr.purchase_order_id, gr.received_at, gr.id
  `).all();

  let created = 0;
  let coveredByLegacyEntries = 0;
  const exceptions: { receipt_id: string; receipt_number: string; receipt_value: number; legacy_unallocated_value: number }[] = [];
  const legacyRemaining = new Map<string, number>();

  for (const receipt of (receiptRows || []) as any[]) {
    const value = Number(receipt.receipt_value || 0);
    if (value <= 0) continue;

    const ownJournal = await db.prepare(`
      SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS inventory_value
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.status = 'POSTED' AND je.reference_type = 'PURCHASE'
        AND je.reference_id = ? AND coa.code = '1030'
    `).bind(receipt.id).first() as any;
    const ownValue = Number(ownJournal?.inventory_value || 0);
    if (Math.abs(ownValue - value) < 0.01) continue;
    if (Math.abs(ownValue) > 0.01) {
      exceptions.push({
        receipt_id: receipt.id,
        receipt_number: receipt.receipt_number,
        receipt_value: value,
        legacy_unallocated_value: ownValue,
      });
      continue;
    }

    if (!legacyRemaining.has(receipt.purchase_order_id)) {
      const legacy = await db.prepare(`
        SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS inventory_value
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
        JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE je.status = 'POSTED' AND je.reference_type = 'PURCHASE'
          AND je.reference_id = ? AND coa.code = '1030'
      `).bind(receipt.purchase_order_id).first() as any;
      legacyRemaining.set(receipt.purchase_order_id, Number(legacy?.inventory_value || 0));
    }

    const remainingLegacy = legacyRemaining.get(receipt.purchase_order_id) || 0;
    if (remainingLegacy >= value - 0.01) {
      legacyRemaining.set(receipt.purchase_order_id, remainingLegacy - value);
      coveredByLegacyEntries++;
      continue;
    }
    if (remainingLegacy > 0.01) {
      exceptions.push({
        receipt_id: receipt.id,
        receipt_number: receipt.receipt_number,
        receipt_value: value,
        legacy_unallocated_value: remainingLegacy,
      });
      continue;
    }

    const entryId = await createAndPostJournalEntry(c, {
      description: `Historical Goods Receipt #${receipt.receipt_number}`,
      referenceType: 'PURCHASE',
      referenceId: receipt.id,
      branchId: receipt.branch_id || null,
      entryDate: String(receipt.received_at).slice(0, 10),
      lines: [
        { accountCode: '1030', debitAmount: value, creditAmount: 0 },
        { accountCode: '2010', debitAmount: 0, creditAmount: value },
      ],
    });
    if (entryId) created++;
  }

  return { created, coveredByLegacyEntries, exceptions };
}

// ─── ASSETS & INVESTMENTS GL POSTING FUNCTIONS ──────────────────────────

export async function postPropertyPurchaseJournalEntry(c: any, amount: number, propertyName: string, propertyId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Purchase of Property: ${propertyName}`,
    referenceType: 'MANUAL',
    referenceId: propertyId,
    userId,
    lines: [
      { accountCode: '1040', debitAmount: amount, creditAmount: 0 },
      { accountCode: '1010', debitAmount: 0, creditAmount: amount },
    ],
  });
}

export async function postRentalPaymentJournalEntry(c: any, amount: number, tenantName: string, paymentId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Rental Payment Received from ${tenantName}`,
    referenceType: 'MANUAL',
    referenceId: paymentId,
    userId,
    lines: [
      { accountCode: '1010', debitAmount: amount, creditAmount: 0 },
      { accountCode: '4020', debitAmount: 0, creditAmount: amount },
    ],
  });
}

export async function postPropertyExpenseJournalEntry(c: any, amount: number, title: string, expenseId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Property Expense Paid: ${title}`,
    referenceType: 'MANUAL',
    referenceId: expenseId,
    userId,
    lines: [
      { accountCode: '6070', debitAmount: amount, creditAmount: 0 },
      { accountCode: '1010', debitAmount: 0, creditAmount: amount },
    ],
  });
}

export async function postSecurityDepositReceivedJournalEntry(c: any, amount: number, tenantName: string, leaseId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Security Deposit Received from ${tenantName}`,
    referenceType: 'MANUAL',
    referenceId: leaseId,
    userId,
    lines: [
      { accountCode: '1010', debitAmount: amount, creditAmount: 0 },
      { accountCode: '1060', debitAmount: 0, creditAmount: amount },
    ],
  });
}

export async function postSecurityDepositReturnedJournalEntry(c: any, amount: number, tenantName: string, leaseId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Security Deposit Returned to ${tenantName}`,
    referenceType: 'MANUAL',
    referenceId: leaseId,
    userId,
    lines: [
      { accountCode: '1060', debitAmount: amount, creditAmount: 0 },
      { accountCode: '1010', debitAmount: 0, creditAmount: amount },
    ],
  });
}

export async function postLivestockPurchaseJournalEntry(c: any, amount: number, description: string, livestockId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Purchase of Livestock: ${description}`,
    referenceType: 'MANUAL',
    referenceId: livestockId,
    userId,
    lines: [
      { accountCode: '1050', debitAmount: amount, creditAmount: 0 },
      { accountCode: '1010', debitAmount: 0, creditAmount: amount },
    ],
  });
}

export async function postLivestockSaleJournalEntry(c: any, revenue: number, cost: number, description: string, transactionId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Sale of Livestock: ${description}`,
    referenceType: 'MANUAL',
    referenceId: transactionId,
    userId,
    lines: [
      { accountCode: '1010', debitAmount: revenue, creditAmount: 0 },
      { accountCode: '4030', debitAmount: 0, creditAmount: revenue },
      { accountCode: '5040', debitAmount: cost, creditAmount: 0 },
      { accountCode: '1050', debitAmount: 0, creditAmount: cost },
    ],
  });
}

export async function postLivestockExpenseJournalEntry(c: any, amount: number, title: string, expenseId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Livestock Expense Paid: ${title}`,
    referenceType: 'MANUAL',
    referenceId: expenseId,
    userId,
    lines: [
      { accountCode: '6080', debitAmount: amount, creditAmount: 0 },
      { accountCode: '1010', debitAmount: 0, creditAmount: amount },
    ],
  });
}

export async function postLivestockDeathJournalEntry(c: any, costValue: number, description: string, transactionId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Livestock Loss/Death: ${description}`,
    referenceType: 'MANUAL',
    referenceId: transactionId,
    userId,
    lines: [
      { accountCode: '5040', debitAmount: costValue, creditAmount: 0 },
      { accountCode: '1050', debitAmount: 0, creditAmount: costValue },
    ],
  });
}

export async function postLivestockBirthJournalEntry(c: any, estimatedValue: number, description: string, transactionId: string, userId?: string) {
  return createAndPostJournalEntry(c, {
    description: `Livestock Birth: ${description}`,
    referenceType: 'MANUAL',
    referenceId: transactionId,
    userId,
    lines: [
      { accountCode: '1050', debitAmount: estimatedValue, creditAmount: 0 },
      { accountCode: '4030', debitAmount: 0, creditAmount: estimatedValue },
    ],
  });
}

export async function postPropertySaleJournalEntry(c: any, salePrice: number, bookValue: number, propertyName: string, propertyId: string, userId?: string) {
  const diff = salePrice - bookValue;
  const lines: JournalLineInput[] = [
    { accountCode: '1010', debitAmount: salePrice, creditAmount: 0 },
    { accountCode: '1040', debitAmount: 0, creditAmount: bookValue },
  ];
  if (diff > 0) {
    // Gain on sale
    lines.push({ accountCode: '4020', debitAmount: 0, creditAmount: diff });
  } else if (diff < 0) {
    // Loss on sale
    lines.push({ accountCode: '6070', debitAmount: Math.abs(diff), creditAmount: 0 });
  }
  return createAndPostJournalEntry(c, {
    description: `Sale of Property: ${propertyName}`,
    referenceType: 'MANUAL',
    referenceId: propertyId,
    userId,
    lines,
  });
}

// ─── NOTE: Why fiscal_period is not cached here ────────────────────────────────
// Posting to a closed or stale fiscal period silently corrupts financial reports.
// Unlike chart_of_accounts (which is essentially static config), fiscal periods
// transition on a known schedule (monthly). Caching would require explicit
// invalidation wired to the period-close/rollover workflow.
// Decision for app layer: if you want fiscal period caching, add it in the
// period-management route when status changes to 'CLOSED', and call
// invalidateFiscalPeriodCache() there. For now, it stays a live DB read.

export interface OpeningStockItem {
  productId: string;
  quantity: number;            // may be negative (more issued than ever recorded)
  unitCost: number;
  ownerType: 'BRANCH' | 'WAREHOUSE';
  warehouseId: string | null;
  branchId: string | null;
}

/**
 * Opening stock: record each quantity as an OPENING_STOCK movement and post its
 * value into the books — Dr 1030 Inventory / Cr 3010 Owner's Capital — one
 * balanced entry per branch (warehouse stock = company-level). Without this,
 * stock entered with a product had no value in the ledger, so selling it drove
 * Inventory negative.
 */
export async function prepareOpeningStock(
  c: any,
  items: OpeningStockItem[],
  userId: string | null,
  entryDate?: string
): Promise<any[]> {
  const db = c.env.DB;
  const stmts: any[] = [];
  const valueByBranch = new Map<string | null, number>();
  for (const it of items) {
    if (!it.quantity) continue;
    stmts.push(db.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_branch_id, reference_type, notes, created_by)
      VALUES (?, ?, 'OPENING_STOCK', ?, ?, ?, ?, 'OPENING_BALANCE', 'Opening stock', ?)
    `).bind(uuidv4(), it.productId, it.quantity, it.ownerType, it.warehouseId, it.branchId, userId));
    const key = it.ownerType === 'BRANCH' ? it.branchId : null;
    valueByBranch.set(key, (valueByBranch.get(key) || 0) + it.quantity * Number(it.unitCost || 0));
  }
  for (const [branchId, raw] of valueByBranch) {
    const value = Math.round(raw * 100) / 100;
    if (Math.abs(value) < 0.005) continue;
    const prepared = await prepareJournalEntryPosting(c, {
      description: 'Opening stock value',
      referenceType: 'OPENING',
      referenceId: uuidv4(),
      branchId,
      entryDate,
      userId,
      lines: value > 0
        ? [{ accountCode: '1030', debitAmount: value, creditAmount: 0 }, { accountCode: '3010', debitAmount: 0, creditAmount: value }]
        : [{ accountCode: '3010', debitAmount: -value, creditAmount: 0 }, { accountCode: '1030', debitAmount: 0, creditAmount: -value }],
    });
    stmts.push(...prepared.statements);
  }
  return stmts;
}
