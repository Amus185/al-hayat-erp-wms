import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PackagePlus, Plus, UserPlus, Eye, CheckCircle, Truck,
  FileText, Printer, CreditCard, History, ChevronDown, ChevronUp,
} from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { Tabs } from '../components/Tabs';
import { Modal } from '../components/Modal';
import { InputField, TextareaField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import type { PaymentMethod, PurchaseInvoicePayment, PaymentSummary } from '../types';

// ── Local types ────────────────────────────────────────────────────
interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  status: string;
  expected_date: string | null;
  created_at: string;
  supplier_name?: string;
  purchase_invoice_id?: string | null;
  invoice_total?: number;
  invoice_discount?: number;
  net_total?: number;
  amount_paid?: number;
  balance?: number;
  payment_status?: string | null;
}

// ── Shared helpers ─────────────────────────────────────────────────
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

// ── Payment History sub-component ──────────────────────────────────
function PaymentHistoryTable({ payments }: { payments: PurchaseInvoicePayment[] }) {
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

// ── Purchase Invoice Summary box ───────────────────────────────────
function PurchaseInvoiceSummaryBox({ summary, discountAmount }: { summary: PaymentSummary; discountAmount: number }) {
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
          <span>Paid to Supplier</span>
          <span style={{ fontWeight: 600 }}>{fmt(summary.amount_paid)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '15px', borderTop: '1px solid #d1e8d1', paddingTop: '6px', marginTop: '2px' }}>
          <span style={{ color: summary.balance > 0 ? '#b45309' : '#0b8f08' }}>
            {summary.balance > 0 ? 'Remaining Payable' : '✓ Fully Paid'}
          </span>
          <span style={{ color: summary.balance > 0 ? '#b45309' : '#0b8f08' }}>{fmt(summary.balance)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────
export function PurchasingPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');

  // FilterBar
  const [poSearch, setPoSearch] = useState('');
  const [poFilters, setPoFilters] = useState<Record<string, string>>({
    supplier: '', dateFrom: '', dateTo: '', paymentStatus: '',
  });

  // Supplier modal
  const [isSupplierOpen, setIsSupplierOpen] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: '', email: '', phone: '', address: '' });

  // PO details modal
  const [selectedPO, setSelectedPO] = useState<any | null>(null);
  const [poDetailsLoading, setPoDetailsLoading] = useState(false);

  // Goods receipt sub-form
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedWHId, setSelectedWHId] = useState('');
  const [receiptLines, setReceiptLines] = useState<Record<string, number>>({});
  const [receiptLocations, setReceiptLocations] = useState<Record<string, string>>({});
  const [locationsList, setLocationsList] = useState<any[]>([]);

  // Supplier payment modal
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentMethod: 'CASH' as PaymentMethod,
    paymentDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  // Payment history toggle
  const [showHistory, setShowHistory] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────
  const loadData = async () => {
    try {
      const [orders, sups] = await Promise.all([
        apiGet<PurchaseOrder[]>('/purchasing/orders'),
        apiGet<Supplier[]>('/purchasing/suppliers'),
      ]);
      setSuppliers(sups || []);
      setPos(orders || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load purchasing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    async function loadWHs() {
      if (isReceiptOpen) {
        try {
          const whs = await apiGet<any[]>('/warehouses');
          setWarehouses(whs || []);
        } catch {}
      }
    }
    loadWHs();
  }, [isReceiptOpen]);

  useEffect(() => {
    async function loadLocations() {
      if (selectedWHId) {
        try {
          const locs = await apiGet<any[]>(`/warehouses/${selectedWHId}/locations`);
          setLocationsList(locs || []);
        } catch { setLocationsList([]); }
      } else {
        setLocationsList([]);
      }
    }
    loadLocations();
  }, [selectedWHId]);

  // ── Supplier CRUD ────────────────────────────────────────────────
  const handleSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name) { addToast('error', 'Supplier name is required'); return; }
    try {
      await apiPost('/purchasing/suppliers', supplierForm);
      addToast('success', 'Supplier registered successfully');
      setIsSupplierOpen(false);
      setSupplierForm({ name: '', email: '', phone: '', address: '' });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register supplier');
    }
  };

  // ── Approve PO ───────────────────────────────────────────────────
  const handleApprovePO = async (poId: string) => {
    try {
      setPoDetailsLoading(true);
      await apiPost<any>(`/purchasing/orders/${poId}/approve`, {});
      addToast('success', '✅ PO Approved! Inventory updated and Purchase Invoice generated.');
      await viewPoDetails({ id: poId } as any);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to approve PO');
    } finally {
      setPoDetailsLoading(false);
    }
  };

  // ── Goods receipt ────────────────────────────────────────────────
  const handleCreateReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWHId) { addToast('error', 'Please select a receiving warehouse'); return; }

    const payload = {
      purchaseOrderId: selectedPO.id,
      warehouseId: selectedWHId,
      lines: selectedPO.lines.map((l: any) => ({
        productId: l.product_id,
        quantityReceived: Number(receiptLines[l.product_id] || 0),
        warehouseLocationId: receiptLocations[l.product_id] || undefined,
      })).filter((l: any) => l.quantityReceived > 0),
    };

    if (payload.lines.length === 0) {
      addToast('error', 'At least one line item must receive units (Qty > 0)');
      return;
    }

    try {
      setPoDetailsLoading(true);
      await apiPost('/purchasing/receipts', payload);
      addToast('success', 'Goods Receipt generated and inventory updated');
      setIsReceiptOpen(false);
      setSelectedPO(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create Goods Receipt');
    } finally {
      setPoDetailsLoading(false);
    }
  };

  // ── Supplier payment ─────────────────────────────────────────────
  const openPaymentModal = (po: any) => {
    const balance = po.invoice?.balance ?? po.balance ?? 0;
    setPaymentForm({
      amount: balance > 0 ? String(Number(balance).toFixed(2)) : '',
      paymentMethod: 'CASH',
      paymentDate: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setShowHistory(false);
    setIsPaymentOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const invoiceId = selectedPO?.invoice?.id || selectedPO?.purchase_invoice_id || selectedPO?.invoice_id || selectedPO?.id;
    if (!invoiceId) { addToast('error', 'No purchase invoice found for this PO.'); return; }

    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) { addToast('error', 'Enter a valid payment amount.'); return; }

    try {
      setPaymentSubmitting(true);
      await apiPost(`/purchasing/invoices/${invoiceId}/payments`, {
        amount,
        paymentMethod: paymentForm.paymentMethod,
        paymentDate: paymentForm.paymentDate,
        notes: paymentForm.notes || undefined,
      });
      addToast('success', `Payment of ${fmt(amount)} to supplier recorded.`);
      setIsPaymentOpen(false);
      // Refresh PO details
      const details = await apiGet<any>(`/purchasing/orders/${selectedPO.id}`);
      setSelectedPO(details);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to record payment');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  // ── Print purchase invoice ───────────────────────────────────────
  const handlePrintPurchaseInvoice = async (poId: string) => {
    try {
      const data = await apiGet<any>(`/purchasing/orders/${poId}/print-invoice`);
      if (!data || !data.invoice) {
        addToast('error', 'No invoice found for this purchase order.');
        return;
      }
      const w = window.open('', '_blank');
      if (!w) { addToast('error', 'Pop-up blocked. Please allow pop-ups to print invoice.'); return; }

      const inv = data.invoice;
      const subtotal = data.lines.reduce((acc: number, l: any) => acc + (Number(l.quantity_ordered) * Number(l.unit_cost)), 0);
      const totalDiscount = data.lines.reduce((acc: number, l: any) => acc + Number(l.discount_amount || 0), 0);
      const grandTotal = Number(inv.net_total ?? inv.total_amount);
      const amountPaid = Number(inv.amount_paid ?? 0);
      const balance = Number(inv.balance ?? 0);

      w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Purchase Invoice ${inv.invoice_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #1e293b; max-width: 850px; margin: 0 auto; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #066006; padding-bottom: 20px; margin-bottom: 24px; }
    .company-title { color: #066006; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .doc-type { font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .inv-num { font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.5px; }
    .card p { font-size: 13px; margin: 3px 0; color: #334155; }
    .card p.bold { font-weight: 700; color: #0f172a; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { background: #066006; color: white; padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
    td { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    tr:nth-child(even) { background: #f8fafc; }
    .text-right { text-align: right; }
    .summary-box { display: flex; justify-content: flex-end; margin-bottom: 30px; }
    .summary-table { min-width: 280px; display: grid; gap: 6px; font-size: 13px; }
    .summary-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .grand-total { font-size: 18px; font-weight: 800; color: #066006; border-top: 2px solid #066006; padding-top: 10px; margin-top: 4px; }
    .paid-row { color: #0b8f08; }
    .balance-row { color: #b45309; font-weight: 700; font-size: 15px; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 4px; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 11px; margin-top: 30px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .badge.paid { background: #dcfce7; color: #166534; }
    .badge.partial { background: #fef3c7; color: #92400e; }
    .badge.unpaid { background: #fee2e2; color: #991b1b; }
    .btn-print { position: fixed; top: 20px; right: 20px; padding: 10px 20px; background: #066006; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 13px; box-shadow: 0 4px 12px rgba(6,96,6,0.3); }
    @media print { body { padding: 20px; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <button class="btn-print no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
  <div class="header">
    <div>
      <div class="company-title">AL-HAYAT ERP</div>
      <div class="doc-type">OFFICIAL PURCHASE INVOICE</div>
    </div>
    <div style="text-align: right;">
      <div class="inv-num">${inv.invoice_number}</div>
      <p style="font-size: 12px; color: #64748b; margin-top: 2px;">PO Ref: <strong>${data.po.po_number}</strong></p>
      <p style="font-size: 12px; color: #64748b;">Date: <strong>${new Date(inv.issued_at).toLocaleDateString()}</strong></p>
    </div>
  </div>
  <div class="meta-grid">
    <div class="card">
      <div class="card-title">Vendor / Supplier</div>
      <p class="bold">${data.supplier.name}</p>
      ${data.supplier.contactName ? `<p>Contact: ${data.supplier.contactName}</p>` : ''}
      ${data.supplier.phone ? `<p>Tel: ${data.supplier.phone}</p>` : ''}
      ${data.supplier.email ? `<p>Email: ${data.supplier.email}</p>` : ''}
      ${data.supplier.address ? `<p>${data.supplier.address}</p>` : ''}
    </div>
    <div class="card">
      <div class="card-title">Receiving Location &amp; Status</div>
      <p class="bold">Destination: ${data.warehouse.name}</p>
      ${data.warehouse.address ? `<p>${data.warehouse.address}</p>` : ''}
      <p style="margin-top: 8px;">Status: <span class="badge ${inv.payment_status === 'PAID' ? 'paid' : inv.payment_status === 'PARTIALLY_PAID' ? 'partial' : 'unpaid'}">${(inv.payment_status || inv.status || 'UNPAID').replace('_', ' ')}</span></p>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 50%;">Product Description</th>
        <th>SKU</th>
        <th class="text-right">Qty</th>
        <th class="text-right">Unit Cost</th>
        <th class="text-right">Discount</th>
        <th class="text-right">Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${data.lines.map((l: any) => `
        <tr>
          <td><strong>${l.product_name}</strong></td>
          <td style="color: #64748b; font-family: monospace;">${l.variant_sku}</td>
          <td class="text-right">${l.quantity_ordered}</td>
          <td class="text-right">$${Number(l.unit_cost).toFixed(2)}</td>
          <td class="text-right" style="color: #b45309;">-${Number(l.discount_amount || 0).toFixed(2)}</td>
          <td class="text-right" style="font-weight: 700;">$${Number(l.line_total || ((l.quantity_ordered * l.unit_cost) - Number(l.discount_amount || 0))).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="summary-box">
    <div class="summary-table">
      <div class="summary-row"><span>Subtotal:</span><span>$${subtotal.toFixed(2)}</span></div>
      ${totalDiscount > 0 ? `<div class="summary-row" style="color:#b45309"><span>Total Discount:</span><span>-$${totalDiscount.toFixed(2)}</span></div>` : ''}
      <div class="summary-row grand-total"><span>Grand Total:</span><span>$${grandTotal.toFixed(2)}</span></div>
      <div class="summary-row paid-row"><span>Paid to Supplier:</span><span>$${amountPaid.toFixed(2)}</span></div>
      ${balance > 0 ? `<div class="summary-row balance-row"><span>Remaining Payable:</span><span>$${balance.toFixed(2)}</span></div>` : ''}
    </div>
  </div>
  <div class="footer">
    <p>This is an official Purchase Invoice sheet generated by Al-Hayat ERP. Goods received into stock.</p>
    <p>Generated on ${new Date().toLocaleString()}</p>
  </div>
</body>
</html>`);
      w.document.close();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to generate printable purchase invoice.');
    }
  };

  // ── View PO details ──────────────────────────────────────────────
  const viewPoDetails = async (po: PurchaseOrder) => {
    setPoDetailsLoading(true);
    setShowHistory(false);
    try {
      const details = await apiGet<any>(`/purchasing/orders/${po.id}`);
      if (details) {
        setSelectedPO(details);
        const initialReceipt: Record<string, number> = {};
        details.lines?.forEach((l: any) => {
          initialReceipt[l.product_id] = l.quantity_ordered - (l.quantity_received || 0);
        });
        setReceiptLines(initialReceipt);
      } else {
        setSelectedPO(po);
      }
    } catch {
      addToast('error', 'Failed to fetch PO lines');
    } finally {
      setPoDetailsLoading(false);
    }
  };

  // ── Filtering ─────────────────────────────────────────────────────
  const filteredPOs = pos.filter((po) => {
    if (activeTab !== 'ALL' && po.status !== activeTab) return false;
    const q = poSearch.trim().toLowerCase();
    if (q && !po.po_number.toLowerCase().includes(q) && !String(po.supplier_name || '').toLowerCase().includes(q)) return false;
    if (poFilters.supplier && po.supplier_id !== poFilters.supplier) return false;
    if (poFilters.dateFrom && po.created_at < poFilters.dateFrom) return false;
    if (poFilters.dateTo && po.created_at > poFilters.dateTo + 'T23:59:59') return false;
    if (poFilters.paymentStatus && po.payment_status !== poFilters.paymentStatus) return false;
    return true;
  });

  const tabItems = [
    { key: 'ALL', label: 'All POs', count: pos.length },
    { key: 'DRAFT', label: 'Drafts', count: pos.filter(p => p.status === 'DRAFT').length },
    { key: 'SUBMITTED', label: 'Submitted', count: pos.filter(p => p.status === 'SUBMITTED').length },
    { key: 'APPROVED', label: 'Approved', count: pos.filter(p => p.status === 'APPROVED').length },
    { key: 'PARTIALLY_RECEIVED', label: 'Partial', count: pos.filter(p => p.status === 'PARTIALLY_RECEIVED').length },
    { key: 'RECEIVED', label: 'Received', count: pos.filter(p => p.status === 'RECEIVED').length },
  ];

  const columns: Column<any>[] = [
    { key: 'po_number', label: 'PO Number' },
    { key: 'supplier_name', label: 'Supplier' },
    {
      key: 'expected_date',
      label: 'Expected Date',
      render: (row) => row.expected_date ? new Date(row.expected_date).toLocaleDateString() : 'N/A',
    },
    {
      key: 'created_at',
      label: 'Created At',
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'status',
      label: 'PO Status',
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'neutral' | 'blue' = 'neutral';
        if (row.status === 'APPROVED' || row.status === 'FULLY_RECEIVED' || row.status === 'RECEIVED') tone = 'green';
        if (row.status === 'SUBMITTED') tone = 'blue';
        if (row.status === 'PARTIALLY_RECEIVED') tone = 'yellow';
        return <StatusBadge label={row.status.replace(/_/g, ' ')} tone={tone} />;
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
      key: 'balance',
      label: 'Balance',
      render: (row) => {
        if (row.balance == null) return <span style={{ color: '#aaa' }}>—</span>;
        return (
          <span style={{ fontWeight: 600, color: Number(row.balance) > 0 ? '#b45309' : '#0b8f08' }}>
            {fmt(row.balance)}
          </span>
        );
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => viewPoDetails(row)}>
            <Eye size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Details
          </button>
          {(row.status === 'RECEIVED' || row.status === 'FULLY_RECEIVED') && (
            <button type="button" className="btn btn-secondary btn-sm" title="Print Purchase Invoice"
              onClick={(e) => { e.stopPropagation(); handlePrintPurchaseInvoice(row.id); }}>
              <Printer size={14} style={{ inlineSize: 'auto' }} />
            </button>
          )}
        </div>
      ),
    },
  ];

  // Derive invoice summary from selectedPO
  const poInvoice = selectedPO?.invoice;
  const invoiceSummary: { summary: PaymentSummary; discount: number } | null = poInvoice
    ? {
        summary: {
          amount_paid: Number(poInvoice.amount_paid ?? 0),
          net_total: Number(poInvoice.net_total ?? poInvoice.total_amount ?? 0),
          balance: Number(poInvoice.balance ?? 0),
          payment_status: poInvoice.payment_status ?? 'UNPAID',
        },
        discount: Number(poInvoice.discount_amount ?? 0),
      }
    : null;

  const canRecordPayment =
    hasPermission('manage_purchasing') &&
    poInvoice?.id &&
    invoiceSummary &&
    invoiceSummary.summary.balance > 0.001;

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <PackagePlus size={24} />
        </div>
        <div>
          <p>Procurement</p>
          <h2>Suppliers, purchase orders, receipts, and payments</h2>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setIsSupplierOpen(true)}>
            <UserPlus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Add Supplier
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/purchasing/new')}>
            <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Create PO
          </button>
        </div>
      </section>

      <section style={{ marginBottom: '14px' }}>
        <Tabs tabs={tabItems} activeTab={activeTab} onTabChange={setActiveTab} />
      </section>

      <section className="panel">
        <FilterBar
          searchValue={poSearch}
          onSearchChange={setPoSearch}
          searchPlaceholder="Search PO number or supplier name…"
          filters={[
            {
              key: 'supplier',
              label: 'All Suppliers',
              options: suppliers.map((s) => ({ value: s.id, label: s.name })),
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
          filterValues={poFilters}
          onFilterChange={(key, val) => setPoFilters(prev => ({ ...prev, [key]: val }))}
        />
        <DataTable
          columns={columns}
          data={filteredPOs}
          keyExtractor={(row) => row.id as string}
          loading={loading}
          onRowClick={(row) => viewPoDetails(row as PurchaseOrder)}
          emptyMessage="No purchase orders match your filters"
        />
      </section>

      {/* ── Supplier Modal ── */}
      <Modal isOpen={isSupplierOpen} onClose={() => setIsSupplierOpen(false)} title="Register New Supplier" width="sm">
        <form onSubmit={handleSupplierSubmit}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <InputField label="Supplier Name" id="supName" value={supplierForm.name} onChange={(val) => setSupplierForm((prev) => ({ ...prev, name: val }))} required />
            <InputField label="Email Address" id="supEmail" type="email" value={supplierForm.email} onChange={(val) => setSupplierForm((prev) => ({ ...prev, email: val }))} />
            <InputField label="Phone Number" id="supPhone" value={supplierForm.phone} onChange={(val) => setSupplierForm((prev) => ({ ...prev, phone: val }))} />
            <TextareaField label="Business Address" id="supAddress" value={supplierForm.address} onChange={(val) => setSupplierForm((prev) => ({ ...prev, address: val }))} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsSupplierOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Register</button>
          </div>
        </form>
      </Modal>

      {/* ── Record Supplier Payment Modal ── */}
      <Modal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        title={`Pay Supplier — ${selectedPO?.po_number || ''}`}
        width="sm"
      >
        {invoiceSummary && (
          <div style={{ marginBottom: '16px' }}>
            <PurchaseInvoiceSummaryBox summary={invoiceSummary.summary} discountAmount={invoiceSummary.discount} />
          </div>
        )}
        <form onSubmit={handleRecordPayment}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <InputField
              label="Payment Amount ($)"
              id="poPayAmount"
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
              id="poPayDate"
              type="date"
              value={paymentForm.paymentDate}
              onChange={(val) => setPaymentForm(prev => ({ ...prev, paymentDate: val }))}
            />
            <TextareaField
              label="Notes (optional)"
              id="poPayNotes"
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

      {/* ── PO Details Modal ── */}
      <Modal
        isOpen={!!selectedPO}
        onClose={() => { setSelectedPO(null); setIsReceiptOpen(false); }}
        title={selectedPO ? `Purchase Order: ${selectedPO.po_number}` : 'PO Details'}
        width="lg"
      >
        {selectedPO && (
          <div style={{ display: 'grid', gap: '18px' }}>
            {/* Metadata */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '13px', background: '#f7f9f7', padding: '12px', borderRadius: '8px' }}>
              <div>
                <span style={{ color: '#667066' }}>Supplier:</span>
                <p style={{ margin: '2px 0 0', fontWeight: '700' }}>{selectedPO.supplier_name || 'N/A'}</p>
              </div>
              <div>
                <span style={{ color: '#667066' }}>Current Status:</span>
                <div style={{ marginTop: '2px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <StatusBadge label={selectedPO.status.replace(/_/g, ' ')} tone={selectedPO.status === 'RECEIVED' || selectedPO.status === 'FULLY_RECEIVED' ? 'green' : 'neutral'} />
                  {invoiceSummary && (
                    <StatusBadge label={invoiceSummary.summary.payment_status.replace('_', ' ')} tone={paymentStatusTone(invoiceSummary.summary.payment_status)} />
                  )}
                </div>
              </div>
            </div>

            {/* Invoice Payment Summary */}
            {invoiceSummary && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <FileText size={16} style={{ color: '#066006' }} />
                  <h4 style={{ margin: 0, color: '#066006' }}>Purchase Invoice</h4>
                  <span style={{ fontSize: '13px', color: '#667066' }}>{poInvoice?.invoice_number}</span>
                </div>
                <PurchaseInvoiceSummaryBox summary={invoiceSummary.summary} discountAmount={invoiceSummary.discount} />
              </div>
            )}

            {/* PO Line Items */}
            <div>
              <h4 style={{ margin: '0 0 8px', color: '#066006' }}>Ordered Items</h4>
              {poDetailsLoading ? (
                <LoadingSpinner message="Fetching lines..." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Ordered Qty</th>
                      <th>Received Qty</th>
                      <th>Unit Cost</th>
                      <th style={{ textAlign: 'right' }}>Discount</th>
                      <th style={{ textAlign: 'right' }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPO.lines?.map((line: any) => {
                      const lineTotal = line.line_total ?? ((line.quantity_ordered * line.unit_cost) - (line.discount_amount || 0));
                      return (
                        <tr key={line.id}>
                          <td><strong>{line.product_name}</strong><br /><span style={{ color: '#667066', fontSize: '12px' }}>{line.variant_sku}</span></td>
                          <td>{line.quantity_ordered}</td>
                          <td>{line.quantity_received || 0}</td>
                          <td>${Number(line.unit_cost).toLocaleString()}</td>
                          <td style={{ textAlign: 'right', color: '#b45309' }}>
                            {Number(line.discount_amount || 0) > 0 ? `-$${Number(line.discount_amount).toFixed(2)}` : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>${Number(lineTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Goods Receipt Section */}
            {isReceiptOpen ? (
              <form onSubmit={handleCreateReceipt} style={{ borderTop: '1px solid #edf1ed', paddingTop: '16px' }}>
                <h4 style={{ margin: '0 0 12px', color: '#b45309' }}>Record Goods Receipt</h4>
                <div style={{ display: 'grid', gap: '14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <InputField label="Select Warehouse" id="recWarehouse" type="text" disabled
                      value={warehouses[0]?.name || 'Central Warehouse'} onChange={() => {}} />
                    <div className="form-field">
                      <label className="form-field__label">Target Location</label>
                      <select className="form-select" value={selectedWHId}
                        onChange={(e) => setSelectedWHId(e.target.value)} required>
                        <option value="">Choose Warehouse...</option>
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <h5 style={{ margin: '10px 0 6px' }}>Verify Received Quantities</h5>
                  <table>
                    <thead>
                      <tr><th>Variant</th><th>Qty to Receive</th><th>Bin Location</th></tr>
                    </thead>
                    <tbody>
                      {selectedPO.lines?.map((l: any) => (
                        <tr key={l.product_id}>
                          <td>{l.variant_sku}</td>
                          <td>
                            <input type="number" className="form-input" style={{ width: '80px', minHeight: '32px' }}
                              value={receiptLines[l.product_id] ?? 0} min={0}
                              max={l.quantity_ordered - (l.quantity_received || 0)}
                              onChange={(e) => setReceiptLines(prev => ({ ...prev, [l.product_id]: Number(e.target.value) }))} />
                          </td>
                          <td>
                            <select className="form-select" style={{ minHeight: '32px' }}
                              value={receiptLocations[l.product_id] || ''}
                              onChange={(e) => setReceiptLocations(prev => ({ ...prev, [l.product_id]: e.target.value }))}>
                              <option value="">Default/System</option>
                              {locationsList.map(loc => (
                                <option key={loc.id} value={loc.id}>{loc.aisle}-{loc.rack}-{loc.shelf}-{loc.bin}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setIsReceiptOpen(false)}>Back</button>
                  <button type="submit" className="btn btn-primary">Post Goods Receipt</button>
                </div>
              </form>
            ) : null}

            {/* Payment History (collapsible) */}
            {poInvoice?.id && (
              <div style={{ borderTop: '1px solid #edf1ed', paddingTop: '12px' }}>
                <button type="button"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#066006', fontWeight: 600, fontSize: '13px', padding: 0 }}
                  onClick={() => setShowHistory(h => !h)}>
                  <History size={15} />
                  Supplier Payment History ({(poInvoice.payments || []).length} record{(poInvoice.payments || []).length !== 1 ? 's' : ''})
                  {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showHistory && (
                  <div style={{ marginTop: '10px' }}>
                    <PaymentHistoryTable payments={poInvoice.payments || []} />
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #edf1ed', paddingTop: '16px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedPO(null)}>Close</button>

              {poInvoice && (
                <button type="button" className="btn btn-secondary"
                  onClick={() => handlePrintPurchaseInvoice(selectedPO.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Printer size={14} /> Print Invoice
                </button>
              )}

              {selectedPO.status === 'SUBMITTED' && hasPermission('manage_purchasing') && (
                <button type="button" className="btn btn-primary"
                  onClick={() => handleApprovePO(selectedPO.id)} disabled={poDetailsLoading}>
                  <CheckCircle size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Approve &amp; Receive
                </button>
              )}

              {(selectedPO.status === 'APPROVED' || selectedPO.status === 'PARTIALLY_RECEIVED') && hasPermission('manage_purchasing') && !isReceiptOpen && (
                <button type="button" className="btn btn-primary"
                  onClick={() => setIsReceiptOpen(true)}
                  style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}>
                  <Truck size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Record Receipt
                </button>
              )}

              {canRecordPayment && (
                <button type="button" className="btn btn-primary"
                  onClick={() => openPaymentModal(selectedPO)}
                  style={{ background: 'linear-gradient(135deg, #0b8f08, #066006)' }}>
                  <CreditCard size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} />
                  Pay Supplier{invoiceSummary && ` (${fmt(invoiceSummary.summary.balance)} due)`}
                </button>
              )}

              {invoiceSummary?.summary.payment_status === 'PAID' && (
                <span style={{ color: '#0b8f08', fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle size={16} /> Supplier Paid
                </span>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
