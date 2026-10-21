# Authentication hardening (branch `security/auth-hardening`)

Status: implemented and tested locally. **Not deployed.** This document covers what was found, what changed, how it was verified, how to deploy it and roll it back, and what is still open. It does not claim the system is fully secure.

## 1. Audit findings

"Confirmed" means verified in the source code, a test, or a local run. "Assumption" means not verifiable from this machine.

| ID | Severity | Status | Finding | Evidence |
|---|---|---|---|---|
| AUTH-01 | High | Confirmed, fixed | Access and refresh tokens and the user profile were persisted in `localStorage`. Any script running on the origin could read them. | `web/src/contexts/AuthContext.tsx` (before); the user's DevTools screenshots of the live site |
| AUTH-02 | High | Confirmed, fixed | Stored XSS in 5 print views. Customer, supplier, product, address and note text was written unescaped into a same-origin popup through `document.write`. The popup can reach `window.opener` and, before this change, the stored tokens. | `CustomersPage.tsx` (2), `DeliveriesPage.tsx`, `PurchasingPage.tsx`, `SalesPage.tsx`; reproduced with an `<img onerror>` customer name |
| AUTH-03 | Critical (conditional) | Confirmed in code, fixed | The JWT secrets fell back to hard-coded strings when the environment variables were missing. If they are unset on Railway, anyone can mint an admin token. | `backend/src/index.ts` (before). Whether Railway has them set is an **assumption**: not verified. |
| AUTH-04 | High | Confirmed, fixed | There was no server-side logout or session revocation. The web client never called `/auth/refresh`, so the stored 7-day refresh token was never used, rotated or revoked; "logout" only cleared `localStorage`. | `routes/auth.ts`, `AuthContext.tsx` (before) |
| AUTH-05 | Medium | Confirmed, fixed | Revocation went through a per-process 5-minute cache. With more than one backend instance, a password change or deactivation could take up to 5 minutes (plus the 15-minute token life) to apply on other instances. | `middleware/auth.ts` (before). Railway replica count is an **assumption**. |
| AUTH-06 | Medium | Confirmed, fixed | Refresh rotation was not concurrency-safe. Two tabs refreshing at once made the loser delete *every* session of the user. Any reuse was treated as theft without distinguishing a benign race. | `routes/auth.ts` (before) |
| AUTH-07 | Medium | Confirmed, fixed | No throttling on `/auth/login` (SEC-08), and unknown and known emails took different times to fail (timing enumeration). | `routes/auth.ts` (before) |
| AUTH-08 | Medium | Confirmed, fixed | CORS was `origin: *` with `credentials: true` (SEC-09). | `index.ts` (before) |
| AUTH-09 | Low | Confirmed, fixed | 500 responses returned raw error messages (SQL and constraint text) to clients (SEC-13, global handler only). | `index.ts` (before). Some routes still return their own `err.message`: open. |
| AUTH-10 | Medium | Confirmed, fixed | A user with `manage_users` could grant the admin role or change an admin's password. Today only admins hold `manage_users`, so this was latent. | `routes/users.ts` (before) |
| AUTH-11 | Info | Confirmed | Every route file except `/auth` applies `authMiddleware`. Authorization (role, branch, permissions) is read from the database, not from token claims. | Route scan; test "every API route … requires a valid access token" |
| AUTH-12 | Info | Confirmed | No token values are logged by the backend or frontend. The removed per-request "waterfall" logs printed only URLs. | grep of `console.*` |
| AUTH-13 | Info | Confirmed | Mobile (Expo) shares this API but is not production-wired: the API base is `http://localhost:3000`, it calls endpoints that do not exist (`/purchase-orders`, `/goods-receipts`, `/inventory/adjustments`), and it stored the access token in plain AsyncStorage. Its dependencies are not installed on this machine, so it was **not built or run**. | `mobile/src/api/client.ts` |
| AUTH-14 | Info | Confirmed | Frontend `al-hayat-erp.pages.dev` and API `*.up.railway.app` are different sites (both are on the Public Suffix List). A refresh cookie set by Railway would be a third-party cookie, which Safari blocks and Chrome is restricting. | Domain configuration |

## 2. Architecture

```
Browser ──same origin──► https://al-hayat-erp.pages.dev/api/v1/*  (Pages Function: web/functions/api/[[path]].ts)
                                   │  forwards method, headers, body; passes Set-Cookie back;
                                   │  sets X-Forwarded-For / X-Real-IP from CF-Connecting-IP
                                   ▼
                         https://al-hayat-erp-wms-production.up.railway.app/api/v1/*
```

- **Same-origin proxy instead of a custom domain.** No custom domain exists. The Pages Function makes the API same-origin, so the refresh cookie is first-party. If a custom domain is added later (`app.example.com` and `api.example.com`), the proxy can stay, or the cookie can move to the API host. Both are same-site then.
- **Refresh token:** 32 random bytes (opaque, not a JWT), stored server-side only as a SHA-256 hash. It is single use: each refresh marks it used and issues a successor in the same session.
  - Browser cookie `__Host-ah_rt`: `HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`, `Max-Age` of 7 days. The token is never in a response body for browsers.
- **Session:** `auth_sessions` has one row per login. The idle limit is 7 days per refresh token, with an absolute cap of 30 days. Revocation reasons are `logout`, `logout_all`, `password_changed`, `user_deactivated`, `credentials_regenerated` and `refresh_token_reuse`.
- **Access token:** HS256 JWT, 15 minutes, held **in memory only** (a module variable in `web/src/api/client.ts`). Its claims are `sub`, `sid`, `typ='access'` and `pwd_ver`. On every request the middleware does one database read: the user is active, `pwd_ver` matches, and the session `sid` is live. There is no cache, so revocation applies on the next request on every instance. Role, branch and permissions are always read from the database.
- **Reuse detection:** presenting an already-used refresh token
  - within 30 seconds of its rotation is a race between tabs or requests: the server returns 409 `REFRESH_RACE`, issues nothing and revokes nothing, and the client retries with the new cookie;
  - after 30 seconds is treated as theft: the whole session is revoked, which also kills the legitimate holder's access token.
- **Client refresh:** single-flight within a tab, and a Web Lock (`navigator.locks`) across tabs. On a 401 the client refreshes once and retries the request; if that fails it goes to the login page.
- **CSRF on cookie endpoints (`/login`, `/refresh`, `/logout`):** three layers, plus `SameSite=Strict` as a fourth:
  1. `Origin`, when present, must be in `CORS_ORIGINS`.
  2. `Sec-Fetch-Site`, when present, must be `same-origin` or `none`, unless the origin is allowed.
  3. The request must carry `X-CSRF-Protection: 1`. A cross-site page cannot send it without a preflight, which CORS refuses.

  All other endpoints authenticate with the in-memory bearer token, which a cross-site page cannot attach.
- **CORS:** an exact-origin allow-list (`CORS_ORIGINS`; default `https://al-hayat-erp.pages.dev`, `http://localhost:5173`, `http://127.0.0.1:5173`). Unknown origins get no CORS headers.
- **Native clients:** send `X-Client-Type: native`. They get the refresh token in the response body, send it back in the body, and receive no cookie. The rotation and reuse rules are the same.
  - Mobile now keeps both tokens **in memory only**: the user signs in again after the app is closed.
  - Persisting the refresh token belongs in `expo-secure-store` (iOS Keychain / Android Keystore); see §6.
- **Throttling:** failed logins are recorded in `auth_login_failures`, which is shared across instances. Login is refused with 429 after 10 failures for one email and IP, or 50 for one email, within 15 minutes. Unknown emails are compared against a dummy bcrypt hash, so response time doesn't reveal whether an account exists.
- **Fail closed:** in production (`NODE_ENV=production` or any `RAILWAY_*` variable), a missing `JWT_ACCESS_SECRET`, one under 32 characters, or the development default makes every API request return 503.
- **Browser hardening:**
  - `web/public/_headers` sets a CSP (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, …) plus `nosniff`, `DENY` framing, a referrer policy and HSTS.
  - Print views are built with an auto-escaping `html` tagged template (`web/src/utils/html.ts`). Their print buttons use `data-action="print"` instead of an inline `onclick`, so the CSP can block inline script.

## 3. Tests and results

`backend/tests/auth.test.ts` (17 tests):

- browser login cookie attributes, and no token in the body
- uniform failure messages and throttling
- CSRF refusals (foreign `Origin`, cross-site `Sec-Fetch-Site`, missing header) on login, refresh and logout
- CORS allow and deny
- reload via the cookie, and rotation
- concurrent refresh: exactly one 200, the others 409, and the session survives
- reuse after the grace window revokes the session
- logout; logout-all
- a password change ends every session
- deactivation ends sessions
- refused tokens: expired, foreign-signed, no `sid`, another user's session, wrong `typ`
- forged role/permission claims are ignored
- a non-admin user manager can't escalate
- every non-public route returns 401 without a token
- native flow (body tokens, rotation, reuse)
- production refuses to start with a missing or weak secret (503)

Other tests:

- `backend/tests/helpers.ts` now issues session-bound test tokens.
- Full backend suite: **91/91 pass**. Backend `tsc --noEmit` is clean.
- Web: `tsc` shows no source errors (only the pre-existing environment-wide `TS2688` type-library warnings), and `vite build` succeeds.
- Mobile: `tsc` shows only the same `TS2688` environment warnings. **It was not built or run on a device.**

Manual end-to-end run on the built site, using `wrangler pages dev`, which runs the real Pages Function and `_headers`, against a local backend and a throwaway database:

- Fake legacy `access_token`, `refresh_token` and `auth_user` (role admin) planted in `localStorage` were removed on load and granted nothing.
- After login, `localStorage`, `sessionStorage` and `document.cookie` are all empty.
- A reload restores the session with one refresh call.
- A customer named `<img src=x onerror=…>`, with a `<script>` address, prints as text: no elements were created and nothing executed.
- No CSP violations in the console.
- Logout returns 204, the server session is revoked with reason `logout`, and a later refresh returns 401.

Not tested:

- Real Cloudflare and Railway in production.
- Safari and Firefox.
- The renew-on-401 path in a live browser. It is unit-tested on the server side only.
- The mobile app on a device.
- Behaviour under load: the per-request session query.

## 4. Files changed

- **Backend:**
  - `src/security-config.ts` (new)
  - `src/services/auth-sessions.ts` (new)
  - `src/routes/auth.ts` (rewritten)
  - `src/middleware/auth.ts`
  - `src/index.ts` (CORS, security headers, fail-closed, 500 messages)
  - `src/init-postgres.ts` (`ensureAuthSchema`)
  - `src/routes/users.ts` (revocation, admin guard)
  - `src/routes/branches.ts` (revocation)
  - `src/db.ts`
  - `tests/auth.test.ts` (new)
  - `tests/helpers.ts`
- **Web:**
  - `functions/api/[[path]].ts` (new proxy)
  - `public/_headers` (new)
  - `src/utils/html.ts` (new)
  - `src/api/client.ts`
  - `src/contexts/AuthContext.tsx`
  - `src/types/index.ts`
  - the 4 print-view pages
  - `vite.config.ts` (dev proxy)
  - `.env.production` (`VITE_API_BASE_URL=/api/v1`)
- **Mobile:** `src/api/client.ts`, `src/contexts/AuthContext.tsx`, `src/types/index.ts`
- **Other:**
  - `.gitignore` (`.wrangler/`)
  - this document

## 5. Deployment and rollback

**Before deploying:**

1. Back up the Railway Postgres database.
2. Railway → backend service → Variables: set `JWT_ACCESS_SECRET` to a random value of at least 32 characters, e.g. `openssl rand -base64 48`. **Without it the new backend returns 503 for everything.** `JWT_REFRESH_SECRET` is no longer used.
3. Optional:
   - `CORS_ORIGINS`: only needed if another origin must call the API directly. The default covers the production Pages host and local development.
   - Pages → Settings → Environment variables: `API_ORIGIN`, only if the backend URL changes. The default is the current Railway URL.

**Deploy (backend first, then web):**

1. Merge the branch into `main` and push. Railway redeploys. On boot `ensureAuthSchema` adds `auth_sessions`, `auth_login_failures` and two columns plus an index on `refresh_tokens`. It's additive and idempotent, with no data loss. Wait until the deployment is Active and `/api/v1/health` returns OK.
2. Run `npm run deploy:web`. It uploads the site together with `functions/` and `_headers`.
3. Everyone signs in again once: old access tokens carry no session id and are refused, and old refresh tokens were never used by the web app.

**Check afterwards:**

- Sign in. DevTools → Application should show an empty `localStorage` and a `__Host-ah_rt` cookie marked HttpOnly and Secure.
- Reload: you should stay signed in.
- Log out, then press Back: you should get the login page.
- Print an invoice.
- The response headers for `/` should include `content-security-policy`.

**Rollback:**

- Web: `npx wrangler pages deployment list --project-name al-hayat-erp`, then roll back to the previous deployment in the Pages dashboard (Deployments → … → Rollback).
- Backend: revert the merge commit on `main` and push. Roll back the backend and the web together: the old web build calls Railway directly and expects `refreshToken` in the login response.
- Database: no rollback needed. The new tables and columns are ignored by the old code.

## 6. Remaining risks and follow-ups

- **Mobile persistence.** Add `expo-secure-store` with `npx expo install expo-secure-store` on a machine with the mobile toolchain, regenerate the lockfile in the same change, and keep only the refresh token in SecureStore. A lockfile-only install from here rewrote about 15,000 lockfile lines, so it was reverted: the Railway build installs from the root lockfile.
- **Railway can still be reached directly.** Requests can bypass the proxy and send `X-Real-IP` / `X-Forwarded-For`, which weakens per-IP throttling. Per-email limits still apply. Restricting direct access needs a shared secret header between the proxy and the backend: not done.
- **Access tokens stay valid up to 15 minutes after an XSS.** XSS can still act as the user while the page is open, because an in-memory token can be used by injected script. Escaping and the CSP reduce that risk; they don't remove it.
- **One database read per request** for the session check. This is fine at current scale; add a short TTL cache only with a cross-instance invalidation channel.
- **Login throttling can be used to lock out an account:** 50 failures per email in 15 minutes. Accepted trade-off.
- Open items from the earlier audit: notification IDOR (SEC-10), `PATCH /users/:id` field wiping (SEC-12), some routes returning raw `err.message` (SEC-13), file upload (SEC-11).

## 7. Acceptance criteria

- [x] No token or user object is persisted in browser storage; legacy keys are removed on load.
- [x] The refresh token is only in an `HttpOnly; Secure; SameSite=Strict` host-only cookie, first-party via the same-origin proxy.
- [x] Refresh tokens rotate on every use. Reuse after 30 seconds revokes the session; concurrent refreshes don't log the user out.
- [x] Logout, logout-all, a password change and deactivation end sessions on the server, effective on the next request on every instance.
- [x] Cookie endpoints reject cross-site requests (Origin, Sec-Fetch-Site, custom header). CORS is an exact allow-list.
- [x] Every non-auth API route requires a valid, session-bound token. Authorization comes from the database, never from client claims.
- [x] Print views escape all data; CSP forbids inline script.
- [x] Production refuses to serve with a missing or weak signing secret.
- [x] Backend 91/91 tests pass; web builds.
- [ ] Verified on production after deployment (see "Check afterwards").
- [ ] Mobile persistent secure storage (follow-up).
