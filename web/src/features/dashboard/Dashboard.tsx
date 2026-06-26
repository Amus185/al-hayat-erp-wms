import { AlertTriangle, Boxes, CircleDollarSign, ScanLine, Truck } from 'lucide-react';
import { DataTable } from '../../components/DataTable';
import { MetricCard } from '../../components/MetricCard';
import { StatusBadge } from '../../components/StatusBadge';

const lowStockRows = [
  ['AH-SF-1100', 'Modern Sofa - Grey', 'Central / A-02-R4-S1-B8', '3', <StatusBadge key="a" label="Low" tone="yellow" />],
  ['AH-BD-2201', 'King Storage Bed - Walnut', 'Branch 12', '1', <StatusBadge key="b" label="Critical" tone="red" />],
  ['AH-DT-9010', 'Oak Dining Table 8 Seat', 'Central / C-01-R2-S3-B5', '4', <StatusBadge key="c" label="Low" tone="yellow" />]
];

const transferRows = [
  ['TR-20260603-1041', 'Central Warehouse', 'Branch 07', '18 items', <StatusBadge key="a" label="Pending" tone="yellow" />],
  ['TR-20260603-1036', 'Branch 03', 'Branch 19', '4 items', <StatusBadge key="b" label="Approved" tone="green" />],
  ['TR-20260602-9912', 'East Warehouse', 'Branch 22', '33 items', <StatusBadge key="c" label="Dispatched" tone="neutral" />]
];

export function Dashboard() {
  return (
    <div className="dashboard">
      <section className="metric-grid">
        <MetricCard label="Total inventory value" value="SAR 48.2M" trend="+4.8% this month" icon={<CircleDollarSign size={22} />} />
        <MetricCard label="Available SKUs" value="38,420" trend="30 branches connected" icon={<Boxes size={22} />} />
        <MetricCard label="Active transfers" value="126" trend="21 awaiting approval" icon={<Truck size={22} />} />
        <MetricCard label="Scans today" value="9,842" trend="Receiving and counts" icon={<ScanLine size={22} />} />
      </section>

      <section className="work-grid">
        <div className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p>Inventory Risk</p>
              <h2>Low stock requiring action</h2>
            </div>
            <button type="button">Create PO</button>
          </div>
          <DataTable columns={['SKU', 'Product', 'Location', 'Available', 'Status']} rows={lowStockRows} />
        </div>

        <div className="panel">
          <div className="panel__header">
            <div>
              <p>Alerts</p>
              <h2>Realtime operations</h2>
            </div>
            <AlertTriangle size={18} />
          </div>
          <ul className="alert-list">
            <li><strong>Branch 12</strong><span>Stock count variance posted for 14 variants.</span></li>
            <li><strong>Central WH</strong><span>Goods receipt GR-8841 is ready for putaway.</span></li>
            <li><strong>Branch 07</strong><span>Transfer TR-1041 needs approval.</span></li>
          </ul>
        </div>

        <div className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p>Transfers</p>
              <h2>Approval and dispatch queue</h2>
            </div>
            <button type="button">New Transfer</button>
          </div>
          <DataTable columns={['Transfer', 'Source', 'Destination', 'Lines', 'Status']} rows={transferRows} />
        </div>
      </section>
    </div>
  );
}

