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
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, branch_id TEXT REFERENCES branches(id), is_active INTEGER NOT NULL DEFAULT 1, password_version INTEGER NOT NULL DEFAULT 1, last_login_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
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
        id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_cost DOUBLE PRECISION NOT NULL, line_total DOUBLE PRECISION NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS goods_receipts (
        id TEXT PRIMARY KEY, receipt_number TEXT UNIQUE NOT NULL, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id), destination_owner_type TEXT NOT NULL CHECK (destination_owner_type IN ('WAREHOUSE', 'BRANCH')), destination_warehouse_id TEXT REFERENCES warehouses(id), destination_branch_id TEXT REFERENCES branches(id), status TEXT NOT NULL DEFAULT 'DRAFT', received_by TEXT REFERENCES users(id), received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS goods_receipt_lines (
        id TEXT PRIMARY KEY, goods_receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), quantity_received INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id TEXT PRIMARY KEY, invoice_number TEXT UNIQUE NOT NULL, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id), total_amount DOUBLE PRECISION NOT NULL, discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'UNPAID', issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP WITH TIME ZONE
      );
      CREATE TABLE IF NOT EXISTS purchase_invoice_payments (
        id TEXT PRIMARY KEY, purchase_invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id), amount DOUBLE PRECISION NOT NULL, payment_method TEXT NOT NULL DEFAULT 'CASH', payment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, notes TEXT, recorded_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY, transfer_number TEXT UNIQUE NOT NULL, source_owner_type TEXT NOT NULL CHECK (source_owner_type IN ('WAREHOUSE', 'BRANCH')), source_warehouse_id TEXT REFERENCES warehouses(id), source_branch_id TEXT REFERENCES branches(id), dest_owner_type TEXT NOT NULL CHECK (dest_owner_type IN ('WAREHOUSE', 'BRANCH')), dest_warehouse_id TEXT REFERENCES warehouses(id), dest_branch_id TEXT REFERENCES branches(id), status TEXT NOT NULL DEFAULT 'DRAFT', notes TEXT, created_by TEXT REFERENCES users(id), approved_by TEXT REFERENCES users(id), approved_at TIMESTAMP WITH TIME ZONE, dispatched_by TEXT REFERENCES users(id), dispatched_at TIMESTAMP WITH TIME ZONE, received_by TEXT REFERENCES users(id), received_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS transfer_lines (
        id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fiscal_periods (
        id TEXT PRIMARY KEY, period_name TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
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
        id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, old_value TEXT, new_value TEXT, actor_user_id TEXT REFERENCES users(id), ip_address TEXT, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_size INTEGER NOT NULL, mime_type TEXT NOT NULL, object_key TEXT UNIQUE NOT NULL, uploaded_by TEXT REFERENCES users(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Populate auth & reference data from D1 Backup
    for (const row of D1_AUTH_BACKUP.branches) {
      await client.query(
        `INSERT INTO branches (id, code, name, city, address, phone, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.code, row.name, row.city, row.address, row.phone, row.is_active]
      );
    }
    for (const row of D1_AUTH_BACKUP.warehouses) {
      await client.query(
        `INSERT INTO warehouses (id, code, name, city, address, phone, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.code, row.name, row.city, row.address, row.phone, row.is_active]
      );
    }
    for (const row of D1_AUTH_BACKUP.permissions) {
      await client.query(
        `INSERT INTO permissions (id, code, description) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.code, row.description]
      );
    }
    for (const row of D1_AUTH_BACKUP.roles) {
      await client.query(
        `INSERT INTO roles (id, code, name, description) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.code, row.name, row.description]
      );
    }
    for (const row of D1_AUTH_BACKUP.role_permissions) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [row.role_id, row.permission_id]
      );
    }
    for (const row of D1_AUTH_BACKUP.users) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, branch_id, is_active, password_version) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_version = EXCLUDED.password_version`,
        [row.id, row.email, row.password_hash, row.full_name, row.branch_id, row.is_active, row.password_version]
      );
      await client.query(`UPDATE users SET password_hash = $1 WHERE email = $2`, [row.password_hash, row.email]);
    }
    for (const row of D1_AUTH_BACKUP.user_roles) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [row.user_id, row.role_id]
      );
    }
    for (const row of D1_AUTH_BACKUP.fiscal_periods) {
      await client.query(
        `INSERT INTO fiscal_periods (id, period_name, start_date, end_date, status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.period_name, row.start_date, row.end_date, row.status]
      );
    }

    console.log('✅ PostgreSQL Master Schema & Auth Data Migration Verified on Startup!');
  } catch (err) {
    console.error('❌ Error initializing PostgreSQL master schema:', err);
  } finally {
    client.release();
  }
}
