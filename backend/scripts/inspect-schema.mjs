// READ-ONLY: report the live database's structure and how people, roles and
// locations are set up, so design changes are checked against production and
// not only against init-postgres.ts. Changes nothing (one read-only transaction).
//
//   DATABASE_URL=postgres://... node backend/scripts/inspect-schema.mjs > schema-report.txt
//
// The report holds structure and counts only, except the list of administrator
// accounts (email and dates), needed to choose the Owner account. No customer,
// supplier or employee details and no amounts per person.
import pg from 'pg';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('Set DATABASE_URL.'); process.exit(1); }
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

const out = (title, rows) => {
  console.log(`\n## ${title}`);
  for (const r of rows) console.log(Object.values(r).map((v) => (v === null ? '∅' : String(v))).join(' | '));
};

await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  out('Tables and views (approx. rows)', (await client.query(`
    SELECT c.relname AS name, CASE c.relkind WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END AS kind, GREATEST(c.reltuples, 0)::bigint AS approx_rows
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') ORDER BY 1`)).rows);
  out('Columns', (await client.query(`
    SELECT table_name, string_agg(column_name || ':' || data_type || CASE WHEN is_nullable = 'NO' THEN '!' ELSE '' END, ', ' ORDER BY ordinal_position) AS columns
    FROM information_schema.columns WHERE table_schema = 'public' GROUP BY table_name ORDER BY 1`)).rows);
  out('Foreign keys', (await client.query(`
    SELECT conrelid::regclass AS tbl, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY 1, 2`)).rows);
  out('Check / unique constraints', (await client.query(`
    SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE contype IN ('c', 'u') AND connamespace = 'public'::regnamespace ORDER BY 1, 2`)).rows);
  out('Indexes', (await client.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`)).rows);
  out('Triggers', (await client.query(`
    SELECT event_object_table, trigger_name, action_timing || ' ' || event_manipulation AS fires
    FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY 1, 2`)).rows);
  out('Roles and their permissions', (await client.query(`
    SELECT r.code, COALESCE(string_agg(DISTINCT p.code, ',' ORDER BY p.code), '-') AS permissions
    FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.code ORDER BY 1`)).rows);
  out('Duplicate role_permissions rows', (await client.query(`
    SELECT COUNT(*) - COUNT(DISTINCT (role_id, permission_id)) AS duplicates FROM role_permissions`)).rows);
  out('Active users by role and location assignment', (await client.query(`
    SELECT COALESCE(r.code, '(no role)') AS role,
           CASE WHEN u.branch_id IS NOT NULL AND u.warehouse_id IS NOT NULL THEN 'branch+warehouse'
                WHEN u.branch_id IS NOT NULL THEN 'branch' WHEN u.warehouse_id IS NOT NULL THEN 'warehouse' ELSE 'none' END AS assigned,
           COUNT(*) AS users
    FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
    WHERE u.is_active = 1 GROUP BY 1, 2 ORDER BY 1, 2`)).rows);
  out('Users with more than one role', (await client.query(`
    SELECT COUNT(*) AS users FROM (SELECT user_id FROM user_roles GROUP BY user_id HAVING COUNT(*) > 1) x`)).rows);
  out('Locations', (await client.query(`
    SELECT 'branches' AS kind, COUNT(*) AS n FROM branches UNION ALL SELECT 'warehouses', COUNT(*) FROM warehouses`)).rows);
  const attribution = [
    ['sales_orders', 'branch_id'], ['expenses', 'branch_id'], ['customer_payments', 'branch_id'], ['customer_debts', 'branch_id'],
    ['journal_entries', 'branch_id'], ['journal_entry_lines', 'branch_id'], ['purchase_orders', 'branch_id'], ['purchase_orders', 'warehouse_id'],
    ['employees', 'branch_id'], ['deliveries', 'source_warehouse_id'], ['work_orders', 'warehouse_id'],
  ];
  const rows = [];
  for (const [t, col] of attribution) {
    const r = await client.query(`SELECT COUNT(*) AS total, COUNT(${col}) AS with_location FROM ${t}`).catch(() => null);
    rows.push({ table: t, column: col, total: r?.rows[0].total ?? 'missing', with_location: r?.rows[0].with_location ?? '-' });
  }
  out('Location attribution (rows with the column filled)', rows);
  out('Journal entries without branch, by reference type', (await client.query(`
    SELECT reference_type, COUNT(*) AS entries FROM journal_entries WHERE branch_id IS NULL GROUP BY 1 ORDER BY 2 DESC`)).rows);
  out('Unbalanced posted journal entries', (await client.query(`
    SELECT COUNT(*) AS entries FROM (
      SELECT je.id FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id
      WHERE je.status IN ('POSTED', 'REVERSED') GROUP BY je.id HAVING ABS(SUM(l.debit_amount) - SUM(l.credit_amount)) > 0.005) x`)).rows);
  out('Transfers by status and kind', (await client.query(`
    SELECT status, source_owner_type || '→' || destination_owner_type AS route, COUNT(*) AS n FROM transfers GROUP BY 1, 2 ORDER BY 1, 2`)).rows);
  // ── Phase 0 data checks ──────────────────────────────────────────────
  const q = async (title, sql) => out(title, (await client.query(sql).catch((e) => ({ rows: [{ error: e.message }] }))).rows);
  await q('Administrator accounts (to choose the Owner)', `
    SELECT DISTINCT u.email, u.full_name, u.is_active, u.branch_id IS NOT NULL AS has_branch, u.created_at::date::text AS created,
           (SELECT MAX(s."createdAt")::date::text FROM session s WHERE s."userId" = u.id) AS last_sign_in,
           (SELECT COUNT(*) FROM audit_logs a WHERE a.actor_user_id = u.id) AS actions
    FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
    WHERE r.code = 'admin' ORDER BY 5`);
  await q('Who is company-level and who is pinned to a branch (what the new rule will do)', `
    SELECT u.email, u.full_name,
           COALESCE(string_agg(DISTINCT r.code, ','), '(no role)') AS roles,
           COALESCE(b.name, '(no branch)') AS branch, COALESCE(w.name, '(no warehouse)') AS warehouse,
           CASE WHEN u.branch_id IS NOT NULL THEN 'PINNED to the branch'
                WHEN bool_or(r.code IN ('admin', 'accountant')) THEN 'COMPANY-LEVEL (Owner view)'
                WHEN u.warehouse_id IS NOT NULL THEN 'PINNED to the warehouse'
                ELSE 'NO LOCATION: will be refused until assigned' END AS after_the_change
    FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
    LEFT JOIN branches b ON b.id = u.branch_id LEFT JOIN warehouses w ON w.id = u.warehouse_id
    WHERE u.is_active = 1 GROUP BY u.id, b.name, w.name ORDER BY u.created_at`);
  await q('Branch-assigned users who also hold the admin role (they will no longer be company-level)', `
    SELECT u.email, b.name AS branch FROM users u JOIN branches b ON b.id = u.branch_id
    WHERE EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = 'admin')`);
  await q('Customers and products no branch deals with yet (visible to the Owner only until a branch sells, stocks or registers them)', `
    SELECT (SELECT COUNT(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM sales_orders so WHERE so.customer_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM customer_debts d WHERE d.customer_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM customer_payments p WHERE p.customer_id = c.id)) AS customers_without_branch_activity,
           (SELECT COUNT(*) FROM products p WHERE NOT EXISTS (SELECT 1 FROM inventory_stock s WHERE s.product_id = p.id AND s.owner_type = 'BRANCH')) AS products_no_branch_holds`);
  await q('Deliveries without a sales order (belong to no branch: Owner only)', `SELECT COUNT(*) AS deliveries FROM deliveries WHERE sales_order_id IS NULL`);
  await q('Non-admin active users with NO branch (treated as admin by isAdminUser today)', `
    SELECT COALESCE(string_agg(DISTINCT r.code, ','), '(no role)') AS roles, u.warehouse_id IS NOT NULL AS has_warehouse, COUNT(DISTINCT u.id) AS users
    FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
    WHERE u.is_active = 1 AND u.branch_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM user_roles x JOIN roles y ON y.id = x.role_id WHERE x.user_id = u.id AND y.code = 'admin')
    GROUP BY u.id, u.warehouse_id`);
  await q('Users pointing at a missing location', `
    SELECT COUNT(*) FILTER (WHERE branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = u.branch_id)) AS bad_branch,
           COUNT(*) FILTER (WHERE warehouse_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.id = u.warehouse_id)) AS bad_warehouse
    FROM users u`);
  await q('Duplicate user_roles rows', `SELECT COUNT(*) - COUNT(DISTINCT (user_id, role_id)) AS duplicates FROM user_roles`);
  await q('Users with no role', `SELECT COUNT(*) AS users FROM users u WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)`);
  await q('Customers: total, buying at more than one branch, duplicate phone numbers', `
    SELECT (SELECT COUNT(*) FROM customers) AS customers,
           (SELECT COUNT(*) FROM (SELECT customer_id FROM sales_orders WHERE customer_id IS NOT NULL GROUP BY customer_id HAVING COUNT(DISTINCT branch_id) > 1) x) AS multi_branch,
           (SELECT COUNT(*) FROM (SELECT regexp_replace(phone, '\D', '', 'g') p FROM customers WHERE COALESCE(phone, '') <> '' GROUP BY 1 HAVING COUNT(*) > 1) x) AS duplicate_phones`);
  await q('Suppliers: total, supplying more than one branch', `
    SELECT (SELECT COUNT(*) FROM suppliers) AS suppliers,
           (SELECT COUNT(*) FROM (SELECT supplier_id FROM purchase_orders GROUP BY supplier_id HAVING COUNT(DISTINCT COALESCE(branch_id, 'company')) > 1) x) AS multi_branch`);
  await q('Purchase orders by destination', `
    SELECT CASE WHEN branch_id IS NOT NULL THEN 'branch' WHEN warehouse_id IS NOT NULL THEN 'warehouse' ELSE 'none' END AS destination, COUNT(*) AS n
    FROM purchase_orders GROUP BY 1`);
  await q('Journal entries by type: with / without branch', `
    SELECT reference_type, COUNT(*) FILTER (WHERE branch_id IS NOT NULL) AS with_branch, COUNT(*) FILTER (WHERE branch_id IS NULL) AS company_level
    FROM journal_entries GROUP BY 1 ORDER BY 1`);
  await q('Inter-Branch Clearing (1090) balance per branch (company total should be 0)', `
    SELECT COALESCE(l.branch_id, '(company)') AS branch, ROUND(SUM(l.debit_amount - l.credit_amount)::numeric, 2) AS balance
    FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.journal_entry_id AND je.status IN ('POSTED', 'REVERSED')
    JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.code = '1090' GROUP BY ROLLUP (1) ORDER BY 1`);
  await q('Journal lines whose branch differs from their entry', `
    SELECT COUNT(*) AS lines FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE l.branch_id IS DISTINCT FROM je.branch_id`);
  await q('Stock rows: negative, ownerless, double-owned; products without cost', `
    SELECT (SELECT COUNT(*) FROM inventory_stock WHERE quantity_on_hand < 0) AS negative,
           (SELECT COUNT(*) FROM inventory_stock WHERE branch_id IS NULL AND warehouse_id IS NULL) AS ownerless,
           (SELECT COUNT(*) FROM inventory_stock WHERE branch_id IS NOT NULL AND warehouse_id IS NOT NULL) AS double_owned,
           (SELECT COUNT(*) FROM products WHERE COALESCE(cost_price, 0) = 0) AS products_without_cost`);
  await q('Transfers received with a different quantity than dispatched', `
    SELECT COUNT(DISTINCT tl.transfer_id) AS transfers, COUNT(*) AS lines FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
    WHERE t.status = 'COMPLETED' AND COALESCE(tl.quantity_received, tl.quantity_dispatched) IS DISTINCT FROM tl.quantity_dispatched`);
  await q('Transfer stock movements per transfer (duplicates would show > 2 per line)', `
    SELECT COUNT(*) AS transfers_with_extra_movements FROM (
      SELECT it.reference_id FROM inventory_transactions it JOIN transfers t ON t.id = it.reference_id
      GROUP BY it.reference_id, it.product_id HAVING COUNT(*) > 2) x`);
  await q('Employees and payroll data', `
    SELECT (SELECT COUNT(*) FROM employees) AS employees, (SELECT COUNT(*) FROM employees WHERE branch_id IS NULL) AS without_branch,
           (SELECT COUNT(*) FROM employees WHERE document_key IS NOT NULL) AS with_document, (SELECT COUNT(*) FROM employee_advances) AS advance_entries`);
  await q('Owner assets (records)', `
    SELECT (SELECT COUNT(*) FROM properties) AS properties, (SELECT COUNT(*) FROM tenants) AS tenants, (SELECT COUNT(*) FROM livestock) AS livestock`);
  await q('Uploaded files: total and linked to an employee', `
    SELECT (SELECT COUNT(*) FROM files) AS files,
           (SELECT COUNT(*) FROM files f WHERE EXISTS (SELECT 1 FROM employees e WHERE f.object_key IN (e.photo_key, e.document_key))) AS employee_files`);
  await q('Assistant use by role (last 30 days)', `
    SELECT COALESCE(r.code, '(no role)') AS role, COUNT(DISTINCT m.conversation_id) AS conversations
    FROM agent_messages m JOIN agent_conversations ac ON ac.id = m.conversation_id
    LEFT JOIN user_roles ur ON ur.user_id = ac.user_id LEFT JOIN roles r ON r.id = ur.role_id
    WHERE m.created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC`);
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
