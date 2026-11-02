# Multi-branch, multi-warehouse administration: findings and plan

Status: **plan, awaiting approval.** Nothing in here is implemented yet except
the read-only inspection script (`backend/scripts/inspect-schema.mjs`).

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

## 5. Decisions needed from the Owner

- **D1.** Should today's `admin` account(s) become **Owner**? Is there more than one owner?
- **D2.** Customers and suppliers: **shared company-wide** (recommended: one customer can buy at any branch; each branch sees balances only for its own sales), or separate per branch?
- **D3.** Should a Branch Manager see the **salaries and advances** of their branch's employees, or only the Owner?
- **D4.** Should warehouse managers see **cost prices and inventory value**, or quantities only?
- **D5.** Start with Phase 0 now (recommended, it closes live security holes), then Phases 1–6 in order?
