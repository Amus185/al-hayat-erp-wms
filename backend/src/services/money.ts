// Which Bank & Cash account a payment goes through ("Paid from" / "Received into").
//
// Every screen where money moves now sends the chosen account (money_accounts.id). It must be
// open and usable by the branch the payment belongs to (its own account or a company-wide one).
// Nothing chosen (the mobile app, older screens) = Main Cash (ledger 1010), exactly as before.
import { ScopeError } from './branch-scope';

export const MAIN_CASH_CODE = '1010';

export interface CashAccount {
  /** money_accounts.id, or null for the default (Main Cash) */
  id: string | null;
  /** ledger account code to post to (1010 or 1010-NN) */
  code: string;
  name: string;
  kind: 'CASH' | 'BANK' | 'MOBILE_MONEY';
  /** the branch the account belongs to; null = whole company */
  branchId: string | null;
}

const MAIN_CASH: CashAccount = { id: null, code: MAIN_CASH_CODE, name: 'Main Cash', kind: 'CASH', branchId: null };

/** The account chosen on a payment, checked; Main Cash when none was chosen. */
export async function resolveCashAccount(db: any, moneyAccountId: unknown, branchId: string | null | undefined): Promise<CashAccount> {
  const id = typeof moneyAccountId === 'string' ? moneyAccountId.trim() : '';
  if (!id) return MAIN_CASH;
  const acc = await db.prepare(`
    SELECT ma.id, ma.name, ma.kind, ma.branch_id, ma.is_active, coa.code
    FROM money_accounts ma JOIN chart_of_accounts coa ON coa.id = ma.coa_account_id
    WHERE ma.id = ?
  `).bind(id).first() as any;
  if (!acc) throw new ScopeError(400, 'That bank or cash account does not exist. Reload the page and choose another.');
  if (Number(acc.is_active) !== 1) throw new ScopeError(400, `${acc.name} is closed. Choose another account.`);
  const found: CashAccount = { id: acc.id, code: String(acc.code), name: acc.name, kind: acc.kind, branchId: acc.branch_id ?? null };
  assertCashAccountBranch(found, branchId);
  return found;
}

/**
 * An account of one branch only takes that branch's money (the books are kept per branch).
 * `branchId` undefined = not known yet (check again once it is); null = company-level payment.
 */
export function assertCashAccountBranch(acc: CashAccount, branchId: string | null | undefined) {
  if (branchId === undefined) return;
  if (acc.id && acc.branchId && acc.branchId !== branchId) {
    throw new ScopeError(400, `${acc.name} belongs to another branch. Choose one of this branch's accounts or a company-wide account.`);
  }
}

/**
 * For payments the Owner decides on (paying a supplier, paying for a new price level): the account
 * must be chosen on purpose, never assumed. Main Cash is fine when it is chosen.
 */
export function requireChosenAccount(moneyAccountId: unknown, what: string) {
  if (typeof moneyAccountId !== 'string' || !moneyAccountId.trim()) {
    throw new ScopeError(400, `Choose the account you are paying ${what} from (for example Dahabshiil, Darasalaam Bank or Main Cash).`);
  }
}

/** Ledger code of an account stored on an existing record (for re-posting); Main Cash when none. */
export async function cashCodeOf(db: any, moneyAccountId: string | null | undefined): Promise<string> {
  if (!moneyAccountId) return MAIN_CASH_CODE;
  const r = await db.prepare('SELECT coa.code FROM money_accounts ma JOIN chart_of_accounts coa ON coa.id = ma.coa_account_id WHERE ma.id = ?')
    .bind(moneyAccountId).first() as any;
  return r?.code ? String(r.code) : MAIN_CASH_CODE;
}

/** The payment method recorded alongside, derived from the account's type. */
export function methodFor(acc: CashAccount, fallback: string): string {
  if (!acc.id) return fallback;
  return acc.kind === 'BANK' ? 'BANK_TRANSFER' : acc.kind === 'MOBILE_MONEY' ? 'MOBILE_MONEY' : 'CASH';
}
