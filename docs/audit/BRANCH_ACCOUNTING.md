# Branch-Specific Accounting & Branch Isolation

**Date:** 2026-10-19 · Part of the production audit ([AUDIT_REPORT.md](AUDIT_REPORT.md)) · Tests: `backend/tests/branch-accounting.test.ts`, `backend/tests/security.test.ts`

## 1. Summary

Before this change, the Accounting section had **no branch isolation at all**:
- Every accounting endpoint returned company-wide data to anyone with `view_reports`.
- The seeded `branch_user` role holds both `view_reports` and `manage_purchasing`, so every branch user could read every branch's books, and could create, post and reverse journal entries, open and close fiscal periods, edit the chart of accounts, and run year-end closing.

In the pre-fix test run, a branch-A user saw consolidated revenue (**460 instead of 120**) and journal entries from every branch.

Accounting is now **branch-aware within the existing single ledger**: one chart of accounts, one set of journals, double entry preserved. Every financial record is attributed to a branch, or explicitly to the company (unassigned).
- **Branch users** see only their branch.
- **Administrators and accountants** see the consolidated view and can filter any accounting page by branch or by company-level postings.
- **Everything is enforced on the server.** The UI selector is only a convenience.

**Evidence:** the 19 branch-accounting tests fail 17/19 on the previous code and pass 19/19 now. The full backend suite is 53/53.

## 2. Root causes

| # | Root cause | Where |
|---|---|---|
| RC-1 | The accounting router applied no branch scope: queries had no branch predicate, and `branch_id` was an optional, unvalidated filter on two endpoints only. | `routes/accounting.ts` |
| RC-2 | Authorization trusted the JWT's `branch_id`/`permissions` for up to 15 minutes. A changed branch or role kept working with the old token. | `middleware/auth.ts` |
| RC-3 | `isAdminUser()` treats **any user without a branch** as all-branch, so missing configuration meant unrestricted access. | `middleware/auth.ts` (used by sales, expenses, reports) |
| RC-4 | Branch attribution of postings was incomplete. Customer payments from the payment screen posted with **no branch**. Manual journal lines could carry a different branch than their entry. Stock moved between branches never moved its value. | `routes/sales.ts`, `routes/accounting.ts`, `routes/transfers.ts` |
| RC-5 | Receivables (customer balances, debts, ledger, receipts) and expense edit/delete had no branch scope; order and invoice actions accepted any branch's IDs. | `routes/sales.ts`, `routes/expenses.ts` |
| RC-6 | Company-wide configuration (fiscal periods, chart of accounts, depreciation, closing, backfills) was open to branch users through `manage_purchasing`. | `routes/accounting.ts` |
| RC-7 (ACC-26) | Manually posted journals got **no fiscal period**, so period closing never closed them. Found during the live UI check. | `routes/accounting.ts` |

## 3. Design

**Scope model** (`backend/src/services/branch-scope.ts`):

| Caller | Default view | `?branch_id=` |
|---|---|---|
| Role `admin` or `accountant` | `ALL` — consolidated | `<branch id>` → that branch · `UNASSIGNED` → company-level postings · `ALL` |
| Any other user with a branch | Their branch | Their own id or `ALL` (= their branch); any other value → **403** |
| Any other user without a branch | — | **403** ("not assigned to a branch") — never unrestricted |

- **Live authorization.** `authMiddleware` reloads the user's `branch_id`, roles and permissions from the database (5-minute cache, invalidated immediately when the user is edited or deleted) and overwrites the token claims. A changed branch, role or deactivation applies on the next request (Scenario F). Role resolution is deterministic: admin, then accountant, then others; it used to be an arbitrary `LIMIT 1`.
- **Attribution unit = journal line.** Reports filter `journal_entry_lines.branch_id` in the join, so other branches' lines are never read, not even as zero rows carrying branch names. An entry belongs to exactly one branch:
  - the posting engine rejects a line whose branch differs from its entry's
  - a database trigger (`trg_journal_line_branch`) enforces the same rule
  - manual entries take the caller's branch (branch users: always their own)
- **Safe SQL.** Branch ids are validated against `^[A-Za-z0-9_-]{1,100}$` and checked to exist before they are inlined into report SQL. The ids come from the database (the caller's own branch) or from a validated admin filter.
- **Company-level ("unassigned")** = postings with no branch: purchasing (goods receipts, supplier payments), warehouse stock, manufacturing, depreciation, and admins' unbranched expenses or account payments. They appear only in the consolidated and `UNASSIGNED` views.

**Attribution rules for new postings:**

| Event | Branch |
|---|---|
| Sale (invoice, credit sale, complete) | The order's branch |
| Payment against an invoice (any screen) | The **invoice's order branch**, even when an admin with no branch records it |
| Payment against a manual charge | The charge's branch |
| Unallocated (account) payment | Receiving user's branch (branch user) or admin's choice / company-level. Stored in the new `customer_payments.branch_id` |
| Manual charge, expense, inventory count, manual journal | Branch users: their own (an explicit other branch → 403). Admins: chosen branch or company-level |
| Stock adjustment | The branch whose stock changes (warehouse → company-level) |
| **Inter-branch stock transfer** (branch↔branch, warehouse↔branch) | On receipt, two balanced entries at weighted-average cost: sender Dr 1090 / Cr 1030 and receiver Dr 1030 / Cr 1090. **1090 Inter-Branch Clearing** nets to zero when consolidated, so nothing is duplicated |
| Reversal | The reversed entry's branch |
| Year-end closing | **One closing entry per branch** (and one for company-level): nominal accounts → Retained Earnings 3020 in that branch's books, posted atomically with the period lock |

**Access to company-wide configuration** (fiscal periods create/close, chart of accounts create/edit, depreciation, closing entries, journal backfills) requires `admin` or `accountant`; other users get 403.

## 4. Endpoints and queries changed

| Area | Endpoints | Change |
|---|---|---|
| Journals | `GET /accounting/journal-entries`, `GET …/:id`, `POST …`, `POST …/:id/post`, `POST …/:id/reverse` | Scoped list and detail (another branch's id → 404); write branch resolved server-side; single-branch lines; post/reverse only within scope; posting assigns the fiscal period and refuses closed periods; manual creation atomic |
| Ledger & statements | `general-ledger`, `trial-balance`, `income-statement`, `balance-sheet`, `cash-flow`, `owners-equity`, `dashboard`, `audit/transaction-flow`, `inventory-counts`, `depreciation` | Line-level branch predicate. Cash-flow ending balance = sum of scoped cash lines (was the company-wide running balance). Depreciation is company-level, so empty for branch views. Inventory counts scoped |
| Config | `POST/PATCH fiscal-periods`, `POST/PATCH chart-of-accounts`, `POST depreciation`, `POST closing-entries`, `POST reconcile-*` | Admin/accountant only |
| Closing | `POST closing-entries` | Rewritten: per-branch, one transaction, refuses a non-OPEN period, closes contra balances and period-less entries dated in the period, then locks the period |
| Receivables | `GET /sales/customers`, `/debts`, `/debts/summary`, `/customers/:id/debts`, `/customers/:id/balance`, `/customers/:id/ledger`, `/payments/:receipt/receipt` | Balances and lines restricted to the scope |
| Sales actions | orders list/detail/delete/create, confirm, invoice, pay, complete, cancel, installation payout, `invoices/:id/payments` (GET/POST), invoice print, `/sales/summary`, `POST /payments`, `POST /customers/:id/debts` | Strict scope; another branch's order or invoice → 403; payments and charges attributed as in §3 |
| Expenses | `GET /expenses`, `/summary`, `POST`, `PATCH /:id`, `DELETE /:id` | Strict scope; out-of-scope edit or delete → 404 |
| Reports | `/reports/receivables`, `/sales-profit`, `/branch-performance`, `/quote-conversion` | Strict scope plus admin `?branch_id=` filter. Stock reports are unchanged (warehouse users) |
| Transfers | `POST /transfers/:id/receive` | Inter-branch clearing journals |
| Web | `AccountingPage.tsx` | Admin/accountant branch selector (All / each branch / Company-level) applied to every accounting request; branch users see a read-only "Branch: …" badge |

## 5. Database changes and historical data

All changes are additive and idempotent, and run in `ensurePostgresInit` on boot:
1. `customer_payments.branch_id` (new column).
2. Account **1090 Inter-Branch Clearing** (asset).
3. Trigger `trg_journal_line_branch`: a journal line's branch must equal its entry's. It applies to inserts and updates only; existing mixed rows are reported, not modified.
4. **Backfill (own transaction; on failure it rolls back and is logged):**
   - `customer_payments.branch_id` from the paid invoice's order or the paid charge.
   - Journal entries with no branch on the entry or any line: the branch is set **only when the source document proves it**. Sale order, `<order>-pay`, `<order>-install-pay`, invoice, invoice payment, customer payment, charge, expense and stock movement are all checked. Reversals follow the entry they reverse.
   - Lines with no branch take their entry's branch; general-ledger rows follow their line.
   - **Nothing is guessed.** Unattributable rows stay NULL. They show only in the consolidated and Company-level views, never inside a branch, and are listed for review by R18 and R20.

**Verified on a test database** (Scenario H): a legacy payment journal keyed `<order>-pay` was attributed to its order's branch, and a legacy unallocated-payment journal stayed NULL and remained visible to the admin as unassigned.

**Production prerequisites and validation** (none of this was run against production):
1. Take a database backup first.
2. Deploy. The backfill runs on boot (look for the log line "Branch attribution backfilled for N journal entries").
3. Run [reconciliation_queries.sql](reconciliation_queries.sql) **R17–R23**:
   - R21: every branch must balance.
   - R18 / R20: assign or leave the listed rows, as a business decision.
   - R19: historical mixed entries (reverse and re-post per branch if material).
   - R22: transfers made before clearing journals existed (their value is still in the sender's books; post correcting clearing entries if branch inventory matters).
   - R23: period-less entries, which closing now includes by date.
4. **Rollback:** the code can be rolled back safely (the columns, account and trigger are additive). The backfill only fills NULLs, so a backup restore is the only way to undo it; that's why step 1 is required.

## 6. Test evidence (real PostgreSQL 17, local disposable server)

Fixtures:
- **Branch A (HQ):** credit sale 100, payment 30, rent 15, charge 20.
- **Branch B (CL):** credit sale 300, payment 30, rent 25, charge 40.
- **Company-level:** goods receipt 50, supplier payment 20.
- **Users:** branch user A, branch user B, accountant (no branch), sales rep (no branch), admin.

| Scenario | Test | Before | After |
|---|---|---|---|
| A — isolation | A/B users see only their own journal entries | FAIL (saw all branches + unassigned) | PASS |
| A — filter tampering | `?branch_id=<other>` / `UNASSIGNED` on 9 accounting endpoints → 403 | FAIL (200) | PASS |
| A/C — branch figures | Revenue A = 120, B = 340; rent; cash; IS = dashboard; cash flow; admin filter identical to branch user view | FAIL (460) | PASS |
| B — consolidation | ALL = A + B + UNASSIGNED for 7 accounts and the dashboard; no duplication | FAIL | PASS |
| D — integrity | Trial balance and balance sheet balance for A, B, UNASSIGNED, ALL | PASS (trivially, unscoped) | PASS |
| D — attribution | Admin payment of a B invoice → B; charge payment → charge branch; `customer_payments.branch_id` | FAIL (no branch) | PASS |
| A — writes | Branch user: explicit other-branch charge → 403; own charge and account payment → own branch | FAIL | PASS |
| A — receivables | Customer balance A + B = admin total; debts list, summary and ledger scoped | FAIL | PASS |
| E — expenses | List scoped; other branch filter → 403; edit/delete another branch's → 404 | FAIL | PASS |
| A — journals | Branch user cannot create for B, post or reverse B's; own entry pinned to A | FAIL | PASS |
| D — mixed branches | API → 400; DB trigger rejects a foreign-branch line | FAIL | PASS |
| A — config | 6 company-wide actions → 403 for branch user; period stays OPEN | FAIL (201) | PASS |
| A — no branch | Sales rep with no branch → 403 (accounting, expenses, receivables); accountant sees consolidated | FAIL (200) | PASS |
| F — scope change | Moving a user A→B applies on the next request with the old token; deactivation → 401 | PASS (trivially, unscoped) | PASS |
| G — duplicates | Concurrent duplicate payment recorded once, in A only; B untouched | FAIL | PASS |
| D — transfers | Warehouse → A transfer: A inventory +120, company-level −120, consolidated unchanged, 1090 = 0 | FAIL | PASS |
| H — history | Provable legacy journal → B; ambiguous stays NULL, visible as unassigned | FAIL | PASS |
| Closing | Per-branch closing zeroes nominal accounts in A and B (incl. a period-less manual entry), RE(A) = A's net income, period locked, second run refused, all scopes balanced | FAIL | PASS |
| SEC-05 — sales | Branch user → 403 on another branch's cancel, confirm, complete, invoice payment, print, detail | todo (not enforced) | PASS |

**Live UI check** (local backend and Vite against a populated local test database): the selector shows "All branches (consolidated)". Switching to HQ and then CL sent `?branch_id=branch-hq-main` and `?branch_id=branch-cl-show` and changed the dashboard figures (operating expenses $9 → $0 → $9). That same check exposed ACC-26, which is now fixed and covered by the closing test.

## 7. Remaining limitations and decisions needed

1. **Purchasing is company-level.** POs and goods receipts belong to warehouses, not branches, so supplier payables and purchase costs appear only in the consolidated / Company-level views. Branch inventory value arrives through inter-branch transfers. Attributing purchases to a branch would need a branch on the PO (a business decision).
2. **Customers are shared master data.** A customer's total exposure across branches is visible only to admins and accountants; branch users see their branch's portion.
3. **Unallocated account payments** belong to the receiving branch. A customer who pays in branch A towards a branch-B invoice must have the payment allocated to that invoice to be booked in B.
4. **Transfers before this change** (R22) did not move value between branch books, so historical branch inventory balances can be negative or positive by that amount.
5. **Branch-level scope outside finance** (transfers, stock adjustments, deliveries, inventory reports) still uses the older `isAdminUser()` rule (RC-3). Warehouse managers without a branch depend on it, so changing it needs a decision about warehouse-scoped roles first.
6. Single Railway replica assumed for immediate cache invalidation. With several replicas, a scope change takes up to 5 minutes on the other replicas.
7. The data in production has not been inspected (no access). Every production-specific statement above is **unverified** until R17–R23 are run.
