// Financial privacy: who may see cost prices and stock value (D4) and who may
// see employees' pay (D3). Enforced on the server: fields are removed from
// API answers (and so from exports, search and the assistant, which read the
// same routes) for anyone without the permission, whatever the screen shows.
import type { Context, MiddlewareHandler } from 'hono';

export const PERM = {
  /** Cost prices, purchase costs, stock valuation, margins. */
  COSTS: 'costs.view',
  /** Salaries, salary advances and employment documents (read). */
  PAYROLL_VIEW: 'payroll.view',
  /** Change salaries, record/delete advances, upload employment documents. */
  PAYROLL_MANAGE: 'payroll.manage',
  /** Add and edit employees' ordinary details (within the person's branch unless all-branch). */
  EMPLOYEES_MANAGE: 'employees.manage',
} as const;

/** Permissions the Owner may give to one particular person (on top of their roles). */
export const GRANTABLE = [PERM.COSTS, PERM.PAYROLL_VIEW, PERM.PAYROLL_MANAGE, PERM.EMPLOYEES_MANAGE, 'accounting.view', 'assistant.use'] as const;

export function has(payload: { permissions?: string[] } | undefined | null, code: string): boolean {
  return !!payload?.permissions && (payload.permissions.includes(code) || payload.permissions.includes('*'));
}
export const canSeeCosts = (c: Context) => has((c as any).get('jwtPayload'), PERM.COSTS);
export const canSeePayroll = (c: Context) => has((c as any).get('jwtPayload'), PERM.PAYROLL_VIEW);

/** Per-item and summary cost fields, in every module. */
export const COST_FIELDS = new Set([
  'cost_price', 'current_cost_price', 'component_cost_price', 'unit_cost', 'average_cost', 'avg_cost', 'costPrice', 'unitCost',
  'inventory_value', 'cost_value', 'total_cost_value', 'value_at_cost',
  'material_cost', 'labor_cost', 'overhead_cost', 'total_production_cost', 'raw_material_cost',
  'gross_profit', 'profit', 'margin', 'margin_pct', 'gross_margin', 'gross_margin_pct',
  'total_spend', 'tied_up_capital', 'total_profit', 'cogs', 'total_cogs',
]);

/** Purchasing: what was paid or owed to suppliers is a purchase cost too. */
export const PURCHASE_FIELDS = new Set([
  ...COST_FIELDS, 'total_amount', 'line_total', 'discount_amount', 'amount', 'amount_paid',
  'invoice_total', 'order_total', 'balance', 'outstanding', 'value', 'owed',
  'net_total', 'net_calc', 'balance_calc', 'invoice_discount', 'previous_balance', 'running_balance',
  'total_outstanding_balance', 'deposits_total',
]);

/** Employees' pay. */
export const PAYROLL_FIELDS = new Set([
  'salary', 'total_advances', 'total_repaid', 'advance_balance', 'advances', 'document_key', 'document_name',
]);

export function redact<T>(value: T, keys: Set<string>, depth = 0): T {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, keys, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(k)) continue;
    out[k] = redact(v, keys, depth + 1);
  }
  return out as T;
}

/**
 * Removes `keys` from every JSON answer of the routes it guards, unless the
 * caller holds `permission`. Runs after the route, so new fields added later
 * are covered as long as they use one of the names above.
 */
export function hideUnless(permission: string, keys: Set<string>): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (has((c as any).get('jwtPayload'), permission)) return;
    const type = c.res.headers.get('content-type') || '';
    if (!type.includes('application/json')) return;
    let body: unknown;
    try { body = await c.res.clone().json(); } catch { return; }
    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    c.res = new Response(JSON.stringify(redact(body, keys)), { status: c.res.status, headers });
  };
}

/** List options without sort keys that would reveal hidden values through ordering. */
export function sortsFor<T extends { sortable: Record<string, string> }>(c: Context, opts: T, hidden: string[], permission: string = PERM.COSTS): T {
  if (has((c as any).get('jwtPayload'), permission)) return opts;
  return { ...opts, sortable: Object.fromEntries(Object.entries(opts.sortable).filter(([k]) => !hidden.includes(k))) };
}
