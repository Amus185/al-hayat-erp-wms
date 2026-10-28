# Al Hayat storefront

The public furniture website. It shows the products staff **publish** in the ERP, with the stock the ERP says is available, and lets customers send an **order request** that staff confirm by phone. There is no online payment and no customer account.

It has no database of its own. Everything comes from the ERP's public storefront API (`/api/v1/storefront`), so prices and stock are never copied or out of date by more than a minute.

Built with Next.js 16 (App Router), React 19 and Tailwind 4. Layout adapted from Next.js Commerce (MIT, see `THIRD_PARTY_NOTICES.md`).

## How it fits together

```
Browser ──► this site (Next.js)  ──server-to-server──►  ERP backend (Railway)
            /, /search, /product/…                       GET  /storefront/products …   (public, whitelisted fields)
            /api/cart  (fresh prices)                    POST /storefront/requests     (needs STOREFRONT_API_KEY)
            /api/request (order request)
```

- The browser never talks to the ERP. Only this site's server does, and the secret `STOREFRONT_API_KEY` stays on the server.
- The cart in the browser holds only product slugs and quantities. Names, prices, photos and availability are loaded fresh for display, and the ERP sets the real prices when it receives a request.
- Photos are served through `/_next/image`, which resizes them, from the ERP's R2 bucket. Only the host in `IMAGE_HOSTNAME` is allowed.
- `src/proxy.ts` adds a per-request Content-Security-Policy nonce, and every page is rendered per request for that reason.

## Settings

| Variable | Where | Purpose |
|---|---|---|
| `ERP_API_URL` | server | ERP base URL, e.g. `https://<your-backend>.up.railway.app/api/v1` |
| `STOREFRONT_API_KEY` | server, **secret** | Must equal `STOREFRONT_API_KEY` on the ERP. 24+ random characters. Never prefix with `NEXT_PUBLIC_`. |
| `IMAGE_HOSTNAME` | server (needed at build and run time) | Public host of the photo bucket, e.g. `photos.example.com` or `pub-xxxx.r2.dev`. Must be the host of the ERP's `R2_PUBLIC_BASE_URL`, which must be a bare origin with no path. |
| `NEXT_PUBLIC_SITE_NAME` | public | Shop name |
| `NEXT_PUBLIC_SITE_URL` | public | The site's own public URL (links, robots) |
| `NEXT_PUBLIC_CURRENCY` | public | ISO code, default `USD` |
| `NEXT_PUBLIC_CONTACT_PHONE` | public | Shown in the header, footer, product, contact and thank-you pages |
| `NEXT_PUBLIC_CONTACT_EMAIL` | public, optional | Shown on the contact page and in the footer when set |
| `NEXT_PUBLIC_SHOWROOM_ADDRESS` | public, optional | Showroom address (line breaks kept), shown when set |
| `NEXT_PUBLIC_OPENING_HOURS` | public, optional | Opening hours (line breaks kept), shown when set |

Marketing photos (home hero, room banners) come from `images.unsplash.com` under the Unsplash License; see `PHOTO_CREDITS.md`. Product pages only ever show the photos staff upload in the ERP.

`NEXT_PUBLIC_*` values are compiled into the browser code at build time, so set them before building.

## Run locally

```bash
cd ecommerce
npm ci
cp .env.example .env.local   # then fill it in
npm run dev -- -p 3001
```

To see photos from a local stand-in storage on `127.0.0.1:9100`, also set `ALLOW_LOCAL_IMAGES=1`. It is ignored in production builds.

## Deploy (second Railway service)

1. Railway project → **New → GitHub Repo** → this repo. Name the service `storefront`.
2. **Settings → Source → Root Directory:** `/ecommerce`.
3. **Settings → Config-as-code → Railway Config File:** `/ecommerce/railway.json`. This step matters: Railway's config file does **not** follow the Root Directory, so without it the repo-root `railway.json` (the backend's start command) would be applied to this service and it would fail to start.
4. **Settings → Source → Watch Paths:** `/ecommerce/**`, so backend-only changes do not rebuild the site.
5. **Variables:** the settings listed above. `STOREFRONT_API_KEY` must equal the one on the backend service. `NEXT_PUBLIC_*` and `IMAGE_HOSTNAME` are read at build time, so set them before the first deploy.
6. **Settings → Networking → Generate Domain** (or add a custom domain), then set `NEXT_PUBLIC_SITE_URL` to that address and redeploy.

Railway builds with Railpack: it runs `npm run build`, then `npm run start`, on the current Node LTS (Next 16 needs 20.9 or newer).

On the backend service, the request endpoint answers 503 until `STOREFRONT_API_KEY` is set there.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```
