-- ── branchmig.sql ─────────────────────────────────────────────────────────
-- Run in: Cloudflare Dashboard → D1 → al-hayat-db → Console
-- ──────────────────────────────────────────────────────────────────────────

-- 1. Add password_version column (idempotent — just ignore error if exists)
ALTER TABLE users ADD COLUMN password_version INTEGER NOT NULL DEFAULT 1;

-- 2. Insert branch_user role
INSERT OR IGNORE INTO roles (id, code, name, description)
VALUES ('role-branch-user', 'branch_user', 'Branch User', 'Auto-provisioned user scoped to a single branch');

-- 3. Assign operational permissions to branch_user
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role-branch-user', id FROM permissions
WHERE code IN ('manage_inventory', 'manage_transfers', 'manage_purchasing', 'manage_sales', 'view_reports');

-- 4. Verify
SELECT id, code FROM roles;
SELECT COUNT(*) AS perms_assigned FROM role_permissions WHERE role_id = 'role-branch-user';
SELECT COUNT(*) AS col_exists FROM pragma_table_info('users') WHERE name = 'password_version';
