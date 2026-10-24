# Testing everything on your own computer

Use this when Railway (or the internet) is down, or to try a change before it goes live. Everything runs on your computer with a **separate local database**. Nothing here can touch production.

| Piece | Address |
|---|---|
| Database (PostgreSQL) | `localhost:5432` |
| Backend (ERP API) | http://localhost:3100 |
| Photo store stand-in (instead of Cloudflare R2) | http://127.0.0.1:9100 |
| Staff app (admin panel) | http://localhost:5173 |
| Website (storefront) | http://localhost:3001 |

## One-time setup

1. **Node.js 22** (you already have it).
2. **PostgreSQL 16** for Windows, from <https://www.postgresql.org/download/windows/>. During setup, choose a password for the `postgres` user and remember it.
3. Create an empty database for testing, in **SQL Shell (psql)** from the Start menu:
   ```sql
   CREATE DATABASE alhayat_local;
   ```
4. Install the dependencies once:
   ```powershell
   cd C:\al-hayat-erp-wms
   npm install
   cd ecommerce
   npm install
   ```
5. Website settings. Create `ecommerce\.env.local` (it is git-ignored) with:
   ```
   ERP_API_URL=http://localhost:3100/api/v1
   STOREFRONT_API_KEY=local-storefront-key-0123456789
   ALLOW_LOCAL_IMAGES=1
   NEXT_PUBLIC_SITE_NAME=Al Hayat Furniture Group
   NEXT_PUBLIC_SITE_URL=http://localhost:3001
   NEXT_PUBLIC_CONTACT_PHONE=+251 911 000 000
   ```

## Every time: four terminals

**1. Photo store** (photos live in memory and are gone when it stops):
```powershell
cd C:\al-hayat-erp-wms
node backend\scripts\dev-photo-store.mjs
```

**2. Backend.** Replace `YOUR_PG_PASSWORD`, and **never** paste the Railway database address here:
```powershell
cd C:\al-hayat-erp-wms\backend
$env:DATABASE_URL = "postgresql://postgres:YOUR_PG_PASSWORD@localhost:5432/alhayat_local"
$env:PORT = "3100"
$env:STOREFRONT_API_KEY = "local-storefront-key-0123456789"
$env:R2_ACCOUNT_ID = "local"; $env:R2_ACCESS_KEY_ID = "local"; $env:R2_SECRET_ACCESS_KEY = "local"
$env:R2_BUCKET = "photos"
$env:R2_ENDPOINT = "http://127.0.0.1:9100"
$env:R2_PUBLIC_BASE_URL = "http://127.0.0.1:9100/photos"
$env:CORS_ORIGINS = "http://localhost:5173,http://localhost:3001"
npx tsx src/server.ts
```
The first start creates all the tables.

Then, in a **separate** PowerShell window with the same `$env:DATABASE_URL` set:
```powershell
cd C:\al-hayat-erp-wms
node backend\scripts\dev-set-admin-password.mjs   # prints a local login for admin@alhayat.com
node backend\scripts\dev-demo-catalog.mjs         # optional: 9 sample products with pictures
```
Both scripts refuse to run against any database that isn't on this computer. Run the demo catalog again after restarting the photo store, because the pictures are kept in memory.

**3. Staff app:**
```powershell
cd C:\al-hayat-erp-wms\web
$env:VITE_DEV_API_ORIGIN = "http://localhost:3100"
npm run dev
```
Open http://localhost:5173 and sign in with the login printed above.

**4. Website:**
```powershell
cd C:\al-hayat-erp-wms\ecommerce
npm run dev
```
Open http://localhost:3001.

## What to try

1. **Staff app → Web Requests → Website settings:** choose the branch the website sells from. The demo catalog uses *Al Hayat HQ Showroom*.
2. **Products → Website** on a product:
   - add a photo;
   - set a "was" price higher than the price;
   - tick **Feature on the website home page**;
   - **Publish**.
3. **Products → Website categories:** upload a picture for a category.
4. On the **website**, about a minute later (the site caches for 60 seconds): the hero, the sale badge, the Featured tab and the category picture.
5. Add to cart and send a request. Then in the staff app go to **Web Requests** → **Create sales order** → **Sales** → complete it. Stock and the books move only at that point.

## Limits of the local setup

- The photo store accepts any upload. Only real Cloudflare R2 checks the upload signature, so the first real upload after going live is the true test of that.
- The local login and data exist only in `alhayat_local`. They are not your production account or data.
- `R2_ENDPOINT` is for local testing only. In production the backend ignores it unless it is an `https` address, and production should not set it at all.
