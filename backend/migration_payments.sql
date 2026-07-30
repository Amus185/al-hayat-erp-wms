-- ============================================================
-- Al Hayat ERP — Payments Migration
-- Run once: wrangler d1 execute al-hayat-db --file=./migration_payments.sql
-- Safe to re-inspect: all CREATE TABLE uses IF NOT EXISTS
-- ============================================================

-- 1. Ensure purchase_invoices exists (was created outside schema.sql)
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  total_amount REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  notes TEXT,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add discount_amount to invoices (sales) if missing
--    SQLite will error if column already exists — run once only
ALTER TABLE invoices ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;

-- 3. Add discount_amount and notes to purchase_invoices if missing
--    Run once only
ALTER TABLE purchase_invoices ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE purchase_invoices ADD COLUMN notes TEXT;

-- 4. Sales invoice payment records (unlimited installments)
CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'CASH',
  payment_date TEXT NOT NULL,
  notes TEXT,
  recorded_by TEXT REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

-- 5. Purchase invoice payment records (supplier deposits / installments)
CREATE TABLE IF NOT EXISTS purchase_invoice_payments (
  id TEXT PRIMARY KEY,
  purchase_invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'CASH',
  payment_date TEXT NOT NULL,
  notes TEXT,
  recorded_by TEXT REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pip_purchase_invoice ON purchase_invoice_payments(purchase_invoice_id);

-- 6. Back-fill: existing PAID sales invoices get one historical payment record
--    so payment history is not empty for all pre-migration invoices
INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by, created_at)
SELECT
  lower(hex(randomblob(16))),
  i.id,
  i.total_amount,
  'CASH',
  COALESCE(date(i.paid_at), date(i.issued_at)),
  'Historical payment (migrated)',
  NULL,
  COALESCE(i.paid_at, i.issued_at)
FROM invoices i
WHERE i.status = 'PAID'
  AND i.total_amount > 0
  AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.invoice_id = i.id);

-- 7. Back-fill: existing PAID purchase invoices get one historical payment record
INSERT INTO purchase_invoice_payments (id, purchase_invoice_id, amount, payment_method, payment_date, notes, recorded_by, created_at)
SELECT
  lower(hex(randomblob(16))),
  pi.id,
  pi.total_amount,
  'CASH',
  date(pi.issued_at),
  'Historical payment (migrated)',
  NULL,
  pi.issued_at
FROM purchase_invoices pi
WHERE pi.status = 'PAID'
  AND pi.total_amount > 0
  AND NOT EXISTS (SELECT 1 FROM purchase_invoice_payments pip WHERE pip.purchase_invoice_id = pi.id);
