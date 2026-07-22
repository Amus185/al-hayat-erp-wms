-- Disable foreign key constraints temporarily to avoid deletion errors
PRAGMA foreign_keys = OFF;

-- Remove foreign key references from the users table so we can delete branches/warehouses
UPDATE users SET branch_id = NULL, warehouse_id = NULL;

-- Wipe operational and transactional data
DELETE FROM audit_logs;
DELETE FROM notifications;
DELETE FROM files;
DELETE FROM invoice_lines;
DELETE FROM invoices;
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
DELETE FROM warehouses;
DELETE FROM branches;

-- Re-enable foreign key constraints
PRAGMA foreign_keys = ON;
