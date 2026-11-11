// Client upgrade roadmap (26 items, docs/MULTI_LOCATION_PLAN.md section 17): schema.
// Additive only: new tables and new nullable columns. Safe to run on every start.
// One-time data steps are recorded in app_migrations.
import type { Pool } from 'pg';

export async function ensureRoadmap(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      -- Shared: company settings and per-user preferences
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_by TEXT,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT NOT NULL, key TEXT NOT NULL, value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, key)
      );

      -- 1. Class tracking
      CREATE TABLE IF NOT EXISTS accounting_classes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS accounting_classes_name_uq ON accounting_classes (lower(name));
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS class_id TEXT REFERENCES accounting_classes(id);
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS class_id TEXT REFERENCES accounting_classes(id);
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS class_id TEXT REFERENCES accounting_classes(id);
      ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS default_class_id TEXT REFERENCES accounting_classes(id);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_class ON journal_entries (class_id);

      -- 5. Multi-currency: the books stay in the base currency (USD). A money account may be kept in
      -- another currency; its lines keep the original amount and the rate used on the day.
      CREATE TABLE IF NOT EXISTS currencies (
        code TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT, is_base INTEGER NOT NULL DEFAULT 0,
        rate NUMERIC, is_active INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id TEXT PRIMARY KEY, currency_code TEXT NOT NULL REFERENCES currencies(code), rate NUMERIC NOT NULL,
        effective_date DATE NOT NULL DEFAULT CURRENT_DATE, created_by TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO currencies (code, name, symbol, is_base, rate) VALUES ('USD', 'US Dollar', '$', 1, 1) ON CONFLICT (code) DO NOTHING;
      INSERT INTO currencies (code, name, symbol, is_base, rate) VALUES ('SLSH', 'Somaliland Shilling', 'SLSH', 0, NULL) ON CONFLICT (code) DO NOTHING;
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS orig_currency TEXT;
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS orig_amount NUMERIC;
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC;

      -- 6. Bank reconciliation: statement lines are matched to ledger lines; nothing is posted.
      CREATE TABLE IF NOT EXISTS bank_statement_lines (
        id TEXT PRIMARY KEY, money_account_id TEXT NOT NULL REFERENCES money_accounts(id),
        line_date DATE NOT NULL, description TEXT, reference TEXT, amount NUMERIC NOT NULL,
        matched_line_id TEXT UNIQUE REFERENCES journal_entry_lines(id) ON DELETE SET NULL,
        matched_at TIMESTAMP WITH TIME ZONE, matched_by TEXT, created_by TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_bank_statement_account ON bank_statement_lines (money_account_id, line_date);

      -- 9. Selling price levels (Retail = the product's own price; others are set per product)
      CREATE TABLE IF NOT EXISTS selling_price_levels (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS selling_price_levels_name_uq ON selling_price_levels (lower(name));
      CREATE TABLE IF NOT EXISTS selling_level_prices (
        level_id TEXT NOT NULL REFERENCES selling_price_levels(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        price NUMERIC NOT NULL, updated_by TEXT,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (level_id, product_id)
      );
      INSERT INTO selling_price_levels (id, name, sort_order, is_default) VALUES
        ('spl-retail', 'Retail', 0, 1), ('spl-wholesale', 'Wholesale', 1, 0), ('spl-employee', 'Employee', 2, 0), ('spl-custom', 'Custom', 3, 0)
        ON CONFLICT (id) DO NOTHING;
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS price_level_id TEXT REFERENCES selling_price_levels(id);

      -- 13. Credit control: the limit is customers.credit_limit (0 = no limit); days before an invoice is overdue
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_days INTEGER NOT NULL DEFAULT 30;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_level_id TEXT REFERENCES selling_price_levels(id);

      -- 11. Quotations
      ALTER TABLE quotations ADD COLUMN IF NOT EXISTS converted_order_id TEXT;
      ALTER TABLE quotations ADD COLUMN IF NOT EXISTS price_level_id TEXT REFERENCES selling_price_levels(id);
      ALTER TABLE quotations ADD COLUMN IF NOT EXISTS discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE quotations ADD COLUMN IF NOT EXISTS customer_name TEXT;
      CREATE TABLE IF NOT EXISTS quotation_lines (
        id TEXT PRIMARY KEY, quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL,
        unit_price DOUBLE PRECISION NOT NULL, discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_quotation_lines_q ON quotation_lines (quotation_id);

      -- 15. Sales targets (employee = the seller's user id, branch, or the whole company), per month
      CREATE TABLE IF NOT EXISTS sales_targets (
        id TEXT PRIMARY KEY, scope_type TEXT NOT NULL CHECK (scope_type IN ('EMPLOYEE', 'BRANCH', 'COMPANY')),
        scope_id TEXT, period TEXT NOT NULL, amount NUMERIC NOT NULL, created_by TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sales_targets_uq ON sales_targets (scope_type, COALESCE(scope_id, ''), period);

      -- 19. Product variants (each variant is a product with its own SKU, stock and price)
      ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_product_id TEXT REFERENCES products(id);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_label TEXT;
      CREATE INDEX IF NOT EXISTS idx_products_parent ON products (parent_product_id);

      -- 20. Serial numbers and batches
      ALTER TABLE products ADD COLUMN IF NOT EXISTS tracking TEXT NOT NULL DEFAULT 'NONE';
      CREATE TABLE IF NOT EXISTS stock_lots (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), kind TEXT NOT NULL CHECK (kind IN ('BATCH', 'SERIAL')),
        code TEXT NOT NULL, quantity_in INTEGER NOT NULL, quantity_left INTEGER NOT NULL,
        warehouse_id TEXT, branch_id TEXT, source_type TEXT, source_id TEXT,
        received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (product_id, code)
      );
      CREATE INDEX IF NOT EXISTS idx_stock_lots_product ON stock_lots (product_id, received_at);
      CREATE TABLE IF NOT EXISTS stock_lot_moves (
        id TEXT PRIMARY KEY, lot_id TEXT NOT NULL REFERENCES stock_lots(id), quantity INTEGER NOT NULL,
        reference_type TEXT NOT NULL, reference_id TEXT NOT NULL, created_by TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_stock_lot_moves_ref ON stock_lot_moves (reference_type, reference_id);

      -- 22-24. Attendance, commissions, payroll
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id TEXT;
      CREATE TABLE IF NOT EXISTS employee_attendance (
        id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        work_date DATE NOT NULL, status TEXT NOT NULL CHECK (status IN ('PRESENT', 'LATE', 'ABSENT', 'LEAVE')),
        check_in TEXT, check_out TEXT, late_minutes INTEGER NOT NULL DEFAULT 0, notes TEXT, recorded_by TEXT,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (employee_id, work_date)
      );
      CREATE TABLE IF NOT EXISTS commission_rules (
        id TEXT PRIMARY KEY, employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('PERCENT_REVENUE', 'FIXED_PER_SALE', 'PERCENT_PRODUCT', 'FIXED_PER_UNIT')),
        rate NUMERIC NOT NULL, product_id TEXT REFERENCES products(id), is_active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id TEXT PRIMARY KEY, period TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'DRAFT',
        working_days INTEGER NOT NULL DEFAULT 26, journal_entry_id TEXT, created_by TEXT, approved_by TEXT, approved_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS payroll_lines (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees(id), branch_id TEXT,
        basic NUMERIC NOT NULL DEFAULT 0, absent_days INTEGER NOT NULL DEFAULT 0, attendance_deduction NUMERIC NOT NULL DEFAULT 0,
        commission NUMERIC NOT NULL DEFAULT 0, additions NUMERIC NOT NULL DEFAULT 0, other_deductions NUMERIC NOT NULL DEFAULT 0,
        advance_deduction NUMERIC NOT NULL DEFAULT 0, net NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'UNPAID', paid_at TIMESTAMP WITH TIME ZONE, money_account_id TEXT, notes TEXT,
        UNIQUE (run_id, employee_id)
      );
    `);
    // Accounts the new features post to (added once if missing; never renamed afterwards).
    await client.query(`
      INSERT INTO chart_of_accounts (id, code, name, account_type, normal_balance, is_active) VALUES
        ('coa-2060', '2060', 'Salaries Payable', 'LIABILITY', 'CREDIT', 1),
        ('coa-6095', '6095', 'Sales Commissions', 'EXPENSE', 'DEBIT', 1),
        ('coa-7010', '7010', 'Exchange Gain / Loss', 'EXPENSE', 'DEBIT', 1)
      ON CONFLICT DO NOTHING
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Roadmap schema migration failed (no data changed):', err);
    throw err;
  } finally {
    client.release();
  }
}
