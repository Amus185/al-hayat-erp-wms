import { AlertTriangle, Boxes, CircleDollarSign, ScanLine, Truck } from 'lucide-react';
import { MetricCard } from '../../components/MetricCard';

/**
 * Static dashboard placeholder — the real dashboard is DashboardPage.tsx
 * which fetches live data from the API.
 * This component is kept as a fallback but contains no mockup data.
 */
export function Dashboard() {
  return (
    <div className="dashboard">
      <section className="metric-grid">
        <MetricCard label="Total inventory value" value="—" trend="Loading..." icon={<CircleDollarSign size={22} />} />
        <MetricCard label="Available Products" value="—" trend="Loading..." icon={<Boxes size={22} />} />
        <MetricCard label="Active transfers" value="—" trend="Loading..." icon={<Truck size={22} />} />
        <MetricCard label="Operations today" value="—" trend="Loading..." icon={<ScanLine size={22} />} />
      </section>

      <section className="work-grid">
        <div className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p>Inventory Risk</p>
              <h2>Low stock requiring action</h2>
            </div>
          </div>
          <p style={{ padding: '20px', color: '#667066', textAlign: 'center' }}>
            No data available. Use the main dashboard for live metrics.
          </p>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div>
              <p>Alerts</p>
              <h2>Realtime operations</h2>
            </div>
            <AlertTriangle size={18} />
          </div>
          <p style={{ padding: '20px', color: '#667066', textAlign: 'center' }}>
            No alerts at this time.
          </p>
        </div>
      </section>
    </div>
  );
}
