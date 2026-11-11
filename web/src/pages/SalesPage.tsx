import { MoneyAccountSelect } from '../components/MoneyAccountSelect';
import { refreshAfterSave } from '../utils/afterSave';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Plus, UserPlus, Eye, CheckCircle, CheckCircle2, Clock,
  DollarSign, Zap, CreditCard, History, ChevronDown, ChevronUp, Loader2, Trash2,
  Truck, Wrench, ShieldCheck, Store,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { CreateSalesOrderModal } from '../components/CreateSalesOrderModal';
import { InputField, TextareaField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ListToolbar } from '../components/ListToolbar';
import { useColumnChooser } from '../components/ColumnChooser';
import { StatusTabs } from '../components/StatusTabs';
import { QuotationsPanel } from '../components/SalesExtraPanels';
import { SearchableSelect } from '../components/SearchableSelect';
import { useOpenParam, useServerList } from '../utils/serverList';
import { searchCustomers } from '../utils/lookups';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import type { PaymentMethod, InvoicePayment, PaymentSummary } from '../types';
import { confirmAction } from '../utils/swal';
import { useLatest } from '../utils/latest';
import { EditDraftModal, ReturnModal } from '../components/SaleAdjustModals';
import { ModalLoading } from '../components/ModalLoading';
import { DownloadDocButton } from '../components/DownloadDocButton';
import { downloadSalesInvoice } from '../utils/documents';

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
  fulfillment_type?: string;
  invoice_id?: string | null;
  delivery_status?: string | null;
  invoice_total?: number;
  /** Sum of the order lines; shown before the order is invoiced. */
  lines_total?: number;
  invoice_discount?: number;
  net_total?: number;
  amount_paid?: number;
  balance?: number;
  payment_status?: string | null;
  installation_fee?: number;
  installer_name?: string | null;
  installation_status?: string | null;
  installer_notes?: string | null;
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
          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#066006' }}>Received into</th>
          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#066006' }}>Recorded By</th>
          <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#066006' }}>Balance After</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id} style={{ borderBottom: '1px solid #edf1ed' }}>
            <td style={{ padding: '6px 10px' }}>{p.payment_date}</td>
            <td style={{ padding: '6px 10px', fontWeight: 600, color: '#0b8f08' }}>{fmt(p.amount)}</td>
            <td style={{ padding: '6px 10px' }}>{p.money_account_name || p.payment_method.replace('_', ' ')}</td>
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
            {summary.balance > 0 ? 'Remaining Balance' : 'Fully Paid'}
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

  const { isAdmin } = useAuth();
  // Orders are searched, filtered, sorted and paged on the server: every order
  // is reachable, and the filters live in the address (Back keeps them).
  const list = useServerList<SalesOrder>('/sales/orders', {
    key: 'sales-orders',
    filters: ['status', 'paymentStatus', 'customerId', 'branchId', 'fulfillment', 'dateFrom', 'dateTo'],
    defaultSort: 'date',
    defaultDir: 'desc',
  });
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (isAdmin) apiGet<{ id: string; name: string }[]>('/branches').then((b) => setBranches(b || [])).catch(() => {});
  }, [isAdmin]);

  // Customer Modal
  const [isCustomerOpen, setIsCustomerOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', email: '', phone: '', address: '' });

  // Sales Order Details Modal
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [orderDetailsLoading, setOrderDetailsLoading] = useState(false);
  // The row being opened: the details window shows at once while its data loads.
  const [openingOrder, setOpeningOrder] = useState<SalesOrder | null>(null);
  const orderRequest = useLatest();

  // Payment Modal
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [payIntoId, setPayIntoId] = useState('');
  const [payoutFromId, setPayoutFromId] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentMethod: 'CASH' as PaymentMethod,
    paymentDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  // New Order Modal
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);

  // Cancellation Modal
  const [adjust, setAdjust] = useState<'edit' | 'return' | null>(null);
  const [showQuotes, setShowQuotes] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');

  // Payment History toggle
  const [showHistory, setShowHistory] = useState(false);

  // After a change, reload the current page of orders (same filters).
  const loadData = () => list.refresh();

  const handleCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForm.name) { addToast('error', 'Customer name is required'); return; }
    try {
      const saved: any = await apiPost('/sales/customers', customerForm);
      addToast('success', saved?.already_registered
        ? `${saved.name} is already a customer (same phone). Added to your Customers.`
        : `${customerForm.name.trim()} added. Find them under Customers.`);
      setIsCustomerOpen(false);
      setCustomerForm({ name: '', email: '', phone: '', address: '' });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register customer');
    }
  };

  const [actionProcessing, setActionProcessing] = useState<'complete' | 'invoice_deposit' | 'cancel' | 'pay' | 'delete' | 'payout' | null>(null);

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
      await apiPost(`/sales/orders/${id}/complete`, { moneyAccountId: payIntoId || undefined });
      addToast('success', 'Sale completed. Invoice issued and payment recorded.');
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
      // The invoice exists now. If reloading the sale fails, say so plainly (not "failed to create invoice").
      let details: any;
      try {
        details = await apiGet<any>(`/sales/orders/${order.id}`);
      } catch {
        addToast('warning', 'Invoice created. The sale could not be reloaded to take the deposit; open the sale again and choose Record Payment.');
        loadData();
        return;
      }
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
      await apiPost(`/sales/orders/${orderId}/pay`, { moneyAccountId: payIntoId || undefined });
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

  const promptCancelOrder = (id: string) => {
    setCancellingOrderId(id);
    setCancellationReason('');
    setIsCancelModalOpen(true);
  };

  const executeCancelOrder = async () => {
    if (!cancellingOrderId) return;
    try {
      setActionProcessing('cancel');
      setOrderDetailsLoading(true);
      await apiPost(`/sales/orders/${cancellingOrderId}/cancel`, {
        reason: cancellationReason.trim(),
      });
      addToast('success', 'Sales order cancelled. The stock was put back and the accounting was reversed.');
      setIsCancelModalOpen(false);
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
        moneyAccountId: payIntoId || undefined,
        paymentDate: paymentForm.paymentDate,
        notes: paymentForm.notes || undefined,
      });
      addToast('success', `Payment of ${fmt(amount)} recorded successfully.`);
      setIsPaymentOpen(false);
      // Refresh the order details in the background: the payment is already saved.
      const orderId = selectedOrder.id;
      refreshAfterSave(addToast,
        () => apiGet<any>(`/sales/orders/${orderId}`).then((details) => setSelectedOrder((cur: any) => (cur?.id === orderId ? details : cur))),
        () => loadData());
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to record payment');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const handlePayoutInstaller = async (orderId: string, installerName?: string) => {
    const confirmed = await confirmAction(
      'Disburse Installation Fee?',
      `Confirm immediate payout of installation fee to ${installerName || 'technician'}? This posts DR 2050 (Installation Payable) and CR 1010 (Cash).`,
      'Yes, Disburse Payout',
      'info'
    );
    if (!confirmed) return;
    try {
      setActionProcessing('payout');
      await apiPost(`/sales/orders/${orderId}/installation-payout`, { installer_name: installerName, moneyAccountId: payoutFromId || undefined });
      addToast('success', 'Installation fee payout recorded and posted to GL.');
      refreshAfterSave(addToast,
        () => apiGet<any>(`/sales/orders/${orderId}`).then((updated) => setSelectedOrder((cur: any) => (cur?.id === orderId ? updated : cur))),
        () => loadData());
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to disburse installation fee');
    } finally {
      setActionProcessing(null);
    }
  };

  const downloadInvoice = async (orderId: string) => {
    const orderData = await apiGet<any>(`/sales/orders/${orderId}`);
    if (!orderData.invoice_id) throw new Error('This order has no invoice yet. Invoice the order first.');
    await downloadSalesInvoice(await apiGet<any>(`/sales/invoices/${orderData.invoice_id}/print`));
  };

  const viewOrderDetails = async (so: SalesOrder) => {
    const isCurrent = orderRequest.start();
    setShowHistory(false);
    setSelectedOrder(null);
    setOpeningOrder(so);
    try {
      const details = await apiGet<any>(`/sales/orders/${so.id}`);
      if (isCurrent()) setSelectedOrder(details || so);
    } catch (err: any) {
      if (isCurrent()) {
        addToast('error', err?.message || 'Could not load the full order details');
        setSelectedOrder(so);
      }
    } finally {
      if (isCurrent()) setOpeningOrder(null);
    }
  };

  // ?open=<order id> (quick search, notifications): show that order.
  useOpenParam((id) => viewOrderDetails({ id, order_number: '' } as SalesOrder));

  const closeOrderDetails = () => {
    orderRequest.cancel();
    setOpeningOrder(null);
    setSelectedOrder(null);
  };

  const columns: Column<any>[] = [
    {
      key: 'order_number',
      sortable: true,
      sortKey: 'number',
      label: 'Order ID',
      render: (row) => (
        <span style={{ fontWeight: 700, color: '#0b8f08', fontFamily: 'monospace' }}>
          {row.order_number}
        </span>
      ),
    },
    {
      key: 'customer_name',
      sortable: true,
      sortKey: 'customer',
      label: 'Customer & Branch',
      render: (row) => {
        const isPickup = (row.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP';
        return (
          <div>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.customer_name || 'Customer'}</div>
            <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span>{row.branch_name || 'Branch'}</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  fontSize: '10px',
                  fontWeight: 600,
                  background: isPickup ? '#ecfdf5' : '#eff6ff',
                  color: isPickup ? '#065f46' : '#1e40af',
                  border: isPickup ? '1px solid #a7f3d0' : '1px solid #bfdbfe',
                }}
              >
                {isPickup ? <Store size={10} /> : <Truck size={10} />}
                {isPickup ? 'On Hand' : 'Delivery'}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: 'created_at',
      sortable: true,
      sortKey: 'date',
      label: 'Date',
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'total',
      sortable: true,
      sortKey: 'total',
      label: 'Total Amount',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {row.net_total != null ? fmt(row.net_total) : (row.invoice_total != null ? fmt(row.invoice_total) : (row.lines_total != null ? fmt(Number(row.lines_total)) : '—'))}
          </div>
          {Number(row.installation_fee || 0) > 0 && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                color: row.installation_status === 'PAID_OUT' ? '#166534' : '#b45309',
                background: row.installation_status === 'PAID_OUT' ? '#dcfce7' : '#fef3c7',
                padding: '1px 6px',
                borderRadius: '4px',
                fontWeight: 600,
                marginTop: '2px',
              }}
              title={row.installation_status === 'PAID_OUT' ? 'Installation fee paid to technician' : 'Installation fee pending technician payout'}
            >
              <Wrench size={10} /> +${Number(row.installation_fee).toFixed(2)} Install {row.installation_status === 'PAID_OUT' ? '(Paid)' : ''}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'discount',
      label: 'Discount',
      render: (row: any) => {
        const d = Number(row.invoice_id ? row.invoice_discount : row.lines_discount) || 0;
        return d > 0.004
          ? <strong style={{ color: '#b45309' }} title="Discount given on this sale (see Reports → Discounts Given)">−{fmt(d)}</strong>
          : <span style={{ color: '#94a3b8' }}>—</span>;
      },
    },
    {
      key: 'seller_name',
      label: 'Sold by',
      render: (row: any) => row.seller_name || '—',
    },
    {
      key: 'status',
      sortable: true,
      sortKey: 'status',
      label: 'Order Status',
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'neutral' | 'blue' = 'neutral';
        if (row.status === 'CONFIRMED') tone = 'yellow';
        if (row.status === 'INVOICED') tone = 'blue';
        if (row.status === 'PAID') tone = 'green';
        if (row.status === 'DELIVERED') tone = 'green';
        if (row.status === 'CANCELLED') tone = 'red';
        return <StatusBadge label={row.status.replace('_', ' ')} tone={tone} />;
      },
    },
    {
      key: 'payment_status',
      sortable: true,
      sortKey: 'payment',
      label: 'Payment',
      render: (row) => {
        if (!row.payment_status) return <span style={{ color: '#aaa', fontSize: '12px' }}>—</span>;
        return <StatusBadge label={row.payment_status.replace('_', ' ')} tone={paymentStatusTone(row.payment_status)} />;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => {
        const isPickup = (row.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP';
        const isDelivered = row.status === 'DELIVERED' || row.delivery_status === 'DELIVERED';
        const isDispatched = row.delivery_status === 'DISPATCHED';
        const isScheduled = row.delivery_status === 'SCHEDULED' || row.delivery_status === 'PENDING';

        return (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => viewOrderDetails(row)}>
              <Eye size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Details
            </button>

            {/* Delivery State Action Button */}
            {isPickup ? (
              <span
                style={{
                  color: '#15803d',
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
                title="Counter Pickup: Items taken directly on hand at retail showroom"
              >
                <Store size={13} /> On Hand
              </span>
            ) : isDelivered ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/deliveries?search=${row.delivery_number || row.order_number}`);
                }}
                title="Delivery Completed - Click to view delivery details"
                style={{
                  color: '#15803d',
                  background: '#f0fdf4',
                  borderColor: '#86efac',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontWeight: 600,
                }}
              >
                <CheckCircle2 size={14} /> Delivered
              </button>
            ) : isDispatched ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/deliveries?search=${row.delivery_number || row.order_number}`);
                }}
                title="Delivery In Transit - Click to view tracking"
                style={{
                  color: '#0284c7',
                  background: '#f0f9ff',
                  borderColor: '#7dd3fc',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontWeight: 600,
                }}
              >
                <Truck size={14} /> In Transit
              </button>
            ) : isScheduled ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/deliveries?search=${row.delivery_number || row.order_number}`);
                }}
                title="Delivery Scheduled - Click to view"
                style={{
                  color: '#b45309',
                  background: '#fffbeb',
                  borderColor: '#fde68a',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontWeight: 600,
                }}
              >
                <Clock size={14} /> Scheduled
              </button>
            ) : ['CONFIRMED', 'INVOICED', 'PAID'].includes(row.status) ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/deliveries?orderId=${row.id}`);
                }}
                title="Schedule Delivery for this Sale"
                style={{
                  color: '#0284c7',
                  borderColor: '#bae6fd',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Truck size={14} /> Deliver
              </button>
            ) : null}

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
        );
      },
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

  const { columns: shown_columns, chooser: chooser_columns } = useColumnChooser('sales-orders', columns, []);

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
            <button type="button" className="btn btn-primary" onClick={() => setIsNewOrderModalOpen(true)}>
              <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> New Order
            </button>
          )}
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <details id="quotations-section" open={showQuotes} onToggle={(e) => setShowQuotes((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Quotations</summary>
          <div style={{ marginTop: 12 }}>{showQuotes && <QuotationsPanel />}</div>
        </details>
      </section>

      <section className="panel">
        <StatusTabs
          id="sales-status-tabs"
          value={list.filters.status}
          counts={list.counts}
          onChange={(v) => list.setFilter('status', v)}
          tabs={[
            { key: 'ALL', label: 'All' },
            { key: 'DRAFT', label: 'Drafts' },
            { key: 'CONFIRMED', label: 'Confirmed' },
            { key: 'INVOICED', label: 'Invoiced' },
            { key: 'PAID', label: 'Paid' },
            { key: 'DELIVERED', label: 'Delivered' },
            { key: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
        <ListToolbar
          id="sales-toolbar"
          columns={chooser_columns}
          list={list}
          searchPlaceholder="Search by order number, customer name or phone…"
          dateRange
          filters={[
            {
              key: 'paymentStatus',
              label: 'All payment statuses',
              options: [
                { value: 'UNPAID', label: 'Unpaid' },
                { value: 'PARTIALLY_PAID', label: 'Partially paid' },
                { value: 'PAID', label: 'Paid' },
                { value: 'NOT_INVOICED', label: 'Not invoiced yet' },
              ],
            },
            {
              key: 'fulfillment',
              label: 'Delivery & pickup',
              options: [{ value: 'DELIVERY', label: 'Delivery' }, { value: 'PICKUP', label: 'Pickup' }],
            },
            ...(isAdmin && branches.length > 1
              ? [{ key: 'branchId', label: 'All branches', options: branches.map((b) => ({ value: b.id, label: b.name })) }]
              : []),
          ]}
        >
          <div style={{ width: '240px', maxWidth: '100%' }}>
            <SearchableSelect
              id="sales-customer-filter"
              options={[]}
              value={list.filters.customerId}
              onChange={(v) => list.setFilter('customerId', v)}
              loadOptions={searchCustomers}
              selectedLabel={list.items[0]?.customer_name || 'Selected customer'}
              placeholder="All customers"
            />
          </div>
        </ListToolbar>
        {list.totals && list.total > 0 && (
          <div className="list-summary">
            <span>Value: <strong>{fmt(list.totals.value ?? 0)}</strong></span>
            <span>Outstanding: <strong style={{ color: (list.totals.outstanding ?? 0) > 0 ? '#b45309' : undefined }}>{fmt(list.totals.outstanding ?? 0)}</strong></span>
          </div>
        )}

        <DataTable
          id="sales-orders-table"
          columns={shown_columns}
          data={list.items}
          server={list}
          keyExtractor={(row) => row.id as string}
          onRowClick={(row) => viewOrderDetails(row as SalesOrder)}
          emptyMessage={list.activeFilters ? 'No sales orders match your filters' : 'No sales orders yet'}
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
        isOpen={!!selectedOrder || !!openingOrder}
        onClose={closeOrderDetails}
        title={(selectedOrder || openingOrder)?.order_number ? `Sales Order: ${(selectedOrder || openingOrder)!.order_number}` : 'Sales Order'}
        width="lg"
      >
        {!selectedOrder && openingOrder && <ModalLoading />}
        {selectedOrder && (
          <div style={{ display: 'grid', gap: '18px' }}>
            {/* Metadata Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', fontSize: '13px', background: '#f7f9f7', padding: '12px', borderRadius: '8px' }}>
              <div>
                <span style={{ color: '#667066' }}>Customer Name:</span>
                <p style={{ margin: '2px 0 0', fontWeight: '700' }}>{selectedOrder.customer_name || 'Walk-in Customer'}</p>
              </div>
              <div>
                <span style={{ color: '#667066' }}>Fulfillment Mode:</span>
                <div style={{ marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 700,
                      background: (selectedOrder.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? '#e9f6e8' : '#eff6ff',
                      color: (selectedOrder.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? '#15803d' : '#1d4ed8',
                      border: (selectedOrder.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? '1px solid #86efac' : '1px solid #bfdbfe',
                    }}
                  >
                    {(selectedOrder.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? <Store size={12} /> : <Truck size={12} />}
                    {(selectedOrder.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? 'On Hand / Counter Pickup' : 'Requires Truck Delivery'}
                  </span>
                </div>
              </div>
              <div>
                <span style={{ color: '#667066' }}>Order Status:</span>
                <div style={{ marginTop: '2px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <StatusBadge label={selectedOrder.status.replace('_', ' ')} tone={selectedOrder.status === 'PAID' ? 'green' : selectedOrder.status === 'CANCELLED' ? 'red' : 'neutral'} />
                  {orderSummary && (
                    <StatusBadge
                      label={orderSummary.summary.payment_status.replace('_', ' ')}
                      tone={paymentStatusTone(orderSummary.summary.payment_status)}
                    />
                  )}
                </div>
              </div>
            </div>

            {selectedOrder.status === 'CANCELLED' && (
              <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '8px', padding: '12px 14px', color: '#991b1b', fontSize: '13px' }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={16} /> Sale Cancelled — Stock Restored & Debt Voided
                </div>
                {selectedOrder.cancellation_reason && (
                  <div style={{ marginTop: '4px' }}><strong>Reason:</strong> {selectedOrder.cancellation_reason}</div>
                )}
                {selectedOrder.cancelled_at && (
                  <div style={{ fontSize: '11px', color: '#7f1d1d', marginTop: '2px' }}>
                    Cancelled on {new Date(selectedOrder.cancelled_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            {/* Invoice Summary */}
            {orderSummary && (
              <div>
                <h4 style={{ margin: '0 0 8px', color: '#066006' }}>Invoice Summary</h4>
                <InvoiceSummaryBox summary={orderSummary.summary} discountAmount={orderSummary.discount} />
              </div>
            )}

            {/* Service Installation Fee & Technician Card */}
            {Number(selectedOrder.installation_fee || 0) > 0 && (
              <div style={{
                background: selectedOrder.installation_status === 'PAID_OUT' ? '#f0fdf4' : '#fffbeb',
                border: `1.5px solid ${selectedOrder.installation_status === 'PAID_OUT' ? '#86efac' : '#fde68a'}`,
                borderRadius: '8px',
                padding: '14px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Wrench size={18} color={selectedOrder.installation_status === 'PAID_OUT' ? '#166534' : '#b45309'} />
                    <span style={{ fontWeight: 700, fontSize: '14px', color: selectedOrder.installation_status === 'PAID_OUT' ? '#166534' : '#92400e' }}>
                      Service Installation: {fmt(selectedOrder.installation_fee)}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: selectedOrder.installation_status === 'PAID_OUT' ? '#22c55e' : '#f59e0b',
                      color: '#ffffff'
                    }}>
                      {selectedOrder.installation_status === 'PAID_OUT' ? 'DISBURSED TO TECHNICIAN' : 'PENDING DISBURSEMENT'}
                    </span>
                  </div>

                  {selectedOrder.installation_status !== 'PAID_OUT' && hasPermission('manage_sales') && (
                    <div style={{ minWidth: 220 }}>
                      <MoneyAccountSelect id="payoutFrom" label="Pay the technician from" value={payoutFromId} onChange={setPayoutFromId}
                        branchId={selectedOrder.branch_id ?? null} amount={Number(selectedOrder.installation_fee || 0)} />
                    </div>
                  )}
                  {selectedOrder.installation_status !== 'PAID_OUT' && hasPermission('manage_sales') && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handlePayoutInstaller(selectedOrder.id, selectedOrder.installer_name)}
                      disabled={actionProcessing === 'payout'}
                      style={{
                        background: '#d97706',
                        color: '#fff',
                        border: 'none',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      {actionProcessing === 'payout' ? <><Loader2 size={12} className="spin-icon" /> Processing…</> : <><DollarSign size={13} /> Disburse to Technician</>}
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px', fontSize: '12px', color: '#475569' }}>
                  <div>
                    <span style={{ color: '#64748b' }}>Assigned Installer:</span> <strong>{selectedOrder.installer_name || 'Technician'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Notes:</span> <span>{selectedOrder.installer_notes || '—'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Order Lines */}
            <div>
              <h4 style={{ margin: '0 0 8px', color: '#066006' }}>Order Lines</h4>
              {selectedOrder.seller_name && (
                <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#475569' }}>Sold by <strong>{selectedOrder.seller_name}</strong></p>
              )}
              {orderDetailsLoading ? (
                <LoadingSpinner message="Fetching details..." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style={{ textAlign: 'center', width: '120px' }}>Fulfillment</th>
                      <th>Quantity</th>
                      <th>Unit Price</th>
                      <th>Discount</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.lines?.map((line: any) => (
                      <tr key={line.id}>
                        <td>
                          <strong>{line.product_name}</strong>
                          {line.product_type === 'GROUPED' && (
                            <span style={{ marginLeft: '6px', fontSize: '10px', background: '#dcfce7', color: '#166534', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                              Bundle
                            </span>
                          )}
                          <br />
                          <span style={{ color: '#667066', fontSize: '12px' }}>{line.product_sku}</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontWeight: 600,
                              background: (line.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? '#e9f6e8' : '#eff6ff',
                              color: (line.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? '#15803d' : '#1d4ed8',
                              border: (line.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? '1px solid #86efac' : '1px solid #bfdbfe',
                            }}
                          >
                            {(line.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP' ? 'On Hand' : 'Delivery'}
                          </span>
                        </td>
                        <td>{line.quantity}</td>
                        <td>${Number(line.unit_price).toLocaleString()}</td>
                        <td>{Number(line.discount_amount || 0) > 0.004
                          ? <strong style={{ color: '#b45309' }}>−${Number(line.discount_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                          : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                        <td><strong>${(line.quantity * line.unit_price - Number(line.discount_amount || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #edf1ed', paddingTop: '16px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={closeOrderDetails}>
                Close
              </button>

              {/* Delivery Status or Action */}
              {(selectedOrder.status === 'DELIVERED' || selectedOrder.delivery_status === 'DELIVERED') ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate(`/deliveries?search=${selectedOrder.delivery_number || selectedOrder.order_number}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#15803d', background: '#f0fdf4', borderColor: '#86efac', fontWeight: 600 }}
                >
                  <CheckCircle2 size={15} /> Delivered {selectedOrder.delivery_number ? `(${selectedOrder.delivery_number})` : ''}
                </button>
              ) : selectedOrder.delivery_status === 'DISPATCHED' ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate(`/deliveries?search=${selectedOrder.delivery_number || selectedOrder.order_number}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0284c7', background: '#f0f9ff', borderColor: '#7dd3fc', fontWeight: 600 }}
                >
                  <Truck size={15} /> In Transit ({selectedOrder.delivery_number})
                </button>
              ) : selectedOrder.delivery_status === 'SCHEDULED' ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate(`/deliveries?search=${selectedOrder.delivery_number || selectedOrder.order_number}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#b45309', background: '#fffbeb', borderColor: '#fde68a', fontWeight: 600 }}
                >
                  <Clock size={15} /> Scheduled ({selectedOrder.delivery_number})
                </button>
              ) : ['CONFIRMED', 'INVOICED', 'PAID'].includes(selectedOrder.status) ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate(`/deliveries?orderId=${selectedOrder.id}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0284c7', borderColor: '#bae6fd' }}
                >
                  <Truck size={15} /> Schedule Delivery
                </button>
              ) : null}

              {/* Where the money from "Complete Sale" / "Mark as Paid" goes */}
              {(selectedOrder.status === 'DRAFT' || selectedOrder.status === 'CONFIRMED' || selectedOrder.status === 'INVOICED') && hasPermission('manage_sales') && (
                <div style={{ flexBasis: '100%', maxWidth: 420 }}>
                  <MoneyAccountSelect id="saleSettleInto" label="Money received into" value={payIntoId} onChange={setPayIntoId}
                    branchId={selectedOrder.branch_id ?? null} />
                </div>
              )}

              {/* Download — available once the invoice exists */}
              {selectedOrder.invoice_id && (
                <DownloadDocButton id="download-invoice" label="Download invoice" make={() => downloadInvoice(selectedOrder.id)} />
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

              {selectedOrder.status === 'DRAFT' && hasPermission('manage_sales') && (
                <button type="button" id="edit-draft" className="btn btn-secondary" disabled={orderDetailsLoading || !!actionProcessing} onClick={() => setAdjust('edit')}>
                  Edit sale
                </button>
              )}
              {selectedOrder.invoice_id && selectedOrder.status !== 'CANCELLED' && hasPermission('manage_sales') && (
                <button type="button" id="return-items" className="btn btn-secondary" disabled={orderDetailsLoading || !!actionProcessing} onClick={() => setAdjust('return')}>
                  Return items
                </button>
              )}
              {selectedOrder.status !== 'PAID' && selectedOrder.status !== 'CANCELLED' && hasPermission('manage_sales') && (
                <button type="button" className="btn btn-secondary" disabled={orderDetailsLoading || !!actionProcessing}
                  onClick={() => promptCancelOrder(selectedOrder.id)}
                  style={{ display: 'flex', alignItems: 'center', color: '#b91c1c', borderColor: '#fca5a5' }}>
                  {actionProcessing === 'cancel' ? (
                    <><Loader2 size={14} className="spin-icon" /> Cancelling…</>
                  ) : (
                    'Cancel Sale'
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
        zIndex={1250}
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
            <MoneyAccountSelect id="salePayInto" label="Received into" value={payIntoId} onChange={setPayIntoId}
              branchId={selectedOrder?.branch_id ?? null} />
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

      {/* New Order Modal */}
      <CreateSalesOrderModal
        isOpen={isNewOrderModalOpen}
        onClose={() => setIsNewOrderModalOpen(false)}
        onOrderCreated={() => {
          setIsNewOrderModalOpen(false);
          loadData();
        }}
      />

      {adjust === 'edit' && selectedOrder && <EditDraftModal order={selectedOrder} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); setSelectedOrder(null); loadData(); }} />}
      {adjust === 'return' && selectedOrder && <ReturnModal order={selectedOrder} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); setSelectedOrder(null); loadData(); }} />}

      {/* Safe Cancel Order Modal with Static Backdrop */}
      <Modal
        isOpen={isCancelModalOpen}
        onClose={() => { if (!actionProcessing) setIsCancelModalOpen(false); }}
        title="Cancel Sales Order & Restore Stock"
        size="md"
      >
        <div style={{ padding: '4px 0' }}>
          <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '8px', padding: '14px', marginBottom: '16px', color: '#991b1b', fontSize: '13px' }}>
            <strong style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Safe Cancellation Guarantee</strong>
            <p style={{ margin: 0, color: '#7f1d1d', lineHeight: '1.5' }}>
              Cancelling this sales order will atomically restore furniture quantities back to branch inventory stock, void any linked invoices or customer debt records, and reverse general ledger accounting journal entries.
            </p>
          </div>
          <TextareaField
            label="Reason for Cancellation"
            id="cancelReasonInput"
            value={cancellationReason}
            onChange={setCancellationReason}
            placeholder="Please enter the reason for cancelling this sale (e.g. customer returned item, incorrect order, customer changed mind)..."
            required
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsCancelModalOpen(false)}
              disabled={!!actionProcessing}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!cancellationReason.trim() || !!actionProcessing}
              onClick={executeCancelOrder}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {actionProcessing === 'cancel' ? (
                <><Loader2 size={14} className="spin-icon" /> Cancelling & Restoring Stock…</>
              ) : (
                'Confirm & Cancel Sale'
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
