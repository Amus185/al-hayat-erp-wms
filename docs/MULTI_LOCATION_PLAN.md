# Multi-branch, multi-warehouse administration: findings and plan

Status: **Phase 0 (assessment) in progress.** The code-level assessment is
done (sections 1, 6, 7, 8). The production data checks are waiting for the
read-only report from `backend/scripts/inspect-schema.mjs`; sections marked
**[confirm on production]** are updated when it arrives. Nothing is
implemented; no database change is made without the Owner's approval.

Model (as recommended): **branches are accounting reporting units, warehouses
are inventory management units, the Owner sees both consolidated.** One
company, one database, one chart of accounts, one journal.

---

## 1. What exists today (from the code and a database built by the current migrations)

> The production database still has to be checked with
> `node backend/scripts/inspect-schema.mjs` (read-only). The findings below
> must be confirmed against that report before Phase 1 starts.

### People, roles, permissions
| Item | Today |
|---|---|
| `users` | one `branch_id` and one `warehouse_id` per person |
| `roles` | `admin`, `accountant`, `branch_user`, `sales_rep`, `warehouse_manager` |
| `permissions` | 6 coarse codes: `manage_users`, `manage_inventory`, `manage_transfers`, `manage_purchasing`, `manage_sales`, `view_reports` |
| `user_roles` | several roles per person supported; the token's `role` is "admin if held, else the first role" |
| `role_permissions` | the seed inserts each pair twice (17 duplicate rows locally); harmless, to clean up |
| Session | permissions, branch and roles are reloaded from the database on every request (good, nothing trusted from the client) |

### Location scoping (`services/branch-scope.ts`)
- `admin` and `accountant` see every branch; everyone else is pinned to
  **one** branch. Used by accounting, sales, expenses, reports, search.
- **No scoping at all** in purchasing, deliveries, manufacturing, inventory
  (except an admin check), warehouses, employees, storefront admin.
- Warehouses have no scope concept: `users.warehouse_id` is only used for
  the new "incoming transfers" tab.

### Which records carry a location
| Has a location column | Location comes through a parent | No location at all |
|---|---|---|
| `sales_orders.branch_id`, `expenses.branch_id`, `customer_payments.branch_id`, `customer_debts.branch_id`, `journal_entries/lines.branch_id` (with a trigger keeping lines = header), `purchase_orders.branch_id + warehouse_id`, `employees.branch_id`, `inventory_stock`, `inventory_transactions`, `transfers` (source/destination), `goods_receipts.destination_*`, `deliveries.source_warehouse_id`, `work_orders.warehouse_id`, `inventory_period_counts` | `invoices`/`invoice_payments` → sales order; `purchase_invoices` → PO; `employee_advances` → employee; `delivery_items` → delivery; `transfer_lines` → transfer | `customers`, `suppliers` (company-wide master data), `mfg_jobs` (new Item Manufacture), `files`, `agent_*` (per user), `properties`/`livestock` (owner's assets) |

### Accounting engine
Already branch-aware, which is the right base:
- Every journal entry has a `branch_id` or NULL (company-level). A trigger
  keeps each line's branch equal to its entry's.
- Branch-to-branch stock transfers post out of the sender and into the
  receiver through **1090 Inter-Branch Clearing**, which nets to zero
  company-wide. Transfers never post revenue or purchases.
- Purchasing, warehouse stock, manufacturing and depreciation post at
  company level (NULL). The accounting reports already offer
  "All / one branch / Company-level".
- `general_ledger` is a view over posted lines (kept as is).

### Security gaps found (live today)
| # | Gap | Severity |
|---|---|---|
| S1 | `isAdminUser()` treats **anyone without a branch as an administrator** (`branch_id === null`). A warehouse manager or any unassigned user passes admin checks in transfers, inventory, products, audit, branches. | **Critical** |
| S2 | Owner's Assets (properties, tenants, leases, livestock) need only `view_reports`, which sales reps and branch users have. Hidden in the menu, open through the API. | **High** |
| S3 | `GET /files/:key` serves any stored file to any signed-in user, including employment documents. | **High** |
| S4 | The AI Assistant is available to every user (it is scoped like the app, but it is not Owner-only). | Medium |
| S5 | Purchasing, deliveries, manufacturing, inventory lists are not limited to the user's location. | Medium (by design today, wrong for the new model) |
| S6 | Audit log: non-admins see their own entries only; fine, but there is no "my branch's audit" for a branch manager. | Low |

---

## 2. Target model

### Access = role permissions × assigned locations
- **What** a person may do: their roles' permissions (customizable by the Owner).
- **Where**: the locations explicitly assigned to them. A job title alone grants nothing.
- Owner / Company Administrator: every location.

### Roles (seeded, editable by the Owner)
| Role | Locations | Typical permissions |
|---|---|---|
| Owner | all | everything, incl. assistant, owner's assets, company settings |
| Company Administrator | all | everything except owner's assets and assistant (Owner may grant) |
| Branch Manager | assigned branch(es) | branch sales, customers, purchasing, expenses, employees (incl. pay), transfers, branch reports and accounting |
| Warehouse Manager | assigned warehouse(s) | inventory, receiving, dispatch, counts, transfers, warehouse reports |
| Accountant | assigned branches (or all) | accounting, reports, expenses; no stock changes |
| Sales Employee | assigned branch | create sales, customers; no financial reports |
| Cashier | assigned branch | record payments, view sales; no reports |
| Storekeeper | assigned warehouse | stock movements, counts, receiving; no payroll, no costs |
| Delivery Employee | assigned branch/warehouse | deliveries assigned to the location |

Existing roles map over: `admin` → Owner (or Company Administrator), `branch_user` → Branch Manager,
`warehouse_manager` → Warehouse Manager, `sales_rep` → Sales Employee, `accountant` → Accountant.
Existing users keep working without any change on day one.

### Permissions (split from today's 6, old codes kept as aliases)
`sales.view, sales.create, sales.manage, payments.record, customers.view, customers.manage,
purchasing.view, purchasing.manage, suppliers.manage, inventory.view, inventory.adjust, inventory.count,
transfers.view, transfers.request, transfers.approve, transfers.dispatch, transfers.receive,
deliveries.view, deliveries.manage, manufacturing.view, manufacturing.manage, expenses.view, expenses.manage,
employees.view, employees.manage, payroll.view (salary/advances/documents), accounting.view, accounting.post,
reports.view, reports.export, owner_assets.manage, storefront.manage, users.manage, settings.manage,
audit.view, assistant.use`

---

## 3. Table-by-table migration plan

Only where the current schema cannot express the requirement.

| Table | Change | Why the existing schema is not enough |
|---|---|---|
| **new `user_locations`** (`user_id`, `branch_id` *or* `warehouse_id`, `is_default`) | add; backfill one row per user from `users.branch_id` / `users.warehouse_id` | `users` holds one branch and one warehouse; people with several locations (an accountant for 3 branches) cannot be expressed. `users.branch_id/warehouse_id` stay as the **default** location for compatibility. |
| `roles` | seed the new roles; add `is_system` flag | new roles; the flag stops the Owner deleting built-in roles |
| `permissions` | seed the new codes | today's 6 codes cannot separate e.g. "see incoming transfers" from "approve transfers", or "inventory" from "payroll" |
| `role_permissions` | remove duplicate rows; add unique (role_id, permission_id); map old codes to new | duplicates today |
| `mfg_jobs` | add `branch_id` (nullable = company-level) | Item Manufacture records have no location |
| `transfer_lines` | add `discrepancy_note` (text) | `quantity_received` exists; a reason for a difference (damaged, missing) has nowhere to go |
| `transfers` | add `receipt_status` (`FULL`, `SHORT`, `OVER`) | so the sender sees "received with differences" without reading every line |
| `inventory_transactions` | none; new transaction types `DAMAGED`, `COUNT_ADJUSTMENT`, `TRANSFER_SHORTAGE` use the existing `transaction_type` | already has source/destination warehouse and branch |
| `files` | add `entity_type`, `entity_id` | to check a download against the record it belongs to (employee document → payroll permission + location) |
| `agent_conversations/messages/actions/usage` | none | already per user; access is enforced by `assistant.use` + the user's scope |
| `customers`, `suppliers` | **no change proposed** (see decision D2) | company-wide master data; per-branch balances already come from branch-attributed orders, payments and journal lines |
| `journal_entries/lines`, `general_ledger`, `chart_of_accounts` | none | already branch-attributed with a consistency trigger and 1090 clearing |

Warehouse money: **no warehouse ledger.** Warehouse value = `inventory_stock` × product cost;
warehouse costs (e.g. expenses) are attributed through the branch or company level they are posted to.

---

## 4. Phases

Each phase ends with tests, a push, and a deploy the agent verifies on production.

| Phase | Content | Size |
|---|---|---|
| **0. Urgent security fixes** | S1 (no branch ≠ admin), S2 (owner's assets owner-only on the server), S3 (file downloads checked against their record), S4 (assistant owner-only on the server, `assistant.use`) | small |
| **1. Access model** | `user_locations`, roles and permissions above, one `resolveScope()` returning the person's allowed branches and warehouses, applied to **every** read, write, export and download route; old permission codes keep working | large |
| **2. Users & roles screen** | Owner assigns roles and locations per person, edits each role's permissions | medium |
| **3. Workspaces** | Sign-in lands on the right workspace; location switcher in the top bar (only if more than one location); Owner dashboard (company totals + one card per branch and warehouse, click to enter, "Back to company"); Branch dashboard; Warehouse dashboard. Sidebar shows only permitted items. Reuses existing pages with the location applied. | large |
| **4. Warehouse operations** | Receive with differences (per-line received qty + reason), damaged/missing stock, stock counts with discrepancy report, expected incoming goods, frequently moved items | medium |
| **5. Reports** | Owner: branch comparison, warehouse comparison, consolidated statements (already exist), filters by branch/warehouse/date. Branch: daily/weekly/monthly/yearly sales, best sellers, debts, employees. Warehouse: valuation, movements, discrepancies | medium |
| **6. Verification** | Automated tests for 7 accounts (Owner, Branch A/B managers, Warehouse A/B managers, Accountant, Sales employee) proving each sees exactly its data, incl. URL/ID tampering, exports, files, assistant; then the same checks on production by the agent | medium |

---

## 5. Owner decisions (agreed)

| # | Decision | Consequence for the design |
|---|---|---|
| D1 | The current **primary admin** becomes the first Owner. One Owner now, several possible later. **Only an Owner can grant Owner.** Other admins are not promoted. | New `owner` role. The primary admin is chosen from the report's administrator list and confirmed by the Owner before the change. `users.ts` guard: granting/removing `owner`, or editing an Owner account, requires the caller to be an Owner. The last Owner cannot be removed or deactivated. |
| D2 | Customers and suppliers are **shared master records**; each branch sees only its own sales, payments, debts, purchases and balances; the Owner sees everything. | No branch column on `customers`/`suppliers`. Customer and supplier **lists** are visible to people who may sell/buy; **transactions and balances** are always filtered by the viewer's branches (sales orders, invoices, payments, debts, POs, purchase invoices all already resolve to a branch). A customer's total balance across branches is Owner/authorized-only. |
| D3 | Salaries and advances: **Owner only by default**; Branch Managers manage their employees' ordinary details without pay; the Owner can grant payroll to chosen accountants/HR. | Split `employees.manage` (details, within assigned branches) from `payroll.view` / `payroll.manage` (salary, advances, employment documents). The server removes salary, advance totals and document keys from every answer (list, profile, export, search, assistant) unless the caller holds `payroll.view`. |
| D4 | Warehouse Managers see quantities and movements; **cost prices, purchase costs and valuation** only for the Owner and authorized accounting staff; grantable per person. | New `costs.view` permission, checked on the server in products, inventory, warehouses, reports, purchasing (PO prices), transfers, exports and the assistant. Granting it to one Warehouse Manager = a personal permission (see `user_permissions` below). |
| D5 | Phase 0 is an assessment; then phase by phase, each tested; no destructive changes or risky migrations without approval. | Every phase lists its migrations up front; each migration is additive (new tables/columns, backfills that only fill empty values) and is run first against a copy of production. |

### D3 and D4: implemented (Owner asked to start them with these recommendations)

- **Per-person grants: `user_permissions`** (chosen over one-person roles): `user_id`, `permission_id`,
  `granted_by`, `granted_at`. Additive; managed from Users → Edit → "Extra access for this person"
  (administrators only until the Owner role exists); every change is audited (`USER_EXTRA_PERMISSIONS`).
- **New permissions** and their defaults (applied once, when each permission is first created, so the
  Owner's later changes are never undone by a migration):

  | Permission | Default roles | Meaning |
  |---|---|---|
  | `costs.view` | admin, accountant | cost prices, purchase prices, supplier balances, stock value, margins/profit |
  | `payroll.view` | admin | salaries, advances, employment documents |
  | `payroll.manage` | admin | change salaries, record/delete advances, upload documents |
  | `employees.manage` | admin, branch_user | employees' ordinary details, own branch only |

- **Enforced on the server**: cost/pay fields are removed from every answer of products, inventory,
  warehouses, reports, manufacturing, purchasing and employees (so also from search, exports and the
  assistant); hidden values cannot be used for sorting; exports drop those columns; people without
  `costs.view` cannot set product costs, create/approve purchase orders, create BOMs or pay suppliers
  (receiving goods still works); employee files follow the record's privacy.
- **Consequence to know**: Branch Managers no longer see costs or create priced purchase orders by
  default (D4). The Owner gives "See cost prices and stock value" to those who buy stock.
- Accounting statements (balance sheet, P&L) still show inventory and cost of goods sold to anyone with
  report access; that is fixed in Phase 1 when report access is split by role and branch.

### Consequence of D4 (per-person grants)
Granting `costs.view` or `payroll.view` to **one** Warehouse Manager without giving it to all of them needs a
per-person grant. Proposed: **`user_permissions`** (`user_id`, `permission_id`, `granted_by`, `granted_at`),
additive to role permissions. Alternative without a new table: create a one-person role such as
"Warehouse Manager + costs". The table is cleaner and auditable; the Owner chooses.

---

## 5b. Production report, first run (2026-11-02, script version 9861f03)

The agent ran the first version of the script (before the Phase 0 data checks were added), so the
Owner candidate, affected users and clearing balances are still to come from a second run.
What the first run confirms:

| Finding | Detail | Meaning |
|---|---|---|
| Schema matches the code | All 86 tables/views and their columns, keys and indexes are as the migrations create them; the journal-line branch trigger is present | the plan's table list holds; no unknown production-only tables |
| Production is small | 3 users, 2 branches, 2 warehouses, 3 sales orders, 4 transfers, 10 journal entries, 1 employee, 2 products | migrations are low-risk; every record can be checked by hand before and after |
| Books balance | 0 unbalanced posted entries; 3 company-level entries = 2 opening balances + 1 warehouse→branch transfer (warehouse side is company-level by design) | accounting attribution is already correct |
| Duplicate role links (bug) | `user_roles` 30 rows for 3 users; `role_permissions` far above the real 17 pairs. Cause: the seed used `ON CONFLICT DO NOTHING` on tables **without a unique constraint**, so every `db:migrate` added another copy. | Harmless for access (same role held many times) but it grows. **Fixed in code** (commit after 5993aef): the seed now inserts only missing pairs, so it stops growing. Removing the existing copies and adding the unique constraints is part of Phase 1a and needs approval. |
| One delivery without a source warehouse | 1 of 1 deliveries | warehouse-scoped delivery lists must fall back to the sales order's branch |
| `approx_rows` | Postgres estimates; e.g. `branches` shows 0 but has 2 | counts in sections below are exact |

## 6. Route-by-route access assessment (code)

Legend: ✅ enforced on the server · ⚠️ partial · ❌ missing. "Location" = limited to the caller's branch/warehouse.

| Area (route file) | Permission check | Location limit | Cost / pay privacy | Notes |
|---|---|---|---|---|
| Sales, invoices, payments, customers (`sales.ts`) | ✅ `manage_sales` | ✅ branch (14 places) | ⚠️ margin uses cost for anyone with access | customer list is company-wide (fits D2), balances per branch ✅ |
| Accounting (`accounting.ts`) | ✅ `view_reports` / `manage_purchasing` | ✅ branch, all-branch for admin/accountant | — | accountant = every branch; needs "selected branches" |
| Expenses (`expenses.ts`) | ✅ | ✅ branch | — | |
| Reports (`reports.ts`) | ✅ `view_reports` | ⚠️ uses `isAdminUser` (S1) | ❌ stock value at cost shown to anyone with reports (sales reps) | D4 |
| Purchasing, suppliers (`purchasing.ts`) | ✅ `manage_purchasing` | ❌ none | ❌ prices visible | warehouse manager has `manage_purchasing` today |
| Inventory (`inventory.ts`) | ⚠️ reads open to all signed-in | ⚠️ via `isAdminUser` (S1) | ⚠️ cost hidden from non-admins, but S1 makes unassigned users "admin" | |
| Warehouses (`warehouses.ts`) | ❌ reads open to all signed-in | ❌ none | ❌ `inventory_value`, `cost_price` to everyone | D4 |
| Products (`products.ts`) | ✅ writes | ⚠️ `isAdminUser` | ⚠️ cost for admins only (S1 widens) | |
| Transfers (`transfers.ts`) | ✅ `manage_transfers` | ⚠️ branch only; warehouses not limited; S1 | — | no partial receipt (see 8) |
| Deliveries (`deliveries.ts`) | ✅ `manage_sales` | ❌ none | — | branch is derivable from the sales order |
| Manufacturing (`manufacturing.ts`) | ✅ `manage_inventory` | ❌ none | ⚠️ material costs visible | `mfg_jobs` has no location |
| Employees (`employees.ts`) | ✅ `manage_users` (admins) | ❌ none | ❌ pay always included | D3 |
| Owner's assets (`assets.ts`) | ⚠️ `view_reports` / `manage_purchasing` | — | ❌ S2 | Owner-only |
| Files (`files.ts`) | ❌ any signed-in user | ❌ | ❌ S3 | link files to records |
| Users, roles (`users.ts`) | ✅ `manage_users` for every route (corrected: the list is not public) | ❌ | — | only admins grant admin ✅; needs Owner rule (D1) |
| Branches (`branches.ts`) | ✅ writes admin-only | ⚠️ `isAdminUser` | — | |
| Audit (`audit.ts`) | ⚠️ own entries for non-admins | ❌ no branch view | — | |
| Search (`search.ts`) | ✅ per kind | ✅ branch for financial kinds | ⚠️ | |
| Assistant (`agent.ts`) | ⚠️ tools check permissions; **no Owner gate** (S4) | inherits routes | inherits routes | tools run as the user, so fixing routes fixes the assistant |
| Storefront admin | ✅ | ⚠️ web branch | — | |
| Notifications, saved views | per user ✅ | — | — | |

Other findings: `user_roles` and `role_permissions` have **no unique constraint** (duplicate rows exist
in a fresh database: 3 and 17). Harmless today, but must be cleaned before permissions are edited in a UI.

## 7. Accounting assessment (code)

| Workflow | Posts under | Fits the model? |
|---|---|---|
| Sale, invoice, payment, customer debt (`SALE`) | sales order's branch | ✅ |
| Expense (`EXPENSE`) | expense's branch | ✅ |
| Purchase, supplier invoice, supplier payment (`PURCHASE`) | the PO's `branch_id`, or company level when the PO is for a warehouse | ✅ branch payables already possible **[confirm on production: share of POs with a branch]** |
| Branch↔branch / warehouse↔branch transfer (`TRANSFER`) | sender out / receiver in through **1090 Inter-Branch Clearing** at **receipt**; warehouse side = company level | ✅ consolidated nets to zero **[confirm: 1090 total = 0]** |
| Stock adjustment (`INVENTORY_ADJUSTMENT`) | the stock's branch, else company | ✅ |
| Manufacturing work orders (`MANUFACTURING`) | company level | ✅ (warehouse-based) |
| Depreciation (`DEPRECIATION`) | company level | ✅; branch-owned assets could later carry a branch |
| Salary advances (`PAYROLL`) | the employee's branch | ✅ |
| Closing, opening, manual | chosen branch or company | ✅ |

No new ledger is needed. Warehouses get **valuation and movement** reports from `inventory_stock`,
`inventory_transactions` and product cost, not journal entries.

## 8. Gaps that need design (not only access)

1. **Receiving with differences.** Receipt always books the full dispatched quantity. There is nowhere to
   record that 2 of 10 arrived damaged or missing. Proposal: the receiver enters the quantity per line plus a
   reason; the accepted quantity goes into stock; the difference becomes a **transit loss** movement
   (`inventory_transactions` type `TRANSFER_SHORTAGE`) and, at cost, a journal entry **Dr Inventory
   Shrinkage expense / Cr 1090 or Inventory** on the **sender's** books (the receiver only books what
   arrived). The transfer gets `receipt_status` FULL/SHORT/OVER so the sender sees it at once.
2. **Goods in transit.** Stock leaves the sender at dispatch, but the journal moves at receipt. Totals stay
   right company-wide; per location, in-transit stock should appear as its own line ("in transit to X").
   Report-only change, no new ledger.
3. **Damaged items and stock counts.** `inventory_period_counts` exists; damage/count adjustments reuse
   `inventory_transactions` with their own types so they appear in movement history and discrepancy reports.
4. **Accountant for selected branches.** Today `accountant` sees every branch. With `user_locations`, an
   accountant sees exactly the branches assigned (or all, if the Owner assigns all).
5. **Item Manufacture location.** `mfg_jobs` needs `branch_id` (nullable = company), set from the
   creator's location; existing rows stay company-level.

## 9. Migration risks and data protection

| Risk | Protection |
|---|---|
| Losing or changing existing records | Only additive changes: new tables, new nullable columns, inserts of new roles/permissions. No `DROP`, no `DELETE` of business data, no rewrites of amounts or journal lines. |
| Duplicate cleanup (`user_roles`, `role_permissions`) removes rows | Deletes only exact duplicate pairs, keeping one; counted before and after; run inside one transaction. |
| Someone loses access on deploy day | Phase 1 maps every existing role to its new permissions **before** the old checks are replaced; old permission codes keep working; a test signs in as each existing role and compares what they can open before and after. |
| Someone gains access on deploy day (the S1 bug in reverse) | Users without any location and without an all-locations role get **no** location data (refused, not widened), as `branch-scope.ts` already does for finance. The report lists these users first so they can be assigned before the switch. |
| Wrong Owner | The Owner role is given to one account named by you from the report, by a one-off command, not automatically. |
| Migration fails half-way | Each migration runs in a transaction; `db:migrate` stops on the first error (it already counts ❌ as failure). |
| Rollback | Each phase's code works with or without the new columns until the switch; a database backup/branch (Neon/Layerbase snapshot) is taken by the agent before every migration. |
| Accounting drift | Tests assert after each phase: every posted entry balances, 1090 nets to zero company-wide, branch totals add up to the consolidated total, transfers create exactly one movement per side. |

## 10. Next steps

1. Agent runs the read-only report on production → I complete the **[confirm on production]** items and
   list the exact users affected by S1, the Owner candidate, and any data needing cleanup.
2. You approve: the Owner account, `user_permissions` (yes/no), and **Phase 1a: the four security fixes
   (S1–S4)**, which change behaviour but no data.
3. Then Phase 1b (access model migrations), each step with its migration listed for approval.


---

## 11. Implemented: branch isolation (Owner request, Phase 1 core)

**Cause found.** Branch limits existed only for sales, expenses and accounting. Deliveries, purchasing,
manufacturing, warehouses, the Products and Customers lists, and the transfer actions (approve, dispatch,
receive, cancel) had none, and a person's reach depended on their role label (any admin was company-wide, and a
missing branch counted as "administrator"). So two branch managers could see each other's records.

**Rule now (one resolver, `resolveLoc`, used by every module).**
- Company-level = an admin or accountant with **no branch**. Only they can see all branches, and they may narrow
  to one with `?branch_id=` (the Owner's branch switcher in the top bar).
- Assigned to a branch = that branch only, always, whatever roles they hold. Asking for another branch is
  refused (403). A branch-assigned "admin" is just that branch's manager.
- Assigned to a warehouse only = that warehouse. Neither = refused (never "unrestricted").

**Shared master records keep one identity.** Customers: one record per person (same phone number reuses it);
`customer_branches` links a branch to customers it registers or deals with, plus anyone with sales, debts,
payments or quotes there; balances, ledger and history are per branch. Products: `product_branches` plus stock,
sales, transfers and purchases decide which products a branch deals in; the Stock column is the branch's own.

**Migration (additive).** `deliveries.branch_id` (filled from the sales order), `mfg_jobs.branch_id`,
`mfg_item_groups.branch_id` (groups can still be company-wide; the unique name rule is now per branch),
`customer_branches`, `product_branches`, permissions `accounting.view` and `assistant.use`.

**Modules scoped:** sales, customers, products, inventory, deliveries, purchasing (orders, receipts, invoices,
supplier reports), manufacturing (Item Manufacture per branch; factory work orders are warehouse-level),
transfers (visible to both sides; sender approves/dispatches/cancels, receiver confirms), expenses, employees,
warehouses (names for choosing a destination; stock and writes only for the company view or that warehouse),
search, exports, files, reports.

**Navigation and finance.** Branch managers no longer get Branches, Assistant or Accounting; the Finance reports,
inventory valuation and branch comparison are hidden for them; Accounting needs `accounting.view` and the
assistant needs `assistant.use` (both enforced on the server). The Owner can give either to one person.

**Known limits.** Goods received on a purchase order still land in a warehouse (receiving is company-level);
the Online Store menu is still visible to branch managers (its server rules are unchanged); manufacture numbers
(MF-00001...) are one company-wide sequence; customers and products that no branch deals with yet are visible to the
Owner only until a branch sells, stocks or registers them.


---

## 12. Sales, vehicles and accountant improvements (implemented, not deployed)

- **Sales branch.** The branch comes from who is signed in; the field is gone for anyone who works from a
  branch. The Owner (no branch of their own) uses the branch they are viewing or must choose one: nobody gets
  "the first branch in the list" by default any more. The server refuses a sale sent for another branch with a clear
  message instead of silently re-assigning it.
- **Plain error messages.** One place in the app turns server answers into plain language (what happened, what to do
  next): technical text and server errors are never shown; our own explanations are. The terse "Forbidden" is
  now a sentence.
- **Accountants** see the consolidated books (dashboard, ledger, trial balance, P&L, balance sheet, cash flow,
  journal, branch summary, receivables) even when assigned to a branch; this widens nothing else (no users,
  branches, assistant, or other branches' sales).
- **Company Vehicles** (Employees tab): `vehicles` table; a delivery picks a vehicle and keeps its own
  driver; the usual driver is only a suggestion; the plate is copied onto the delivery; vehicles with
  delivery history are made inactive, never deleted.

## 13. Transfers, sale edits, cancellations and returns

- **Transfers (one step):** the sender creates a request (branches can send to any other branch: `GET /transfers/destinations`). The receiver **accepts** (`POST /transfers/:id/accept`, all or part, per-line quantity) and the stock leaves the sender and arrives at the receiver in one transaction, with the inter-branch entries. **Decline** (`/reject`, by the receiver) or sender **withdraw** (`/cancel`) moves nothing. Old approve/dispatch/receive stay only for transfers already in flight.
- **Edit sale:** `PATCH /sales/orders/:id`, drafts only (nothing is invoiced, deducted or posted yet). Anything later: cancel or return.
- **Cancel:** reason required; refused once goods left/delivered or after any return; reverses stock and sale entries and the entries of money already collected.
- **Returns:** `POST /sales/orders/:id/returns` (reason, products, quantities, good/damaged, refund method). Good items restock the branch; invoice total shrinks; paid-over amount is refunded (cash 1010 out); revenue 4010 / receivable 1020 reversed, stock 1030 / COGS 5010 restored for good items only. Tables: `sales_returns`, `sales_return_lines`; `invoices.returned_amount/refunded_amount`.

## 14. Product pricing: one price, adjustments recorded (price tiers retired)

- A product has one selling price. Price tiers are no longer offered or saved (existing rows are kept, unused).
- On a sale line the seller may sell above or below it. The line stores the product's price at that moment (`sales_order_lines.list_price`), the sold price, and the reason (`adjustment_reason`; chosen from a short list in the form). A far-off price (over 30%) asks for confirmation; a changed price needs a reason in the form.
- Revenue is always the price sold at. The adjustment is information only: the Owner/admins and accountants get a notification (type `PRICE`) per sale that carries a change, and `GET /sales/price-adjustments` lists who changed what, with totals below and above the product price (accounting/admin only).

## 15. Costing and product prices (running average, Owner-only selling price)

- **Cost is never typed once a product has stock.** Goods coming in set it as a running weighted average, company-wide: new cost = (on hand × cost + units in × their cost) ÷ (on hand + in). Purchase receipts (net of the PO discount), resaleable customer returns and cancelled sales (both at the cost they were sold at), and finished production feed it (`services/costing.ts`). Stock adjustments move units at the current cost (no change).
- **Each sale keeps its cost:** `sales_order_lines.unit_cost` is stamped when the sale's cost of goods is posted; COGS = quantity × that cost. Later cost changes never change past profit.
- **Selling price:** only the Owner (admin with no branch) changes it: product edit, while receiving goods (`lines[].newSellingPrice`), or through the assistant. Sellers still adjust the price of one sale with a reason (section 14).
- **History:** `product_price_history` keeps every cost and selling-price change (old, new, why, who, when); `GET /products/:id/price-history` (cost rows only for cost viewers). Product edit shows it.
- **Alert:** when a receipt raises the cost, the Owner gets a notification with old → new cost, the margin drop and the price that keeps the old margin.
- **One-time recalculation (migration `costing_recalc_v1`):** each product's current cost is recomputed from the newest purchases that make up today's stock (part not covered by purchases keeps the old cost). Old values are kept in the history (`RECALCULATED_FROM_PURCHASES`). It does not post a journal entry; see the report for the stock-value check.

### 15a. Owner decision (5 Nov): prices only in Products, fixed price on sales
- Sales always use the product's current selling price; the server ignores any typed price (seller or Owner). Website requests keep the price the customer was quoted.
- The Owner changes cost and selling price in Products → Edit at any time. A cost change with stock posts one entry per location (1030 against 5030 Inventory Gain / 5020 Inventory Loss), so the ledger stays stock × cost. Purchases still move the average cost and alert the Owner.
- The "new price when receiving" box and the per-sale price adjustment are removed.
