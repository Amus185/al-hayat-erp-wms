-- ── Al Hayat ERP + WMS — PostgreSQL Master Schema ──

DROP TABLE IF EXISTS purchase_invoice_payments CASCADE;
DROP TABLE IF EXISTS purchase_invoices CASCADE;
DROP TABLE IF EXISTS invoice_payments CASCADE;
DROP TABLE IF EXISTS invoice_lines CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS sales_order_lines CASCADE;
DROP TABLE IF EXISTS sales_orders CASCADE;
DROP TABLE IF EXISTS quotations CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS transfer_lines CASCADE;
DROP TABLE IF EXISTS transfers CASCADE;
DROP TABLE IF EXISTS goods_receipt_lines CASCADE;
DROP TABLE IF EXISTS goods_receipts CASCADE;
DROP TABLE IF EXISTS purchase_order_lines CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS inventory_transactions CASCADE;
DROP TABLE IF EXISTS inventory_stock CASCADE;
DROP TABLE IF EXISTS warehouse_locations CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS brands CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS warehouses CASCADE;
DROP TABLE IF EXISTS branches CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS journal_entry_lines CASCADE;
DROP TABLE IF EXISTS journal_entries CASCADE;
DROP TABLE IF EXISTS fiscal_periods CASCADE;
DROP TABLE IF EXISTS chart_of_accounts CASCADE;

CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE warehouses (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  branch_id TEXT REFERENCES branches(id),
  warehouse_id TEXT REFERENCES warehouses(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  password_version INTEGER NOT NULL DEFAULT 1,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES categories(id),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE
);

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category_id TEXT REFERENCES categories(id),
  brand_id TEXT REFERENCES brands(id),
  cost_price DOUBLE PRECISION NOT NULL CHECK (cost_price >= 0),
  selling_price DOUBLE PRECISION NOT NULL CHECK (selling_price >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 5,
  is_active INTEGER NOT NULL DEFAULT 1,
  barcode TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE warehouse_locations (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  aisle TEXT NOT NULL,
  rack TEXT NOT NULL,
  shelf TEXT NOT NULL,
  bin TEXT NOT NULL,
  barcode TEXT UNIQUE NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (warehouse_id, aisle, rack, shelf, bin)
);

CREATE TABLE inventory_stock (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  owner_type TEXT NOT NULL,
  warehouse_id TEXT REFERENCES warehouses(id),
  branch_id TEXT REFERENCES branches(id),
  warehouse_location_id TEXT REFERENCES warehouse_locations(id),
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  quantity_reserved INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_transactions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  transaction_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  source_owner_type TEXT,
  source_warehouse_id TEXT REFERENCES warehouses(id),
  source_branch_id TEXT REFERENCES branches(id),
  source_location_id TEXT REFERENCES warehouse_locations(id),
  destination_owner_type TEXT,
  destination_warehouse_id TEXT REFERENCES warehouses(id),
  destination_branch_id TEXT REFERENCES branches(id),
  destination_location_id TEXT REFERENCES warehouse_locations(id),
  reference_type TEXT,
  reference_id TEXT,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT UNIQUE NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  warehouse_id TEXT REFERENCES warehouses(id),
  expected_date TEXT,
  created_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_order_lines (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost DOUBLE PRECISION NOT NULL CHECK (unit_cost >= 0),
  discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  line_total DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE goods_receipts (
  id TEXT PRIMARY KEY,
  receipt_number TEXT UNIQUE NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  received_by TEXT REFERENCES users(id),
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE goods_receipt_lines (
  id TEXT PRIMARY KEY,
  goods_receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  warehouse_location_id TEXT REFERENCES warehouse_locations(id),
  quantity_received INTEGER NOT NULL CHECK (quantity_received > 0)
);

CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  transfer_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  source_owner_type TEXT NOT NULL,
  source_warehouse_id TEXT REFERENCES warehouses(id),
  source_branch_id TEXT REFERENCES branches(id),
  destination_owner_type TEXT NOT NULL,
  destination_warehouse_id TEXT REFERENCES warehouses(id),
  destination_branch_id TEXT REFERENCES branches(id),
  requested_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  dispatched_by TEXT REFERENCES users(id),
  received_by TEXT REFERENCES users(id),
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP WITH TIME ZONE,
  dispatched_at TIMESTAMP WITH TIME ZONE,
  received_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  quantity_dispatched INTEGER NOT NULL DEFAULT 0,
  quantity_received INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  quotation_number TEXT UNIQUE NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  branch_id TEXT REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  valid_until TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  quotation_id TEXT REFERENCES quotations(id),
  customer_id TEXT REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales_order_lines (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DOUBLE PRECISION NOT NULL CHECK (unit_price >= 0),
  discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  line_total DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  status TEXT NOT NULL DEFAULT 'INVOICED',
  total_amount DOUBLE PRECISION NOT NULL CHECK (total_amount >= 0),
  discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DOUBLE PRECISION NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE invoice_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'CASH',
  payment_date TEXT NOT NULL,
  notes TEXT,
  recorded_by TEXT REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  notes TEXT,
  issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_invoice_payments (
  id TEXT PRIMARY KEY,
  purchase_invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'CASH',
  payment_date TEXT NOT NULL,
  notes TEXT,
  recorded_by TEXT REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  event_type TEXT NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  object_key TEXT UNIQUE NOT NULL,
  uploaded_by TEXT REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_inventory_stock_owner ON inventory_stock(owner_type, warehouse_id, branch_id);
CREATE INDEX idx_inventory_transactions_product_created ON inventory_transactions(product_id, created_at DESC);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_transfers_status ON transfers(status);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX idx_pip_purchase_invoice ON purchase_invoice_payments(purchase_invoice_id);

-- ── SEED DATA ──────────────────────────────────────────────────────
INSERT INTO permissions (id, code, description) VALUES 
('11111111-1111-1111-1111-111111111111', 'manage_users', 'Can manage users and roles'),
('22222222-2222-2222-2222-222222222222', 'manage_inventory', 'Can adjust stock and perform counts'),
('33333333-3333-3333-3333-333333333333', 'manage_transfers', 'Can create and approve transfers'),
('44444444-4444-4444-4444-444444444444', 'manage_purchasing', 'Can create POs and receive goods'),
('55555555-5555-5555-5555-555555555555', 'manage_sales', 'Can create sales orders and invoices'),
('66666666-6666-6666-6666-666666666666', 'view_reports', 'Can view analytical reports')
ON CONFLICT (id) DO NOTHING;

INSERT INTO roles (id, code, name, description) VALUES 
('77777777-7777-7777-7777-777777777777', 'admin', 'System Administrator', 'Full access to all modules'),
('role-branch-user', 'branch_user', 'Branch User', 'Auto-provisioned user scoped to a single branch')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES 
('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111'),
('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222'),
('77777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333'),
('77777777-7777-7777-7777-777777777777', '44444444-4444-4444-4444-444444444444'),
('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555'),
('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666'),
('role-branch-user', '22222222-2222-2222-2222-222222222222'),
('role-branch-user', '33333333-3333-3333-3333-333333333333'),
('role-branch-user', '44444444-4444-4444-4444-444444444444'),
('role-branch-user', '55555555-5555-5555-5555-555555555555'),
('role-branch-user', '66666666-6666-6666-6666-666666666666')
ON CONFLICT DO NOTHING;

-- Default Admin User: admin@alhayat.com / Admin@123
INSERT INTO users (id, email, password_hash, full_name, is_active, password_version) VALUES 
('88888888-8888-8888-8888-888888888888', 'admin@alhayat.com', '$2b$12$Z0/GkC.2rEOMiM92tF1x7eLIsO2x/Q0f53YQj1t42n1L.o/H3gQoG', 'Admin User', 1, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id) VALUES 
('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777')
ON CONFLICT DO NOTHING;
