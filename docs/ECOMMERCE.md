# Online store: architecture and plan

The online store is **not a second system**. It is a public shop window on the
ERP: the same products, the same prices, the same stock, the same orders.
There is one database (the ERP's) and one place to manage everything (the ERP).

```
 Customers                               Staff and administrators
     │                                            │
     ▼                                            ▼
 Online store (ecommerce/)                Al-Hayat ERP staff app (web/)
 Next.js on Cloudflare Workers            Products · Website panel · Web Orders
 shop domain, e.g. alhayat.so             al-hayat-erp.pages.dev
     │  public catalog, cart prices,              │  signed-in staff, permissions
     │  order placement, order tracking           │
     └──────────────┬─────────────────────────────┘
                    ▼
        ERP backend (al-hayat-api Worker)  ──►  Postgres (Layerbase)
        /storefront/*      (public, read-only + order placement with a server key)
        /storefront-admin/* (staff: publishing, photos, orders, settings)
        sales, inventory, accounting (the normal ERP routes)
                    │
                    ▼
        R2 bucket: product and category photos (public address)
```

## What already exists (built in PRs #2–#4, not yet deployed)

| Need | Where it is today |
|---|---|
| Add, edit, delete products; price, category, description | ERP → **Products** (the one product list for the shop and the showroom) |
| Product photos and gallery (upload, order, main photo, delete) | ERP → Products → **Website** button on a product. Photos go straight to R2 |
| Show/hide a product on the shop, web address, web description, "was" price, featured | Same **Website** panel (**Publish** / **Remove from website**) |
| Shop categories with pictures | Products → **Website categories** |
| Stock the shop sells from | ERP stock of **one branch** chosen in Web Orders → **Website settings**, minus a safety buffer |
| No overselling | An order from the shop **reserves** its units at once (`storefront_reservations`); two customers cannot buy the same last piece |
| Online sales update inventory | Staff convert an order to a normal **sales order**; completing it deducts stock and posts the accounts like any sale, and releases the reservation |
| Order statuses | Web Orders shows each order's stage: New → Invoiced → Paid → Delivery scheduled → Out for delivery → Delivered / Cancelled |
| Customer shop | `ecommerce/`: home, search and categories, product pages with gallery and stock status, cart, checkout, thank-you page |
| Security | The shop never sees cost, SKU or exact stock; prices always come from the ERP (a tampered price is ignored); orders need a server key; spam and rate limits |

## Gaps (what this plan adds)

1. **Not live.** Photo storage (R2) is not configured, which is the warning on
   Web Orders, and the shop is not deployed.
2. **Not instant.** The shop caches the catalog for 60 seconds.
3. **No customer order tracking.** After ordering, a customer cannot see the
   status.
4. **Staff are not alerted** to a new online order.
5. **Payments are offline only.** An order is a request; staff confirm by
   phone; payment is taken on delivery or in the showroom.
6. **Management is spread out**: Products, the Website panel and Web Orders.
   There is no single "Online store" area showing what is on the shop, with
   its web stock and photos.
7. **The shop shows "In stock / Few left / Sold out", not quantities.**

## How each part works after this plan

**Products and photos (staff).** Products are created and priced in ERP →
Products as today. The new **Online store** section lists every product with:
on the shop or not, photo count, web stock (sellable units at the web branch),
and price, with Publish/Unpublish and the photo gallery one click away.
Deleting a product that was ever sold stays blocked; it is unpublished and
deactivated instead.

**Real-time sync.** The shop asks the ERP live for anything that decides a
purchase (product page, cart, checkout): no cache. Listing pages may cache for
a few seconds, and the ERP tells the shop to refresh at once when a product,
price, photo or stock level changes. A price changed in the ERP is the price
on the shop within seconds, and an item sold in the showroom disappears from
the shop when the last unit goes.

**Stock.** There is one stock figure: the ERP's, at the web branch.
Sellable = on hand − reserved − safety buffer. A shop order reserves; a
completed sale deducts (and releases the reservation); a cancelled order
releases. Stock in a warehouse is transferred to the web branch to be sold
online, as for the showroom.

**Orders.** An order placed on the shop appears in ERP → Online store →
Orders at once, with a notification to sales staff. Its life:

```
NEW (stock reserved) → CONFIRMED (staff called the customer) → sales order
  → PAID (payment recorded) → OUT FOR DELIVERY → DELIVERED
  any time before delivery → CANCELLED (reservation released)
```

The customer sees the same status on the shop's **Track your order** page
(order number + phone number), in Somali and English.

**Payments.** Phase 1 keeps cash/mobile money on delivery, recorded in the ERP
as today. Phase 2 adds online payment through a mobile-money gateway; a paid
order is confirmed automatically, without the phone call.

**Access.**
- Customers: the shop's public address (a custom domain such as
  `alhayat.so`, or `al-hayat-storefront.<subdomain>.workers.dev` until then).
  No account needed: they order with name, phone and address.
- Staff: the ERP as today. Online store permissions follow the ERP roles:
  `manage_inventory` for products, photos and publishing, `manage_sales` for
  orders, administrators for settings.

## Phases

**Phase 1: live and connected** (no business decisions needed). Built: the
ERP's Online Store section, live catalog, staff alerts, Track your order,
the quantities setting, deploy configuration. Setup steps:
`docs/DEPLOY_CLOUDFLARE.md` section 4.
1. Configure R2 photo storage: bucket, public domain, CORS, backend secrets.
2. Deploy the shop Worker, with a service binding to the backend.
3. Real-time: no cache on product, cart and checkout; instant refresh on changes.
4. ERP **Online store** section: overview (today's orders and revenue, low web
   stock), products on the shop, orders, categories, settings.
5. Notify sales staff of new online orders.
6. Customer **Track your order** page.
7. Setting: show exact quantities on the shop, or only In stock / Few left.

**Phase 2: payments and automation** (needs the decisions below)
1. Online payment through a mobile-money gateway, with the merchant account
   chosen; webhook to mark paid; refunds.
2. Paid orders confirmed and converted automatically; stock deducted on
   payment.
3. SMS or WhatsApp messages to the customer at each stage.
4. Optional customer accounts (order history, saved address).

## Decisions needed

1. **Payment:** which mobile money / gateway (e.g. ZAAD, eDahab, WaafiPay),
   and do you already have a merchant account? Until then: pay on delivery.
2. **Confirmation:** keep a staff phone call for every order, or confirm
   automatically once paid?
3. **Shop address:** a custom domain? Which one?
4. **Quantities:** show exact stock to customers, or only In stock / Few left?
