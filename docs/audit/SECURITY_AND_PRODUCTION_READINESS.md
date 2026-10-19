# Security & Production Readiness

**Audit date:** 2026-10-19 · Finding IDs refer to [AUDIT_REPORT.md](AUDIT_REPORT.md)
No penetration testing was performed against production; everything below comes from code review and tests against a local database.

## 1. Immediate actions (owner: whoever controls Railway)

| # | Action | Why |
|---|---|---|
| 1 | Deploy this change set (push `main`; Railway auto-deploys `backend/**`). | SEC-01: until deployed, every restart resets the admin password. |
| 2 | **After** the deploy, change the `admin@alhayat.com` password from the Users page. | The seeded password is in the public repository's history. Assume it is known. |
| 3 | Railway → `al-hayat-erp-wms` → Variables: confirm `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` exist, are ≥ 32 random bytes, and differ from each other and from the dev strings in `backend/src/index.ts`. If they were missing, set them; that also logs everyone out. | SEC-07: when unset, the code falls back to secrets published in the repo, so anyone can mint admin tokens. |
| 4 | Rotate the Postgres password (Railway → Postgres → Variables), then redeploy the API. | It was shared in chat during this session. |
| 5 | Review active users (reconciliation query R16). Deactivate unknown or stale accounts. Give every non-admin user a branch. | SEC-06: users without a branch see and act on all branches. |
| 6 | Seeded branch users `branch.hq@alhayat.com` and `branch.cl@alhayat.com` have placeholder hashes. Deactivate them if unused, or regenerate their credentials (Branches → Regenerate). | They are re-created on any fresh database. |

## 2. Authentication & sessions

**OK:**
- Access tokens are HS256 with a 15-minute expiry.
- Refresh tokens rotate, are stored as SHA-256 hashes, and token reuse revokes all of the user's tokens.
- `password_version` invalidates sessions on credential changes; it is cached per process for up to 5 minutes.
- Deactivation is honored within the cache window (invalidated immediately on user update).

**Open:**
- SEC-07: secret fallback (above). After verifying the variables, make startup fail when the secrets are missing or equal the dev strings. Not done here, because if production lacks them that change would take the API down.
- SEC-08: no rate limiting or lockout on `/auth/login`; `bcrypt.compareSync` blocks the event loop. Recommendation: per-IP and per-email limits (e.g. 10 per 15 minutes), and async `bcrypt.compare`.
- Role resolution uses `LIMIT 1` over the user's roles, which is arbitrary for multi-role users. `requireAdmin` depends on it.

## 3. Authorization & tenant (branch) isolation

- **Model:** permission codes inside the JWT. A user is "admin-scoped" when `role = 'admin'` **or `branch_id IS NULL`** (`isAdminUser`).
- **SEC-05 (open, P1):** branch scoping exists only on order list/detail/delete and order/transfer creation. Every other mutation takes a record ID without checking that it belongs to the caller's branch:
  - sales confirm, invoice, pay, complete, cancel; payments, debts, customers
  - transfers approve, dispatch, receive
  - stock adjustments (any `branchId`/`warehouseId` accepted)
  - expense edit/delete
  - deliveries
  - reports filters (partially scoped)

  **Fix plan:** a helper `assertBranchAccess(c, branchId)` that returns 403 when the caller is branch-scoped and the record's branch differs. Call it after each record lookup. Add a test per route (the todo test in `security.test.ts` is the template).
- **SEC-06 (open, P1):** replace "`branch_id IS NULL` means all branches" with an explicit role or permission (e.g. `view_all_branches`). Migrate existing admin users first.
- **Separation of duties (open, P2):** `manage_purchasing` grants fiscal-period open/close, chart-of-accounts edits, manual journal entries, closing entries, reconciliation and expenses. Recommendation: a dedicated `manage_accounting` permission.
- **Fixed:** SEC-02 (zero-permission users could read the audit log), SEC-03 (branch deletion detached users into all-branch scope), SEC-04 (customer deletion cascaded away financial history), SAL-01 (any sales user could hard-delete invoiced orders), INV-08 (product deletion erased history).
- **Other IDOR (open):** notifications create/delete for any user (SEC-10); `PATCH /users/:id` wipes omitted fields (SEC-12).

## 4. Input handling, injection, data exposure

- **SQL:** all values are bound parameters. Dynamic SQL builds only column lists (from fixed whitelists or code) and placeholder lists. No injection path found.
  - Caveat: the adapter rewrites every `?` to `$n`, so a literal `?` inside SQL text (e.g. the JSONB `?` operator) would break a query. None exist today.
- **XSS (SEC-14, open, P2):** React escapes output by default, but the print views in `SalesPage.tsx`, `PurchasingPage.tsx`, `CustomersPage.tsx` and `DeliveriesPage.tsx` call `window.open('')` + `document.write(...)` with unescaped database strings (product, customer and supplier names, notes). The popup is same-origin, so a name such as `<img src=x onerror=…>`, entered by any user who can create products or customers, runs script that can read the printing user's `localStorage` tokens. Fix: an `escapeHtml()` helper applied to every interpolated value in those templates.
- **Mass assignment:** updates use explicit field whitelists (OK). Client-supplied sale unit prices and discounts are accepted without bounds (PUR-01).
- **Error disclosure (SEC-13):** several routes return `err.message` (raw Postgres messages, table and constraint names) to clients. The global handler also returns the message. Recommendation: return a generic message plus a request id, and log details server-side.
- **CORS (SEC-09):** `origin: *` with `credentials: true`. Restrict to `https://al-hayat-erp.pages.dev` (and custom domains).
- **Files (SEC-11):** the upload route requires an R2 `STORAGE` binding that does not exist on Railway, so it always fails. There are also no size or type limits. Remove the route, or back it with S3/R2 credentials plus limits.

## 5. Production readiness

| Area | State | Gap / recommendation |
|---|---|---|
| Deployment | Railway auto-deploy on push to `main` (backend); Cloudflare Pages deploys manually from a developer machine with `--commit-dirty=true` | The web deploy can ship uncommitted code: build from CI or from a clean checkout. Three overlapping configs (`/railway.json`, `/backend/railway.json`, `/Dockerfile`); document which one Railway uses. |
| Environment validation | None at startup | Fail fast when `DATABASE_URL` or the JWT secrets are missing (after verifying production, §1.3). |
| Migrations | DDL, seeds and data backfills run inside `ensurePostgresInit()` on **every boot** (DB-02). Failure is only logged. | Adopt versioned migrations (e.g. node-pg-migrate). Move the purchase-invoice/PO backfills into one-time migrations. Make a failed migration stop the boot. |
| Schema parity | `schema_pg.sql` ≠ the startup migration ≠ production (unknown) | Generate the reference schema from production (`pg_dump --schema-only`) and commit it. |
| Destructive scripts | `schema_pg.sql` starts with `DROP TABLE … CASCADE`; `npm run db:wipe` | Guard them: refuse non-local hosts unless `I_UNDERSTAND_PRODUCTION=1`. |
| Health checks | `/api/v1/health` returns OK without touching the database | Add `SELECT 1` with a short timeout as a readiness check. |
| Logging / observability | `[WATERFALL]` timing logs on every request and statement (high volume, includes URLs) | Disable by default (env flag); emit structured logs with a request id; alert on 5xx rate. |
| Backups / restore | **Unverified** (no Railway access) | Confirm Railway backups are enabled for the Postgres volume, note the retention (= RPO), and run a restore drill into a staging service (measure RTO). Take a manual `pg_dump` before running any reconciliation correction. |
| Rollback | Railway keeps previous deployments (redeploy an older one) | Schema changes are additive in this change set (`ADD COLUMN IF NOT EXISTS`), so rolling back the code is safe. |
| Interrupted operations | Multi-step writes are now single transactions (sales, payments, expenses, adjustments, manufacturing, cancellations). Remaining non-atomic: assets, closing entries, depreciation, manual journal creation, installation payout. | Run reconciliation R1/R2/R3 after incidents. |
| CI | None | GitHub Actions: `npm ci` (after re-syncing `backend/package-lock.json`, DB-03), `npm run typecheck`, `npm test` against a `postgres:17` service container. |
| Dependencies | `npm audit --omit=dev` (backend): one moderate advisory group in `hono` 4.12.29. Relevant: CORS middleware ReDoS via `Access-Control-Request-Headers` (CORS is enabled globally) and unbounded `parseBody()` nesting (files route). Not relevant (features unused): SSG, JSX/SSR, proxy helper, language middleware. | Upgrade `hono` to a patched release and commit a synced lockfile. Web, mobile and ecommerce dependencies were not audited. |
| Rate / resource limits | Pool max 20 connections, 5 s connect timeout; list endpoints capped at 200–500 rows | Add pagination; set a request body size limit. |

## 6. What could not be verified

- Production schema, data, Railway variables, backups, and Cloudflare/Railway deployment history.
- Live UI end-to-end flows; mobile and ecommerce apps.
- Load and performance characteristics (no load tests run).
- The web build: the local `node_modules` predates the `recharts` dependency, so the build was not run successfully here; the web code was not changed.
