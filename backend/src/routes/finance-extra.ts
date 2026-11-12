// Roadmap wave 1 (accounting): period comparison, class tracking, currencies, bank reconciliation.
// Mounted inside the Accounting module (accounting.view; a branch-assigned viewer sees their branch).
// Nothing here creates a second set of books: reports read the journal, and reconciliation only
// links statement lines to ledger lines that already exist.
import { uuidv4 } from '../db';
import { createAuditLogStmt } from '../services/audit';
import { resolveBranchScope, branchSql, hasAllBranchAccess, ScopeError } from '../services/branch-scope';

const r2 = (n: number) => Math.round(n * 100) / 100;
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const text = (v: unknown, max: number) => { const s = v === undefined || v === null ? '' : String(v).trim(); return s ? s.slice(0, max) : null; };
const company = (c: any) => { if (!hasAllBranchAccess(c.get('jwtPayload'))) throw new ScopeError(403, 'Only the Owner or an accountant can change this.'); };
const CASH = `(coa.code = '1010' OR coa.code LIKE '1010-%')`;

/** Figures of one period, from the journal, within a branch scope. */
async function periodFigures(db: any, from: string, to: string, bf: string) {
  const flow = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN coa.account_type = 'REVENUE' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN coa.account_type IN ('EXPENSE', 'COGS') THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS expenses,
      COALESCE(SUM(CASE WHEN ${CASH} THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS cash_flow
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('POSTED', 'REVERSED') AND je.entry_date >= ? AND je.entry_date <= ?
      AND COALESCE(je.reference_type, '') <> 'CLOSING'
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE 1=1 ${bf}
  `).bind(from, to).first() as any;
  const pos = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN coa.account_type = 'ASSET' THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS assets,
      COALESCE(SUM(CASE WHEN coa.account_type = 'LIABILITY' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS liabilities
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('POSTED', 'REVERSED') AND je.entry_date <= ?
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE 1=1 ${bf}
  `).bind(to).first() as any;
  const revenue = r2(Number(flow.revenue)), expenses = r2(Number(flow.expenses));
  return { from, to, revenue, expenses, net_profit: r2(revenue - expenses), assets: r2(Number(pos.assets)), liabilities: r2(Number(pos.liabilities)), cash_flow: r2(Number(flow.cash_flow)) };
}

export function registerFinanceExtra(app: any) {
  // ── 8. Financial comparison: two periods side by side, difference in amount and % ──
  app.get('/comparison', async (c: any) => {
    const q = (k: string) => c.req.query(k);
    if (![q('fromA'), q('toA'), q('fromB'), q('toB')].every(isDate)) return c.json({ message: 'Choose both periods (from and to dates).' }, 400);
    const bf = branchSql(await resolveBranchScope(c), 'jel.branch_id');
    const [a, b] = await Promise.all([periodFigures(c.env.DB, q('fromA'), q('toA'), bf), periodFigures(c.env.DB, q('fromB'), q('toB'), bf)]);
    const rows = (['revenue', 'expenses', 'net_profit', 'assets', 'liabilities', 'cash_flow'] as const).map((k) => {
      const diff = r2(b[k] - a[k]);
      return { key: k, a: a[k], b: b[k], difference: diff, percent: Math.abs(a[k]) > 0.005 ? Math.round((diff / Math.abs(a[k])) * 1000) / 10 : null };
    });
    return c.json({ periodA: a, periodB: b, rows });
  });

  // ── 1. Class tracking ──
  app.get('/classes', async (c: any) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM accounting_classes ORDER BY is_active DESC, name').all();
    const s = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'class_required'").first() as any;
    return c.json({ classes: results || [], required: s?.value === true || s?.value === 'true' });
  });
  app.post('/classes', async (c: any) => {
    company(c);
    const body = await c.req.json().catch(() => ({}));
    const name = text(body.name, 60);
    if (!name) return c.json({ message: 'Give the class a name.' }, 400);
    if (await c.env.DB.prepare('SELECT 1 FROM accounting_classes WHERE lower(name) = lower(?)').bind(name).first()) return c.json({ message: `A class named "${name}" already exists.` }, 409);
    const id = uuidv4();
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO accounting_classes (id, name, created_by) VALUES (?, ?, ?)').bind(id, name, c.get('jwtPayload').sub),
      createAuditLogStmt(c, 'CLASS_CREATE', 'accounting_classes', id, null, { name }),
    ]);
    return c.json(await c.env.DB.prepare('SELECT * FROM accounting_classes WHERE id = ?').bind(id).first(), 201);
  });
  app.patch('/classes/:id', async (c: any) => {
    company(c);
    const id = c.req.param('id'); const body = await c.req.json().catch(() => ({}));
    const old = await c.env.DB.prepare('SELECT * FROM accounting_classes WHERE id = ?').bind(id).first();
    if (!old) return c.json({ message: 'Class not found.' }, 404);
    const sets: string[] = []; const vals: unknown[] = [];
    if ('name' in body) { const n = text(body.name, 60); if (!n) return c.json({ message: 'Give the class a name.' }, 400); sets.push('name = ?'); vals.push(n); }
    if ('is_active' in body) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
    if (!sets.length) return c.json({ message: 'Nothing to change.' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE accounting_classes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
      createAuditLogStmt(c, 'CLASS_UPDATE', 'accounting_classes', id, old, body),
    ]);
    return c.json(await c.env.DB.prepare('SELECT * FROM accounting_classes WHERE id = ?').bind(id).first());
  });
  // Management decides whether a class must be chosen on expenses.
  app.put('/classes-required', async (c: any) => {
    company(c);
    const body = await c.req.json().catch(() => ({}));
    await c.env.DB.prepare(`INSERT INTO app_settings (key, value, updated_by) VALUES ('class_required', ?::jsonb, ?)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`)
      .bind(JSON.stringify(!!body.required), c.get('jwtPayload').sub).run();
    return c.json({ required: !!body.required });
  });
  // Default class of an account (used when an expense on that account has no class chosen).
  app.put('/chart-of-accounts/:id/default-class', async (c: any) => {
    company(c);
    const body = await c.req.json().catch(() => ({}));
    const classId = text(body.classId, 80);
    if (classId && !(await c.env.DB.prepare('SELECT 1 FROM accounting_classes WHERE id = ?').bind(classId).first())) return c.json({ message: 'That class does not exist.' }, 400);
    await c.env.DB.prepare('UPDATE chart_of_accounts SET default_class_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(classId, c.req.param('id')).run();
    return c.json({ ok: true });
  });
  // Income and expenses per class for a period.
  app.get('/class-report', async (c: any) => {
    const from = isDate(c.req.query('from')) ? c.req.query('from') : '1970-01-01';
    const to = isDate(c.req.query('to')) ? c.req.query('to') : '2999-12-31';
    const bf = branchSql(await resolveBranchScope(c), 'jel.branch_id');
    const { results } = await c.env.DB.prepare(`
      SELECT je.class_id, COALESCE(cl.name, 'No class') AS class_name,
        COALESCE(SUM(CASE WHEN coa.account_type = 'REVENUE' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN coa.account_type IN ('EXPENSE', 'COGS') THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS expenses
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('POSTED', 'REVERSED') AND je.entry_date >= ? AND je.entry_date <= ?
        AND COALESCE(je.reference_type, '') <> 'CLOSING'
      JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.account_type IN ('REVENUE', 'EXPENSE', 'COGS')
      LEFT JOIN accounting_classes cl ON cl.id = je.class_id
      WHERE 1=1 ${bf}
      GROUP BY je.class_id, cl.name ORDER BY (je.class_id IS NULL), cl.name
    `).bind(from, to).all();
    const rows = ((results || []) as any[]).map((r) => ({ class_id: r.class_id, class_name: r.class_name, revenue: r2(Number(r.revenue)), expenses: r2(Number(r.expenses)), net: r2(Number(r.revenue) - Number(r.expenses)) }));
    return c.json({ from, to, rows });
  });

  // ── 5. Currencies: base currency + others with a rate (units of the currency per 1 base unit) ──
  app.get('/currencies', async (c: any) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM currencies ORDER BY is_base DESC, code').all();
    const { results: history } = await c.env.DB.prepare(`SELECT er.*, u.full_name AS by_name FROM exchange_rates er LEFT JOIN users u ON u.id = er.created_by ORDER BY er.created_at DESC LIMIT 30`).all();
    return c.json({ currencies: ((results || []) as any[]).map((r) => ({ ...r, rate: r.rate === null ? null : Number(r.rate) })), history: history || [] });
  });
  // A new rate applies to transactions from now on; past lines keep the rate they were recorded at.
  app.put('/currencies/:code/rate', async (c: any) => {
    company(c);
    const code = String(c.req.param('code')).toUpperCase();
    const cur = await c.env.DB.prepare('SELECT * FROM currencies WHERE code = ?').bind(code).first() as any;
    if (!cur) return c.json({ message: 'Currency not found.' }, 404);
    if (Number(cur.is_base) === 1) return c.json({ message: 'The base currency always has the rate 1.' }, 400);
    const rate = Number((await c.req.json().catch(() => ({}))).rate);
    if (!Number.isFinite(rate) || rate <= 0) return c.json({ message: 'Enter how many units of this currency equal 1 US dollar (e.g. 11800).' }, 400);
    const userId = c.get('jwtPayload').sub;
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE currencies SET rate = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?').bind(rate, code),
      c.env.DB.prepare('INSERT INTO exchange_rates (id, currency_code, rate, created_by) VALUES (?, ?, ?, ?)').bind(uuidv4(), code, rate, userId),
      createAuditLogStmt(c, 'EXCHANGE_RATE_SET', 'currencies', code, { rate: cur.rate }, { rate }),
    ]);
    return c.json({ code, rate });
  });

  // ── 6. Bank reconciliation ──
  const accountOr404 = async (c: any, id: string) => {
    const scope = await resolveBranchScope(c);
    const acc = await c.env.DB.prepare('SELECT ma.*, coa.code AS account_code FROM money_accounts ma JOIN chart_of_accounts coa ON coa.id = ma.coa_account_id WHERE ma.id = ?').bind(id).first() as any;
    if (!acc || (scope.kind === 'BRANCH' && acc.branch_id && acc.branch_id !== scope.branchId)) return null;
    return acc;
  };
  app.get('/reconciliation/:accountId', async (c: any) => {
    const acc = await accountOr404(c, c.req.param('accountId'));
    if (!acc) return c.json({ message: 'Account not found.' }, 404);
    const [{ results: stmt }, { results: book }, bal] = await Promise.all([
      c.env.DB.prepare(`
        SELECT s.*, gl.entry_date AS matched_date, gl.description AS matched_description, je.entry_number AS matched_entry
        FROM bank_statement_lines s
        LEFT JOIN general_ledger gl ON gl.id = s.matched_line_id
        LEFT JOIN journal_entries je ON je.id = gl.journal_entry_id
        WHERE s.money_account_id = ? ORDER BY s.line_date DESC, s.created_at DESC LIMIT 1000`).bind(acc.id).all(),
      c.env.DB.prepare(`
        SELECT gl.id, gl.entry_date, gl.description, (gl.debit_amount - gl.credit_amount) AS amount, je.entry_number, je.reference_type
        FROM general_ledger gl JOIN journal_entries je ON je.id = gl.journal_entry_id
        WHERE gl.account_id = ? AND NOT EXISTS (SELECT 1 FROM bank_statement_lines s WHERE s.matched_line_id = gl.id)
        ORDER BY gl.entry_date DESC, gl.created_at DESC LIMIT 1000`).bind(acc.coa_account_id).all(),
      c.env.DB.prepare('SELECT COALESCE(SUM(debit_amount - credit_amount), 0) AS b FROM general_ledger WHERE account_id = ?').bind(acc.coa_account_id).first(),
    ]) as any[];
    const lines = ((stmt || []) as any[]).map((s) => ({ ...s, amount: Number(s.amount) }));
    const unmatchedBook = ((book || []) as any[]).map((b) => ({ ...b, amount: r2(Number(b.amount)) }));
    const sum = (xs: any[]) => r2(xs.reduce((a, x) => a + Number(x.amount), 0));
    const unmatchedStatement = lines.filter((l) => !l.matched_line_id);
    const bookBalance = r2(Number(bal?.b || 0));
    const statementBalance = c.req.query('statementBalance') !== undefined && c.req.query('statementBalance') !== '' ? Number(c.req.query('statementBalance')) : null;
    return c.json({
      account: { id: acc.id, name: acc.name, provider: acc.provider, account_number: acc.account_number },
      statement: lines, unmatchedBook,
      summary: {
        book_balance: bookBalance, statement_lines: lines.length, matched: lines.length - unmatchedStatement.length,
        unmatched_statement: unmatchedStatement.length, unmatched_statement_total: sum(unmatchedStatement),
        unmatched_book: unmatchedBook.length, unmatched_book_total: sum(unmatchedBook),
        statement_balance: statementBalance,
        difference: statementBalance === null || !Number.isFinite(statementBalance) ? null : r2(statementBalance - bookBalance),
      },
    });
  });
  // Add statement lines (typed, or pasted from the bank's file). A line already there is skipped.
  app.post('/reconciliation/:accountId/lines', async (c: any) => {
    company(c);
    const acc = await accountOr404(c, c.req.param('accountId'));
    if (!acc) return c.json({ message: 'Account not found.' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const rows = Array.isArray(body.lines) ? body.lines : [];
    if (!rows.length) return c.json({ message: 'Enter at least one statement line.' }, 400);
    if (rows.length > 500) return c.json({ message: 'Add at most 500 lines at a time.' }, 400);
    const userId = c.get('jwtPayload').sub;
    const stmts: any[] = []; let skipped = 0;
    for (let i = 0; i < rows.length; i++) {
      const l = rows[i]; const amount = r2(Number(l.amount));
      if (!isDate(l.date)) return c.json({ message: `Line ${i + 1}: the date must look like 2026-11-30.` }, 400);
      if (!Number.isFinite(amount) || amount === 0) return c.json({ message: `Line ${i + 1}: enter the amount (money in is positive, money out is negative).` }, 400);
      const ref = text(l.reference, 80), desc = text(l.description, 200);
      const dup = await c.env.DB.prepare(`SELECT 1 FROM bank_statement_lines WHERE money_account_id = ? AND line_date = ? AND amount = ? AND COALESCE(reference, '') = ? AND COALESCE(description, '') = ?`)
        .bind(acc.id, l.date, amount, ref || '', desc || '').first();
      if (dup) { skipped++; continue; }
      stmts.push(c.env.DB.prepare('INSERT INTO bank_statement_lines (id, money_account_id, line_date, description, reference, amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(uuidv4(), acc.id, l.date, desc, ref, amount, userId));
    }
    if (stmts.length) await c.env.DB.batch(stmts);
    return c.json({ added: stmts.length, skipped }, 201);
  });
  // Match every statement line that has exactly one book line of the same amount within 3 days.
  app.post('/reconciliation/:accountId/auto', async (c: any) => {
    company(c);
    const acc = await accountOr404(c, c.req.param('accountId'));
    if (!acc) return c.json({ message: 'Account not found.' }, 404);
    const { results: st } = await c.env.DB.prepare('SELECT id, line_date, amount FROM bank_statement_lines WHERE money_account_id = ? AND matched_line_id IS NULL ORDER BY line_date').bind(acc.id).all();
    const { results: bk } = await c.env.DB.prepare(`
      SELECT gl.id, gl.entry_date, (gl.debit_amount - gl.credit_amount) AS amount FROM general_ledger gl
      WHERE gl.account_id = ? AND NOT EXISTS (SELECT 1 FROM bank_statement_lines s WHERE s.matched_line_id = gl.id)`).bind(acc.coa_account_id).all();
    const free = ((bk || []) as any[]).map((b) => ({ id: b.id, t: new Date(b.entry_date).getTime(), amount: r2(Number(b.amount)), used: false }));
    const userId = c.get('jwtPayload').sub; const stmts: any[] = [];
    for (const s of (st || []) as any[]) {
      const t = new Date(s.line_date).getTime(); const amount = r2(Number(s.amount));
      const candidates = free.filter((b) => !b.used && Math.abs(b.amount - amount) < 0.005 && Math.abs(b.t - t) <= 3 * 86_400_000);
      if (candidates.length !== 1) continue; // none, or not sure which one: left for a person
      candidates[0].used = true;
      stmts.push(c.env.DB.prepare('UPDATE bank_statement_lines SET matched_line_id = ?, matched_at = CURRENT_TIMESTAMP, matched_by = ? WHERE id = ? AND matched_line_id IS NULL').bind(candidates[0].id, userId, s.id));
    }
    if (stmts.length) await c.env.DB.batch(stmts);
    return c.json({ matched: stmts.length });
  });
  app.post('/reconciliation/match', async (c: any) => {
    company(c);
    const body = await c.req.json().catch(() => ({}));
    const s = await c.env.DB.prepare('SELECT s.*, ma.coa_account_id FROM bank_statement_lines s JOIN money_accounts ma ON ma.id = s.money_account_id WHERE s.id = ?').bind(String(body.statementLineId || '')).first() as any;
    if (!s) return c.json({ message: 'Statement line not found.' }, 404);
    if (s.matched_line_id) return c.json({ message: 'This statement line is already matched.' }, 400);
    const b = await c.env.DB.prepare('SELECT id, account_id, (debit_amount - credit_amount) AS amount FROM general_ledger WHERE id = ?').bind(String(body.ledgerLineId || '')).first() as any;
    if (!b || b.account_id !== s.coa_account_id) return c.json({ message: 'That book entry is not on this account.' }, 400);
    if (Math.abs(Number(b.amount) - Number(s.amount)) > 0.005) return c.json({ message: `The amounts differ: statement ${Number(s.amount).toFixed(2)}, books ${Number(b.amount).toFixed(2)}. Correct the entry first, then match.` }, 400);
    if (await c.env.DB.prepare('SELECT 1 FROM bank_statement_lines WHERE matched_line_id = ?').bind(b.id).first()) return c.json({ message: 'That book entry is already matched to another statement line.' }, 409);
    await c.env.DB.prepare('UPDATE bank_statement_lines SET matched_line_id = ?, matched_at = CURRENT_TIMESTAMP, matched_by = ? WHERE id = ? AND matched_line_id IS NULL')
      .bind(b.id, c.get('jwtPayload').sub, s.id).run();
    return c.json({ ok: true });
  });
  app.post('/reconciliation/unmatch', async (c: any) => {
    company(c);
    const body = await c.req.json().catch(() => ({}));
    await c.env.DB.prepare('UPDATE bank_statement_lines SET matched_line_id = NULL, matched_at = NULL, matched_by = NULL WHERE id = ?').bind(String(body.statementLineId || '')).run();
    return c.json({ ok: true });
  });
  app.delete('/reconciliation/lines/:id', async (c: any) => {
    company(c);
    const r = await c.env.DB.prepare('DELETE FROM bank_statement_lines WHERE id = ? AND matched_line_id IS NULL').bind(c.req.param('id')).run();
    if (!r.meta?.changes) return c.json({ message: 'Unmatch this line before deleting it.' }, 400);
    return c.json({ ok: true });
  });
}
