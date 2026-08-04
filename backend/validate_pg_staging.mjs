#!/usr/bin/env node
/**
 * validate_pg_staging.mjs
 * Phase 5 — Staging validation suite for the Postgres migration
 *
 * Usage:
 *   node validate_pg_staging.mjs
 *
 * Required environment variables:
 *   DATABASE_URL — Railway Postgres connection string
 *   STAGING_API_URL — base URL of the backend pointed at Postgres (e.g. http://localhost:3001)
 *   STAGING_ADMIN_TOKEN — JWT access token for the admin user
 *
 * Runs 5 checks in sequence:
 *   1. Waterfall timing — measures per-query latency on POST /sales/orders/:id/complete
 *   2. Full sale lifecycle — create → confirm → complete, validates DB state
 *   3. Transaction rollback test — confirms batch atomicity
 *   4. GL balance check — debits == credits after a real sale
 *   5. Concurrent CAS test — 10 parallel completes on same order, exactly 1 should win
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

const DATABASE_URL    = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const API_BASE        = (process.env.STAGING_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_TOKEN     = process.env.STAGING_ADMIN_TOKEN;

if (!DATABASE_URL) { console.error('❌  DATABASE_URL required'); process.exit(1); }
if (!ADMIN_TOKEN)  { console.error('❌  STAGING_ADMIN_TOKEN required'); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

function header(title) {
  console.log('\n' + '━'.repeat(60));
  console.log(`▶  ${title}`);
  console.log('━'.repeat(60));
}

function pass(msg) { console.log(`  ✅  ${msg}`); }
function fail(msg) { console.log(`  ❌  ${msg}`); }
function info(msg) { console.log(`  ℹ   ${msg}`); }

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ─── Test 1: Waterfall Timing ──────────────────────────────────────────────

async function testWaterfallTiming() {
  header('Test 1: Waterfall Timing (per-query latency)');

  // Find a DRAFT or CONFIRMED order we can complete
  const ordersRes = await pool.query(
    `SELECT id FROM sales_orders WHERE status IN ('DRAFT','CONFIRMED') LIMIT 1`
  );

  if (ordersRes.rows.length === 0) {
    info('No DRAFT/CONFIRMED orders available — skipping timing test');
    info('Hint: create an order via the UI or API first, then re-run this script');
    return;
  }

  const orderId = ordersRes.rows[0].id;
  info(`Using order ${orderId}`);

  const t0 = Date.now();
  const res = await api('POST', `/api/v1/sales/orders/${orderId}/complete`);
  const totalMs = Date.now() - t0;

  info(`Total round-trip (browser → API → Postgres → API → browser): ${totalMs}ms`);

  if (res.status === 200) {
    pass(`Complete Sale returned 200 in ${totalMs}ms`);
    if (totalMs < 500) pass('Total time <500ms — excellent (was 3000-4000ms on D1)');
    else if (totalMs < 1500) info(`Total time ${totalMs}ms — good, but check WATERFALL logs for per-query breakdown`);
    else fail(`Total time ${totalMs}ms — still slow, check Railway logs for [WATERFALL] output`);
  } else if (res.status === 409) {
    info('Order was already completed — that is fine for timing purposes');
  } else {
    fail(`Unexpected status ${res.status}: ${JSON.stringify(res.body)}`);
  }

  info('Check Railway backend logs for [WATERFALL] lines to see individual query latencies');
  info('Expected: each query <5ms (vs ~400ms on D1 REST API)');
}

// ─── Test 2: Full Sale Lifecycle ──────────────────────────────────────────────

async function testFullSaleLifecycle() {
  header('Test 2: Full Sale Lifecycle (create → confirm → complete)');

  // Need a branch, customer, and product with stock
  const branchRes = await pool.query('SELECT id FROM branches LIMIT 1');
  const custRes   = await pool.query('SELECT id FROM customers LIMIT 1');
  const stockRes  = await pool.query(
    `SELECT product_id FROM inventory_stock WHERE quantity_on_hand >= 5 AND owner_type = 'BRANCH' LIMIT 1`
  );

  if (!branchRes.rows[0] || !custRes.rows[0] || !stockRes.rows[0]) {
    info('Prerequisite data missing (branch/customer/stock) — skipping lifecycle test');
    info('Seed some test data via the UI then re-run');
    return;
  }

  const branchId  = branchRes.rows[0].id;
  const custId    = custRes.rows[0].id;
  const productId = stockRes.rows[0].product_id;

  info(`Branch: ${branchId} | Customer: ${custId} | Product: ${productId}`);

  // Create order
  const createRes = await api('POST', '/api/v1/sales/orders', {
    customer_id: custId,
    branch_id: branchId,
    notes: 'Phase 5 staging test',
    lines: [{ product_id: productId, quantity: 2, unit_price: 100 }],
  });

  if (createRes.status !== 201 && createRes.status !== 200) {
    fail(`Create order failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
    return;
  }

  const orderId = createRes.body.id || createRes.body.orderId;
  if (!orderId) { fail('Create order returned no ID'); return; }
  pass(`Created order ${orderId}`);

  // Confirm
  const confirmRes = await api('POST', `/api/v1/sales/orders/${orderId}/confirm`);
  if (confirmRes.status !== 200) {
    fail(`Confirm failed: ${confirmRes.status} ${JSON.stringify(confirmRes.body)}`);
  } else {
    pass('Order confirmed');
  }

  // Complete (invoice + pay in one step)
  const t0 = Date.now();
  const completeRes = await api('POST', `/api/v1/sales/orders/${orderId}/complete`);
  const completedMs = Date.now() - t0;

  if (completeRes.status !== 200) {
    fail(`Complete failed: ${completeRes.status} ${JSON.stringify(completeRes.body)}`);
    return;
  }
  pass(`Complete Sale returned 200 in ${completedMs}ms`);

  // Verify DB state
  const orderRow = await pool.query('SELECT status FROM sales_orders WHERE id = $1', [orderId]);
  const invoiceRow = await pool.query('SELECT status, total_amount FROM invoices WHERE sales_order_id = $1', [orderId]);
  const paymentRow = await pool.query('SELECT SUM(amount) AS paid FROM invoice_payments WHERE invoice_id = $1', [invoiceRow.rows[0]?.id]);

  if (orderRow.rows[0]?.status === 'PAID') pass("sales_orders.status = 'PAID'");
  else fail(`sales_orders.status = '${orderRow.rows[0]?.status}' (expected 'PAID')`);

  if (invoiceRow.rows[0]?.status === 'PAID') pass("invoices.status = 'PAID'");
  else fail(`invoices.status = '${invoiceRow.rows[0]?.status}' (expected 'PAID')`);

  const expectedTotal = 200; // 2 × 100
  const paid = parseFloat(paymentRow.rows[0]?.paid || '0');
  if (Math.abs(paid - expectedTotal) < 0.01) pass(`invoice_payments total = ${paid} ✓`);
  else fail(`invoice_payments total = ${paid} (expected ${expectedTotal})`);
}

// ─── Test 3: Transaction Rollback ─────────────────────────────────────────────

async function testTransactionRollback() {
  header('Test 3: Transaction Rollback (batch atomicity)');

  // Insert a journal entry with a deliberately bad FK on the last statement.
  // The good rows should NOT be committed if the batch fails.
  const client = await pool.connect();
  try {
    const testJeId = 'test-rollback-je-' + Date.now();
    await client.query('BEGIN');
    try {
      // Statement 1: valid insert into journal_entries
      await client.query(`
        INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, status, total_debit, total_credit, created_at, updated_at)
        VALUES ($1, 'JE-ROLLBACK-TEST', CURRENT_DATE, 'Rollback test', 'MANUAL', 'POSTED', 100, 100, NOW(), NOW())
      `, [testJeId]);

      // Statement 2: deliberately bad — references non-existent account_id
      await client.query(`
        INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit_amount, credit_amount, line_order)
        VALUES ($1, $2, 'DOES-NOT-EXIST-ACCOUNT', 'Should rollback', 100, 0, 1)
      `, ['test-jel-' + Date.now(), testJeId]);

      await client.query('COMMIT');
      fail('Transaction committed when it should have rolled back — FK constraint not enforced');
    } catch (err) {
      await client.query('ROLLBACK');
      info(`Rollback triggered as expected: ${err.message.slice(0, 80)}`);

      // Verify the journal entry was NOT committed
      const checkRes = await client.query('SELECT id FROM journal_entries WHERE id = $1', [testJeId]);
      if (checkRes.rows.length === 0) {
        pass('journal_entries row correctly absent after rollback — atomicity confirmed ✅');
      } else {
        fail('journal_entries row PERSISTED after rollback — transaction was NOT atomic!');
      }
    }
  } finally {
    client.release();
  }
}

// ─── Test 4: GL Balance Check ─────────────────────────────────────────────────

async function testGlBalance() {
  header('Test 4: GL Double-Entry Balance Check');

  const res = await pool.query(`
    SELECT
      je.id,
      je.description,
      SUM(jel.debit_amount) AS total_debit,
      SUM(jel.credit_amount) AS total_credit,
      ABS(SUM(jel.debit_amount) - SUM(jel.credit_amount)) AS imbalance
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    GROUP BY je.id, je.description
    HAVING ABS(SUM(jel.debit_amount) - SUM(jel.credit_amount)) > 0.01
    LIMIT 10
  `);

  if (res.rows.length === 0) {
    pass('All journal entries are balanced (debits = credits) ✅');
  } else {
    fail(`${res.rows.length} unbalanced journal entries found:`);
    for (const row of res.rows) {
      info(`  ID: ${row.id} | ${row.description} | imbalance: ${row.imbalance}`);
    }
  }

  // Also check the GL overall
  const overall = await pool.query(`
    SELECT
      SUM(debit_amount) AS total_debits,
      SUM(credit_amount) AS total_credits
    FROM general_ledger
  `);
  const d = parseFloat(overall.rows[0].total_debits || '0');
  const cr = parseFloat(overall.rows[0].total_credits || '0');
  info(`General Ledger totals — Debits: ${d.toFixed(2)} | Credits: ${cr.toFixed(2)}`);
  if (Math.abs(d - cr) < 0.01) pass('GL overall balanced ✅');
  else fail(`GL imbalance: ${Math.abs(d - cr).toFixed(2)}`);
}

// ─── Test 5: Concurrent CAS Test ─────────────────────────────────────────────

async function testConcurrentCas() {
  header('Test 5: Concurrent CAS (state-machine correctness under concurrency)');

  // Find a DRAFT order to use for the test
  const orderRes = await pool.query(
    `SELECT id FROM sales_orders WHERE status = 'DRAFT' LIMIT 1`
  );

  if (!orderRes.rows[0]) {
    info('No DRAFT orders found — creating one for the CAS test');
    // Try to find a suitable order in a compatible state
    const anyOrder = await pool.query(
      `SELECT id, status FROM sales_orders WHERE status NOT IN ('PAID') LIMIT 1`
    );
    if (!anyOrder.rows[0]) {
      info('No suitable orders available — skipping CAS test');
      info('Create a DRAFT order via the UI, then re-run this test');
      return;
    }
    info(`Using order ${anyOrder.rows[0].id} (status: ${anyOrder.rows[0].status})`);
  }

  const orderId = orderRes.rows[0]?.id || (await pool.query(
    `SELECT id FROM sales_orders WHERE status NOT IN ('PAID') LIMIT 1`
  )).rows[0]?.id;

  if (!orderId) { info('Skipping CAS test — no orders available'); return; }

  // Reset order to DRAFT so we start clean
  await pool.query(`UPDATE sales_orders SET status = 'DRAFT' WHERE id = $1`, [orderId]);
  info(`Reset order ${orderId} to DRAFT`);

  // Fire 10 parallel complete requests
  const CONCURRENCY = 10;
  info(`Firing ${CONCURRENCY} concurrent POST /complete requests for order ${orderId}...`);

  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      api('POST', `/api/v1/sales/orders/${orderId}/complete`)
        .then(r => ({ i, status: r.status, body: r.body }))
        .catch(err => ({ i, status: 0, error: err.message }))
    )
  );

  const successes = results.filter(r => r.status === 200);
  const conflicts = results.filter(r => r.status === 409);
  const errors    = results.filter(r => r.status !== 200 && r.status !== 409);

  info(`Results: ${successes.length} × 200, ${conflicts.length} × 409, ${errors.length} × other`);

  if (successes.length === 1) {
    pass('Exactly 1 request succeeded — CAS lock working correctly ✅');
  } else if (successes.length === 0) {
    fail('Zero requests succeeded — CAS may be over-rejecting or there was a stock/invoice issue');
  } else {
    fail(`${successes.length} requests succeeded — duplicate completion! CAS lock NOT working`);
  }

  if (errors.length > 0) {
    for (const e of errors) info(`  Request ${e.i}: status ${e.status} — ${JSON.stringify(e.body || e.error)}`);
  }

  // Final DB state check
  const finalOrder = await pool.query('SELECT status FROM sales_orders WHERE id = $1', [orderId]);
  info(`Final order status: ${finalOrder.rows[0]?.status}`);
  if (finalOrder.rows[0]?.status === 'PAID') pass('Order is PAID — exactly one winner ✅');
  else fail(`Order status is '${finalOrder.rows[0]?.status}' after concurrent test`);
}

// ─── Run all tests ────────────────────────────────────────────────────────────

async function main() {
  console.log('🧪 Al Hayat ERP — Phase 5 Staging Validation Suite');
  console.log(`🔗 API: ${API_BASE}`);
  console.log(`🐘 PG:  ${DATABASE_URL.replace(/:\/\/.*@/, '://***@')}`);

  try {
    await testWaterfallTiming();
    await testFullSaleLifecycle();
    await testTransactionRollback();
    await testGlBalance();
    await testConcurrentCas();

    console.log('\n' + '━'.repeat(60));
    console.log('Phase 5 complete. Review results above before Phase 6.');
    console.log('━'.repeat(60));
  } catch (err) {
    console.error('\n❌ Unexpected error during staging validation:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
