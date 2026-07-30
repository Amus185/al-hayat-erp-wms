-- ══════════════════════════════════════════════════════════════════
--  Al-Hayat ERP — Financial Accounting Module Migration
--  Periodic Inventory System | Multi-Entity (HQ + Branches)
--  Run: wrangler d1 execute al-hayat-db --file=./migration_accounting.sql
-- ══════════════════════════════════════════════════════════════════

-- ─── Fiscal Periods ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,                        -- e.g. "FY 2025", "Q1 2025"
  period_type   TEXT NOT NULL DEFAULT 'ANNUAL',       -- ANNUAL | QUARTERLY | MONTHLY
  start_date    TEXT NOT NULL,                        -- ISO date
  end_date      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN',         -- OPEN | CLOSED | LOCKED
  created_by    TEXT REFERENCES users(id),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Chart of Accounts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,                 -- e.g. "1010", "4000"
  name          TEXT NOT NULL,                        -- e.g. "Cash & Bank"
  account_type  TEXT NOT NULL,                        -- ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE | COGS
  normal_balance TEXT NOT NULL DEFAULT 'DEBIT',       -- DEBIT | CREDIT
  parent_id     TEXT REFERENCES chart_of_accounts(id),
  branch_id     TEXT REFERENCES branches(id),         -- NULL = HQ/consolidated
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Journal Entries (Header) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id              TEXT PRIMARY KEY,
  entry_number    TEXT UNIQUE NOT NULL,               -- JE-2025-0001
  fiscal_period_id TEXT REFERENCES fiscal_periods(id),
  entry_date      TEXT NOT NULL,                      -- ISO date
  description     TEXT NOT NULL,
  reference_type  TEXT,                               -- PURCHASE | SALE | TRANSFER | EXPENSE | DEPRECIATION | CLOSING | MANUAL
  reference_id    TEXT,
  branch_id       TEXT REFERENCES branches(id),       -- NULL = HQ entry
  status          TEXT NOT NULL DEFAULT 'DRAFT',      -- DRAFT | POSTED | REVERSED
  total_debit     REAL NOT NULL DEFAULT 0,
  total_credit    REAL NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      TEXT REFERENCES users(id),
  posted_by       TEXT REFERENCES users(id),
  posted_at       DATETIME,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Journal Entry Lines (Double-Entry) ───────────────────────────
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id                TEXT PRIMARY KEY,
  journal_entry_id  TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id        TEXT NOT NULL REFERENCES chart_of_accounts(id),
  description       TEXT,
  debit_amount      REAL NOT NULL DEFAULT 0,
  credit_amount     REAL NOT NULL DEFAULT 0,
  branch_id         TEXT REFERENCES branches(id),
  line_order        INTEGER NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── General Ledger (Running Balances per Account) ────────────────
CREATE TABLE IF NOT EXISTS general_ledger (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES chart_of_accounts(id),
  journal_entry_id  TEXT NOT NULL REFERENCES journal_entries(id),
  line_id           TEXT NOT NULL REFERENCES journal_entry_lines(id),
  entry_date        TEXT NOT NULL,
  description       TEXT,
  debit_amount      REAL NOT NULL DEFAULT 0,
  credit_amount     REAL NOT NULL DEFAULT 0,
  running_balance   REAL NOT NULL DEFAULT 0,
  branch_id         TEXT REFERENCES branches(id),
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Trial Balance Snapshots ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS trial_balance_snapshots (
  id              TEXT PRIMARY KEY,
  fiscal_period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
  snapshot_type   TEXT NOT NULL,     -- UNADJUSTED | ADJUSTED | POST_CLOSING
  account_id      TEXT NOT NULL REFERENCES chart_of_accounts(id),
  debit_balance   REAL NOT NULL DEFAULT 0,
  credit_balance  REAL NOT NULL DEFAULT 0,
  branch_id       TEXT REFERENCES branches(id),
  snapped_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Physical Inventory Counts (Periodic System) ──────────────────
CREATE TABLE IF NOT EXISTS inventory_period_counts (
  id              TEXT PRIMARY KEY,
  fiscal_period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
  branch_id       TEXT REFERENCES branches(id),       -- NULL = HQ / central warehouse
  warehouse_id    TEXT REFERENCES warehouses(id),
  count_date      TEXT NOT NULL,
  total_value     REAL NOT NULL DEFAULT 0,            -- Ending inventory at cost
  notes           TEXT,
  counted_by      TEXT REFERENCES users(id),
  approved_by     TEXT REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'DRAFT',      -- DRAFT | APPROVED
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Depreciation Schedules ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS depreciation_schedules (
  id              TEXT PRIMARY KEY,
  asset_name      TEXT NOT NULL,                      -- e.g. "Equipment & Vehicles"
  asset_account_id TEXT REFERENCES chart_of_accounts(id),
  accum_dep_account_id TEXT REFERENCES chart_of_accounts(id),
  dep_expense_account_id TEXT REFERENCES chart_of_accounts(id),
  acquisition_date TEXT NOT NULL,
  cost            REAL NOT NULL,
  salvage_value   REAL NOT NULL DEFAULT 0,
  useful_life_years INTEGER NOT NULL,
  method          TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
  accumulated_depreciation REAL NOT NULL DEFAULT 0,
  fiscal_period_id TEXT REFERENCES fiscal_periods(id),
  period_depreciation REAL NOT NULL DEFAULT 0,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  notes           TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_je_fiscal_period ON journal_entries(fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_je_period_status ON journal_entries(fiscal_period_id, status, entry_date);
CREATE INDEX IF NOT EXISTS idx_je_status ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_je_entry_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_jel_journal ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_jel_account_journal ON journal_entry_lines(account_id, journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_gl_account ON general_ledger(account_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_gl_branch_date ON general_ledger(branch_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_tbs_period ON trial_balance_snapshots(fiscal_period_id, snapshot_type);
CREATE INDEX IF NOT EXISTS idx_ipc_period ON inventory_period_counts(fiscal_period_id);

-- ─── Seed Default Chart of Accounts (Alhayat Standard) ───────────
INSERT OR IGNORE INTO chart_of_accounts (id, code, name, account_type, normal_balance, description) VALUES
  -- ASSETS
  ('coa-1010', '1010', 'Cash & Cash Equivalents',         'ASSET',     'DEBIT',  'Central HQ Cash and Bank accounts'),
  ('coa-1020', '1020', 'Accounts Receivable — Branch A',  'ASSET',     'DEBIT',  'Trade receivables from Branch A customers'),
  ('coa-1021', '1021', 'Accounts Receivable — Branch B',  'ASSET',     'DEBIT',  'Trade receivables from Branch B customers'),
  ('coa-1030', '1030', 'Merchandise Inventory — Branch A','ASSET',     'DEBIT',  'Physical ending inventory at Branch A'),
  ('coa-1031', '1031', 'Merchandise Inventory — Branch B','ASSET',     'DEBIT',  'Physical ending inventory at Branch B'),
  ('coa-1500', '1500', 'Equipment & Vehicles',             'ASSET',     'DEBIT',  'Fixed assets — equipment and vehicles'),
  ('coa-1501', '1501', 'Accumulated Depreciation — Equipment','ASSET',  'CREDIT', 'Contra asset — accumulated depreciation'),
  ('coa-1600', '1600', 'Investment in Branch A',           'ASSET',     'DEBIT',  'HQ investment account for Branch A'),
  ('coa-1601', '1601', 'Investment in Branch B',           'ASSET',     'DEBIT',  'HQ investment account for Branch B'),
  -- LIABILITIES
  ('coa-2010', '2010', 'Accounts Payable',                 'LIABILITY', 'CREDIT', 'Trade payables to suppliers'),
  ('coa-2020', '2020', 'Short-Term Loans',                 'LIABILITY', 'CREDIT', 'Short-term bank or other loans'),
  ('coa-2100', '2100', 'Home Office Current — Branch A',   'LIABILITY', 'CREDIT', 'Intercompany payable Branch A to HQ'),
  ('coa-2101', '2101', 'Home Office Current — Branch B',   'LIABILITY', 'CREDIT', 'Intercompany payable Branch B to HQ'),
  -- EQUITY
  ('coa-3010', '3010', 'Owner''s Capital',                 'EQUITY',    'CREDIT', 'Owner investment and capital contributions'),
  ('coa-3020', '3020', 'Retained Earnings',                'EQUITY',    'CREDIT', 'Accumulated retained earnings'),
  ('coa-3030', '3030', 'Income Summary',                   'EQUITY',    'CREDIT', 'Temporary closing account'),
  ('coa-3040', '3040', 'Owner''s Drawings',                'EQUITY',    'DEBIT',  'Owner withdrawals during period'),
  -- REVENUE
  ('coa-4010', '4010', 'Sales Revenue — Branch A',         'REVENUE',   'CREDIT', 'Revenue from Branch A sales'),
  ('coa-4011', '4011', 'Sales Revenue — Branch B',         'REVENUE',   'CREDIT', 'Revenue from Branch B sales'),
  -- COGS / PURCHASES
  ('coa-5010', '5010', 'Purchases (Central)',               'COGS',      'DEBIT',  'Central HQ purchases of building supplies'),
  ('coa-5020', '5020', 'Shipments to Branch A',             'COGS',      'CREDIT', 'Inventory shipped from HQ to Branch A'),
  ('coa-5021', '5021', 'Shipments to Branch B',             'COGS',      'CREDIT', 'Inventory shipped from HQ to Branch B'),
  ('coa-5030', '5030', 'Shipments from HQ — Branch A',      'COGS',      'DEBIT',  'Branch A received inventory from HQ'),
  ('coa-5031', '5031', 'Shipments from HQ — Branch B',      'COGS',      'DEBIT',  'Branch B received inventory from HQ'),
  ('coa-5040', '5040', 'Cost of Goods Sold — Branch A',     'COGS',      'DEBIT',  'COGS computed at period end for Branch A'),
  ('coa-5041', '5041', 'Cost of Goods Sold — Branch B',     'COGS',      'DEBIT',  'COGS computed at period end for Branch B'),
  -- EXPENSES
  ('coa-6010', '6010', 'Rent Expense',                      'EXPENSE',   'DEBIT',  'Office and warehouse rent'),
  ('coa-6020', '6020', 'Salaries & Wages Expense',          'EXPENSE',   'DEBIT',  'Employee salaries and wages'),
  ('coa-6030', '6030', 'Utilities Expense',                 'EXPENSE',   'DEBIT',  'Electricity, water, internet'),
  ('coa-6040', '6040', 'Transport & Logistics Expense',     'EXPENSE',   'DEBIT',  'Freight, delivery, transport costs'),
  ('coa-6050', '6050', 'Miscellaneous Expense',             'EXPENSE',   'DEBIT',  'Other minor operating expenses'),
  ('coa-6060', '6060', 'Depreciation Expense — Branch A',   'EXPENSE',   'DEBIT',  'Allocated depreciation for Branch A (60%)'),
  ('coa-6061', '6061', 'Depreciation Expense — Branch B',   'EXPENSE',   'DEBIT',  'Allocated depreciation for Branch B (40%)');

-- ─── Seed Default Fiscal Period (FY 2025) ─────────────────────────
INSERT OR IGNORE INTO fiscal_periods (id, name, period_type, start_date, end_date, status) VALUES
  ('fp-fy2025', 'FY 2025', 'ANNUAL', '2025-01-01', '2025-12-31', 'OPEN');
