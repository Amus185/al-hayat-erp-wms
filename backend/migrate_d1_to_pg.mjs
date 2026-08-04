#!/usr/bin/env node
/**
 * migrate_d1_to_pg.mjs
 * Phase 4 — Full D1 → PostgreSQL data migration
 *
 * Usage:
 *   node migrate_d1_to_pg.mjs
 *
 * Required environment variables:
 *   CLOUDFLARE_ACCOUNT_ID   — your CF account ID
 *   CLOUDFLARE_D1_DATABASE_ID — the D1 database UUID
 *   CLOUDFLARE_API_TOKEN    — API token with D1:Read permission
 *   DATABASE_URL            — Railway Postgres connection string
 *
 * What this script does:
 *   1. Reads every table from D1 in dependency order (no FK violations)
 *   2. Transforms values for Postgres compatibility (dates, booleans, nulls)
 *   3. Streams inserts into Postgres via parameterised queries
 *   4. After all inserts: runs row count + financial SUM validation
 *   5. Exits non-zero if any validation fails — safe to re-run (idempotent
 *      because it truncates before inserting)
 *
 * Safety: wraps each table's insert in a BEGIN/COMMIT block, so a partial
 * failure leaves nothing half-written.
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Auto-load backend/.env or root .env if present
const envPaths = [join(__dirname, '.env'), join(__dirname, '..', '.env')];
for (const p of envPaths) {
  if (existsSync(p)) {
    const lines = readFileSync(p, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

const { Pool } = pg;

// ─── Configuration ──────────────────────────────────────────────────────────

const CF_ACCOUNT_ID    = process.env.CLOUDFLARE_ACCOUNT_ID    || 'c3066ec07528b261e192b4530cca58bf';
const CF_DATABASE_ID   = process.env.CLOUDFLARE_D1_DATABASE_ID || '1cae6841-1519-4131-9636-161a5039c3c5';
const CF_API_TOKEN     = process.env.CLOUDFLARE_API_TOKEN;
const DATABASE_URL     = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;

if (!CF_API_TOKEN) {
  console.error('❌  CLOUDFLARE_API_TOKEN is required');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL (Railway Postgres) is required');
  process.exit(1);
}

// ─── Table order — parents before children (respects all FK constraints) ─────
// Every table in the schema, in dependency order.
const TABLE_ORDER = [
  // Standalone / no FK deps
  'branches',
  'warehouses',
  'permissions',
  'roles',
  'categories',
  'brands',
  'fiscal_periods',

  // Depend on branches/warehouses
  'users',
  'warehouse_locations',
  'chart_of_accounts',

  // Depend on roles/users
  'role_permissions',
  'user_roles',
  'refresh_tokens',

  // Products (depend on categories/brands)
  'products',

  // Inventory (depend on products/branches/warehouses)
  'inventory_stock',
  'inventory_transactions',

  // Customers / Suppliers
  'customers',
  'suppliers',

  // Sales
  'sales_orders',
  'sales_order_lines',
  'quotations',
  'invoices',
  'invoice_lines',
  'invoice_payments',

  // Purchasing
  'purchase_orders',
  'purchase_order_lines',
  'goods_receipts',
  'goods_receipt_lines',
  'purchase_invoices',
  'purchase_invoice_payments',

  // Transfers
  'transfers',
  'transfer_lines',

  // Accounting GL
  'journal_entries',
  'journal_entry_lines',
  'general_ledger',

  // Misc
  'notifications',
  'audit_logs',
  'files',
];

// ─── D1 REST helper ──────────────────────────────────────────────────────────

async function d1Query(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`D1 HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!data.success || !data.result || data.result.length === 0) {
    const msg = data.errors?.[0]?.message || 'Unknown D1 error';
    throw new Error(`D1 query error: ${msg}`);
  }
  return data.result[0].results || [];
}

// ─── Value transform for Postgres ─────────────────────────────────────────────
// D1/SQLite returns booleans as 0/1 integers — Postgres INTEGER columns accept
// these fine. ISO datetime strings from D1 are accepted as-is by Postgres
// TIMESTAMP WITH TIME ZONE columns.  No transformation needed; we keep the
// values exactly as D1 returns them.

function transformValue(v) {
  if (v === undefined) return null;
  return v;
}

// ─── Postgres bulk insert for one table ───────────────────────────────────────

async function insertRows(pgClient, tableName, rows) {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  if (columns.length === 0) return;

  // Build a single multi-row INSERT per batch of up to 500 rows
  // to avoid exceeding Postgres's maximum parameter count (65535).
  const BATCH_SIZE = 500;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = batch.map((row, ri) => {
      const rowPlaceholders = columns.map((col, ci) => {
        values.push(transformValue(row[col]));
        return `$${ri * columns.length + ci + 1}`;
      });
      return `(${rowPlaceholders.join(', ')})`;
    });

    const sql = `INSERT INTO ${tableName} (${columns.map(c => `"${c}"`).join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;
    await pgClient.query(sql, values);
  }
}

// ─── Main migration ───────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Al Hayat ERP — D1 → PostgreSQL Migration');
  console.log('━'.repeat(60));

  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  let totalRowsMigrated = 0;
  const rowCounts = {};

  try {
    // Step 1: Export & import each table
    for (const table of TABLE_ORDER) {
      process.stdout.write(`  ➤ ${table.padEnd(35, '.')} `);

      let d1Rows;
      try {
        d1Rows = await d1Query(`SELECT * FROM ${table}`);
      } catch (err) {
        // Table may not exist in D1 (e.g. added later) — skip gracefully
        if (err.message.includes('no such table') || err.message.includes('does not exist')) {
          console.log(`SKIP (table not found in D1)`);
          rowCounts[table] = { d1: 0, pg: 0 };
          continue;
        }
        throw err;
      }

      rowCounts[table] = { d1: d1Rows.length, pg: 0 };

      const pgClient = await pool.connect();
      try {
        await pgClient.query('BEGIN');
        // Clear existing rows so re-runs are safe (idempotent)
        await pgClient.query(`TRUNCATE TABLE ${table} CASCADE`);
        await insertRows(pgClient, table, d1Rows);
        await pgClient.query('COMMIT');

        // Verify count in Postgres
        const countRes = await pgClient.query(`SELECT COUNT(*) AS cnt FROM ${table}`);
        const pgCount = parseInt(countRes.rows[0].cnt, 10);
        rowCounts[table].pg = pgCount;

        const match = pgCount === d1Rows.length;
        console.log(`${match ? '✅' : '❌'} D1: ${d1Rows.length} → PG: ${pgCount} rows`);
        totalRowsMigrated += pgCount;
      } catch (err) {
        await pgClient.query('ROLLBACK');
        throw new Error(`Failed on table '${table}': ${err.message}`);
      } finally {
        pgClient.release();
      }
    }

    console.log('\n━'.repeat(60));
    console.log(`📦 Total rows migrated: ${totalRowsMigrated.toLocaleString()}`);

    // Step 2: Financial SUM validation
    console.log('\n💰 Financial SUM Validation (D1 vs Postgres)');
    console.log('━'.repeat(60));

    const financialChecks = [
      {
        label: 'invoices.total_amount SUM',
        d1Sql: 'SELECT CAST(SUM(total_amount) AS TEXT) AS val FROM invoices',
        pgSql: 'SELECT SUM(total_amount)::TEXT AS val FROM invoices',
      },
      {
        label: 'invoice_payments.amount SUM',
        d1Sql: 'SELECT CAST(SUM(amount) AS TEXT) AS val FROM invoice_payments',
        pgSql: 'SELECT SUM(amount)::TEXT AS val FROM invoice_payments',
      },
      {
        label: 'general_ledger.debit_amount SUM',
        d1Sql: 'SELECT CAST(SUM(debit_amount) AS TEXT) AS val FROM general_ledger',
        pgSql: 'SELECT SUM(debit_amount)::TEXT AS val FROM general_ledger',
      },
      {
        label: 'general_ledger.credit_amount SUM',
        d1Sql: 'SELECT CAST(SUM(credit_amount) AS TEXT) AS val FROM general_ledger',
        pgSql: 'SELECT SUM(credit_amount)::TEXT AS val FROM general_ledger',
      },
      {
        label: 'purchase_invoices.total_amount SUM',
        d1Sql: 'SELECT CAST(SUM(total_amount) AS TEXT) AS val FROM purchase_invoices',
        pgSql: 'SELECT SUM(total_amount)::TEXT AS val FROM purchase_invoices',
      },
    ];

    let allSumsMatch = true;
    for (const check of financialChecks) {
      process.stdout.write(`  ➤ ${check.label.padEnd(42, '.')} `);

      const [d1Result, pgResult] = await Promise.all([
        d1Query(check.d1Sql),
        pool.query(check.pgSql),
      ]);

      const d1Val = parseFloat(d1Result[0]?.val || '0');
      const pgVal = parseFloat(pgResult.rows[0]?.val || '0');
      const match = Math.abs(d1Val - pgVal) < 0.01; // allow 1-cent floating-point tolerance

      if (!match) allSumsMatch = false;
      console.log(`${match ? '✅' : '❌'} D1: ${d1Val.toFixed(2)} | PG: ${pgVal.toFixed(2)}`);
    }

    // Step 3: GL double-entry invariant — total debits must equal total credits
    console.log('\n📊 GL Double-Entry Invariant Check');
    const glRes = await pool.query('SELECT SUM(debit_amount) AS debits, SUM(credit_amount) AS credits FROM general_ledger');
    const totalDebits = parseFloat(glRes.rows[0].debits || '0');
    const totalCredits = parseFloat(glRes.rows[0].credits || '0');
    const glBalanced = Math.abs(totalDebits - totalCredits) < 0.01;
    console.log(`  Debits:  ${totalDebits.toFixed(2)}`);
    console.log(`  Credits: ${totalCredits.toFixed(2)}`);
    console.log(`  Balanced: ${glBalanced ? '✅ YES' : '❌ NO — GL is not balanced!'}`);

    console.log('\n' + '━'.repeat(60));

    // Final verdict
    const allCountsMatch = Object.values(rowCounts).every(r => r.d1 === r.pg);
    const allPassed = allCountsMatch && allSumsMatch && glBalanced;

    if (allPassed) {
      console.log('✅  Migration PASSED — all row counts, financial sums, and GL balance verified.');
      console.log('👉  Ready for Phase 5 staging validation.');
    } else {
      console.log('❌  Migration has discrepancies — see details above before proceeding.');
      process.exitCode = 1;
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error during migration:', err.message);
  process.exit(1);
});
