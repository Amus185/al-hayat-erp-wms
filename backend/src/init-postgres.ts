import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Auth & Structural Reference Backup Data from D1 (Step 0 Backup Snapshot)
export const D1_AUTH_BACKUP = {
  branches: [
    { id: 'branch-hq-main', code: 'BR-HQ', name: 'Al Hayat HQ Showroom', city: 'Hargeisa', address: '26 June District, Main Street', phone: '+252 63 4440001', is_active: 1 },
    { id: 'branch-cl-show', code: 'BR-CL', name: 'Al Hayat CL Branch', city: 'Hargeisa', address: 'Bada Cas Area, Near Market', phone: '+252 63 4440002', is_active: 1 }
  ],
  warehouses: [
    { id: 'wh-main-01', code: 'WH-MAIN', name: 'Al Hayat Central Warehouse', city: 'Hargeisa', address: 'Industrial Zone, Block 4', phone: '+252 63 4440010', is_active: 1 },
    { id: 'wh-north-02', code: 'WH-NORTH', name: 'North Reserve Depot', city: 'Hargeisa', address: 'Airport Road', phone: '+252 63 4440011', is_active: 1 }
  ],
  permissions: [
    { id: '11111111-1111-1111-1111-111111111111', code: 'manage_users', description: 'Can manage users and roles' },
    { id: '22222222-2222-2222-2222-222222222222', code: 'manage_inventory', description: 'Can adjust stock and perform counts' },
    { id: '33333333-3333-3333-3333-333333333333', code: 'manage_transfers', description: 'Can create and approve transfers' },
    { id: '44444444-4444-4444-4444-444444444444', code: 'manage_purchasing', description: 'Can create POs and receive goods' },
    { id: '55555555-5555-5555-5555-555555555555', code: 'manage_sales', description: 'Can create sales orders and invoices' },
    { id: '66666666-6666-6666-6666-666666666666', code: 'view_reports', description: 'Can view analytical reports' }
  ],
  roles: [
    { id: '77777777-7777-7777-7777-777777777777', code: 'admin', name: 'System Administrator', description: 'Full access to all modules' },
    { id: 'role-branch-user', code: 'branch_user', name: 'Branch User', description: 'Auto-provisioned user scoped to a single branch' },
    { id: 'role-warehouse-manager', code: 'warehouse_manager', name: 'Warehouse Manager', description: 'Manages warehouse operations and transfers' },
    { id: 'role-sales-rep', code: 'sales_rep', name: 'Sales Representative', description: 'Creates sales orders and handles customer invoices' },
    { id: 'role-accountant', code: 'accountant', name: 'Accountant', description: 'Access to general ledger and financial reports' }
  ],
  role_permissions: [
    { role_id: '77777777-7777-7777-7777-777777777777', permission_id: '11111111-1111-1111-1111-111111111111' },
    { role_id: '77777777-7777-7777-7777-777777777777', permission_id: '22222222-2222-2222-2222-222222222222' },
    { role_id: '77777777-7777-7777-7777-777777777777', permission_id: '33333333-3333-3333-3333-333333333333' },
    { role_id: '77777777-7777-7777-7777-777777777777', permission_id: '44444444-4444-4444-4444-444444444444' },
    { role_id: '77777777-7777-7777-7777-777777777777', permission_id: '55555555-5555-5555-5555-555555555555' },
    { role_id: '77777777-7777-7777-7777-777777777777', permission_id: '66666666-6666-6666-6666-666666666666' },
    { role_id: 'role-branch-user', permission_id: '22222222-2222-2222-2222-222222222222' },
    { role_id: 'role-branch-user', permission_id: '33333333-3333-3333-3333-333333333333' },
    { role_id: 'role-branch-user', permission_id: '44444444-4444-4444-4444-444444444444' },
    { role_id: 'role-branch-user', permission_id: '55555555-5555-5555-5555-555555555555' },
    { role_id: 'role-branch-user', permission_id: '66666666-6666-6666-6666-666666666666' },
    { role_id: 'role-warehouse-manager', permission_id: '22222222-2222-2222-2222-222222222222' },
    { role_id: 'role-warehouse-manager', permission_id: '33333333-3333-3333-3333-333333333333' },
    { role_id: 'role-warehouse-manager', permission_id: '44444444-4444-4444-4444-444444444444' },
    { role_id: 'role-sales-rep', permission_id: '55555555-5555-5555-5555-555555555555' },
    { role_id: 'role-sales-rep', permission_id: '66666666-6666-6666-6666-666666666666' },
    { role_id: 'role-accountant', permission_id: '66666666-6666-6666-6666-666666666666' }
  ],
  users: [
    { id: '88888888-8888-8888-8888-888888888888', email: 'admin@alhayat.com', password_hash: '$2a$10$lg9bBDFZgleGwjwYDVCp3.iA1AT3n7SltsaQyYMbtvAeOH.CWO7ue', full_name: 'Admin User', branch_id: null, is_active: 1, password_version: 1 },
    { id: 'user-hq-branch-01', email: 'branch.hq@alhayat.com', password_hash: '$2b$10$eE5yX0rB.L8m8yT2H.X7u.Q5G3z1V9K2H3m8Y4T5U6V7W8X9Y0Z1', full_name: 'HQ Branch Manager', branch_id: 'branch-hq-main', is_active: 1, password_version: 1 },
    { id: 'user-cl-branch-02', email: 'branch.cl@alhayat.com', password_hash: '$2b$10$eE5yX0rB.L8m8yT2H.X7u.Q5G3z1V9K2H3m8Y4T5U6V7W8X9Y0Z1', full_name: 'CL Branch Manager', branch_id: 'branch-cl-show', is_active: 1, password_version: 1 }
  ],
  user_roles: [
    { user_id: '88888888-8888-8888-8888-888888888888', role_id: '77777777-7777-7777-7777-777777777777' },
    { user_id: 'user-hq-branch-01', role_id: 'role-branch-user' },
    { user_id: 'user-cl-branch-02', role_id: 'role-branch-user' }
  ],
  fiscal_periods: [
    { id: 'fp-2026-q3', period_name: '2026 Q3', start_date: '2026-07-01', end_date: '2026-09-30', status: 'OPEN' },
    { id: 'fp-2026-q4', period_name: '2026 Q4', start_date: '2026-10-01', end_date: '2026-12-31', status: 'OPEN' }
  ]
};

let initExecuted = false;

export async function ensurePostgresInit(pool: Pool) {
  if (initExecuted) return;
  initExecuted = true;

  const client = await pool.connect();
  try {
    console.log('⚡ Running PostgreSQL master schema & auth migration on startup...');

    // 1. Create all tables if they don't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, city TEXT NOT NULL, address TEXT, phone TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS warehouses (
        id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, city TEXT NOT NULL, address TEXT, phone TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, description TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT UNIQUE NOT NULL, description TEXT
      );
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, phone TEXT, branch_id TEXT REFERENCES branches(id), warehouse_id TEXT REFERENCES warehouses(id), is_active INTEGER NOT NULL DEFAULT 1, password_version INTEGER NOT NULL DEFAULT 1, last_login_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES warehouses(id);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, expires_at TIMESTAMP WITH TIME ZONE NOT NULL, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS warehouse_locations (
        id TEXT PRIMARY KEY, warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE, code TEXT NOT NULL, name TEXT NOT NULL, zone TEXT, aisle TEXT, rack TEXT, shelf TEXT, bin TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS chart_of_accounts (
        id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, account_type TEXT NOT NULL, normal_balance TEXT NOT NULL DEFAULT 'DEBIT', parent_id TEXT REFERENCES chart_of_accounts(id), description TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, description TEXT, parent_id TEXT REFERENCES categories(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS brands (
        id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, description TEXT, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, category_id TEXT REFERENCES categories(id), brand_id TEXT REFERENCES brands(id), unit_of_measure TEXT NOT NULL DEFAULT 'UNIT', cost_price DOUBLE PRECISION NOT NULL DEFAULT 0, selling_price DOUBLE PRECISION NOT NULL DEFAULT 0, reorder_level INTEGER NOT NULL DEFAULT 5, barcode TEXT UNIQUE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS inventory_stock (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, owner_type TEXT NOT NULL CHECK (owner_type IN ('WAREHOUSE', 'BRANCH')), warehouse_id TEXT REFERENCES warehouses(id), branch_id TEXT REFERENCES branches(id), location_id TEXT REFERENCES warehouse_locations(id), quantity_on_hand INTEGER NOT NULL DEFAULT 0, quantity_reserved INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), transaction_type TEXT NOT NULL, quantity INTEGER NOT NULL, source_owner_type TEXT CHECK (source_owner_type IN ('WAREHOUSE', 'BRANCH')), source_warehouse_id TEXT REFERENCES warehouses(id), source_branch_id TEXT REFERENCES branches(id), dest_owner_type TEXT CHECK (dest_owner_type IN ('WAREHOUSE', 'BRANCH')), dest_warehouse_id TEXT REFERENCES warehouses(id), dest_branch_id TEXT REFERENCES branches(id), reference_type TEXT, reference_id TEXT, created_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, city TEXT, credit_limit DOUBLE PRECISION NOT NULL DEFAULT 0, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, contact_person TEXT, email TEXT, phone TEXT, address TEXT, city TEXT, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sales_orders (
        id TEXT PRIMARY KEY, order_number TEXT UNIQUE NOT NULL, customer_id TEXT REFERENCES customers(id), branch_id TEXT NOT NULL REFERENCES branches(id), status TEXT NOT NULL DEFAULT 'DRAFT', quotation_id TEXT, total_amount DOUBLE PRECISION NOT NULL DEFAULT 0, notes TEXT, created_by TEXT REFERENCES users(id), confirmed_by TEXT REFERENCES users(id), confirmed_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sales_order_lines (
        id TEXT PRIMARY KEY, sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price DOUBLE PRECISION NOT NULL, discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0, line_total DOUBLE PRECISION NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS quotations (
        id TEXT PRIMARY KEY, quotation_number TEXT UNIQUE NOT NULL, customer_id TEXT REFERENCES customers(id), branch_id TEXT NOT NULL REFERENCES branches(id), status TEXT NOT NULL DEFAULT 'DRAFT', valid_until TIMESTAMP WITH TIME ZONE, total_amount DOUBLE PRECISION NOT NULL DEFAULT 0, notes TEXT, created_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY, invoice_number TEXT UNIQUE NOT NULL, sales_order_id TEXT NOT NULL REFERENCES sales_orders(id), total_amount DOUBLE PRECISION NOT NULL, discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'UNPAID', issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP WITH TIME ZONE
      );
      CREATE TABLE IF NOT EXISTS invoice_lines (
        id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price DOUBLE PRECISION NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invoice_payments (
        id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), amount DOUBLE PRECISION NOT NULL, payment_method TEXT NOT NULL DEFAULT 'CASH', payment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, notes TEXT, recorded_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY, po_number TEXT UNIQUE NOT NULL, supplier_id TEXT NOT NULL REFERENCES suppliers(id), branch_id TEXT REFERENCES branches(id), status TEXT NOT NULL DEFAULT 'DRAFT', total_amount DOUBLE PRECISION NOT NULL DEFAULT 0, notes TEXT, created_by TEXT REFERENCES users(id), approved_by TEXT REFERENCES users(id), approved_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS purchase_order_lines (
        id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_cost DOUBLE PRECISION NOT NULL, discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0, line_total DOUBLE PRECISION NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS goods_receipts (
        id TEXT PRIMARY KEY, receipt_number TEXT UNIQUE NOT NULL, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id), warehouse_id TEXT REFERENCES warehouses(id), destination_owner_type TEXT CHECK (destination_owner_type IN ('WAREHOUSE', 'BRANCH')), destination_warehouse_id TEXT REFERENCES warehouses(id), destination_branch_id TEXT REFERENCES branches(id), status TEXT DEFAULT 'DRAFT', received_by TEXT REFERENCES users(id), received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS goods_receipt_lines (
        id TEXT PRIMARY KEY, goods_receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), warehouse_location_id TEXT REFERENCES warehouse_locations(id), quantity_received INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id TEXT PRIMARY KEY, invoice_number TEXT UNIQUE NOT NULL, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id), total_amount DOUBLE PRECISION NOT NULL, discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'UNPAID', issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP WITH TIME ZONE
      );
      CREATE TABLE IF NOT EXISTS purchase_invoice_payments (
        id TEXT PRIMARY KEY, purchase_invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id), amount DOUBLE PRECISION NOT NULL, payment_method TEXT NOT NULL DEFAULT 'CASH', payment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, notes TEXT, recorded_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY, transfer_number TEXT UNIQUE NOT NULL, source_owner_type TEXT CHECK (source_owner_type IN ('WAREHOUSE', 'BRANCH')), source_warehouse_id TEXT REFERENCES warehouses(id), source_branch_id TEXT REFERENCES branches(id), destination_owner_type TEXT CHECK (destination_owner_type IN ('WAREHOUSE', 'BRANCH')), destination_warehouse_id TEXT REFERENCES warehouses(id), destination_branch_id TEXT REFERENCES branches(id), dest_owner_type TEXT, dest_warehouse_id TEXT, dest_branch_id TEXT, status TEXT NOT NULL DEFAULT 'DRAFT', notes TEXT, requested_by TEXT REFERENCES users(id), transfer_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, created_by TEXT REFERENCES users(id), approved_by TEXT REFERENCES users(id), approved_at TIMESTAMP WITH TIME ZONE, dispatched_by TEXT REFERENCES users(id), dispatched_at TIMESTAMP WITH TIME ZONE, received_by TEXT REFERENCES users(id), received_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS transfer_lines (
        id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fiscal_periods (
        id TEXT PRIMARY KEY, period_name TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY, entry_number TEXT UNIQUE NOT NULL, fiscal_period_id TEXT REFERENCES fiscal_periods(id), entry_date DATE NOT NULL, description TEXT NOT NULL, reference_type TEXT, reference_id TEXT, branch_id TEXT REFERENCES branches(id), status TEXT NOT NULL DEFAULT 'DRAFT', total_debit DOUBLE PRECISION NOT NULL DEFAULT 0, total_credit DOUBLE PRECISION NOT NULL DEFAULT 0, created_by TEXT REFERENCES users(id), posted_by TEXT REFERENCES users(id), posted_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id TEXT PRIMARY KEY, journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES chart_of_accounts(id), description TEXT, debit_amount DOUBLE PRECISION NOT NULL DEFAULT 0, credit_amount DOUBLE PRECISION NOT NULL DEFAULT 0, branch_id TEXT REFERENCES branches(id), line_order INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS general_ledger (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES chart_of_accounts(id), journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id), line_id TEXT REFERENCES journal_entry_lines(id), entry_date DATE NOT NULL, description TEXT, debit_amount DOUBLE PRECISION NOT NULL DEFAULT 0, credit_amount DOUBLE PRECISION NOT NULL DEFAULT 0, running_balance DOUBLE PRECISION NOT NULL DEFAULT 0, branch_id TEXT REFERENCES branches(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'INFO', read_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, old_value TEXT, new_value TEXT, actor_user_id TEXT REFERENCES users(id), ip_address TEXT, user_agent TEXT, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_size INTEGER NOT NULL, mime_type TEXT NOT NULL, object_key TEXT UNIQUE NOT NULL, uploaded_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Column Migrations for existing PostgreSQL instances
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id);
      ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS period_name TEXT;
      ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS period_type TEXT DEFAULT 'ANNUAL';
      ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
      ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS warehouse_location_id TEXT REFERENCES warehouse_locations(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS destination_owner_type TEXT;
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS destination_warehouse_id TEXT REFERENCES warehouses(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS destination_branch_id TEXT REFERENCES branches(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS source_owner_type TEXT;
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS source_warehouse_id TEXT REFERENCES warehouses(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS source_branch_id TEXT REFERENCES branches(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS requested_by TEXT REFERENCES users(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS transfer_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS destination_owner_type TEXT;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS destination_warehouse_id TEXT REFERENCES warehouses(id);
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS destination_branch_id TEXT REFERENCES branches(id);
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS destination_location_id TEXT REFERENCES warehouse_locations(id);
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS source_owner_type TEXT;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS source_warehouse_id TEXT REFERENCES warehouses(id);
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS source_branch_id TEXT REFERENCES branches(id);
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS source_location_id TEXT REFERENCES warehouse_locations(id);
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES users(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS dispatched_by TEXT REFERENCES users(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS received_by TEXT REFERENCES users(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS rejected_by TEXT REFERENCES users(id);
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS dest_owner_type TEXT;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS dest_warehouse_id TEXT REFERENCES warehouses(id);
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS dest_branch_id TEXT REFERENCES branches(id);
      ALTER TABLE transfers ALTER COLUMN dest_owner_type DROP NOT NULL;
      ALTER TABLE transfers ALTER COLUMN dest_warehouse_id DROP NOT NULL;
      ALTER TABLE transfers ALTER COLUMN dest_branch_id DROP NOT NULL;
      ALTER TABLE transfer_lines ADD COLUMN IF NOT EXISTS quantity_requested INTEGER;
      ALTER TABLE transfer_lines ADD COLUMN IF NOT EXISTS quantity_dispatched INTEGER;
      ALTER TABLE transfer_lines ADD COLUMN IF NOT EXISTS quantity_received INTEGER;
      ALTER TABLE transfer_lines ADD COLUMN IF NOT EXISTS quantity INTEGER;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_date TIMESTAMP WITH TIME ZONE;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES warehouses(id);
      ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES warehouses(id);
      ALTER TABLE goods_receipts ALTER COLUMN destination_owner_type DROP NOT NULL;
      ALTER TABLE goods_receipts ALTER COLUMN destination_warehouse_id DROP NOT NULL;
      ALTER TABLE goods_receipts ALTER COLUMN destination_branch_id DROP NOT NULL;
      ALTER TABLE goods_receipts ALTER COLUMN status DROP NOT NULL;
      ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS warehouse_location_id TEXT REFERENCES warehouse_locations(id);
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name TEXT;
      ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS quantity_received INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION;
      ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS line_total DOUBLE PRECISION;
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS quotation_id TEXT REFERENCES quotations(id);
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS installation_fee DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS installer_name TEXT;
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS installation_status TEXT DEFAULT 'NONE';
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS installer_notes TEXT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS installation_fee DOUBLE PRECISION NOT NULL DEFAULT 0;

      -- Deliveries System Tables
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY,
        delivery_number TEXT UNIQUE NOT NULL,
        sales_order_id TEXT REFERENCES sales_orders(id),
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        delivery_address TEXT NOT NULL,
        city TEXT NOT NULL DEFAULT 'Hargeisa',
        source_warehouse_id TEXT REFERENCES warehouses(id),
        driver_name TEXT,
        driver_phone TEXT,
        vehicle_plate TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        scheduled_date TIMESTAMP WITH TIME ZONE,
        dispatched_at TIMESTAMP WITH TIME ZONE,
        delivered_at TIMESTAMP WITH TIME ZONE,
        installation_required INTEGER NOT NULL DEFAULT 0,
        installer_name TEXT,
        installation_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        notes TEXT,
        recipient_signature_name TEXT,
        total_boxes INTEGER NOT NULL DEFAULT 1,
        delivered_boxes INTEGER NOT NULL DEFAULT 0,
        remaining_boxes INTEGER NOT NULL DEFAULT 1,
        created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS delivery_items (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS delivery_runs (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
        boxes_delivered INTEGER NOT NULL CHECK (boxes_delivered > 0),
        handled_by TEXT,
        driver_name TEXT,
        driver_phone TEXT,
        vehicle_plate TEXT,
        delivered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        recipient_signature_name TEXT,
        created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Customer Debts and Payments (Ledger & Credit Sales)
      CREATE TABLE IF NOT EXISTS customer_debts (
        id TEXT PRIMARY KEY,
        debt_number TEXT UNIQUE NOT NULL,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'MANUAL',
        amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
        remaining_balance DOUBLE PRECISION NOT NULL CHECK (remaining_balance >= 0),
        status TEXT NOT NULL DEFAULT 'UNPAID',
        debt_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        branch_id TEXT REFERENCES branches(id),
        created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS customer_payments (
        id TEXT PRIMARY KEY,
        receipt_number TEXT UNIQUE NOT NULL,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        allocation_type TEXT NOT NULL,
        invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
        manual_debt_id TEXT REFERENCES customer_debts(id) ON DELETE SET NULL,
        amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
        payment_method TEXT NOT NULL DEFAULT 'CASH',
        payment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        previous_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
        remaining_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
        notes TEXT,
        recorded_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS total_boxes INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS delivered_boxes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS remaining_boxes INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS is_credit_sale INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS initial_deposit DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cancelled_by TEXT REFERENCES users(id);
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_credit_sale INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_by TEXT REFERENCES users(id);
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS receipt_number TEXT;
      ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS previous_balance DOUBLE PRECISION;
      ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS running_balance DOUBLE PRECISION;

      -- Manufacturing Module Tables (BOM, Work Orders, Stages, Material Consumption)
      CREATE TABLE IF NOT EXISTS bill_of_materials (
        id TEXT PRIMARY KEY,
        bom_code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
        unit_of_measure TEXT NOT NULL DEFAULT 'UNIT',
        labor_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        overhead_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        estimated_hours DOUBLE PRECISION DEFAULT 0,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bom_items (
        id TEXT PRIMARY KEY,
        bom_id TEXT NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
        material_product_id TEXT NOT NULL REFERENCES products(id),
        quantity_required DOUBLE PRECISION NOT NULL CHECK (quantity_required > 0),
        unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        scrap_percentage DOUBLE PRECISION DEFAULT 0,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS work_orders (
        id TEXT PRIMARY KEY,
        wo_number TEXT UNIQUE NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        bom_id TEXT REFERENCES bill_of_materials(id),
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        target_quantity INTEGER NOT NULL CHECK (target_quantity > 0),
        completed_quantity INTEGER NOT NULL DEFAULT 0,
        rejected_quantity INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PLANNED',
        current_stage TEXT NOT NULL DEFAULT 'CUTTING_PREP',
        estimated_start_date DATE,
        actual_start_date TIMESTAMP WITH TIME ZONE,
        target_completion_date DATE,
        completed_at TIMESTAMP WITH TIME ZONE,
        material_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        labor_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        total_production_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        supervisor_id TEXT REFERENCES users(id),
        notes TEXT,
        created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS work_order_materials (
        id TEXT PRIMARY KEY,
        work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        material_product_id TEXT NOT NULL REFERENCES products(id),
        planned_quantity DOUBLE PRECISION NOT NULL,
        consumed_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
        unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING'
      );

      CREATE TABLE IF NOT EXISTS work_order_stages (
        id TEXT PRIMARY KEY,
        work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        stage_name TEXT NOT NULL,
        sequence_order INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        technician_name TEXT,
        notes TEXT
      );

      -- Backfill purchase_order_lines.quantity_received from existing goods_receipt_lines
      UPDATE purchase_order_lines pol
      SET quantity_received = COALESCE((
        SELECT SUM(grl.quantity_received) 
        FROM goods_receipt_lines grl 
        JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id 
        WHERE gr.purchase_order_id = pol.purchase_order_id AND grl.product_id = pol.product_id
      ), 0);

      -- Backfill missing purchase_invoices for purchase orders to ensure accurate AP & payment tracking
      INSERT INTO purchase_invoices (id, invoice_number, purchase_order_id, total_amount, discount_amount, status, issued_at)
      SELECT 
        'pi-' || po.id,
        'PI-' || po.po_number,
        po.id,
        COALESCE((SELECT SUM(quantity * unit_cost) FROM purchase_order_lines WHERE purchase_order_id = po.id), po.total_amount, 0),
        COALESCE((SELECT SUM(discount_amount) FROM purchase_order_lines WHERE purchase_order_id = po.id), 0),
        'UNPAID',
        po.created_at
      FROM purchase_orders po
      WHERE NOT EXISTS (SELECT 1 FROM purchase_invoices pi WHERE pi.purchase_order_id = po.id);

      -- Reconcile existing purchase_invoices total_amount to gross line sum
      UPDATE purchase_invoices pi
      SET total_amount = COALESCE((
        SELECT SUM(pol.quantity * pol.unit_cost)
        FROM purchase_order_lines pol
        WHERE pol.purchase_order_id = pi.purchase_order_id
      ), pi.total_amount),
      discount_amount = COALESCE((
        SELECT SUM(pol.discount_amount)
        FROM purchase_order_lines pol
        WHERE pol.purchase_order_id = pi.purchase_order_id
      ), pi.discount_amount);

      -- Reconcile purchase order statuses based on actual received quantities
      UPDATE purchase_orders po
      SET status = CASE
        WHEN (SELECT COALESCE(SUM(quantity_received), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id) >= (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id) AND (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id) > 0 THEN 'RECEIVED'
        WHEN (SELECT COALESCE(SUM(quantity_received), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id) > 0 THEN 'PARTIALLY_RECEIVED'
        ELSE status
      END
      WHERE status IN ('SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED');

      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
        category TEXT NOT NULL,
        expense_date TEXT NOT NULL,
        branch_id TEXT REFERENCES branches(id),
        payment_method TEXT NOT NULL DEFAULT 'CASH',
        notes TEXT,
        recorded_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_period_counts (
        id TEXT PRIMARY KEY,
        fiscal_period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
        branch_id TEXT REFERENCES branches(id),
        warehouse_id TEXT REFERENCES warehouses(id),
        count_date DATE NOT NULL,
        total_value DOUBLE PRECISION NOT NULL DEFAULT 0,
        notes TEXT,
        counted_by TEXT REFERENCES users(id),
        approved_by TEXT REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'DRAFT',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS depreciation_schedules (
        id TEXT PRIMARY KEY,
        asset_name TEXT NOT NULL,
        asset_account_id TEXT REFERENCES chart_of_accounts(id),
        accum_dep_account_id TEXT REFERENCES chart_of_accounts(id),
        dep_expense_account_id TEXT REFERENCES chart_of_accounts(id),
        acquisition_date DATE NOT NULL,
        cost DOUBLE PRECISION NOT NULL,
        salvage_value DOUBLE PRECISION NOT NULL DEFAULT 0,
        useful_life_years INTEGER NOT NULL,
        method TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
        fiscal_period_id TEXT REFERENCES fiscal_periods(id),
        period_depreciation DOUBLE PRECISION NOT NULL DEFAULT 0,
        notes TEXT,
        created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, name TEXT, property_type TEXT CHECK (property_type IN ('HOUSE','LAND','BUILDING','APARTMENT')), address TEXT, city TEXT, area_sqm DOUBLE PRECISION, purchase_price DOUBLE PRECISION, purchase_date TEXT, current_value DOUBLE PRECISION, status TEXT DEFAULT 'VACANT' CHECK (status IN ('OWNED','RENTED','VACANT','SOLD')), notes TEXT, created_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE, updated_at TIMESTAMP WITH TIME ZONE);
      CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT, phone TEXT, email TEXT, id_number TEXT, address TEXT, is_active INTEGER DEFAULT 1, created_at TIMESTAMP WITH TIME ZONE, updated_at TIMESTAMP WITH TIME ZONE);
      CREATE TABLE IF NOT EXISTS lease_agreements (id TEXT PRIMARY KEY, property_id TEXT REFERENCES properties(id), tenant_id TEXT REFERENCES tenants(id), monthly_rent DOUBLE PRECISION, start_date TEXT, end_date TEXT, payment_day INTEGER DEFAULT 1, deposit_amount DOUBLE PRECISION DEFAULT 0, status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','TERMINATED')), notes TEXT, created_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE, updated_at TIMESTAMP WITH TIME ZONE);
      CREATE TABLE IF NOT EXISTS rental_payments (id TEXT PRIMARY KEY, lease_agreement_id TEXT REFERENCES lease_agreements(id), amount DOUBLE PRECISION CHECK (amount > 0), payment_method TEXT DEFAULT 'CASH', payment_date TEXT, period_month INTEGER, period_year INTEGER, notes TEXT, recorded_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE);
      CREATE TABLE IF NOT EXISTS property_expenses (id TEXT PRIMARY KEY, property_id TEXT REFERENCES properties(id), title TEXT, amount DOUBLE PRECISION CHECK (amount > 0), category TEXT DEFAULT 'MAINTENANCE' CHECK (category IN ('MAINTENANCE','TAX','INSURANCE','UTILITIES','RENOVATION','OTHER')), expense_date TEXT, payment_method TEXT DEFAULT 'CASH', notes TEXT, recorded_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE);
      CREATE TABLE IF NOT EXISTS livestock (id TEXT PRIMARY KEY, animal_type TEXT, breed TEXT, tag_number TEXT UNIQUE, name TEXT, quantity INTEGER DEFAULT 1, unit_cost DOUBLE PRECISION DEFAULT 0, total_value DOUBLE PRECISION DEFAULT 0, purchase_date TEXT, status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SOLD','DECEASED')), notes TEXT, created_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE, updated_at TIMESTAMP WITH TIME ZONE);
      CREATE TABLE IF NOT EXISTS livestock_transactions (id TEXT PRIMARY KEY, livestock_id TEXT REFERENCES livestock(id), transaction_type TEXT CHECK (transaction_type IN ('PURCHASE','SALE','BIRTH','DEATH','TRANSFER')), quantity INTEGER, unit_price DOUBLE PRECISION DEFAULT 0, total_amount DOUBLE PRECISION DEFAULT 0, buyer_seller_name TEXT, transaction_date TEXT, notes TEXT, recorded_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE);
      CREATE TABLE IF NOT EXISTS livestock_expenses (id TEXT PRIMARY KEY, livestock_id TEXT REFERENCES livestock(id), title TEXT, amount DOUBLE PRECISION CHECK (amount > 0), category TEXT DEFAULT 'FEED' CHECK (category IN ('FEED','VETERINARY','SHELTER','TRANSPORT','LABOR','OTHER')), expense_date TEXT, payment_method TEXT DEFAULT 'CASH', notes TEXT, recorded_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE);
    `);


    // 2. Populate auth & permissions data from D1 Backup
    //    ORDER MATTERS: branches/warehouses must exist before users (FK constraint)

    // 2a. Branches first
    for (const row of D1_AUTH_BACKUP.branches) {
      await client.query(
        `INSERT INTO branches (id, code, name, city, address, phone, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, is_active = EXCLUDED.is_active`,
        [row.id, row.code, row.name, row.city, row.address, row.phone, row.is_active]
      );
    }

    // 2b. Warehouses
    for (const row of D1_AUTH_BACKUP.warehouses) {
      await client.query(
        `INSERT INTO warehouses (id, code, name, city, address, phone, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, is_active = EXCLUDED.is_active`,
        [row.id, row.code, row.name, row.city, row.address, row.phone, row.is_active]
      );
    }

    // 2c. Permissions
    for (const row of D1_AUTH_BACKUP.permissions) {
      await client.query(
        `INSERT INTO permissions (id, code, description) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.code, row.description]
      );
    }

    // 2d. Roles
    for (const row of D1_AUTH_BACKUP.roles) {
      await client.query(
        `INSERT INTO roles (id, code, name, description) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.code, row.name, row.description]
      );
    }

    // 2e. Role permissions
    for (const row of D1_AUTH_BACKUP.role_permissions) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [row.role_id, row.permission_id]
      );
    }

    // 2f. Users — insert with null branch_id first to avoid FK issues, then update hash
    for (const row of D1_AUTH_BACKUP.users) {
      // Validate branch_id exists before using it
      let safeBranchId = row.branch_id;
      if (safeBranchId) {
        const branchExists = await client.query(`SELECT id FROM branches WHERE id = $1`, [safeBranchId]);
        if (!branchExists.rows.length) safeBranchId = null;
      }
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, branch_id, is_active, password_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           password_version = EXCLUDED.password_version,
           is_active = EXCLUDED.is_active`,
        [row.id, row.email, row.password_hash, row.full_name, safeBranchId, row.is_active, row.password_version]
      );
    }

    // 2g. User roles
    for (const row of D1_AUTH_BACKUP.user_roles) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [row.user_id, row.role_id]
      );
    }

    // Default Fiscal Periods (always ensure current year exists and is OPEN)
    const currentYear = new Date().getFullYear();
    await client.query(`
      INSERT INTO fiscal_periods (id, name, period_name, period_type, start_date, end_date, status)
      VALUES ($1, $2, $2, 'ANNUAL', $3, $4, 'OPEN')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        period_name = EXCLUDED.period_name,
        status = CASE WHEN fiscal_periods.status = 'CLOSED' THEN 'CLOSED' ELSE 'OPEN' END
    `, [`fp-${currentYear}-annual`, `FY ${currentYear}`, `${currentYear}-01-01`, `${currentYear}-12-31`]);

    // Standard Chart of Accounts (always ensure all required accounts exist)
    const coaAccounts = [
      // Assets
      { id: 'coa-1010', code: '1010', name: 'Cash & Cash Equivalents',       account_type: 'ASSET',     normal_balance: 'DEBIT'  },
      { id: 'coa-1020', code: '1020', name: 'Accounts Receivable',            account_type: 'ASSET',     normal_balance: 'DEBIT'  },
      { id: 'coa-1030', code: '1030', name: 'Inventory Asset',                account_type: 'ASSET',     normal_balance: 'DEBIT'  },
      { id: 'coa-1500', code: '1500', name: 'Fixed Assets',                   account_type: 'ASSET',     normal_balance: 'DEBIT'  },
      { id: 'coa-1501', code: '1501', name: 'Accumulated Depreciation',       account_type: 'ASSET',     normal_balance: 'CREDIT' },
      // Liabilities
      { id: 'coa-2010', code: '2010', name: 'Accounts Payable',               account_type: 'LIABILITY', normal_balance: 'CREDIT' },
      // Equity
      { id: 'coa-3010', code: '3010', name: "Owner's Capital",                account_type: 'EQUITY',    normal_balance: 'CREDIT' },
      { id: 'coa-3020', code: '3020', name: 'Retained Earnings',              account_type: 'EQUITY',    normal_balance: 'CREDIT' },
      { id: 'coa-3030', code: '3030', name: 'Income Summary',                 account_type: 'EQUITY',    normal_balance: 'CREDIT' },
      { id: 'coa-3040', code: '3040', name: "Owner's Drawings",               account_type: 'EQUITY',    normal_balance: 'DEBIT'  },
      // Revenue
      { id: 'coa-4010', code: '4010', name: 'Sales Revenue',                  account_type: 'REVENUE',   normal_balance: 'CREDIT' },
      { id: 'coa-5030', code: '5030', name: 'Inventory Gain',                 account_type: 'REVENUE',   normal_balance: 'CREDIT' },
      // Expenses / COGS
      { id: 'coa-5010', code: '5010', name: 'Cost of Goods Sold',             account_type: 'EXPENSE',   normal_balance: 'DEBIT'  },
      { id: 'coa-5020', code: '5020', name: 'Inventory Loss / Shrinkage',     account_type: 'EXPENSE',   normal_balance: 'DEBIT'  },
      { id: 'coa-6010', code: '6010', name: 'Operating Expenses',             account_type: 'EXPENSE',   normal_balance: 'DEBIT'  },
      { id: 'coa-6050', code: '6050', name: 'General & Administrative Expenses', account_type: 'EXPENSE', normal_balance: 'DEBIT' },
      { id: 'coa-6060', code: '6060', name: 'Depreciation Expense',           account_type: 'EXPENSE',   normal_balance: 'DEBIT'  },
      { id: 'coa-1040', code: '1040', name: 'Real Estate Properties',         account_type: 'ASSET',     normal_balance: 'DEBIT'  },
      { id: 'coa-1050', code: '1050', name: 'Livestock Assets',               account_type: 'ASSET',     normal_balance: 'DEBIT'  },
      { id: 'coa-1060', code: '1060', name: 'Tenant Security Deposits',       account_type: 'LIABILITY', normal_balance: 'CREDIT' },
      { id: 'coa-4020', code: '4020', name: 'Rental Income',                  account_type: 'REVENUE',   normal_balance: 'CREDIT' },
      { id: 'coa-4030', code: '4030', name: 'Livestock Sales Revenue',        account_type: 'REVENUE',   normal_balance: 'CREDIT' },
      { id: 'coa-5040', code: '5040', name: 'Livestock Cost of Sales',        account_type: 'EXPENSE',      normal_balance: 'DEBIT'  },
      { id: 'coa-6070', code: '6070', name: 'Property Expenses',              account_type: 'EXPENSE',   normal_balance: 'DEBIT'  },
      { id: 'coa-6080', code: '6080', name: 'Livestock Expenses',             account_type: 'EXPENSE',   normal_balance: 'DEBIT'  },
      { id: 'coa-2050', code: '2050', name: 'Technician Installation Fees Payable', account_type: 'LIABILITY', normal_balance: 'CREDIT' },
      { id: 'coa-1070', code: '1070', name: 'Work in Progress (WIP Manufacturing)', account_type: 'ASSET', normal_balance: 'DEBIT'  },
    ];


    for (const acc of coaAccounts) {
      await client.query(`
        INSERT INTO chart_of_accounts (id, code, name, account_type, normal_balance, is_active)
        VALUES ($1, $2, $3, $4, $5, 1)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          account_type = EXCLUDED.account_type,
          normal_balance = EXCLUDED.normal_balance,
          is_active = 1
      `, [acc.id, acc.code, acc.name, acc.account_type, acc.normal_balance]);
      // Also handle conflict on unique code column
      await client.query(`
        INSERT INTO chart_of_accounts (id, code, name, account_type, normal_balance, is_active)
        VALUES ($1, $2, $3, $4, $5, 1)
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          account_type = EXCLUDED.account_type,
          normal_balance = EXCLUDED.normal_balance,
          is_active = 1
      `, [acc.id, acc.code, acc.name, acc.account_type, acc.normal_balance]).catch(() => {});
    }


    console.log('✅ PostgreSQL Master Schema & Auth Data Migration Verified on Startup!');
  } catch (err) {
    console.error('❌ Error initializing PostgreSQL master schema:', err);
  } finally {
    client.release();
  }
}
