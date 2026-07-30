import { useEffect, useState } from 'react';
import {
  BarChart3,
  AlertTriangle,
  Building,
  CircleDollarSign,
  TrendingUp,
  FileText,
  Truck,
  Wallet,
  Calendar,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Package,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { apiGet } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import { PageSkeleton } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';

// Theme Colors
const PRIMARY_GREEN = '#066006';
const SECONDARY_GREEN = '#16a34a';
const AMBER_GOLD = '#d97706';
const ALERT_RED = '#dc2626';
const TEAL_BLUE = '#0284c7';

export function ReportsPage() {
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState('low-stock');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);

  // Auxiliary Filter Options
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Report Data States
  const [lowStockData, setLowStockData] = useState<any[]>([]);
  const [branchPerfData, setBranchPerfData] = useState<any[]>([]);
  const [invValuationData, setInvValuationData] = useState<any>(null);
  const [salesProfitData, setSalesProfitData] = useState<any>(null);
  const [quoteConvData, setQuoteConvData] = useState<any>(null);
  const [supplierPerfData, setSupplierPerfData] = useState<any>(null);
  const [receivablesData, setReceivablesData] = useState<any>(null);

  // Load Metadata (warehouses, categories) for filtering
  useEffect(() => {
    async function loadMeta() {
      try {
        const [whList, catList] = await Promise.all([
          apiGet<any[]>('/warehouses').catch(() => []),
          apiGet<any[]>('/products/categories').catch(() => []),
        ]);
        setWarehouses(whList || []);
        setCategories(catList || []);
      } catch (err) {
        // Non-critical
      }
    }
    loadMeta();
  }, []);

  // Fetch Report Data based on active Tab and Days filter
  const fetchReportData = async () => {
    try {
      setLoading(true);
      if (activeTab === 'low-stock') {
        const query = new URLSearchParams();
        if (selectedWarehouse) query.append('warehouseId', selectedWarehouse);
        if (selectedCategory) query.append('categoryId', selectedCategory);
        const res = await apiGet<any[]>(`/reports/low-stock?${query.toString()}`);
        setLowStockData(res || []);
      } else if (activeTab === 'branch-perf') {
        const res = await apiGet<any[]>(`/reports/branch-performance?days=${days}`);
        setBranchPerfData(res || []);
      } else if (activeTab === 'inv-valuation') {
        const query = selectedCategory ? `?categoryId=${selectedCategory}` : '';
        const res = await apiGet<any>(`/reports/inventory-valuation${query}`);
        setInvValuationData(res);
      } else if (activeTab === 'sales-profit') {
        const res = await apiGet<any>(`/reports/sales-profit?days=${days}`);
        setSalesProfitData(res);
      } else if (activeTab === 'quote-conversion') {
        const res = await apiGet<any>(`/reports/quote-conversion?days=${days}`);
        setQuoteConvData(res);
      } else if (activeTab === 'supplier-perf') {
        const res = await apiGet<any>(`/reports/supplier-performance?days=${days}`);
        setSupplierPerfData(res);
      } else if (activeTab === 'receivables') {
        const res = await apiGet<any>(`/reports/receivables?days=${days}`);
        setReceivablesData(res);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch report analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [activeTab, days, selectedWarehouse, selectedCategory]);

  const reportMenus = [
    { label: 'Inventory', items: [{ key: 'low-stock', label: 'Stock Risk' }, { key: 'inv-valuation', label: 'Inventory Valuation' }] },
    { label: 'Sales', items: [{ key: 'branch-perf', label: 'Branch Performance' }, { key: 'sales-profit', label: 'Sales & Profit' }, { key: 'quote-conversion', label: 'Quote Conversion' }] },
    { label: 'Purchasing', items: [{ key: 'supplier-perf', label: 'Supplier Scorecards' }] },
    { label: 'Finance', items: [{ key: 'receivables', label: 'Receivables & Cash Flow' }] },
  ];

  // Utility Formatter
  const formatCurrency = (val: number | undefined) =>
    `$${Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatPercent = (val: number | undefined) => `${Number(val || 0).toFixed(1)}%`;

  // Render Empty State Chart Box
  const renderChartEmptyState = (message: string) => (
    <div
      style={{
        height: '280px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9fafb',
        borderRadius: '8px',
        border: '1px dashed #d1d5db',
        color: '#6b7280',
        padding: '20px',
        textAlign: 'center',
      }}
    >
      <AlertCircle size={32} style={{ color: AMBER_GOLD, marginBottom: '8px' }} />
      <p style={{ margin: '0 0 4px', fontWeight: '600', color: '#374151' }}>No Chart Data Available</p>
      <p style={{ margin: '0', fontSize: '13px', maxWidth: '400px' }}>{message}</p>
    </div>
  );

  // ==========================================
  // TAB 1: LOW STOCK RISK COLUMNS
  // ==========================================
  const filteredLowStock = lowStockData.filter((item) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      item.product_name?.toLowerCase().includes(term) ||
      item.sku?.toLowerCase().includes(term) ||
      item.category_name?.toLowerCase().includes(term)
    );
  });

  const lowStockColumns: Column<any>[] = [
    { key: 'sku', label: 'SKU / ID', sortable: true },
    {
      key: 'product_name',
      label: 'Product',
      sortable: true,
      render: (row) => <strong>{row.product_name}</strong>,
    },
    {
      key: 'category_name',
      label: 'Category',
      sortable: true,
      render: (row) => row.category_name || 'Uncategorized',
    },
    {
      key: 'location',
      label: 'Location',
      sortable: true,
      render: (row) =>
        row.warehouse_name ? `${row.warehouse_name} (WH)` : row.branch_name ? `${row.branch_name} (Branch)` : row.owner_type,
    },
    {
      key: 'quantity_on_hand',
      label: 'Units Available',
      sortable: true,
      render: (row) => <span style={{ fontWeight: '700', color: row.quantity_on_hand <= 0 ? ALERT_RED : AMBER_GOLD }}>{row.quantity_on_hand}</span>,
    },
    { key: 'reorder_level', label: 'Reorder Target', sortable: true },
    {
      key: 'status_risk',
      label: 'Risk Level',
      sortable: true,
      render: (row) => {
        const isCritical = row.status_risk === 'CRITICAL' || row.quantity_on_hand <= 0;
        return (
          <span
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: '600',
              background: isCritical ? '#fef2f2' : '#fffbeb',
              color: isCritical ? ALERT_RED : AMBER_GOLD,
              border: `1px solid ${isCritical ? '#fecaca' : '#fef3c7'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {isCritical ? <AlertTriangle size={13} /> : <Clock size={13} />}
            {isCritical ? 'CRITICAL (Out of Stock)' : 'LOW (Below Threshold)'}
          </span>
        );
      },
    },
  ];

  // ==========================================
  // TAB 2: BRANCH PERFORMANCE COLUMNS & DATA
  // ==========================================
  const branchColumns: Column<any>[] = [
    { key: 'code', label: 'Code', sortable: true },
    { key: 'name', label: 'Branch Name', sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'city', label: 'City', sortable: true },
    { key: 'order_count', label: 'Sales Orders', sortable: true },
    {
      key: 'total_revenue',
      label: 'Invoiced Revenue',
      sortable: true,
      render: (r) => formatCurrency(r.total_revenue),
    },
    {
      key: 'gross_profit',
      label: 'Gross Profit',
      sortable: true,
      render: (r) => <span style={{ color: PRIMARY_GREEN, fontWeight: '600' }}>{formatCurrency(r.gross_profit)}</span>,
    },
    {
      key: 'margin_pct',
      label: 'Profit Margin',
      sortable: true,
      render: (r) => formatPercent(r.margin_pct),
    },
    {
      key: 'avg_order_value',
      label: 'Avg Order Value',
      sortable: true,
      render: (r) => formatCurrency(r.avg_order_value),
    },
  ];

  // ==========================================
  // TAB 3: INVENTORY VALUATION COLUMNS
  // ==========================================
  const deadStockColumns: Column<any>[] = [
    { key: 'sku', label: 'SKU', sortable: true },
    { key: 'product_name', label: 'Unsold Product', sortable: true, render: (r) => <strong>{r.product_name}</strong> },
    { key: 'category_name', label: 'Category', sortable: true },
    { key: 'units_on_hand', label: 'Unsold Stock', sortable: true, render: (r) => <span style={{ color: ALERT_RED, fontWeight: '600' }}>{r.units_on_hand}</span> },
    { key: 'cost_price', label: 'Unit Cost', sortable: true, render: (r) => formatCurrency(r.cost_price) },
    {
      key: 'tied_up_capital',
      label: 'Tied-up Capital',
      sortable: true,
      render: (r) => <strong style={{ color: ALERT_RED }}>{formatCurrency(r.tied_up_capital)}</strong>,
    },
  ];

  // ==========================================
  // TAB 4: SALES & PROFIT COLUMNS
  // ==========================================
  const topProductsColumns: Column<any>[] = [
    { key: 'sku', label: 'SKU' },
    { key: 'product_name', label: 'Product Name', render: (r) => <strong>{r.product_name}</strong> },
    { key: 'category_name', label: 'Category' },
    { key: 'brand_name', label: 'Brand' },
    { key: 'units_sold', label: 'Units Sold', sortable: true },
    { key: 'revenue', label: 'Gross Revenue', sortable: true, render: (r) => formatCurrency(r.revenue) },
    { key: 'profit', label: 'Gross Profit', sortable: true, render: (r) => <span style={{ color: PRIMARY_GREEN, fontWeight: '600' }}>{formatCurrency(r.profit)}</span> },
    { key: 'margin_pct', label: 'Margin %', sortable: true, render: (r) => formatPercent(r.margin_pct) },
  ];

  const topCustomersColumns: Column<any>[] = [
    { key: 'customer_name', label: 'Customer Name', render: (r) => <strong>{r.customer_name}</strong> },
    { key: 'order_count', label: 'Orders Placed', sortable: true },
    { key: 'total_spent', label: 'Total Revenue', sortable: true, render: (r) => <span style={{ color: PRIMARY_GREEN, fontWeight: '600' }}>{formatCurrency(r.total_spent)}</span> },
    {
      key: 'last_order_date',
      label: 'Last Order',
      sortable: true,
      render: (r) => (r.last_order_date ? new Date(r.last_order_date).toLocaleDateString() : '—'),
    },
  ];

  // ==========================================
  // TAB 5: QUOTE CONVERSION COLUMNS
  // ==========================================
  const quoteColumns: Column<any>[] = [
    { key: 'quotation_number', label: 'Quote #', sortable: true },
    { key: 'customer_name', label: 'Customer', render: (r) => r.customer_name || 'Walk-in Customer' },
    { key: 'branch_name', label: 'Branch' },
    {
      key: 'created_at',
      label: 'Quoted Date',
      render: (r) => new Date(r.created_at).toLocaleDateString(),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => {
        const isConv = r.status === 'ACCEPTED' || r.status === 'CONVERTED' || r.sales_order_number;
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: '600',
              background: isConv ? '#f0fdf4' : '#fef2f2',
              color: isConv ? SECONDARY_GREEN : ALERT_RED,
              border: `1px solid ${isConv ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            {isConv ? '✓ Converted' : r.status || 'DRAFT'}
          </span>
        );
      },
    },
    {
      key: 'sales_order_number',
      label: 'Linked Sales Order',
      render: (r) => (r.sales_order_number ? <span style={{ color: PRIMARY_GREEN, fontWeight: '600' }}>{r.sales_order_number}</span> : '—'),
    },
    {
      key: 'days_to_convert',
      label: 'Lead Time (Days)',
      render: (r) => (r.days_to_convert !== null && r.days_to_convert !== undefined ? `${r.days_to_convert} days` : '—'),
    },
  ];

  // ==========================================
  // TAB 6: SUPPLIER PERFORMANCE COLUMNS
  // ==========================================
  const scorecardColumns: Column<any>[] = [
    { key: 'supplier_name', label: 'Supplier Name', render: (r) => <strong>{r.supplier_name}</strong> },
    { key: 'contact_name', label: 'Contact Person', render: (r) => r.contact_name || '—' },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || r.email || '—' },
    { key: 'total_pos', label: 'Total POs', sortable: true },
    { key: 'received_pos', label: 'Fulfilled POs', sortable: true },
    {
      key: 'on_time_delivery_pct',
      label: 'On-Time Delivery %',
      sortable: true,
      render: (r) => {
        const pct = r.on_time_delivery_pct;
        const color = pct >= 90 ? SECONDARY_GREEN : pct >= 75 ? AMBER_GOLD : ALERT_RED;
        return <span style={{ fontWeight: '700', color }}>{formatPercent(pct)}</span>;
      },
    },
    {
      key: 'total_spend',
      label: 'Total PO Spend',
      sortable: true,
      render: (r) => <span style={{ fontWeight: '600' }}>{formatCurrency(r.total_spend)}</span>,
    },
  ];

  // ==========================================
  // TAB 7: RECEIVABLES COLUMNS
  // ==========================================
  const receivablesColumns: Column<any>[] = [
    { key: 'invoice_number', label: 'Invoice #', sortable: true },
    { key: 'customer_name', label: 'Customer', render: (r) => <strong>{r.customer_name || 'Standard Client'}</strong> },
    { key: 'order_number', label: 'Sales Order' },
    {
      key: 'issued_at',
      label: 'Issued Date',
      render: (r) => (r.issued_at ? new Date(r.issued_at).toLocaleDateString() : '—'),
    },
    {
      key: 'total_amount',
      label: 'Total Amount',
      sortable: true,
      render: (r) => formatCurrency(r.total_amount),
    },
    {
      key: 'status',
      label: 'Payment Status',
      render: (r) => {
        const isPaid = r.status === 'PAID';
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: '600',
              background: isPaid ? '#f0fdf4' : '#fef2f2',
              color: isPaid ? SECONDARY_GREEN : ALERT_RED,
              border: `1px solid ${isPaid ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            {r.status}
          </span>
        );
      },
    },
    {
      key: 'days_outstanding',
      label: 'Days Overdue',
      sortable: true,
      render: (r) => (r.status === 'PAID' ? '0 days' : <span style={{ color: ALERT_RED, fontWeight: '700' }}>{r.days_outstanding} days</span>),
    },
    {
      key: 'aging_bracket',
      label: 'Aging Bracket',
      render: (r) => (
        <span style={{ fontSize: '12px', fontWeight: '500', color: r.aging_bracket === 'Paid' ? SECONDARY_GREEN : ALERT_RED }}>
          {r.aging_bracket}
        </span>
      ),
    },
  ];

  return (
    <div className="module-page">
      {/* Page Header */}
      <section className="module-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="module-header__icon">
            <BarChart3 size={24} />
          </div>
          <div>
            <p>Management Analytics & Decision Support</p>
            <h2>Financial performance, asset valuations, margins & supplier scores</h2>
          </div>
        </div>

        {/* Global Controls: Date Range & Reload */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f3f4f6', padding: '4px', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
            <Calendar size={15} style={{ color: '#6b7280', marginLeft: '6px' }} />
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '13px',
                fontWeight: '600',
                color: '#374151',
                cursor: 'pointer',
                outline: 'none',
                paddingRight: '6px',
              }}
            >
              <option value={7}>Last 7 Days</option>
              <option value={30}>Last 30 Days</option>
              <option value={90}>Last 90 Days</option>
              <option value={365}>Last 365 Days</option>
              <option value={3650}>All Time</option>
            </select>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={fetchReportData}
            title="Refresh analytics data"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
        </div>
      </section>

      {/* Report workspace navigation */}
      <section style={{ marginBottom: '16px' }}>
        <nav aria-label="Report workspaces" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '8px', border: '1px solid #d7e6df', background: '#fff', borderRadius: '14px', boxShadow: '0 8px 24px rgba(5, 70, 54, 0.08)' }}>
          {reportMenus.map((menu) => {
            const isOpen = openMenu === menu.label;
            const isActive = menu.items.some((item) => item.key === activeTab);
            return <div key={menu.label} style={{ position: 'relative' }}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpenMenu(isOpen ? null : menu.label)} style={{ border: 0, background: isOpen ? '#ecfdf5' : 'transparent', cursor: 'pointer', padding: '9px 13px', borderRadius: '9px', fontWeight: 700, fontSize: '13px', color: isActive ? '#065f46' : '#334155' }}>
                {menu.label} <ChevronDown size={14} style={{ verticalAlign: 'middle', transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform 150ms ease' }} />
              </button>
              {isOpen && <div style={{ position: 'absolute', zIndex: 10, minWidth: '220px', top: '40px', left: 0, padding: '6px', borderRadius: '10px', background: '#fff', border: '1px solid #d7e6df', boxShadow: '0 16px 32px rgba(5, 70, 54, 0.16)' }}>
                {menu.items.map((item) => <button key={item.key} type="button" onClick={() => { setActiveTab(item.key); setOpenMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, background: activeTab === item.key ? '#ecfdf5' : 'transparent', color: '#0f172a', borderRadius: '7px', cursor: 'pointer', padding: '9px 10px', fontSize: '13px' }}>{item.label}</button>)}
              </div>}
            </div>;
          })}
        </nav>
      </section>
      {/* Loading Indicator */}
      {loading ? (
        <PageSkeleton />
      ) : (
        <section className="panel" style={{ padding: '24px' }}>
          {/* ========================================================================= */}
          {/* SUBVIEW 1: LOW STOCK RISK */}
          {/* ========================================================================= */}
          {activeTab === 'low-stock' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertTriangle size={20} style={{ color: ALERT_RED }} />
                  <h3 style={{ margin: 0 }}>Products At or Below Reorder Threshold</h3>
                </div>

                {/* Filters Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                    <input
                      type="text"
                      placeholder="Search SKU or name..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ paddingLeft: '30px', paddingRight: '12px', height: '34px', fontSize: '13px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                    />
                  </div>

                  <select
                    value={selectedWarehouse}
                    onChange={(e) => setSelectedWarehouse(e.target.value)}
                    style={{ height: '34px', padding: '0 8px', fontSize: '13px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                  >
                    <option value="">All Warehouses</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>

                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    style={{ height: '34px', padding: '0 8px', fontSize: '13px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                  >
                    <option value="">All Categories</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <DataTable
                columns={lowStockColumns}
                data={filteredLowStock}
                keyExtractor={(row) => `${row.product_id}-${row.warehouse_id || row.branch_id || 'loc'}`}
                emptyMessage="No variants are currently below their reorder limits for the selected filters."
              />
            </div>
          )}

          {/* ========================================================================= */}
          {/* SUBVIEW 2: BRANCH PERFORMANCE */}
          {/* ========================================================================= */}
          {activeTab === 'branch-perf' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <Building size={20} style={{ color: PRIMARY_GREEN }} />
                <h3 style={{ margin: 0 }}>Branch Revenue & Gross Profit Comparison</h3>
              </div>

              {/* KPI Cards */}
              <div className="metric-grid" style={{ marginBottom: '24px' }}>
                <MetricCard
                  label="Top Performing Branch"
                  value={branchPerfData[0]?.name || 'N/A'}
                  trend={`Revenue: ${formatCurrency(branchPerfData[0]?.total_revenue)}`}
                  icon={<Building size={20} style={{ color: PRIMARY_GREEN }} />}
                />
                <MetricCard
                  label="Total Invoiced Revenue"
                  value={formatCurrency(branchPerfData.reduce((acc, b) => acc + (b.total_revenue || 0), 0))}
                  trend={`Across ${branchPerfData.length} active branches`}
                  icon={<CircleDollarSign size={20} style={{ color: PRIMARY_GREEN }} />}
                />
                <MetricCard
                  label="Total Branch Gross Profit"
                  value={formatCurrency(branchPerfData.reduce((acc, b) => acc + (b.gross_profit || 0), 0))}
                  trend="Revenue minus cost of goods sold"
                  icon={<TrendingUp size={20} style={{ color: SECONDARY_GREEN }} />}
                />
                <MetricCard
                  label="Overall Orders Count"
                  value={branchPerfData.reduce((acc, b) => acc + (b.order_count || 0), 0).toString()}
                  trend="Sales orders in period"
                  icon={<FileText size={20} style={{ color: TEAL_BLUE }} />}
                />
              </div>

              {/* Bar Chart */}
              <div style={{ marginBottom: '24px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h4 style={{ margin: '0 0 16px', color: '#111827', fontSize: '15px' }}>Revenue vs Gross Profit per Branch</h4>
                {branchPerfData.length === 0 ? (
                  renderChartEmptyState('No branch sales recorded for the selected timeframe.')
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={branchPerfData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(val: any) => formatCurrency(Number(val))} />
                      <Legend />
                      <Bar dataKey="total_revenue" name="Total Revenue ($)" fill={PRIMARY_GREEN} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="gross_profit" name="Gross Profit ($)" fill={SECONDARY_GREEN} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Data Table */}
              <DataTable
                columns={branchColumns}
                data={branchPerfData}
                keyExtractor={(row) => row.id}
                emptyMessage="No branch performance recorded in this period."
              />
            </div>
          )}

          {/* ========================================================================= */}
          {/* SUBVIEW 3: INVENTORY ASSET VALUATION */}
          {/* ========================================================================= */}
          {activeTab === 'inv-valuation' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <CircleDollarSign size={20} style={{ color: PRIMARY_GREEN }} />
                <h3 style={{ margin: 0 }}>Balance Sheet Capital Asset Valuation</h3>
              </div>

              {/* KPI Cards */}
              <div className="metric-grid" style={{ marginBottom: '24px' }}>
                <MetricCard
                  label="Total Estimated Cost Value"
                  value={formatCurrency(invValuationData?.summary?.total_cost_value)}
                  trend="Sum of live stock multiplied by cost price"
                  icon={<CircleDollarSign size={22} style={{ color: PRIMARY_GREEN }} />}
                />
                <MetricCard
                  label="Total Retail Sales Value"
                  value={formatCurrency(invValuationData?.summary?.total_retail_value)}
                  trend="Expected gross sales value at retail price"
                  icon={<TrendingUp size={22} style={{ color: SECONDARY_GREEN }} />}
                />
                <MetricCard
                  label="Total Physical Units On Hand"
                  value={Number(invValuationData?.summary?.total_units || 0).toLocaleString()}
                  trend="Aggregated stock across warehouses & branches"
                  icon={<Package size={22} style={{ color: TEAL_BLUE }} />}
                />
              </div>

              {/* Asset Value by Category Chart */}
              <div style={{ marginBottom: '24px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h4 style={{ margin: '0 0 16px', color: '#111827', fontSize: '15px' }}>Tied-up Capital Value ($) by Product Category</h4>
                {!invValuationData?.category_breakdown || invValuationData.category_breakdown.length === 0 ? (
                  renderChartEmptyState('No inventory assets found in the system.')
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={invValuationData.category_breakdown} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="category_name" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(val: any) => formatCurrency(Number(val))} />
                      <Bar dataKey="cost_value" name="Capital Value ($)" fill={PRIMARY_GREEN} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Dead Stock Table */}
              <div style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <AlertCircle size={18} style={{ color: ALERT_RED }} />
                  <h4 style={{ margin: 0, color: ALERT_RED }}>Dead Stock Alert (Zero Sales in 90+ Days with Live Stock)</h4>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#6b7280' }}>
                  These variants carry capital tied up in inventory but have not generated a single sales order line in over 90 days.
                </p>
                <DataTable
                  columns={deadStockColumns}
                  data={invValuationData?.dead_stock || []}
                  keyExtractor={(row) => row.id}
                  emptyMessage="Great news! No dead stock detected (all stocked items have active sales velocity)."
                />
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SUBVIEW 4: SALES & PROFIT ANALYSIS */}
          {/* ========================================================================= */}
          {activeTab === 'sales-profit' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <TrendingUp size={20} style={{ color: PRIMARY_GREEN }} />
                <h3 style={{ margin: 0 }}>Sales Turnover & Profitability Analysis</h3>
              </div>

              {/* KPI Grid */}
              <div className="metric-grid" style={{ marginBottom: '24px' }}>
                <MetricCard
                  label="Total Invoiced Revenue"
                  value={formatCurrency(salesProfitData?.summary?.total_revenue)}
                  trend={`Selected range (${days} days)`}
                  icon={<CircleDollarSign size={20} style={{ color: PRIMARY_GREEN }} />}
                />
                <MetricCard
                  label="Total Gross Profit"
                  value={formatCurrency(salesProfitData?.summary?.gross_profit)}
                  trend="Revenue minus cost of goods"
                  icon={<TrendingUp size={20} style={{ color: SECONDARY_GREEN }} />}
                />
                <MetricCard
                  label="Overall Profit Margin"
                  value={formatPercent(salesProfitData?.summary?.margin_pct)}
                  trend="Gross profit margin %"
                  icon={<CheckCircle2 size={20} style={{ color: SECONDARY_GREEN }} />}
                />
                <MetricCard
                  label="Average Order Value"
                  value={formatCurrency(salesProfitData?.summary?.avg_order_value)}
                  trend={`${salesProfitData?.summary?.total_orders || 0} sales orders`}
                  icon={<FileText size={20} style={{ color: TEAL_BLUE }} />}
                />
              </div>

              {/* Line Chart */}
              <div style={{ marginBottom: '24px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h4 style={{ margin: '0 0 16px', color: '#111827', fontSize: '15px' }}>Daily Sales Turnover & Gross Profit ($)</h4>
                {!salesProfitData?.daily_trend || salesProfitData.daily_trend.length === 0 ? (
                  renderChartEmptyState('No sales invoices posted in this period — try selecting a wider date range.')
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={salesProfitData.daily_trend} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="day" stroke="#6b7280" fontSize={12} tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                      <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(val: any) => formatCurrency(Number(val))} />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" name="Daily Revenue ($)" stroke={PRIMARY_GREEN} strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="profit" name="Daily Gross Profit ($)" stroke={SECONDARY_GREEN} strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Tables Section */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
                <div>
                  <h4 style={{ margin: '0 0 12px', color: '#111827' }}>Top Products by Gross Margin</h4>
                  <DataTable
                    columns={topProductsColumns}
                    data={salesProfitData?.top_products || []}
                    keyExtractor={(row) => row.id}
                    emptyMessage="No product sales lines recorded in this date range."
                  />
                </div>

                <div>
                  <h4 style={{ margin: '0 0 12px', color: '#111827' }}>Top Customers by Total Revenue</h4>
                  <DataTable
                    columns={topCustomersColumns}
                    data={salesProfitData?.top_customers || []}
                    keyExtractor={(row) => row.id}
                    emptyMessage="No customer sales orders recorded in this date range."
                  />
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SUBVIEW 5: QUOTE CONVERSION */}
          {/* ========================================================================= */}
          {activeTab === 'quote-conversion' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <FileText size={20} style={{ color: PRIMARY_GREEN }} />
                <h3 style={{ margin: 0 }}>Quotation-to-Order Conversion Pipeline</h3>
              </div>

              {/* KPI Cards */}
              <div className="metric-grid" style={{ marginBottom: '24px' }}>
                <MetricCard
                  label="Total Quotations Issued"
                  value={quoteConvData?.summary?.total_quotes?.toString() || '0'}
                  trend={`In selected range (${days} days)`}
                  icon={<FileText size={20} style={{ color: TEAL_BLUE }} />}
                />
                <MetricCard
                  label="Converted to Sales Orders"
                  value={quoteConvData?.summary?.converted_quotes?.toString() || '0'}
                  trend="Accepted or order created"
                  icon={<CheckCircle2 size={20} style={{ color: SECONDARY_GREEN }} />}
                />
                <MetricCard
                  label="Conversion Rate %"
                  value={formatPercent(quoteConvData?.summary?.conversion_rate_pct)}
                  trend="Percentage converted"
                  icon={<TrendingUp size={20} style={{ color: PRIMARY_GREEN }} />}
                />
                <MetricCard
                  label="Avg Conversion Lead Time"
                  value={`${quoteConvData?.summary?.avg_days_to_convert || 0} Days`}
                  trend="Days from quote to sales order"
                  icon={<Clock size={20} style={{ color: AMBER_GOLD }} />}
                />
              </div>

              {/* Quotations Trend Chart */}
              <div style={{ marginBottom: '24px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h4 style={{ margin: '0 0 16px', color: '#111827', fontSize: '15px' }}>Quotations Created vs Converted Over Time</h4>
                {!quoteConvData?.trend || quoteConvData.trend.length === 0 ? (
                  renderChartEmptyState('No quotations issued in this date range — try selecting a wider date range.')
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={quoteConvData.trend} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="day" stroke="#6b7280" fontSize={12} tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                      <YAxis stroke="#6b7280" fontSize={12} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="total_created" name="Quotes Issued" fill={TEAL_BLUE} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="total_converted" name="Orders Converted" fill={SECONDARY_GREEN} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Quotation Log Table */}
              <h4 style={{ margin: '0 0 12px', color: '#111827' }}>Quotation Conversion Log</h4>
              <DataTable
                columns={quoteColumns}
                data={quoteConvData?.quotes_list || []}
                keyExtractor={(row) => row.id}
                emptyMessage="No quotations logged in this period."
              />
            </div>
          )}

          {/* ========================================================================= */}
          {/* SUBVIEW 6: PURCHASING & SUPPLIER PERFORMANCE */}
          {/* ========================================================================= */}
          {activeTab === 'supplier-perf' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <Truck size={20} style={{ color: PRIMARY_GREEN }} />
                <h3 style={{ margin: 0 }}>Procurement Spend & Supplier Scorecard</h3>
              </div>

              {/* KPI Cards */}
              <div className="metric-grid" style={{ marginBottom: '24px' }}>
                <MetricCard
                  label="Total PO Spend"
                  value={formatCurrency(supplierPerfData?.summary?.total_spend)}
                  trend={`Across ${supplierPerfData?.summary?.po_count || 0} purchase orders`}
                  icon={<CircleDollarSign size={20} style={{ color: PRIMARY_GREEN }} />}
                />
                <MetricCard
                  label="Purchase Orders Placed"
                  value={supplierPerfData?.summary?.po_count?.toString() || '0'}
                  trend="Total POs issued"
                  icon={<FileText size={20} style={{ color: TEAL_BLUE }} />}
                />
                <MetricCard
                  label="On-Time Delivery Rate %"
                  value={formatPercent(supplierPerfData?.summary?.on_time_delivery_rate_pct)}
                  trend="Receipt date vs expected date"
                  icon={<CheckCircle2 size={20} style={{ color: SECONDARY_GREEN }} />}
                />
                <MetricCard
                  label="Active Suppliers"
                  value={supplierPerfData?.summary?.active_suppliers?.toString() || '0'}
                  trend="Suppliers with active POs"
                  icon={<Truck size={20} style={{ color: AMBER_GOLD }} />}
                />
              </div>

              {/* Spend per Supplier Chart */}
              <div style={{ marginBottom: '24px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h4 style={{ margin: '0 0 16px', color: '#111827', fontSize: '15px' }}>Procurement Spend ($) per Supplier</h4>
                {!supplierPerfData?.supplier_spend || supplierPerfData.supplier_spend.length === 0 ? (
                  renderChartEmptyState('No purchase orders recorded for the selected timeframe.')
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={supplierPerfData.supplier_spend} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="supplier_name" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(val: any) => formatCurrency(Number(val))} />
                      <Bar dataKey="total_spend" name="Total Spend ($)" fill={PRIMARY_GREEN} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Scorecard Table */}
              <h4 style={{ margin: '0 0 12px', color: '#111827' }}>Supplier Reliability Scorecard</h4>
              <DataTable
                columns={scorecardColumns}
                data={supplierPerfData?.scorecard || []}
                keyExtractor={(row) => row.id}
                emptyMessage="No supplier metrics available."
              />
            </div>
          )}

          {/* ========================================================================= */}
          {/* SUBVIEW 7: RECEIVABLES / CASH FLOW */}
          {/* ========================================================================= */}
          {activeTab === 'receivables' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <Wallet size={20} style={{ color: PRIMARY_GREEN }} />
                <h3 style={{ margin: 0 }}>Accounts Receivable & Cash Flow Aging</h3>
              </div>

              {/* KPI Cards */}
              <div className="metric-grid" style={{ marginBottom: '24px' }}>
                <MetricCard
                  label="Total Invoiced Amount"
                  value={formatCurrency(receivablesData?.summary?.total_invoiced)}
                  trend="Gross invoiced total"
                  icon={<CircleDollarSign size={20} style={{ color: PRIMARY_GREEN }} />}
                />
                <MetricCard
                  label="Total Collected (Paid)"
                  value={formatCurrency(receivablesData?.summary?.total_paid)}
                  trend="Successfully settled invoices"
                  icon={<CheckCircle2 size={20} style={{ color: SECONDARY_GREEN }} />}
                />
                <MetricCard
                  label="Total Outstanding"
                  value={formatCurrency(receivablesData?.summary?.total_outstanding)}
                  trend="Uncollected balance"
                  icon={<Wallet size={20} style={{ color: TEAL_BLUE }} />}
                />
                <MetricCard
                  label="Total Overdue (>30 Days)"
                  value={formatCurrency(receivablesData?.summary?.total_overdue)}
                  trend="Invoices past 30 days due"
                  icon={<AlertTriangle size={20} style={{ color: ALERT_RED }} />}
                />
              </div>

              {/* Aging Breakdown Chart */}
              <div style={{ marginBottom: '24px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h4 style={{ margin: '0 0 16px', color: '#111827', fontSize: '15px' }}>Accounts Receivable Aging Breakdown ($)</h4>
                {!receivablesData?.aging_breakdown || receivablesData.aging_breakdown.every((b: any) => b.amount === 0) ? (
                  renderChartEmptyState('No outstanding receivables balance at this time.')
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={receivablesData.aging_breakdown} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="bracket" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(val: any) => formatCurrency(Number(val))} />
                      <Bar dataKey="amount" name="Outstanding Balance ($)" fill={ALERT_RED} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Invoices Aging Table */}
              <h4 style={{ margin: '0 0 12px', color: '#111827' }}>Invoices Aging & Collection Report</h4>
              <DataTable
                columns={receivablesColumns}
                data={receivablesData?.invoices || []}
                keyExtractor={(row) => row.id}
                emptyMessage="No invoices logged in the system."
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
