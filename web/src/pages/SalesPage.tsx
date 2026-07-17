import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Plus, UserPlus, Eye, CheckCircle, DollarSign, Zap, Printer, Search, Download, X } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Tabs } from '../components/Tabs';
import { Modal } from '../components/Modal';
import { InputField, TextareaField } from '../components/FormField';
import { SearchableSelect } from '../components/SearchableSelect';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

interface SalesOrder {
  id: string;
  order_number: string;
  customer_id: string;
  branch_id: string;
  status: string;
  created_at: string;
  customer_name?: string;
  branch_name?: string;
  total_amount?: number;
}

export function SalesPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState('so.created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Customer Modal
  const [isCustomerOpen, setIsCustomerOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
  });

  // Sales Order Details Modal
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [orderDetailsLoading, setOrderDetailsLoading] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [custs, brs] = await Promise.all([
          apiGet<Customer[]>('/sales/customers').catch(() => []),
          apiGet<any[]>('/branches').catch(() => [])
        ]);
        setCustomers(custs || []);
        setBranches(brs || []);
      } catch (err) {
        console.error('Failed to init sales data', err);
      }
    }
    init();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
        sort_by: sortBy,
        sort_dir: sortDir.toUpperCase(),
      });
      if (search) params.append('search', search);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (customerId) params.append('customer_id', customerId);
      if (branchId) params.append('branch_id', branchId);
      if (activeTab && activeTab !== 'ALL') params.append('status', activeTab);

      const res = await apiGet<any>(`/sales/orders?${params.toString()}`);
      setOrders(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load sales orders data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(loadData, 300);
    return () => clearTimeout(timeout);
  }, [page, sortBy, sortDir, search, startDate, endDate, customerId, branchId, activeTab]);

  const handleExport = () => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (customerId) params.append('customer_id', customerId);
    if (branchId) params.append('branch_id', branchId);
    if (activeTab && activeTab !== 'ALL') params.append('status', activeTab);
    params.append('sort_by', sortBy);
    params.append('sort_dir', sortDir.toUpperCase());
    params.append('export', 'csv');
    const apiUrl = import.meta.env.VITE_API_URL || '';
    window.location.href = `${apiUrl}/sales/orders?${params.toString()}`;
  };

  const handleCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForm.name) {
      addToast('error', 'Customer name is required');
      return;
    }
    try {
      await apiPost('/sales/customers', customerForm);
      addToast('success', 'Customer registered successfully.');
      setIsCustomerOpen(false);
      setCustomerForm({ name: '', email: '', phone: '', address: '' });
      const custs = await apiGet<Customer[]>('/sales/customers');
      setCustomers(custs || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register customer');
    }
  };

  const handleComplete = async (id: string) => {
    try {
      setOrderDetailsLoading(true);
      await apiPost(`/sales/orders/${id}/complete`, {});
      addToast('success', '✅ Sale completed! Invoice issued and payment recorded.');
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to complete sale');
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  const handlePayInvoice = async (orderId: string) => {
    try {
      setOrderDetailsLoading(true);
      await apiPost(`/sales/orders/${orderId}/pay`, {});
      addToast('success', 'Payment recorded successfully');
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to post payment');
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  const handlePrintInvoice = async (orderId: string) => {
    try {
      const orderData = await apiGet<any>(`/sales/orders/${orderId}`);
      if (!orderData.invoice_id) {
        addToast('error', 'No invoice found for this order. Invoice the order first.');
        return;
      }
      const data = await apiGet<any>(`/sales/invoices/${orderData.invoice_id}/print`);
      const w = window.open('', '_blank');
      if (!w) { addToast('error', 'Pop-up blocked. Please allow pop-ups.'); return; }
      w.document.write(`<!DOCTYPE html><html><head><title>Invoice ${data.invoice.invoice_number}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #1a1a1a; max-width: 800px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #066006; padding-bottom: 20px; margin-bottom: 24px; }
          .header h1 { color: #066006; font-size: 28px; }
          .header .inv-num { font-size: 14px; color: #555; }
          .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
          .meta-box { padding: 16px; background: #f7f9f7; border-radius: 8px; }
          .meta-box h3 { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 8px; letter-spacing: 1px; }
          .meta-box p { font-size: 14px; margin: 2px 0; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          th { background: #066006; color: white; padding: 10px 14px; text-align: left; font-size: 12px; text-transform: uppercase; }
          td { padding: 10px 14px; border-bottom: 1px solid #e5e5e5; font-size: 13px; }
          tr:nth-child(even) { background: #fafafa; }
          .total-row { display: flex; justify-content: flex-end; font-size: 18px; font-weight: 700; padding: 12px 0; border-top: 2px solid #066006; }
          .total-row span { color: #066006; }
          .footer { text-align: center; padding: 20px 0; font-size: 11px; color: #888; border-top: 1px solid #eee; margin-top: 40px; }
          .status { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 700; }
          .status.paid { background: #d4edda; color: #155724; }
          .status.unpaid { background: #fff3cd; color: #856404; }
          @media print { body { padding: 20px; } button { display: none !important; } }
        </style></head><body>
        <button onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#066006;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Print</button>
        <div class="header">
          <div><h1>INVOICE</h1><p class="inv-num">${data.invoice.invoice_number}</p></div>
          <div style="text-align:right"><p style="font-weight:700">${data.branch.name}</p><p style="font-size:13px;color:#555">${data.branch.city || ''}${data.branch.address ? ', ' + data.branch.address : ''}</p>${data.branch.phone ? '<p style="font-size:12px;color:#555">Tel: ' + data.branch.phone + '</p>' : ''}</div>
        </div>
        <div class="meta">
          <div class="meta-box"><h3>Bill To</h3><p style="font-weight:700">${data.customer.name}</p>${data.customer.phone ? '<p>' + data.customer.phone + '</p>' : ''}${data.customer.email ? '<p>' + data.customer.email + '</p>' : ''}${data.customer.address ? '<p>' + data.customer.address + '</p>' : ''}</div>
          <div class="meta-box"><h3>Invoice Details</h3><p><strong>Order:</strong> ${data.invoice.order_number}</p><p><strong>Issued:</strong> ${data.invoice.issued_at ? new Date(data.invoice.issued_at).toLocaleDateString() : 'N/A'}</p><p><strong>Status:</strong> <span class="status ${data.invoice.status === 'PAID' ? 'paid' : 'unpaid'}">${data.invoice.status}</span></p>${data.invoice.paid_at ? '<p><strong>Paid:</strong> ' + new Date(data.invoice.paid_at).toLocaleDateString() + '</p>' : ''}</div>
        </div>
        <table><thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Unit Price</th><th style="text-align:right">Subtotal</th></tr></thead>
        <tbody>${data.lines.map((l: any) => '<tr><td>' + l.product_name + '</td><td>' + l.product_sku + '</td><td>' + l.quantity + '</td><td>$' + Number(l.unit_price).toFixed(2) + '</td><td style="text-align:right;font-weight:600">$' + Number(l.subtotal).toFixed(2) + '</td></tr>').join('')}</tbody></table>
        <div class="total-row">Total: <span style="margin-left:12px">$${Number(data.invoice.total_amount).toFixed(2)}</span></div>
        <div class="footer"><p>Thank you for your business!</p><p>Generated on ${new Date().toLocaleString()}</p></div>
      </body></html>`);
      w.document.close();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load invoice for printing');
    }
  };

  const viewOrderDetails = async (so: SalesOrder) => {
    setOrderDetailsLoading(true);
    try {
      const details = await apiGet<any>(`/sales/orders/${so.id}`);
      setSelectedOrder(details || so);
    } catch {
      setSelectedOrder(so);
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  const tabItems = [
    { key: 'ALL', label: 'All Orders' },
    { key: 'DRAFT', label: 'Drafts' },
    { key: 'CONFIRMED', label: 'Confirmed' },
    { key: 'INVOICED', label: 'Invoiced' },
    { key: 'PAID', label: 'Paid' },
  ];

  const handleSort = (key: string) => {
    let dbKey = key;
    if (key === 'order_number') dbKey = 'so.order_number';
    if (key === 'customer_name') dbKey = 'c.name';
    if (key === 'created_at') dbKey = 'so.created_at';
    if (key === 'status') dbKey = 'so.status';
    
    if (sortBy === dbKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(dbKey);
      setSortDir('asc');
    }
  };

  const columns: Column<SalesOrder>[] = [
    { key: 'order_number', label: 'Order ID', sortable: true },
    { key: 'customer_name', label: 'Customer', sortable: true },
    { key: 'branch_name', label: 'Sales Branch' },
    {
      key: 'created_at',
      label: 'Date',
      sortable: true,
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'neutral' | 'blue' = 'neutral';
        if (row.status === 'CONFIRMED') tone = 'yellow';
        if (row.status === 'INVOICED') tone = 'blue';
        if (row.status === 'PAID') tone = 'green';
        if (row.status === 'DRAFT') tone = 'neutral';
        return <StatusBadge label={row.status.replace('_', ' ')} tone={tone} />;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); viewOrderDetails(row); }}>
          <Eye size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Details
        </button>
      ),
    },
  ];

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <ShoppingCart size={24} />
        </div>
        <div className="module-header__info">
          <p>Revenue</p>
          <h2>Customers, orders, invoices, and payments</h2>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {hasPermission('manage_sales') && (
            <button type="button" className="btn btn-secondary" onClick={() => setIsCustomerOpen(true)}>
              <UserPlus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Register Customer
            </button>
          )}
          {hasPermission('manage_sales') && (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/sales/new')}>
              <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> New Order
            </button>
          )}
        </div>
      </section>

      <section style={{ marginBottom: '14px' }}>
        <Tabs tabs={tabItems} activeTab={activeTab} onTabChange={(t: string) => { setActiveTab(t); setPage(1); }} />
      </section>

      <section className="panel" style={{ marginBottom: '14px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Search</label>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '9px', color: '#9ca3af' }} />
            <input type="text" className="form-input" style={{ paddingLeft: '34px' }} placeholder="Order ID or Customer Name" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div style={{ width: '140px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Start Date</label>
          <input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div style={{ width: '140px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>End Date</label>
          <input type="date" className="form-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div style={{ width: '180px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Customer</label>
          <select className="form-select" value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">All Customers</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ width: '180px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Branch</label>
          <select className="form-select" value={branchId} onChange={e => setBranchId(e.target.value)}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setStartDate(''); setEndDate(''); setCustomerId(''); setBranchId(''); setPage(1); }}>
          <X size={16} />
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleExport}>
          <Download size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> CSV
        </button>
      </section>

      <section className="panel" style={{ padding: 0 }}>
        <DataTable
          columns={columns}
          data={orders}
          keyExtractor={(row) => row.id}
          loading={loading}
          onRowClick={(row) => viewOrderDetails(row)}
          emptyMessage="No sales orders found matching your filters"
          sortBy={sortBy === 'so.created_at' ? 'created_at' : sortBy === 'so.order_number' ? 'order_number' : sortBy === 'c.name' ? 'customer_name' : 'status'}
          sortOrder={sortDir}
          onSort={handleSort}
          pagination={{ page, total, limit: 50, totalPages, onPageChange: setPage }}
        />
      </section>

      {/* Register Customer Modal */}
      <Modal isOpen={isCustomerOpen} onClose={() => setIsCustomerOpen(false)} title="Register Customer Account" width="sm">
        <form onSubmit={handleCustomerSubmit}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <InputField label="Customer Full Name" id="custName" value={customerForm.name} onChange={(val) => setCustomerForm((prev) => ({ ...prev, name: val }))} required />
            <InputField label="Email Address" id="custEmail" type="email" value={customerForm.email} onChange={(val) => setCustomerForm((prev) => ({ ...prev, email: val }))} />
            <InputField label="Mobile Number" id="custPhone" value={customerForm.phone} onChange={(val) => setCustomerForm((prev) => ({ ...prev, phone: val }))} />
            <TextareaField label="Billing Address" id="custAddress" value={customerForm.address} onChange={(val) => setCustomerForm((prev) => ({ ...prev, address: val }))} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCustomerOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Register</button>
          </div>
        </form>
      </Modal>

      {/* Sales Order Details Modal */}
      <Modal
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        title={selectedOrder ? `Sales Order: ${selectedOrder.order_number}` : 'Order Details'}
        width="lg"
      >
        {selectedOrder && (
          <div style={{ display: 'grid', gap: '18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '13px', background: '#f7f9f7', padding: '12px', borderRadius: '8px' }}>
              <div>
                <span style={{ color: '#667066' }}>Customer Name:</span>
                <p style={{ margin: '2px 0 0', fontWeight: '700' }}>{selectedOrder.customer_name || 'N/A'}</p>
              </div>
              <div>
                <span style={{ color: '#667066' }}>Order Status:</span>
                <div style={{ marginTop: '2px' }}>
                  <StatusBadge label={selectedOrder.status.replace('_', ' ')} tone={selectedOrder.status === 'PAID' ? 'green' : 'neutral'} />
                </div>
              </div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 8px', color: '#066006' }}>Invoice Lines</h4>
              {orderDetailsLoading ? (
                <LoadingSpinner label="Fetching details..." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Product</th>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Quantity</th>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Unit Price</th>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.lines?.map((line: any) => (
                      <tr key={line.id}>
                        <td style={{ padding: '8px' }}><strong>{line.product_name}</strong><br /><span style={{ color: '#667066', fontSize: '12px' }}>{line.product_sku}</span></td>
                        <td style={{ padding: '8px' }}>{line.quantity}</td>
                        <td style={{ padding: '8px' }}>${Number(line.unit_price).toLocaleString()}</td>
                        <td style={{ padding: '8px' }}><strong>${(line.quantity * line.unit_price).toLocaleString()}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #edf1ed', paddingTop: '16px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedOrder(null)}>Close</button>

              {(selectedOrder.status === 'DRAFT' || selectedOrder.status === 'CONFIRMED') && hasPermission('manage_sales') && (
                <button type="button" className="btn btn-primary" disabled={orderDetailsLoading} onClick={() => handleComplete(selectedOrder.id)} style={{ background: 'linear-gradient(135deg, #0b8f08, #066006)' }}>
                  <Zap size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Complete Sale
                </button>
              )}

              {selectedOrder.status === 'INVOICED' && hasPermission('manage_sales') && (
                <button type="button" className="btn btn-primary" disabled={orderDetailsLoading} onClick={() => handlePayInvoice(selectedOrder.id)}>
                  <DollarSign size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Mark as Paid
                </button>
              )}

              {selectedOrder.status === 'PAID' && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => handlePrintInvoice(selectedOrder.id)} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Printer size={14} /> Print Invoice
                  </button>
                  <span style={{ color: '#0b8f08', fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle size={16} /> Paid & Closed
                  </span>
                </>
              )}

              {selectedOrder.status === 'INVOICED' && (
                <button type="button" className="btn btn-secondary" onClick={() => handlePrintInvoice(selectedOrder.id)} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Printer size={14} /> Print Invoice
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
