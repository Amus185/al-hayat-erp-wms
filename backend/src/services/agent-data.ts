// What the assistant may read: a catalog of the ERP's own GET routes. Each
// read runs through the main app as the signed-in user (INTERNAL_AUTH), so the
// route's permission checks, branch scoping and calculations are exactly the
// ones the staff screens use: the assistant sees what the user would see on
// screen, never more, and its figures match the screens.
//
// To make a new module available to the assistant, add an entry here.

export interface DataSource {
  /** API path under /api/v1. ":id" is filled from the call's id. */
  path: string;
  /** Query parameters the route understands (anything else is dropped). */
  query: string[];
  /** One line for the model: what it returns and which filters matter. */
  about: string;
}

const PERIOD = ['period_id', 'branch_id'];

export const DATA_SOURCES: Record<string, DataSource> = {
  // Sales, customers, debts and payments
  sales_summary: { path: '/sales/summary', query: [], about: 'sales and outstanding totals' },
  sales_orders: { path: '/sales/orders', query: ['search', 'status', 'paymentStatus', 'dateFrom', 'dateTo', 'customerId'], about: 'sales orders and invoices (status DRAFT/CONFIRMED/INVOICED/PAID/DELIVERED/CANCELLED; paymentStatus UNPAID/PARTIAL/PAID)' },
  sales_order: { path: '/sales/orders/:id', query: [], about: 'one sales order with lines, invoice and payments (id from sales_orders)' },
  customers: { path: '/sales/customers', query: ['search', 'status'], about: 'customers with balance owed; search by name or phone; gives customer ids' },
  customer_balance: { path: '/sales/customers/:id/balance', query: [], about: 'what one customer owes (id from customers)' },
  customer_ledger: { path: '/sales/customers/:id/ledger', query: [], about: 'one customer\'s invoices, payments and debts over time (id from customers)' },
  debts_summary: { path: '/sales/debts/summary', query: [], about: 'total receivables, number of debtors, overdue' },
  debts: { path: '/sales/debts', query: ['search', 'status'], about: 'customers who owe money, largest first' },
  receivables_report: { path: '/reports/receivables', query: [], about: 'receivables ageing report' },
  quote_conversion: { path: '/reports/quote-conversion', query: [], about: 'how many quotes became sales' },

  // Products, inventory, warehouses, transfers
  products: { path: '/products', query: ['status'], about: 'all products with prices and categories' },
  inventory_stock: { path: '/inventory/stock', query: [], about: 'stock on hand per product and location' },
  inventory_movements: { path: '/inventory/transactions', query: [], about: 'recent stock movements (sales, receipts, adjustments, transfers)' },
  low_stock: { path: '/reports/low-stock', query: ['branchId', 'warehouseId'], about: 'products at or below reorder level' },
  inventory_valuation: { path: '/reports/inventory-valuation', query: [], about: 'value of stock at cost, per product and in total' },
  warehouses: { path: '/warehouses', query: [], about: 'warehouses; gives warehouse ids' },
  warehouse_summary: { path: '/warehouses/:id/summary', query: [], about: 'one warehouse\'s stock summary (id from warehouses)' },
  transfers: { path: '/transfers', query: [], about: 'stock transfers between branches and warehouses' },
  branches: { path: '/branches', query: [], about: 'branches; gives branch ids' },
  branch_performance: { path: '/reports/branch-performance', query: ['days'], about: 'sales and profit per branch for the last N days' },

  // Deliveries
  deliveries_stats: { path: '/deliveries/stats', query: [], about: 'delivery counts by status' },
  deliveries: { path: '/deliveries', query: ['status', 'search', 'driver', 'dateFrom', 'dateTo'], about: 'deliveries and dispatches with status and driver' },

  // Purchasing and suppliers
  purchases_summary: { path: '/purchasing/summary', query: [], about: 'purchase totals and what is owed to suppliers' },
  purchase_orders: { path: '/purchasing/orders', query: ['search', 'paymentStatus', 'dateFrom', 'dateTo', 'supplierId'], about: 'purchase orders from suppliers' },
  purchase_order: { path: '/purchasing/orders/:id', query: [], about: 'one purchase order with lines and payments (id from purchase_orders)' },
  suppliers: { path: '/purchasing/suppliers', query: [], about: 'suppliers; gives supplier ids' },
  supplier_performance: { path: '/reports/supplier-performance', query: [], about: 'purchases and deliveries per supplier' },

  // Accounting
  accounting_dashboard: { path: '/accounting/dashboard', query: PERIOD, about: 'key financial figures for a period' },
  income_statement: { path: '/accounting/income-statement', query: PERIOD, about: 'revenue, cost of sales, expenses, profit or loss' },
  balance_sheet: { path: '/accounting/balance-sheet', query: PERIOD, about: 'assets, liabilities and equity' },
  cash_flow: { path: '/accounting/cash-flow', query: PERIOD, about: 'cash in and out by activity' },
  trial_balance: { path: '/accounting/trial-balance', query: [...PERIOD, 'type'], about: 'debit and credit balance of every account' },
  owners_equity: { path: '/accounting/owners-equity', query: PERIOD, about: 'changes in owner\'s equity' },
  branch_accounts: { path: '/accounting/branch-summary', query: ['period_id'], about: 'financial summary per branch' },
  fiscal_periods: { path: '/accounting/fiscal-periods', query: [], about: 'accounting periods; gives period ids for period_id' },
  chart_of_accounts: { path: '/accounting/chart-of-accounts', query: ['type'], about: 'accounts with codes and types; gives account ids' },
  journal_entries: { path: '/accounting/journal-entries', query: ['status', 'period_id', 'limit', 'branch_id'], about: 'journal entries, newest first' },
  journal_entry: { path: '/accounting/journal-entries/:id', query: [], about: 'one journal entry with its lines (id from journal_entries)' },
  general_ledger: { path: '/accounting/general-ledger', query: ['account_id', 'from_date', 'to_date', 'branch_id'], about: 'postings of one account (account_id from chart_of_accounts)' },
  depreciation: { path: '/accounting/depreciation', query: PERIOD, about: 'depreciation of fixed assets' },
  sales_profit: { path: '/reports/sales-profit', query: ['days'], about: 'sales, cost and gross profit per product for the last N days' },

  // Expenses
  expenses_summary: { path: '/expenses/summary', query: ['dateFrom', 'dateTo', 'branch_id'], about: 'expenses totals by category' },
  expenses: { path: '/expenses', query: ['category', 'dateFrom', 'dateTo', 'branch_id'], about: 'individual expenses' },

  // Owner's assets (property, rentals, livestock)
  assets_dashboard: { path: '/assets/dashboard', query: [], about: 'owner\'s assets overview' },
  rental_summary: { path: '/assets/rental-summary', query: [], about: 'rent due, collected and outstanding' },
  properties: { path: '/assets/properties', query: [], about: 'properties' },
  rental_payments: { path: '/assets/rental-payments', query: ['property_id', 'tenant_id'], about: 'rent payments' },
  livestock: { path: '/assets/livestock', query: [], about: 'livestock' },

  // Manufacturing
  manufacturing_stats: { path: '/manufacturing/stats', query: [], about: 'production overview' },
  work_orders: { path: '/manufacturing/work-orders', query: ['status', 'stage', 'warehouseId', 'search'], about: 'production work orders' },
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SAFE_VALUE = /^[^\u0000-\u001f]{1,100}$/;

/** The request path for a source, or an error message for the model. */
export function sourceUrl(name: string, id: unknown, filters: unknown): { url: string } | { error: string } {
  const source = Object.hasOwn(DATA_SOURCES, name) ? DATA_SOURCES[name] : null;
  if (!source) return { error: `Unknown source "${String(name).slice(0, 40)}". Use one of: ${Object.keys(DATA_SOURCES).join(', ')}.` };
  let path = source.path;
  if (path.includes(':id')) {
    const value = typeof id === 'string' || typeof id === 'number' ? String(id).trim() : '';
    if (!SAFE_ID.test(value)) return { error: `"${name}" needs the id of the record (look it up first).` };
    path = path.replace(':id', encodeURIComponent(value));
  }
  const qs = new URLSearchParams();
  const given = filters && typeof filters === 'object' ? filters as Record<string, unknown> : {};
  for (const key of source.query) {
    const raw = given[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw).trim();
    if (SAFE_VALUE.test(value)) qs.set(key, value);
  }
  if (name === 'journal_entries' && !qs.has('limit')) qs.set('limit', '20');
  const q = qs.toString();
  return { url: `http://internal/api/v1${path}${q ? `?${q}` : ''}` };
}

// ── Keeping results small and safe for the model ────────────────────────────

const MAX_ITEMS = 25;
const MAX_STRING = 200;
export const MAX_RESULT_CHARS = 8000;
// Per-item cost fields are only shown to users who can see cost reports on
// screen (view_reports); totals such as cost of sales stay in the reports.
const COST_KEY = /(^|_)(cost|unit_cost|cost_price|average_cost|avg_cost)$|^(costPrice|unitCost|averageCost|avgCost)$/i;
const NOISE_KEY = /^(password|password_hash|token|.*_url|image|images|photo|photos|created_by|updated_at|updatedAt)$/i;

export function compactForModel(value: unknown, opts: { hideCosts: boolean; maxItems?: number }, depth = 0): unknown {
  const maxItems = opts.maxItems ?? MAX_ITEMS;
  if (depth > 6) return '…';
  if (Array.isArray(value)) {
    const items = value.slice(0, maxItems).map((v) => compactForModel(v, opts, depth + 1));
    return value.length > maxItems ? [...items, { more_not_shown: value.length - maxItems }] : items;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined || v === '') continue;
      if (NOISE_KEY.test(k)) continue;
      if (opts.hideCosts && COST_KEY.test(k)) continue;
      out[k] = compactForModel(v, opts, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_STRING) return `${value.slice(0, MAX_STRING)}…`;
  return value;
}

/** JSON for the model within MAX_RESULT_CHARS, showing fewer rows when needed. */
export function resultForModel(value: unknown, hideCosts: boolean): string {
  for (const maxItems of [MAX_ITEMS, 10, 5]) {
    const text = JSON.stringify(compactForModel(value, { hideCosts, maxItems }));
    if (text.length <= MAX_RESULT_CHARS) return text;
  }
  return JSON.stringify(compactForModel(value, { hideCosts, maxItems: 3 })).slice(0, MAX_RESULT_CHARS);
}
