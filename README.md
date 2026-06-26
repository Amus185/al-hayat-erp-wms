# Al Hayat ERP + WMS

Production-grade TypeScript scaffold for Al Hayat Furniture Group covering ERP, WMS, barcode operations, inventory, purchasing, sales, branch transfers, reporting, RBAC, realtime alerts, and MinIO-backed media storage.

## Included

- Complete database schema in `database/schema.sql`
- Seed roles, permissions, branches, warehouses, categories, and brands in `database/seed.sql`
- Architecture, endpoint, entity relationship, UI, and folder-structure documentation in `docs/`
- NestJS backend with strict TypeScript, DTO validation, repository pattern, JWT guard, RBAC guard, Swagger, PostgreSQL, and Socket.IO gateway
- React web ERP dashboard using Al Hayat brand colors
- React Native mobile WMS app for scan-first warehouse workflows
- Docker Compose for PostgreSQL and MinIO

## Local Startup

1. Install dependencies:

```bash
npm install
```

2. Start infrastructure:

```bash
docker compose up -d
```

3. Copy environment:

```bash
cp .env.example backend/.env
```

4. Start backend:

```bash
npm run dev:backend
```

5. Start web app:

```bash
npm run dev:web
```

6. Start mobile app:

```bash
npm run dev:mobile
```

## Backend Modules

- `auth`: login, refresh hook, password reset hooks, current user
- `users`: create/list users with role assignment
- `products`: product creation, search, barcode lookup
- `inventory`: stock list, transaction list, stock adjustment, realtime event emit
- `transfers`: create, approve, dispatch, receive, stock movement ledger writes, realtime status events
- `warehouses`: warehouse list and bin-location management
- `branches`: branch list, branch inventory, and branch performance
- `purchasing`: suppliers, purchase orders, approvals, and goods receipts
- `sales`: customers, sales orders, invoices, and payments
- `reports`: inventory value, sales, branches, profit, and low-stock reports
- `notifications`: user and broadcast operational alerts
- `audit-logs`: searchable governance trail
- `files`: MinIO presigned upload URLs and file metadata registration

## Production Hardening Checklist

- Add migration tooling such as Prisma Migrate, TypeORM migrations, or node-pg-migrate.
- Replace refresh hook with hashed rotating refresh tokens using `refresh_tokens`.
- Add MinIO service implementation with signed URLs, bucket policies, image validation, and virus scanning.
- Add reservation logic for sales orders before invoice issue.
- Add report materialized views for inventory value, branch performance, and profit.
- Add audit interceptor that records old/new values for critical actions.
- Add OpenTelemetry tracing, structured logging, rate limits, and health checks.
- Add CI for linting, typechecking, tests, and Docker image builds.
- Add mobile camera scanner permission handling and offline idempotency queue.

## Brand Colors

- Primary: `#0B8F08`
- Secondary Green: `#066006`
- Accent Yellow: `#F3D400`
- Background: `#F7F9F7`
- Text: `#1A1A1A`
