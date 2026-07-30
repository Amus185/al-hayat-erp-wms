-- Disable foreign key constraints
PRAGMA foreign_keys = OFF;

-- 1. Unlink branch and warehouse foreign key references from users & active tables
UPDATE users SET branch_id = NULL, warehouse_id = NULL;

-- 2. Wipe accounting data (if accounting migration was run)
DELETE FROM depreciation_schedules;
DELETE FROM inventory_period_counts;
DELETE FROM trial_balance_snapshots;
DELETE FROM general_ledger;
DELETE FROM journal_entry_lines;
DELETE FROM journal_entries;
DELETE FROM fiscal_periods;
DELETE FROM chart_of_accounts;

-- 3. Wipe operational and transactional records
DELETE FROM invoice_payments;
DELETE FROM invoice_lines;
DELETE FROM invoices;
DELETE FROM purchase_invoices;
DELETE FROM sales_order_lines;
DELETE FROM sales_orders;
DELETE FROM quotations;
DELETE FROM customers;
DELETE FROM transfer_lines;
DELETE FROM transfers;
DELETE FROM goods_receipt_lines;
DELETE FROM goods_receipts;
DELETE FROM purchase_order_lines;
DELETE FROM purchase_orders;
DELETE FROM suppliers;
DELETE FROM inventory_transactions;
DELETE FROM inventory_stock;
DELETE FROM warehouse_locations;
DELETE FROM products;
DELETE FROM brands;
DELETE FROM categories;

-- 4. Delete branches and warehouses
DELETE FROM warehouses;
DELETE FROM branches;

-- 5. System logs & files
DELETE FROM audit_logs;
DELETE FROM notifications;
DELETE FROM files;

-- Re-enable foreign key constraints
PRAGMA foreign_keys = ON;
