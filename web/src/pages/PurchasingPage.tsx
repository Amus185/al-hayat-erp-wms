import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PackagePlus, Plus, UserPlus, Eye, CheckCircle, Truck,
  FileText, Printer, CreditCard, History, ChevronDown, ChevronUp,
} from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { KanbanBoard, type KanbanColumnDef } from '../components/KanbanBoard';
import { ViewSwitcher } from '../components/ViewSwitcher';
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
            {summary.balance > 0 ? 'Remaining Payable' : 'Fully Paid'}
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
  const [supplierForm, setSupplierForm] = useState({ name: '', contactPerson: '', email: '', phone: '', address: '' });

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
  const [paymentTargetPO, setPaymentTargetPO] = useState<any>(null);
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
      try {
        const whs = await apiGet<any[]>('/warehouses');
        setWarehouses(whs || []);
        if (whs && whs.length > 0) {
          setSelectedWHId(prev => prev || whs[0].id);
        }
      } catch {}
    }
    loadWHs();
  }, []);

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
      setSupplierForm({ name: '', contactPerson: '', email: '', phone: '', address: '' });
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
      addToast('success', 'PO approved successfully.');
      await viewPoDetails({ id: poId } as any);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to approve PO');
    } finally {
      setPoDetailsLoading(false);
    }
  };

  // ── Goods receipt ────────────────────────────────────────────────
  const handleCreateReceipt = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedPO) return;
    const targetWHId = selectedWHId || selectedPO.warehouse_id || (warehouses[0]?.id);
    if (!targetWHId) { addToast('error', 'Please select a receiving warehouse'); return; }

    const linesToReceive = (selectedPO.lines || [])
      .map((l: any) => ({
        productId: l.product_id,
        quantityReceived: Number(receiptLines[l.product_id] || 0),
        warehouseLocationId: receiptLocations[l.product_id] || undefined,
      }))
      .filter((l: any) => l.quantityReceived > 0);

    if (linesToReceive.length === 0) {
      addToast('error', 'Please enter a quantity (> 0) to receive for at least one item.');
      return;
    }

    try {
      setPoDetailsLoading(true);
      await apiPost('/purchasing/receipts', {
        purchaseOrderId: selectedPO.id,
        warehouseId: targetWHId,
        lines: linesToReceive,
      });
      const totalUnits = linesToReceive.reduce((sum: number, l: any) => sum + l.quantityReceived, 0);
      addToast('success', `Goods receipt recorded. Received ${totalUnits} items.`);
      await viewPoDetails({ id: selectedPO.id } as any);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to record Goods Receipt');
    } finally {
      setPoDetailsLoading(false);
    }
  };

  // ── Supplier payment ─────────────────────────────────────────────
  const openPaymentModal = (po: any) => {
    const target = po || selectedPO;
    setPaymentTargetPO(target);
    const balance = target?.invoice?.balance ?? target?.balance ?? target?.invoice_total ?? 0;
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
    const target = paymentTargetPO || selectedPO;
    const invoiceId = target?.invoice?.id || target?.purchase_invoice_id || target?.invoice_id || target?.id;
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
      setPaymentTargetPO(null);

      // Refresh PO details if modal is open
      const refreshPoId = target?.id || selectedPO?.id;
      if (refreshPoId) {
        const details = await apiGet<any>(`/purchasing/orders/${refreshPoId}`);
        if (selectedPO?.id === refreshPoId) {
          setSelectedPO(details);
        }
      }
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
  <button class="btn-print no-print" onclick="window.print()">Print / Save as PDF</button>
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
    if (poFilters.status && poFilters.status !== 'ALL' && po.status !== poFilters.status) return false;
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
    {
      key: 'po_number',
      label: 'PO Number',
      render: (row) => (
        <span style={{ fontWeight: 700, color: '#0b8f08', fontFamily: 'monospace' }}>
          {row.po_number}
        </span>
      ),
    },
    {
      key: 'supplier_name',
      label: 'Supplier',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.supplier_name || 'N/A'}</div>
          {row.expected_date && (
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Exp: {new Date(row.expected_date).toLocaleDateString()}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Created Date',
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'total',
      label: 'Total Amount',
      render: (row) => (
        <span style={{ fontWeight: 600 }}>
          {fmt(row.net_total ?? row.total_amount ?? row.invoice_total ?? 0)}
        </span>
      ),
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
        const status = row.payment_status || 'UNPAID';
        return <StatusBadge label={status.replace('_', ' ')} tone={paymentStatusTone(status)} />;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={(e) => { e.stopPropagation(); viewPoDetails(row); }}
          >
            <Eye size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Details
          </button>
          {(row.status === 'SUBMITTED' || row.status === 'APPROVED' || row.status === 'PARTIALLY_RECEIVED') && hasPermission('manage_purchasing') && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                viewPoDetails(row);
              }}
            >
              <Truck size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Receive
            </button>
          )}
          {(row.status === 'RECEIVED' || row.status === 'FULLY_RECEIVED') && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              title="Print Purchase Invoice"
              onClick={(e) => { e.stopPropagation(); handlePrintPurchaseInvoice(row.id); }}
            >
              <Printer size={14} style={{ inlineSize: 'auto' }} />
            </button>
          )}
        </div>
      ),
    },
  ];

  // Derive invoice summary from selectedPO (or fallback to PO total)
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
    : selectedPO
    ? {
        summary: {
          amount_paid: Number(selectedPO.amount_paid ?? 0),
          net_total: Number(selectedPO.net_total ?? selectedPO.total_amount ?? 0),
          balance: Math.max(0, Number(selectedPO.net_total ?? selectedPO.total_amount ?? 0) - Number(selectedPO.amount_paid ?? 0)),
          payment_status: selectedPO.payment_status ?? 'UNPAID',
        },
        discount: 0,
      }
    : null;

  const canRecordPayment =
    hasPermission('manage_purchasing') &&
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
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setIsSupplierOpen(true)}>
            <UserPlus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Add Supplier
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/purchasing/new')}>
            <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Create PO
          </button>
        </div>
      </section>

      <section className="panel">
        <FilterBar
          searchValue={poSearch}
          onSearchChange={setPoSearch}
          searchPlaceholder="Search PO number or supplier name…"
          filters={[
            {
              key: 'status',
              label: 'All Statuses',
              options: [
                { value: 'DRAFT', label: 'Drafts' },
                { value: 'SUBMITTED', label: 'Submitted' },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'PARTIALLY_RECEIVED', label: 'Partial' },
                { value: 'RECEIVED', label: 'Received' },
              ],
            },
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
            <InputField label="Supplier Name *" id="supName" value={supplierForm.name} onChange={(val) => setSupplierForm((prev) => ({ ...prev, name: val }))} required />
            <InputField label="Contact Person" id="supContact" value={supplierForm.contactPerson} onChange={(val) => setSupplierForm((prev) => ({ ...prev, contactPerson: val }))} placeholder="e.g. John Doe" />
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



      {/* ── PO Details Modal ── */}
      <Modal
        isOpen={!!selectedPO}
        onClose={() => { setSelectedPO(null); setIsReceiptOpen(false); }}
        title={selectedPO ? `Purchase Order: ${selectedPO.po_number}` : 'PO Details'}
        width="lg"
      >
        {selectedPO && (() => {
          const totalOrderedQty = selectedPO.lines?.reduce((sum: number, l: any) => sum + Number(l.quantity_ordered || l.quantity || 0), 0) || 0;
          const totalReceivedQty = selectedPO.lines?.reduce((sum: number, l: any) => sum + Number(l.quantity_received || 0), 0) || 0;
          const totalRemainingQty = Math.max(0, totalOrderedQty - totalReceivedQty);
          const isReceivable = (selectedPO.status === 'SUBMITTED' || selectedPO.status === 'APPROVED' || selectedPO.status === 'PARTIALLY_RECEIVED') && totalRemainingQty > 0;
          const totalReceivingNow = Object.values(receiptLines).reduce((sum, v) => sum + (Number(v) || 0), 0);

          return (
            <div style={{ display: 'grid', gap: '18px' }}>
              {/* Metadata */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '13px', background: '#f7f9f7', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8e2' }}>
                <div>
                  <span style={{ color: '#667066', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Supplier:</span>
                  <p style={{ margin: '2px 0 0', fontWeight: '700', fontSize: '15px' }}>{selectedPO.supplier_name || 'N/A'}</p>
                  {selectedPO.expected_date && (
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                      Expected Delivery: {new Date(selectedPO.expected_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div>
                  <span style={{ color: '#667066', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Status:</span>
                  <div style={{ marginTop: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <StatusBadge
                      label={selectedPO.status.replace(/_/g, ' ')}
                      tone={selectedPO.status === 'RECEIVED' || selectedPO.status === 'FULLY_RECEIVED' ? 'green' : selectedPO.status === 'PARTIALLY_RECEIVED' ? 'yellow' : selectedPO.status === 'SUBMITTED' ? 'blue' : 'neutral'}
                    />
                    {invoiceSummary && (
                      <StatusBadge
                        label={invoiceSummary.summary.payment_status.replace('_', ' ')}
                        tone={paymentStatusTone(invoiceSummary.summary.payment_status)}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Invoice Payment Summary */}
              {invoiceSummary && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FileText size={16} style={{ color: '#066006' }} />
                      <h4 style={{ margin: 0, color: '#066006' }}>Purchase Invoice &amp; Payment</h4>
                      <span style={{ fontSize: '13px', color: '#667066' }}>{poInvoice?.invoice_number || `PI-${selectedPO.po_number}`}</span>
                    </div>
                    {canRecordPayment && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => openPaymentModal(selectedPO)}
                        style={{ background: 'linear-gradient(135deg, #0b8f08, #066006)', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <CreditCard size={14} /> Pay Supplier ({fmt(invoiceSummary.summary.balance)} due)
                      </button>
                    )}
                  </div>
                  <PurchaseInvoiceSummaryBox summary={invoiceSummary.summary} discountAmount={invoiceSummary.discount} />
                </div>
              )}

              {/* PO Line Items */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 style={{ margin: 0, color: '#066006' }}>Ordered Items</h4>
                  <div style={{ fontSize: '12px', color: '#475569' }}>
                    Total: <strong>{totalOrderedQty} ordered</strong> &bull; <strong style={{ color: '#16a34a' }}>{totalReceivedQty} received</strong> &bull; <strong style={{ color: totalRemainingQty > 0 ? '#d97706' : '#16a34a' }}>{totalRemainingQty} remaining</strong>
                  </div>
                </div>

                {poDetailsLoading ? (
                  <LoadingSpinner message="Fetching lines..." />
                ) : (
                  <div style={{ overflowX: 'auto', border: '1px solid #e2e8e2', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f8faf8', borderBottom: '1px solid #e2e8e2' }}>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>Product</th>
                          <th style={{ padding: '8px 12px', textAlign: 'center' }}>Ordered</th>
                          <th style={{ padding: '8px 12px', textAlign: 'center' }}>Received</th>
                          <th style={{ padding: '8px 12px', textAlign: 'center' }}>Remaining</th>
                          {isReceivable && <th style={{ padding: '8px 12px', textAlign: 'center', background: '#ecfdf5', color: '#065f46' }}>Receive Now</th>}
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Unit Cost</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Discount</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPO.lines?.map((line: any) => {
                          const ordered = Number(line.quantity_ordered || line.quantity || 0);
                          const received = Number(line.quantity_received || 0);
                          const remaining = Math.max(0, ordered - received);
                          const lineTotal = line.line_total ?? ((ordered * Number(line.unit_cost)) - Number(line.discount_amount || 0));

                          return (
                            <tr key={line.id} style={{ borderBottom: '1px solid #edf1ed' }}>
                              <td style={{ padding: '10px 12px' }}>
                                <strong>{line.product_name}</strong>
                                <br />
                                <span style={{ color: '#667066', fontSize: '11px', fontFamily: 'monospace' }}>{line.variant_sku}</span>
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>{ordered}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'center', color: received > 0 ? '#16a34a' : '#64748b', fontWeight: 600 }}>
                                {received}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: remaining > 0 ? '#d97706' : '#16a34a' }}>
                                {remaining}
                              </td>
                              {isReceivable && (
                                <td style={{ padding: '10px 12px', textAlign: 'center', background: '#f0fdf4' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <input
                                      type="number"
                                      className="form-input"
                                      style={{ width: '70px', padding: '4px 6px', fontWeight: 700, textAlign: 'center', minHeight: '32px' }}
                                      min={0}
                                      max={remaining}
                                      value={receiptLines[line.product_id] ?? 0}
                                      onChange={(e) => {
                                        const val = Math.max(0, Math.min(remaining, Number(e.target.value) || 0));
                                        setReceiptLines(prev => ({ ...prev, [line.product_id]: val }));
                                      }}
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      style={{ padding: '2px 8px', fontSize: '11px', height: '28px' }}
                                      onClick={() => setReceiptLines(prev => ({ ...prev, [line.product_id]: remaining }))}
                                      title="Receive all remaining for this item"
                                    >
                                      All
                                    </button>
                                  </div>
                                </td>
                              )}
                              <td style={{ padding: '10px 12px', textAlign: 'right' }}>${Number(line.unit_cost).toLocaleString()}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', color: '#b45309' }}>
                                {Number(line.discount_amount || 0) > 0 ? `-$${Number(line.discount_amount).toFixed(2)}` : '—'}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>
                                ${Number(lineTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Partial Receiving Controls */}
              {isReceivable && (
                <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Truck size={18} style={{ color: '#0284c7' }} />
                      <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Goods Receipt / Partial Receiving</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const allRemaining: Record<string, number> = {};
                          selectedPO.lines?.forEach((l: any) => {
                            const rem = Math.max(0, Number(l.quantity_ordered || l.quantity || 0) - Number(l.quantity_received || 0));
                            allRemaining[l.product_id] = rem;
                          });
                          setReceiptLines(allRemaining);
                        }}
                      >
                        Fill All Remaining ({totalRemainingQty})
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const zeros: Record<string, number> = {};
                          selectedPO.lines?.forEach((l: any) => { zeros[l.product_id] = 0; });
                          setReceiptLines(zeros);
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'center' }}>
                    <div className="form-field" style={{ margin: 0 }}>
                      <label className="form-field__label" style={{ fontSize: '12px' }}>Receiving Warehouse</label>
                      <select
                        className="form-select"
                        style={{ minHeight: '34px', fontSize: '13px' }}
                        value={selectedWHId}
                        onChange={(e) => setSelectedWHId(e.target.value)}
                      >
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>Receipt Action</span>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={totalReceivingNow <= 0 || poDetailsLoading}
                        onClick={() => handleCreateReceipt()}
                        style={{ minHeight: '34px', background: totalReceivingNow > 0 ? 'linear-gradient(135deg, #0b8f08, #066006)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      >
                        <Truck size={15} />
                        {totalReceivingNow > 0
                          ? `Post Receipt (${totalReceivingNow} unit${totalReceivingNow > 1 ? 's' : ''})`
                          : 'Enter Qty to Receive'}
                      </button>
                    </div>

                    {selectedPO.status === 'SUBMITTED' && hasPermission('manage_purchasing') && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>PO Approval</span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={poDetailsLoading}
                          onClick={() => handleApprovePO(selectedPO.id)}
                          style={{ minHeight: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                        >
                          <CheckCircle size={15} />
                          Approve PO
                        </button>
                      </div>
                    )}
                  </div>

                  {totalReceivingNow > 0 && (
                    <div style={{ fontSize: '12px', color: '#0369a1', background: '#e0f2fe', padding: '8px 12px', borderRadius: '6px', lineHeight: 1.5 }}>
                      Receiving <strong>{totalReceivingNow}</strong> units now ({Math.max(0, totalRemainingQty - totalReceivingNow)} remaining). New status: <strong>{totalReceivingNow >= totalRemainingQty ? 'RECEIVED' : 'PARTIALLY_RECEIVED'}</strong>.
                    </div>
                  )}
                </div>
              )}

              {/* Fully Received Banner */}
              {!isReceivable && totalOrderedQty > 0 && totalRemainingQty === 0 && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#166534', fontWeight: 600 }}>
                  <CheckCircle size={18} style={{ color: '#16a34a' }} />
                  All {totalOrderedQty} ordered units have been fully received into stock.
                </div>
              )}

              {/* Goods Receipt History */}
              {selectedPO.receipts && selectedPO.receipts.length > 0 && (
                <div style={{ borderTop: '1px solid #edf1ed', paddingTop: '12px' }}>
                  <h4 style={{ margin: '0 0 10px', color: '#066006', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <History size={15} /> Goods Receipt History ({selectedPO.receipts.length} shipment{selectedPO.receipts.length !== 1 ? 's' : ''})
                  </h4>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {selectedPO.receipts.map((gr: any) => (
                      <div key={gr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8faf8', padding: '10px 14px', borderRadius: '6px', border: '1px solid #e2e8e2', fontSize: '13px' }}>
                        <div>
                          <span style={{ fontWeight: 700, color: '#066006', fontFamily: 'monospace' }}>{gr.receipt_number}</span>
                          <span style={{ color: '#64748b', marginLeft: '10px' }}>{new Date(gr.received_at).toLocaleString()}</span>
                          <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                            Received by: <strong>{gr.received_by_name || 'Staff'}</strong> &bull; Location: <strong>{gr.warehouse_name || 'Central Warehouse'}</strong>
                          </div>
                        </div>
                        <div>
                          <span style={{ fontWeight: 700, padding: '4px 10px', borderRadius: '4px', background: '#dcfce7', color: '#166534', fontSize: '12px' }}>
                            +{gr.total_items_received} units received
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment History (collapsible) */}
              {poInvoice?.payments && poInvoice.payments.length > 0 && (
                <div style={{ borderTop: '1px solid #edf1ed', paddingTop: '12px' }}>
                  <button type="button"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#066006', fontWeight: 600, fontSize: '13px', padding: 0 }}
                    onClick={() => setShowHistory(h => !h)}>
                    <History size={15} />
                    Supplier Payment History ({poInvoice.payments.length} record{poInvoice.payments.length !== 1 ? 's' : ''})
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

                {invoiceSummary?.summary.payment_status === 'PAID' && (
                  <span style={{ color: '#0b8f08', fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle size={16} /> Supplier Paid
                  </span>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Record Supplier Payment Modal ── */}
      <Modal
        isOpen={isPaymentOpen}
        zIndex={1250}
        onClose={() => { setIsPaymentOpen(false); setPaymentTargetPO(null); }}
        title={`Pay Supplier — ${paymentTargetPO?.po_number || selectedPO?.po_number || ''}`}
        width="sm"
      >
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
            <button type="button" className="btn btn-secondary" onClick={() => { setIsPaymentOpen(false); setPaymentTargetPO(null); }}>Cancel</button>
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
