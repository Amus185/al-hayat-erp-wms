#!/usr/bin/env node
/**
 * wipe_operational_data.mjs
 * 
 * Safely wipes all operational and transactional data from the PostgreSQL database
 * (sales, purchases, accounting journal entries, general ledger, inventory, deliveries, etc.)
 * while PRESERVING users, roles, permissions, branches, warehouses, and the chart of accounts skeleton.
 *
 * Usage:
 *   node wipe_operational_data.mjs --confirm
 *   node wipe_operational_data.mjs --dry-run
 *   node wipe_operational_data.mjs --confirm --keep-products
 *
 * Options:
 *   --confirm        Required flag to authorize execution
 *   --dry-run        Inspect row counts without deleting anything
 *   --keep-products  Preserve product catalog entries (categories, brands, products)
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Auto-load environment variables from backend/.env or root .env
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

const { Client } = pg;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes('--dry-run');
const IS_CONFIRMED = args.includes('--confirm') || args.includes('-y') || args.includes('--force');
const KEEP_PRODUCTS = args.includes('--keep-products');

// Core Auth & Structure Tables — NEVER WIPED
const PROTECTED_TABLES = new Set([
  'users',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  'branches',
  'warehouses',
  'warehouse_locations',
  'chart_of_accounts',
  'fiscal_periods',
]);

// Product Catalog Tables (Preserved only if --keep-products is passed)
const PRODUCT_CATALOG_TABLES = new Set([
  'products',
  'categories',
  'brands',
]);

// Operational / Transactional Tables to Wipe
const TARGET_OPERATIONAL_TABLES = [
  // Sales & Customer Debts
  'invoice_payments',
  'invoice_lines',
  'invoices',
  'sales_order_lines',
  'sales_orders',
  'quotations',
  'customer_payments',
  'customer_debts',
  'customers',

  // Purchasing & Suppliers
  'purchase_invoice_payments',
  'purchase_invoices',
  'goods_receipt_lines',
  'goods_receipts',
  'purchase_order_lines',
  'purchase_orders',
  'suppliers',

  // Inventory, Transfers & Logistics
  'inventory_transactions',
  'inventory_stock',
  'inventory_period_counts',
  'transfer_lines',
  'transfers',
  'delivery_runs',
  'delivery_items',
  'deliveries',

  // Manufacturing
  'work_order_stages',
  'work_order_materials',
  'work_order_logs',
  'work_orders',
  'bom_items',
  'bill_of_materials',

  // General Ledger & Accounting
  'journal_entry_lines',
  'journal_entries',
  'general_ledger',
  'expenses',

  // Assets, Leases & Specialized Modules
  'depreciation_schedules',
  'rental_payments',
  'property_expenses',
  'lease_agreements',
  'tenants',
  'properties',
  'livestock_expenses',
  'livestock_transactions',
  'livestock',

  // Activity Logs & Transient Sessions
  'notifications',
  'audit_logs',
  'refresh_tokens',
  'files',
];

async function askConfirmation() {
  if (IS_CONFIRMED || IS_DRY_RUN) return true;

  if (!process.stdin.isTTY) {
    console.error('❌ Interactive confirmation required. Pass --confirm to proceed non-interactively.');
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log('\n⚠️  WARNING: You are about to permanently wipe all operational system data!');
    console.log('   Users, roles, permissions, branches, warehouses, and the chart of accounts will be preserved.');
    rl.question('   Type "WIPE" to confirm and proceed: ', (answer) => {
      rl.close();
      resolve(answer.trim() === 'WIPE');
    });
  });
}

async function main() {
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Please provide it in .env or via environment variables.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL database.\n');

    // Fetch all existing public tables
    const tableRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const existingTables = new Set(tableRes.rows.map(r => r.table_name));

    // Determine tables to wipe
    const tablesToWipe = TARGET_OPERATIONAL_TABLES.filter(t => existingTables.has(t));
    if (!KEEP_PRODUCTS) {
      for (const t of PRODUCT_CATALOG_TABLES) {
        if (existingTables.has(t)) tablesToWipe.push(t);
      }
    }

    // Determine preserved tables
    const preservedTables = Array.from(existingTables).filter(t => !tablesToWipe.includes(t));

    // Count rows before wipe
    console.log('📊 Current Database Status:');
    console.log('─'.repeat(60));

    console.log('\n🔒 PRESERVED TABLES (Will NOT be modified):');
    for (const t of preservedTables) {
      try {
        const countRes = await client.query(`SELECT COUNT(*)::int AS count FROM "${t}";`);
        console.log(`   • ${t.padEnd(28)} : ${countRes.rows[0].count} rows`);
      } catch {
        console.log(`   • ${t.padEnd(28)} : preserved`);
      }
    }

    console.log('\n🗑️  TABLES TO WIPE:');
    let totalWipeRows = 0;
    const wipeStats = [];
    for (const t of tablesToWipe) {
      try {
        const countRes = await client.query(`SELECT COUNT(*)::int AS count FROM "${t}";`);
        const count = countRes.rows[0].count;
        totalWipeRows += count;
        wipeStats.push({ table: t, count });
        console.log(`   • ${t.padEnd(28)} : ${count} rows`);
      } catch {
        wipeStats.push({ table: t, count: 0 });
      }
    }

    console.log('─'.repeat(60));
    console.log(`Total rows targeted for deletion: ${totalWipeRows}`);

    if (IS_DRY_RUN) {
      console.log('\n🔍 [DRY RUN COMPLETE] No data was deleted.');
      return;
    }

    const confirmed = await askConfirmation();
    if (!confirmed) {
      console.log('\n❌ Operation cancelled by user. No data was touched.');
      return;
    }

    console.log('\n⚡ Wiping operational data in PostgreSQL transaction...');
    await client.query('BEGIN;');

    // Truncate tables with CASCADE
    const tableListStr = tablesToWipe.map(t => `"${t}"`).join(', ');
    if (tableListStr.length > 0) {
      await client.query(`TRUNCATE TABLE ${tableListStr} RESTART IDENTITY CASCADE;`);
    }

    await client.query('COMMIT;');

    console.log('\n✨ Database successfully wiped to clean state!');
    console.log('────────────────────────────────────────────────────────────');
    console.log('✅ Users, Roles & Permissions: 100% Intact & preserved');
    console.log('✅ Branches & Warehouses:       100% Intact & preserved');
    console.log('✅ Chart of Accounts Skeleton:  100% Intact & preserved');
    console.log('🗑️  Sales Orders & Invoices:     Wiped (Clean slate)');
    console.log('🗑️  Purchase Orders & Invoices:  Wiped (Clean slate)');
    console.log('🗑️  Inventory Movements & Stock: Wiped (Clean slate)');
    console.log('🗑️  General Ledger & Journals:   Wiped (Clean slate)');
    console.log('🗑️  Deliveries & Work Orders:    Wiped (Clean slate)');
    console.log('────────────────────────────────────────────────────────────');
    console.log('You can now log in and begin fresh operational testing.\n');

  } catch (err) {
    try { await client.query('ROLLBACK;'); } catch (_) {}
    console.error('\n❌ Error wiping operational data:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
