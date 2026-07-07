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
    columns: ['Product ID', 'Product', 'Category', 'Price', 'Status'],
    rows: [],
    sideTitle: 'Product Controls',
    sideItems: ['Product ID and barcode validation', 'Variant-level stock history', 'Image upload metadata']
  },
  Warehouses: {
    eyebrow: 'Locations',
    title: 'Warehouses, aisles, racks, shelves, and bins',
    action: 'Add Bin',
    icon: Boxes,
    columns: ['Warehouse', 'Aisle', 'Rack', 'Shelf', 'Bin'],
    rows: [],
    sideTitle: 'Location Rules',
    sideItems: ['Unique bin barcode', 'Putaway by scanned location', 'Stock by exact bin']
  },
  Inventory: {
    eyebrow: 'Stock Ledger',
    title: 'Realtime stock, adjustments, history, and counts',
    action: 'Adjust Stock',
    icon: ClipboardCheck,
    columns: ['Product', 'Location', 'On hand', 'Reserved', 'Available'],
    rows: [],
    sideTitle: 'Inventory Safety',
    sideItems: ['Append-only transaction ledger', 'Low stock event stream', 'Cycle count variance posting']
  },
  Branches: {
    eyebrow: 'Retail Network',
    title: 'Branch inventory and performance monitoring',
    action: 'Branch Report',
    icon: Building2,
    columns: ['Branch', 'City', 'Inventory Value', 'Orders', 'Status'],
    rows: [],
    sideTitle: 'Branch Focus',
    sideItems: ['Local inventory visibility', 'Branch transfer demand', 'Sales and profit KPIs']
  },
  Transfers: {
    eyebrow: 'Movement',
    title: 'Warehouse-to-branch and branch-to-branch transfers',
    action: 'New Transfer',
    icon: Truck,
    columns: ['Transfer', 'Source', 'Destination', 'Lines', 'Status'],
    rows: [],
    sideTitle: 'Workflow',
    sideItems: ['Request and approval', 'Dispatch scan validation', 'Receive variance tracking']
  },
  Purchasing: {
    eyebrow: 'Procurement',
    title: 'Suppliers, purchase orders, receipts, and payments',
    action: 'Create PO',
    icon: PackagePlus,
    columns: ['PO', 'Supplier', 'Expected', 'Lines', 'Status'],
    rows: [],
    sideTitle: 'Receiving',
    sideItems: ['PO line matching', 'Bin-level putaway', 'Inventory ledger posting']
  },
  Sales: {
    eyebrow: 'Revenue',
    title: 'Customers, quotations, orders, invoices, and payments',
    action: 'New Order',
    icon: ShoppingCart,
    columns: ['Order', 'Customer', 'Branch', 'Amount', 'Status'],
    rows: [],
    sideTitle: 'Sales Controls',
    sideItems: ['Branch stock checks', 'Invoice generation', 'Payment status tracking']
  },
  Reports: {
    eyebrow: 'Management',
    title: 'Inventory value, sales, branch, profit, and low stock reports',
    action: 'Export',
    icon: ReceiptText,
    columns: ['Report', 'Metric', 'Period', 'Owner', 'Status'],
    rows: [],
    sideTitle: 'Report Model',
    sideItems: ['Indexed read queries', 'Materialized view ready', 'Branch comparison KPIs']
  },
  Audit: {
    eyebrow: 'Governance',
    title: 'Critical action tracking and inventory movement audit',
    action: 'Filter',
    icon: FileClock,
    columns: ['Time', 'Actor', 'Action', 'Entity', 'Reference'],
    rows: [],
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
