// Bank & Cash accounts (Owner request, 9 Nov), like Odoo's Bank and Cash journals.
//
// Each money account (a bank account, ZAAD / eDahab, a Dahabshiil account, a cash drawer) is its
// own ledger account under Cash, coded 1010-NN. Its balance is never stored: it is the sum of its
// posted journal lines, so it can't drift from the books, and the balance sheet, cash flow and
// trial balance stay balanced. The original 1010 is "Main Cash" (all history before this feature).
//
// Moving money between two accounts:  Dr receiving account / Cr paying account (total cash unchanged).
// Opening balance of a new account, either
//   moved out of Main Cash (it was already counted there):  Dr new / Cr 1010
//   or new money not yet in the books:                     Dr new / Cr 3010 Owner's Capital
//
// Mounted inside the Accounting module (accounting.view). Registering accounts and moving money
// need the company view (Owner / accountants); a branch-assigned viewer sees their branch only.
import { uuidv4 } from '../db';
import { prepareJournalEntryPosting } from '../services/accounting-service';
import { createAuditLogStmt } from '../services/audit';
import { resolveBranchScope, branchSql, hasAllBranchAccess, ScopeError } from '../services/branch-scope';

export const MONEY_KINDS = ['BANK', 'MOBILE_MONEY', 'CASH'] as const;
type Kind = typeof MONEY_KINDS[number];

/**
 * Providers offered in the dropdown (Hargeisa). Banks: commercial banks operating in Somaliland;
 * mobile money / money transfer: the services businesses in Hargeisa hold balances with.
 * "Other" lets the Owner type any name, so the list never blocks anyone.
 */
export const MONEY_PROVIDERS: Record<Kind, string[]> = {
  BANK: ['Dahabshil Bank International', 'Premier Bank', 'Amal Bank', 'Darasalaam Bank', 'Wadaag Bank', 'Bank of Somaliland'],
  MOBILE_MONEY: ['ZAAD (Telesom)', 'eDahab (Somtel)', 'Dahabshiil (money transfer)', 'Amal Express'],
  CASH: ['Cash drawer', 'Safe'],
};

const text = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

/** Balance of one ledger account (posted lines only), optionally for one branch's lines. */
async function balanceOf(db: any, coaId: string, branchId?: string | null): Promise<number> {
  const r = await db.prepare(`SELECT COALESCE(SUM(gl.debit_amount - gl.credit_amount), 0) AS bal FROM general_ledger gl WHERE gl.account_id = ?${branchId ? ' AND gl.branch_id = ?' : ''}`)
    .bind(...(branchId ? [coaId, branchId] : [coaId])).first() as any;
  return round2(Number(r?.bal || 0));
}

function requireCompanyView(c: any) {
  if (!hasAllBranchAccess(c.get('jwtPayload'))) throw new ScopeError(403, 'Only the Owner or an accountant can register accounts or move money.');
}

const LIST_SQL = (scopeSql: string) => `
  SELECT ma.*, coa.code AS account_code, b.name AS branch_name,
         COALESCE(bal.balance, 0) AS balance, bal.last_movement
  FROM money_accounts ma
  JOIN chart_of_accounts coa ON coa.id = ma.coa_account_id
  LEFT JOIN branches b ON b.id = ma.branch_id
  LEFT JOIN LATERAL (
    SELECT SUM(gl.debit_amount - gl.credit_amount) AS balance, MAX(gl.entry_date) AS last_movement
    FROM general_ledger gl WHERE gl.account_id = ma.coa_account_id${scopeSql}
  ) bal ON TRUE`;

export function registerMoneyAccounts(app: any) {
  app.get('/money-accounts/providers', (c: any) => c.json({ kinds: MONEY_KINDS, providers: MONEY_PROVIDERS }));

  // All accounts the caller may see, with live balances (from the ledger).
  app.get('/money-accounts', async (c: any) => {
    const scope = await resolveBranchScope(c);
    const scopeSql = branchSql(scope, 'gl.branch_id');
    const own = scope.kind === 'BRANCH' ? ' WHERE (ma.branch_id IS NULL OR ma.branch_id = ?)' : '';
    const { results } = await c.env.DB.prepare(`${LIST_SQL(scopeSql)}${own} ORDER BY ma.is_active DESC, coa.code`)
      .bind(...(scope.kind === 'BRANCH' ? [scope.branchId] : [])).all();
    const rows = ((results || []) as any[]).map((r) => ({ ...r, balance: round2(Number(r.balance || 0)) }));
    const active = rows.filter((r) => Number(r.is_active) === 1);
    const total = round2(active.reduce((a, r) => a + r.balance, 0));
    const byKind = Object.fromEntries(MONEY_KINDS.map((k) => [k, round2(active.filter((r) => r.kind === k).reduce((a, r) => a + r.balance, 0))]));
    return c.json({ accounts: rows, total, byKind });
  });

  // Register a new account (Odoo: Accounting → Configuration → Bank / Cash journal).
  app.post('/money-accounts', async (c: any) => {
    requireCompanyView(c);
    const userId = c.get('jwtPayload').sub;
    const body = await c.req.json().catch(() => ({}));
    const kind = String(body.kind || '').toUpperCase() as Kind;
    if (!MONEY_KINDS.includes(kind)) return c.json({ message: 'Choose the type of account: Bank, Mobile money / money transfer, or Cash.' }, 400);
    const provider = text(body.provider, 80);
    if (!provider) return c.json({ message: 'Choose the bank or provider (or "Other" and type its name).' }, 400);
    const name = text(body.name, 80) || provider;
    const branchId = text(body.branchId ?? body.branch_id, 80);
    if (branchId && !(await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(branchId).first())) return c.json({ message: 'That branch does not exist.' }, 400);
    if (await c.env.DB.prepare('SELECT id FROM money_accounts WHERE lower(name) = lower(?)').bind(name).first()) {
      return c.json({ message: `An account named "${name}" already exists. Give this one a different name (e.g. "${name} – USD 2").` }, 409);
    }
    const opening = body.opening && Number(body.opening.amount) > 0 ? {
      amount: round2(Number(body.opening.amount)),
      source: body.opening.source === 'NEW_MONEY' ? 'NEW_MONEY' : 'MAIN_CASH',
      date: text(body.opening.date, 10) || today(),
    } : null;
    if (body.opening && Number(body.opening.amount) < 0) return c.json({ message: 'The opening balance cannot be negative.' }, 400);
    if (opening && !Number.isFinite(opening.amount)) return c.json({ message: 'Enter the opening balance as an amount of money.' }, 400);

    // Next free code 1010-NN.
    const { results: codes } = await c.env.DB.prepare("SELECT code FROM chart_of_accounts WHERE code LIKE '1010-%'").all();
    const next = 1 + Math.max(0, ...((codes || []) as any[]).map((r) => Number(String(r.code).slice(5)) || 0));
    const code = `1010-${String(next).padStart(2, '0')}`;
    const coaId = `coa-${code}`;
    const id = uuidv4();

    if (opening?.source === 'MAIN_CASH') {
      const mainBal = await balanceOf(c.env.DB, 'coa-1010', branchId);
      if (mainBal < opening.amount - 0.005) {
        return c.json({ message: `Main Cash${branchId ? ' (this branch)' : ''} only has ${mainBal.toFixed(2)}, so ${opening.amount.toFixed(2)} cannot be moved out of it. Choose "New money" if this money is not in the books yet.` }, 400);
      }
    }

    // The ledger account must exist before the opening entry can be prepared against it.
    await c.env.DB.prepare(`
      INSERT INTO chart_of_accounts (id, code, name, account_type, normal_balance, parent_id, branch_id, description)
      VALUES (?, ?, ?, 'ASSET', 'DEBIT', NULL, ?, ?)
    `).bind(coaId, code, `${name}`, branchId, `Bank & Cash: ${provider}${body.account_number ? ` · ${String(body.account_number).slice(0, 40)}` : ''}`).run();

    const stmts: any[] = [
      c.env.DB.prepare(`
        INSERT INTO money_accounts (id, name, kind, provider, account_number, account_holder, currency, coa_account_id, branch_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?)
      `).bind(id, name, kind, provider, text(body.account_number ?? body.accountNumber, 60), text(body.account_holder ?? body.accountHolder, 120), coaId, branchId, text(body.notes, 500), userId),
      createAuditLogStmt(c, 'MONEY_ACCOUNT_CREATE', 'money_accounts', id, null, { name, kind, provider, code, branchId, opening }),
    ];
    try {
      if (opening) {
        const posting = await prepareJournalEntryPosting(c, {
          description: opening.source === 'MAIN_CASH' ? `Opening balance of ${name}: moved from Main Cash` : `Opening balance of ${name}`,
          referenceType: opening.source === 'MAIN_CASH' ? 'MONEY_TRANSFER' : 'OPENING',
          referenceId: `money-open:${id}`,
          branchId, userId, entryDate: opening.date,
          lines: [
            { accountCode: code, debitAmount: opening.amount, creditAmount: 0 },
            { accountCode: opening.source === 'MAIN_CASH' ? '1010' : '3010', debitAmount: 0, creditAmount: opening.amount },
          ],
        });
        stmts.push(...posting.statements);
      }
      await c.env.DB.batch(stmts);
    } catch (err) {
      // Nothing else uses the new ledger account yet: remove it so a retry starts clean.
      await c.env.DB.prepare('DELETE FROM chart_of_accounts WHERE id = ? AND NOT EXISTS (SELECT 1 FROM journal_entry_lines WHERE account_id = ?)').bind(coaId, coaId).run().catch(() => {});
      throw err;
    }
    const row = await c.env.DB.prepare(`${LIST_SQL('')} WHERE ma.id = ?`).bind(id).first() as any;
    return c.json({ ...row, balance: round2(Number(row?.balance || 0)) }, 201);
  });

  // Change details; an account with money in it cannot be closed.
  app.patch('/money-accounts/:id', async (c: any) => {
    requireCompanyView(c);
    const id = c.req.param('id');
    const old = await c.env.DB.prepare('SELECT * FROM money_accounts WHERE id = ?').bind(id).first() as any;
    if (!old) return c.json({ message: 'Account not found.' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const sets: string[] = []; const vals: unknown[] = [];
    const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
    if ('name' in body) {
      const name = text(body.name, 80);
      if (!name) return c.json({ message: 'The account needs a name.' }, 400);
      if (await c.env.DB.prepare('SELECT id FROM money_accounts WHERE lower(name) = lower(?) AND id <> ?').bind(name, id).first()) return c.json({ message: `An account named "${name}" already exists.` }, 409);
      put('name', name);
    }
    if ('account_number' in body) put('account_number', text(body.account_number, 60));
    if ('account_holder' in body) put('account_holder', text(body.account_holder, 120));
    if ('notes' in body) put('notes', text(body.notes, 500));
    if ('is_active' in body) {
      const active = body.is_active === true || body.is_active === 1 || body.is_active === 'true';
      if (!active) {
        if (old.coa_account_id === 'coa-1010') return c.json({ message: 'Main Cash cannot be closed: it holds all money recorded before Bank & Cash accounts existed.' }, 400);
        const bal = await balanceOf(c.env.DB, old.coa_account_id);
        if (Math.abs(bal) > 0.005) return c.json({ message: `This account still holds ${bal.toFixed(2)}. Move the money to another account first, then close it.` }, 400);
      }
      put('is_active', active ? 1 : 0);
    }
    if (!sets.length) return c.json({ message: 'Nothing to change.' }, 400);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    const stmts = [
      c.env.DB.prepare(`UPDATE money_accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
      createAuditLogStmt(c, 'MONEY_ACCOUNT_UPDATE', 'money_accounts', id, old, body),
    ];
    if ('name' in body) stmts.push(c.env.DB.prepare('UPDATE chart_of_accounts SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND id <> ?').bind(text(body.name, 80), old.coa_account_id, 'coa-1010'));
    await c.env.DB.batch(stmts);
    const row = await c.env.DB.prepare(`${LIST_SQL('')} WHERE ma.id = ?`).bind(id).first() as any;
    return c.json({ ...row, balance: round2(Number(row?.balance || 0)) });
  });

  // Statement: every movement with a running balance (like a bank statement), newest first.
  app.get('/money-accounts/:id/statement', async (c: any) => {
    const scope = await resolveBranchScope(c);
    const id = c.req.param('id');
    const acc = await c.env.DB.prepare('SELECT ma.*, coa.code AS account_code FROM money_accounts ma JOIN chart_of_accounts coa ON coa.id = ma.coa_account_id WHERE ma.id = ?').bind(id).first() as any;
    if (!acc || (scope.kind === 'BRANCH' && acc.branch_id && acc.branch_id !== scope.branchId)) return c.json({ message: 'Account not found.' }, 404);
    const from = c.req.query('from') || '1970-01-01';
    const to = c.req.query('to') || '2999-12-31';
    const scopeSql = branchSql(scope, 'gl.branch_id');
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM (
        SELECT gl.entry_date, gl.description, gl.debit_amount AS money_in, gl.credit_amount AS money_out,
               je.entry_number, je.reference_type, b.name AS branch_name, gl.created_at,
               SUM(gl.debit_amount - gl.credit_amount) OVER (ORDER BY gl.entry_date, gl.created_at, gl.journal_entry_id, gl.line_order
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
        FROM general_ledger gl
        JOIN journal_entries je ON je.id = gl.journal_entry_id
        LEFT JOIN branches b ON b.id = gl.branch_id
        WHERE gl.account_id = ?${scopeSql}
      ) s WHERE s.entry_date >= ? AND s.entry_date <= ?
      ORDER BY s.entry_date DESC, s.created_at DESC
      LIMIT 1000
    `).bind(acc.coa_account_id, from, to).all();
    const lines = ((results || []) as any[]).map((r) => ({ ...r, money_in: Number(r.money_in), money_out: Number(r.money_out), balance: round2(Number(r.balance)) }));
    return c.json({ account: acc, balance: await balanceOf(c.env.DB, acc.coa_account_id, scope.kind === 'BRANCH' ? scope.branchId : null), lines });
  });

  // Move money between two accounts (e.g. deposit the cash drawer into Dahabshiil).
  app.post('/money-accounts/transfer', async (c: any) => {
    requireCompanyView(c);
    const userId = c.get('jwtPayload').sub;
    const body = await c.req.json().catch(() => ({}));
    const amount = round2(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) return c.json({ message: 'Enter an amount above 0.' }, 400);
    if (!body.fromId || !body.toId || body.fromId === body.toId) return c.json({ message: 'Choose two different accounts.' }, 400);
    const [from, to] = await Promise.all([
      c.env.DB.prepare('SELECT ma.*, coa.code AS account_code FROM money_accounts ma JOIN chart_of_accounts coa ON coa.id = ma.coa_account_id WHERE ma.id = ?').bind(body.fromId).first(),
      c.env.DB.prepare('SELECT ma.*, coa.code AS account_code FROM money_accounts ma JOIN chart_of_accounts coa ON coa.id = ma.coa_account_id WHERE ma.id = ?').bind(body.toId).first(),
    ]) as any[];
    if (!from || !to) return c.json({ message: 'Account not found.' }, 404);
    if (Number(from.is_active) !== 1 || Number(to.is_active) !== 1) return c.json({ message: 'Both accounts must be open (not closed).' }, 400);
    // One journal entry belongs to one branch: two accounts of different branches can't be joined directly.
    if (from.branch_id && to.branch_id && from.branch_id !== to.branch_id) {
      return c.json({ message: 'These accounts belong to different branches. Move the money through a company-wide account, or use a branch transfer.' }, 400);
    }
    const branchId = from.branch_id || to.branch_id || text(body.branchId, 80) || null;
    if (branchId && !(await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(branchId).first())) return c.json({ message: 'That branch does not exist.' }, 400);
    const fromBal = await balanceOf(c.env.DB, from.coa_account_id, branchId);
    if (fromBal < amount - 0.005) return c.json({ message: `${from.name} only has ${fromBal.toFixed(2)}${branchId ? ' for this branch' : ''}, so ${amount.toFixed(2)} cannot be moved out of it.` }, 400);
    const ref = uuidv4();
    const note = text(body.note, 200);
    const posting = await prepareJournalEntryPosting(c, {
      description: `Money moved: ${from.name} → ${to.name}${note ? ` (${note})` : ''}`,
      referenceType: 'MONEY_TRANSFER', referenceId: `money-move:${ref}`,
      branchId, userId, entryDate: text(body.date, 10) || today(),
      lines: [
        { accountCode: to.account_code, debitAmount: amount, creditAmount: 0 },
        { accountCode: from.account_code, debitAmount: 0, creditAmount: amount },
      ],
    });
    await c.env.DB.batch([
      ...posting.statements,
      createAuditLogStmt(c, 'MONEY_TRANSFER', 'money_accounts', from.id, null, { from: from.name, to: to.name, amount, branchId, note }),
    ]);
    return c.json({ ok: true, entryId: posting.entryId, amount, from: from.name, to: to.name }, 201);
  });
}

/**
 * The accounts a person may choose on a payment ("Paid from" / "Received into"), outside the
 * Accounting module: open accounts of their branch plus company-wide ones. The company view may
 * pass ?branch_id= (the payment's branch) to get the accounts that fit it. Balances only for people
 * with accounting access. Mounted at /api/v1/money-accounts (signed in).
 */
export function registerMoneyAccountOptions(app: any) {
  app.get('/options', async (c: any) => {
    const p = c.get('jwtPayload') as any;
    const own: string | null = p?.branch_id ?? null;
    const asked = (c.req.query('branch_id') || '').trim();
    const branchId = own || (asked && asked !== 'ALL' ? asked : null);
    const showBalance = !!(p?.permissions?.includes('accounting.view') || p?.permissions?.includes('*'));
    const { results } = await c.env.DB.prepare(`
      SELECT ma.id, ma.name, ma.kind, ma.provider, ma.account_number, ma.branch_id, b.name AS branch_name, coa.code AS account_code,
             (SELECT COALESCE(SUM(gl.debit_amount - gl.credit_amount), 0) FROM general_ledger gl WHERE gl.account_id = ma.coa_account_id) AS balance
      FROM money_accounts ma
      JOIN chart_of_accounts coa ON coa.id = ma.coa_account_id
      LEFT JOIN branches b ON b.id = ma.branch_id
      WHERE ma.is_active = 1 ${branchId ? 'AND (ma.branch_id IS NULL OR ma.branch_id = ?)' : ''}
      ORDER BY (coa.code = '1010') DESC, ma.kind, ma.name
    `).bind(...(branchId ? [branchId] : [])).all();
    const rows = ((results || []) as any[]).map((r) => ({
      id: r.id, name: r.name, kind: r.kind, provider: r.provider, account_number: r.account_number,
      branch_id: r.branch_id, branch_name: r.branch_name, is_main_cash: r.account_code === '1010',
      ...(showBalance ? { balance: round2(Number(r.balance || 0)) } : {}),
    }));
    return c.json(rows);
  });
}
