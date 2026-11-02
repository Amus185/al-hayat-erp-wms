// READ-ONLY: report the live database's structure and how people, roles and
// locations are set up, so design changes are checked against production and
// not only against init-postgres.ts. Changes nothing (one read-only transaction).
//
//   DATABASE_URL=postgres://... node backend/scripts/inspect-schema.mjs > schema-report.txt
//
// The report holds structure and counts only: no names, emails, amounts or
// other business data.
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
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
