# Al Hayat ERP+WMS — Production Audit Report

**Audit date:** 2026-10-19  ·  **Code audited:** `origin/main` at `cc1bd1a` (plus the fixes in this change set)
**Companion documents:** [BRANCH_ACCOUNTING.md](BRANCH_ACCOUNTING.md) · [AUDIT_CHECKLIST.md](AUDIT_CHECKLIST.md) · [ACCOUNTING_RECONCILIATION.md](ACCOUNTING_RECONCILIATION.md) · [SECURITY_AND_PRODUCTION_READINESS.md](SECURITY_AND_PRODUCTION_READINESS.md) · [reconciliation_queries.sql](reconciliation_queries.sql)

---

## 1. Executive summary

The ERP's core flows work in the happy path, but the audit found **systemic integrity defects** where a business record and its accounting or stock effect could diverge. The four recurring causes:

1. **Ledger postings outside the business transaction, with errors swallowed.** A sale, payment, debt, expense or work order could commit while its journal entry failed silently, or the reverse.
2. **No protection against double-submits or concurrent requests.** Payments, receipts, transfers, cancellations and work orders could be applied twice.
3. **Mismatched idempotency keys and report filters.** These made correct postings disappear, and incorrect ones appear, in the ledger and reports.
4. **Destructive deletes of financial history.** Invoiced orders, customers with debts, and products with movements could be deleted.

The most serious items:

| ID | Severity | What happened in production code |
|----|----------|----------------------------------|
| ACC-01 | **P0** | Opening the Accounting dashboard (`GET /accounting/dashboard`) **posted journal entries**. It re-posted a customer cash receipt for every PAID order whose payment was taken through the payment screens, double-counting cash and understating receivables. |
| SEC-01 | **P0** | Every backend restart/deploy **reset `admin@alhayat.com`'s password** to the seeded hash. The public repository documented that password in a comment. |
| SEC-07 | **P0 (unverified)** | If `JWT_ACCESS_SECRET` is not set on Railway, the API signs and accepts tokens with a secret printed in the public repository. Anyone could then mint an admin token. **I could not check Railway's variables.** |
| ACC-02 | P1 | Manually reversed journal entries were reported as *negative* amounts (the original was dropped, the reversal kept). Reversals also had no general-ledger rows. |
| ACC-08 | P1 | Manufacturing completion was never journaled (idempotency-key collision), so Work-in-Progress grew forever. |
| INV-01/02/03 | P1 | Cancelling a confirmed order created stock from nothing. Cancelling a bundle restored the bundle instead of its parts. A double cancel restored stock twice. |
| SAL-01 | P1 | Any sales user could hard-delete an invoiced, paid order (invoice and payments erased, with no stock or ledger reversal). |

**What was done:**
- 30 defects are fixed in code (plus SAL-00, fixed and pushed earlier in `cc1bd1a`).
- 26 of the 30 are confirmed by 28 regression tests that **fail on the production code and pass with the fixes** (5 pass / 28 fail before → 33 pass / 0 fail after).
- **Branch-specific accounting** (follow-up task): every branch has its own books inside the single ledger. Admins and accountants get a consolidated view with a branch filter, branch users are isolated server-side, and new finding ACC-26 is fixed. 19 new tests (2/17 pass/fail before → 19/19). Details: [BRANCH_ACCOUNTING.md](BRANCH_ACCOUNTING.md).
- DB-01 and OPS-01 are verified by direct execution.
- INV-04 (oversell race; it did not interleave in-process) and ACC-11 are fixed on code evidence.
- Read-only reconciliation queries are provided to measure historical damage in the production database.
- Riskier remediations and policy decisions are documented with plans, not changed.

**Production-readiness verdict:** not yet. The fixes remove the confirmed corruption paths, but these remain open:
- branch isolation outside finance (transfers, stock, deliveries) and the "no branch = all branches" rule (SEC-05/06 remainder)
- the JWT secret check (SEC-07)
- the cancellation/refund policy (ACC-15)
- floating-point money (ACC-20)
- the absence of migrations, CI and verified backups (OPS-02)

Historical data in production is likely affected by ACC-01, ACC-02, ACC-04, ACC-08 and the race conditions, and must be measured with the reconciliation queries before anything is repaired.

---

## 2. Methodology

1. **Architecture mapping** from the real repository (not the outdated README). See §3.
2. **Static trace** of each important workflow: UI → API route → validation → business logic → DB adapter → stock and ledger side effects → response. Every backend route file was read; the accounting service and the sales, purchasing, transfers, manufacturing, expenses, inventory, auth, users, branches, deliveries and audit routes were read end to end.
3. **Executable verification against real PostgreSQL 17** (a disposable local server, never production). The test harness (`backend/tests/helpers.ts`):
   - creates a fresh database per test file
   - bootstraps it with **the same startup migration production runs** (`ensurePostgresInit`)
   - drives the **real Hono app** through `app.request`, with signed JWTs
   - refuses any host other than `localhost`
4. **Before/after evidence.** The same suite was run against the untouched production code (`origin/main`, patched only with the two missing columns from DB-01 so payments could run) and against the fixed code.
5. **Severity** is by realistic impact and likelihood. **Confidence:**
   - **Confirmed:** reproduced by a test or by direct execution.
   - **Probable:** clear from code, but not reproduced.
   - **Unverified:** depends on production state I cannot see.

**Not done** (no access, or out of scope): production database, Railway and Cloudflare dashboards, live UI end-to-end testing, the mobile app, the ecommerce app, load testing, dependency CVE scanning against the advisory database (see SECURITY doc §6).

---

## 3. Architecture (as actually deployed)

| Layer | Technology | Where | Evidence |
|---|---|---|---|
| Web ERP | React 18 + Vite, react-router, Recharts, SweetAlert2 | Cloudflare Pages project `al-hayat-erp` (`npm run deploy:web` → `wrangler pages deploy`) | Live bundle calls `al-hayat-erp-wms-production.up.railway.app/api/v1` (`web/.env.production`) |
| API | Hono on Node via `tsx` (`backend/src/server.ts`), `pg` pool | Railway service `al-hayat-erp-wms`, auto-deploys from GitHub `main` (path filter `backend/**`) | `/api/v1/health` → `dbEngine: postgres`; Railway shows deploys "via GitHub" |
| Database | PostgreSQL | Railway, private host `postgres.railway.internal` | `DATABASE_URL` read in `backend/src/index.ts` |
| Schema management | `ensurePostgresInit()` runs DDL + seed + data backfills **on every boot** | `backend/src/init-postgres.ts` | No migration tool or versioning |
| DB adapter | D1-compatible shim over `pg` (`prepare/bind/first/all/run/batch`), SQLite→PG SQL rewriting | `backend/src/pg-client.ts` | `batch()` is a real `BEGIN … COMMIT` transaction on one connection (verified) |
| Auth | JWT HS256 (15 min) + rotating refresh tokens (hashed in DB), bcrypt; permission codes embedded in the token; `password_version` revocation with a 5-minute in-memory cache | `routes/auth.ts`, `middleware/auth.ts` | |
| Mobile / ecommerce | Expo WMS app; Next.js storefront | `mobile/`, `ecommerce/` | Not audited |
| Retired | `workers-api/` (Cloudflare Workers + D1) | removed from git; untracked leftovers may remain on disk | |

**Backend modules (18 routers):** auth, users, branches, warehouses, products, inventory, transfers, purchasing, sales (customers, debts, payments, orders, invoices), deliveries, manufacturing, expenses, assets (properties, tenants, leases, livestock), accounting, reports, audit, notifications, files. **Shared services:** `accounting-service.ts` (posting engine, chart-of-accounts cache, COGS, reversals, backfills), `audit.ts`.

**Posting model:** perpetual inventory with COGS at sale.
- **Sale:** Dr AR (1020) / Cr Revenue (4010) + Cr Installation Payable (2050). Dr COGS (5010) / Cr Inventory (1030), using the weighted average cost of all goods receipts (fallback: product cost).
- **Payment:** Dr Cash (1010) / Cr AR.
- **Goods receipt:** Dr Inventory / Cr AP (2010).
- **Supplier payment:** Dr AP / Cr Cash.
- **Expense:** Dr 6010/6050 / Cr Cash or AP.
- **Stock adjustment:** Dr/Cr Inventory vs Inventory Gain (5030) / Loss (5020).
- **Manufacturing:** WIP (1070).
- **Transfers:** no ledger effect (same legal entity).

Idempotency key: `(reference_type, reference_id)` of a POSTED entry.

---

## 4. Findings

Status legend: **FIXED** = code changed and the regression test passes · **OPEN** = documented, not changed · Confidence as in §2.

### 4.1 Accounting

| ID | Sev | Conf | Status | Finding | Location |
|---|---|---|---|---|---|
| ACC-01 | P0 | Confirmed | FIXED | `GET /accounting/dashboard` ran `reconcileMissingSalesJournalEntries` on every view. For PAID orders it looked for a payment journal keyed `<order>-pay`, but the payment screens key payments by payment id. It therefore posted a **duplicate Dr Cash / Cr AR** for the full invoice (test: 3 entries instead of 2; cash 300 vs 250). The explicit `POST /reconcile-journals` had the same flaw. **Fix:** the dashboard is read-only; the backfill checks every key a payment can be journaled under. | `routes/accounting.ts` (dashboard), `services/accounting-service.ts` (`reconcileMissingSalesJournalEntries`) |
| ACC-02 | P1 | Confirmed | FIXED | Manual reversal set the original to `REVERSED`, which every report filters out, while the reversal stayed `POSTED`. Reports therefore showed **minus** the original (test: −300 instead of 0). The reversal also had no `general_ledger` rows, and its header was written outside the batch. **Fix:** reports count `POSTED` + `REVERSED` (which also corrects historical reversals with no data change); reversal is atomic and has GL rows via the shared `prepareJournalReversal`. | `routes/accounting.ts`, `accounting-service.ts` |
| ACC-03 | P2 | Confirmed | FIXED | Income statement COGS section filtered `account_type = 'COGS'`, but the startup migration forces 5010 to `EXPENSE`, so COGS was always 0 and gross profit equalled revenue. **Fix:** COGS = 5xxx expense accounts (same rule the dashboard uses). | `routes/accounting.ts` |
| ACC-04 | P1 | Confirmed | FIXED | `POST /orders/:id/invoice` posted the sale journal **after** committing the invoice and stock issue. A posting failure left the invoice and stock committed, the order reset to CONFIRMED, and no journal. It also omitted the installation fee from AR (test: 200 vs 225), so fee payments drove AR negative. **Fix:** journal in the same batch; fee included. | `routes/sales.ts` |
| ACC-05 | P1 | Confirmed | FIXED | `/complete` on an INVOICED order recorded the remaining payment **with no ledger entry** (test: cash +0 instead of +80) and had no double-submit guard. `/pay` posted after commit. Both excluded the installation fee. **Fix:** shared `prepareInvoiceSettlement` — payment row, journal and guarded status change in one transaction. | `routes/sales.ts` |
| ACC-06 | P1 | Confirmed | FIXED | Editing an expense's amount/category/date/method, or deleting it, never touched the ledger (test: ledger kept 500 after an edit to 450 and after deletion). **Fix:** edit reverses and re-posts; delete reverses, in the same transaction. | `routes/expenses.ts` |
| ACC-07 | P1 | Confirmed | FIXED | A posting dated inside a CLOSED period silently fell back to "any open period", so closing a period protected nothing. **Fix:** a closed or locked period covering the date rejects the posting (409). | `accounting-service.ts` (`fetchOpenFiscalPeriodId`) |
| ACC-08 | P1 | Confirmed | FIXED | Work-order consumption and completion journals shared the key `('MANUFACTURING', wo.id)`, so completion was **always skipped** (WIP never relieved: 50 vs 0). Errors were swallowed with `.catch(() => {})`. **Fix:** completion has its own key and both post atomically. | `routes/manufacturing.ts` |
| ACC-09 | P1 | Confirmed | FIXED | Starting a work order without enough material clamped stock at 0 (`GREATEST(0, …)`) yet journaled the full material cost. No guard against a double start. **Fix:** rejects shortages (400); guarded decrement and status claim. | `routes/manufacturing.ts` |
| ACC-10 | P1 | Confirmed | FIXED | `POST /sales/payments`: accepted payments above the balance (excess absorbed silently, AR credited in full) and payments on CANCELLED invoices. A double-submit recorded both payments. The journal was posted after commit with errors swallowed. **Fix:** balance and status checks, row lock + re-check, journal in the same transaction. | `routes/sales.ts` |
| ACC-11 | P1 | Probable | FIXED | Manual customer charge: debt committed, journal posted after commit with errors swallowed. **Fix:** same transaction. | `routes/sales.ts` |
| ACC-12 | P1 | Confirmed | FIXED | Credit sale: journal posted after commit with errors swallowed. A walk-in credit sale with a deposit marked the invoice PAID/PARTIALLY_PAID without an `invoice_payments` row (test: 0 vs 100), while the ledger posted the cash. **Fix:** atomic; the deposit is always recorded. | `routes/sales.ts` |
| ACC-13 | P2 | Confirmed | FIXED | Stock adjustment valued zero-cost products at an **invented 10/unit** (test: +20 to inventory), and posted after commit. **Fix:** actual cost only, same transaction. | `routes/inventory.ts`, `accounting-service.ts` |
| ACC-14 | P1 | Confirmed | FIXED | Double-submitted supplier payment was recorded twice (supplier paid 200 against a 100 invoice). **Fix:** row lock + balance re-check. | `routes/purchasing.ts` |
| ACC-15 | P1 | Confirmed (by reading) | OPEN | **Cancellation/refund policy is undefined.** Cancel reverses the sale journal and checkout-time payment journals (keyed to the invoice id), but not payments taken later (keyed to payment ids). The cancelled invoice and its payments then drop out of the customer's balance, so money the customer paid is neither refunded nor shown as credit. Decision needed: refund (Dr AR/Cr Cash + refund record) vs store credit (keep as unallocated payment). | `routes/sales.ts` cancel |
| ACC-16 | P2 | Confirmed | FIXED | `general_ledger` was a physical copy of every journal line plus a stored `running_balance`, computed read-then-write. The copy drifted: the stored balance was company-wide, so branch-scoped ledgers showed other branches' money; concurrent postings or two lines on one account read the same prior balance; depreciation wrote its rows by hand (balance = amount) and saved its entry header outside the transaction. | `init-postgres.ts`, `accounting-service.ts`, `routes/accounting.ts` | **Fix:** `journal_entry_lines` is the single source of truth. `general_ledger` is now a VIEW over POSTED/REVERSED lines; the ledger endpoint computes running balances with a window function inside the caller's branch scope (a date window carries the balance forward). The old table is renamed `general_ledger_legacy` on boot (kept, not dropped). Posting a draft is a guarded status change (double-post = 409). Depreciation posts through the standard engine, atomically. Tests: `tests/general-ledger.test.ts`.
| ACC-17 | P2 | Confirmed (by reading) | OPEN | Manufacturing labor is never journaled (no labor/payroll account), and work-order completion overwrites the product's global `cost_price`. | `routes/manufacturing.ts` |
| ACC-18 | P2 | Confirmed | OPEN | Opening stock entered at product creation or bulk import creates stock with **no movement row and no journal**. Stock valuation ≠ ledger 1030, and the movement history doesn't explain balances (reconciliation R7/R8). Recommend an "opening balance" posting (Dr 1030 / Cr Owner's Capital 3010) behind an explicit policy decision. | `routes/products.ts` |
| ACC-19 | P2 | Confirmed (by reading) | OPEN | Mixed costing: COGS uses all-time weighted receipt cost; adjustments use `products.cost_price`; manufacturing overwrites `cost_price`. | service / routes |
| ACC-20 | P2 | Confirmed (by reading) | OPEN | Money is `DOUBLE PRECISION` everywhere, with tolerance comparisons (±0.001). Migrating to `NUMERIC(14,2)` is a schema change; see the plan in ACCOUNTING_RECONCILIATION §6. | schema |
| ACC-21 | P2 | Confirmed (by reading) | PARTIALLY FIXED | Manual journal creation is now atomic and single-branch, and posting assigns the fiscal period and refuses closed periods. Still open: negative amounts / lines with both debit and credit are accepted; entry numbers come from `COUNT(*)+1` (collide under concurrency); separation of duties (`manage_purchasing`). |
| ACC-22 | P2 | Confirmed | PARTIALLY FIXED | Year-end closing is now per branch, atomic, refuses a non-OPEN period, closes contra balances and period-less entries, and locks the period (test). Depreciation still posts outside the transaction, swallows errors, and stores a running balance equal to the amount. |
| ACC-23 | P2 | Confirmed (by reading) | OPEN | Assets module: every posting uses `reference_type MANUAL` (no idempotency, retries duplicate), postings are outside the transaction, a property can be sold twice, the sale gain goes to Rental Income (4020), and deleting a property erases its rental payments and expenses while the journals remain. | `routes/assets.ts` |
| ACC-24 | P2 | Confirmed (by reading) | OPEN | Operational revenue ≠ ledger revenue in reports. Sales/branch reports count CONFIRMED orders that have no invoice. `GET /branches` revenue excludes DELIVERED orders because delivery overwrites `sales_orders.status` (payment and fulfilment share one status column). | `routes/reports.ts`, `routes/branches.ts` |
| ACC-25 | P2 | Confirmed (by reading) | OPEN | `getInvoicePaymentSummary` (order detail, `/invoices/:id/payments`) excludes the installation fee, while customer balances include it. | `routes/sales.ts` |
| ACC-26 | P2 | Confirmed | FIXED | Manually posted journals got no fiscal period, so period closing never closed them (left a balance in 6050 in the live UI check). Posting now assigns the period covering the entry date; closing also includes period-less entries dated in the period (test: closing zeroes 6050 in both branches). | `routes/accounting.ts` |

### 4.2 Sales, inventory, purchasing, transfers

| ID | Sev | Conf | Status | Finding | Location |
|---|---|---|---|---|---|
| SAL-00 | P0 | Confirmed | FIXED (`cc1bd1a`, already pushed) | `/complete` rollback `UPDATE sales_orders SET status = ?` had no `WHERE`, which reset every order's status. | `routes/sales.ts` |
| SAL-01 | P1 | Confirmed | FIXED | `DELETE /sales/orders/:id` hard-deleted the invoice, its lines and its payments (any `manage_sales` user), with no stock or ledger reversal. **Fix:** refused when an invoice exists; cancel instead. | `routes/sales.ts` |
| INV-01 | P1 | Confirmed | FIXED | Cancelling a CONFIRMED (never invoiced, never deducted) order **added** stock (test: 8 vs 5). | `routes/sales.ts` cancel |
| INV-02 | P1 | Confirmed | FIXED | Cancelling a bundle (GROUPED) sale restored the bundle product instead of its components (components 0 vs 8). **Fix:** restore exactly what the inventory ledger shows was issued. | same |
| INV-03 | P1 | Confirmed | FIXED | Two concurrent cancels both succeeded (double restore, double reversal). The ledger reversal ran after commit with errors swallowed. **Fix:** guarded status claim; reversal in the same transaction. | same |
| INV-04 | P1 | Probable | FIXED | Sales stock issue was check-then-decrement (TOCTOU), so concurrent sales could oversell. The race did not interleave in-process (the test passed before the fix). **Fix:** guarded decrement `quantity_on_hand >= qty` (409 on conflict) in credit sale, `/invoice` and `/complete`. | `routes/sales.ts` |
| INV-05 | P1 | Confirmed | FIXED | Transfer dispatch/receive had no state claim: a double receipt added stock twice (reproduced); dispatch had the same pattern. **Fix:** guarded status claims + guarded source decrement. | `routes/transfers.ts` |
| INV-06 | P1 | Confirmed | FIXED | A double-submitted goods receipt over-received the PO (stock and AP doubled). **Fix:** guarded `quantity_received + qty <= quantity`. | `routes/purchasing.ts` |
| INV-07 | P2 | Confirmed | FIXED | Bulk import: a row with an existing SKU was counted as "created". With initial stock, the whole import failed with a raw FK error (500). Rows missing SKU/name vanished silently. **Fix:** pre-checked and reported in `skipped` (207). | `routes/products.ts` |
| INV-08 | P1 | Confirmed | FIXED | Product delete erased its movement history and the lines of DRAFT/INVOICED/DELIVERED/cancelled orders and of SUBMITTED/partially received POs. **Fix:** refused when there is any stock or history; deactivate instead. | `routes/products.ts` |
| INV-09 | P2 | Probable | OPEN | `inventory_stock` has no uniqueness constraint (nullable key columns), so duplicate rows for one product/location are possible, and keyed updates change all of them. Run reconciliation R9; add a unique index only after cleanup. | schema |
| INV-10 | P3 | Confirmed (by reading) | OPEN | No stock reservation for DRAFT/CONFIRMED orders (`quantity_reserved` unused). | — |
| INV-11 | P3 | Confirmed (by reading) | OPEN | Transfers: the requester can approve their own transfer; dispatch is allowed straight from PENDING_APPROVAL. | `routes/transfers.ts` |
| PUR-01 | P2 | Confirmed (by reading) | OPEN | PO and sales line discounts are not validated (negative, or above the line gross). The client-supplied sales unit price is accepted without a floor or approval. | `purchasing.ts`, `sales.ts` |
| PUR-02 | P2 | Confirmed (by reading) | OPEN | No PO cancellation or purchase return. Supplier payments are allowed before receipt (AP goes to a debit balance, which is acceptable only as a prepayment). | `routes/purchasing.ts` |
| DEL-01 | P1 | Confirmed | FIXED | Completing a delivery whose order was cancelled set the order back to DELIVERED (resurrecting it in reports). Dispatch/complete had no state checks. **Fix:** guard on delivery and order status; never overwrite CANCELLED. | `routes/deliveries.ts` |
| SAL-02 | P3 | Confirmed (by reading) | OPEN | Customer and order lists silently cap at 200 rows (`LIMIT 200`, no pagination). | `routes/sales.ts`, `purchasing.ts` |

### 4.3 Security and access control

Details and remediation plans are in [SECURITY_AND_PRODUCTION_READINESS.md](SECURITY_AND_PRODUCTION_READINESS.md).

| ID | Sev | Conf | Status | Finding |
|---|---|---|---|---|
| SEC-01 | P0 | Confirmed | FIXED (code); **action needed** | Boot-time seed upsert reset the admin password, version and active flag on every restart; the password was documented in the public repo. **The production admin password must be changed after this fix is deployed** (before it, a restart would revert the change). |
| SEC-07 | P0 | Unverified | OPEN | JWT secrets fall back to public development strings when the env vars are missing. Verify on Railway; then make startup fail closed. |
| SEC-05 | P1 | Confirmed | PARTIALLY FIXED | Branch isolation is now enforced server-side for **all accounting endpoints, receivables, payments, expenses and every sales order/invoice action** (tests in `branch-accounting.test.ts`, `security.test.ts`). Still open: transfers approve/dispatch/receive, stock adjustments for another branch, deliveries. |
| SEC-06 | P1 | Confirmed | PARTIALLY FIXED | `isAdminUser()` treats any user with `branch_id = NULL` as all-branch. **Finance, receivables, sales and expenses** now use the strict scope (no branch + no admin/accountant role → 403) and live database scope instead of token claims. The old rule remains for transfers, stock and warehouse features (warehouse managers have no branch). See BRANCH_ACCOUNTING §7. |
| SEC-03 | P1 | Confirmed | FIXED | Deleting a branch set its users' `branch_id = NULL`, which escalated them to all-branch scope. Now refused while users are assigned. |
| SEC-04 | P1 | Confirmed | FIXED | Deleting a customer cascade-deleted their debts and payments while the journals remained. Now refused when any financial history exists; deletion is audited. |
| SEC-02 | P2 | Confirmed | FIXED | Users with zero permissions could read the full audit log (`&& permissions.length > 0` bypass). |
| SEC-08 | P2 | Confirmed (by reading) | OPEN | No login rate limiting or lockout; `bcrypt.compareSync` blocks the event loop. |
| SEC-09 | P3 | Confirmed (by reading) | OPEN | CORS `origin: *` with `credentials: true` (bearer tokens limit the impact; tighten to the Pages origin). |
| SEC-10 | P2 | Confirmed (by reading) | OPEN | Notifications: any user can create a notification for any user and delete anyone's notification. |
| SEC-11 | P3 | Confirmed (by reading) | OPEN | Files module is non-functional on Railway (`STORAGE` binding is undefined), so uploads throw 500. |
| SEC-12 | P2 | Confirmed (by reading) | OPEN | `PATCH /users/:id` wipes `phone`, `branch_id` and `warehouse_id` when they are omitted (the UI sends all fields; direct API callers don't). Combined with SEC-06 this can widen access. |
| SEC-13 | P2 | Confirmed (by reading) | OPEN | Raw database error messages are returned to clients (e.g. FK violation text). |
| SEC-14 | P2 | Confirmed (by reading) | OPEN | Stored XSS in print views: Sales, Purchasing, Customers and Deliveries pages `document.write` unescaped product/customer/supplier names into a same-origin window, which can read stored tokens. |

### 4.4 Database, operations, frontend

| ID | Sev | Conf | Status | Finding |
|---|---|---|---|---|
| DB-01 | P2 | Confirmed | FIXED | On a freshly built database, `POST /sales/payments` failed (`invoices.updated_at` missing), and `warehouse_locations.barcode` was missing too. Added additive `ADD COLUMN IF NOT EXISTS` migrations. |
| DB-02 | P2 | Confirmed (by reading) | OPEN | The startup migration rewrites data on **every boot**: purchase-invoice totals are recomputed from PO lines and PO statuses are re-derived, with no versioning. All DDL and backfills run in one statement block; if any statement fails, the whole init (including seeds) is skipped and only logged. |
| DB-03 | P3 | Confirmed | OPEN | `backend/package-lock.json` is out of sync with `backend/package.json` (`npm ci` fails), so builds resolve unpinned versions. |
| DB-04 | P2 | Confirmed (by reading) | OPEN | Destructive scripts in the repo (`schema_pg.sql` begins with `DROP TABLE … CASCADE`; `db:wipe`) run against whatever `DATABASE_URL` is set. |
| OPS-01 | P3 | Confirmed | FIXED | `npm run typecheck` failed (stale `@cloudflare/workers-types` reference); added `npm test`. |
| OPS-02 | P1 | — | OPEN | No CI, no automated tests in CI, no migration tool, no verified backups or restores, the health check does not touch the database, and per-request `[WATERFALL]` debug logging is always on. See SECURITY doc. |
| FE-01 | P3 | Confirmed (by reading) | OPEN | Payment and receipt forms rely only on a disabled button against double-submits. The server now enforces it (ACC-10/14, INV-05/06). |
| FE-02 | — | Confirmed | RESOLVED | The web app builds in `C:al-hayat-erp-wms` (`vite build` succeeds; 0 type errors apart from missing third-party `@types`). The earlier failure was the OneDrive copy's outdated `node_modules`. |

---

## 5. Changes made (this change set)

**Branch accounting change set (second pass):**
- `services/branch-scope.ts` (new): strict branch scope.
- `middleware/auth.ts`: live database scope.
- Scoped: the accounting, sales, expenses and reports routes.
- `transfers.ts`: inter-branch clearing journals.
- `init-postgres.ts`: `customer_payments.branch_id`, account 1090, line-branch trigger, provable-only backfill.
- `AccountingPage.tsx`: branch selector.
- New tests: `tests/branch-accounting.test.ts`.

Full description in [BRANCH_ACCOUNTING.md](BRANCH_ACCOUNTING.md).

**First pass:**

**Shared primitive.** `PgPreparedStatement.mustAffect(message)` (`pg-client.ts`): inside `batch()`, a statement that affects or returns zero rows rolls back the whole transaction with a `ConflictError`, which the API returns as **HTTP 409**. All state-machine claims, guarded stock decrements and payment re-checks use it. The error handler maps it in `index.ts`.

**Posting engine.**
- `prepareJournalReversal` replaces the non-atomic `reverseJournalEntry`.
- `prepareSaleJournalEntry`, `prepareCustomerPaymentJournalEntry`, `prepareExpenseJournal` and `prepareInventoryAdjustmentJournalEntry` return statements for the caller's transaction.
- `calculateLinesCogs` prices lines before they are saved, without swallowing errors.
- `skipIdempotency` allows re-posting after a reversal in the same batch.
- Four dead posters are removed: two manufacturing, two purchase.

**Files touched:** `pg-client.ts`, `index.ts`, `init-postgres.ts`, `schema_pg.sql` (comment), `accounting-service.ts`, and the accounting, audit, branches, deliveries, expenses, inventory, manufacturing, products, purchasing, sales and transfers routes; plus `tsconfig.json` and `package.json`. New: `backend/tests/` (34 tests), `docs/audit/`.

**Behavior changes users will notice (intended):**
- Invoiced orders can't be deleted (cancel them).
- Products with history and customers with financial history can't be deleted (deactivate or keep them).
- Branches with assigned users can't be deleted.
- Over-payments are rejected.
- Postings into closed periods are rejected.
- Work orders need materials on hand to start and must be IN_PROGRESS to complete.
- Concurrent duplicate actions return 409 with a "please refresh" message.

**Not changed:** the frontend, mobile, ecommerce, data in any database, and the deployment configuration.

---

## 6. Verification

```bash
cd backend && npm run typecheck
```
Result: passes (0 errors).

```bash
cd backend && TEST_DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/postgres npm test
```
Result (after branch accounting): **53 tests, 53 pass, 0 fail, 0 todo**. First audit pass: 34 tests, 33 pass, 1 todo; against the production code: 5 pass, 28 fail. Branch accounting suite against the code before that change: 2 pass, 17 fail.

The test server must be a local, disposable PostgreSQL. The harness refuses non-local hosts and creates and drops its own databases.

Reconciliation SQL: all 16 queries execute read-only on test databases. On data produced by the fixed code, every defect query returns 0 rows. A positive control (an injected ACC-01-style duplicate) is flagged by R3 and R4.

---

## 7. Prioritized outstanding actions

1. **Today:**
   - Deploy this change set (push `main`).
   - **Then change the `admin@alhayat.com` password** (SEC-01).
   - Verify `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are set to long random values on Railway (SEC-07).
   - Rotate the Postgres password that was shared in chat.
2. **Measure the damage:** run [reconciliation_queries.sql](reconciliation_queries.sql) against production (read-only) and review R3/R4 (duplicate cash), R5 (installation-fee AR), R10 (reversals), R11 (WIP), R12 (expenses), R13–R15 (over-payments, over-receipts, restores). Repair only with approved correcting journal entries (ACCOUNTING_RECONCILIATION §5).
3. **Decide policies:** cancellation refund vs store credit (ACC-15); opening-stock valuation (ACC-18); labor costing (ACC-17).
4. **Branch isolation outside finance** (SEC-05 remainder: transfers, stock adjustments, deliveries, stock reports) and replacing `isAdminUser()`'s "no branch = all branches" rule (SEC-06) once warehouse-scoped roles are decided. Also escape the print views (SEC-14). Finance and sales are done: see [BRANCH_ACCOUNTING.md](BRANCH_ACCOUNTING.md).
5. **Operational hardening:** CI running typecheck and tests; a migration tool with versioned migrations (and stopping boot-time data rewrites, DB-02); a database-aware health check; turning off `[WATERFALL]` logs; verified backups and a restore drill (SECURITY doc).
6. **Data model:** NUMERIC money (ACC-20); `inventory_stock` uniqueness (INV-09); separate `payment_status` and `fulfillment_status` (ACC-24).
