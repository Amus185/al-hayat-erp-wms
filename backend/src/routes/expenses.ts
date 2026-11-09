import { resolveCashAccount, methodFor, cashCodeOf } from '../services/money';
import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { resolveBranchScope, resolveWriteBranch, branchSql, inScope } from '../services/branch-scope';
import { createAuditLogStmt } from '../services/audit';
import { prepareExpenseJournal, prepareJournalReversal } from '../services/accounting-service';
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
    SELECT e.*, b.name AS branch_name, u.full_name AS recorded_by_name, COALESCE(ma.name, 'Main Cash') AS money_account_name
    FROM expenses e
    LEFT JOIN money_accounts ma ON ma.id = e.money_account_id
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
expenses.post('/', requirePermissions(['expenses.manage']), async (c) => {
  const body = await c.req.json<{
    title: string;
    amount: number;
    category: string;
    expense_date: string;
    branch_id?: string;
    payment_method?: string;
    notes?: string;
    moneyAccountId?: string;
    money_account_id?: string;
  }>();

  if (!body.title?.trim()) return c.json({ message: 'Title is required.' }, 400);
  if (!body.amount || body.amount <= 0) return c.json({ message: 'Amount must be greater than 0.' }, 400);
  if (!body.category?.trim()) return c.json({ message: 'Category is required.' }, 400);
  if (!body.expense_date) return c.json({ message: 'Expense date is required.' }, 400);

  const payload = c.get('jwtPayload');
  const userId = payload.sub;
  // Branch scoping: branch users can only create expenses for their own branch
  const branchId = await resolveWriteBranch(c, body.branch_id);

  const id = uuidv4();
  // "Paid from": the Bank & Cash account of this branch (Main Cash when none was chosen).
  // An expense recorded as owed (payment_method CREDIT…) is not paid from any account.
  const owed = ['CREDIT', 'ON_ACCOUNT', 'UNPAID', 'PAYABLE'].includes(String(body.payment_method || '').toUpperCase());
  const cash = await resolveCashAccount(c.env.DB, owed ? undefined : (body.moneyAccountId ?? body.money_account_id), branchId ?? null);
  const method = owed ? String(body.payment_method).toUpperCase() : methodFor(cash, body.payment_method || 'CASH');

  const preparedJournal = await prepareExpenseJournal(c, {
    id, title: body.title.trim(), amount: body.amount, category: body.category.trim(),
    expense_date: body.expense_date, branch_id: branchId, payment_method: method, cash_code: cash.code,
  }, userId);

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO expenses (id, title, amount, category, expense_date, branch_id, payment_method, notes, recorded_by, money_account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, body.title.trim(), body.amount, body.category.trim(),
      body.expense_date, branchId,
      method, body.notes || null, userId, cash.id
    ),
    createAuditLogStmt(c, 'EXPENSE_CREATE', 'expenses', id, null, {
      title: body.title, amount: body.amount, category: body.category, branch_id: branchId
    }),
    ...preparedJournal.statements,
  ]);

  const row = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  return c.json(row, 201);
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

  if (!fields.length) return c.json({ message: 'No fields to update.' }, 400);
  if (body.amount !== undefined && !(Number(body.amount) > 0)) return c.json({ message: 'Amount must be greater than 0.' }, 400);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);

  const stmts: any[] = [c.env.DB.prepare(`UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`).bind(...vals)];

  // Financial fields changed: reverse the posted journal and post the new one.
  const ex = existing as any;
  const updated = { ...ex, ...body };
  const financialChange = ['amount', 'category', 'expense_date', 'branch_id', 'payment_method', 'money_account_id']
    .some((k) => (body as any)[k] !== undefined && String((body as any)[k]) !== String(ex[k]));
  if (financialChange) {
    const userId = c.get('jwtPayload').sub;
    const je = await c.env.DB.prepare(
      "SELECT id FROM journal_entries WHERE reference_type = 'EXPENSE' AND reference_id = ? AND status = 'POSTED' ORDER BY created_at DESC LIMIT 1"
    ).bind(id).first();
    if (je) stmts.push(...await prepareJournalReversal(c, je.id as string, `Expense ${ex.title} edited`, userId));
    const repost = await prepareExpenseJournal(c, {
      id, title: updated.title, amount: Number(updated.amount), category: updated.category,
      expense_date: updated.expense_date, branch_id: updated.branch_id, payment_method: updated.payment_method,
      cash_code: await cashCodeOf(c.env.DB, updated.money_account_id ?? null),
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

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id),
    createAuditLogStmt(c, 'EXPENSE_DELETE', 'expenses', id, existing, null),
    ...reversal,
  ]);
  return c.json({ success: true });
});

export default expenses;
