# Audit Checklist — module by module

**Audit date:** 2026-10-19 · Findings are referenced by ID from [AUDIT_REPORT.md](AUDIT_REPORT.md).

**Status definitions**
- **PASS:** verified by evidence (an executed test or direct execution).
- **FAIL:** a reproducible or code-evident defect exists and remains open.
- **PARTIAL:** some cases verified; others not.
- **NOT TESTED:** no sufficient verification was performed.

"Fixed" means the defect was reproduced, fixed, and the regression test now passes. Coverage is **inspected** (code read end to end), **skimmed** (structure and key queries only) or **not inspected**.

## Backend (18 routers + shared layers)

| # | Module | Coverage | Verified by tests | Status | Notes / findings |
|---|---|---|---|---|---|
| 1 | DB adapter `pg-client.ts` | inspected | yes (every test) | PASS | `batch()` is one real transaction; `mustAffect` guard added. SQL rewriting `?`→`$n` assumes no `?` in literals (true today). |
| 2 | Startup migration `init-postgres.ts` | inspected | yes (fresh DB bootstrap, restart test) | PARTIAL | SEC-01 and DB-01 fixed. DB-02 open (boot-time data rewrites, no versioning). |
| 3 | Auth / middleware | inspected | indirect (JWT + password-version path in every test) | PARTIAL | Rotation and reuse detection OK. SEC-07 unverified, SEC-08 open. |
| 4 | Users | inspected | no | FAIL | SEC-12 (PATCH wipes omitted fields), SEC-06. |
| 5 | Branches | inspected (CRUD, credentials) | yes (delete) | PARTIAL | SEC-03 fixed. Revenue figure excludes DELIVERED (ACC-24). |
| 6 | Warehouses | skimmed | no | NOT TESTED | CRUD/locations not exercised. |
| 7 | Products (create, bulk import, delete, status) | inspected (PATCH skimmed) | yes | PARTIAL | INV-07, INV-08 fixed; ACC-18 open (opening stock has no movement or journal). |
| 8 | Inventory (stock, transactions, adjust) | inspected | yes | PARTIAL | ACC-13 fixed. Branch scoping of adjustments open (SEC-05). |
| 9 | Transfers | inspected | yes | PARTIAL | INV-05 fixed; INV-11 and SEC-05 open. |
| 10 | Purchasing (suppliers, PO, receipts, supplier payments) | inspected | yes | PARTIAL | INV-06, ACC-14 fixed; PUR-01/02 open. |
| 11 | Sales — orders/invoice/pay/complete/cancel/delete | inspected | yes | PARTIAL | ACC-04/05/12, INV-01–04, SAL-00/01 fixed; ACC-15, PUR-01, SEC-05 open. |
| 12 | Sales — customers, debts, payments, ledger | inspected | yes | PARTIAL | ACC-10/11, SEC-04 fixed; ACC-25, SAL-02 open. |
| 13 | Deliveries | inspected (create/dispatch/complete/runs) | yes | PARTIAL | DEL-01 fixed; ACC-24 (status conflation) open. |
| 14 | Manufacturing (start/complete) | inspected; BOM and advance-stage skimmed | yes | PARTIAL | ACC-08/09 fixed; ACC-17 open. |
| 15 | Expenses | inspected | yes | PARTIAL | ACC-06 fixed; branch scoping of edit/delete open. |
| 16 | Assets (properties, leases, livestock) | properties inspected; others skimmed | no | FAIL | ACC-23 open. |
| 17 | Accounting — posting engine | inspected | yes | PASS | Atomic prepare-variants, closed-period guard (ACC-07), reversals (ACC-02). |
| 18 | Accounting — journals, trial balance, income statement | inspected | yes | PARTIAL | ACC-02/03 fixed; ACC-21 open. |
| 19 | Accounting — balance sheet, cash flow, owners' equity | skimmed (status filters) | no | NOT TESTED | Cash-flow ending balance uses `running_balance` (ACC-16). |
| 20 | Accounting — closing entries, depreciation | inspected | no | FAIL | ACC-22 open. |
| 21 | Accounting — backfill / reconcile endpoints, dashboard | inspected | yes | PASS | ACC-01 fixed. Receipt backfill not exercised. |
| 22 | Reports | skimmed (status filters, receivables) | no | NOT TESTED | ACC-24 open. |
| 23 | Audit log route | inspected | yes | PASS | SEC-02 fixed. |
| 24 | Notifications | skimmed | no | FAIL | SEC-10 open. |
| 25 | Files | inspected | no | FAIL | SEC-11 (non-functional on Railway). |

## Cross-cutting

| Area | Status | Evidence |
|---|---|---|
| Transaction atomicity of multi-step writes | PARTIAL | Sales, payments, debts, expenses, adjustments, manufacturing, cancellation and reversal are now single transactions (tests). Assets, closing entries, depreciation, manual journal creation and installation payout are still not atomic. |
| Duplicate / concurrent requests | PARTIAL | Guarded: sales cancel, invoice settlement, customer and supplier payments, goods receipts, transfer dispatch/receive, work-order start/complete, sales stock issue (tests). Not guarded: asset postings, PO approve, deliveries create (pre-check only), installation payout (journal key is idempotent). |
| Double-entry integrity | PASS (new postings) | Engine rejects unbalanced entries; reconciliation R1/R2 return 0 rows on test data. Historical production data: NOT TESTED (run R1/R2). |
| Ledger ↔ operational reconciliation | PARTIAL | Queries R3–R15 written and validated on test data; **not yet run on production**. |
| Branch isolation | FAIL | SEC-05/06 (documented todo test). |
| Authentication / session | PARTIAL | See SECURITY doc. |
| Fresh-environment reproducibility | PASS | Empty database → startup migration → full suite passes. |
| Production schema parity | NOT TESTED | No access to the production database. |
| Frontend workflows (end to end) | NOT TESTED | Static review only: payment modals, submit guards, user-edit payload, manufacturing action conditions, print views (SEC-14, stored XSS). The web build was not verified locally (FE-02). |
| Mobile app, ecommerce storefront | NOT TESTED | Out of scope for this pass. |
| Performance / load | NOT TESTED | No load tests. The 5-minute auth and chart-of-accounts caches are per-process and bounded. N+1 patterns noted in report generation and the transfer/receipt pre-flights. |
| Backups / restore | NOT TESTED | No access (see SECURITY doc §5). |

## Required business scenarios (from the audit brief)

| # | Scenario | Status | Test / evidence |
|---|---|---|---|
| 1 | Product → receive → sell → pay → reconcile | PARTIAL | `inventory.test` (receive → stock + AP), `accounting.test` (sale → AR/COGS, payment → cash). Not one continuous test. |
| 2 | Partially paid invoice, second payment, remaining debt | PASS | `sales.test` (credit sale with deposit; payment checks), `accounting.test` dashboard test (payment). |
| 3 | PO → receive → partial supplier payment → settle | PASS | `inventory.test` "purchase receipt … partial payments settle the payable". |
| 4 | Expense with accounting entries | PASS | `accounting.test` expense test (create, edit, delete). |
| 5 | Transfer between locations, movement history | PASS | `inventory.test` transfer tests. |
| 6 | Cancel/reverse keeps stock, balances, ledger consistent | PARTIAL | Stock and sale journal: PASS (`sales.test`). Customer payments on cancelled orders: FAIL (ACC-15, policy). |
| 7 | Same payment/posting twice not double-counted | PASS | Double-submit tests (customer and supplier payments, receipts, transfers, cancels). |
| 8 | DB failure mid-operation rolls back | PARTIAL | Guard-triggered rollbacks proven (409 tests leave stock and ledger untouched); closed-period rejection leaves no partial data. No injected connection failure. |
| 9 | Cross-branch access denied | FAIL | `security.test` todo (SEC-05). |
| 10 | Statements reconcile to posted entries | PARTIAL | Trial balance / income statement tests; balance sheet and cash flow not tested. |
| 11 | Concurrent sales/payments on the same records | PASS | Concurrent sale, payment and cancel tests. |
| 12 | Import with valid + invalid products | PASS | `inventory.test` bulk import. |

## Counts

- Backend modules: 25 rows above.
  - PASS 4
  - PARTIAL 13
  - FAIL 5
  - NOT TESTED 3
- Fully audited (inspected **and** executed with every listed defect fixed): DB adapter, posting engine, backfill/dashboard, audit route.
- Findings: 31 fixed (incl. SAL-00), 32 open.
  - By severity of open items: P0 1 (SEC-07, unverified), P1 4 (ACC-15, SEC-05, SEC-06, OPS-02), P2 20, P3 7.
  - Plus FE-02, not verified.
