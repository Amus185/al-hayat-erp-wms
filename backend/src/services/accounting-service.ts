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
  const fp = await db
    .prepare("SELECT id FROM fiscal_periods WHERE status = 'OPEN' AND ? BETWEEN start_date AND end_date LIMIT 1")
    .bind(entryDate)
    .first()
    .catch(() => null);
  return (fp?.id as string) || null;
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
 * Creates a balanced Journal Entry, inserts its lines, and posts directly to
 * General Ledger.
 *
 * Optimized:
 * - Task 1a: Accepts pre-fetched fiscal period id (no SELECT if caller provides it)
 * - Task 1b: Accepts pre-fetched CoA map (no per-code SELECT if caller provides it)
 * - Task 2:  GL running_balance reads are consolidated into a single IN(?) query
 *            per entry (instead of one query per line). This is safe WITHIN a single
 *            entry because no single journal entry touches the same account twice.
 */
export async function createAndPostJournalEntry(
  c: any,
  params: PostJournalParams
): Promise<string | null> {
  const db = c.env.DB;
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

  // ── Task 2: Batch running_balance reads in a single IN(?) query ─────────────
  // Within a single journal entry, no two lines touch the same account,
  // so a single pre-fetch of all account balances is safe and correct.
  // (Cross-entry ordering correctness is handled by the caller: the second
  //  createAndPostJournalEntry runs after the first batch is committed.)
  const accountIds = resolvedLines.map((l) => l.accountId);
  const glPlaceholders = accountIds.map(() => '?').join(', ');

  const { results: glRows } = await db
    .prepare(
      `SELECT account_id, running_balance FROM general_ledger
       WHERE account_id IN (${glPlaceholders})
       AND id IN (
         SELECT id FROM general_ledger g2
         WHERE g2.account_id = general_ledger.account_id
         ORDER BY g2.created_at DESC LIMIT 1
       )`
    )
    .bind(...accountIds)
    .all()
    .catch(() => ({ results: [] as any[] }));

  // Build a map: accountId → latest running_balance
  const glBalanceMap = new Map<string, number>();
  for (const row of (glRows || []) as any[]) {
    glBalanceMap.set(row.account_id as string, Number(row.running_balance || 0));
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
 * DR: Purchases (5010)
 * CR: Accounts Payable (2010)
 */
export async function postPurchaseApprovalJournalEntry(
  c: any,
  po: { id: string; po_number: string; branch_id?: string },
  totalAmount: number,
  userId?: string
) {
  return createAndPostJournalEntry(c, {
    description: `Purchase Order Approved & Received #${po.po_number}`,
    referenceType: 'PURCHASE',
    referenceId: po.id,
    branchId: po.branch_id || null,
    userId,
    lines: [
      { accountCode: '5010', debitAmount: totalAmount, creditAmount: 0 },
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
 */
export async function postSaleJournalEntry(
  c: any,
  order: { id: string; order_number: string; branch_id?: string },
  totalAmount: number,
  userId?: string,
  prefetchedFiscalPeriodId?: string | null,
  prefetchedCoaMap?: Map<string, { id: string; normal_balance: string }>
) {
  return createAndPostJournalEntry(c, {
    description: `Sales Order Completed & Invoiced #${order.order_number}`,
    referenceType: 'SALE',
    referenceId: order.id,
    branchId: order.branch_id || null,
    userId,
    prefetchedFiscalPeriodId,
    prefetchedCoaMap,
    lines: [
      { accountCode: '1020', debitAmount: totalAmount, creditAmount: 0 },
      { accountCode: '4010', debitAmount: 0, creditAmount: totalAmount },
    ],
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
  return createAndPostJournalEntry(c, {
    description: `Customer Payment Received for Order #${order.order_number}`,
    referenceType: 'SALE',
    referenceId: order.id,
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
 * Journal Entry for Inventory Stock Adjustment
 * Positive adjustment (stock increase): DR Inventory (1030), CR Misc Expense/Adjustment Revenue (6050)
 * Negative adjustment (stock decrease): DR Misc Expense (6050), CR Inventory (1030)
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
          { accountCode: '6050', debitAmount: 0, creditAmount: estimatedCost },
        ]
      : [
          { accountCode: '6050', debitAmount: estimatedCost, creditAmount: 0 },
          { accountCode: '1030', debitAmount: 0, creditAmount: estimatedCost },
        ],
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
