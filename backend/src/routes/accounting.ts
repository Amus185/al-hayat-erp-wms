import { Hono } from 'hono';
import { Env } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { reconcileMissingSalesJournalEntries } from '../services/accounting-service';

const accounting = new Hono<{ Bindings: Env }>();

accounting.use('/*', authMiddleware);

// ══════════════════════════════════════════════════════════
// HELPER UTILITIES
// ══════════════════════════════════════════════════════════
function generateId(): string {
  return crypto.randomUUID();
}

function generateEntryNumber(seq: number): string {
  const year = new Date().getFullYear();
  return `JE-${year}-${String(seq).padStart(4, '0')}`;
}

// ══════════════════════════════════════════════════════════
// FISCAL PERIODS
// ══════════════════════════════════════════════════════════
accounting.get('/fiscal-periods', requirePermissions(['view_reports']), async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT fp.*, u.full_name AS created_by_name
    FROM fiscal_periods fp
    LEFT JOIN users u ON u.id = fp.created_by
    ORDER BY fp.start_date DESC
  `).all();
  return c.json(results || []);
});

accounting.post('/fiscal-periods', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json<{
    name: string;
    period_type?: string;
    start_date: string;
    end_date: string;
  }>();

  if (!body.name || !body.start_date || !body.end_date) {
    return c.json({ error: 'name, start_date, and end_date are required' }, 400);
  }

  const id = generateId();
  const userId = (c as any).get('userId') || null;

  await c.env.DB.prepare(`
    INSERT INTO fiscal_periods (id, name, period_type, start_date, end_date, status, created_by)
    VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
  `).bind(id, body.name, body.period_type || 'ANNUAL', body.start_date, body.end_date, userId).run();

  const row = await c.env.DB.prepare('SELECT * FROM fiscal_periods WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

accounting.patch('/fiscal-periods/:id/status', requirePermissions(['manage_purchasing']), async (c) => {
  const { id } = c.req.param();
  const { status } = await c.req.json<{ status: string }>();
  if (!['OPEN', 'CLOSED', 'LOCKED'].includes(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }
  await c.env.DB.prepare('UPDATE fiscal_periods SET status = ? WHERE id = ?').bind(status, id).run();
  const row = await c.env.DB.prepare('SELECT * FROM fiscal_periods WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ══════════════════════════════════════════════════════════
// CHART OF ACCOUNTS
// ══════════════════════════════════════════════════════════
accounting.get('/chart-of-accounts', requirePermissions(['view_reports']), async (c) => {
  const accountType = c.req.query('type') || null;
  let query = `
    SELECT coa.*, p.name AS parent_name, b.name AS branch_name
    FROM chart_of_accounts coa
    LEFT JOIN chart_of_accounts p ON p.id = coa.parent_id
    LEFT JOIN branches b ON b.id = coa.branch_id
    WHERE coa.is_active = 1
  `;
  const params: any[] = [];
  if (accountType) {
    query += ' AND coa.account_type = ?';
    params.push(accountType);
  }
  query += ' ORDER BY coa.code ASC';

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json(results || []);
});

accounting.post('/chart-of-accounts', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json<{
    code: string;
    name: string;
    account_type: string;
    normal_balance?: string;
    parent_id?: string;
    branch_id?: string;
    description?: string;
  }>();

  if (!body.code || !body.name || !body.account_type) {
    return c.json({ error: 'code, name, and account_type are required' }, 400);
  }

  const validTypes = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS'];
  if (!validTypes.includes(body.account_type)) {
    return c.json({ error: `account_type must be one of: ${validTypes.join(', ')}` }, 400);
  }

  const id = generateId();
  const normalBalance = body.normal_balance || (['LIABILITY', 'EQUITY', 'REVENUE'].includes(body.account_type) ? 'CREDIT' : 'DEBIT');

  await c.env.DB.prepare(`
    INSERT INTO chart_of_accounts (id, code, name, account_type, normal_balance, parent_id, branch_id, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.code, body.name, body.account_type, normalBalance,
    body.parent_id || null, body.branch_id || null, body.description || null).run();

  const row = await c.env.DB.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

accounting.patch('/chart-of-accounts/:id', requirePermissions(['manage_purchasing']), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<{ name?: string; description?: string; is_active?: number }>();
  const fields: string[] = [];
  const vals: any[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); vals.push(body.name); }
  if (body.description !== undefined) { fields.push('description = ?'); vals.push(body.description); }
  if (body.is_active !== undefined) { fields.push('is_active = ?'); vals.push(body.is_active); }
  if (!fields.length) return c.json({ error: 'Nothing to update' }, 400);
  vals.push(id);
  await c.env.DB.prepare(`UPDATE chart_of_accounts SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ══════════════════════════════════════════════════════════
// JOURNAL ENTRIES
// ══════════════════════════════════════════════════════════
accounting.get('/journal-entries', requirePermissions(['view_reports']), async (c) => {
  const status = c.req.query('status') || null;
  const periodId = c.req.query('period_id') || null;
  const branchId = c.req.query('branch_id') || null;
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  let query = `
    SELECT je.*, fp.name AS period_name, b.name AS branch_name,
           u.full_name AS created_by_name, pu.full_name AS posted_by_name
    FROM journal_entries je
    LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
    LEFT JOIN branches b ON b.id = je.branch_id
    LEFT JOIN users u ON u.id = je.created_by
    LEFT JOIN users pu ON pu.id = je.posted_by
    WHERE 1=1
  `;
  const params: any[] = [];
  if (status) { query += ' AND je.status = ?'; params.push(status); }
  if (periodId) { query += ' AND je.fiscal_period_id = ?'; params.push(periodId); }
  if (branchId) { query += ' AND je.branch_id = ?'; params.push(branchId); }
  query += ' ORDER BY je.entry_date DESC, je.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results || []);
});

accounting.get('/journal-entries/:id', requirePermissions(['view_reports']), async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare(`
    SELECT je.*, fp.name AS period_name, b.name AS branch_name,
           u.full_name AS created_by_name, pu.full_name AS posted_by_name
    FROM journal_entries je
    LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
    LEFT JOIN branches b ON b.id = je.branch_id
    LEFT JOIN users u ON u.id = je.created_by
    LEFT JOIN users pu ON pu.id = je.posted_by
    WHERE je.id = ?
  `).bind(id).first();

  if (!entry) return c.json({ error: 'Journal entry not found' }, 404);

  const { results: lines } = await c.env.DB.prepare(`
    SELECT jel.*, coa.code AS account_code, coa.name AS account_name,
           coa.account_type, b.name AS branch_name
    FROM journal_entry_lines jel
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    LEFT JOIN branches b ON b.id = jel.branch_id
    WHERE jel.journal_entry_id = ?
    ORDER BY jel.line_order ASC
  `).bind(id).all();

  return c.json({ ...entry, lines: lines || [] });
});

accounting.post('/journal-entries', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json<{
    fiscal_period_id?: string;
    entry_date: string;
    description: string;
    reference_type?: string;
    reference_id?: string;
    branch_id?: string;
    notes?: string;
    lines: Array<{
      account_id: string;
      description?: string;
      debit_amount: number;
      credit_amount: number;
      branch_id?: string;
    }>;
  }>();

  if (!body.entry_date || !body.description || !body.lines || body.lines.length < 2) {
    return c.json({ error: 'entry_date, description, and at least 2 lines are required' }, 400);
  }

  // Validate balanced entry
  const totalDebit = body.lines.reduce((s, l) => s + (l.debit_amount || 0), 0);
  const totalCredit = body.lines.reduce((s, l) => s + (l.credit_amount || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.005) {
    return c.json({ error: `Journal entry is not balanced. Debits (${totalDebit.toFixed(2)}) ≠ Credits (${totalCredit.toFixed(2)})` }, 422);
  }

  // Get next sequence for entry number
  const countRes = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM journal_entries').first() as any;
  const seq = (Number(countRes?.cnt || 0)) + 1;
  const entryNumber = generateEntryNumber(seq);
  const entryId = generateId();
  const userId = (c as any).get('userId') || null;

  await c.env.DB.prepare(`
    INSERT INTO journal_entries
      (id, entry_number, fiscal_period_id, entry_date, description, reference_type, reference_id,
       branch_id, status, total_debit, total_credit, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
  `).bind(entryId, entryNumber,
    body.fiscal_period_id || null, body.entry_date, body.description,
    body.reference_type || null, body.reference_id || null,
    body.branch_id || null, totalDebit, totalCredit, body.notes || null, userId).run();

  // Insert lines
  const lineStmts = body.lines.map((line, idx) => {
    const lineId = generateId();
    return c.env.DB.prepare(`
      INSERT INTO journal_entry_lines
        (id, journal_entry_id, account_id, description, debit_amount, credit_amount, branch_id, line_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(lineId, entryId, line.account_id, line.description || null,
      line.debit_amount || 0, line.credit_amount || 0, line.branch_id || null, idx);
  });

  await c.env.DB.batch(lineStmts);

  const row = await c.env.DB.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(entryId).first();
  return c.json(row, 201);
});

accounting.post('/journal-entries/:id/post', requirePermissions(['manage_purchasing']), async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first() as any;
  if (!entry) return c.json({ error: 'Journal entry not found' }, 404);
  if (entry.status === 'POSTED') return c.json({ error: 'Entry is already posted' }, 409);
  if (entry.status === 'REVERSED') return c.json({ error: 'Reversed entries cannot be re-posted' }, 409);

  const userId = (c as any).get('userId') || null;
  const now = new Date().toISOString();

  // Fetch lines to build general ledger
  const { results: lines } = await c.env.DB.prepare(`
    SELECT jel.*, coa.normal_balance
    FROM journal_entry_lines jel
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE jel.journal_entry_id = ?
    ORDER BY jel.line_order ASC
  `).bind(id).all() as { results: any[] };

  // For each line, compute running balance and insert into general_ledger
  const glStmts = (lines || []).map(async (line: any) => {
    // Get current running balance for this account
    const lastBalance = await c.env.DB.prepare(`
      SELECT running_balance FROM general_ledger
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(line.account_id).first() as any;

    let runningBalance = Number(lastBalance?.running_balance || 0);
    if (line.normal_balance === 'DEBIT') {
      runningBalance += (line.debit_amount - line.credit_amount);
    } else {
      runningBalance += (line.credit_amount - line.debit_amount);
    }

    const glId = generateId();
    return c.env.DB.prepare(`
      INSERT INTO general_ledger
        (id, account_id, journal_entry_id, line_id, entry_date, description,
         debit_amount, credit_amount, running_balance, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(glId, line.account_id, id, line.id, entry.entry_date,
      entry.description, line.debit_amount, line.credit_amount, runningBalance, line.branch_id || null);
  });

  const resolvedGlStmts = await Promise.all(glStmts);
  await c.env.DB.batch([
    ...resolvedGlStmts,
    c.env.DB.prepare(`
      UPDATE journal_entries SET status = 'POSTED', posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?
    `).bind(userId, now, now, id)
  ]);

  const updated = await c.env.DB.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first();
  return c.json(updated);
});

accounting.post('/journal-entries/:id/reverse', requirePermissions(['manage_purchasing']), async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first() as any;
  if (!entry) return c.json({ error: 'Entry not found' }, 404);
  if (entry.status !== 'POSTED') return c.json({ error: 'Only POSTED entries can be reversed' }, 409);

  const { results: lines } = await c.env.DB.prepare(
    'SELECT * FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY line_order ASC'
  ).bind(id).all() as { results: any[] };

  const userId = (c as any).get('userId') || null;
  const countRes = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM journal_entries').first() as any;
  const seq = (Number(countRes?.cnt || 0)) + 1;
  const revEntryNumber = generateEntryNumber(seq);
  const revId = generateId();
  const today = new Date().toISOString().split('T')[0];

  await c.env.DB.prepare(`
    INSERT INTO journal_entries
      (id, entry_number, fiscal_period_id, entry_date, description, reference_type, reference_id,
       branch_id, status, total_debit, total_credit, notes, created_by)
    VALUES (?, ?, ?, ?, ?, 'MANUAL', ?, ?, 'POSTED', ?, ?, ?, ?)
  `).bind(revId, revEntryNumber, entry.fiscal_period_id || null, today,
    `REVERSAL of ${entry.entry_number}: ${entry.description}`,
    id, entry.branch_id || null, entry.total_credit, entry.total_debit,
    `Auto-reversal of entry ${entry.entry_number}`, userId).run();

  const lineStmts = (lines || []).map((line: any, idx: number) => {
    const lineId = generateId();
    return c.env.DB.prepare(`
      INSERT INTO journal_entry_lines
        (id, journal_entry_id, account_id, description, debit_amount, credit_amount, branch_id, line_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(lineId, revId, line.account_id, `Reversal: ${line.description || ''}`,
      line.credit_amount, line.debit_amount, line.branch_id || null, idx);
  });

  await c.env.DB.batch([
    ...lineStmts,
    c.env.DB.prepare("UPDATE journal_entries SET status = 'REVERSED', updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), id)
  ]);

  const rev = await c.env.DB.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(revId).first();
  return c.json(rev, 201);
});

// ══════════════════════════════════════════════════════════
// GENERAL LEDGER
// ══════════════════════════════════════════════════════════
accounting.get('/general-ledger', requirePermissions(['view_reports']), async (c) => {
  const accountId = c.req.query('account_id') || null;
  const branchId = c.req.query('branch_id') || null;
  const fromDate = c.req.query('from_date') || null;
  const toDate = c.req.query('to_date') || null;

  let query = `
    SELECT gl.*, coa.code AS account_code, coa.name AS account_name, coa.account_type,
           je.entry_number, b.name AS branch_name
    FROM general_ledger gl
    JOIN chart_of_accounts coa ON coa.id = gl.account_id
    JOIN journal_entries je ON je.id = gl.journal_entry_id
    LEFT JOIN branches b ON b.id = gl.branch_id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (accountId) { query += ' AND gl.account_id = ?'; params.push(accountId); }
  if (branchId) { query += ' AND gl.branch_id = ?'; params.push(branchId); }
  if (fromDate) { query += ' AND gl.entry_date >= ?'; params.push(fromDate); }
  if (toDate) { query += ' AND gl.entry_date <= ?'; params.push(toDate); }
  query += ' ORDER BY gl.account_id ASC, gl.entry_date ASC, gl.created_at ASC';
  query += ' LIMIT 500';

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json(results || []);
});

// ══════════════════════════════════════════════════════════
// TRIAL BALANCE (Computed live from journal entry lines)
// ══════════════════════════════════════════════════════════
accounting.get('/trial-balance', requirePermissions(['view_reports']), async (c) => {
  const periodId = c.req.query('period_id') || null;
  const type = (c.req.query('type') || 'UNADJUSTED').toUpperCase(); // UNADJUSTED | ADJUSTED | POST_CLOSING

  // For UNADJUSTED: exclude CLOSING entries
  // For ADJUSTED: include DEPRECIATION + ADJUSTING
  // For POST_CLOSING: only permanent accounts remain (assets, liabilities, equity)
  let statusFilter = "je.status = 'POSTED'";
  let typeFilter = '';

  if (type === 'UNADJUSTED') {
    typeFilter = "AND (je.reference_type IS NULL OR je.reference_type NOT IN ('CLOSING'))";
  } else if (type === 'POST_CLOSING') {
    typeFilter = "AND coa.account_type IN ('ASSET', 'LIABILITY', 'EQUITY')";
  }

  let periodFilter = '';
  const params: any[] = [];
  if (periodId) {
    periodFilter = `AND je.fiscal_period_id = ?`;
    params.push(periodId);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      coa.id AS account_id,
      coa.code,
      coa.name AS account_name,
      coa.account_type,
      coa.normal_balance,
      COALESCE(SUM(jel.debit_amount), 0) AS total_debit,
      COALESCE(SUM(jel.credit_amount), 0) AS total_credit,
      CASE
        WHEN coa.normal_balance = 'DEBIT'
          THEN COALESCE(SUM(jel.debit_amount), 0) - COALESCE(SUM(jel.credit_amount), 0)
        ELSE
          COALESCE(SUM(jel.credit_amount), 0) - COALESCE(SUM(jel.debit_amount), 0)
      END AS net_balance
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE ${statusFilter} ${typeFilter} ${periodFilter}
      AND coa.is_active = 1
    GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.normal_balance
    HAVING SUM(jel.debit_amount) > 0 OR SUM(jel.credit_amount) > 0
    ORDER BY coa.code ASC
  `).bind(...params).all();

  const rows = results || [];
  const grandDebit = rows.reduce((s: number, r: any) => s + Number(r.total_debit), 0);
  const grandCredit = rows.reduce((s: number, r: any) => s + Number(r.total_credit), 0);

  return c.json({
    type,
    period_id: periodId,
    accounts: rows,
    totals: {
      grand_debit: grandDebit,
      grand_credit: grandCredit,
      is_balanced: Math.abs(grandDebit - grandCredit) < 0.01
    }
  });
});

// ══════════════════════════════════════════════════════════
// INCOME STATEMENT (Periodic Inventory — COGS via physical count)
// ══════════════════════════════════════════════════════════
accounting.get('/income-statement', requirePermissions(['view_reports']), async (c) => {
  const periodId = c.req.query('period_id') || null;
  const params: any[] = [];
  let periodFilter = '';
  if (periodId) { periodFilter = 'AND je.fiscal_period_id = ?'; params.push(periodId); }

  // Revenue per branch
  const { results: revenue } = await c.env.DB.prepare(`
    SELECT coa.name, coa.code, coa.account_type, b.name AS branch_name, b.id AS branch_id,
           COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) AS amount
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${periodFilter}
    LEFT JOIN branches b ON b.id = jel.branch_id
    WHERE coa.account_type = 'REVENUE'
    GROUP BY coa.id, coa.name, coa.code, b.id, b.name
    ORDER BY coa.code ASC
  `).bind(...params).all();

  // COGS per branch
  const { results: cogs } = await c.env.DB.prepare(`
    SELECT coa.name, coa.code, coa.account_type, b.name AS branch_name, b.id AS branch_id,
           COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS amount
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${periodFilter}
    LEFT JOIN branches b ON b.id = jel.branch_id
    WHERE coa.account_type = 'COGS'
    GROUP BY coa.id, coa.name, coa.code, b.id, b.name
    ORDER BY coa.code ASC
  `).bind(...params).all();

  // Expenses per branch
  const { results: expenses } = await c.env.DB.prepare(`
    SELECT coa.name, coa.code, coa.account_type, b.name AS branch_name, b.id AS branch_id,
           COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS amount
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${periodFilter}
    LEFT JOIN branches b ON b.id = jel.branch_id
    WHERE coa.account_type = 'EXPENSE'
    GROUP BY coa.id, coa.name, coa.code, b.id, b.name
    ORDER BY coa.code ASC
  `).bind(...params).all();

  // Inventory counts (for periodic COGS adjustment)
  const { results: inventoryCounts } = await c.env.DB.prepare(`
    SELECT ipc.*, b.name AS branch_name
    FROM inventory_period_counts ipc
    LEFT JOIN branches b ON b.id = ipc.branch_id
    WHERE ipc.status = 'APPROVED' ${periodId ? 'AND ipc.fiscal_period_id = ?' : ''}
    ORDER BY ipc.count_date DESC
  `).bind(...(periodId ? [periodId] : [])).all();

  const totalRevenue = (revenue || []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const totalCogs = (cogs || []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const totalExpenses = (expenses || []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const grossProfit = totalRevenue - totalCogs;
  const netIncome = grossProfit - totalExpenses;

  return c.json({
    period_id: periodId,
    revenue: revenue || [],
    cogs: cogs || [],
    expenses: expenses || [],
    inventory_counts: inventoryCounts || [],
    summary: {
      total_revenue: totalRevenue,
      total_cogs: totalCogs,
      gross_profit: grossProfit,
      total_expenses: totalExpenses,
      net_income: netIncome,
      gross_margin_pct: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
      net_margin_pct: totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0
    }
  });
});

// ══════════════════════════════════════════════════════════
// BALANCE SHEET
// ══════════════════════════════════════════════════════════
accounting.get('/balance-sheet', requirePermissions(['view_reports']), async (c) => {
  const periodId = c.req.query('period_id') || null;
  const params: any[] = [];
  let periodFilter = '';
  if (periodId) { periodFilter = 'AND je.fiscal_period_id = ?'; params.push(periodId); }

  const { results: accounts } = await c.env.DB.prepare(`
    SELECT coa.id, coa.code, coa.name AS account_name, coa.account_type, coa.normal_balance,
           b.name AS branch_name, b.id AS branch_id,
           COALESCE(SUM(jel.debit_amount), 0) AS total_debit,
           COALESCE(SUM(jel.credit_amount), 0) AS total_credit,
           CASE
             WHEN coa.normal_balance = 'DEBIT'
               THEN COALESCE(SUM(jel.debit_amount), 0) - COALESCE(SUM(jel.credit_amount), 0)
             ELSE
               COALESCE(SUM(jel.credit_amount), 0) - COALESCE(SUM(jel.debit_amount), 0)
           END AS balance
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${periodFilter}
    LEFT JOIN branches b ON b.id = jel.branch_id
    WHERE coa.account_type IN ('ASSET', 'LIABILITY', 'EQUITY') AND coa.is_active = 1
    GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.normal_balance, b.id, b.name
    ORDER BY coa.code ASC
  `).bind(...params).all();

  const rows = accounts || [];
  const assets = rows.filter((r: any) => r.account_type === 'ASSET');
  const liabilities = rows.filter((r: any) => r.account_type === 'LIABILITY');
  const equity = rows.filter((r: any) => r.account_type === 'EQUITY');

  const totalAssets = assets.reduce((s: number, r: any) => s + Number(r.balance), 0);
  const totalLiabilities = liabilities.reduce((s: number, r: any) => s + Number(r.balance), 0);
  const totalEquity = equity.reduce((s: number, r: any) => s + Number(r.balance), 0);

  return c.json({
    period_id: periodId,
    assets,
    liabilities,
    equity,
    totals: {
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      total_equity: totalEquity,
      total_liabilities_and_equity: totalLiabilities + totalEquity,
      is_balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
    }
  });
});

// ══════════════════════════════════════════════════════════
// CASH FLOW STATEMENT (Direct Method — from journal entries)
// ══════════════════════════════════════════════════════════
accounting.get('/cash-flow', requirePermissions(['view_reports']), async (c) => {
  const periodId = c.req.query('period_id') || null;
  const params: any[] = [];
  let periodFilter = '';
  if (periodId) { periodFilter = 'AND je.fiscal_period_id = ?'; params.push(periodId); }

  // Cash collected (revenue collections via cash account debits)
  const cashAcctId = 'coa-1010';
  const { results: cashRows } = await c.env.DB.prepare(`
    SELECT
      je.reference_type,
      COALESCE(SUM(jel.debit_amount), 0) AS cash_in,
      COALESCE(SUM(jel.credit_amount), 0) AS cash_out
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${periodFilter}
    WHERE jel.account_id = ?
    GROUP BY je.reference_type
  `).bind(...params, cashAcctId).all();

  const cashIn = (cashRows || []).reduce((s: number, r: any) => s + Number(r.cash_in), 0);
  const cashOut = (cashRows || []).reduce((s: number, r: any) => s + Number(r.cash_out), 0);
  const netCash = cashIn - cashOut;

  // Cash balance from GL
  const balRes = await c.env.DB.prepare(`
    SELECT running_balance FROM general_ledger
    WHERE account_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(cashAcctId).first() as any;

  return c.json({
    period_id: periodId,
    operating_activities: cashRows || [],
    summary: {
      total_cash_in: cashIn,
      total_cash_out: cashOut,
      net_cash_from_operations: netCash,
      ending_cash_balance: Number(balRes?.running_balance || 0)
    }
  });
});

// ══════════════════════════════════════════════════════════
// OWNER'S EQUITY STATEMENT
// ══════════════════════════════════════════════════════════
accounting.get('/owners-equity', requirePermissions(['view_reports']), async (c) => {
  const periodId = c.req.query('period_id') || null;
  const params: any[] = [];
  let periodFilter = '';
  if (periodId) { periodFilter = 'AND je.fiscal_period_id = ?'; params.push(periodId); }

  const { results: equityRows } = await c.env.DB.prepare(`
    SELECT coa.id, coa.code, coa.name AS account_name, coa.account_type, coa.normal_balance,
           COALESCE(SUM(jel.debit_amount), 0) AS total_debit,
           COALESCE(SUM(jel.credit_amount), 0) AS total_credit,
           CASE
             WHEN coa.normal_balance = 'DEBIT'
               THEN COALESCE(SUM(jel.debit_amount), 0) - COALESCE(SUM(jel.credit_amount), 0)
             ELSE
               COALESCE(SUM(jel.credit_amount), 0) - COALESCE(SUM(jel.debit_amount), 0)
           END AS balance
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${periodFilter}
    WHERE coa.account_type = 'EQUITY' AND coa.is_active = 1
    GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.normal_balance
    ORDER BY coa.code ASC
  `).bind(...params).all();

  const rows = equityRows || [];
  const capital = rows.find((r: any) => r.code === '3010');
  const retained = rows.find((r: any) => r.code === '3020');
  const drawings = rows.find((r: any) => r.code === '3040');

  // Net income from income statement
  let netIncomeParams: any[] = [];
  let netIncomePFilter = '';
  if (periodId) { netIncomePFilter = 'AND je.fiscal_period_id = ?'; netIncomeParams.push(periodId); }
  const { results: revenueRows } = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) AS total
    FROM chart_of_accounts coa
    JOIN journal_entry_lines jel ON jel.account_id = coa.id
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${netIncomePFilter}
    WHERE coa.account_type = 'REVENUE'
  `).bind(...netIncomeParams).all();
  const { results: expenseRows } = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS total
    FROM chart_of_accounts coa
    JOIN journal_entry_lines jel ON jel.account_id = coa.id
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${netIncomePFilter}
    WHERE coa.account_type IN ('EXPENSE', 'COGS')
  `).bind(...netIncomeParams).all();

  const totalRevenue = Number((revenueRows?.[0] as any)?.total || 0);
  const totalExpenses = Number((expenseRows?.[0] as any)?.total || 0);
  const netIncome = totalRevenue - totalExpenses;

  const beginCapital = Number(capital?.balance || 0);
  const drawingsAmt = Number(drawings?.balance || 0);
  const endingEquity = beginCapital + netIncome - drawingsAmt;

  return c.json({
    period_id: periodId,
    equity_accounts: rows,
    statement: {
      beginning_capital: beginCapital,
      add_net_income: netIncome,
      less_drawings: drawingsAmt,
      ending_owner_equity: endingEquity
    }
  });
});

// ══════════════════════════════════════════════════════════
// PHYSICAL INVENTORY COUNTS (Periodic System)
// ══════════════════════════════════════════════════════════
accounting.get('/inventory-counts', requirePermissions(['view_reports']), async (c) => {
  const periodId = c.req.query('period_id') || null;
  let query = `
    SELECT ipc.*, fp.name AS period_name, b.name AS branch_name, w.name AS warehouse_name,
           u.full_name AS counted_by_name, au.full_name AS approved_by_name
    FROM inventory_period_counts ipc
    LEFT JOIN fiscal_periods fp ON fp.id = ipc.fiscal_period_id
    LEFT JOIN branches b ON b.id = ipc.branch_id
    LEFT JOIN warehouses w ON w.id = ipc.warehouse_id
    LEFT JOIN users u ON u.id = ipc.counted_by
    LEFT JOIN users au ON au.id = ipc.approved_by
    WHERE 1=1
  `;
  const params: any[] = [];
  if (periodId) { query += ' AND ipc.fiscal_period_id = ?'; params.push(periodId); }
  query += ' ORDER BY ipc.count_date DESC';

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json(results || []);
});

accounting.post('/inventory-counts', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json<{
    fiscal_period_id: string;
    branch_id?: string;
    warehouse_id?: string;
    count_date: string;
    total_value: number;
    notes?: string;
  }>();

  if (!body.fiscal_period_id || !body.count_date || body.total_value === undefined) {
    return c.json({ error: 'fiscal_period_id, count_date, and total_value are required' }, 400);
  }

  const id = generateId();
  const userId = (c as any).get('userId') || null;

  await c.env.DB.prepare(`
    INSERT INTO inventory_period_counts
      (id, fiscal_period_id, branch_id, warehouse_id, count_date, total_value, notes, counted_by, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
  `).bind(id, body.fiscal_period_id, body.branch_id || null, body.warehouse_id || null,
    body.count_date, body.total_value, body.notes || null, userId).run();

  const row = await c.env.DB.prepare('SELECT * FROM inventory_period_counts WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

accounting.patch('/inventory-counts/:id/approve', requirePermissions(['manage_purchasing']), async (c) => {
  const { id } = c.req.param();
  const userId = (c as any).get('userId') || null;
  await c.env.DB.prepare(`
    UPDATE inventory_period_counts SET status = 'APPROVED', approved_by = ? WHERE id = ?
  `).bind(userId, id).run();
  const row = await c.env.DB.prepare('SELECT * FROM inventory_period_counts WHERE id = ?').bind(id).first();
  return c.json(row);
});

// ══════════════════════════════════════════════════════════
// DEPRECIATION SCHEDULES
// ══════════════════════════════════════════════════════════
accounting.get('/depreciation', requirePermissions(['view_reports']), async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT ds.*, fp.name AS period_name,
           aa.name AS asset_account_name, ad.name AS accum_dep_account_name,
           de.name AS dep_expense_account_name, u.full_name AS created_by_name
    FROM depreciation_schedules ds
    LEFT JOIN fiscal_periods fp ON fp.id = ds.fiscal_period_id
    LEFT JOIN chart_of_accounts aa ON aa.id = ds.asset_account_id
    LEFT JOIN chart_of_accounts ad ON ad.id = ds.accum_dep_account_id
    LEFT JOIN chart_of_accounts de ON de.id = ds.dep_expense_account_id
    LEFT JOIN users u ON u.id = ds.created_by
    ORDER BY ds.created_at DESC
  `).all();
  return c.json(results || []);
});

accounting.post('/depreciation', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json<{
    asset_name: string;
    asset_account_id?: string;
    accum_dep_account_id?: string;
    dep_expense_account_id?: string;
    acquisition_date: string;
    cost: number;
    salvage_value?: number;
    useful_life_years: number;
    method?: string;
    fiscal_period_id?: string;
    period_depreciation: number;
    notes?: string;
  }>();

  if (!body.asset_name || !body.acquisition_date || !body.cost || !body.useful_life_years || body.period_depreciation === undefined) {
    return c.json({ error: 'asset_name, acquisition_date, cost, useful_life_years, period_depreciation are required' }, 400);
  }

  const id = generateId();
  const userId = (c as any).get('userId') || null;

  await c.env.DB.prepare(`
    INSERT INTO depreciation_schedules
      (id, asset_name, asset_account_id, accum_dep_account_id, dep_expense_account_id,
       acquisition_date, cost, salvage_value, useful_life_years, method,
       fiscal_period_id, period_depreciation, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.asset_name,
    body.asset_account_id || 'coa-1500', body.accum_dep_account_id || 'coa-1501',
    body.dep_expense_account_id || 'coa-6060',
    body.acquisition_date, body.cost, body.salvage_value || 0,
    body.useful_life_years, body.method || 'STRAIGHT_LINE',
    body.fiscal_period_id || null, body.period_depreciation,
    body.notes || null, userId).run();

  // Create posted journal entry and general ledger entries for depreciation
  if (body.period_depreciation > 0) {
    try {
      const jeId = generateId();
      const jeNum = `JE-DEP-${Date.now()}`;
      const accumDepAcc = body.accum_dep_account_id || 'coa-1501';
      const expAcc = body.dep_expense_account_id || 'coa-6060';

      await c.env.DB.prepare(`
        INSERT INTO journal_entries
          (id, entry_number, fiscal_period_id, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by)
        VALUES (?, ?, ?, ?, ?, 'DEPRECIATION', ?, 'POSTED', ?, ?, ?)
      `).bind(jeId, jeNum, body.fiscal_period_id || null, body.acquisition_date, `Depreciation: ${body.asset_name}`, id, body.period_depreciation, body.period_depreciation, userId).run();

      const line1Id = generateId();
      const line2Id = generateId();
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit_amount, credit_amount, line_order) VALUES (?, ?, ?, ?, ?, 0, 1)`).bind(line1Id, jeId, expAcc, `Depreciation Expense: ${body.asset_name}`, body.period_depreciation),
        c.env.DB.prepare(`INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit_amount, credit_amount, line_order) VALUES (?, ?, ?, ?, 0, ?, 2)`).bind(line2Id, jeId, accumDepAcc, `Accumulated Depreciation: ${body.asset_name}`, body.period_depreciation),
        c.env.DB.prepare(`INSERT INTO general_ledger (id, account_id, journal_entry_id, line_id, entry_date, description, debit_amount, credit_amount, running_balance) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`).bind(generateId(), expAcc, jeId, line1Id, body.acquisition_date, `Depreciation Expense: ${body.asset_name}`, body.period_depreciation, body.period_depreciation),
        c.env.DB.prepare(`INSERT INTO general_ledger (id, account_id, journal_entry_id, line_id, entry_date, description, debit_amount, credit_amount, running_balance) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).bind(generateId(), accumDepAcc, jeId, line2Id, body.acquisition_date, `Accumulated Depreciation: ${body.asset_name}`, body.period_depreciation, body.period_depreciation),
      ]);
    } catch (depErr) {
      console.error('Failed to post depreciation GL entry:', depErr);
    }
  }

  const row = await c.env.DB.prepare('SELECT * FROM depreciation_schedules WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

// ══════════════════════════════════════════════════════════
// AUTO-GENERATE CLOSING ENTRIES (Year-End)
// ══════════════════════════════════════════════════════════
accounting.post('/closing-entries', requirePermissions(['manage_purchasing']), async (c) => {
  const { fiscal_period_id } = await c.req.json<{ fiscal_period_id: string }>();
  if (!fiscal_period_id) return c.json({ error: 'fiscal_period_id is required' }, 400);

  const period = await c.env.DB.prepare('SELECT * FROM fiscal_periods WHERE id = ?').bind(fiscal_period_id).first() as any;
  if (!period) return c.json({ error: 'Fiscal period not found' }, 404);

  const userId = (c as any).get('userId') || null;

  // Get all revenue account balances for this period
  const { results: revenues } = await c.env.DB.prepare(`
    SELECT coa.id AS account_id, coa.code, coa.name,
           COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) AS balance
    FROM chart_of_accounts coa
    JOIN journal_entry_lines jel ON jel.account_id = coa.id
    JOIN journal_entries je ON je.id = jel.journal_entry_id
      AND je.status = 'POSTED' AND je.fiscal_period_id = ?
    WHERE coa.account_type = 'REVENUE' AND coa.is_active = 1
    GROUP BY coa.id, coa.code, coa.name
    HAVING COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) > 0
  `).bind(fiscal_period_id).all() as { results: any[] };

  const { results: expenses } = await c.env.DB.prepare(`
    SELECT coa.id AS account_id, coa.code, coa.name,
           COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS balance
    FROM chart_of_accounts coa
    JOIN journal_entry_lines jel ON jel.account_id = coa.id
    JOIN journal_entries je ON je.id = jel.journal_entry_id
      AND je.status = 'POSTED' AND je.fiscal_period_id = ?
    WHERE coa.account_type IN ('EXPENSE', 'COGS') AND coa.is_active = 1
    GROUP BY coa.id, coa.code, coa.name
    HAVING COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) > 0
  `).bind(fiscal_period_id).all() as { results: any[] };

  const totalRevenue = (revenues || []).reduce((s: number, r: any) => s + Number(r.balance), 0);
  const totalExpenses = (expenses || []).reduce((s: number, r: any) => s + Number(r.balance), 0);
  const netIncome = totalRevenue - totalExpenses;

  const closeDate = period.end_date;
  const countRes = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM journal_entries').first() as any;
  let seq = Number(countRes?.cnt || 0);

  const createdEntries: any[] = [];

  // Entry 1: Close Revenues → Income Summary
  if ((revenues || []).length > 0) {
    seq++;
    const je1Id = generateId();
    const lines1 = [
      ...(revenues || []).map((r: any, i: number) => ({
        id: generateId(), account_id: r.account_id, description: `Close Revenue: ${r.name}`,
        debit_amount: Number(r.balance), credit_amount: 0, order: i
      })),
      {
        id: generateId(), account_id: 'coa-3030', description: 'Income Summary — Revenue Closed',
        debit_amount: 0, credit_amount: totalRevenue, order: (revenues || []).length
      }
    ];

    await c.env.DB.prepare(`
      INSERT INTO journal_entries
        (id, entry_number, fiscal_period_id, entry_date, description, reference_type, status, total_debit, total_credit, created_by)
      VALUES (?, ?, ?, ?, 'Close Revenue Accounts to Income Summary', 'CLOSING', 'POSTED', ?, ?, ?)
    `).bind(je1Id, generateEntryNumber(seq), fiscal_period_id, closeDate, totalRevenue, totalRevenue, userId).run();

    const lineStmts1 = lines1.map((l: any) => c.env.DB.prepare(`
      INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit_amount, credit_amount, line_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(l.id, je1Id, l.account_id, l.description, l.debit_amount, l.credit_amount, l.order));
    await c.env.DB.batch(lineStmts1);
    createdEntries.push({ entry_number: generateEntryNumber(seq), description: 'Close Revenues', amount: totalRevenue });
  }

  // Entry 2: Close Expenses → Income Summary
  if ((expenses || []).length > 0) {
    seq++;
    const je2Id = generateId();
    const lines2 = [
      {
        id: generateId(), account_id: 'coa-3030', description: 'Income Summary — Expenses Closed',
        debit_amount: totalExpenses, credit_amount: 0, order: 0
      },
      ...(expenses || []).map((e: any, i: number) => ({
        id: generateId(), account_id: e.account_id, description: `Close Expense: ${e.name}`,
        debit_amount: 0, credit_amount: Number(e.balance), order: i + 1
      }))
    ];

    await c.env.DB.prepare(`
      INSERT INTO journal_entries
        (id, entry_number, fiscal_period_id, entry_date, description, reference_type, status, total_debit, total_credit, created_by)
      VALUES (?, ?, ?, ?, 'Close Expense & COGS Accounts to Income Summary', 'CLOSING', 'POSTED', ?, ?, ?)
    `).bind(je2Id, generateEntryNumber(seq), fiscal_period_id, closeDate, totalExpenses, totalExpenses, userId).run();

    const lineStmts2 = lines2.map((l: any) => c.env.DB.prepare(`
      INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit_amount, credit_amount, line_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(l.id, je2Id, l.account_id, l.description, l.debit_amount, l.credit_amount, l.order));
    await c.env.DB.batch(lineStmts2);
    createdEntries.push({ entry_number: generateEntryNumber(seq), description: 'Close Expenses & COGS', amount: totalExpenses });
  }

  // Entry 3: Close Income Summary → Retained Earnings
  if (Math.abs(netIncome) > 0.01) {
    seq++;
    const je3Id = generateId();
    const isProfit = netIncome > 0;
    await c.env.DB.prepare(`
      INSERT INTO journal_entries
        (id, entry_number, fiscal_period_id, entry_date, description, reference_type, status, total_debit, total_credit, created_by)
      VALUES (?, ?, ?, ?, 'Close Income Summary to Retained Earnings', 'CLOSING', 'POSTED', ?, ?, ?)
    `).bind(je3Id, generateEntryNumber(seq), fiscal_period_id, closeDate, Math.abs(netIncome), Math.abs(netIncome), userId).run();

    const summaryLineId = generateId();
    const retainedLineId = generateId();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit_amount, credit_amount, line_order) VALUES (?, ?, ?, ?, ?, ?, 0)`)
        .bind(summaryLineId, je3Id, 'coa-3030', 'Income Summary — Net ' + (isProfit ? 'Income' : 'Loss'),
          isProfit ? Math.abs(netIncome) : 0, isProfit ? 0 : Math.abs(netIncome)),
      c.env.DB.prepare(`INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit_amount, credit_amount, line_order) VALUES (?, ?, ?, ?, ?, ?, 1)`)
        .bind(retainedLineId, je3Id, 'coa-3020', 'Retained Earnings — Net ' + (isProfit ? 'Income' : 'Loss'),
          isProfit ? 0 : Math.abs(netIncome), isProfit ? Math.abs(netIncome) : 0)
    ]);
    createdEntries.push({ entry_number: generateEntryNumber(seq), description: 'Close Income Summary → Retained Earnings', amount: netIncome });
  }

  return c.json({
    message: 'Year-end closing entries generated successfully',
    period: period.name,
    net_income: netIncome,
    entries_created: createdEntries
  });
});

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// DASHBOARD SUMMARY & GL RECONCILIATION
// ══════════════════════════════════════════════════════════
accounting.post('/reconcile-journals', requirePermissions(['manage_purchasing']), async (c) => {
  const count = await reconcileMissingSalesJournalEntries(c);
  return c.json({ success: true, reconciled_entries: count });
});

accounting.get('/dashboard', requirePermissions(['view_reports']), async (c) => {
  // Auto-reconcile any sales that completed before GL entries were created
  await reconcileMissingSalesJournalEntries(c).catch(() => 0);

  const rawPeriodId = c.req.query('period_id');
  const periodId = (rawPeriodId && rawPeriodId !== 'ALL' && rawPeriodId !== 'undefined') ? rawPeriodId : null;
  const params: any[] = [];
  let pf = '';
  if (periodId) {
    pf = 'AND (je.fiscal_period_id = ? OR je.fiscal_period_id IS NULL)';
    params.push(periodId);
  }

  const [jeCount, postedCount, revenueRes, expenseRes, periods, accounts] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM journal_entries WHERE 1=1 ${periodId ? 'AND (fiscal_period_id = ? OR fiscal_period_id IS NULL)' : ''}`).bind(...(periodId ? [periodId] : [])).first(),
    c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM journal_entries WHERE status = 'POSTED' ${periodId ? 'AND (fiscal_period_id = ? OR fiscal_period_id IS NULL)' : ''}`).bind(...(periodId ? [periodId] : [])).first(),
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) AS total
      FROM chart_of_accounts coa
      JOIN journal_entry_lines jel ON jel.account_id = coa.id
      JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${pf}
      WHERE coa.account_type = 'REVENUE'
    `).bind(...params).first(),
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS total
      FROM chart_of_accounts coa
      JOIN journal_entry_lines jel ON jel.account_id = coa.id
      JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'POSTED' ${pf}
      WHERE coa.account_type IN ('EXPENSE', 'COGS')
    `).bind(...params).first(),
    c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM fiscal_periods').first(),
    c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM chart_of_accounts WHERE is_active = 1').first(),
  ]);

  const totalRevenue = Number((revenueRes as any)?.total || 0);
  const totalExpenses = Number((expenseRes as any)?.total || 0);
  const netIncome = totalRevenue - totalExpenses;

  return c.json({
    journal_entries: Number((jeCount as any)?.cnt || 0),
    posted_entries: Number((postedCount as any)?.cnt || 0),
    total_revenue: totalRevenue,
    total_expenses: totalExpenses,
    net_income: netIncome,
    fiscal_periods: Number((periods as any)?.cnt || 0),
    chart_of_accounts: Number((accounts as any)?.cnt || 0),
  });
});

export default accounting;
