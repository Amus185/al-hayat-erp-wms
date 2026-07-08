import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Plus, UserPlus, Eye, CheckCircle, FileText, DollarSign } from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '../api/client';
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
      const salesOrders = await apiGet<SalesOrder[]>('/sales-orders');
      const custs = await apiGet<Customer[]>('/customers');
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
      await apiPost('/customers', customerForm);
      addToast('success', 'Customer registered successfully. They are now available when creating a New Order.');
      setIsCustomerOpen(false);
      setCustomerForm({ name: '', email: '', phone: '', address: '' });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register customer');
    }
  };

  const handleConfirmOrder = async (id: string) => {
    try {
      setOrderDetailsLoading(true);
      await apiPatch(`/sales-orders/${id}/confirm`);
      addToast('success', 'Sales order confirmed successfully');
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to confirm order');
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  const handleCreateInvoice = async (id: string) => {
    try {
      setOrderDetailsLoading(true);
      await apiPost(`/sales-orders/${id}/invoice`);
      addToast('success', 'Invoice issued successfully');
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to issue invoice');
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  const handlePayInvoice = async (invoiceId: string) => {
    try {
      setOrderDetailsLoading(true);
      await apiPatch(`/invoices/${invoiceId}/pay`);
      addToast('success', 'Payment recorded successfully');
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to post payment');
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  const viewOrderDetails = async (so: SalesOrder) => {
    setOrderDetailsLoading(true);
    try {
      // Fetch details
      const list = await apiGet<any[]>('/sales-orders');
      const details = list?.find((item) => item.id === so.id);
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
          <button type="button" className="btn btn-secondary" onClick={() => setIsCustomerOpen(true)}>
            <UserPlus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Register Customer
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/sales/new')}>
            <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> New Order
          </button>
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
                        <td><strong>{line.product_name}</strong><br /><span style={{ color: '#667066', fontSize: '12px' }}>{line.variant_sku}</span></td>
                        <td>{line.quantity}</td>
                        <td>${Number(line.unit_price).toLocaleString()}</td>
                        <td><strong>${(line.quantity * line.unit_price).toLocaleString()}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #edf1ed', paddingTop: '16px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedOrder(null)}>
                Close
              </button>

              {/* Status DRAFT -> Confirm */}
              {selectedOrder.status === 'DRAFT' && (
                <button type="button" className="btn btn-primary" onClick={() => handleConfirmOrder(selectedOrder.id)}>
                  <CheckCircle size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Confirm Order
                </button>
              )}

              {/* Status CONFIRMED -> Invoice */}
              {selectedOrder.status === 'CONFIRMED' && (
                <button type="button" className="btn btn-primary" onClick={() => handleCreateInvoice(selectedOrder.id)}>
                  <FileText size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Issue Invoice
                </button>
              )}

              {/* Status INVOICED -> Pay Invoice (using invoice details) */}
              {selectedOrder.status === 'INVOICED' && selectedOrder.invoice_id && (
                <button type="button" className="btn btn-primary" onClick={() => handlePayInvoice(selectedOrder.invoice_id)}>
                  <DollarSign size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Post Payment
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
