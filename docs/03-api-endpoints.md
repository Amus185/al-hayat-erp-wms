# API Endpoint Map

All protected endpoints require `Authorization: Bearer <accessToken>`.

## Authentication

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | Login with email/password | Public |
| `POST` | `/auth/refresh` | Rotate refresh token | Public |
| `POST` | `/auth/logout` | Revoke refresh token | Authenticated |
| `POST` | `/auth/password-reset/request` | Send reset token | Public |
| `POST` | `/auth/password-reset/confirm` | Reset password | Public |
| `GET` | `/auth/me` | Current user profile | Authenticated |

## Users and RBAC

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/users` | List users | `users.manage` |
| `POST` | `/users` | Create user | `users.manage` |
| `GET` | `/users/:id` | Get user | `users.manage` |
| `PATCH` | `/users/:id` | Update user | `users.manage` |
| `PATCH` | `/users/:id/roles` | Assign roles | `users.manage` |
| `GET` | `/roles` | List roles and permissions | `users.manage` |

## Products

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/products` | Search products by SKU, barcode, category, brand | `products.read` |
| `POST` | `/products` | Create product | `products.write` |
| `GET` | `/products/:id` | Product detail and history | `products.read` |
| `PATCH` | `/products/:id` | Update product | `products.write` |
| `POST` | `/products/:id/images` | Upload image to MinIO | `products.write` |
| `GET` | `/products/barcode/:barcode` | Barcode lookup | `products.read` |

## Warehouses

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/warehouses` | List warehouses | `inventory.read` |
| `POST` | `/warehouses` | Create warehouse | `inventory.adjust` |
| `GET` | `/warehouses/:id/locations` | Location tree | `inventory.read` |
| `POST` | `/warehouses/:id/locations` | Add aisle/rack/shelf/bin | `inventory.adjust` |

## Inventory

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/inventory/stock` | Current stock by filters | `inventory.read` |
| `GET` | `/inventory/transactions` | Movement history | `inventory.read` |
| `POST` | `/inventory/adjustments` | Stock adjustment | `inventory.adjust` |
| `POST` | `/inventory/counts` | Create stock count | `inventory.count` |
| `PATCH` | `/inventory/counts/:id/submit` | Submit count variance | `inventory.count` |
| `GET` | `/inventory/low-stock` | Low stock report | `inventory.read` |

## Branches

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/branches` | List all branches | `inventory.read` |
| `GET` | `/branches/:id/inventory` | Branch inventory | `inventory.read` |
| `GET` | `/branches/:id/performance` | Branch KPIs | `reports.read` |

## Transfers

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/transfers` | Search transfers | `transfers.create` |
| `POST` | `/transfers` | Create transfer | `transfers.create` |
| `GET` | `/transfers/:id` | Transfer detail | `transfers.create` |
| `PATCH` | `/transfers/:id/approve` | Approve transfer | `transfers.approve` |
| `PATCH` | `/transfers/:id/reject` | Reject transfer | `transfers.approve` |
| `PATCH` | `/transfers/:id/dispatch` | Dispatch transfer and write stock out | `transfers.dispatch` |
| `PATCH` | `/transfers/:id/receive` | Receive transfer and write stock in | `transfers.receive` |

## Purchasing

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/suppliers` | Supplier list | `purchasing.write` |
| `POST` | `/suppliers` | Create supplier | `purchasing.write` |
| `GET` | `/purchase-orders` | Search POs | `purchasing.write` |
| `POST` | `/purchase-orders` | Create PO | `purchasing.write` |
| `PATCH` | `/purchase-orders/:id/approve` | Approve PO | `purchasing.approve` |
| `POST` | `/goods-receipts` | Receive stock against PO | `purchasing.write` |
| `POST` | `/supplier-payments` | Record payment | `purchasing.write` |

## Sales

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/customers` | Customer list | `sales.write` |
| `POST` | `/customers` | Create customer | `sales.write` |
| `POST` | `/quotations` | Create quotation | `sales.write` |
| `POST` | `/sales-orders` | Create order | `sales.write` |
| `PATCH` | `/sales-orders/:id/confirm` | Confirm order and reserve stock | `sales.write` |
| `POST` | `/sales-orders/:id/invoice` | Issue invoice and post stock issue | `sales.write` |
| `PATCH` | `/invoices/:id/pay` | Mark invoice paid | `sales.write` |

## Reports

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/reports/inventory-value` | Inventory valuation | `reports.read` |
| `GET` | `/reports/sales` | Sales analytics | `reports.read` |
| `GET` | `/reports/branches` | Branch analytics | `reports.read` |
| `GET` | `/reports/profit` | Profit analysis | `reports.read` |
| `GET` | `/reports/low-stock` | Low stock report | `reports.read` |

## Notifications and Audit

| Method | Path | Description | Permission |
| --- | --- | --- | --- |
| `GET` | `/notifications` | Current user notifications | Authenticated |
| `PATCH` | `/notifications/:id/read` | Mark read | Authenticated |
| `GET` | `/audit-logs` | Search audit trail | `audit.read` |
| `GET` | `/files` | List uploaded file metadata | `products.write` |
| `POST` | `/files` | Register uploaded MinIO object metadata | `products.write` |
| `GET` | `/files/presigned-put-url` | Generate MinIO upload URL | `products.write` |
