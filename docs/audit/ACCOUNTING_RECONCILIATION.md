# Accounting Reconciliation Report

**Audit date:** 2026-10-19 · Finding IDs refer to [AUDIT_REPORT.md](AUDIT_REPORT.md) · Queries: [reconciliation_queries.sql](reconciliation_queries.sql)

## 1. Posting rules (as implemented after the fixes)

| Business event | Debit | Credit | Reference key `(type, id)` | Same transaction as the event |
|---|---|---|---|---|
| Sale invoiced (`/invoice`, `/complete`, credit sale) | 1020 AR (net + installation fee); 5010 COGS | 4010 Revenue (net); 2050 Installation fees payable; 1030 Inventory (COGS) | `SALE`, order id | yes (fixed: `/invoice`, credit sale) |
| Payment at checkout (`/complete` with `amountPaid`, credit-sale deposit) | 1010 Cash | 1020 AR | `SALE`, invoice id | yes |
| Later customer payment (`/sales/payments`, `/sales/invoices/:id/payments`, `/pay`, `/complete` on INVOICED) | 1010 | 1020 | `SALE`, payment id | yes (fixed) |
| Manual customer charge | 1020 | 4010 | `SALE`, debt id | yes (fixed) |
| Installation payout to technician | 2050 | 1010 | `SALE`, `<order>-install-pay` | no (journal first, then status; the key is idempotent) |
| Goods receipt | 1030 (net unit cost × qty) | 2010 AP | `PURCHASE`, receipt id | yes |
| Supplier payment | 2010 | 1010 | `PURCHASE`, payment id | yes |
| Expense | 6010 (rent, salaries, utilities, maintenance) / 6050 (other) | 1010, or 2010 when on credit | `EXPENSE`, expense id | yes; edit/delete now reverse and re-post (fixed) |
| Stock adjustment | 1030 / 5020 Loss | 5030 Gain / 1030 | `INVENTORY_ADJUSTMENT`, movement id | yes (fixed); valued at product cost, nothing invented |
| Work order start | 1070 WIP | 1030 | `MANUFACTURING`, WO id | yes (fixed) |
| Work order complete | 1030 | 1070 (material cost) | `MANUFACTURING`, `<WO id>:complete` | yes (fixed: previously never posted) |
| Reversal (manual, order cancel, expense edit/delete) | mirror of original | mirror of original | `MANUAL`, original journal id | yes; original flagged `REVERSED`; reports count both |
| Transfers | — | — | — | No ledger effect (same entity), by design |
| Opening stock (product create / import) | — | — | — | **No posting (ACC-18, open)** |
| Assets / leases / livestock | various | various | `MANUAL`, entity id | **No idempotency, not atomic (ACC-23, open)** |
| Depreciation, year-end closing | 6060/1501; temporary → 3030 → 3020 | | `DEPRECIATION` / `CLOSING` | **Not atomic (ACC-22, open)** |

**Inventory policy determined from the code:** perpetual inventory. COGS is recognized at invoicing, valued at the all-time weighted average cost of non-cancelled goods receipts, falling back to `products.cost_price`. Stock movements between locations do not post. Valuation is inconsistent across modules (ACC-19).

## 2. Double-entry integrity

- `prepareJournalEntryPosting` rejects entries whose debits ≠ credits or that resolve no valid account lines.
- Lines whose account code is missing from the chart of accounts are **dropped with a warning**. If both sides are missing the entry is rejected; if only one side is missing the entry is unbalanced and rejected. Correct, but it fails loudly only when unbalanced.
- Manual journal entries are validated as balanced (±0.005), but negative amounts and lines with both a debit and a credit are accepted (ACC-21).
- **Closed periods:** postings dated inside a closed or locked period are now rejected (ACC-07). Previously they were silently attached to another open period.
- **Draft vs posted:** manual entries start as DRAFT and are excluded from every report until posted. Reports count `POSTED` and `REVERSED` (a reversed original plus its reversal net to zero).
- **Test evidence:**
  - Trial balance stays balanced across the suite.
  - Reconciliation queries R1 (unbalanced) and R2 (headers without lines) return 0 rows on all test databases.

## 3. Operational ↔ ledger reconciliation

| Check | Query | Status on test data (fixed code) | Status in production |
|---|---|---|---|
| Unbalanced entries / empty headers | R1, R2 | 0 rows | **Run it.** Non-atomic manual journals and closing entries could leave empty headers (ACC-21/22). |
| Customer cash per invoice vs payments recorded | R3 | 0 rows | **Likely positive differences** (ACC-01: duplicate receipts posted by dashboard views). Likely negative ones from ACC-05 (`/complete` on INVOICED posted no cash) and ACC-10 (swallowed payment-journal errors). |
| Dashboard-posted duplicates (named) | R4 | 0 rows; positive control flagged | **Run it.** These are the ACC-01 duplicates. |
| Installation fee missing from AR | R5 | 0 rows | Expected rows for orders invoiced via `/invoice` with a fee (ACC-04). |
| AR 1020 vs open invoices + charges − unallocated | R6 | consistent | Run it: differences come from R3/R4/R5 and from cancelled orders with payments (ACC-15). |
| Inventory 1030 vs stock × cost | R7 | differs by opening stock (expected) | Expect differences from opening stock (ACC-18), mixed costing (ACC-19), invented adjustment values (ACC-13), WIP never relieved (ACC-08). |
| Stock vs movement ledger | R8 | only opening-stock rows | Run it: phantom restores (INV-01/02/03), double transfers (INV-05) and over-receipts (INV-06) appear here. |
| Negative / duplicate stock rows | R9 | 0 rows | Run it (INV-04, INV-09). |
| Reversed entries mis-reported before the fix | R10 | informational | Entries listed here were shown as **negative** on the trial balance, income statement and balance sheet until this fix. The report change corrects them without touching data. |
| Completed work orders without a finished-goods journal; WIP balance | R11 | 0 rows; WIP 0 | **Every completed work order before this fix** (ACC-08). The WIP balance shows the cumulative overstatement. |
| Expenses vs ledger; journals for deleted expenses | R12 | 0 rows | Rows for every edited or deleted expense (ACC-06). |
| Payments above the amount due | R13 | 0 rows | Run it (ACC-10, ACC-14). |
| PO lines received above ordered | R14 | 0 rows | Run it (INV-06). |
| Cancelled orders whose restore ≠ issue | R15 | 0 rows | Rows for cancelled CONFIRMED orders, bundles and double cancels (INV-01/02/03). |
| Users with no branch (all-branch scope) | R16 | admin only | Review (SEC-06). |

**How to run:** paste [reconciliation_queries.sql](reconciliation_queries.sql) into Railway → Postgres → Data/Query, or run `psql "$DATABASE_URL" -f reconciliation_queries.sql`. Every statement is a SELECT; for extra safety wrap the run in `BEGIN READ ONLY; … ROLLBACK;`. Save the output; it is the baseline for remediation.

## 4. Payments, reversals, idempotency

- **Customer payments:**
  - Rejected above the balance, or for cancelled invoices or charges.
  - Concurrent submissions are serialized on the invoice row and re-checked after the lock; the losing request gets 409.
  - The journal commits with the payment.
- **Supplier payments:** same pattern on `purchase_invoices`.
- **Reversals:** `prepareJournalReversal` flags the original `REVERSED` with a guard (a second reversal returns 409) and posts a mirror entry with general-ledger rows, in the caller's transaction.
- **Idempotency:** every automatic posting uses a unique `(type, reference)`. Fixed collisions:
  - work-order consumption vs completion (ACC-08)
  - payments: the reconcile backfill now recognises every key a payment can be journaled under (ACC-01)
- `MANUAL` postings (assets, reversals) are intentionally not idempotent. For assets that means a retry duplicates the posting (ACC-23, open).

**Open: cancellation and refunds (ACC-15).** Cancelling an order reverses the sale journal and any checkout-time payment journal, but not payments recorded later. Those payments then vanish from the customer's operational balance while the ledger keeps the cash. A policy decision is needed:
- **Refund:** a refund record + Dr AR / Cr Cash, in the cancel transaction.
- **Store credit:** convert the cancelled invoice's payments into `ACCOUNT` (unallocated) customer payments so they reduce the customer's balance.

## 5. Historical data — remediation plan (approval required)

Nothing was changed in any database. Recommended sequence after deploying the fixes:

1. **Snapshot first.** Take a Railway Postgres backup (or `pg_dump`) and keep it.
2. **Run R1–R16** and save the results. Review with the business owner and accountant.
3. **Correct with journals, never by editing or deleting history:**
   - ACC-01 duplicates (R4): one correcting entry per duplicate, Dr 1020 / Cr 1010, referencing the duplicate's id, dated today, described "Correction of duplicate cash receipt <entry_number>". Alternatively, reverse the duplicate entry with the Accounting page's **Reverse** action (now atomic and GL-correct).
   - ACC-04 (R5): one entry per invoice, Dr 1020 / Cr 2050, for the missing installation fee.
   - ACC-08 (R11): one entry per completed work order, Dr 1030 / Cr 1070, for its material cost (or one summary entry for the WIP balance, approved by the accountant).
   - ACC-06 (R12): reverse journals of deleted expenses; post difference entries for edited ones.
   - INV-01/02/03 and INV-05/06 (R8, R14, R15): physical count first, then stock adjustments with notes referencing this audit (they post Dr/Cr 5020/5030 at cost).
4. **Re-run R1–R16** and confirm the differences are explained.
5. **Close the period only after reconciliation.** Closing entries are not atomic yet (ACC-22): run them once, then verify the R1/R2 queries.

## 6. Money precision (ACC-20) — migration plan

All money columns are `DOUBLE PRECISION`. Plan:
1. Add a versioned migration (introduce a migration tool first; see the SECURITY doc).
2. In a maintenance window, `ALTER COLUMN … TYPE NUMERIC(14,2) USING ROUND(col::numeric, 2)` table by table, starting with `journal_entry_lines` (the general ledger is a view over it), `invoice_payments`, `purchase_invoice_payments`, `customer_payments`, `customer_debts`.
3. The `pg` driver returns NUMERIC as strings: audit every `Number(...)` use. Most code already wraps values in `Number()`; arithmetic in SQL stays exact.
4. Re-run the test suite and R1–R16 before and after.

Do not attempt this without a backup and a staging copy of production data.

## 7. Branch-specific accounting (second pass)

Details: [BRANCH_ACCOUNTING.md](BRANCH_ACCOUNTING.md).

**Posting-rule changes:**
- Every journal entry and all its lines belong to one branch, or to none (company-level). This is enforced in the posting engine and by the database trigger `trg_journal_line_branch`.
- Customer payments are booked in the branch of the document they settle.
- Inter-branch stock transfers post sender Dr 1090 / Cr 1030 and receiver Dr 1030 / Cr 1090 at weighted-average cost.
- Closing posts one entry per branch into that branch's Retained Earnings.
- Manual entries get the fiscal period covering their date when posted (ACC-26).

**Reconciliation on test data** (real PostgreSQL; branch A = HQ, branch B = CL, plus company-level purchasing):

| Check | Result |
|---|---|
| Revenue A / B / company / consolidated | 120 / 340 / 0 / 460: consolidated = sum of parts |
| Accounts 1010, 1020, 1030, 2010, 4010, 5010, 6010 | Consolidated = A + B + company-level for every account (no duplication) |
| Each scope's trial balance and balance sheet | Balanced: A, B, company-level, consolidated; also after closing |
| Dashboard vs income statement (per branch) | Identical net income |
| Customer balance | Branch A view + branch B view = admin view |
| Inter-branch transfer (warehouse → A, value 120) | A inventory +120, company-level −120, consolidated unchanged, 1090 = 0 |
| R21 per-branch debit/credit totals | CL 790 = 790 · HQ 536 = 536 · company-level 191 = 191 |

**Production:** run R17–R23 after deploying. The startup backfill attributes only provable history. R18 and R20 list what needs a human decision; R22 lists transfers made before clearing journals existed.

## 8. Negative cash, negative inventory and the statements (investigation 2026-10-20)

Reported consolidated figures: cash −$49,514, inventory −$960, total assets −$50,254, net income −$50,254, "Balanced". All of them were **reproduced exactly** on a local database built to match the production records (4 HQ sales $2,372 with $220 unpaid; rent $7,000 at HQ; salaries $44,444 and maintenance $222 with no branch; products whose stock was entered at creation).

**Findings:**

| # | Figure | Root cause | Status |
|---|---|---|---|
| CF-1 | Beginning cash $0 | The UI **hardcoded** beginning cash to `$0`; the API never calculated it | FIXED: beginning = cash lines dated before the period; ending = the cash ledger at period end; the statement checks beginning + net change = ending and warns if not |
| CF-2 | Ending cash with a period selected | Ending used the all-time ledger while "net cash" used the period, so the statement could not reconcile | FIXED: same date window for both |
| CF-3 | Everything "operating" | Lines were grouped by document type only | FIXED: classified by the other side of each cash entry. Equity (owner capital, opening cash) = **financing**; property, livestock and fixed assets = **investing**; customers, suppliers and expenses = **operating** |
| BS-1 | Cash shown as a negative asset | Presentation | FIXED: negative cash is presented as a **Cash overdraft** liability with a warning (totals unchanged) |
| BS-2 | "Balanced" | Not a plug. Net income is computed from revenue/expense lines and equals the income statement in every scope (test). The balance sheet now also returns an **independent** ledger check (debits = credits for the same scope and date) | Verified |
| BS-3 | Deactivated accounts with balances | The trial balance, balance sheet and owners'-equity statement dropped them, which could make a balanced ledger look unbalanced | FIXED |
| NC-1 | Cash −$49,514 | **Not a calculation error.** Recorded cash: in $2,152 (customer receipts), out $51,666 (expenses), and no opening cash or owner funding was ever recorded. By branch: HQ −$4,848 (2,152 − 7,000); company-level −$44,666 (salaries and maintenance saved without a branch). | Explained. Fix the data: record opening cash / owner funding (Accounting → Opening Balances) and, if they belong to a branch, set the branch on the two expenses. Nothing was fabricated |
| NI-1 | Inventory −$960 | Stock entered with new products was never valued in the books, so the $960 cost of goods sold came out of an empty account | Root cause fixed earlier (`a6d7bda`): new products and imports post opening stock. Existing stock: Accounting → Opening Balances posts it per branch, once, valued at cost |

**Regression tests:** `tests/statements-reconciliation.test.ts` covers realistic activity in two branches and at company level (opening cash, prior-year expense, cash and credit sales, partial payment, a cancelled paid sale, stock adjustment, purchase receipt plus supplier payment, warehouse → branch transfer, property purchase).

| Test | Before | After |
|---|---|---|
| Every entry and every scope's trial balance balance | pass | pass |
| Cash flow: beginning + net = ending = cash ledger, for A, B, company-level and consolidated, all-time and current period | FAIL | pass |
| Cash flow: owner funding = financing (+500), property = investing (−300), the rest operating | FAIL | pass |
| Branch cash flows add up to consolidated (beginning, each activity, ending) | (hollow pass: fields missing) | pass |
| Balance sheet net income = income statement net income; negative cash = overdraft; independent ledger check | FAIL | pass |
| Inventory ledger = stock on hand × cost per branch and consolidated; no negative stock | pass | pass |
| Branch cash ledger = operational receipts − payments | pass | pass |

Full suite: **67/67**.
