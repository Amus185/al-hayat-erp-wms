// ─── Al Hayat ERP+WMS — Shared TypeScript Types ───
// Single source of truth for API contracts

// ── Auth ────────────────────────────────────────────
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  permissions: string[];
}

export interface RefreshRequest {
  refreshToken: string;
}

// ── Users ───────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  roles?: Role[];
}

export interface Role {
  id: string;
  name: string;
  description: string;
}

export interface Permission {
  id: string;
  code: string;
  description: string;
}

export interface CreateUserRequest {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  roleIds: string[];
}

// ── Products ────────────────────────────────────────
export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  description: string | null;
  category_id: string | null;
  brand_id: string | null;
  cost_price: number;
  selling_price: number;
  reorder_level: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined fields
  category?: string;
  brand?: string;
  images?: ProductImage[];
}



export interface ProductImage {
  id: string;
  product_id: string;
  file_id: string;
  sort_order: number;
  url?: string;
}

export interface CreateProductRequest {
  sku: string;
  barcode: string;
  name: string;
  description?: string;
  categoryId?: string;
  brandId?: string;
  costPrice: number;
  sellingPrice: number;
  reorderLevel?: number;
}

// ── Categories & Brands ─────────────────────────────
export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  children?: Category[];
}

export interface Brand {
  id: string;
  name: string;
}

// ── Warehouses & Locations ──────────────────────────
export interface Warehouse {
  id: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  location_count?: number;
}

export interface WarehouseLocation {
  id: string;
  warehouse_id: string;
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  barcode: string | null;
  // Computed
  label?: string;
}

export interface CreateLocationRequest {
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  barcode?: string;
}

// ── Branches ────────────────────────────────────────
export interface Branch {
  id: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  // Computed
  inventory_value?: number;
  total_orders?: number;
  sku_count?: number;
}

// ── Inventory ───────────────────────────────────────
export interface InventoryStock {
  id: string;
  product_id: string;
  owner_type: 'WAREHOUSE' | 'BRANCH';
  warehouse_id: string | null;
  branch_id: string | null;
  warehouse_location_id: string | null;
  quantity_on_hand: number;
  quantity_reserved: number;
  updated_at: string;
  // Joined
  name?: string;
  sku?: string;
  barcode?: string;
  warehouse?: string;
  branch?: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
  bin?: string;
}

export interface InventoryTransaction {
  id: string;
  product_id: string;
  transaction_type: TransactionType;
  quantity: number;
  notes: string | null;
  created_by: string;
  created_at: string;
  reference_type: string | null;
  reference_id: string | null;
  // Joined
  name?: string;
  sku?: string;
  barcode?: string;
}

export type TransactionType =
  | 'GOODS_RECEIPT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'SALE_ISSUE'
  | 'ADJUSTMENT_POSITIVE'
  | 'ADJUSTMENT_NEGATIVE'
  | 'STOCK_COUNT';

export interface CreateAdjustmentRequest {
  productId: string;
  direction: 'increase' | 'decrease';
  quantity: number;
  warehouseId?: string;
  branchId?: string;
  warehouseLocationId?: string;
  notes?: string;
}

// ── Transfers ───────────────────────────────────────
export type TransferStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'DISPATCHED'
  | 'RECEIVED'
  | 'CANCELLED';

export interface Transfer {
  id: string;
  transfer_number: string;
  status: TransferStatus;
  source_owner_type: 'WAREHOUSE' | 'BRANCH';
  source_warehouse_id: string | null;
  source_branch_id: string | null;
  destination_owner_type: 'WAREHOUSE' | 'BRANCH';
  destination_warehouse_id: string | null;
  destination_branch_id: string | null;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  dispatched_by: string | null;
  dispatched_at: string | null;
  received_by: string | null;
  received_at: string | null;
  // Joined
  source_name?: string;
  destination_name?: string;
  requester_name?: string;
  line_count?: number;
  lines?: TransferLine[];
}

export interface TransferLine {
  id: string;
  transfer_id: string;
  product_id: string;
  quantity_requested: number;
  quantity_dispatched: number;
  quantity_received: number;
  // Joined
  product_barcode?: string;
  product_name?: string;
}

export interface CreateTransferRequest {
  sourceOwnerType: 'WAREHOUSE' | 'BRANCH';
  sourceWarehouseId?: string;
  sourceBranchId?: string;
  destinationOwnerType: 'WAREHOUSE' | 'BRANCH';
  destinationWarehouseId?: string;
  destinationBranchId?: string;
  lines: { productId: string; quantityRequested: number }[];
}

// ── Purchasing ──────────────────────────────────────
export type PurchaseStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'PARTIALLY_RECEIVED'
  | 'FULLY_RECEIVED'
  | 'CANCELLED';

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
}

export interface CreateSupplierRequest {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  status: PurchaseStatus;
  expected_date: string | null;
  total_amount: number;
  notes: string | null;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  // Joined
  supplier_name?: string;
  line_count?: number;
  lines?: PurchaseOrderLine[];
}

export interface PurchaseOrderLine {
  id: string;
  purchase_order_id: string;
  product_id: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  // Joined
  product_barcode?: string;
  product_name?: string;
}

export interface CreatePurchaseOrderRequest {
  supplierId: string;
  expectedDate?: string;
  notes?: string;
  warehouseId: string;
  lines: { productId: string; quantityOrdered: number; unitCost: number }[];
}

export interface CreateGoodsReceiptRequest {
  purchaseOrderId: string;
  warehouseId: string;
  lines: { productId: string; quantityReceived: number; warehouseLocationId?: string }[];
}

// ── Sales ───────────────────────────────────────────
export type SalesStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'INVOICED'
  | 'PAID'
  | 'CANCELLED';

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
}

export interface CreateCustomerRequest {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface SalesOrder {
  id: string;
  order_number: string;
  customer_id: string;
  branch_id: string;
  status: SalesStatus;
  total_amount: number;
  notes: string | null;
  created_by: string;
  created_at: string;
  // Joined
  customer_name?: string;
  branch_name?: string;
  line_count?: number;
  lines?: SalesOrderLine[];
}

export interface SalesOrderLine {
  id: string;
  sales_order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  // Joined
  product_barcode?: string;
  product_name?: string;
}

export interface CreateSalesOrderRequest {
  customerId: string;
  branchId: string;
  notes?: string;
  lines: { productId: string; quantity: number; unitPrice: number }[];
}

export interface Invoice {
  id: string;
  invoice_number: string;
  sales_order_id: string;
  total_amount: number;
  status: 'UNPAID' | 'PAID' | 'CANCELLED';
  created_at: string;
  paid_at: string | null;
  // Joined
  customer_name?: string;
  order_number?: string;
}

// ── Reports ─────────────────────────────────────────
export interface InventoryValueReport {
  total_value: number;
  total_skus: number;
  by_warehouse: { warehouse: string; value: number; sku_count: number }[];
  by_category: { category: string; value: number; sku_count: number }[];
}

export interface LowStockItem {
  product_name: string;
  barcode: string;
  current_stock: number;
  reorder_level: number;
  deficit: number;
  warehouse: string | null;
  branch: string | null;
}

export interface SalesReport {
  total_revenue: number;
  total_orders: number;
  avg_order_value: number;
  by_branch: { branch: string; revenue: number; orders: number }[];
  by_period: { period: string; revenue: number; orders: number }[];
}

export interface ProfitReport {
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  margin_percentage: number;
  by_category: { category: string; revenue: number; cost: number; profit: number }[];
}

// ── Notifications ───────────────────────────────────
export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
  entity_type: string | null;
  entity_id: string | null;
}

// ── Audit Logs ──────────────────────────────────────
export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  // Joined
  user_name?: string;
  user_email?: string;
}

// ── Pagination ──────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ── Realtime Events ─────────────────────────────────
export type RealtimeEvent =
  | 'inventory.stock.updated'
  | 'transfer.status_changed'
  | 'purchase.received'
  | 'sales.invoice_created'
  | 'notification.new'
  | 'low_stock.alert';
