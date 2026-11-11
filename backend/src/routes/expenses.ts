import { resolveCashAccount, methodFor, cashCodeOf, requireChosenAccount } from '../services/money';
import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { resolveBranchScope, resolveWriteBranch, branchSql, inScope, ScopeError } from '../services/branch-scope';
import { createAuditLogStmt } from '../services/audit';
import { prepareExpenseJournal, prepareJournalReversal, prepareJournalEntryPosting } from '../services/accounting-service';
import { csvResponse, likeTerm, listRequest, pagedResponse, pagedRows, type ListOptions } from '../services/listing';

const expenses = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

expenses.use('/*', authMiddleware);

// ── GET /expenses ─────────────────────────────────────────
const EXPENSE_LIST: ListOptions = {
  sortable: { date: 'expense_date', amount: 'amount', title: 'title', category: 'category', branch: 'branch_name', method: 'payment_method' },
  defaultSort: 'date', defaultDir: 'desc', tieBreaker: 'id',
};

expenses.get('/', requirePermissions(['view_reports']), async (c) => {
  const { category, dateFrom, dateTo, branch_id } = c.req.query();
  const payload = c.get('jwtPayload');
  const scope = await resolveBranchScope(c);

  let query = `
    SELECT e.*, b.name AS branch_name, u.full_name AS recorded_by_name, CASE WHEN e.payment_method IN ('CREDIT','ON_ACCOUNT','UNPAID','PAYABLE') THEN NULL ELSE COALESCE(ma.name, 'Main Cash') END AS money_account_name,
           ea.code AS expense_account_code, ea.name AS expense_account_name, cls.name AS class_name
    FROM expenses e
    LEFT JOIN accounting_classes cls ON cls.id = e.class_id
    LEFT JOIN money_accounts ma ON ma.id = e.money_account_id
    LEFT JOIN chart_of_accounts ea ON ea.id = e.expense_account_id
    LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN users u ON u.id = e.recorded_by
    WHERE 1=1
  `;
  const params: any[] = [];

  query += branchSql(scope, 'e.branch_id');

  if (category) {
    query += ` AND e.category = ?`;
    params.push(category);
  }
  if (dateFrom) {
    query += ` AND e.expense_date >= ?`;
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND e.expense_date <= ?`;
    params.push(dateTo);
  }

  const listReq = listRequest(c, EXPENSE_LIST);
  if (listReq.paged) {
    const q = (k: string) => (c.req.query(k) || '').trim();
    if (q('branchId') && scope.kind === 'ALL') { query += ` AND e.branch_id = ?`; params.push(q('branchId')); }
    if (q('method')) { query += ` AND e.payment_method = ?`; params.push(q('method')); }
    if (q('q')) {
      const t = likeTerm(q('q'));
      query += ` AND (e.title ILIKE ? OR COALESCE(e.notes, '') ILIKE ? OR e.category ILIKE ?)`;
      params.push(t, t, t);
    }
    const base = `FROM (${query}) x`;
    const { rows, total } = await pagedRows(c.env.DB, '*', base, params, listReq);
    if (listReq.csv) {
      return csvResponse(c, 'expenses', [
        { label: 'Date', value: (e: any) => String(e.expense_date instanceof Date ? e.expense_date.toISOString() : e.expense_date).slice(0, 10) },
        { label: 'Title', value: (e: any) => e.title },
        { label: 'Category', value: (e: any) => e.category },
        { label: 'Amount', value: (e: any) => Number(e.amount).toFixed(2) },
        { label: 'Payment method', value: (e: any) => e.payment_method },
        { label: 'Branch', value: (e: any) => e.branch_name },
        { label: 'Recorded by', value: (e: any) => e.recorded_by_name },
        { label: 'Notes', value: (e: any) => e.notes },
      ], rows);
    }
    const sum = await c.env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS n ${base}`).bind(...params).first() as any;
    const { results: cats } = await c.env.DB.prepare(`SELECT category, COALESCE(SUM(amount), 0) AS amount ${base} GROUP BY category ORDER BY 2 DESC`).bind(...params).all();
    return pagedResponse(c, listReq, rows, total, {
      totals: { amount: Math.round(Number(sum?.total || 0) * 100) / 100 },
      byCategory: ((cats || []) as any[]).map((r) => ({ category: r.category, amount: Math.round(Number(r.amount) * 100) / 100 })),
    });
  }

  query += ` ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 200`;

  const stmt = c.env.DB.prepare(query);
  const bound = params.length ? stmt.bind(...params) : stmt;
  const { results } = await bound.all();
  return c.json(results || []);
});

// ── GET /expenses/summary ─────────────────────────────────
expenses.get('/summary', requirePermissions(['view_reports']), async (c) => {
  const { dateFrom, dateTo } = c.req.query();
  const payload = c.get('jwtPayload');
  const scope = await resolveBranchScope(c);

  let query = `
    SELECT
      category,
      COUNT(*) AS count,
      COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE 1=1
  `;
  const params: any[] = [];

  query += branchSql(scope, 'branch_id');
  if (dateFrom) { query += ` AND expense_date >= ?`; params.push(dateFrom); }
  if (dateTo) { query += ` AND expense_date <= ?`; params.push(dateTo); }

  query += ` GROUP BY category ORDER BY total DESC`;

  const stmt = c.env.DB.prepare(query);
  const bound = params.length ? stmt.bind(...params) : stmt;
  const { results } = await bound.all();
  return c.json(results || []);
});

// ── POST /expenses ────────────────────────────────────────
const OWED = ['CREDIT', 'ON_ACCOUNT', 'UNPAID', 'PAYABLE'];
const isOwed = (m: unknown) => OWED.includes(String(m || '').toUpperCase());

// Accounts the system posts by itself (cost of goods sold, stock gains/losses, depreciation):
// never chosen by hand for an expense, or profit would be counted wrong.
const SYSTEM_EXPENSE = /^(5\d{3}|6060)$/;

/** An active EXPENSE account of the chart of accounts, by id; null when none was chosen. */
async function expenseAccount(db: any, id: unknown): Promise<{ id: string; code: string; name: string } | null> {
  if (typeof id !== 'string' || !id.trim()) return null;
  const acc = await db.prepare("SELECT id, code, name, account_type, is_active FROM chart_of_accounts WHERE id = ?").bind(id.trim()).first() as any;
  if (!acc || acc.account_type !== 'EXPENSE' || Number(acc.is_active) !== 1 || SYSTEM_EXPENSE.test(String(acc.code))) {
    throw new ScopeError(400, 'Choose an expense account from the chart of accounts.');
  }
  return { id: acc.id, code: String(acc.code), name: acc.name };
}

/** Validates one expense and prepares everything that saves it (row, audit, journal). */
async function buildExpense(c: any, body: any, userId: string, label = '') {
  const at = label ? `${label}: ` : '';
  if (!body.title?.trim()) throw new ScopeError(400, label ? `${at}a description is required.` : 'Title is required.');
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new ScopeError(400, label ? `${at}the amount must be greater than 0.` : 'Amount must be greater than 0.');
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(body.expense_date || ''))) throw new ScopeError(400, label ? `${at}the date is required.` : 'Expense date is required.');
  const account = await expenseAccount(c.env.DB, body.expenseAccountId ?? body.expense_account_id);
  const category = String(body.category || '').trim() || account?.name || '';
  if (!category) throw new ScopeError(400, label ? `${at}choose the expense account.` : 'Category is required.');
  // Branch scoping: branch users can only create expenses for their own branch
  const branchId = await resolveWriteBranch(c, body.branch_id);
  const id = uuidv4();
  // "Paid from": a Bank & Cash account of this branch (Main Cash when none was chosen).
  // An expense recorded as owed is not paid from any account yet (liability 2010).
  const owed = isOwed(body.payment_method);
  const cash = await resolveCashAccount(c.env.DB, owed ? undefined : (body.moneyAccountId ?? body.money_account_id), branchId ?? null);
  const method = owed ? 'UNPAID' : methodFor(cash, body.payment_method || 'CASH');
  // Class tracking: the chosen class, else the expense account's default class; required when management says so.
  let classId: string | null = typeof (body.classId ?? body.class_id) === 'string' && String(body.classId ?? body.class_id).trim() ? String(body.classId ?? body.class_id).trim() : null;
  if (classId && !(await c.env.DB.prepare('SELECT 1 FROM accounting_classes WHERE id = ? AND is_active = 1').bind(classId).first())) throw new ScopeError(400, `${at}that class does not exist.`);
  if (!classId && account) classId = ((await c.env.DB.prepare('SELECT default_class_id FROM chart_of_accounts WHERE id = ?').bind(account.id).first()) as any)?.default_class_id ?? null;
  if (!classId) {
    const req = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'class_required'").first() as any;
    if (req?.value === true || req?.value === 'true') throw new ScopeError(400, `${at}choose a class (management requires a class on every expense).`);
  }
  const journal = await prepareExpenseJournal(c, {
    id, title: body.title.trim(), amount, category, expense_date: body.expense_date, branch_id: branchId,
    payment_method: method, cash_code: cash.code, expense_code: account?.code ?? null, class_id: classId,
  }, userId);
  const stmts = [
    c.env.DB.prepare(`
      INSERT INTO expenses (id, title, amount, category, expense_date, branch_id, payment_method, notes, recorded_by, money_account_id, expense_account_id, reference, class_id, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${owed ? 'NULL' : 'CURRENT_TIMESTAMP'})
    `).bind(id, body.title.trim(), amount, category, body.expense_date, branchId, method, body.notes || null, userId,
      owed ? null : cash.id, account?.id ?? null, typeof body.reference === 'string' && body.reference.trim() ? body.reference.trim().slice(0, 120) : null, classId),
    createAuditLogStmt(c, 'EXPENSE_CREATE', 'expenses', id, null, { title: body.title, amount, category, branch_id: branchId, account: account?.code ?? null, owed }),
    ...journal.statements,
  ];
  return { id, stmts };
}

// Classes to choose from on an expense, and whether one is required.
expenses.get('/classes', requirePermissions(['expenses.manage']), async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name FROM accounting_classes WHERE is_active = 1 ORDER BY name').all();
  const s = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'class_required'").first() as any;
  return c.json({ classes: results || [], required: s?.value === true || s?.value === 'true' });
});

// Expense accounts to choose from (anyone who records expenses; the chart itself needs accounting access).
expenses.get('/accounts', requirePermissions(['expenses.manage']), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, code, name FROM chart_of_accounts WHERE account_type = 'EXPENSE' AND is_active = 1 ORDER BY code").all();
  return c.json(((results || []) as any[]).filter((a) => !SYSTEM_EXPENSE.test(String(a.code))));
});

expenses.post('/', requirePermissions(['expenses.manage']), async (c) => {
  const body = await c.req.json();
  const { id, stmts } = await buildExpense(c, body, c.get('jwtPayload').sub);
  await c.env.DB.batch(stmts);
  return c.json(await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first(), 201);
});

// Bulk entry (spreadsheet screen): every row is checked first, then all are saved together or none.
expenses.post('/bulk', requirePermissions(['expenses.manage']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return c.json({ message: 'Enter at least one expense.' }, 400);
  if (rows.length > 100) return c.json({ message: 'Save at most 100 expenses at a time.' }, 400);
  const userId = c.get('jwtPayload').sub;
  const all: any[] = []; const ids: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const built = await buildExpense(c, rows[i], userId, `Row ${i + 1}`);
    ids.push(built.id); all.push(...built.stmts);
  }
  await c.env.DB.batch(all);
  return c.json({ success: true, count: ids.length, ids }, 201);
});

// Pay an expense that was recorded as owed: Dr 2010 Accounts Payable / Cr the chosen account.
expenses.post('/:id/pay', requirePermissions(['expenses.manage']), async (c) => {
  const { id } = c.req.param();
  const ex = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first() as any;
  if (!ex || !inScope(await resolveBranchScope(c, 'ALL'), ex.branch_id)) return c.json({ message: 'Expense not found.' }, 404);
  if (!isOwed(ex.payment_method)) return c.json({ message: 'This expense is already paid.' }, 400);
  const body = await c.req.json().catch(() => ({}));
  requireChosenAccount(body.moneyAccountId ?? body.money_account_id, 'this expense');
  const cash = await resolveCashAccount(c.env.DB, body.moneyAccountId ?? body.money_account_id, ex.branch_id ?? null);
  const userId = c.get('jwtPayload').sub;
  const journal = await prepareJournalEntryPosting(c, {
    description: `Expense paid: ${ex.title}`, referenceType: 'EXPENSE', referenceId: `${id}:pay`,
    branchId: ex.branch_id || null, userId,
    lines: [
      { accountCode: '2010', debitAmount: Number(ex.amount), creditAmount: 0 },
      { accountCode: cash.code, debitAmount: 0, creditAmount: Number(ex.amount) },
    ],
  });
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE expenses SET payment_method = ?, money_account_id = ?, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_method = ?")
      .bind(methodFor(cash, 'CASH'), cash.id, id, ex.payment_method).mustAffect('This expense was just paid or changed. Please refresh.'),
    createAuditLogStmt(c, 'EXPENSE_PAY', 'expenses', id, { payment_method: ex.payment_method }, { paidFrom: cash.name, amount: ex.amount }),
    ...journal.statements,
  ]);
  return c.json(await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first());
});

// ── PATCH /expenses/:id ───────────────────────────────────
expenses.patch('/:id', requirePermissions(['expenses.manage']), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<Partial<{
    title: string; amount: number; category: string;
    expense_date: string; branch_id: string;
    payment_method: string; notes: string; moneyAccountId: string | null; money_account_id: string | null;
  }>>();

  const existing = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  if (!existing || !inScope(await resolveBranchScope(c, 'ALL'), (existing as any).branch_id)) return c.json({ message: 'Expense not found.' }, 404);

  const fields: string[] = [];
  const vals: any[] = [];

  if (body.title !== undefined) { fields.push('title = ?'); vals.push(body.title); }
  if (body.amount !== undefined) { fields.push('amount = ?'); vals.push(body.amount); }
  if (body.category !== undefined) { fields.push('category = ?'); vals.push(body.category); }
  if (body.expense_date !== undefined) { fields.push('expense_date = ?'); vals.push(body.expense_date); }
  if (body.branch_id !== undefined) { body.branch_id = (await resolveWriteBranch(c, body.branch_id)) as any; fields.push('branch_id = ?'); vals.push(body.branch_id); }
  if (body.payment_method !== undefined) { fields.push('payment_method = ?'); vals.push(body.payment_method); }
  // Changing the "Paid from" account (checked against the expense's branch).
  const newAccount = body.moneyAccountId !== undefined ? body.moneyAccountId : body.money_account_id;
  if (newAccount !== undefined) {
    const branchForCheck = body.branch_id !== undefined ? body.branch_id : (existing as any).branch_id;
    const acc = await resolveCashAccount(c.env.DB, newAccount || undefined, branchForCheck ?? null);
    (body as any).money_account_id = acc.id;
    fields.push('money_account_id = ?'); vals.push(acc.id);
    if (acc.id && body.payment_method === undefined) { fields.push('payment_method = ?'); vals.push(methodFor(acc, 'CASH')); (body as any).payment_method = methodFor(acc, 'CASH'); }
  } else if (body.branch_id !== undefined && (existing as any).money_account_id) {
    // Moving the expense to another branch: its account must still fit.
    await resolveCashAccount(c.env.DB, (existing as any).money_account_id, body.branch_id ?? null);
  }
  if (body.notes !== undefined) { fields.push('notes = ?'); vals.push(body.notes); }
  const newExpAcc = (body as any).expenseAccountId !== undefined ? (body as any).expenseAccountId : (body as any).expense_account_id;
  if (newExpAcc !== undefined) {
    const acc = await expenseAccount(c.env.DB, newExpAcc || undefined);
    (body as any).expense_account_id = acc?.id ?? null;
    fields.push('expense_account_id = ?'); vals.push(acc?.id ?? null);
  }

  if ((body as any).classId !== undefined) {
    const cid = (body as any).classId ? String((body as any).classId) : null;
    if (cid && !(await c.env.DB.prepare('SELECT 1 FROM accounting_classes WHERE id = ?').bind(cid).first())) return c.json({ message: 'That class does not exist.' }, 400);
    (body as any).class_id = cid; fields.push('class_id = ?'); vals.push(cid);
  }

  if (!fields.length) return c.json({ message: 'No fields to update.' }, 400);
  if (body.amount !== undefined && !(Number(body.amount) > 0)) return c.json({ message: 'Amount must be greater than 0.' }, 400);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);

  const stmts: any[] = [c.env.DB.prepare(`UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`).bind(...vals)];

  // Financial fields changed: reverse the posted journal and post the new one.
  const ex = existing as any;
  const updated = { ...ex, ...body };
  const financialChange = ['amount', 'category', 'expense_date', 'branch_id', 'payment_method', 'money_account_id', 'expense_account_id', 'class_id']
    .some((k) => (body as any)[k] !== undefined && String((body as any)[k]) !== String(ex[k]));
  if (financialChange) {
    const userId = c.get('jwtPayload').sub;
    const je = await c.env.DB.prepare(
      "SELECT id FROM journal_entries WHERE reference_type = 'EXPENSE' AND reference_id = ? AND status = 'POSTED' ORDER BY created_at DESC LIMIT 1"
    ).bind(id).first();
    if (je) stmts.push(...await prepareJournalReversal(c, je.id as string, `Expense ${ex.title} edited`, userId));
    // An owed expense that was paid later has a second entry (payable → cash): undo it too; the re-post below pays from the account directly.
    const payJe = await c.env.DB.prepare("SELECT id FROM journal_entries WHERE reference_type = 'EXPENSE' AND reference_id = ? AND status = 'POSTED' LIMIT 1").bind(`${id}:pay`).first();
    if (payJe) stmts.push(...await prepareJournalReversal(c, payJe.id as string, `Expense ${ex.title} edited`, userId));
    const accRow = updated.expense_account_id ? await c.env.DB.prepare('SELECT code FROM chart_of_accounts WHERE id = ?').bind(updated.expense_account_id).first() as any : null;
    (updated as any).__expense_code = accRow?.code ? String(accRow.code) : null;
    const repost = await prepareExpenseJournal(c, {
      id, title: updated.title, amount: Number(updated.amount), category: updated.category,
      expense_date: updated.expense_date, branch_id: updated.branch_id, payment_method: updated.payment_method,
      cash_code: await cashCodeOf(c.env.DB, updated.money_account_id ?? null), expense_code: (updated as any).__expense_code, class_id: updated.class_id ?? null,
    }, userId, true);
    stmts.push(...repost.statements);
  }
  stmts.push(createAuditLogStmt(c, 'EXPENSE_UPDATE', 'expenses', id, existing, body));

  await c.env.DB.batch(stmts);
  const row = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ── DELETE /expenses/:id ──────────────────────────────────
expenses.delete('/:id', requirePermissions(['expenses.manage']), async (c) => {
  const { id } = c.req.param();
  const existing = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  if (!existing || !inScope(await resolveBranchScope(c, 'ALL'), (existing as any).branch_id)) return c.json({ message: 'Expense not found.' }, 404);

  const je = await c.env.DB.prepare(
    "SELECT id FROM journal_entries WHERE reference_type = 'EXPENSE' AND reference_id = ? AND status = 'POSTED' ORDER BY created_at DESC LIMIT 1"
  ).bind(id).first();
  const reversal = je
    ? await prepareJournalReversal(c, je.id as string, `Expense ${(existing as any).title} deleted`, c.get('jwtPayload').sub)
    : [];
  const payJe = await c.env.DB.prepare("SELECT id FROM journal_entries WHERE reference_type = 'EXPENSE' AND reference_id = ? AND status = 'POSTED' LIMIT 1").bind(`${id}:pay`).first();
  if (payJe) reversal.push(...await prepareJournalReversal(c, payJe.id as string, `Expense ${(existing as any).title} deleted`, c.get('jwtPayload').sub));

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id),
    createAuditLogStmt(c, 'EXPENSE_DELETE', 'expenses', id, existing, null),
    ...reversal,
  ]);
  return c.json({ success: true });
});

export default expenses;
