# Al Hayat storefront

The public furniture website. It shows the products staff **publish** in the ERP, with the stock the ERP says is available, and lets customers send an **order request** that staff confirm by phone. There is no online payment and no customer account.

It has no database of its own. Everything comes from the ERP's public storefront API (`/api/v1/storefront`), so prices and stock are never copied or out of date by more than a minute.

Built with Next.js 16 (App Router), React 19 and Tailwind 4. Layout adapted from Next.js Commerce (MIT, see `THIRD_PARTY_NOTICES.md`).

## How it fits together

```
Browser ──► this site (Next.js)  ──server-to-server──►  ERP backend (Worker)
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
| `ERP_API_URL` | server | ERP base URL, e.g. `https://al-hayat-api.<your-subdomain>.workers.dev/api/v1` (`vars` in `wrangler.jsonc`) |
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

## Deploy (Cloudflare Worker)

The site runs as the Worker `al-hayat-storefront`, built by the OpenNext adapter (`@opennextjs/cloudflare`); settings are in `wrangler.jsonc` and `open-next.config.ts`. Full steps, including the backend it depends on, are in `docs/DEPLOY_CLOUDFLARE.md`. In short:

```bash
cd ecommerce
npx wrangler r2 bucket create al-hayat-storefront-cache   # once: the 60 s catalog cache
npx wrangler secret put STOREFRONT_API_KEY                 # once: same value as the backend
npm ci
npm run deploy
```

- `ERP_API_URL` is a runtime variable in `wrangler.jsonc`; `STOREFRONT_API_KEY` is a Worker secret.
- `IMAGE_HOSTNAME` and `NEXT_PUBLIC_*` are read at build time: put them in `.env.production` (not committed) before `npm run deploy`.
- Photos are resized by Cloudflare Images (the `IMAGES` binding).
- `npm run preview` builds and runs the Worker locally; put runtime values in `.dev.vars`.
- `src/proxy.ts` runs as OpenNext's Node.js middleware, which OpenNext marks experimental. It was checked locally: every script carries the nonce and the smoke test passes. Re-check the CSP header after upgrading Next or OpenNext.

On the backend, the request endpoint answers 503 until `STOREFRONT_API_KEY` is set there.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```
