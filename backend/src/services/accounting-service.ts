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
}

/**
 * Ensures account existence or fetches account ID by code.
 */
export async function getAccountIdByCode(db: any, code: string): Promise<{ id: string; normal_balance: string } | null> {
  const account = await db.prepare('SELECT id, normal_balance FROM chart_of_accounts WHERE code = ?').bind(code).first();
  if (account) {
    return { id: account.id as string, normal_balance: (account.normal_balance as string) || 'DEBIT' };
  }
  // Try fallback ID prefix format e.g. coa-1010
  const fallbackAccount = await db.prepare('SELECT id, normal_balance FROM chart_of_accounts WHERE id = ?').bind(`coa-${code}`).first();
  if (fallbackAccount) {
    return { id: fallbackAccount.id as string, normal_balance: (fallbackAccount.normal_balance as string) || 'DEBIT' };
  }
  return null;
}

/**
 * Creates a balanced Journal Entry, inserts its lines, and posts directly to General Ledger.
 */
export async function createAndPostJournalEntry(c: any, params: PostJournalParams): Promise<string | null> {
  const db = c.env.DB;
  const entryDate = params.entryDate || new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const entryId = uuidv4();
  const entryNumber = `JE-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

  // Find active fiscal period if available
  const fiscalPeriod = await db.prepare(
    "SELECT id FROM fiscal_periods WHERE status = 'OPEN' AND ? BETWEEN start_date AND end_date LIMIT 1"
  ).bind(entryDate).first().catch(() => null);

  const fiscalPeriodId = (fiscalPeriod?.id as string) || null;

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
    const acc = await getAccountIdByCode(db, line.accountCode);
    if (!acc) {
      console.warn(`Accounting Service: Account code ${line.accountCode} not found in chart_of_accounts. Skipping entry.`);
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

  const stmts: any[] = [];

  // 1. Insert Journal Entry (status = 'POSTED')
  stmts.push(db.prepare(`
    INSERT INTO journal_entries (
      id, entry_number, fiscal_period_id, entry_date, description,
      reference_type, reference_id, branch_id, status,
      total_debit, total_credit, created_by, posted_by, posted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entryId, entryNumber, fiscalPeriodId, entryDate, params.description,
    params.referenceType, params.referenceId || null, params.branchId || null,
    totalDebit, totalCredit, params.userId || null, params.userId || null, now, now, now
  ));

  // 2. Insert Journal Entry Lines & General Ledger entries
  for (const line of resolvedLines) {
    stmts.push(db.prepare(`
      INSERT INTO journal_entry_lines (
        id, journal_entry_id, account_id, description, debit_amount, credit_amount, branch_id, line_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      line.lineId, entryId, line.accountId, line.description, line.debitAmount, line.creditAmount, line.branchId, line.lineOrder
    ));

    // Calculate running balance for GL
    const lastGl = await db.prepare(`
      SELECT running_balance FROM general_ledger
      WHERE account_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(line.accountId).first().catch(() => null);

    let runningBalance = Number(lastGl?.running_balance || 0);
    if (line.normalBalance === 'DEBIT') {
      runningBalance += (line.debitAmount - line.creditAmount);
    } else {
      runningBalance += (line.creditAmount - line.debitAmount);
    }

    const glId = uuidv4();
    stmts.push(db.prepare(`
      INSERT INTO general_ledger (
        id, account_id, journal_entry_id, line_id, entry_date, description,
        debit_amount, credit_amount, running_balance, branch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      glId, line.accountId, entryId, line.lineId, entryDate, line.description,
      line.debitAmount, line.creditAmount, runningBalance, line.branchId
    ));
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
  userId?: string
) {
  return createAndPostJournalEntry(c, {
    description: `Sales Order Completed & Invoiced #${order.order_number}`,
    referenceType: 'SALE',
    referenceId: order.id,
    branchId: order.branch_id || null,
    userId,
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
  userId?: string
) {
  return createAndPostJournalEntry(c, {
    description: `Customer Payment Received for Order #${order.order_number}`,
    referenceType: 'SALE',
    referenceId: order.id,
    entryDate: payment.paymentDate,
    branchId: order.branch_id || null,
    userId,
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
  adjustment: { id: string; productId: string; quantity: number; direction: 'INCREASE' | 'DECREASE'; unitCost?: number; branchId?: string },
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
    lines: isIncrease ? [
      { accountCode: '1030', debitAmount: estimatedCost, creditAmount: 0 },
      { accountCode: '6050', debitAmount: 0, creditAmount: estimatedCost },
    ] : [
      { accountCode: '6050', debitAmount: estimatedCost, creditAmount: 0 },
      { accountCode: '1030', debitAmount: 0, creditAmount: estimatedCost },
    ],
  });
}
