-- ── Branch User Migration ─────────────────────────────────────────────
-- Run: node ./node_modules/wrangler/bin/wrangler.js d1 execute al-hayat-db --file=./migration_branch_users.sql --remote
-- Or via Railway backend API after deployment.

-- 1. Add 'branch_user' role (scoped to a single branch, no user/branch management)
INSERT OR IGNORE INTO roles (id, code, name, description) VALUES 
  ('role-branch-user', 'branch_user', 'Branch User', 
   'Auto-provisioned user scoped to a single branch — sees only their branch data');

-- 2. Assign operational permissions to branch_user (all except manage_users)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES 
  ('role-branch-user', '22222222-2222-2222-2222-222222222222'),  -- manage_inventory
  ('role-branch-user', '33333333-3333-3333-3333-333333333333'),  -- manage_transfers
  ('role-branch-user', '44444444-4444-4444-4444-444444444444'),  -- manage_purchasing
  ('role-branch-user', '55555555-5555-5555-5555-555555555555'),  -- manage_sales
  ('role-branch-user', '66666666-6666-6666-6666-666666666666');  -- view_reports

-- 3. Add password_version for credential regeneration / session invalidation
--    Incrementing this column will invalidate all existing JWT tokens for that user.
ALTER TABLE users ADD COLUMN password_version INTEGER NOT NULL DEFAULT 1;
