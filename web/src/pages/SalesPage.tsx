import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Plus, UserPlus, Eye, CheckCircle,
  DollarSign, Zap, Printer, CreditCard, History, ChevronDown, ChevronUp, Loader2, Trash2,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../api/client';
import { getCached, setCached } from '../api/cache';
import { DataTable, type Column } from '../components/DataTable';
import { KanbanBoard, type KanbanColumnDef } from '../components/KanbanBoard';
import { ViewSwitcher } from '../components/ViewSwitcher';
import { Tabs } from '../components/Tabs';
import { Modal } from '../components/Modal';
import { InputField, TextareaField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { FilterBar } from '../components/FilterBar';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import type { PaymentMethod, InvoicePayment, PaymentSummary } from '../types';
import { confirmAction } from '../utils/swal';

// ── Local interface shapes matching API responses ───────────────────
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
  invoice_id?: string | null;
  invoice_total?: number;
  invoice_discount?: number;
  net_total?: number;
  amount_paid?: number;
  balance?: number;
  payment_status?: string | null;
}

// ── Shared helpers ──────────────────────────────────────────────────
function fmt(n: number | null | undefined) {
  return `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentStatusTone(status?: string | null): 'green' | 'yellow' | 'red' | 'neutral' {
  if (status === 'PAID') return 'green';
  if (status === 'PARTIALLY_PAID') return 'yellow';
  if (status === 'UNPAID') return 'red';
  return 'neutral';
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card / POS' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'WIRE', label: 'Wire Transfer' },
];

// ── Payment History sub-component ───────────────────────────────────
function PaymentHistoryTable({ payments }: { payments: InvoicePayment[] }) {
  if (!payments.length) {
    return <p style={{ color: '#667066', fontSize: '13px', fontStyle: 'italic' }}>No payments recorded yet.</p>;
  }
  return (
    <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#f0f7f0' }}>
          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#066006' }}>Date</th>
          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#066006' }}>Amount</th>
          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#066006' }}>Method</th>
          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#066006' }}>Recorded By</th>
          <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#066006' }}>Balance After</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id} style={{ borderBottom: '1px solid #edf1ed' }}>
            <td style={{ padding: '6px 10px' }}>{p.payment_date}</td>
            <td style={{ padding: '6px 10px', fontWeight: 600, color: '#0b8f08' }}>{fmt(p.amount)}</td>
            <td style={{ padding: '6px 10px' }}>{p.payment_method.replace('_', ' ')}</td>
            <td style={{ padding: '6px 10px', color: '#667066' }}>{p.recorded_by_name || '—'}</td>
            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: Number(p.running_balance) > 0 ? '#b45309' : '#0b8f08' }}>
              {fmt(p.running_balance)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Invoice Summary sub-component ───────────────────────────────────
function InvoiceSummaryBox({ summary, discountAmount }: { summary: PaymentSummary; discountAmount: number }) {
  const subtotal = summary.net_total + discountAmount;
  return (
    <div style={{ background: '#f7fef7', border: '1px solid #d1e8d1', borderRadius: '8px', padding: '14px' }}>
      <div style={{ display: 'grid', gap: '6px', fontSize: '13px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#667066' }}>Subtotal</span>
          <span>{fmt(subtotal)}</span>
        </div>
        {discountAmount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#b45309' }}>Discount</span>
            <span style={{ color: '#b45309' }}>-{fmt(discountAmount)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #d1e8d1', paddingTop: '6px', marginTop: '2px' }}>
          <span>Net Total</span>
          <span>{fmt(summary.net_total)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0b8f08' }}>
          <span>Amount Paid</span>
          <span style={{ fontWeight: 600 }}>{fmt(summary.amount_paid)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '15px', borderTop: '1px solid #d1e8d1', paddingTop: '6px', marginTop: '2px' }}>
          <span style={{ color: summary.balance > 0 ? '#b45309' : '#0b8f08' }}>
            {summary.balance > 0 ? 'Remaining Balance' : '✓ Fully Paid'}
          </span>
          <span style={{ color: summary.balance > 0 ? '#b45309' : '#0b8f08' }}>{fmt(summary.balance)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page Component ─────────────────────────────────────────────
export function SalesPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');

  // FilterBar
  const [soSearch, setSoSearch] = useState('');
  const [soFilters, setSoFilters] = useState<Record<string, string>>({
    customer: '', branch: '', dateFrom: '', dateTo: '', paymentStatus: '',
  });

  // Customer Modal
  const [isCustomerOpen, setIsCustomerOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', email: '', phone: '', address: '' });

  // Sales Order Details Modal
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [orderDetailsLoading, setOrderDetailsLoading] = useState(false);

  // Payment Modal
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentMethod: 'CASH' as PaymentMethod,
    paymentDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  // Payment History toggle
  const [showHistory, setShowHistory] = useState(false);

  const loadData = async () => {
    // Show cached data instantly, then refresh silently in background
    const cachedOrders = getCached<SalesOrder[]>('sales:orders');
    const cachedCustomers = getCached<Customer[]>('customers:list');
    if (cachedOrders) { setOrders(cachedOrders); setLoading(false); }
    if (cachedCustomers) { setCustomers(cachedCustomers); }
    if (!cachedOrders) setLoading(true);
    try {
      const [salesOrders, custs] = await Promise.all([
        apiGet<SalesOrder[]>('/sales/orders'),
        apiGet<Customer[]>('/sales/customers'),
      ]);
      const ordRows = salesOrders || [];
      const custRows = custs || [];
      setCached('sales:orders', ordRows);
      setCached('customers:list', custRows);
      setCustomers(custRows);
      setOrders(ordRows);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load sales orders data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForm.name) { addToast('error', 'Customer name is required'); return; }
    try {
      await apiPost('/sales/customers', customerForm);
      addToast('success', 'Customer registered successfully.');
      setIsCustomerOpen(false);
      setCustomerForm({ name: '', email: '', phone: '', address: '' });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register customer');
    }
  };

  const [actionProcessing, setActionProcessing] = useState<'complete' | 'invoice_deposit' | 'cancel' | 'pay' | 'delete' | null>(null);

  const handleDeleteOrder = async (id: string) => {
    const confirmed = await confirmAction(
      'Delete Sales Order?',
      'Are you sure you want to permanently delete this sales order?',
      'Yes, Delete Order',
      'warning'
    );
    if (!confirmed) return;
    try {
      setActionProcessing('delete');
      setOrderDetailsLoading(true);
      await apiDelete(`/sales/orders/${id}`);
      addToast('success', 'Sales order deleted successfully');
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to delete order');
    } finally {
      setOrderDetailsLoading(false);
      setActionProcessing(null);
    }
  };

  // ONE-CLICK: confirm + invoice + pay all at once
  const handleComplete = async (id: string) => {
    try {
      setActionProcessing('complete');
      setOrderDetailsLoading(true);
      await apiPost(`/sales/orders/${id}/complete`, {});
      addToast('success', '✅ Sale completed! Invoice issued and payment recorded.');
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to complete sale');
    } finally {
      setOrderDetailsLoading(false);
      setActionProcessing(null);
    }
  };

  // Invoice an order first, then let the cashier record a deposit or installment.
  const handleInvoiceAndTakeDeposit = async (order: any) => {
    try {
      setActionProcessing('invoice_deposit');
      setOrderDetailsLoading(true);
      if (order.status === 'DRAFT') {
        await apiPost(`/sales/orders/${order.id}/confirm`, {});
      }
      await apiPost(`/sales/orders/${order.id}/invoice`, {});
      const details = await apiGet<any>(`/sales/orders/${order.id}`);
      setSelectedOrder(details);
      setPaymentForm({
        amount: '',
        paymentMethod: 'CASH',
        paymentDate: new Date().toISOString().split('T')[0],
        notes: '',
      });
      setIsPaymentOpen(true);
      addToast('success', 'Invoice created. Enter the deposit amount received today.');
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create invoice for payment');
    } finally {
      setOrderDetailsLoading(false);
      setActionProcessing(null);
    }
  };
  // Mark existing invoice as fully paid (legacy button — now also records a payment)
  const handlePayInvoice = async (orderId: string) => {
    try {
      setActionProcessing('pay');
      setOrderDetailsLoading(true);
      await apiPost(`/sales/orders/${orderId}/pay`, {});
      addToast('success', 'Payment recorded successfully');
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to post payment');
    } finally {
      setOrderDetailsLoading(false);
      setActionProcessing(null);
    }
  };

  const handleCancelOrder = async (id: string) => {
    const confirmed = await confirmAction(
      'Cancel Sales Order?',
      'Are you sure you want to cancel this sales order? This action cannot be undone.',
      'Yes, Cancel Order',
      'warning'
    );
    if (!confirmed) return;
    try {
      setActionProcessing('cancel');
      setOrderDetailsLoading(true);
      await apiPost(`/sales/orders/${id}/cancel`, {});
      addToast('success', 'Sales order cancelled');
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to cancel order');
    } finally {
      setOrderDetailsLoading(false);
      setActionProcessing(null);
    }
  };

  // Open payment form pre-filled with remaining balance
  const openPaymentModal = (order: any) => {
    const balance = order.payment_summary?.balance ?? order.balance ?? 0;
    setPaymentForm({
      amount: '',
      paymentMethod: 'CASH',
      paymentDate: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setShowHistory(false);
    setIsPaymentOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder?.invoice_id) { addToast('error', 'No invoice found for this order.'); return; }
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) { addToast('error', 'Enter a valid payment amount.'); return; }

    try {
      setPaymentSubmitting(true);
      await apiPost(`/sales/invoices/${selectedOrder.invoice_id}/payments`, {
        amount,
        paymentMethod: paymentForm.paymentMethod,
        paymentDate: paymentForm.paymentDate,
        notes: paymentForm.notes || undefined,
      });
      addToast('success', `Payment of ${fmt(amount)} recorded successfully.`);
      setIsPaymentOpen(false);
      // Refresh the order details
      const details = await apiGet<any>(`/sales/orders/${selectedOrder.id}`);
      setSelectedOrder(details);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to record payment');
    } finally {
      setPaymentSubmitting(false);
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
      const inv = data.invoice;
      const paidBadge = inv.payment_status === 'PAID'
        ? '<span class="status paid">PAID</span>'
        : inv.payment_status === 'PARTIALLY_PAID'
          ? '<span class="status partial">PARTIALLY PAID</span>'
          : '<span class="status unpaid">UNPAID</span>';

      w.document.write(`<!DOCTYPE html><html><head><title>Invoice ${inv.invoice_number}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #1a1a1a; max-width: 800px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #066006; padding-bottom: 20px; margin-bottom: 24px; }
          .header h1 { color: #066006; font-size: 28px; }
          .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
          .meta-box { padding: 16px; background: #f7f9f7; border-radius: 8px; }
          .meta-box h3 { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 8px; letter-spacing: 1px; }
          .meta-box p { font-size: 14px; margin: 2px 0; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          th { background: #066006; color: white; padding: 10px 14px; text-align: left; font-size: 12px; text-transform: uppercase; }
          td { padding: 10px 14px; border-bottom: 1px solid #e5e5e5; font-size: 13px; }
          tr:nth-child(even) { background: #fafafa; }
          .summary { display: flex; justify-content: flex-end; margin-bottom: 20px; }
          .summary-inner { min-width: 260px; display: grid; gap: 6px; font-size: 13px; }
          .summary-row { display: flex; justify-content: space-between; padding: 4px 0; }
          .summary-row.total { font-size: 16px; font-weight: 700; border-top: 2px solid #066006; padding-top: 8px; margin-top: 4px; }
          .summary-row.balance { color: #b45309; font-weight: 700; font-size: 15px; }
          .summary-row.paid-row { color: #0b8f08; }
          .footer { text-align: center; padding: 20px 0; font-size: 11px; color: #888; border-top: 1px solid #eee; margin-top: 40px; }
          .status { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 700; }
          .status.paid { background: #d4edda; color: #155724; }
          .status.partial { background: #fff3cd; color: #856404; }
          .status.unpaid { background: #f8d7da; color: #721c24; }
          @media print { body { padding: 20px; } button { display: none !important; } }
        </style></head><body>
        <button onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#066006;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Print</button>
        <div class="header">
          <div><h1>INVOICE</h1><p style="font-size:14px;color:#555">${inv.invoice_number}</p></div>
          <div style="text-align:right"><p style="font-weight:700">${data.branch.name}</p><p style="font-size:13px;color:#555">${data.branch.city || ''}${data.branch.address ? ', ' + data.branch.address : ''}</p>${data.branch.phone ? '<p style="font-size:12px;color:#555">Tel: ' + data.branch.phone + '</p>' : ''}</div>
        </div>
        <div class="meta">
          <div class="meta-box"><h3>Bill To</h3><p style="font-weight:700">${data.customer.name}</p>${data.customer.phone ? '<p>' + data.customer.phone + '</p>' : ''}${data.customer.email ? '<p>' + data.customer.email + '</p>' : ''}${data.customer.address ? '<p>' + data.customer.address + '</p>' : ''}</div>
          <div class="meta-box"><h3>Invoice Details</h3><p><strong>Order:</strong> ${inv.order_number}</p><p><strong>Issued:</strong> ${inv.issued_at ? new Date(inv.issued_at).toLocaleDateString() : 'N/A'}</p><p><strong>Status:</strong> ${paidBadge}</p>${inv.paid_at ? '<p><strong>Paid:</strong> ' + new Date(inv.paid_at).toLocaleDateString() + '</p>' : ''}</div>
        </div>
        <table><thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Unit Price</th><th style="text-align:right">Subtotal</th></tr></thead>
        <tbody>${data.lines.map((l: any) => '<tr><td>' + l.product_name + '</td><td>' + l.product_sku + '</td><td>' + l.quantity + '</td><td>$' + Number(l.unit_price).toFixed(2) + '</td><td style="text-align:right;font-weight:600">$' + Number(l.subtotal).toFixed(2) + '</td></tr>').join('')}</tbody></table>
        <div class="summary"><div class="summary-inner">
          <div class="summary-row"><span>Subtotal</span><span>$${(Number(inv.net_total ?? inv.total_amount) + Number(inv.discount_amount ?? 0)).toFixed(2)}</span></div>
          ${Number(inv.discount_amount) > 0 ? '<div class="summary-row" style="color:#b45309"><span>Discount</span><span>-$' + Number(inv.discount_amount).toFixed(2) + '</span></div>' : ''}
          <div class="summary-row total"><span>Total</span><span style="color:#066006">$${Number(inv.net_total ?? inv.total_amount).toFixed(2)}</span></div>
          <div class="summary-row paid-row"><span>Amount Paid</span><span>$${Number(inv.amount_paid ?? 0).toFixed(2)}</span></div>
          ${Number(inv.balance) > 0 ? '<div class="summary-row balance"><span>Remaining Balance</span><span>$' + Number(inv.balance).toFixed(2) + '</span></div>' : ''}
        </div></div>
        <div class="footer"><p>Thank you for your business!</p><p>Generated on ${new Date().toLocaleString()}</p></div>
      </body></html>`);
      w.document.close();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load invoice for printing');
    }
  };

  const viewOrderDetails = async (so: SalesOrder) => {
    setOrderDetailsLoading(true);
    setShowHistory(false);
    try {
      const details = await apiGet<any>(`/sales/orders/${so.id}`);
      setSelectedOrder(details || so);
    } catch {
      setSelectedOrder(so);
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  // ── Filtering ────────────────────────────────────────────────────
  const filteredOrders = orders.filter((so) => {
    if (soFilters.status && soFilters.status !== 'ALL' && so.status !== soFilters.status) return false;
    const q = soSearch.trim().toLowerCase();
    if (q && !so.order_number.toLowerCase().includes(q) && !String(so.customer_name || '').toLowerCase().includes(q)) return false;
    if (soFilters.customer && so.customer_id !== soFilters.customer) return false;
    if (soFilters.dateFrom && so.created_at < soFilters.dateFrom) return false;
    if (soFilters.dateTo && so.created_at > soFilters.dateTo + 'T23:59:59') return false;
    if (soFilters.paymentStatus && so.payment_status !== soFilters.paymentStatus) return false;
    return true;
  });

  const tabItems = [
    { key: 'ALL', label: 'All Orders', count: orders.length },
    { key: 'DRAFT', label: 'Drafts', count: orders.filter((o) => o.status === 'DRAFT').length },
    { key: 'CONFIRMED', label: 'Confirmed', count: orders.filter((o) => o.status === 'CONFIRMED').length },
    { key: 'INVOICED', label: 'Invoiced', count: orders.filter((o) => o.status === 'INVOICED').length },
    { key: 'PAID', label: 'Paid', count: orders.filter((o) => o.status === 'PAID').length },
  ];

  const columns: Column<any>[] = [
    {
      key: 'order_number',
      label: 'Order ID',
      render: (row) => (
        <span style={{ fontWeight: 700, color: '#0b8f08', fontFamily: 'monospace' }}>
          {row.order_number}
        </span>
      ),
    },
    {
      key: 'customer_name',
      label: 'Customer & Branch',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.customer_name || 'Customer'}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>{row.branch_name || 'Branch'}</div>
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Date',
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'total',
      label: 'Total Amount',
      render: (row) => (
        <span style={{ fontWeight: 600 }}>
          {row.net_total != null ? fmt(row.net_total) : (row.invoice_total != null ? fmt(row.invoice_total) : '—')}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Order Status',
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'neutral' | 'blue' = 'neutral';
        if (row.status === 'CONFIRMED') tone = 'yellow';
        if (row.status === 'INVOICED') tone = 'blue';
        if (row.status === 'PAID') tone = 'green';
        if (row.status === 'CANCELLED') tone = 'red';
        return <StatusBadge label={row.status.replace('_', ' ')} tone={tone} />;
      },
    },
    {
      key: 'payment_status',
      label: 'Payment',
      render: (row) => {
        if (!row.payment_status) return <span style={{ color: '#aaa', fontSize: '12px' }}>—</span>;
        return <StatusBadge label={row.payment_status.replace('_', ' ')} tone={paymentStatusTone(row.payment_status)} />;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => viewOrderDetails(row)}>
            <Eye size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Details
          </button>
          {hasPermission('manage_sales') && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteOrder(row.id);
              }}
              title="Delete Order"
              style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Trash2 size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  // Derive payment summary from selectedOrder
  const orderSummary: { summary: any; discount: number } | null = selectedOrder?.payment_summary
    ? { summary: selectedOrder.payment_summary, discount: Number(selectedOrder.invoice_discount ?? 0) }
    : selectedOrder?.invoice_id
      ? {
          summary: {
            amount_paid: Number(selectedOrder.amount_paid ?? 0),
            net_total: Number(selectedOrder.net_total ?? selectedOrder.invoice_total ?? 0),
            balance: Number(selectedOrder.balance ?? 0),
            payment_status: selectedOrder.payment_status ?? 'UNPAID',
          },
          discount: Number(selectedOrder.invoice_discount ?? 0),
        }
      : null;

  const canRecordPayment =
    hasPermission('manage_sales') &&
    selectedOrder?.invoice_id &&
    orderSummary &&
    orderSummary.summary.balance > 0.001;

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
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
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

      <section className="panel">
        <FilterBar
          searchValue={soSearch}
          onSearchChange={setSoSearch}
          searchPlaceholder="Search by order ID, customer name, or phone…"
          filters={[
            {
              key: 'status',
              label: 'All Statuses',
              options: [
                { value: 'DRAFT', label: 'Drafts' },
                { value: 'CONFIRMED', label: 'Confirmed' },
                { value: 'INVOICED', label: 'Invoiced' },
                { value: 'PAID', label: 'Paid' },
              ],
            },
            {
              key: 'customer',
              label: 'All Customers',
              options: customers.map((c) => ({ value: c.id, label: c.name })),
            },
            {
              key: 'paymentStatus',
              label: 'All Payment Statuses',
              options: [
                { value: 'UNPAID', label: 'Unpaid' },
                { value: 'PARTIALLY_PAID', label: 'Partially Paid' },
                { value: 'PAID', label: 'Paid' },
              ],
            },
          ]}
          filterValues={soFilters}
          onFilterChange={(key, val) => setSoFilters(prev => ({ ...prev, [key]: val }))}
        />

        <DataTable
          columns={columns}
          data={filteredOrders}
          keyExtractor={(row) => row.id as string}
          loading={loading}
          onRowClick={(row) => viewOrderDetails(row as SalesOrder)}
          emptyMessage="No sales orders match your filters"
        />
      </section>

      {/* ── Register Customer Modal ── */}
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



      {/* ── Sales Order Details Modal ── */}
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
                <p style={{ margin: '2px 0 0', fontWeight: '700' }}>{selectedOrder.customer_name || 'Walk-in Customer'}</p>
              </div>
              <div>
                <span style={{ color: '#667066' }}>Order Status:</span>
                <div style={{ marginTop: '2px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <StatusBadge label={selectedOrder.status.replace('_', ' ')} tone={selectedOrder.status === 'PAID' ? 'green' : 'neutral'} />
                  {orderSummary && (
                    <StatusBadge
                      label={orderSummary.summary.payment_status.replace('_', ' ')}
                      tone={paymentStatusTone(orderSummary.summary.payment_status)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Invoice Summary */}
            {orderSummary && (
              <div>
                <h4 style={{ margin: '0 0 8px', color: '#066006' }}>Invoice Summary</h4>
                <InvoiceSummaryBox summary={orderSummary.summary} discountAmount={orderSummary.discount} />
              </div>
            )}

            {/* Order Lines */}
            <div>
              <h4 style={{ margin: '0 0 8px', color: '#066006' }}>Order Lines</h4>
              {orderDetailsLoading ? (
                <LoadingSpinner message="Fetching details..." />
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

            {/* Payment History (collapsible) */}
            {selectedOrder.invoice_id && (
              <div style={{ borderTop: '1px solid #edf1ed', paddingTop: '12px' }}>
                <button
                  type="button"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#066006', fontWeight: 600, fontSize: '13px', padding: 0 }}
                  onClick={() => setShowHistory(h => !h)}
                >
                  <History size={15} />
                  Payment History ({(selectedOrder.payments || []).length} record{(selectedOrder.payments || []).length !== 1 ? 's' : ''})
                  {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showHistory && (
                  <div style={{ marginTop: '10px' }}>
                    <PaymentHistoryTable payments={selectedOrder.payments || []} />
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #edf1ed', paddingTop: '16px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedOrder(null)}>
                Close
              </button>

              {/* Print — available once invoice exists */}
              {selectedOrder.invoice_id && (
                <button type="button" className="btn btn-secondary" onClick={() => handlePrintInvoice(selectedOrder.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Printer size={14} /> Print Invoice
                </button>
              )}

              {/* DRAFT or CONFIRMED → either settle in full or invoice and collect a deposit */}
              {(selectedOrder.status === 'DRAFT' || selectedOrder.status === 'CONFIRMED') && hasPermission('manage_sales') && (
                <>
                  <button type="button" className="btn btn-secondary" disabled={orderDetailsLoading || !!actionProcessing}
                    onClick={() => handleInvoiceAndTakeDeposit(selectedOrder)}
                    style={{ color: '#92400e', borderColor: '#fbbf24', display: 'flex', alignItems: 'center' }}>
                    {actionProcessing === 'invoice_deposit' ? (
                      <><Loader2 size={14} className="spin-icon" /> Invoicing…</>
                    ) : (
                      <><CreditCard size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Invoice & Take Deposit</>
                    )}
                  </button>
                  <button type="button" className="btn btn-primary" disabled={orderDetailsLoading || !!actionProcessing}
                    onClick={() => handleComplete(selectedOrder.id)}
                    style={{ background: 'linear-gradient(135deg, #0b8f08, #066006)', display: 'flex', alignItems: 'center' }}>
                    {actionProcessing === 'complete' ? (
                      <><Loader2 size={14} className="spin-icon" /> Processing Sale…</>
                    ) : (
                      <><Zap size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Complete & Pay in Full</>
                    )}
                  </button>
                </>
              )}

              {selectedOrder.status !== 'PAID' && selectedOrder.status !== 'CANCELLED' && hasPermission('manage_sales') && (
                <button type="button" className="btn btn-secondary" disabled={orderDetailsLoading || !!actionProcessing}
                  onClick={() => handleCancelOrder(selectedOrder.id)}
                  style={{ display: 'flex', alignItems: 'center' }}>
                  {actionProcessing === 'cancel' ? (
                    <><Loader2 size={14} className="spin-icon" /> Cancelling…</>
                  ) : (
                    'Cancel Order'
                  )}
                </button>
              )}

              {hasPermission('manage_sales') && (
                <button type="button" className="btn btn-danger" disabled={orderDetailsLoading || !!actionProcessing}
                  onClick={() => handleDeleteOrder(selectedOrder.id)}
                  style={{ display: 'flex', alignItems: 'center' }}>
                  {actionProcessing === 'delete' ? (
                    <><Loader2 size={14} className="spin-icon" /> Deleting…</>
                  ) : (
                    <><Trash2 size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Delete Order</>
                  )}
                </button>
              )}

              {/* INVOICED but no payment tracking yet → Mark fully paid (fallback) */}
              {selectedOrder.status === 'INVOICED' && !canRecordPayment && hasPermission('manage_sales') && (
                <button type="button" className="btn btn-primary" disabled={orderDetailsLoading || !!actionProcessing}
                  onClick={() => handlePayInvoice(selectedOrder.id)}
                  style={{ display: 'flex', alignItems: 'center' }}>
                  {actionProcessing === 'pay' ? (
                    <><Loader2 size={14} className="spin-icon" /> Processing…</>
                  ) : (
                    <><DollarSign size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Mark as Paid</>
                  )}
                </button>
              )}

              {/* Record partial / installment payment */}
              {canRecordPayment && (
                <button type="button" className="btn btn-primary"
                  onClick={() => openPaymentModal(selectedOrder)}
                  style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}>
                  <CreditCard size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} />
                  Record Payment{orderSummary && ` (${fmt(orderSummary.summary.balance)} due)`}
                </button>
              )}

              {/* PAID status indicator */}
              {selectedOrder.status === 'PAID' && orderSummary?.summary.payment_status === 'PAID' && (
                <span style={{ color: '#0b8f08', fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle size={16} /> Paid & Closed
                </span>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Record Payment Modal ── */}
      <Modal
        isOpen={isPaymentOpen}
        zIndex={1100}
        onClose={() => setIsPaymentOpen(false)}
        title={`Record Payment — ${selectedOrder?.order_number || ''}`}
        width="sm"
      >
        {orderSummary && (
          <div style={{ marginBottom: '16px' }}>
            <InvoiceSummaryBox summary={orderSummary.summary} discountAmount={orderSummary.discount} />
          </div>
        )}
        <form onSubmit={handleRecordPayment}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <InputField
              label="Payment Amount ($)"
              id="payAmount"
              type="number"
              value={paymentForm.amount}
              onChange={(val) => setPaymentForm(prev => ({ ...prev, amount: val }))}
              required
            />
            <div className="form-field">
              <label className="form-field__label">Payment Method</label>
              <select
                className="form-select"
                value={paymentForm.paymentMethod}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, paymentMethod: e.target.value as PaymentMethod }))}
              >
                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <InputField
              label="Payment Date"
              id="payDate"
              type="date"
              value={paymentForm.paymentDate}
              onChange={(val) => setPaymentForm(prev => ({ ...prev, paymentDate: val }))}
            />
            <TextareaField
              label="Notes (optional)"
              id="payNotes"
              value={paymentForm.notes}
              onChange={(val) => setPaymentForm(prev => ({ ...prev, notes: val }))}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsPaymentOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={paymentSubmitting}>
              <CreditCard size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} />
              {paymentSubmitting ? 'Recording…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
