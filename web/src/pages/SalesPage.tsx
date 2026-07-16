import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Plus, UserPlus, Eye, CheckCircle, DollarSign, Zap, Printer } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Tabs } from '../components/Tabs';
import { Modal } from '../components/Modal';
import { InputField, TextareaField } from '../components/FormField';
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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');

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

  const loadData = async () => {
    try {
      setLoading(true);
      const salesOrders = await apiGet<SalesOrder[]>('/sales/orders');
      const custs = await apiGet<Customer[]>('/sales/customers');
      const branches = await apiGet<any[]>('/branches');

      setCustomers(custs || []);

      const populatedOrders = salesOrders?.map((so) => {
        const c = custs?.find((cust) => cust.id === so.customer_id);
        const b = branches?.find((br) => br.id === so.branch_id);
        return {
          ...so,
          customer_name: c ? c.name : 'Unknown Customer',
          branch_name: b ? b.name : 'Unknown Branch',
        };
      }) || [];

      setOrders(populatedOrders);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load sales orders data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForm.name) {
      addToast('error', 'Customer name is required');
      return;
    }
    try {
      await apiPost('/sales/customers', customerForm);
      addToast('success', 'Customer registered successfully. They are now available when creating a New Order.');
      setIsCustomerOpen(false);
      setCustomerForm({ name: '', email: '', phone: '', address: '' });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register customer');
    }
  };

  // ONE-CLICK: confirm + invoice + pay all at once
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

  // Mark existing invoice as paid (for INVOICED status)
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

  const filteredOrders = orders.filter((so) => {
    if (activeTab === 'ALL') return true;
    return so.status === activeTab;
  });

  const tabItems = [
    { key: 'ALL', label: 'All Orders', count: orders.length },
    { key: 'DRAFT', label: 'Drafts', count: orders.filter((o) => o.status === 'DRAFT').length },
    { key: 'CONFIRMED', label: 'Confirmed', count: orders.filter((o) => o.status === 'CONFIRMED').length },
    { key: 'INVOICED', label: 'Invoiced', count: orders.filter((o) => o.status === 'INVOICED').length },
    { key: 'PAID', label: 'Paid', count: orders.filter((o) => o.status === 'PAID').length },
  ];

  const columns: Column<SalesOrder>[] = [
    { key: 'order_number', label: 'Order ID' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'branch_name', label: 'Sales Branch' },
    {
      key: 'created_at',
      label: 'Date',
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'status',
      label: 'Status',
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
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => viewOrderDetails(row)}>
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
        <div>
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
        <Tabs tabs={tabItems} activeTab={activeTab} onTabChange={setActiveTab} />
      </section>

      <section className="panel">
        <DataTable
          columns={columns}
          data={filteredOrders}
          keyExtractor={(row) => row.id}
          loading={loading}
          onRowClick={(row) => viewOrderDetails(row)}
          emptyMessage="No sales orders found"
        />
      </section>

      {/* Register Customer Modal */}
      <Modal isOpen={isCustomerOpen} onClose={() => setIsCustomerOpen(false)} title="Register Customer Account" width="sm">
        <form onSubmit={handleCustomerSubmit}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <InputField
              label="Customer Full Name"
              id="custName"
              value={customerForm.name}
              onChange={(val) => setCustomerForm((prev) => ({ ...prev, name: val }))}
              required
            />
            <InputField
              label="Email Address"
              id="custEmail"
              type="email"
              value={customerForm.email}
              onChange={(val) => setCustomerForm((prev) => ({ ...prev, email: val }))}
            />
            <InputField
              label="Mobile Number"
              id="custPhone"
              value={customerForm.phone}
              onChange={(val) => setCustomerForm((prev) => ({ ...prev, phone: val }))}
            />
            <TextareaField
              label="Billing Address"
              id="custAddress"
              value={customerForm.address}
              onChange={(val) => setCustomerForm((prev) => ({ ...prev, address: val }))}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCustomerOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Register
            </button>
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
            {/* Metadata Summary */}
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

            {/* Sales Order Lines */}
            <div>
              <h4 style={{ margin: '0 0 8px', color: '#066006' }}>Invoice Lines</h4>
              {orderDetailsLoading ? (
                <LoadingSpinner label="Fetching details..." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Quantity</th>
                      <th>Unit Price</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.lines?.map((line: any) => (
                      <tr key={line.id}>
                        <td><strong>{line.product_name}</strong><br /><span style={{ color: '#667066', fontSize: '12px' }}>{line.product_sku}</span></td>
                        <td>{line.quantity}</td>
                        <td>${Number(line.unit_price).toLocaleString()}</td>
                        <td><strong>${(line.quantity * line.unit_price).toLocaleString()}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Action Buttons — simplified to max 1 action */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #edf1ed', paddingTop: '16px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedOrder(null)}>
                Close
              </button>

              {/* DRAFT or CONFIRMED → Complete Sale in one click */}
              {(selectedOrder.status === 'DRAFT' || selectedOrder.status === 'CONFIRMED') && hasPermission('manage_sales') && (
                <button type="button" className="btn btn-primary" disabled={orderDetailsLoading}
                  onClick={() => handleComplete(selectedOrder.id)}
                  style={{ background: 'linear-gradient(135deg, #0b8f08, #066006)' }}>
                  <Zap size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} />
                  Complete Sale
                </button>
              )}

              {/* INVOICED → just mark paid */}
              {selectedOrder.status === 'INVOICED' && hasPermission('manage_sales') && (
                <button type="button" className="btn btn-primary" disabled={orderDetailsLoading}
                  onClick={() => handlePayInvoice(selectedOrder.id)}>
                  <DollarSign size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Mark as Paid
                </button>
              )}

              {selectedOrder.status === 'PAID' && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => handlePrintInvoice(selectedOrder.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Printer size={14} /> Print Invoice
                  </button>
                  <span style={{ color: '#0b8f08', fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle size={16} /> Paid & Closed
                  </span>
                </>
              )}

              {selectedOrder.status === 'INVOICED' && (
                <button type="button" className="btn btn-secondary" onClick={() => handlePrintInvoice(selectedOrder.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
