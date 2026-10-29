# Deploying on Cloudflare

Everything runs on Cloudflare except the database, which is a hosted Postgres
(Neon, Supabase or any other provider). Railway is no longer needed.

```
Browser ─► al-hayat-erp (Pages: staff app)  ── /api/v1 proxy ──┐ service binding "API"
Customer ─► al-hayat-storefront (Worker: Next.js shop) ── fetch ─┤
Staff app ─► alhayat-ai-agent (Worker: Workers AI) ─────────────┤ service binding "ALHAYAT_API"
Mobile app ─────────────────────────────────────────── fetch ───┤
                                                                 ▼
                                 al-hayat-api (Worker: backend/) ─► Hyperdrive ─► Postgres
                                       │
                                       └─► R2: al-hayat-files (uploads), photo bucket (storefront)
```

| Piece | Folder | Cloudflare product | Config |
|---|---|---|---|
| Backend API | `backend/` | Worker `al-hayat-api` | `backend/wrangler.jsonc` |
| Staff app | `web/` | Pages project `al-hayat-erp` | dashboard (bindings, variables) |
| Website | `ecommerce/` | Worker `al-hayat-storefront` (OpenNext) | `ecommerce/wrangler.jsonc` |
| AI assistant | `ai-agent/` | Worker `alhayat-ai-agent` | `ai-agent/wrangler.jsonc` |
| Database | — | Hyperdrive in front of hosted Postgres | `backend/wrangler.jsonc` |

**Plan:** the backend needs **Workers Paid** ($5/month). Password hashing (bcrypt)
takes a few hundred milliseconds of CPU, above the Free plan's 10 ms limit, so
logins would fail on Free. Hyperdrive, service bindings and Pages are included.

All commands below run from the repository root unless stated. `npx wrangler login`
once first.

## 1. Database

1. Create the Postgres database at your provider and copy its connection string
   (with `?sslmode=require` if the provider shows it). Use the **direct**
   connection string, not a pooler: Hyperdrive does the pooling.
2. Create the tables, ERP and Better Auth's (safe to repeat; it never deletes data).
   With `DATABASE_URL` in `backend/.env` (copy `.env.example`), just
   `npm --workspace backend run db:migrate`; or pass it inline:
   ```bash
   DATABASE_URL="postgres://..." npm --workspace backend run db:migrate
   ```
   PowerShell: `$env:DATABASE_URL="postgres://..."; npm --workspace backend run db:migrate`
3. **Moving existing data** (from Railway or a backup) instead of starting empty:
   ```bash
   pg_dump --no-owner --no-acl --format=custom "$OLD_DATABASE_URL" -f alhayat.dump
   pg_restore --no-owner --no-acl --dbname "$NEW_DATABASE_URL" alhayat.dump
   DATABASE_URL="$NEW_DATABASE_URL" npm --workspace backend run db:migrate
   ```
   Restore into an **empty** database, then migrate (adds anything newer than the dump).
   Railway keeps a paused database's data, but it must be running for `pg_dump`.
4. Create the Hyperdrive config and put its id into `backend/wrangler.jsonc` (`hyperdrive[0].id`):
   ```bash
   npx wrangler hyperdrive create al-hayat-db --connection-string="postgres://..."
   ```

Run `db:migrate` again before deploying a backend change that adds tables or
columns: the Worker does not migrate on startup (the Node server still does).

## 2. Backend Worker

```bash
cd backend
npx wrangler r2 bucket create al-hayat-files
npx wrangler secret put BETTER_AUTH_SECRET     # openssl rand -base64 32; required (sign-in, see docs/BETTER_AUTH.md)
npx wrangler secret put AGENT_TOKEN_SECRET     # 32+, different from the above (AI assistant)
npx wrangler secret put STOREFRONT_API_KEY     # 24+ (website order requests)
# Product photos for the website (R2 S3 API token, see the R2 dashboard):
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET
npx wrangler secret put R2_PUBLIC_BASE_URL     # bare origin, e.g. https://photos.example.com
npm run deploy
```

Check: `https://al-hayat-api.<your-subdomain>.workers.dev/api/v1/health` answers
`{"status":"ok"}`. Logs: `npx wrangler tail`.

`CORS_ORIGINS` (in `wrangler.jsonc`) only matters for browsers calling the API
directly. Keep it to the staff app's address.

## 3. Staff app (Pages)

Pages project `al-hayat-erp` → **Settings → Bindings → Add → Service binding**:
name `API`, service `al-hayat-api`. Remove an old `API_ORIGIN` variable pointing
at Railway (the binding is used first anyway). Then:

```bash
npm run deploy:web
```

To enable the assistant, set `VITE_AGENT_URL` (step 5) in `web/.env.production`
before building.

## 4. Website (ecommerce)

```bash
cd ecommerce
npx wrangler r2 bucket create al-hayat-storefront-cache
npx wrangler secret put STOREFRONT_API_KEY     # same value as on the backend
```

Edit `ecommerce/wrangler.jsonc` → `vars.ERP_API_URL` to the backend's
`https://al-hayat-api.<your-subdomain>.workers.dev/api/v1`. Build-time settings go
in `ecommerce/.env.production` (not committed):

```
IMAGE_HOSTNAME=photos.example.com
NEXT_PUBLIC_SITE_URL=https://al-hayat-storefront.<your-subdomain>.workers.dev
NEXT_PUBLIC_CONTACT_PHONE=+252 ...
```

Then `npm ci && npm run deploy`. A custom domain is added under the Worker's
**Settings → Domains & Routes**; update `NEXT_PUBLIC_SITE_URL` and redeploy.

## 5. AI assistant

```bash
cd ai-agent
npm install
npx wrangler secret put AGENT_TOKEN_SECRET     # same value as on the backend
npx wrangler deploy
```

It reaches the backend through the `ALHAYAT_API` service binding. Put the
address it prints into `VITE_AGENT_URL` and redeploy the staff app.

## 6. Mobile app

Set `API_BASE_URL` in `mobile/src/api/client.ts` to
`https://al-hayat-erp.pages.dev/api/v1` (through the staff app's proxy) or the
backend's `workers.dev` address, then rebuild the app.

## Local development

Nothing changes: `npm run dev:backend` still runs the Node server (see
`docs/LOCAL_TESTING.md`). To run the backend in the Workers runtime instead:

```bash
cd backend
# .dev.vars (not committed): BETTER_AUTH_SECRET=..., BETTER_AUTH_URL=http://localhost:8787, NODE_ENV=development
npm run dev:worker     # uses hyperdrive.localConnectionString from wrangler.jsonc
```

The backend tests can also run against the Worker build (one file per run; several in parallel can stall the local runtime):

```bash
TEST_TARGET=worker TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
  node --import tsx --test tests/sales.test.ts
```

## Rollback

The Node server (`backend/src/server.ts`) and its Dockerfile are unchanged, so
the backend can run on any Node host again with `DATABASE_URL` set. To switch
the staff app back, remove the Pages `API` binding and set `API_ORIGIN` to that
host.
