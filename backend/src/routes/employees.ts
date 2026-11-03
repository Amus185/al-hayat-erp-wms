// Employees: profile (photo, employment document, salary) and salary advances
// with a running balance, like a customer's payment history.
//
// Accounting:
//   advance given                 Dr 1080 Employee Advances / Cr 1010 Cash
//   repaid in cash or bank        Dr 1010 Cash              / Cr 1080 Employee Advances
//   repaid by salary deduction    Dr 6090 Salaries & Wages  / Cr 1080 Employee Advances
// Deleting an entry reverses its journal entry.
import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';
import { prepareJournalEntryPosting, prepareJournalReversal } from '../services/accounting-service';
import { csvResponse, likeTerm, listRequest, pagedResponse, pagedRows, type ListOptions } from '../services/listing';
import { has, hideUnless, PERM, PAYROLL_FIELDS, sortsFor } from '../services/privacy';
import { hasAllBranchAccess, ScopeError } from '../services/branch-scope';

const employees = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

employees.use('/*', authMiddleware);
// Who may open employee records at all: user administrators, people who
// manage employees (Branch Managers, within their branch) and payroll staff.
employees.use('/*', async (c, next) => {
  const p = c.get('jwtPayload');
  if (!(has(p, 'manage_users') || has(p, PERM.EMPLOYEES_MANAGE) || has(p, PERM.PAYROLL_VIEW))) {
    return c.json({ error: 'You do not have access to employee records' }, 403);
  }
  await next();
});
// Salaries, advances and employment documents only for payroll access (Owner decision D3).
employees.use('/*', hideUnless(PERM.PAYROLL_VIEW, PAYROLL_FIELDS));

/** Branch the caller is limited to, or null for all branches (administrators, accountants). */
function ownBranch(c: any): string | null {
  const p = c.get('jwtPayload');
  if (hasAllBranchAccess(p)) return null;
  if (!p?.branch_id) throw new ScopeError(403, 'Your account is not assigned to a branch, so employee records are not available.');
  return p.branch_id;
}
/** 404 unless the employee exists and is in the caller's branch. */
async function findEmployee(c: any, id: string): Promise<any | null> {
  const branch = ownBranch(c);
  const emp = await c.env.DB.prepare(`${EMPLOYEE_SELECT} WHERE e.id = ?`).bind(id).first() as any;
  if (!emp || (branch && emp.branch_id !== branch)) return null;
  return emp;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

const BALANCES = `
  SELECT employee_id,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'ADVANCE'), 0)::float AS total_advances,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'REPAYMENT'), 0)::float AS total_repaid
  FROM employee_advances GROUP BY employee_id`;

const EMPLOYEE_SELECT = `
  SELECT e.*, b.name AS branch_name,
         COALESCE(a.total_advances, 0) AS total_advances,
         COALESCE(a.total_repaid, 0) AS total_repaid,
         COALESCE(a.total_advances, 0) - COALESCE(a.total_repaid, 0) AS advance_balance
  FROM employees e
  LEFT JOIN branches b ON b.id = e.branch_id
  LEFT JOIN (${BALANCES}) a ON a.employee_id = e.id`;

const EMPLOYEE_LIST: ListOptions = {
  sortable: { name: 'full_name', position: 'position', branch: 'branch_name', salary: 'salary', balance: 'advance_balance', hired: 'hire_date', date: 'created_at' },
  defaultSort: 'name', defaultDir: 'asc', tieBreaker: 'id',
};

employees.get('/', async (c) => {
  const listReq = listRequest(c, sortsFor(c, EMPLOYEE_LIST, ['salary', 'balance'], PERM.PAYROLL_VIEW));
  const payroll = has(c.get('jwtPayload'), PERM.PAYROLL_VIEW);
  const q = (k: string) => (c.req.query(k) || '').trim();
  const where: string[] = [];
  const params: unknown[] = [];
  const branch = ownBranch(c);
  if (branch) { where.push('branch_id = ?'); params.push(branch); }
  if (q('q')) {
    const t = likeTerm(q('q'));
    where.push(`(full_name ILIKE ? OR COALESCE(phone, '') ILIKE ? OR COALESCE(position, '') ILIKE ? OR COALESCE(national_id, '') ILIKE ?)`);
    params.push(t, t, t, t);
  }
  const viewBranch = q('branchId') || q('branch_id');
  if (viewBranch && viewBranch !== 'ALL') { where.push('branch_id = ?'); params.push(viewBranch); }
  if (q('balance') === 'owing' && payroll) where.push('advance_balance > 0');
  const statusWhere = [...where];
  const statusParams = [...params];
  if (q('status')) { statusWhere.push('status = ?'); statusParams.push(q('status')); }
  const base = `FROM (${EMPLOYEE_SELECT}) x ${statusWhere.length ? 'WHERE ' + statusWhere.join(' AND ') : ''}`;

  if (!listReq.paged) {
    const { results } = await c.env.DB.prepare(`SELECT * ${base} ORDER BY full_name LIMIT 500`).bind(...statusParams).all();
    return c.json(results || []);
  }
  const { rows, total } = await pagedRows(c.env.DB, '*', base, statusParams, listReq);
  if (listReq.csv) {
    return csvResponse(c, 'employees', [
      { label: 'Name', value: (r: any) => r.full_name },
      { label: 'Position', value: (r: any) => r.position },
      { label: 'Branch', value: (r: any) => r.branch_name },
      { label: 'Phone', value: (r: any) => r.phone },
      { label: 'Salary', value: (r: any) => Number(r.salary), perm: PERM.PAYROLL_VIEW },
      { label: 'Total advances', value: (r: any) => Number(r.total_advances), perm: PERM.PAYROLL_VIEW },
      { label: 'Advance balance', value: (r: any) => Number(r.advance_balance), perm: PERM.PAYROLL_VIEW },
      { label: 'Status', value: (r: any) => r.status },
    ], rows);
  }
  const { results: grouped } = await c.env.DB.prepare(
    `SELECT status, COUNT(*)::int AS n FROM (${EMPLOYEE_SELECT}) x ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY status`,
  ).bind(...params).all();
  const counts: Record<string, number> = { ALL: 0 };
  for (const g of (grouped || []) as any[]) { counts[g.status] = Number(g.n); counts.ALL += Number(g.n); }
  const sums = await c.env.DB.prepare(`SELECT COALESCE(SUM(salary), 0)::float AS salary, COALESCE(SUM(advance_balance), 0)::float AS balance ${base}`).bind(...statusParams).first() as any;
  return pagedResponse(c, listReq, rows, total, { counts, ...(payroll ? { totals: { salary: Number(sums?.salary || 0), balance: Number(sums?.balance || 0) } } : {}) });
});

employees.get('/:id', async (c) => {
  const id = c.req.param('id');
  const emp = await findEmployee(c, id);
  if (!emp) return c.json({ error: 'Employee not found' }, 404);
  const { results } = await c.env.DB.prepare(`
    SELECT ea.*, u.full_name AS created_by_name
    FROM employee_advances ea LEFT JOIN users u ON u.id = ea.created_by
    WHERE ea.employee_id = ? ORDER BY ea.entry_date DESC, ea.created_at DESC
  `).bind(id).all();
  return c.json({ ...emp, advances: results || [] });
});

function readEmployee(body: any, partial: boolean, payroll: boolean) {
  const out: Record<string, unknown> = {};
  const fields: [string, number][] = [['full_name', 120], ['phone', 40], ['email', 120], ['position', 80], ['national_id', 60], ['address', 300], ['notes', 1000], ['photo_key', 300], ['document_key', 300], ['document_name', 200]];
  for (const [f, max] of fields) if (!partial || f in body) out[f] = text(body[f], max);
  if (!partial || 'branch_id' in body) out.branch_id = text(body.branch_id, 80);
  if (!partial || 'hire_date' in body) out.hire_date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.hire_date ?? '')) ? body.hire_date : null;
  if (!partial || 'salary' in body) {
    const s = Number(body.salary ?? 0);
    if (!Number.isFinite(s) || s < 0) throw new Error('Salary must be zero or more');
    out.salary = round2(s);
  }
  if (!partial || 'status' in body) out.status = body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if ('full_name' in out && !out.full_name) throw new Error('Full name is required');
  // Pay and the employment document are only set by people with payroll.manage (D3).
  if (!payroll) { delete out.salary; delete out.document_key; delete out.document_name; }
  return out;
}

employees.post('/', async (c) => {
  let data: Record<string, unknown>;
  try { data = readEmployee(await c.req.json(), false, has(c.get('jwtPayload'), PERM.PAYROLL_MANAGE)); } catch (e: any) { return c.json({ error: e.message }, 400); }
  if (!has(c.get('jwtPayload'), 'manage_users') && !has(c.get('jwtPayload'), PERM.EMPLOYEES_MANAGE)) return c.json({ error: 'You cannot add employees' }, 403);
  const branch = ownBranch(c);
  if (branch) data.branch_id = branch; // branch managers add employees to their own branch
  const id = uuidv4();
  const cols = Object.keys(data);
  const db = c.env.DB;
  await db.batch([
    db.prepare(`INSERT INTO employees (id, ${cols.join(', ')}, created_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`)
      .bind(id, ...cols.map((k) => data[k]), c.get('jwtPayload')?.sub ?? null),
    createAuditLogStmt(c, 'EMPLOYEE_CREATE', 'employees', id, null, data),
  ]);
  return c.json(await db.prepare(`${EMPLOYEE_SELECT} WHERE e.id = ?`).bind(id).first(), 201);
});

employees.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let data: Record<string, unknown>;
  const p = c.get('jwtPayload');
  try { data = readEmployee(await c.req.json(), true, has(p, PERM.PAYROLL_MANAGE)); } catch (e: any) { return c.json({ error: e.message }, 400); }
  // Payroll staff without employee management may only change pay fields.
  if (!has(p, 'manage_users') && !has(p, PERM.EMPLOYEES_MANAGE)) {
    for (const k of Object.keys(data)) if (!['salary', 'document_key', 'document_name'].includes(k)) delete data[k];
  }
  const branch = ownBranch(c);
  if (branch && 'branch_id' in data) data.branch_id = branch; // cannot move someone to another branch
  const db = c.env.DB;
  if (!(await findEmployee(c, id))) return c.json({ error: 'Employee not found' }, 404);
  const old = await db.prepare('SELECT * FROM employees WHERE id = ?').bind(id).first();
  const cols = Object.keys(data);
  if (cols.length) {
    await db.batch([
      db.prepare(`UPDATE employees SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...cols.map((k) => data[k]), id),
      createAuditLogStmt(c, 'EMPLOYEE_UPDATE', 'employees', id, old, data),
    ]);
  }
  return c.json(await db.prepare(`${EMPLOYEE_SELECT} WHERE e.id = ?`).bind(id).first());
});

employees.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  if (!has(c.get('jwtPayload'), 'manage_users') && !has(c.get('jwtPayload'), PERM.EMPLOYEES_MANAGE)) return c.json({ error: 'You cannot delete employees' }, 403);
  const emp = await findEmployee(c, id);
  if (!emp) return c.json({ error: 'Employee not found' }, 404);
  const n = await db.prepare('SELECT COUNT(*)::int AS n FROM employee_advances WHERE employee_id = ?').bind(id).first() as any;
  if (Number(n?.n) > 0) return c.json({ error: 'This employee has advance history. Mark them Inactive instead.' }, 409);
  await db.batch([
    db.prepare('DELETE FROM employees WHERE id = ?').bind(id).mustAffect('Already deleted'),
    createAuditLogStmt(c, 'EMPLOYEE_DELETE', 'employees', id, { full_name: emp.full_name }, null),
  ]);
  return c.json({ success: true });
});

// ── Salary advances and repayments ─────────────────────────────────────
employees.post('/:id/advances', async (c) => {
  if (!has(c.get('jwtPayload'), PERM.PAYROLL_MANAGE)) return c.json({ error: 'Recording advances needs payroll access' }, 403);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const db = c.env.DB;
  const emp = await findEmployee(c, id);
  if (!emp) return c.json({ error: 'Employee not found' }, 404);

  const kind = body.kind === 'REPAYMENT' ? 'REPAYMENT' : 'ADVANCE';
  const amount = round2(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'Enter an amount greater than zero' }, 400);
  const method = ['CASH', 'BANK', 'SALARY_DEDUCTION'].includes(body.method) ? body.method : 'CASH';
  if (kind === 'ADVANCE' && method === 'SALARY_DEDUCTION') return c.json({ error: 'An advance is paid in cash or by bank' }, 400);
  const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.entry_date ?? '')) ? body.entry_date : new Date().toISOString().slice(0, 10);
  const balance = round2(Number(emp.advance_balance));
  if (kind === 'REPAYMENT' && amount > balance) {
    return c.json({ error: `Repayment is more than the remaining advance balance (${balance.toFixed(2)})` }, 400);
  }

  const advId = uuidv4();
  const userId = c.get('jwtPayload')?.sub ?? null;
  const debit = kind === 'ADVANCE' ? 'coa-1080' : method === 'SALARY_DEDUCTION' ? 'coa-6090' : 'coa-1010';
  const credit = kind === 'ADVANCE' ? 'coa-1010' : 'coa-1080';
  const label = kind === 'ADVANCE' ? 'Salary advance' : method === 'SALARY_DEDUCTION' ? 'Advance deducted from salary' : 'Advance repaid';
  const posting = await prepareJournalEntryPosting(c, {
    description: `${label}: ${emp.full_name}`,
    referenceType: 'PAYROLL',
    referenceId: advId,
    branchId: emp.branch_id ?? null,
    entryDate,
    userId,
    lines: [
      { accountCode: debit, description: `${label}: ${emp.full_name}`, debitAmount: amount, creditAmount: 0 },
      { accountCode: credit, description: `${label}: ${emp.full_name}`, debitAmount: 0, creditAmount: amount },
    ],
  });
  if (!posting.statements.length) return c.json({ error: 'Payroll accounts were not found in the chart of accounts' }, 422);

  const stmts: any[] = [
    db.prepare(`INSERT INTO employee_advances (id, employee_id, kind, amount, entry_date, method, notes, journal_entry_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(advId, id, kind, amount, entryDate, method, text(body.notes, 500), (posting as any).entryId ?? null, userId),
  ];
  if (kind === 'REPAYMENT') {
    // Guard against two repayments racing past the balance.
    stmts.push(db.prepare(`
      SELECT 1 FROM employee_advances WHERE employee_id = ?
      HAVING COALESCE(SUM(amount) FILTER (WHERE kind = 'ADVANCE'), 0) - COALESCE(SUM(amount) FILTER (WHERE kind = 'REPAYMENT'), 0) >= 0
    `).bind(id).mustAffect('Repayment is more than the remaining advance balance'));
  }
  stmts.push(...posting.statements);
  stmts.push(createAuditLogStmt(c, kind === 'ADVANCE' ? 'EMPLOYEE_ADVANCE' : 'EMPLOYEE_REPAYMENT', 'employees', id, null, { amount, method, entry_date: entryDate }));
  await db.batch(stmts);
  return c.json(await db.prepare('SELECT * FROM employee_advances WHERE id = ?').bind(advId).first(), 201);
});

employees.delete('/:id/advances/:advId', async (c) => {
  if (!has(c.get('jwtPayload'), PERM.PAYROLL_MANAGE)) return c.json({ error: 'Deleting advances needs payroll access' }, 403);
  const { id, advId } = c.req.param();
  const db = c.env.DB;
  if (!(await findEmployee(c, id))) return c.json({ error: 'Employee not found' }, 404);
  const row = await db.prepare('SELECT * FROM employee_advances WHERE id = ? AND employee_id = ?').bind(advId, id).first() as any;
  if (!row) return c.json({ error: 'Entry not found' }, 404);
  if (row.kind === 'ADVANCE') {
    const bal = await db.prepare(`SELECT total_advances - total_repaid AS b FROM (${BALANCES}) x WHERE employee_id = ?`).bind(id).first() as any;
    if (round2(Number(bal?.b ?? 0) - Number(row.amount)) < 0) {
      return c.json({ error: 'Delete the repayments of this advance first; the balance would go below zero' }, 409);
    }
  }
  const userId = c.get('jwtPayload')?.sub ?? null;
  const stmts: any[] = [];
  const { results } = await db.prepare("SELECT id, description FROM journal_entries WHERE reference_type = 'PAYROLL' AND reference_id = ? AND status = 'POSTED'").bind(advId).all();
  for (const je of (results || []) as any[]) stmts.push(...await prepareJournalReversal(c, je.id, je.description, userId));
  stmts.push(db.prepare('DELETE FROM employee_advances WHERE id = ?').bind(advId).mustAffect('Already deleted'));
  stmts.push(createAuditLogStmt(c, 'EMPLOYEE_ADVANCE_DELETE', 'employee_advances', advId, row, null));
  await db.batch(stmts);
  return c.json({ success: true });
});

export default employees;
