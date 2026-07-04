-- =========================================================
-- Al Hayat ERP+WMS — FULL DATABASE RESET
-- Run this in Supabase SQL Editor to drop everything and recreate
-- ⚠️ WARNING: This will DELETE ALL existing data!
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
-- SCHEMA (from schema.sql)
-- =========================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku varchar(90) UNIQUE NOT NULL,
  barcode varchar(90) UNIQUE NOT NULL,
  color varchar(80),
  material varchar(80),
  dimensions varchar(120),
  cost_price numeric(14,2),
  selling_price numeric(14,2),
  is_active boolean NOT NULL DEFAULT true
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
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  owner_type location_owner_type NOT NULL,
  warehouse_id uuid REFERENCES warehouses(id),
  branch_id uuid REFERENCES branches(id),
  warehouse_location_id uuid REFERENCES warehouse_locations(id),
  quantity_on_hand integer NOT NULL DEFAULT 0,
  quantity_reserved integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_type = 'WAREHOUSE' AND warehouse_id IS NOT NULL) OR (owner_type = 'BRANCH' AND branch_id IS NOT NULL)),
  UNIQUE (variant_id, owner_type, warehouse_id, branch_id, warehouse_location_id)
);

CREATE TABLE inventory_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
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
  variant_id uuid NOT NULL REFERENCES product_variants(id),
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
  variant_id uuid NOT NULL REFERENCES product_variants(id),
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
  variant_id uuid NOT NULL REFERENCES product_variants(id),
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
  variant_id uuid NOT NULL REFERENCES product_variants(id),
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
  variant_id uuid NOT NULL REFERENCES product_variants(id),
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
  variant_id uuid NOT NULL REFERENCES product_variants(id),
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

CREATE INDEX idx_inventory_stock_variant ON inventory_stock(variant_id);
CREATE INDEX idx_inventory_stock_owner ON inventory_stock(owner_type, warehouse_id, branch_id);
CREATE INDEX idx_inventory_transactions_variant_created ON inventory_transactions(variant_id, created_at DESC);
CREATE INDEX idx_product_variants_barcode ON product_variants(barcode);
CREATE INDEX idx_products_search ON products USING gin (to_tsvector('english', name || ' ' || sku));
CREATE INDEX idx_transfers_status ON transfers(status);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_password_resets_token ON password_resets(token_hash);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;


-- =========================================================
-- SEED DATA (from seed.sql)
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
  ('branches.manage',     'Manage branch configuration')
ON CONFLICT (code) DO NOTHING;

-- ── Roles (code + name + description) ──────────────
INSERT INTO roles (code, name, description) VALUES
  ('SUPER_ADMIN',       'Super Admin',          'Full system access'),
  ('WAREHOUSE_MANAGER', 'Warehouse Manager',    'Warehouse operations lead'),
  ('BRANCH_MANAGER',    'Branch Manager',       'Branch operations lead'),
  ('SALES_STAFF',       'Sales Staff',          'Front-line sales'),
  ('INVENTORY_STAFF',   'Inventory Staff',      'Warehouse floor staff')
ON CONFLICT (name) DO NOTHING;

-- ── Super Admin gets ALL permissions ────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- ── Warehouse Manager permissions ───────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'products.read','products.write','inventory.read','inventory.adjust',
  'transfers.create','transfers.approve','transfers.dispatch','transfers.receive',
  'purchasing.write','purchasing.approve','reports.read','audit.read'
) WHERE r.code = 'WAREHOUSE_MANAGER'
ON CONFLICT DO NOTHING;

-- ── Branch Manager permissions ──────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'products.read','inventory.read','inventory.adjust',
  'transfers.create','transfers.receive',
  'sales.write','reports.read','branches.manage'
) WHERE r.code = 'BRANCH_MANAGER'
ON CONFLICT DO NOTHING;

-- ── Sales Staff permissions ─────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'products.read','inventory.read','sales.write'
) WHERE r.code = 'SALES_STAFF'
ON CONFLICT DO NOTHING;

-- ── Inventory Staff permissions ─────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'products.read','inventory.read','inventory.adjust',
  'transfers.create','transfers.dispatch','transfers.receive'
) WHERE r.code = 'INVENTORY_STAFF'
ON CONFLICT DO NOTHING;

-- ── Users (password: Admin@123456) ──────────────────
-- bcrypt hash of "Admin@123456" with 10 rounds
INSERT INTO users (email, password_hash, full_name, phone, is_active) VALUES
  ('admin@alhayat.sa',     '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'System Administrator',  '+966-11-100-0001', true),
  ('warehouse@alhayat.sa', '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'Ahmed Al Rashid',       '+966-11-100-0002', true),
  ('branch@alhayat.sa',    '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'Khalid Al Mohsen',      '+966-12-100-0003', true),
  ('sales@alhayat.sa',     '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'Omar Al Fahad',         '+966-13-100-0004', true),
  ('inventory@alhayat.sa', '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'Saud Al Ibrahim',       '+966-11-100-0005', true)
ON CONFLICT (email) DO NOTHING;

-- ── Assign roles to users ───────────────────────────
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON
  (u.email = 'admin@alhayat.sa'     AND r.code = 'SUPER_ADMIN') OR
  (u.email = 'warehouse@alhayat.sa' AND r.code = 'WAREHOUSE_MANAGER') OR
  (u.email = 'branch@alhayat.sa'    AND r.code = 'BRANCH_MANAGER') OR
  (u.email = 'sales@alhayat.sa'     AND r.code = 'SALES_STAFF') OR
  (u.email = 'inventory@alhayat.sa' AND r.code = 'INVENTORY_STAFF')
ON CONFLICT DO NOTHING;

-- ── Branches (30 branches across Saudi Arabia) ──────
INSERT INTO branches (code, name, city, address, phone) VALUES
  ('BR-RYD-001', 'Al Hayat Riyadh Main',      'Riyadh',   'King Fahd Road, Olaya District',       '+966-11-200-0001'),
  ('BR-JED-001', 'Al Hayat Jeddah Corniche',  'Jeddah',   'Al Corniche Road, Al Shati District',  '+966-12-200-0002'),
  ('BR-DMM-001', 'Al Hayat Dammam Central',   'Dammam',   'King Saud Street, Al Faisaliah',       '+966-13-200-0003'),
  ('BR-RYD-002', 'Al Hayat Riyadh North',     'Riyadh',   'Anas Ibn Malik Road, Al Yasmeen',      '+966-11-200-0004'),
  ('BR-RYD-003', 'Al Hayat Riyadh South',     'Riyadh',   'Al Imam Road, Al Aziziyah',            '+966-11-200-0005'),
  ('BR-MAK-001', 'Al Hayat Makkah',           'Makkah',   'Ibrahim Al Khalil Street',             '+966-12-200-0006'),
  ('BR-MAD-001', 'Al Hayat Madinah',          'Madinah',  'King Abdul Aziz Road',                 '+966-14-200-0007'),
  ('BR-KHB-001', 'Al Hayat Khobar',           'Khobar',   'Prince Sultan Street',                 '+966-13-200-0008'),
  ('BR-JUB-001', 'Al Hayat Jubail',           'Jubail',   'King Faisal East Road',                '+966-13-200-0009'),
  ('BR-TAB-001', 'Al Hayat Tabuk',            'Tabuk',    'Prince Fahd Bin Sultan Road',           '+966-14-200-0010'),
  ('BR-ABH-001', 'Al Hayat Abha',             'Abha',     'King Abdul Aziz Road',                 '+966-17-200-0011'),
  ('BR-HAL-001', 'Al Hayat Hail',             'Hail',     'King Khalid Road',                     '+966-16-200-0012'),
  ('BR-BUR-001', 'Al Hayat Buraydah',         'Buraydah', 'King Abdul Aziz Road',                 '+966-16-200-0013'),
  ('BR-NAJ-001', 'Al Hayat Najran',           'Najran',   'King Fahd Road',                       '+966-17-200-0014'),
  ('BR-JAZ-001', 'Al Hayat Jazan',            'Jazan',    'Corniche Road',                        '+966-17-200-0015'),
  ('BR-YNB-001', 'Al Hayat Yanbu',            'Yanbu',    'King Abdul Aziz Road',                 '+966-14-200-0016'),
  ('BR-KHR-001', 'Al Hayat Al Kharj',         'Al Kharj', 'King Fahd Road',                       '+966-11-200-0017'),
  ('BR-UNZ-001', 'Al Hayat Unaizah',          'Unaizah', 'King Abdul Aziz Road',                  '+966-16-200-0018'),
  ('BR-SAK-001', 'Al Hayat Sakaka',           'Sakaka',   'Imam Mohammad Bin Saud Road',          '+966-14-200-0019'),
  ('BR-ARR-001', 'Al Hayat Arar',             'Arar',     'King Fahd Road',                       '+966-14-200-0020'),
  ('BR-HOF-001', 'Al Hayat Hofuf',            'Hofuf',    'King Faisal Road',                     '+966-13-200-0021'),
  ('BR-TAF-001', 'Al Hayat Taif',             'Taif',     'Shubra Road',                          '+966-12-200-0022'),
  ('BR-RYD-004', 'Al Hayat Riyadh Exit 5',    'Riyadh',   'Northern Ring Road, Exit 5',           '+966-11-200-0023'),
  ('BR-RYD-005', 'Al Hayat Riyadh Exit 10',   'Riyadh',   'Eastern Ring Road, Exit 10',           '+966-11-200-0024'),
  ('BR-JED-002', 'Al Hayat Jeddah North',     'Jeddah',   'Prince Sultan Road, Al Salamah',       '+966-12-200-0025'),
  ('BR-JED-003', 'Al Hayat Jeddah South',     'Jeddah',   'Al Madinah Road, Al Safa',             '+966-12-200-0026'),
  ('BR-DMM-002', 'Al Hayat Dammam North',     'Dammam',   'King Fahd Road, Al Muhammadiyah',      '+966-13-200-0027'),
  ('BR-BSH-001', 'Al Hayat Bisha',            'Bisha',    'King Khalid Road',                     '+966-17-200-0028'),
  ('BR-QTF-001', 'Al Hayat Qatif',            'Qatif',    'Tarut Road',                           '+966-13-200-0029'),
  ('BR-RYD-006', 'Al Hayat Riyadh Panorama',  'Riyadh',   'Takhasusi Street, Panorama Mall',      '+966-11-200-0030')
ON CONFLICT DO NOTHING;

-- ── Warehouses ──────────────────────────────────────
INSERT INTO warehouses (code, name, city, address, phone) VALUES
  ('WH-RYD-001', 'Central Warehouse',         'Riyadh',  'Second Industrial City, Block 7',  '+966-11-300-0001'),
  ('WH-DMM-001', 'Eastern Region Warehouse',  'Dammam',  'Industrial City, Zone 3',          '+966-13-300-0002'),
  ('WH-JED-001', 'Western Region Warehouse',  'Jeddah',  'South Industrial Area, Plot 42',   '+966-12-300-0003')
ON CONFLICT DO NOTHING;

-- ── Categories ──────────────────────────────────────
INSERT INTO categories (name, slug, parent_id) VALUES
  ('Living Room', 'living-room', NULL),
  ('Bedroom',     'bedroom',     NULL),
  ('Dining Room', 'dining-room', NULL),
  ('Office',      'office',      NULL),
  ('Outdoor',     'outdoor',     NULL)
ON CONFLICT (name) DO NOTHING;

-- Subcategories
INSERT INTO categories (name, slug, parent_id)
SELECT sub.name, sub.slug, c.id FROM (VALUES
  ('Sofas',           'sofas',           'Living Room'),
  ('TV Units',        'tv-units',        'Living Room'),
  ('Coffee Tables',   'coffee-tables',   'Living Room'),
  ('Armchairs',       'armchairs',       'Living Room'),
  ('Beds',            'beds',            'Bedroom'),
  ('Wardrobes',       'wardrobes',       'Bedroom'),
  ('Nightstands',     'nightstands',     'Bedroom'),
  ('Dressers',        'dressers',        'Bedroom'),
  ('Dining Tables',   'dining-tables',   'Dining Room'),
  ('Dining Chairs',   'dining-chairs',   'Dining Room'),
  ('Buffets',         'buffets',         'Dining Room'),
  ('Desks',           'desks',           'Office'),
  ('Office Chairs',   'office-chairs',   'Office'),
  ('Bookshelves',     'bookshelves',     'Office'),
  ('Garden Sets',     'garden-sets',     'Outdoor'),
  ('Swing Chairs',    'swing-chairs',    'Outdoor')
) AS sub(name, slug, parent_name)
JOIN categories c ON c.name = sub.parent_name
ON CONFLICT (name) DO NOTHING;

-- ── Brands ──────────────────────────────────────────
INSERT INTO brands (name) VALUES
  ('Al Hayat Signature'),
  ('Al Hayat Modern'),
  ('Al Hayat Classic'),
  ('Al Hayat Premium'),
  ('Al Hayat Essentials')
ON CONFLICT (name) DO NOTHING;

-- ── Sample Products ─────────────────────────────────
INSERT INTO products (sku, name, description, category_id, brand_id, cost_price, selling_price, reorder_level) VALUES
  ('AH-SF-1001', 'Royal Chesterfield Sofa', 'Premium leather 3-seater Chesterfield with tufted back and rolled arms',
    (SELECT id FROM categories WHERE name = 'Sofas' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Signature'), 2800.00, 4500.00, 5),
  ('AH-SF-1002', 'Modern L-Shape Sectional', 'Contemporary L-shaped fabric sectional with chaise lounge',
    (SELECT id FROM categories WHERE name = 'Sofas' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Modern'), 3200.00, 5200.00, 3),
  ('AH-BD-2001', 'King Platform Bed - Walnut', 'Solid walnut king-size platform bed with upholstered headboard',
    (SELECT id FROM categories WHERE name = 'Beds' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Signature'), 3500.00, 5800.00, 4),
  ('AH-BD-2002', 'Queen Storage Bed - Oak', 'Oak queen bed with hydraulic lift storage compartment',
    (SELECT id FROM categories WHERE name = 'Beds' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Classic'), 2200.00, 3600.00, 6),
  ('AH-WR-3001', 'Six Door Wardrobe - White', 'Full-length mirrored six-door wardrobe with interior lighting',
    (SELECT id FROM categories WHERE name = 'Wardrobes' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Premium'), 4000.00, 6500.00, 3),
  ('AH-DT-4001', 'Extendable Dining Table', '8-seater extendable solid wood dining table',
    (SELECT id FROM categories WHERE name = 'Dining Tables' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Classic'), 1800.00, 2900.00, 5),
  ('AH-DC-4101', 'Upholstered Dining Chair', 'Velvet upholstered dining chair with gold-finish legs',
    (SELECT id FROM categories WHERE name = 'Dining Chairs' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Modern'), 450.00, 750.00, 20),
  ('AH-TV-5001', 'Floating TV Unit 240cm', 'Wall-mounted TV unit with LED backlighting and cable management',
    (SELECT id FROM categories WHERE name = 'TV Units' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Modern'), 1200.00, 1950.00, 8),
  ('AH-CT-5101', 'Marble Top Coffee Table', 'Italian marble top with brass-finish steel frame',
    (SELECT id FROM categories WHERE name = 'Coffee Tables' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Signature'), 900.00, 1500.00, 10),
  ('AH-DK-6001', 'Executive Office Desk', 'L-shaped executive desk with cable management and drawers',
    (SELECT id FROM categories WHERE name = 'Desks' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Premium'), 2100.00, 3400.00, 4),
  ('AH-NS-2101', 'Bedside Table - Walnut', 'Two-drawer walnut nightstand with soft-close drawers',
    (SELECT id FROM categories WHERE name = 'Nightstands' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Classic'), 350.00, 580.00, 15),
  ('AH-BF-4201', 'Modern Buffet Cabinet', 'Scandinavian-style buffet with sliding doors',
    (SELECT id FROM categories WHERE name = 'Buffets' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Modern'), 1500.00, 2400.00, 5)
ON CONFLICT (sku) DO NOTHING;

-- ── Product Variants (with barcodes for scanning) ───
INSERT INTO product_variants (product_id, sku, barcode, color, material, dimensions) VALUES
  ((SELECT id FROM products WHERE sku='AH-SF-1001'), 'AH-SF-1001-BRN', '6281000010011', 'Brown', 'Full Grain Leather', '220x90x85 cm'),
  ((SELECT id FROM products WHERE sku='AH-SF-1001'), 'AH-SF-1001-BLK', '6281000010012', 'Black', 'Full Grain Leather', '220x90x85 cm'),
  ((SELECT id FROM products WHERE sku='AH-SF-1001'), 'AH-SF-1001-TAN', '6281000010013', 'Tan', 'Full Grain Leather', '220x90x85 cm'),
  ((SELECT id FROM products WHERE sku='AH-SF-1002'), 'AH-SF-1002-GRY', '6281000010021', 'Grey', 'Premium Fabric', '300x180x90 cm'),
  ((SELECT id FROM products WHERE sku='AH-SF-1002'), 'AH-SF-1002-NVY', '6281000010022', 'Navy', 'Premium Fabric', '300x180x90 cm'),
  ((SELECT id FROM products WHERE sku='AH-BD-2001'), 'AH-BD-2001-WAL', '6281000020011', 'Walnut', 'Solid Wood', '210x190x120 cm'),
  ((SELECT id FROM products WHERE sku='AH-BD-2001'), 'AH-BD-2001-CHR', '6281000020012', 'Cherry', 'Solid Wood', '210x190x120 cm'),
  ((SELECT id FROM products WHERE sku='AH-BD-2002'), 'AH-BD-2002-OAK', '6281000020021', 'Natural Oak', 'Solid Oak', '200x170x100 cm'),
  ((SELECT id FROM products WHERE sku='AH-BD-2002'), 'AH-BD-2002-WOK', '6281000020022', 'White Oak', 'Solid Oak', '200x170x100 cm'),
  ((SELECT id FROM products WHERE sku='AH-WR-3001'), 'AH-WR-3001-WHT', '6281000030011', 'White', 'MDF with Lacquer', '300x60x240 cm'),
  ((SELECT id FROM products WHERE sku='AH-WR-3001'), 'AH-WR-3001-GRY', '6281000030012', 'Grey', 'MDF with Lacquer', '300x60x240 cm'),
  ((SELECT id FROM products WHERE sku='AH-DT-4001'), 'AH-DT-4001-WNT', '6281000040011', 'Walnut', 'Solid Wood', '200x100x76 cm (extends to 260cm)'),
  ((SELECT id FROM products WHERE sku='AH-DC-4101'), 'AH-DC-4101-GRN', '6281000041011', 'Emerald Green', 'Velvet', '48x55x92 cm'),
  ((SELECT id FROM products WHERE sku='AH-DC-4101'), 'AH-DC-4101-NVY', '6281000041012', 'Navy', 'Velvet', '48x55x92 cm'),
  ((SELECT id FROM products WHERE sku='AH-DC-4101'), 'AH-DC-4101-BLH', '6281000041013', 'Blush', 'Velvet', '48x55x92 cm'),
  ((SELECT id FROM products WHERE sku='AH-TV-5001'), 'AH-TV-5001-WHT', '6281000050011', 'White', 'MDF with Lacquer', '240x40x45 cm'),
  ((SELECT id FROM products WHERE sku='AH-TV-5001'), 'AH-TV-5001-WAL', '6281000050012', 'Walnut', 'Veneer', '240x40x45 cm'),
  ((SELECT id FROM products WHERE sku='AH-CT-5101'), 'AH-CT-5101-WHT', '6281000051011', 'White Marble', 'Italian Marble + Brass', '120x60x45 cm'),
  ((SELECT id FROM products WHERE sku='AH-CT-5101'), 'AH-CT-5101-BLK', '6281000051012', 'Black Marble', 'Italian Marble + Brass', '120x60x45 cm'),
  ((SELECT id FROM products WHERE sku='AH-DK-6001'), 'AH-DK-6001-WAL', '6281000060011', 'Walnut', 'Solid Wood + Steel', '180x150x75 cm'),
  ((SELECT id FROM products WHERE sku='AH-NS-2101'), 'AH-NS-2101-WAL', '6281000021011', 'Walnut', 'Solid Wood', '50x40x55 cm'),
  ((SELECT id FROM products WHERE sku='AH-NS-2101'), 'AH-NS-2101-OAK', '6281000021012', 'Oak', 'Solid Wood', '50x40x55 cm'),
  ((SELECT id FROM products WHERE sku='AH-BF-4201'), 'AH-BF-4201-WHT', '6281000042011', 'White', 'MDF with Lacquer', '160x45x80 cm'),
  ((SELECT id FROM products WHERE sku='AH-BF-4201'), 'AH-BF-4201-OAK', '6281000042012', 'Natural Oak', 'Oak Veneer', '160x45x80 cm')
ON CONFLICT (sku) DO NOTHING;

-- ── Warehouse Locations (bins) ──────────────────────
INSERT INTO warehouse_locations (warehouse_id, aisle, rack, shelf, bin, barcode)
SELECT w.id, loc.aisle, loc.rack, loc.shelf, loc.bin, loc.barcode
FROM warehouses w
CROSS JOIN (VALUES
  ('A', '01', '1', '01', 'CW-A-01-1-01'),
  ('A', '01', '1', '02', 'CW-A-01-1-02'),
  ('A', '01', '2', '01', 'CW-A-01-2-01'),
  ('A', '01', '2', '02', 'CW-A-01-2-02'),
  ('A', '02', '1', '01', 'CW-A-02-1-01'),
  ('A', '02', '1', '02', 'CW-A-02-1-02'),
  ('A', '02', '2', '01', 'CW-A-02-2-01'),
  ('B', '01', '1', '01', 'CW-B-01-1-01'),
  ('B', '01', '1', '02', 'CW-B-01-1-02'),
  ('B', '01', '2', '01', 'CW-B-01-2-01'),
  ('B', '02', '1', '01', 'CW-B-02-1-01'),
  ('B', '02', '1', '02', 'CW-B-02-1-02'),
  ('C', '01', '1', '01', 'CW-C-01-1-01'),
  ('C', '01', '1', '02', 'CW-C-01-1-02'),
  ('C', '02', '1', '01', 'CW-C-02-1-01'),
  ('D', '01', '1', '01', 'CW-D-01-1-01'),
  ('D', '01', '1', '02', 'CW-D-01-1-02'),
  ('D', '01', '2', '01', 'CW-D-01-2-01'),
  ('D', '01', '2', '02', 'CW-D-01-2-02'),
  ('D', '02', '1', '01', 'CW-D-02-1-01')
) AS loc(aisle, rack, shelf, bin, barcode)
WHERE w.name = 'Central Warehouse'
ON CONFLICT DO NOTHING;

-- ── Suppliers ───────────────────────────────────────
INSERT INTO suppliers (name, contact_name, email, phone, address) VALUES
  ('Royal Furniture Factory',    'Mohammed Al Otaibi',  'sales@royalfurniture.sa',  '+966-11-400-0001', 'Second Industrial City, Riyadh'),
  ('Al Madinah Wood Works',      'Abdullah Al Harbi',   'info@madinahwood.sa',      '+966-14-400-0002', 'Industrial Zone, Madinah'),
  ('Italian Imports Trading',    'Giuseppe Romano',     'gulf@italimports.com',     '+966-12-400-0003', 'Jeddah Islamic Port, Free Zone'),
  ('Eastern Upholstery Co.',     'Nasser Al Dosari',    'orders@easternupholstery.sa', '+966-13-400-0004', 'Dammam Industrial, Zone 7'),
  ('Turkish Home Collection',    'Mehmet Yilmaz',       'export@turkhome.com.tr',   '+966-12-400-0005', 'Jeddah, Al Khumra')
ON CONFLICT DO NOTHING;

-- ── Customers ───────────────────────────────────────
INSERT INTO customers (name, email, phone, address) VALUES
  ('Interior Designs Studio',    'projects@interiordesigns.sa',  '+966-11-500-0001', 'Riyadh, Al Olaya'),
  ('Royal Villa Development',    'procurement@royalvilla.sa',    '+966-11-500-0002', 'Riyadh, Al Nakheel'),
  ('Al Faisal Hotels Group',     'purchasing@alfaisal.sa',       '+966-12-500-0003', 'Jeddah, Corniche Road'),
  ('Corporate Office Solutions', 'info@corpoffice.sa',           '+966-13-500-0004', 'Khobar, Business District'),
  ('Walk-in Customer',            NULL,                           NULL,               NULL)
ON CONFLICT DO NOTHING;

-- ── Sample Inventory Stock (Central Warehouse) ──────
INSERT INTO inventory_stock (variant_id, owner_type, warehouse_id, warehouse_location_id, quantity_on_hand, quantity_reserved)
SELECT
  v.id,
  'WAREHOUSE',
  w.id,
  (SELECT wl.id FROM warehouse_locations wl WHERE wl.warehouse_id = w.id ORDER BY random() LIMIT 1),
  floor(random() * 40 + 5)::int,
  floor(random() * 5)::int
FROM product_variants v
CROSS JOIN warehouses w
WHERE w.name = 'Central Warehouse'
ON CONFLICT DO NOTHING;

-- ── Sample Inventory Stock (Branch stock for first 5 branches) ──
INSERT INTO inventory_stock (variant_id, owner_type, branch_id, quantity_on_hand, quantity_reserved)
SELECT
  v.id,
  'BRANCH',
  b.id,
  floor(random() * 10 + 1)::int,
  floor(random() * 2)::int
FROM product_variants v
CROSS JOIN (SELECT id FROM branches ORDER BY name LIMIT 5) b
ON CONFLICT DO NOTHING;

-- ── Verification query ──────────────────────────────
-- Run this after to confirm everything worked:
SELECT
  'Users: ' || (SELECT count(*) FROM users) ||
  ', Roles: ' || (SELECT count(*) FROM roles) ||
  ', Permissions: ' || (SELECT count(*) FROM permissions) ||
  ', Role-Perms: ' || (SELECT count(*) FROM role_permissions) ||
  ', User-Roles: ' || (SELECT count(*) FROM user_roles) ||
  ', Branches: ' || (SELECT count(*) FROM branches) ||
  ', Warehouses: ' || (SELECT count(*) FROM warehouses) ||
  ', Products: ' || (SELECT count(*) FROM products) ||
  ', Variants: ' || (SELECT count(*) FROM product_variants) ||
  ', Stock: ' || (SELECT count(*) FROM inventory_stock)
AS seed_summary;
