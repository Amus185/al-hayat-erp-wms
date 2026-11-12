// Roadmap wave 4 (HR & payroll): attendance (22), commissions (23) and payroll runs (24).
//
// Accounting of a payroll run (one entry when the run is approved, lines per employee's branch):
//   Dr 6090 Salaries & Wages   basic − absence deduction + additions − other deductions
//   Dr 6095 Sales Commissions  commission
//   Cr 1080 Employee Advances  advances taken back from the salary
//   Cr 2060 Salaries Payable   net pay
// Paying it: Dr 2060 Salaries Payable / Cr the chosen Bank & Cash account.
import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';
import { prepareJournalEntryPosting } from '../services/accounting-service';
import { resolveCashAccount, requireChosenAccount } from '../services/money';
import { has, PERM } from '../services/privacy';
import { hasAllBranchAccess, ScopeError } from '../services/branch-scope';
import { sellerSales, COUNTED_SALE, dayOf } from '../services/sales-rules';

const hr = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();
hr.use('/*', authMiddleware);

const r2 = (n: number) => Math.round(n * 100) / 100;
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isPeriod = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const text = (v: unknown, max: number) => { const s = v === undefined || v === null ? '' : String(v).trim(); return s ? s.slice(0, max) : null; };
const monthEnds = (p: string) => { const [y, m] = p.split('-').map(Number); return { from: `${p}-01`, to: `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }; };
const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'LEAVE'];
const KINDS = ['PERCENT_REVENUE', 'FIXED_PER_SALE', 'PERCENT_PRODUCT', 'FIXED_PER_UNIT'];

const payload = (c: any) => c.get('jwtPayload');
/** Branch the caller is limited to (null = all branches). */
function ownBranch(c: any): string | null {
  const p = payload(c);
  if (hasAllBranchAccess(p)) return null;
  if (!p?.branch_id) throw new ScopeError(403, 'Your account is not assigned to a branch.');
  return p.branch_id;
}
const canAttendance = (c: any) => { const p = payload(c); if (!(has(p, 'manage_users') || has(p, PERM.EMPLOYEES_MANAGE) || has(p, PERM.PAYROLL_MANAGE))) throw new ScopeError(403, 'Recording attendance needs employee or payroll access.'); };
const canPayrollView = (c: any) => { if (!has(payload(c), PERM.PAYROLL_VIEW)) throw new ScopeError(403, 'This needs payroll access.'); };
const canPayroll = (c: any) => { if (!has(payload(c), PERM.PAYROLL_MANAGE)) throw new ScopeError(403, 'This needs payroll access.'); };
const companyPayroll = (c: any) => { canPayroll(c); if (!hasAllBranchAccess(payload(c))) throw new ScopeError(403, 'Payroll runs are made by the Owner or an accountant for the whole company.'); };
const branchFilter = (c: any, col: string) => { const b = ownBranch(c); return b ? { sql: ` AND ${col} = ?`, binds: [b] } : { sql: '', binds: [] as string[] }; };

// ── 22. Attendance ──
hr.get('/attendance', async (c) => {
  canAttendance(c);
  const date = isDate(c.req.query('date')) ? c.req.query('date')! : new Date().toISOString().slice(0, 10);
  const f = branchFilter(c, 'e.branch_id');
  const { results } = await c.env.DB.prepare(`
    SELECT e.id AS employee_id, e.full_name, e.position, e.branch_id, b.name AS branch_name,
           a.status, a.check_in, a.check_out, a.late_minutes, a.notes
    FROM employees e LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN employee_attendance a ON a.employee_id = e.id AND a.work_date = ?::date
    WHERE e.status = 'ACTIVE' ${f.sql} ORDER BY b.name NULLS FIRST, e.full_name`).bind(date, ...f.binds).all();
  return c.json({ date, rows: results || [] });
});
hr.put('/attendance', async (c) => {
  canAttendance(c);
  const body = await c.req.json().catch(() => ({}));
  if (!isDate(body.date)) return c.json({ message: 'Choose the day.' }, 400);
  if (body.date > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) return c.json({ message: 'Attendance cannot be recorded for a future day.' }, 400);
  const rows = Array.isArray(body.records) ? body.records : [];
  if (!rows.length) return c.json({ message: 'Mark at least one employee.' }, 400);
  const branch = ownBranch(c);
  const ids = Array.from(new Set(rows.map((r: any) => String(r.employeeId || ''))));
  const { results: emps } = await c.env.DB.prepare(`SELECT id, branch_id FROM employees WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all();
  const known = new Map<string, any>(((emps || []) as any[]).map((e) => [e.id, e]));
  const userId = payload(c).sub; const stmts: any[] = []; let saved = 0;
  for (const r of rows) {
    const e = known.get(String(r.employeeId || ''));
    if (!e || (branch && e.branch_id !== branch)) return c.json({ message: 'One of the employees is not in your branch.' }, 403);
    if (!r.status) { stmts.push(c.env.DB.prepare('DELETE FROM employee_attendance WHERE employee_id = ? AND work_date = ?::date').bind(e.id, body.date)); continue; }
    const status = String(r.status).toUpperCase();
    if (!STATUSES.includes(status)) return c.json({ message: 'Attendance is Present, Late, Absent or Leave.' }, 400);
    const time = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
    const late = status === 'LATE' ? Math.max(0, Math.min(600, Math.round(Number(r.lateMinutes) || 0))) : 0;
    stmts.push(c.env.DB.prepare(`
      INSERT INTO employee_attendance (id, employee_id, work_date, status, check_in, check_out, late_minutes, notes, recorded_by)
      VALUES (?, ?, ?::date, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (employee_id, work_date) DO UPDATE SET status = EXCLUDED.status, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
        late_minutes = EXCLUDED.late_minutes, notes = EXCLUDED.notes, recorded_by = EXCLUDED.recorded_by, updated_at = CURRENT_TIMESTAMP`)
      .bind(uuidv4(), e.id, body.date, status, time(r.checkIn), time(r.checkOut), late, text(r.notes, 200), userId));
    saved++;
  }
  stmts.push(createAuditLogStmt(c, 'ATTENDANCE_RECORD', 'employee_attendance', body.date, null, { date: body.date, records: rows.length }));
  await c.env.DB.batch(stmts);
  return c.json({ saved });
});
// Days per status for each employee in a month.
hr.get('/attendance/summary', async (c) => {
  canAttendance(c);
  const period = isPeriod(c.req.query('period')) ? c.req.query('period')! : new Date().toISOString().slice(0, 7);
  const { from, to } = monthEnds(period);
  const f = branchFilter(c, 'e.branch_id');
  const { results } = await c.env.DB.prepare(`
    SELECT e.id AS employee_id, e.full_name, b.name AS branch_name,
      COUNT(*) FILTER (WHERE a.status = 'PRESENT')::int AS present, COUNT(*) FILTER (WHERE a.status = 'LATE')::int AS late,
      COUNT(*) FILTER (WHERE a.status = 'ABSENT')::int AS absent, COUNT(*) FILTER (WHERE a.status = 'LEAVE')::int AS leave,
      COALESCE(SUM(a.late_minutes), 0)::int AS late_minutes
    FROM employees e LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN employee_attendance a ON a.employee_id = e.id AND a.work_date BETWEEN ?::date AND ?::date
    WHERE e.status = 'ACTIVE' ${f.sql} GROUP BY e.id, e.full_name, b.name ORDER BY e.full_name`).bind(from, to, ...f.binds).all();
  return c.json({ period, rows: results || [] });
});

// The system user an employee sells as (for commissions and performance).
hr.put('/employees/:id/user', async (c) => {
  canPayroll(c);
  const body = await c.req.json().catch(() => ({}));
  const userId = text(body.userId, 80);
  const e = await c.env.DB.prepare('SELECT id, full_name, branch_id, user_id FROM employees WHERE id = ?').bind(c.req.param('id')).first() as any;
  const branch = ownBranch(c);
  if (!e || (branch && e.branch_id !== branch)) return c.json({ message: 'Employee not found.' }, 404);
  if (userId) {
    if (!(await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first())) return c.json({ message: 'That user does not exist.' }, 400);
    const other = await c.env.DB.prepare('SELECT full_name FROM employees WHERE user_id = ? AND id <> ?').bind(userId, e.id).first() as any;
    if (other) return c.json({ message: `That user is already linked to ${other.full_name}.` }, 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE employees SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(userId, e.id),
    createAuditLogStmt(c, 'EMPLOYEE_USER_LINK', 'employees', e.id, { user_id: e.user_id }, { user_id: userId }),
  ]);
  return c.json({ ok: true });
});
hr.get('/users', async (c) => {
  canPayrollView(c);
  const { results } = await c.env.DB.prepare(`SELECT u.id, u.full_name, u.email, b.name AS branch_name, (SELECT e.id FROM employees e WHERE e.user_id = u.id LIMIT 1) AS employee_id
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.is_active = 1 ORDER BY u.full_name`).all();
  return c.json({ users: results || [] });
});

// ── 23. Commission rules ──
hr.get('/commission-rules', async (c) => {
  canPayrollView(c);
  const { results } = await c.env.DB.prepare(`
    SELECT r.*, e.full_name AS employee_name, p.name AS product_name FROM commission_rules r
    LEFT JOIN employees e ON e.id = r.employee_id LEFT JOIN products p ON p.id = r.product_id
    ORDER BY r.is_active DESC, e.full_name NULLS FIRST, r.created_at`).all();
  return c.json({ rules: ((results || []) as any[]).map((r) => ({ ...r, rate: Number(r.rate) })) });
});
hr.post('/commission-rules', async (c) => {
  canPayroll(c);
  if (!hasAllBranchAccess(payload(c))) return c.json({ message: 'Commission rules are set by the Owner or an accountant.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const kind = String(body.kind || '').toUpperCase();
  if (!KINDS.includes(kind)) return c.json({ message: 'Choose how the commission is counted.' }, 400);
  const rate = Number(body.rate);
  if (!Number.isFinite(rate) || rate <= 0 || (kind.startsWith('PERCENT') && rate > 100)) return c.json({ message: kind.startsWith('PERCENT') ? 'The percentage must be between 0 and 100.' : 'The amount must be more than 0.' }, 400);
  const employeeId = text(body.employeeId, 80);
  if (employeeId && !(await c.env.DB.prepare('SELECT 1 FROM employees WHERE id = ?').bind(employeeId).first())) return c.json({ message: 'Employee not found.' }, 400);
  const productId = kind.endsWith('PRODUCT') || kind === 'FIXED_PER_UNIT' ? text(body.productId, 80) : null;
  if ((kind === 'PERCENT_PRODUCT' || kind === 'FIXED_PER_UNIT') && !productId) return c.json({ message: 'Choose the product.' }, 400);
  if (productId && !(await c.env.DB.prepare('SELECT 1 FROM products WHERE id = ?').bind(productId).first())) return c.json({ message: 'Product not found.' }, 400);
  const id = uuidv4();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO commission_rules (id, employee_id, kind, rate, product_id, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(id, employeeId, kind, rate, productId, payload(c).sub),
    createAuditLogStmt(c, 'COMMISSION_RULE_CREATE', 'commission_rules', id, null, { employeeId, kind, rate, productId }),
  ]);
  return c.json({ id }, 201);
});
hr.patch('/commission-rules/:id', async (c) => {
  canPayroll(c);
  if (!hasAllBranchAccess(payload(c))) return c.json({ message: 'Commission rules are set by the Owner or an accountant.' }, 403);
  const old = await c.env.DB.prepare('SELECT * FROM commission_rules WHERE id = ?').bind(c.req.param('id')).first() as any;
  if (!old) return c.json({ message: 'Rule not found.' }, 404);
  const body = await c.req.json().catch(() => ({}));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE commission_rules SET is_active = ? WHERE id = ?').bind(body.is_active ? 1 : 0, old.id),
    createAuditLogStmt(c, 'COMMISSION_RULE_UPDATE', 'commission_rules', old.id, old, { is_active: !!body.is_active }),
  ]);
  return c.json({ ok: true });
});

/** Commission of each employee for a month (cancelled sales do not count; returns are taken off). */
async function commissions(db: any, period: string, employeeIds?: string[]) {
  const { from, to } = monthEnds(period);
  const [{ results: rules }, { results: emps }, sellers] = await Promise.all([
    db.prepare('SELECT * FROM commission_rules WHERE is_active = 1').all(),
    db.prepare("SELECT id, full_name, user_id, branch_id FROM employees WHERE status = 'ACTIVE' AND user_id IS NOT NULL").all(),
    sellerSales(db, from, to),
  ]) as any[];
  const out = new Map<string, { total: number; parts: { label: string; amount: number }[] }>();
  const active = ((rules || []) as any[]);
  if (!active.length) return out;
  const productRules = active.filter((r) => r.product_id);
  let units = new Map<string, number>(), revenue = new Map<string, number>();
  if (productRules.length) {
    const pids = Array.from(new Set(productRules.map((r) => r.product_id)));
    const { results } = await db.prepare(`
      SELECT so.created_by AS user_id, sol.product_id,
        SUM(sol.quantity) - COALESCE((SELECT SUM(srl.quantity) FROM sales_return_lines srl JOIN sales_returns sr ON sr.id = srl.return_id WHERE sr.sales_order_id = so.id AND srl.product_id = sol.product_id), 0) AS units,
        SUM(sol.line_total) - COALESCE((SELECT SUM(srl.line_value) FROM sales_return_lines srl JOIN sales_returns sr ON sr.id = srl.return_id WHERE sr.sales_order_id = so.id AND srl.product_id = sol.product_id), 0) AS revenue
      FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.sales_order_id JOIN invoices i ON i.sales_order_id = so.id
      WHERE ${COUNTED_SALE} AND ${dayOf('i.issued_at')} BETWEEN ?::date AND ?::date AND sol.product_id IN (${pids.map(() => '?').join(', ')})
      GROUP BY so.created_by, sol.product_id, so.id`).bind(from, to, ...pids).all();
    units = new Map(); revenue = new Map();
    for (const r of (results || []) as any[]) {
      const k = `${r.user_id}|${r.product_id}`;
      units.set(k, (units.get(k) || 0) + Number(r.units)); revenue.set(k, (revenue.get(k) || 0) + Number(r.revenue));
    }
  }
  const bySeller = new Map<string, any>((sellers as any[]).map((s) => [s.user_id, s]));
  for (const e of (emps || []) as any[]) {
    if (employeeIds && !employeeIds.includes(e.id)) continue;
    const s = bySeller.get(e.user_id) || { net: 0, sales: 0 };
    const parts: { label: string; amount: number }[] = [];
    for (const r of active) {
      if (r.employee_id && r.employee_id !== e.id) continue;
      const rate = Number(r.rate); let amount = 0; let label = '';
      if (r.kind === 'PERCENT_REVENUE') { amount = Math.max(0, s.net) * rate / 100; label = `${rate}% of net sales ${r2(s.net).toFixed(2)}`; }
      if (r.kind === 'FIXED_PER_SALE') { amount = s.sales * rate; label = `${rate.toFixed(2)} × ${s.sales} sales`; }
      if (r.kind === 'PERCENT_PRODUCT') { const v = Math.max(0, revenue.get(`${e.user_id}|${r.product_id}`) || 0); amount = v * rate / 100; label = `${rate}% of product sales ${r2(v).toFixed(2)}`; }
      if (r.kind === 'FIXED_PER_UNIT') { const u = Math.max(0, units.get(`${e.user_id}|${r.product_id}`) || 0); amount = u * rate; label = `${rate.toFixed(2)} × ${u} units`; }
      if (amount > 0.004) parts.push({ label, amount: r2(amount) });
    }
    if (parts.length) out.set(e.id, { total: r2(parts.reduce((a, p) => a + p.amount, 0)), parts });
  }
  return out;
}
hr.get('/commissions', async (c) => {
  canPayrollView(c);
  const period = isPeriod(c.req.query('period')) ? c.req.query('period')! : new Date().toISOString().slice(0, 7);
  const f = branchFilter(c, 'e.branch_id');
  const { results: emps } = await c.env.DB.prepare(`SELECT e.id, e.full_name, e.user_id, b.name AS branch_name FROM employees e LEFT JOIN branches b ON b.id = e.branch_id WHERE e.status = 'ACTIVE' ${f.sql} ORDER BY e.full_name`).bind(...f.binds).all();
  const map = await commissions(c.env.DB, period);
  return c.json({ period, rows: ((emps || []) as any[]).map((e) => ({ employee_id: e.id, full_name: e.full_name, branch_name: e.branch_name, linked: !!e.user_id, total: map.get(e.id)?.total || 0, parts: map.get(e.id)?.parts || [] })) });
});

// ── 24. Payroll runs ──
/** The books are kept per branch: one journal entry per branch of the employees. */
async function postByBranch(c: any, lines: any[], p: { description: string; ref: string; entryDate?: string; userId: string }) {
  const groups = new Map<string, any[]>();
  for (const l of lines) { const k = l.branchId || ''; groups.set(k, [...(groups.get(k) || []), l]); }
  const entries = new Map<string, string | null>(); const statements: any[] = [];
  for (const [k, ls] of groups) {
    const posting = await prepareJournalEntryPosting(c, { description: p.description, referenceType: 'PAYROLL', referenceId: `${p.ref}:${k || 'company'}`, branchId: k || null, entryDate: p.entryDate, userId: p.userId, lines: ls });
    if (!posting.statements.length) throw new ScopeError(400, 'The payroll accounts (6090, 6095, 2060, 1080) were not found in the chart of accounts.');
    entries.set(k, posting.entryId); statements.push(...posting.statements);
  }
  return { entries, statements };
}
async function buildLines(db: any, runId: string, period: string, workingDays: number) {
  const { from, to } = monthEnds(period);
  const [{ results: emps }, comm] = await Promise.all([
    db.prepare(`
      SELECT e.id, e.full_name, e.branch_id, COALESCE(e.salary, 0) AS salary,
        (SELECT COUNT(*)::int FROM employee_attendance a WHERE a.employee_id = e.id AND a.status = 'ABSENT' AND a.work_date BETWEEN ?::date AND ?::date) AS absent_days,
        (SELECT COALESCE(SUM(CASE WHEN kind = 'ADVANCE' THEN amount ELSE -amount END), 0) FROM employee_advances ea WHERE ea.employee_id = e.id) AS advance_balance
      FROM employees e WHERE e.status = 'ACTIVE' ORDER BY e.full_name`).bind(from, to).all(),
    commissions(db, period),
  ]) as any[];
  const stmts: any[] = [];
  for (const e of (emps || []) as any[]) {
    const basic = r2(Number(e.salary)); const commission = comm.get(e.id)?.total || 0;
    if (basic <= 0 && commission <= 0) continue;
    const absent = Number(e.absent_days || 0);
    const deduction = r2(Math.min(basic, (basic / Math.max(1, workingDays)) * absent));
    const gross = r2(basic - deduction + commission);
    const advance = r2(Math.max(0, Math.min(Number(e.advance_balance || 0), gross)));
    stmts.push(db.prepare(`INSERT INTO payroll_lines (id, run_id, employee_id, branch_id, basic, absent_days, attendance_deduction, commission, advance_deduction, net, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(uuidv4(), runId, e.id, e.branch_id ?? null, basic, absent, deduction, commission, advance, r2(gross - advance), (comm.get(e.id)?.parts || []).map((p: any) => p.label).join('; ') || null));
  }
  return stmts;
}
const RUN_LINES = `
  SELECT l.*, e.full_name, e.position, b.name AS branch_name FROM payroll_lines l JOIN employees e ON e.id = l.employee_id
  LEFT JOIN branches b ON b.id = l.branch_id WHERE l.run_id = ?`;
const num = (l: any) => ({ ...l, basic: Number(l.basic), attendance_deduction: Number(l.attendance_deduction), commission: Number(l.commission), additions: Number(l.additions), other_deductions: Number(l.other_deductions), advance_deduction: Number(l.advance_deduction), net: Number(l.net) });

hr.get('/payroll', async (c) => {
  canPayrollView(c);
  const { results } = await c.env.DB.prepare(`
    SELECT r.*, u.full_name AS created_by_name, a.full_name AS approved_by_name,
      (SELECT COUNT(*)::int FROM payroll_lines l WHERE l.run_id = r.id) AS employees,
      (SELECT COALESCE(SUM(net), 0) FROM payroll_lines l WHERE l.run_id = r.id) AS total_net,
      (SELECT COALESCE(SUM(net), 0) FROM payroll_lines l WHERE l.run_id = r.id AND l.status = 'PAID') AS paid
    FROM payroll_runs r LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users a ON a.id = r.approved_by ORDER BY r.period DESC`).all();
  return c.json({ runs: ((results || []) as any[]).map((r) => ({ ...r, total_net: r2(Number(r.total_net)), paid: r2(Number(r.paid)) })) });
});
hr.get('/payroll/:id', async (c) => {
  canPayrollView(c);
  const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ?').bind(c.req.param('id')).first() as any;
  if (!run) return c.json({ message: 'Payroll run not found.' }, 404);
  const f = branchFilter(c, 'l.branch_id');
  const { results } = await c.env.DB.prepare(`${RUN_LINES} ${f.sql} ORDER BY e.full_name`).bind(run.id, ...f.binds).all();
  const lines = ((results || []) as any[]).map(num);
  const sum = (k: string) => r2(lines.reduce((a, l) => a + Number(l[k]), 0));
  return c.json({ ...run, lines, totals: { basic: sum('basic'), attendance_deduction: sum('attendance_deduction'), commission: sum('commission'), additions: sum('additions'), other_deductions: sum('other_deductions'), advance_deduction: sum('advance_deduction'), net: sum('net') } });
});
hr.post('/payroll', async (c) => {
  companyPayroll(c);
  const body = await c.req.json().catch(() => ({}));
  if (!isPeriod(body.period)) return c.json({ message: 'Choose the month of the payroll.' }, 400);
  const workingDays = body.workingDays === undefined ? 26 : Number(body.workingDays);
  if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 31) return c.json({ message: 'Working days must be between 1 and 31.' }, 400);
  if (await c.env.DB.prepare('SELECT 1 FROM payroll_runs WHERE period = ?').bind(body.period).first()) return c.json({ message: `There is already a payroll for ${body.period}.` }, 409);
  const id = uuidv4();
  const lines = await buildLines(c.env.DB, id, body.period, workingDays);
  if (!lines.length) return c.json({ message: 'No active employee has a salary or commission for this month.' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO payroll_runs (id, period, status, working_days, created_by) VALUES (?, ?, 'DRAFT', ?, ?)").bind(id, body.period, workingDays, payload(c).sub),
    ...lines,
    createAuditLogStmt(c, 'PAYROLL_CREATE', 'payroll_runs', id, null, { period: body.period, employees: lines.length }),
  ]);
  return c.json({ id, employees: lines.length }, 201);
});
const draftRun = async (c: any) => {
  const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ?').bind(c.req.param('id')).first() as any;
  if (!run) throw new ScopeError(400, 'Payroll run not found.');
  if (run.status !== 'DRAFT') throw new ScopeError(400, 'This payroll is approved and can no longer be changed.');
  return run;
};
// Recalculate a draft (after attendance, salaries or commissions changed). Manual additions are kept.
hr.post('/payroll/:id/recalculate', async (c) => {
  companyPayroll(c);
  const run = await draftRun(c);
  const { results: kept } = await c.env.DB.prepare('SELECT employee_id, additions, other_deductions FROM payroll_lines WHERE run_id = ?').bind(run.id).all();
  const lines = await buildLines(c.env.DB, run.id, run.period, Number(run.working_days));
  const stmts: any[] = [c.env.DB.prepare('DELETE FROM payroll_lines WHERE run_id = ?').bind(run.id), ...lines];
  for (const k of (kept || []) as any[]) {
    if (Number(k.additions) || Number(k.other_deductions)) stmts.push(c.env.DB.prepare(`UPDATE payroll_lines SET additions = ?, other_deductions = ?,
      net = GREATEST(0, basic - attendance_deduction + commission + ? - ? - advance_deduction) WHERE run_id = ? AND employee_id = ?`).bind(k.additions, k.other_deductions, k.additions, k.other_deductions, run.id, k.employee_id));
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, employees: lines.length });
});
hr.patch('/payroll/:id/lines/:lineId', async (c) => {
  companyPayroll(c);
  const run = await draftRun(c);
  const line = await c.env.DB.prepare('SELECT * FROM payroll_lines WHERE id = ? AND run_id = ?').bind(c.req.param('lineId'), run.id).first() as any;
  if (!line) return c.json({ message: 'Line not found.' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const val = (k: string, cur: number) => (body[k] === undefined ? cur : r2(Number(body[k])));
  const additions = val('additions', Number(line.additions)), other = val('other_deductions', Number(line.other_deductions)), advance = val('advance_deduction', Number(line.advance_deduction));
  if (![additions, other, advance].every((v) => Number.isFinite(v) && v >= 0)) return c.json({ message: 'Amounts cannot be negative.' }, 400);
  const bal = await c.env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN kind = 'ADVANCE' THEN amount ELSE -amount END), 0) AS b FROM employee_advances WHERE employee_id = ?").bind(line.employee_id).first() as any;
  if (advance > Number(bal?.b || 0) + 0.005) return c.json({ message: `The employee owes only ${Number(bal?.b || 0).toFixed(2)} in advances.` }, 400);
  const net = r2(Number(line.basic) - Number(line.attendance_deduction) + Number(line.commission) + additions - other - advance);
  if (net < 0) return c.json({ message: 'Deductions are more than the pay.' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE payroll_lines SET additions = ?, other_deductions = ?, advance_deduction = ?, net = ?, notes = COALESCE(?, notes) WHERE id = ?').bind(additions, other, advance, net, text(body.notes, 300), line.id),
    createAuditLogStmt(c, 'PAYROLL_LINE_UPDATE', 'payroll_lines', line.id, line, { additions, other_deductions: other, advance_deduction: advance, net }),
  ]);
  return c.json({ net });
});
hr.delete('/payroll/:id', async (c) => {
  companyPayroll(c);
  const run = await draftRun(c);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM payroll_runs WHERE id = ?').bind(run.id),
    createAuditLogStmt(c, 'PAYROLL_DELETE', 'payroll_runs', run.id, run, null),
  ]);
  return c.json({ ok: true });
});
// Approve: the salaries are posted (owed to the employees) and advances are taken back.
hr.post('/payroll/:id/approve', async (c) => {
  companyPayroll(c);
  const run = await draftRun(c);
  const { results } = await c.env.DB.prepare(`${RUN_LINES} ORDER BY e.full_name`).bind(run.id).all();
  const lines = ((results || []) as any[]).map(num);
  if (!lines.length) return c.json({ message: 'This payroll has no employees.' }, 400);
  const userId = payload(c).sub;
  const { to } = monthEnds(run.period);
  const today = new Date().toISOString().slice(0, 10);
  const entryDate = to < today ? to : today;
  const jl: any[] = [];
  for (const l of lines) {
    const wages = r2(l.basic - l.attendance_deduction + l.additions - l.other_deductions);
    const d = `Payroll ${run.period}: ${l.full_name}`;
    if (wages > 0.004) jl.push({ accountCode: '6090', description: d, debitAmount: wages, creditAmount: 0, branchId: l.branch_id });
    if (l.commission > 0.004) jl.push({ accountCode: '6095', description: `Commission ${run.period}: ${l.full_name}`, debitAmount: l.commission, creditAmount: 0, branchId: l.branch_id });
    if (l.advance_deduction > 0.004) jl.push({ accountCode: '1080', description: `Advance deducted ${run.period}: ${l.full_name}`, debitAmount: 0, creditAmount: l.advance_deduction, branchId: l.branch_id });
    if (l.net > 0.004) jl.push({ accountCode: '2060', description: d, debitAmount: 0, creditAmount: l.net, branchId: l.branch_id });
    if (wages < -0.004) return c.json({ message: `${l.full_name}: deductions are more than the salary.` }, 400);
  }
  const posting = await postByBranch(c, jl, { description: `Payroll ${run.period}`, ref: `run:${run.id}`, entryDate, userId });
  const firstEntry = [...posting.entries.values()][0] ?? null;
  const stmts: any[] = [
    c.env.DB.prepare("UPDATE payroll_runs SET status = 'APPROVED', approved_by = ?, approved_at = CURRENT_TIMESTAMP, journal_entry_id = ? WHERE id = ? AND status = 'DRAFT'").bind(userId, firstEntry, run.id).mustAffect('This payroll was already approved.'),
    ...posting.statements,
  ];
  // Advances taken from the salary appear on the employee's advance history (posted by this entry).
  for (const l of lines.filter((x) => x.advance_deduction > 0.004)) {
    stmts.push(c.env.DB.prepare(`INSERT INTO employee_advances (id, employee_id, kind, amount, entry_date, method, notes, journal_entry_id, created_by, payroll_run_id)
      VALUES (?, ?, 'REPAYMENT', ?, ?, 'SALARY_DEDUCTION', ?, ?, ?, ?)`).bind(uuidv4(), l.employee_id, l.advance_deduction, entryDate, `Payroll ${run.period}`, posting.entries.get(l.branch_id || '') ?? null, userId, run.id));
  }
  stmts.push(createAuditLogStmt(c, 'PAYROLL_APPROVE', 'payroll_runs', run.id, { status: 'DRAFT' }, { status: 'APPROVED', total_net: r2(lines.reduce((a, l) => a + l.net, 0)) }));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, journal_entries: [...posting.entries.values()] });
});
// Pay salaries (all unpaid, or chosen employees) from a chosen Bank & Cash account.
hr.post('/payroll/:id/pay', async (c) => {
  companyPayroll(c);
  const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ?').bind(c.req.param('id')).first() as any;
  if (!run) return c.json({ message: 'Payroll run not found.' }, 404);
  if (run.status === 'DRAFT') return c.json({ message: 'Approve the payroll before paying it.' }, 400);
  const body = await c.req.json().catch(() => ({}));
  requireChosenAccount(body.moneyAccountId, 'the salaries');
  const only = Array.isArray(body.lineIds) && body.lineIds.length ? body.lineIds.map(String) : null;
  const { results } = await c.env.DB.prepare(`${RUN_LINES} AND l.status = 'UNPAID' AND l.net > 0 ORDER BY e.full_name`).bind(run.id).all();
  const lines = ((results || []) as any[]).map(num).filter((l) => !only || only.includes(l.id));
  if (!lines.length) return c.json({ message: 'Nothing left to pay.' }, 400);
  const cash = await resolveCashAccount(c.env.DB, body.moneyAccountId, undefined);
  for (const l of lines) if (cash.branchId && l.branch_id !== cash.branchId) return c.json({ message: `${cash.name} belongs to another branch than ${l.full_name}. Pay them from a company-wide account or their branch's account.` }, 400);
  const userId = payload(c).sub; const payId = uuidv4();
  const jl: any[] = [];
  for (const l of lines) {
    jl.push({ accountCode: '2060', description: `Salary paid ${run.period}: ${l.full_name}`, debitAmount: l.net, creditAmount: 0, branchId: l.branch_id });
    jl.push({ accountCode: cash.code, description: `Salary paid ${run.period}: ${l.full_name}`, debitAmount: 0, creditAmount: l.net, branchId: l.branch_id });
  }
  const posting = await postByBranch(c, jl, { description: `Salaries paid ${run.period} from ${cash.name}`, ref: `pay:${payId}`, userId });
  const stmts: any[] = [...posting.statements];
  for (const l of lines) stmts.push(c.env.DB.prepare("UPDATE payroll_lines SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, money_account_id = ? WHERE id = ? AND status = 'UNPAID'").bind(cash.id, l.id).mustAffect(`${l.full_name} was already paid.`));
  stmts.push(c.env.DB.prepare(`UPDATE payroll_runs SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM payroll_lines WHERE run_id = ? AND status = 'UNPAID' AND net > 0) THEN 'PAID' ELSE status END WHERE id = ?`).bind(run.id, run.id));
  stmts.push(createAuditLogStmt(c, 'PAYROLL_PAY', 'payroll_runs', run.id, null, { employees: lines.length, total: r2(lines.reduce((a, l) => a + l.net, 0)), account: cash.name }));
  await c.env.DB.batch(stmts);
  return c.json({ paid: lines.length, total: r2(lines.reduce((a, l) => a + l.net, 0)) });
});

export default hr;
