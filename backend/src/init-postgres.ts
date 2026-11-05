import { Pool } from 'pg';
import { migrateAuthSchema } from './auth';
import { backfillIdentities } from './services/identity';

// Auth & Structural Reference Seed Data
export const DEFAULT_AUTH_SEED = {
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
        id TEXT PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, category_id TEXT REFERENCES categories(id), brand_id TEXT REFERENCES brands(id), unit_of_measure TEXT NOT NULL DEFAULT 'UNIT', cost_price DOUBLE PRECISION NOT NULL DEFAULT 0, selling_price DOUBLE PRECISION NOT NULL DEFAULT 0, reorder_level INTEGER NOT NULL DEFAULT 5, product_type TEXT NOT NULL DEFAULT 'STANDARD', barcode TEXT UNIQUE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS product_group_items (
        id TEXT PRIMARY KEY,
        parent_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        component_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (parent_product_id, component_product_id)
      );
      CREATE TABLE IF NOT EXISTS product_price_tiers (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        tier_name TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL CHECK (price >= 0),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (product_id, tier_name)
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
        id TEXT PRIMARY KEY, order_number TEXT UNIQUE NOT NULL, customer_id TEXT REFERENCES customers(id), branch_id TEXT NOT NULL REFERENCES branches(id), status TEXT NOT NULL DEFAULT 'DRAFT', quotation_id TEXT, total_amount DOUBLE PRECISION NOT NULL DEFAULT 0, notes TEXT, created_by TEXT REFERENCES users(id), confirmed_by TEXT REFERENCES users(id), confirmed_at TIMESTAMP WITH TIME ZONE, fulfillment_type TEXT NOT NULL DEFAULT 'DELIVERY', created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sales_order_lines (
        id TEXT PRIMARY KEY, sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price DOUBLE PRECISION NOT NULL, discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0, line_total DOUBLE PRECISION NOT NULL DEFAULT 0, fulfillment_type TEXT NOT NULL DEFAULT 'DELIVERY'
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
      ALTER TABLE products DROP COLUMN IF EXISTS box_count;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'STANDARD';
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
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'DELIVERY';
      ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'DELIVERY';
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS installation_fee DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE warehouse_locations ADD COLUMN IF NOT EXISTS barcode TEXT;

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

      ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
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


    // 2. Populate auth & permissions data
    //    ORDER MATTERS: branches/warehouses must exist before users (FK constraint)

    // 2a. Branches first
    for (const row of DEFAULT_AUTH_SEED.branches) {
      await client.query(
        `INSERT INTO branches (id, code, name, city, address, phone, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, is_active = EXCLUDED.is_active`,
        [row.id, row.code, row.name, row.city, row.address, row.phone, row.is_active]
      );
    }

    // 2b. Warehouses
    for (const row of DEFAULT_AUTH_SEED.warehouses) {
      await client.query(
        `INSERT INTO warehouses (id, code, name, city, address, phone, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, is_active = EXCLUDED.is_active`,
        [row.id, row.code, row.name, row.city, row.address, row.phone, row.is_active]
      );
    }

    // 2c. Permissions
    for (const row of DEFAULT_AUTH_SEED.permissions) {
      await client.query(
        `INSERT INTO permissions (id, code, description) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.code, row.description]
      );
    }

    // 2d. Roles
    for (const row of DEFAULT_AUTH_SEED.roles) {
      await client.query(
        `INSERT INTO roles (id, code, name, description) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.code, row.name, row.description]
      );
    }

    // 2e. Role permissions
    for (const row of DEFAULT_AUTH_SEED.role_permissions) {
      await client.query(
        // No unique constraint on this table yet, so ON CONFLICT never fires:
        // insert only when the pair is missing (it used to add a copy per run).
        `INSERT INTO role_permissions (role_id, permission_id) SELECT $1::text, $2::text
         WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2)`,
        [row.role_id, row.permission_id]
      );
    }

    // 2f. Users — seed only when missing. Never overwrite an existing user's
    // password, version or active flag: this runs on every boot.
    for (const row of DEFAULT_AUTH_SEED.users) {
      // Validate branch_id exists before using it
      let safeBranchId = row.branch_id;
      if (safeBranchId) {
        const branchExists = await client.query(`SELECT id FROM branches WHERE id = $1`, [safeBranchId]);
        if (!branchExists.rows.length) safeBranchId = null;
      }
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, branch_id, is_active, password_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [row.id, row.email, row.password_hash, row.full_name, safeBranchId, row.is_active, row.password_version]
      );
    }

    // 2g. User roles
    for (const row of DEFAULT_AUTH_SEED.user_roles) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) SELECT $1::text, $2::text
         WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2)`,
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
      // Inter-branch clearing: stock moved between branches is posted out of the
      // sender's books and into the receiver's through this account; it nets to
      // zero in the consolidated view.
      { id: 'coa-1090', code: '1090', name: 'Inter-Branch Clearing', account_type: 'ASSET', normal_balance: 'DEBIT' },
      // Salary advances given to employees (owed back to the company) and payroll cost.
      { id: 'coa-1080', code: '1080', name: 'Employee Advances', account_type: 'ASSET', normal_balance: 'DEBIT' },
      { id: 'coa-6090', code: '6090', name: 'Salaries & Wages', account_type: 'EXPENSE', normal_balance: 'DEBIT' },
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

  await ensureBranchAttribution(pool);
  await ensureLedgerView(pool);
  await ensureAuthSchema(pool);
  await ensureStorefrontSchema(pool);
  await ensureAgentSchema(pool);
  await ensureBetterAuth(pool);
  await ensureWorkforceSchema(pool);
  await ensureAccessGrants(pool);
  await ensureBranchIsolation(pool);
  await ensureCosting(pool);
  await ensurePerformanceIndexes(pool);
  await ensureRoleSeparation(pool);
}

/**
 * Financial privacy permissions (cost prices / stock value, payroll) and
 * per-person grants. Additive only. Each new permission's default role grants
 * are applied once, when the permission is first created, so the Owner's later
 * changes to roles are never undone by a migration.
 */
/**
 * Branch isolation (Owner request): which branch owns deliveries and
 * manufacture records, which branches deal with a shared
 * customer or product, and per-branch item groups. Additive only; existing rows
 * keep working: a NULL branch is company-level (visible to the Owner).
 */
export async function ensureBranchIsolation(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
      CREATE INDEX IF NOT EXISTS idx_deliveries_branch_id ON deliveries (branch_id);
      ALTER TABLE mfg_jobs ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
      CREATE INDEX IF NOT EXISTS idx_mfg_jobs_branch_id ON mfg_jobs (branch_id);
      ALTER TABLE mfg_item_groups ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
      DROP INDEX IF EXISTS mfg_item_groups_name_uq;
      CREATE UNIQUE INDEX IF NOT EXISTS mfg_item_groups_branch_name_uq ON mfg_item_groups (COALESCE(branch_id, ''), lower(name));
      CREATE TABLE IF NOT EXISTS customer_branches (
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (customer_id, branch_id)
      );
      CREATE INDEX IF NOT EXISTS idx_customer_branches_branch ON customer_branches (branch_id);
      CREATE TABLE IF NOT EXISTS product_branches (
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (product_id, branch_id)
      );
      CREATE INDEX IF NOT EXISTS idx_product_branches_branch ON product_branches (branch_id);
      -- Sales returns: goods that came back after a sale (separate from cancelling a sale).
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS returned_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refunded_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS sales_returns (
        id TEXT PRIMARY KEY, return_number TEXT NOT NULL UNIQUE,
        sales_order_id TEXT NOT NULL REFERENCES sales_orders(id), invoice_id TEXT NOT NULL REFERENCES invoices(id),
        branch_id TEXT REFERENCES branches(id), customer_id TEXT REFERENCES customers(id),
        reason TEXT NOT NULL, return_value DOUBLE PRECISION NOT NULL DEFAULT 0, refund_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        refund_method TEXT, created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sales_returns_order ON sales_returns (sales_order_id);
      CREATE INDEX IF NOT EXISTS idx_sales_returns_branch ON sales_returns (branch_id);
      CREATE TABLE IF NOT EXISTS sales_return_lines (
        id TEXT PRIMARY KEY, return_id TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price DOUBLE PRECISION NOT NULL DEFAULT 0, line_value DOUBLE PRECISION NOT NULL DEFAULT 0,
        condition TEXT NOT NULL DEFAULT 'RESALEABLE' CHECK (condition IN ('RESALEABLE', 'DAMAGED'))
      );
      -- Price adjustments: the product's price at the time of sale and why the sold price differs.
      ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS list_price DOUBLE PRECISION;
      ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;
      -- Company vehicles (Employees section), picked on deliveries.
      CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT PRIMARY KEY, plate_number TEXT NOT NULL, make TEXT, model TEXT, vehicle_type TEXT, capacity_note TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        default_driver_id TEXT REFERENCES employees(id) ON DELETE SET NULL, driver_name TEXT, driver_phone TEXT,
        branch_id TEXT REFERENCES branches(id), notes TEXT, created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      DROP INDEX IF EXISTS vehicles_plate_uq;
      CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plate_norm_uq ON vehicles (upper(regexp_replace(plate_number, '[^A-Za-z0-9]', '', 'g')));
      CREATE INDEX IF NOT EXISTS idx_vehicles_branch ON vehicles (branch_id);
      ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_deliveries_vehicle ON deliveries (vehicle_id);
      -- Existing deliveries belong to the branch of their sales order.
      UPDATE deliveries d SET branch_id = so.branch_id
        FROM sales_orders so WHERE so.id = d.sales_order_id AND d.branch_id IS NULL AND so.branch_id IS NOT NULL;
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Branch isolation migration failed (no data changed):', err);
  } finally {
    client.release();
  }
}

/**
 * Running-average costing (Owner request): cost comes from goods coming in, never typed
 * once a product has stock; each sale line keeps its unit cost; every cost and selling
 * price change is kept with who/when/why. Additive. The one-time recalculation of current
 * costs (from the purchases that make up today's stock) runs once, recorded in app_migrations,
 * and writes every old value into product_price_history so it can be reviewed or undone.
 */
export async function ensureCosting(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, ran_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP);
      ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION;
      CREATE TABLE IF NOT EXISTS product_price_history (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('COST', 'SELLING')),
        old_value DOUBLE PRECISION, new_value DOUBLE PRECISION NOT NULL,
        source TEXT NOT NULL, reference_id TEXT, changed_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_price_history_product ON product_price_history (product_id, created_at DESC);
      -- Price levels: batches of one product at different cost/selling prices, sold oldest first.
      CREATE TABLE IF NOT EXISTS product_price_levels (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        level_no INTEGER NOT NULL, cost_price DOUBLE PRECISION NOT NULL CHECK (cost_price >= 0),
        selling_price DOUBLE PRECISION NOT NULL CHECK (selling_price >= 0),
        quantity_in INTEGER NOT NULL CHECK (quantity_in >= 0), quantity_left INTEGER NOT NULL CHECK (quantity_left >= 0),
        source TEXT NOT NULL, reference_id TEXT, note TEXT, created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        activated_at TIMESTAMP WITH TIME ZONE, depleted_at TIMESTAMP WITH TIME ZONE,
        UNIQUE (product_id, level_no)
      );
      CREATE TABLE IF NOT EXISTS product_price_level_moves (
        id TEXT PRIMARY KEY, level_id TEXT NOT NULL REFERENCES product_price_levels(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, quantity INTEGER NOT NULL,
        unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0, reference_type TEXT NOT NULL, reference_id TEXT,
        created_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_level_moves_ref ON product_price_level_moves (reference_id);
      CREATE INDEX IF NOT EXISTS idx_level_moves_product ON product_price_level_moves (product_id);
      ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS price_breakdown TEXT;
    `);
    const done = await client.query("SELECT 1 FROM app_migrations WHERE name = 'costing_recalc_v1'");
    if (!done.rowCount) {
      // Today's stock is made of the most recent purchases: cost each product from the newest
      // receipts until its stock on hand is covered; any part not covered keeps the current cost.
      const { rows: prods } = await client.query(`
        SELECT p.id, COALESCE(p.cost_price, 0) AS cost,
               (SELECT COALESCE(SUM(GREATEST(s.quantity_on_hand, 0)), 0) FROM inventory_stock s WHERE s.product_id = p.id) AS on_hand
        FROM products p WHERE COALESCE(p.product_type, 'STANDARD') <> 'GROUPED'`);
      for (const pr of prods) {
        const onHand = Number(pr.on_hand);
        if (!(onHand > 0)) continue;
        const { rows: rec } = await client.query(`
          SELECT grl.quantity_received AS q, COALESCE(grl.line_total / NULLIF(grl.quantity_received, 0), grl.unit_cost, 0) AS u
          FROM goods_receipt_lines grl JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
          WHERE grl.product_id = $1 AND COALESCE(gr.status, 'COMPLETED') <> 'CANCELLED' AND grl.quantity_received > 0
          ORDER BY gr.received_at DESC, grl.id DESC`, [pr.id]);
        if (!rec.length) continue;
        let left = onHand; let value = 0;
        for (const r of rec) { if (left <= 0) break; const take = Math.min(left, Number(r.q)); value += take * Number(r.u); left -= take; }
        value += left * Number(pr.cost);
        const next = Math.round((value / onHand) * 10000) / 10000;
        if (Math.abs(next - Number(pr.cost)) < 0.00005) continue;
        await client.query(`INSERT INTO product_price_history (id, product_id, kind, old_value, new_value, source)
                            VALUES (gen_random_uuid()::text, $1, 'COST', $2, $3, 'RECALCULATED_FROM_PURCHASES')`, [pr.id, pr.cost, next]);
        await client.query('UPDATE products SET cost_price = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [next, pr.id]);
      }
      await client.query("INSERT INTO app_migrations (name) VALUES ('costing_recalc_v1')");
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ ensureCosting failed:', e);
  } finally {
    client.release();
  }
}

export const ACCESS_PERMISSIONS = [
  { id: 'perm-costs-view', code: 'costs.view', description: 'See cost prices, purchase costs, stock value and margins',
    // Owner decision D4: Owner and accounting staff; anyone else by an explicit grant.
    roles: ['77777777-7777-7777-7777-777777777777', 'role-accountant'] },
  { id: 'perm-payroll-view', code: 'payroll.view', description: 'See salaries, salary advances and employment documents',
    roles: ['77777777-7777-7777-7777-777777777777'] },
  { id: 'perm-payroll-manage', code: 'payroll.manage', description: 'Change salaries, record advances, upload employment documents',
    roles: ['77777777-7777-7777-7777-777777777777'] },
  { id: 'perm-employees-manage', code: 'employees.manage', description: "Add and edit employees' ordinary details (own branch)",
    roles: ['77777777-7777-7777-7777-777777777777', 'role-branch-user'] },
  // Financial statements, ledger, journal, cash and bank, depreciation (the Accounting module).
  { id: 'perm-accounting-view', code: 'accounting.view', description: 'Open the Accounting module: statements, ledger, journal, cash and bank',
    roles: ['77777777-7777-7777-7777-777777777777', 'role-accountant'] },
  // Expenses used to need the purchasing right; branch managers record their branch's daily
  // expenses without being allowed to purchase, so expenses have their own right.
  { id: 'perm-expenses-manage', code: 'expenses.manage', description: 'Record, change and delete expenses (own branch)',
    roles: ['77777777-7777-7777-7777-777777777777', 'role-branch-user', 'role-warehouse-manager'] },
  // The AI Assistant: the Owner's by default; it only ever sees what its user may see.
  { id: 'perm-assistant-use', code: 'assistant.use', description: 'Use the AI Assistant',
    roles: ['77777777-7777-7777-7777-777777777777'] },
];

export async function ensureAccessGrants(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        granted_by TEXT REFERENCES users(id),
        granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, permission_id)
      )`);
    for (const p of ACCESS_PERMISSIONS) {
      const created = await client.query(
        'INSERT INTO permissions (id, code, description) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id',
        [p.id, p.code, p.description]);
      if (!created.rowCount) continue;
      for (const roleId of p.roles) {
        await client.query(`
          INSERT INTO role_permissions (role_id, permission_id) SELECT $1::text, $2::text
          WHERE EXISTS (SELECT 1 FROM roles WHERE id = $1)
            AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2)`, [roleId, p.id]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Access grants migration failed (no data changed):', err);
  } finally {
    client.release();
  }
}

/**
 * Manual manufacturing (free-typed items with a price, reusable item groups)
 * and employees with salary advances.
 */
export async function ensureWorkforceSchema(pool: Pool) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mfg_item_groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS mfg_item_groups_name_uq ON mfg_item_groups (lower(name));
      CREATE TABLE IF NOT EXISTS mfg_item_group_items (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES mfg_item_groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL, price NUMERIC(14,2) NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS mfg_item_group_items_group_idx ON mfg_item_group_items (group_id);
      CREATE TABLE IF NOT EXISTS mfg_jobs (
        id TEXT PRIMARY KEY, job_number TEXT UNIQUE NOT NULL, title TEXT NOT NULL, notes TEXT,
        total NUMERIC(14,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'CANCELLED')),
        created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS mfg_job_items (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES mfg_jobs(id) ON DELETE CASCADE,
        name TEXT NOT NULL, price NUMERIC(14,2) NOT NULL DEFAULT 0, group_name TEXT, sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS mfg_job_items_job_idx ON mfg_job_items (job_id);

      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT, email TEXT, position TEXT,
        branch_id TEXT REFERENCES branches(id), hire_date DATE, national_id TEXT, address TEXT,
        salary NUMERIC(14,2) NOT NULL DEFAULT 0, photo_key TEXT, document_key TEXT, document_name TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')), notes TEXT,
        created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS employees_branch_idx ON employees (branch_id);
      CREATE TABLE IF NOT EXISTS employee_advances (
        id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('ADVANCE', 'REPAYMENT')), amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
        entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
        method TEXT NOT NULL DEFAULT 'CASH' CHECK (method IN ('CASH', 'BANK', 'SALARY_DEDUCTION')),
        notes TEXT, journal_entry_id TEXT, created_by TEXT REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS employee_advances_employee_idx ON employee_advances (employee_id);
    `);
  } catch (err) {
    console.error('❌ Workforce schema migration failed:', err);
  }
}

/**
 * Indexes for the columns that link tables together. Postgres does not index
 * foreign keys by itself, so without these every "lines of this order" or
 * "stock of this product" lookup reads the whole table, which gets slower as
 * the data grows. Additive and idempotent; a table that does not exist in
 * this database is skipped.
 */
const LINK_INDEXES: Array<[string, string]> = [
  ['bill_of_materials', 'product_id'],
  ['bom_items', 'bom_id'],
  ['bom_items', 'material_product_id'],
  ['categories', 'parent_id'],
  ['chart_of_accounts', 'branch_id'],
  ['chart_of_accounts', 'parent_id'],
  ['customer_debts', 'branch_id'],
  ['customer_debts', 'customer_id'],
  ['customer_payments', 'branch_id'],
  ['customer_payments', 'customer_id'],
  ['customer_payments', 'invoice_id'],
  ['customer_payments', 'manual_debt_id'],
  ['deliveries', 'sales_order_id'],
  ['deliveries', 'source_warehouse_id'],
  ['delivery_items', 'delivery_id'],
  ['delivery_items', 'product_id'],
  ['delivery_runs', 'delivery_id'],
  ['depreciation_schedules', 'accum_dep_account_id'],
  ['depreciation_schedules', 'asset_account_id'],
  ['depreciation_schedules', 'dep_expense_account_id'],
  ['depreciation_schedules', 'fiscal_period_id'],
  ['expenses', 'branch_id'],
  ['goods_receipt_lines', 'goods_receipt_id'],
  ['goods_receipt_lines', 'product_id'],
  ['goods_receipt_lines', 'warehouse_location_id'],
  ['goods_receipts', 'destination_branch_id'],
  ['goods_receipts', 'destination_warehouse_id'],
  ['goods_receipts', 'purchase_order_id'],
  ['goods_receipts', 'warehouse_id'],
  ['inventory_period_counts', 'branch_id'],
  ['inventory_period_counts', 'fiscal_period_id'],
  ['inventory_period_counts', 'warehouse_id'],
  ['inventory_stock', 'branch_id'],
  ['inventory_stock', 'location_id'],
  ['inventory_stock', 'product_id'],
  ['inventory_stock', 'warehouse_id'],
  ['inventory_stock', 'warehouse_location_id'],
  ['inventory_transactions', 'dest_branch_id'],
  ['inventory_transactions', 'dest_warehouse_id'],
  ['inventory_transactions', 'destination_branch_id'],
  ['inventory_transactions', 'destination_location_id'],
  ['inventory_transactions', 'destination_warehouse_id'],
  ['inventory_transactions', 'product_id'],
  ['inventory_transactions', 'source_branch_id'],
  ['inventory_transactions', 'source_location_id'],
  ['inventory_transactions', 'source_warehouse_id'],
  ['invoice_lines', 'invoice_id'],
  ['invoice_lines', 'product_id'],
  ['invoice_payments', 'invoice_id'],
  ['invoices', 'sales_order_id'],
  ['journal_entries', 'branch_id'],
  ['journal_entries', 'fiscal_period_id'],
  ['journal_entry_lines', 'account_id'],
  ['journal_entry_lines', 'branch_id'],
  ['journal_entry_lines', 'journal_entry_id'],
  ['lease_agreements', 'property_id'],
  ['lease_agreements', 'tenant_id'],
  ['livestock_expenses', 'livestock_id'],
  ['livestock_transactions', 'livestock_id'],
  ['notifications', 'user_id'],
  ['product_group_items', 'component_product_id'],
  ['products', 'brand_id'],
  ['products', 'category_id'],
  ['property_expenses', 'property_id'],
  ['purchase_invoice_payments', 'purchase_invoice_id'],
  ['purchase_invoices', 'purchase_order_id'],
  ['purchase_order_lines', 'product_id'],
  ['purchase_order_lines', 'purchase_order_id'],
  ['purchase_orders', 'branch_id'],
  ['purchase_orders', 'supplier_id'],
  ['purchase_orders', 'warehouse_id'],
  ['quotations', 'branch_id'],
  ['quotations', 'customer_id'],
  ['refresh_tokens', 'session_id'],
  ['refresh_tokens', 'user_id'],
  ['rental_payments', 'lease_agreement_id'],
  ['role_permissions', 'permission_id'],
  ['role_permissions', 'role_id'],
  ['sales_order_lines', 'product_id'],
  ['sales_order_lines', 'sales_order_id'],
  ['sales_orders', 'branch_id'],
  ['sales_orders', 'customer_id'],
  ['storefront_request_lines', 'product_id'],
  ['storefront_request_lines', 'request_id'],
  ['storefront_requests', 'converted_order_id'],
  ['storefront_reservations', 'product_id'],
  ['storefront_reservations', 'stock_id'],
  ['transfer_lines', 'product_id'],
  ['transfer_lines', 'transfer_id'],
  ['transfers', 'destination_branch_id'],
  ['transfers', 'destination_warehouse_id'],
  ['transfers', 'source_branch_id'],
  ['transfers', 'source_warehouse_id'],
  ['user_roles', 'role_id'],
  ['user_roles', 'user_id'],
  ['users', 'branch_id'],
  ['users', 'warehouse_id'],
  ['warehouse_locations', 'warehouse_id'],
  ['work_order_materials', 'material_product_id'],
  ['work_order_materials', 'work_order_id'],
  ['work_order_stages', 'work_order_id'],
  ['work_orders', 'bom_id'],
  ['work_orders', 'product_id'],
  ['work_orders', 'supervisor_id'],
  ['work_orders', 'warehouse_id'],
];
const EXTRA_INDEXES: Array<[string, string]> = [
  ['sales_orders', 'created_at DESC'],
  ['journal_entries', 'entry_date'],
  ['inventory_transactions', 'created_at DESC'],
  ['notifications', 'user_id, created_at DESC'],
  ['audit_logs', 'created_at DESC'],
  ['storefront_requests', 'created_at'],
];

export async function ensurePerformanceIndexes(pool: Pool) {
  for (const [table, cols] of [...LINK_INDEXES, ...EXTRA_INDEXES]) {
    const name = `idx_${table}_${cols.replace(/ DESC/g, '_desc').replace(/[^a-z0-9_]+/gi, '_')}`.slice(0, 63);
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols})`);
    } catch (err: any) {
      if (err?.code !== '42P01' && err?.code !== '42703') console.warn(`Index ${name} skipped:`, err?.message);
    }
  }
}


/**
 * Better Auth's tables (its own migration) and an identity for every ERP user
 * that has none yet, carrying over the bcrypt password.
 */
export async function ensureBetterAuth(pool: Pool) {
  try {
    await migrateAuthSchema(pool);
    await backfillIdentities(pool);
    // Last time a person used each browser session (for the inactivity sign-out).
    // Removed with the session.
    // Each person's saved list views (named filter sets).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_saved_views (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        list_key TEXT NOT NULL,
        name TEXT NOT NULL,
        query TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_user_saved_views_user ON user_saved_views (user_id, list_key);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS erp_session_activity (
        session_id TEXT PRIMARY KEY REFERENCES "session"(id) ON DELETE CASCADE,
        last_active_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('❌ Better Auth migration failed:', err);
  }
}

/**
 * AI assistant support (idempotent, additive, runs on boot).
 * - agent_usage: one row per assistant message, for the per-user rate limit.
 * - agent_actions: changes the assistant proposed. Nothing runs until the user
 *   confirms it in the staff app; each proposal runs at most once.
 */
export async function ensureAgentSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_agent_usage_user ON agent_usage(user_id, created_at);
    CREATE TABLE IF NOT EXISTS agent_actions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      args TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
      result TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      handled_at TIMESTAMP WITH TIME ZONE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_actions_user ON agent_actions(user_id, created_at);
    -- Chat history: each user's conversations with the assistant (private to them).
    CREATE TABLE IF NOT EXISTS agent_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_agent_conversations_user ON agent_conversations(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      proposal_ids TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id, created_at);
  `);
}

/**
 * Public storefront support (idempotent, additive, runs on boot).
 * - products.is_published / slug / web_description: what the website shows.
 *   Products are unpublished until staff publish them.
 * - product_images: photos in object storage (R2); only the object key is
 *   stored, the public URL is built from R2_PUBLIC_BASE_URL.
 * - storefront_settings: which branch the website sells from, and buffers.
 * - storefront_requests(+_lines): order REQUESTS from the website. They are
 *   not sales orders: nothing is deducted or posted until staff convert one.
 * - storefront_request_log: submissions per IP/phone, for throttling.
 * - storefront_reservations: stock held for open web requests.
 */
export async function ensureStorefrontSchema(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS is_published INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS slug TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS web_description TEXT;
      -- "Was" price shown crossed out on the website. Display only: sales and
      -- requests always use selling_price.
      ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price DOUBLE PRECISION;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured INTEGER NOT NULL DEFAULT 0;
      -- Units still for sale online (NULL = no limit: all stock at the web branch).
      -- Each online order lowers it; a cancelled online order puts it back.
      ALTER TABLE products ADD COLUMN IF NOT EXISTS web_quantity INTEGER;
      -- First time the product was published; drives "New arrivals".
      ALTER TABLE products ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE;
      -- Optional category photo for the website (R2 object key).
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug) WHERE slug IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_products_published ON products(is_published) WHERE is_published = 1;

      CREATE TABLE IF NOT EXISTS product_images (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        object_key TEXT NOT NULL UNIQUE,
        alt TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);

      CREATE TABLE IF NOT EXISTS storefront_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS storefront_requests (
        id TEXT PRIMARY KEY,
        request_number TEXT UNIQUE NOT NULL,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        address TEXT,
        city TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'NEW',
        total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        converted_order_id TEXT REFERENCES sales_orders(id),
        handled_by TEXT REFERENCES users(id),
        handled_at TIMESTAMP WITH TIME ZONE,
        ip TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_storefront_requests_status ON storefront_requests(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS storefront_request_lines (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES storefront_requests(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DOUBLE PRECISION NOT NULL
      );
      -- Why a request was cancelled automatically (e.g. not confirmed in time).
      ALTER TABLE storefront_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
      -- 1 while the line holds units from the product's online quantity (given back on cancel).
      ALTER TABLE storefront_request_lines ADD COLUMN IF NOT EXISTS web_quantity_taken INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS storefront_request_log (
        id TEXT PRIMARY KEY,
        ip TEXT,
        phone TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_storefront_request_log_ip ON storefront_request_log(ip, created_at);
      -- Units held for a web request (inventory_stock.quantity_reserved), so two
      -- requests cannot promise the same last pieces. Released when the request
      -- is cancelled, or when its sales order issues the stock or is cancelled.
      CREATE TABLE IF NOT EXISTS storefront_reservations (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES storefront_requests(id) ON DELETE CASCADE,
        stock_id TEXT NOT NULL REFERENCES inventory_stock(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        released_at TIMESTAMP WITH TIME ZONE,
        release_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_storefront_reservations_open ON storefront_reservations(request_id) WHERE released_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_storefront_request_log_phone ON storefront_request_log(phone, created_at);
      -- Order-tracking lookups per IP, for throttling.
      CREATE TABLE IF NOT EXISTS storefront_track_log (
        id TEXT PRIMARY KEY,
        ip TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_storefront_track_log_ip ON storefront_track_log(ip, created_at);
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Storefront schema migration failed (no data changed):', err);
  } finally {
    client.release();
  }
}

/**
 * Server-side sessions for authentication (idempotent, runs on boot).
 * - auth_sessions: one row per login (browser tab family or device). Every
 *   access token carries its session id, and every request checks the session
 *   is still live, so logout / password change / reuse detection take effect
 *   immediately on every backend instance.
 * - refresh_tokens: one row per issued refresh token (opaque, stored as a
 *   SHA-256 hash). A token is single-use: rotation marks it used and issues a
 *   successor in the same session. Pre-existing rows (no session) are inert.
 * - auth_login_failures: failed sign-ins, for throttling across instances.
 */
export async function ensureAuthSchema(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_type TEXT NOT NULL DEFAULT 'browser',
        user_agent TEXT,
        ip TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        revoked_at TIMESTAMP WITH TIME ZONE,
        revoked_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
      ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_id TEXT REFERENCES auth_sessions(id) ON DELETE CASCADE;
      ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMP WITH TIME ZONE;
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
      CREATE TABLE IF NOT EXISTS auth_login_failures (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        ip TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_auth_login_failures_email ON auth_login_failures(email, created_at);
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Auth schema migration failed (no data changed):', err);
  } finally {
    client.release();
  }
}

/**
 * The general ledger is a VIEW over posted journal lines, not a second copy of
 * them. The old physical table duplicated every line plus a stored running
 * balance that drifted (company-wide in branch views, read-then-write races,
 * hand-written depreciation rows). On first boot after this change the old
 * table is renamed to general_ledger_legacy — kept, never dropped, for audit
 * comparison — and the view takes its name. Idempotent; own transaction.
 */
export async function ensureLedgerView(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = current_schema() AND table_name = 'general_ledger' AND table_type = 'BASE TABLE') THEN
          IF EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = current_schema() AND table_name = 'general_ledger_legacy') THEN
            RAISE EXCEPTION 'general_ledger and general_ledger_legacy both exist as tables; resolve manually';
          END IF;
          ALTER TABLE general_ledger RENAME TO general_ledger_legacy;
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE OR REPLACE VIEW general_ledger AS
      SELECT jel.id, jel.account_id, jel.journal_entry_id, jel.id AS line_id, je.entry_date,
             COALESCE(jel.description, je.description) AS description,
             jel.debit_amount, jel.credit_amount, jel.branch_id, je.created_at, jel.line_order, je.status
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE je.status IN ('POSTED', 'REVERSED')
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ General ledger view migration failed (no data changed):', err);
  } finally {
    client.release();
  }
}

/**
 * Branch attribution of financial records (idempotent, runs on boot).
 * 1. A trigger keeps every journal line in the same branch as its entry, so
 *    branch reports can never pick up part of another branch's entry.
 * 2. Historical rows with no branch are backfilled ONLY when the source
 *    document proves the branch (sale order, invoice, payment, debt, expense,
 *    stock movement, or the entry a reversal reverses). Purchasing,
 *    manufacturing, depreciation and closing are company-level by policy and
 *    stay NULL ("unassigned"). Anything else stays NULL for review
 *    (docs/audit/reconciliation_queries.sql, R17–R19).
 * Runs in its own transaction; a failure is logged and leaves data unchanged.
 */
export async function ensureBranchAttribution(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE OR REPLACE FUNCTION enforce_journal_line_branch() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.branch_id IS DISTINCT FROM (SELECT branch_id FROM journal_entries WHERE id = NEW.journal_entry_id) THEN
          RAISE EXCEPTION 'Journal line branch (%) must match its journal entry''s branch', COALESCE(NEW.branch_id, 'none');
        END IF;
        RETURN NEW;
      END
      $fn$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_journal_line_branch ON journal_entry_lines;
      CREATE TRIGGER trg_journal_line_branch BEFORE INSERT OR UPDATE OF branch_id, journal_entry_id ON journal_entry_lines
        FOR EACH ROW EXECUTE FUNCTION enforce_journal_line_branch();
    `);

    // Customer payments: branch of the invoice's order or of the charge paid.
    await client.query(`
      UPDATE customer_payments cp SET branch_id = src.branch_id
      FROM (
        SELECT cp2.id, COALESCE(so.branch_id, cd.branch_id) AS branch_id
        FROM customer_payments cp2
        LEFT JOIN invoices i ON i.id = cp2.invoice_id
        LEFT JOIN sales_orders so ON so.id = i.sales_order_id
        LEFT JOIN customer_debts cd ON cd.id = cp2.manual_debt_id
        WHERE cp2.branch_id IS NULL
      ) src
      WHERE cp.id = src.id AND src.branch_id IS NOT NULL
    `);

    // Journal entries with no branch anywhere, provable from their source document.
    const backfilled = await client.query(`
      WITH cand AS (
        SELECT je.id, COALESCE(
          (SELECT so.branch_id FROM sales_orders so
             WHERE je.reference_type = 'SALE'
               AND je.reference_id IN (so.id, so.id || '-pay', so.id || '-install-pay') LIMIT 1),
          (SELECT so.branch_id FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id
             WHERE je.reference_type = 'SALE' AND je.reference_id = i.id),
          (SELECT so.branch_id FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id JOIN sales_orders so ON so.id = i.sales_order_id
             WHERE je.reference_type = 'SALE' AND je.reference_id = ip.id),
          (SELECT cp.branch_id FROM customer_payments cp
             WHERE je.reference_type = 'SALE' AND je.reference_id = cp.id),
          (SELECT cd.branch_id FROM customer_debts cd
             WHERE je.reference_type = 'SALE' AND je.reference_id = cd.id),
          (SELECT e.branch_id FROM expenses e
             WHERE je.reference_type = 'EXPENSE' AND je.reference_id = e.id),
          (SELECT COALESCE(it.destination_branch_id, it.source_branch_id) FROM inventory_transactions it
             WHERE je.reference_type = 'INVENTORY_ADJUSTMENT' AND je.reference_id = it.id)
        ) AS branch_id
        FROM journal_entries je
        WHERE je.branch_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = je.id AND l.branch_id IS NOT NULL)
      )
      UPDATE journal_entries je SET branch_id = cand.branch_id
      FROM cand WHERE cand.id = je.id AND cand.branch_id IS NOT NULL
    `);
    // Reversals follow the entry they reverse
    await client.query(`
      UPDATE journal_entries r SET branch_id = o.branch_id
      FROM journal_entries o
      WHERE r.reference_type = 'MANUAL' AND r.reference_id = o.id
        AND r.branch_id IS NULL AND o.branch_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = r.id AND l.branch_id IS NOT NULL)
    `);
    // Unbranched lines take their entry's branch
    await client.query(`
      UPDATE journal_entry_lines l SET branch_id = je.branch_id
      FROM journal_entries je
      WHERE l.journal_entry_id = je.id AND l.branch_id IS NULL AND je.branch_id IS NOT NULL
    `);
    await client.query('COMMIT');
    if (backfilled.rowCount) console.log(`✅ Branch attribution backfilled for ${backfilled.rowCount} journal entries`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Branch attribution migration failed (no data changed):', err);
  } finally {
    client.release();
  }
}

/**
 * Role Separation & Least Privilege:
 * - Sales and branch roles should NOT have purchasing permissions.
 * - Deduplicate role_permissions and enforce unique index.
 * - Ensure branch managers do not have accidental accountant role.
 */
export async function ensureRoleSeparation(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Duplicates and the unique index are safe to check on every start.
    await client.query(`
      DELETE FROM role_permissions a USING role_permissions b
      WHERE a.ctid < b.ctid AND a.role_id = b.role_id AND a.permission_id = b.permission_id
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permissions ON role_permissions (role_id, permission_id)
    `);
    // Removing rights runs ONCE: afterwards the Owner's own choices in Roles stay as they are.
    await client.query('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, ran_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const done = await client.query("SELECT 1 FROM app_migrations WHERE name = 'role_separation_v1'");
    if (!done.rowCount) {
      await client.query(`
        DELETE FROM role_permissions
        WHERE role_id IN ('role-branch-user', 'role-sales-rep')
          AND permission_id = '44444444-4444-4444-4444-444444444444'
      `);
      await client.query(`
        DELETE FROM user_roles
        WHERE user_id IN ('user-hq-branch-01', 'user-cl-branch-02')
          AND role_id = 'role-accountant'
      `);
      await client.query("INSERT INTO app_migrations (name) VALUES ('role_separation_v1')");
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Role separation migration failed:', err);
  } finally {
    client.release();
  }
}
