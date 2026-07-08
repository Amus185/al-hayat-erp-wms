-- =========================================================
-- Al Hayat ERP+WMS — FULL DATABASE RESET
-- Run this in Supabase SQL Editor to drop everything and recreate
-- WARNING: This will DELETE ALL existing data!
-- =========================================================

-- ── Drop all tables in reverse dependency order ─────
DROP TABLE IF EXISTS stock_count_lines CASCADE;
DROP TABLE IF EXISTS stock_counts CASCADE;
DROP TABLE IF EXISTS invoice_lines CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS sales_order_lines CASCADE;
DROP TABLE IF EXISTS sales_orders CASCADE;
DROP TABLE IF EXISTS quotations CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS transfer_lines CASCADE;
DROP TABLE IF EXISTS transfers CASCADE;
DROP TABLE IF EXISTS supplier_payments CASCADE;
DROP TABLE IF EXISTS goods_receipt_lines CASCADE;
DROP TABLE IF EXISTS goods_receipts CASCADE;
DROP TABLE IF EXISTS purchase_order_lines CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS inventory_transactions CASCADE;
DROP TABLE IF EXISTS inventory_stock CASCADE;
DROP TABLE IF EXISTS warehouse_locations CASCADE;
DROP TABLE IF EXISTS product_images CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS product_variants CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS brands CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS password_resets CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS warehouses CASCADE;
DROP TABLE IF EXISTS branches CASCADE;

-- ── Drop custom types ───────────────────────────────
DROP TYPE IF EXISTS transfer_status CASCADE;
DROP TYPE IF EXISTS purchase_status CASCADE;
DROP TYPE IF EXISTS sales_status CASCADE;
DROP TYPE IF EXISTS inventory_transaction_type CASCADE;
DROP TYPE IF EXISTS location_owner_type CASCADE;

-- =========================================================
-- SCHEMA
-- =========================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE transfer_status AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','DISPATCHED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED');
CREATE TYPE purchase_status AS ENUM ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED');
CREATE TYPE sales_status AS ENUM ('DRAFT','CONFIRMED','INVOICED','PAID','CANCELLED');
CREATE TYPE inventory_transaction_type AS ENUM ('PURCHASE_RECEIPT','SALE_ISSUE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT_POSITIVE','ADJUSTMENT_NEGATIVE','STOCK_COUNT_VARIANCE','RETURN_IN','DAMAGE_WRITE_OFF');
CREATE TYPE location_owner_type AS ENUM ('WAREHOUSE','BRANCH');

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(20) UNIQUE,
  name varchar(160) NOT NULL,
  city varchar(120) NOT NULL,
  address text,
  phone varchar(80),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(20) UNIQUE,
  name varchar(160) NOT NULL,
  city varchar(120) NOT NULL,
  address text,
  phone varchar(80),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(80) UNIQUE NOT NULL,
  description text NOT NULL
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(60) UNIQUE,
  name varchar(120) UNIQUE NOT NULL,
  description text
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email varchar(180) UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name varchar(160) NOT NULL,
  phone varchar(80),
  branch_id uuid REFERENCES branches(id),
  warehouse_id uuid REFERENCES warehouses(id),
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id uuid REFERENCES categories(id),
  name varchar(140) UNIQUE NOT NULL,
  slug varchar(160) UNIQUE
);

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(140) UNIQUE NOT NULL
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku varchar(80) UNIQUE NOT NULL,
  barcode varchar(100) UNIQUE NOT NULL,
  name varchar(220) NOT NULL,
  description text,
  category_id uuid REFERENCES categories(id),
  brand_id uuid REFERENCES brands(id),
  cost_price numeric(14,2) NOT NULL CHECK (cost_price >= 0),
  selling_price numeric(14,2) NOT NULL CHECK (selling_price >= 0),
  reorder_level integer NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bucket varchar(120) NOT NULL,
  object_key text NOT NULL,
  original_name varchar(240) NOT NULL,
  mime_type varchar(120) NOT NULL,
  size_bytes bigint NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id),
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false
);

CREATE TABLE warehouse_locations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  aisle varchar(40) NOT NULL,
  rack varchar(40) NOT NULL,
  shelf varchar(40) NOT NULL,
  bin varchar(40) NOT NULL,
  barcode varchar(90) UNIQUE NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (warehouse_id, aisle, rack, shelf, bin)
);

CREATE TABLE inventory_stock (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES products(id),
  owner_type location_owner_type NOT NULL,
  warehouse_id uuid REFERENCES warehouses(id),
  branch_id uuid REFERENCES branches(id),
  warehouse_location_id uuid REFERENCES warehouse_locations(id),
  quantity_on_hand integer NOT NULL DEFAULT 0,
  quantity_reserved integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_type = 'WAREHOUSE' AND warehouse_id IS NOT NULL) OR (owner_type = 'BRANCH' AND branch_id IS NOT NULL)),
  UNIQUE (product_id, owner_type, warehouse_id, branch_id, warehouse_location_id)
);

CREATE TABLE inventory_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES products(id),
  transaction_type inventory_transaction_type NOT NULL,
  quantity integer NOT NULL,
  source_owner_type location_owner_type,
  source_warehouse_id uuid REFERENCES warehouses(id),
  source_branch_id uuid REFERENCES branches(id),
  source_location_id uuid REFERENCES warehouse_locations(id),
  destination_owner_type location_owner_type,
  destination_warehouse_id uuid REFERENCES warehouses(id),
  destination_branch_id uuid REFERENCES branches(id),
  destination_location_id uuid REFERENCES warehouse_locations(id),
  reference_type varchar(80),
  reference_id uuid,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_counts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(40) UNIQUE NOT NULL,
  warehouse_id uuid REFERENCES warehouses(id),
  branch_id uuid REFERENCES branches(id),
  status varchar(30) NOT NULL DEFAULT 'OPEN',
  created_by uuid REFERENCES users(id),
  submitted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

CREATE TABLE stock_count_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  expected_quantity integer NOT NULL,
  counted_quantity integer NOT NULL,
  variance integer GENERATED ALWAYS AS (counted_quantity - expected_quantity) STORED
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(180) NOT NULL,
  contact_name varchar(180),
  phone varchar(80),
  email varchar(180),
  address text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number varchar(40) UNIQUE NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  status purchase_status NOT NULL DEFAULT 'DRAFT',
  expected_date date,
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_number varchar(40) UNIQUE NOT NULL,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  received_by uuid REFERENCES users(id),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  goods_receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  warehouse_location_id uuid REFERENCES warehouse_locations(id),
  quantity_received integer NOT NULL CHECK (quantity_received > 0)
);

CREATE TABLE supplier_payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  purchase_order_id uuid REFERENCES purchase_orders(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  reference varchar(120)
);

CREATE TABLE transfers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_number varchar(40) UNIQUE NOT NULL,
  status transfer_status NOT NULL DEFAULT 'DRAFT',
  source_owner_type location_owner_type NOT NULL,
  source_warehouse_id uuid REFERENCES warehouses(id),
  source_branch_id uuid REFERENCES branches(id),
  destination_owner_type location_owner_type NOT NULL,
  destination_warehouse_id uuid REFERENCES warehouses(id),
  destination_branch_id uuid REFERENCES branches(id),
  requested_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  dispatched_by uuid REFERENCES users(id),
  received_by uuid REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz
);

CREATE TABLE transfer_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id uuid NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity_requested integer NOT NULL CHECK (quantity_requested > 0),
  quantity_dispatched integer NOT NULL DEFAULT 0,
  quantity_received integer NOT NULL DEFAULT 0
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(180) NOT NULL,
  phone varchar(80),
  email varchar(180),
  address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quotations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_number varchar(40) UNIQUE NOT NULL,
  customer_id uuid REFERENCES customers(id),
  branch_id uuid REFERENCES branches(id),
  status varchar(30) NOT NULL DEFAULT 'DRAFT',
  valid_until date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number varchar(40) UNIQUE NOT NULL,
  quotation_id uuid REFERENCES quotations(id),
  customer_id uuid REFERENCES customers(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  status sales_status NOT NULL DEFAULT 'DRAFT',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_order_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number varchar(40) UNIQUE NOT NULL,
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id),
  status sales_status NOT NULL DEFAULT 'INVOICED',
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id),
  title varchar(180) NOT NULL,
  body text NOT NULL,
  event_type varchar(80) NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_resets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id uuid REFERENCES users(id),
  action varchar(120) NOT NULL,
  entity_type varchar(120) NOT NULL,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_stock_product ON inventory_stock(product_id);
CREATE INDEX idx_inventory_stock_owner ON inventory_stock(owner_type, warehouse_id, branch_id);
CREATE INDEX idx_inventory_transactions_product_created ON inventory_transactions(product_id, created_at DESC);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_search ON products USING gin (to_tsvector('english', name || ' ' || sku));
CREATE INDEX idx_transfers_status ON transfers(status);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_password_resets_token ON password_resets(token_hash);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;

-- =========================================================
-- SEED DATA (clean — no mockup data)
-- =========================================================

-- ── Permissions ─────────────────────────────────────
INSERT INTO permissions (code, description) VALUES
  ('users.manage',        'Create and manage user accounts'),
  ('products.read',       'View products and catalog'),
  ('products.write',      'Create and edit products'),
  ('inventory.read',      'View inventory and stock levels'),
  ('inventory.adjust',    'Adjust stock and run counts'),
  ('transfers.create',    'Create transfer requests'),
  ('transfers.approve',   'Approve or reject transfers'),
  ('transfers.dispatch',  'Dispatch approved transfers'),
  ('transfers.receive',   'Receive incoming transfers'),
  ('purchasing.write',    'Create purchase orders'),
  ('purchasing.approve',  'Approve purchase orders'),
  ('sales.write',         'Create sales orders and invoices'),
  ('reports.read',        'View management reports'),
  ('audit.read',          'View audit logs'),
  ('branches.manage',     'Manage branch configuration'),
  ('warehouses.manage',   'Manage warehouse configuration'),
  ('products.manage',     'Manage categories and brands')
ON CONFLICT (code) DO NOTHING;

-- ── Roles ───────────────────────────────────────────
INSERT INTO roles (code, name, description) VALUES
  ('ADMIN', 'Admin', 'Full system access — all modules and settings'),
  ('STAFF', 'Staff', 'Daily operations — products, inventory, and sales only')
ON CONFLICT (name) DO NOTHING;

-- ── Admin gets ALL permissions ──────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- ── Staff permissions (limited) ─────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'products.read',
  'inventory.read',
  'sales.write'
) WHERE r.code = 'STAFF'
ON CONFLICT DO NOTHING;

-- ── Default Admin User (password: Admin@123456) ─────
-- Using pgcrypto crypt() to generate a bcrypt hash directly in Postgres
INSERT INTO users (email, password_hash, full_name, phone, is_active) VALUES
  ('admin@alhayat.com', crypt('Admin@123456', gen_salt('bf', 10)), 'System Administrator', NULL, true)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- ── Assign admin role ───────────────────────────────
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON
  (u.email = 'admin@alhayat.com' AND r.code = 'ADMIN')
ON CONFLICT DO NOTHING;
