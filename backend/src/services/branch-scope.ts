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
  const req = (requested ?? c.req.query('branch_id') ?? '').trim() || null;

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
