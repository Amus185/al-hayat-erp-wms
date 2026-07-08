-- =========================================================
-- Al Hayat ERP+WMS — Seed Data (Clean)
-- Run AFTER schema.sql
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

-- ── Roles ───────────────────────────────────────────
INSERT INTO roles (code, name, description) VALUES
  ('ADMIN',             'Admin',                'Full system access — all modules and settings'),
  ('STAFF',             'Staff',                'Daily operations — products, inventory, and sales only')
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
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
INSERT INTO users (email, password_hash, full_name, phone, is_active) VALUES
  ('admin@alhayat.com', crypt('Admin@123456', gen_salt('bf', 10)), 'System Administrator', NULL, true)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- ── Assign admin role ───────────────────────────────
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON
  (u.email = 'admin@alhayat.com' AND r.code = 'ADMIN')
ON CONFLICT DO NOTHING;
