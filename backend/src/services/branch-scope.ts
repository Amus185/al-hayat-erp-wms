// Branch scope for financial data (accounting, receivables, expenses).
//
// Policy:
//  • Users holding an all-branch role (admin, accountant) see everything and
//    may narrow with ?branch_id=<id> | UNASSIGNED (company-level postings such
//    as purchasing and warehouse stock) | ALL (default).
//  • Every other user is pinned to their assigned branch. Asking for another
//    branch is refused (403), never silently widened or narrowed.
//  • A user with neither a branch nor an all-branch role gets 403: missing
//    configuration must never mean "unrestricted".
// The caller's branch and roles are reloaded from the database by
// authMiddleware, so stale token claims cannot widen the scope.
import type { JwtPayload } from '../middleware/auth';

export const ALL_BRANCH_ROLES = ['admin', 'accountant'];

export type BranchScope =
  | { kind: 'ALL' }
  | { kind: 'UNASSIGNED' }
  | { kind: 'BRANCH'; branchId: string };

/** Thrown for scope violations; index.ts turns it into the given HTTP status. */
export class ScopeError extends Error {
  name = 'ScopeError';
  constructor(public status: 400 | 403, message: string) { super(message); }
}

// Branch ids are generated (UUIDs or fixed seed slugs). Restricting them to
// this alphabet and checking they exist is what makes branchSql() safe to
// inline as a literal (no quotes, no `?` that the SQL rewriter would touch).
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function hasAllBranchAccess(payload: JwtPayload): boolean {
  // A branch assignment always wins: only someone with no branch can be company-level.
  if (payload.branch_id) return false;
  const roles = payload.roles ?? [payload.role];
  return roles.some((r) => ALL_BRANCH_ROLES.includes(r));
}

/** Requires an all-branch role (company-wide configuration and processes). */
export function assertAllBranchAccess(payload: JwtPayload) {
  if (!hasAllBranchAccess(payload)) {
    throw new ScopeError(403, 'This action affects every branch and requires an administrator or accountant.');
  }
}

export async function resolveBranchScope(c: any, requested?: string | null): Promise<BranchScope> {
  const payload: JwtPayload = c.get('jwtPayload');
  const req = (requested ?? c.req.query('branch_id') ?? c.req.query('branchId') ?? '').trim() || null;

  if (!hasAllBranchAccess(payload)) {
    const own = payload.branch_id;
    if (!own || !SAFE_ID.test(own)) {
      throw new ScopeError(403, 'Your account is not assigned to a branch, so financial data is not available. Ask an administrator to assign one.');
    }
    if (req && req !== 'ALL' && req !== own) {
      throw new ScopeError(403, 'You can only view your own branch.');
    }
    return { kind: 'BRANCH', branchId: own };
  }

  if (!req || req === 'ALL') return { kind: 'ALL' };
  if (req === 'UNASSIGNED') return { kind: 'UNASSIGNED' };
  if (!SAFE_ID.test(req)) throw new ScopeError(400, 'Invalid branch id.');
  const exists = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(req).first();
  if (!exists) throw new ScopeError(400, 'Unknown branch.');
  return { kind: 'BRANCH', branchId: req };
}

/** ` AND <column> …` predicate for the scope ('' for ALL). */
export function branchSql(scope: BranchScope, column: string): string {
  if (scope.kind === 'ALL') return '';
  if (scope.kind === 'UNASSIGNED') return ` AND ${column} IS NULL`;
  return ` AND ${column} = '${scope.branchId}'`;
}

/** Whether a record attributed to `branchId` is visible in the scope. */
export function inScope(scope: BranchScope, branchId: string | null | undefined): boolean {
  if (scope.kind === 'ALL') return true;
  if (scope.kind === 'UNASSIGNED') return !branchId;
  return branchId === scope.branchId;
}

/**
 * Branch to record a new financial document under: branch-scoped users always
 * write to their own branch (a different explicit branch is refused);
 * all-branch users may choose any existing branch or none (company-level).
 */
export async function resolveWriteBranch(c: any, requested: string | null | undefined): Promise<string | null> {
  const payload: JwtPayload = c.get('jwtPayload');
  const req = requested || null;
  if (!hasAllBranchAccess(payload)) {
    const own = payload.branch_id;
    if (!own) throw new ScopeError(403, 'Your account is not assigned to a branch.');
    if (req && req !== own) throw new ScopeError(403, 'You can only record transactions for your own branch.');
    return own;
  }
  if (!req) return null;
  const exists = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(req).first();
  if (!exists) throw new ScopeError(400, 'Unknown branch.');
  return req;
}

/**
 * Accountants see the company's whole financial position, consolidated, even when
 * they are assigned to a branch. This is applied only inside the accounting module and
 * its finance reports (never to sales, stock or administration), so it grants no other
 * access. Anyone who is not an accountant is unchanged (a branch manager the Owner
 * gave accounting.view still sees only their own branch).
 */
export function accountingPayload(payload: JwtPayload): JwtPayload {
  const isAccountant = (payload.roles ?? [payload.role]).includes('accountant');
  return isAccountant && payload.branch_id ? { ...payload, branch_id: null } : payload;
}

// ── One location scope for every module ─────────────────────────────────────
//
// Who sees what, decided in one place:
//  • company level (admin/accountant with no branch): everything; may narrow to
//    one branch with ?branch_id= (or ?branchId=), the Owner's branch switcher;
//  • assigned to a branch: that branch only, always. Asking for another branch
//    is refused (403), never silently widened or narrowed;
//  • assigned to a warehouse only: that warehouse;
//  • neither: refused. Missing configuration never means unrestricted.
export type Loc =
  | { kind: 'ALL' }
  | { kind: 'BRANCH'; branchId: string }
  | { kind: 'WAREHOUSE'; warehouseId: string };

export async function resolveLoc(c: any): Promise<Loc> {
  const payload: JwtPayload = c.get('jwtPayload');
  const asked = (c.req.query('branch_id') || c.req.query('branchId') || '').trim();
  if (payload.branch_id) {
    if (!SAFE_ID.test(payload.branch_id)) throw new ScopeError(403, 'Your branch assignment is invalid.');
    if (asked && asked !== 'ALL' && asked !== payload.branch_id) throw new ScopeError(403, 'You can only view your own branch.');
    return { kind: 'BRANCH', branchId: payload.branch_id };
  }
  if (hasAllBranchAccess(payload)) {
    if (!asked || asked === 'ALL') return { kind: 'ALL' };
    if (!SAFE_ID.test(asked)) throw new ScopeError(400, 'Invalid branch id.');
    const exists = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(asked).first();
    if (!exists) throw new ScopeError(400, 'Unknown branch.');
    return { kind: 'BRANCH', branchId: asked };
  }
  const wh = payload.warehouse_id;
  if (wh && SAFE_ID.test(wh)) return { kind: 'WAREHOUSE', warehouseId: wh };
  throw new ScopeError(403, 'Your account is not assigned to a branch or warehouse. Ask an administrator to assign one.');
}

/** The branch the scope is pinned to, or null (company level / warehouse). */
export const locBranch = (loc: Loc): string | null => (loc.kind === 'BRANCH' ? loc.branchId : null);

/**
 * ` AND <predicate>` for the scope. `cols.branch` / `cols.warehouse` are the
 * columns that carry the owner; a missing one means that kind of person sees
 * nothing in this table. Ids were validated as safe literals (SAFE_ID).
 */
export function locSql(loc: Loc, cols: { branch?: string; warehouse?: string }): string {
  if (loc.kind === 'ALL') return '';
  if (loc.kind === 'BRANCH') return cols.branch ? ` AND ${cols.branch} = '${loc.branchId}'` : ' AND FALSE';
  return cols.warehouse ? ` AND ${cols.warehouse} = '${loc.warehouseId}'` : ' AND FALSE';
}

/** Products a branch deals in: it holds (or held) stock, sold, transferred or bought them, or registered them. */
export function productVisibleSql(branchId: string, col = 'p.id'): string {
  return `(EXISTS (SELECT 1 FROM inventory_stock s WHERE s.product_id = ${col} AND s.owner_type = 'BRANCH' AND s.branch_id = '${branchId}')
      OR EXISTS (SELECT 1 FROM product_branches pb WHERE pb.product_id = ${col} AND pb.branch_id = '${branchId}')
      OR EXISTS (SELECT 1 FROM sales_order_lines sl JOIN sales_orders so ON so.id = sl.sales_order_id WHERE sl.product_id = ${col} AND so.branch_id = '${branchId}')
      OR EXISTS (SELECT 1 FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id WHERE tl.product_id = ${col} AND (t.source_branch_id = '${branchId}' OR t.destination_branch_id = '${branchId}'))
      OR EXISTS (SELECT 1 FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id WHERE pl.product_id = ${col} AND po.branch_id = '${branchId}'))`;
}

/** Customers a branch deals with: registered there, or with sales, debts, payments or quotes there. */
export function customerVisibleSql(branchId: string, col = 'cu.id'): string {
  return `(EXISTS (SELECT 1 FROM customer_branches cb WHERE cb.customer_id = ${col} AND cb.branch_id = '${branchId}')
      OR EXISTS (SELECT 1 FROM sales_orders so WHERE so.customer_id = ${col} AND so.branch_id = '${branchId}')
      OR EXISTS (SELECT 1 FROM customer_debts cd WHERE cd.customer_id = ${col} AND cd.branch_id = '${branchId}')
      OR EXISTS (SELECT 1 FROM customer_payments cp WHERE cp.customer_id = ${col} AND cp.branch_id = '${branchId}')
      OR EXISTS (SELECT 1 FROM quotations q WHERE q.customer_id = ${col} AND q.branch_id = '${branchId}'))`;
}
