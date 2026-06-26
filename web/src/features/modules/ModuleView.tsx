import type { ReactNode } from 'react';
import { Boxes, Building2, ClipboardCheck, FileClock, PackagePlus, PackageSearch, ReceiptText, ShoppingCart, Truck } from 'lucide-react';
import type { WebModule } from '../../App';
import { DataTable } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';

type ModuleConfig = {
  eyebrow: string;
  title: string;
  action: string;
  icon: typeof Boxes;
  columns: string[];
  rows: ReactNode[][];
  sideTitle: string;
  sideItems: string[];
};

const moduleConfig: Record<Exclude<WebModule, 'Dashboard'>, ModuleConfig> = {
  Products: {
    eyebrow: 'Catalog',
    title: 'Products, variants, images, and barcode lookup',
    action: 'New Product',
    icon: PackageSearch,
    columns: ['SKU', 'Product', 'Category', 'Price', 'Status'],
    rows: [
      ['AH-SF-1100', 'Modern Sofa - Grey', 'Sofas', 'SAR 3,200', <StatusBadge key="1" label="Active" tone="green" />],
      ['AH-BD-2201', 'King Storage Bed - Walnut', 'Beds', 'SAR 4,850', <StatusBadge key="2" label="Active" tone="green" />],
      ['AH-WR-7730', 'Four Door Wardrobe', 'Wardrobes', 'SAR 2,900', <StatusBadge key="3" label="Image needed" tone="yellow" />]
    ],
    sideTitle: 'Product Controls',
    sideItems: ['SKU and barcode validation', 'Variant-level stock history', 'MinIO image upload metadata']
  },
  Warehouses: {
    eyebrow: 'Locations',
    title: 'Warehouses, aisles, racks, shelves, and bins',
    action: 'Add Bin',
    icon: Boxes,
    columns: ['Warehouse', 'Aisle', 'Rack', 'Shelf', 'Bin'],
    rows: [
      ['Central WH', 'A-02', 'R4', 'S1', 'B8'],
      ['Central WH', 'C-01', 'R2', 'S3', 'B5'],
      ['East WH', 'E-04', 'R7', 'S2', 'B1']
    ],
    sideTitle: 'Location Rules',
    sideItems: ['Unique bin barcode', 'Putaway by scanned location', 'Stock by exact bin']
  },
  Inventory: {
    eyebrow: 'Stock Ledger',
    title: 'Realtime stock, adjustments, history, and counts',
    action: 'Adjust Stock',
    icon: ClipboardCheck,
    columns: ['Product', 'Location', 'On hand', 'Reserved', 'Available'],
    rows: [
      ['Modern Sofa - Grey', 'Central / A-02-R4-S1-B8', '32', '4', '28'],
      ['King Storage Bed', 'Branch 12', '7', '2', '5'],
      ['Oak Dining Table', 'East / E-04-R7-S2-B1', '14', '1', '13']
    ],
    sideTitle: 'Inventory Safety',
    sideItems: ['Append-only transaction ledger', 'Low stock event stream', 'Cycle count variance posting']
  },
  Branches: {
    eyebrow: 'Retail Network',
    title: '30 branch inventory and performance monitoring',
    action: 'Branch Report',
    icon: Building2,
    columns: ['Branch', 'City', 'Inventory Value', 'Orders', 'Status'],
    rows: [
      ['BR-001', 'Riyadh', 'SAR 2.4M', '486', <StatusBadge key="1" label="Healthy" tone="green" />],
      ['BR-012', 'Jeddah', 'SAR 1.8M', '342', <StatusBadge key="2" label="Low stock" tone="yellow" />],
      ['BR-027', 'Dammam', 'SAR 1.1M', '214', <StatusBadge key="3" label="Counting" tone="neutral" />]
    ],
    sideTitle: 'Branch Focus',
    sideItems: ['Local inventory visibility', 'Branch transfer demand', 'Sales and profit KPIs']
  },
  Transfers: {
    eyebrow: 'Movement',
    title: 'Warehouse-to-branch and branch-to-branch transfers',
    action: 'New Transfer',
    icon: Truck,
    columns: ['Transfer', 'Source', 'Destination', 'Lines', 'Status'],
    rows: [
      ['TR-1041', 'Central WH', 'Branch 07', '18', <StatusBadge key="1" label="Pending" tone="yellow" />],
      ['TR-1036', 'Branch 03', 'Branch 19', '4', <StatusBadge key="2" label="Approved" tone="green" />],
      ['TR-9912', 'East WH', 'Branch 22', '33', <StatusBadge key="3" label="Dispatched" tone="neutral" />]
    ],
    sideTitle: 'Workflow',
    sideItems: ['Request and approval', 'Dispatch scan validation', 'Receive variance tracking']
  },
  Purchasing: {
    eyebrow: 'Procurement',
    title: 'Suppliers, purchase orders, receipts, and payments',
    action: 'Create PO',
    icon: PackagePlus,
    columns: ['PO', 'Supplier', 'Expected', 'Lines', 'Status'],
    rows: [
      ['PO-8840', 'Al Hayat Signature', '2026-06-12', '24', <StatusBadge key="1" label="Approved" tone="green" />],
      ['PO-8841', 'Al Hayat Modern', '2026-06-14', '15', <StatusBadge key="2" label="Receiving" tone="yellow" />],
      ['PO-8842', 'Al Hayat Classic', '2026-06-18', '31', <StatusBadge key="3" label="Submitted" tone="neutral" />]
    ],
    sideTitle: 'Receiving',
    sideItems: ['PO line matching', 'Bin-level putaway', 'Inventory ledger posting']
  },
  Sales: {
    eyebrow: 'Revenue',
    title: 'Customers, quotations, orders, invoices, and payments',
    action: 'New Order',
    icon: ShoppingCart,
    columns: ['Order', 'Customer', 'Branch', 'Amount', 'Status'],
    rows: [
      ['SO-4811', 'Walk-in Customer', 'BR-001', 'SAR 8,400', <StatusBadge key="1" label="Invoiced" tone="green" />],
      ['SO-4812', 'Royal Villa Project', 'BR-012', 'SAR 62,700', <StatusBadge key="2" label="Confirmed" tone="yellow" />],
      ['SO-4813', 'Corporate Office', 'BR-027', 'SAR 24,200', <StatusBadge key="3" label="Draft" tone="neutral" />]
    ],
    sideTitle: 'Sales Controls',
    sideItems: ['Branch stock checks', 'Invoice generation', 'Payment status tracking']
  },
  Reports: {
    eyebrow: 'Management',
    title: 'Inventory value, sales, branch, profit, and low stock reports',
    action: 'Export',
    icon: ReceiptText,
    columns: ['Report', 'Metric', 'Period', 'Owner', 'Status'],
    rows: [
      ['Inventory Value', 'SAR 48.2M', 'Today', 'Finance', <StatusBadge key="1" label="Live" tone="green" />],
      ['Profit Analysis', 'SAR 6.8M', 'Month', 'Management', <StatusBadge key="2" label="Live" tone="green" />],
      ['Low Stock', '128 SKUs', 'Today', 'Purchasing', <StatusBadge key="3" label="Action" tone="yellow" />]
    ],
    sideTitle: 'Report Model',
    sideItems: ['Indexed read queries', 'Materialized view ready', 'Branch comparison KPIs']
  },
  Audit: {
    eyebrow: 'Governance',
    title: 'Critical action tracking and inventory movement audit',
    action: 'Filter',
    icon: FileClock,
    columns: ['Time', 'Actor', 'Action', 'Entity', 'Reference'],
    rows: [
      ['09:32', 'Warehouse Manager', 'TRANSFER_APPROVED', 'Transfer', 'TR-1041'],
      ['09:18', 'Inventory Staff', 'STOCK_ADJUSTED', 'Inventory', 'AH-SF-1100'],
      ['08:56', 'Sales Staff', 'INVOICE_CREATED', 'Invoice', 'INV-4811']
    ],
    sideTitle: 'Audit Coverage',
    sideItems: ['User and timestamp', 'Old/new JSON values', 'Critical workflow records']
  }
};

export function ModuleView({ module }: { module: Exclude<WebModule, 'Dashboard'> }) {
  const config = moduleConfig[module];
  const Icon = config.icon;

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon"><Icon size={24} /></div>
        <div>
          <p>{config.eyebrow}</p>
          <h2>{config.title}</h2>
        </div>
        <button type="button">{config.action}</button>
      </section>

      <section className="work-grid">
        <div className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p>{module}</p>
              <h2>Operational worklist</h2>
            </div>
          </div>
          <DataTable columns={config.columns} rows={config.rows} />
        </div>
        <div className="panel">
          <div className="panel__header">
            <div>
              <p>Controls</p>
              <h2>{config.sideTitle}</h2>
            </div>
          </div>
          <ul className="alert-list">
            {config.sideItems.map((item) => (
              <li key={item}><strong>{item}</strong><span>Backed by API, RBAC, audit, and reporting boundaries.</span></li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

