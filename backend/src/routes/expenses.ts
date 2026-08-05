import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';
import { postExpenseJournalEntry } from '../services/accounting-service';

const expenses = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

expenses.use('/*', authMiddleware);

// ── GET /expenses ─────────────────────────────────────────
expenses.get('/', requirePermissions(['view_reports']), async (c) => {
  const { category, dateFrom, dateTo, branch_id } = c.req.query();
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  let query = `
    SELECT e.*, b.name AS branch_name, u.full_name AS recorded_by_name
    FROM expenses e
    LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN users u ON u.id = e.recorded_by
    WHERE 1=1
  `;
  const params: any[] = [];

  if (scopedBranchId) {
    query += ` AND e.branch_id = ?`;
    params.push(scopedBranchId);
  } else if (branch_id) {
    query += ` AND e.branch_id = ?`;
    params.push(branch_id);
  }

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
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  let query = `
    SELECT
      category,
      COUNT(*) AS count,
      COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE 1=1
  `;
  const params: any[] = [];

  if (scopedBranchId) { query += ` AND branch_id = ?`; params.push(scopedBranchId); }
  if (dateFrom) { query += ` AND expense_date >= ?`; params.push(dateFrom); }
  if (dateTo) { query += ` AND expense_date <= ?`; params.push(dateTo); }

  query += ` GROUP BY category ORDER BY total DESC`;

  const stmt = c.env.DB.prepare(query);
  const bound = params.length ? stmt.bind(...params) : stmt;
  const { results } = await bound.all();
  return c.json(results || []);
});

// ── POST /expenses ────────────────────────────────────────
expenses.post('/', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json<{
    title: string;
    amount: number;
    category: string;
    expense_date: string;
    branch_id?: string;
    payment_method?: string;
    notes?: string;
  }>();

  if (!body.title?.trim()) return c.json({ message: 'Title is required.' }, 400);
  if (!body.amount || body.amount <= 0) return c.json({ message: 'Amount must be greater than 0.' }, 400);
  if (!body.category?.trim()) return c.json({ message: 'Category is required.' }, 400);
  if (!body.expense_date) return c.json({ message: 'Expense date is required.' }, 400);

  const payload = c.get('jwtPayload');
  const userId = payload.sub;
  // Branch scoping: branch users can only create expenses for their own branch
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;
  const branchId = scopedBranchId || body.branch_id || null;

  const id = uuidv4();

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO expenses (id, title, amount, category, expense_date, branch_id, payment_method, notes, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, body.title.trim(), body.amount, body.category.trim(),
      body.expense_date, branchId,
      body.payment_method || 'CASH', body.notes || null, userId
    ),
    createAuditLogStmt(c, 'EXPENSE_CREATE', 'expenses', id, null, {
      title: body.title, amount: body.amount, category: body.category, branch_id: branchId
    }),
  ]);

  // Auto-post double-entry journal to Accounting (Must succeed or expense creation fails)
  await postExpenseJournalEntry(c, {
    id,
    title: body.title.trim(),
    amount: body.amount,
    category: body.category.trim(),
    expense_date: body.expense_date,
    branch_id: branchId || undefined,
  }, userId);

  const row = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

// ── PATCH /expenses/:id ───────────────────────────────────
expenses.patch('/:id', requirePermissions(['manage_purchasing']), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<Partial<{
    title: string; amount: number; category: string;
    expense_date: string; branch_id: string;
    payment_method: string; notes: string;
  }>>();

  const existing = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ message: 'Expense not found.' }, 404);

  const fields: string[] = [];
  const vals: any[] = [];

  if (body.title !== undefined) { fields.push('title = ?'); vals.push(body.title); }
  if (body.amount !== undefined) { fields.push('amount = ?'); vals.push(body.amount); }
  if (body.category !== undefined) { fields.push('category = ?'); vals.push(body.category); }
  if (body.expense_date !== undefined) { fields.push('expense_date = ?'); vals.push(body.expense_date); }
  if (body.branch_id !== undefined) { fields.push('branch_id = ?'); vals.push(body.branch_id); }
  if (body.payment_method !== undefined) { fields.push('payment_method = ?'); vals.push(body.payment_method); }
  if (body.notes !== undefined) { fields.push('notes = ?'); vals.push(body.notes); }

  if (!fields.length) return c.json({ message: 'No fields to update.' }, 400);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);

  await c.env.DB.prepare(`UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ── DELETE /expenses/:id ──────────────────────────────────
expenses.delete('/:id', requirePermissions(['manage_purchasing']), async (c) => {
  const { id } = c.req.param();
  const existing = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ message: 'Expense not found.' }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id),
    createAuditLogStmt(c, 'EXPENSE_DELETE', 'expenses', id, existing, null),
  ]);
  return c.json({ success: true });
});

export default expenses;
