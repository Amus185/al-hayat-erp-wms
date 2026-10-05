import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Phone, Mail, MapPin, Plus, Search, ShoppingBag, DollarSign, X,
  Edit2, Trash2, ChevronDown, ChevronUp, BookOpen, Receipt, CreditCard,
  Wallet, FileText, Printer, ArrowDownRight, ArrowUpRight, CheckCircle2,
  Clock, AlertCircle, Calendar, Wrench, ShieldCheck, RefreshCw, Loader2
} from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { getCached, setCached } from '../api/cache';
import { Modal } from '../components/Modal';
import { Tabs } from '../components/Tabs';
import { StatusBadge } from '../components/StatusBadge';
import { InputField, TextareaField } from '../components/FormField';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { confirmAction } from '../utils/swal';
import type { PaymentMethod } from '../types';

// ── Interface Definitions ───────────────────────────────────────────
interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  created_at: string;
  total_orders?: number;
  total_spent?: number;
  outstanding_balance?: number;
}

interface SalesOrder {
  id: string;
  order_number: string;
  status: string;
  invoice_total?: number;
  invoice_discount?: number;
  amount_paid?: number;
  created_at: string;
  branch_name?: string;
}

interface DebtSummary {
  total_outstanding_debt: number;
  total_debt_collected: number;
  active_debtors?: number;
  total_active_debtors?: number;
}

interface DebtorRow {
  id?: string;
  customer_id: string;
  name?: string;
  customer_name: string;
  phone?: string | null;
  customer_phone: string | null;
  email?: string | null;
  customer_email: string | null;
  unpaid_sales: number;
  unpaid_sales_balance?: number;
  unpaid_manual: number;
  unpaid_manual_balance?: number;
  unallocated_payments: number;
  outstanding_balance: number;
  current_balance?: number;
  last_activity_date: string | null;
  last_payment_date?: string | null;
  active_debts_count: number;
}

interface LedgerEntry {
  id?: string;
  date: string;
  type: string;
  reference: string;
  description: string;
  debit?: number;
  charge?: number;
  credit?: number;
  payment?: number;
  running_balance: number;
}

interface CustomerLedgerData {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    current_balance?: number;
  };
  current_balance?: number;
  entries?: LedgerEntry[];
  ledger?: LedgerEntry[];
}

interface ManualDebtItem {
  id: string;
  debt_number: string;
  description: string;
  category: string;
  amount: number;
  remaining_balance: number;
  status: string;
  notes: string | null;
  created_at: string;
}

interface UnpaidInvoiceItem {
  id: string;
  invoice_number: string;
  order_number: string;
  total_amount: number;
  discount_amount: number;
  amount_paid: number;
  balance: number;
  issued_at: string;
}

interface PaymentReceipt {
  receipt_number: string;
  payment_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  payment_method: string;
  payment_date: string;
  amount: number;
  previous_balance: number;
  remaining_balance: number;
  bill_number?: string | null;
  remaining_bill_balance?: number;
  allocation_type: string;
  notes?: string | null;
  recorded_by_name?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6b7280',
  CONFIRMED: '#2563eb',
  INVOICED: '#7c3aed',
  PARTIALLY_PAID: '#d97706',
  PAID: '#059669',
  CANCELLED: '#dc2626',
};

const DEBT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'ASSEMBLY', label: 'Assembly & Installation Service' },
  { value: 'UPHOLSTERY', label: 'Custom Upholstery & Cushioning' },
  { value: 'CARPENTRY', label: 'Custom Carpentry & Woodworking' },
  { value: 'REPAIR', label: 'Furniture Repair & Restoration' },
  { value: 'OPENING_BALANCE', label: 'Opening Balance / Prior Debt' },
  { value: 'OTHER', label: 'Other Service Charge' },
];

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card / POS' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'WIRE', label: 'Wire Transfer' },
];

function fmt(n: number | null | undefined) {
  return `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CustomersPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  // Active view tab: ALL customers vs DEBTS ledger
  const [activeTab, setActiveTab] = useState<'ALL' | 'DEBTS'>('ALL');

  // Customer List & Debtors State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [debtSummary, setDebtSummary] = useState<DebtSummary>({
    total_outstanding_debt: 0,
    total_debt_collected: 0,
    active_debtors: 0,
  });
  const [debtors, setDebtors] = useState<DebtorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Expandable customer orders accordion
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, SalesOrder[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null);

  // Customer Create / Edit Modal
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '', address: '' });
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Customer Ledger Modal
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  const [selectedLedgerCustomer, setSelectedLedgerCustomer] = useState<Customer | DebtorRow | null>(null);
  const [ledgerData, setLedgerData] = useState<CustomerLedgerData | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Add Manual Debt Modal
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [debtCustomerId, setDebtCustomerId] = useState('');
  const [debtForm, setDebtForm] = useState({
    category: 'ASSEMBLY',
    description: '',
    amount: '',
    notes: '',
  });
  const [debtSubmitting, setDebtSubmitting] = useState(false);

  // Record Payment Modal
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentCustomerId, setPaymentCustomerId] = useState('');
  const [paymentAllocation, setPaymentAllocation] = useState<'ACCOUNT' | 'INVOICE' | 'MANUAL_DEBT'>('ACCOUNT');
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentMethod: 'CASH' as PaymentMethod,
    invoiceId: '',
    manualDebtId: '',
    notes: '',
  });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [unpaidInvoices, setUnpaidInvoices] = useState<UnpaidInvoiceItem[]>([]);
  const [unpaidDebts, setUnpaidDebts] = useState<ManualDebtItem[]>([]);
  const [loadingCustomerBills, setLoadingCustomerBills] = useState(false);

  // Receipt Modal
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [currentReceipt, setCurrentReceipt] = useState<PaymentReceipt | null>(null);

  // Load all data
  const loadAllData = useCallback(async () => {
    try {
      const cachedCusts = getCached<Customer[]>('customers:list');
      if (cachedCusts) {
        setCustomers(cachedCusts);
        setLoading(false);
      } else {
        setLoading(true);
      }

      const [custRes, summaryRes, debtorsRes] = await Promise.all([
        apiGet<Customer[]>('/sales/customers'),
        apiGet<DebtSummary>('/sales/debts/summary'),
        apiGet<DebtorRow[]>('/sales/debts'),
      ]);

      const custList = Array.isArray(custRes) ? custRes : [];
      setCached('customers:list', custList);
      setCustomers(custList);

      if (summaryRes) {
        setDebtSummary(summaryRes);
      }
      setDebtors(Array.isArray(debtorsRes) ? debtorsRes : []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load customer records');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Load customer orders on accordion expand
  const loadOrders = async (customerId: string) => {
    if (orders[customerId]) return;
    setLoadingOrders(customerId);
    try {
      const data = await apiGet<SalesOrder[]>(`/sales/orders?customer_id=${customerId}`);
      setOrders(prev => ({ ...prev, [customerId]: Array.isArray(data) ? data : [] }));
    } catch {
      setOrders(prev => ({ ...prev, [customerId]: [] }));
    } finally {
      setLoadingOrders(null);
    }
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      loadOrders(id);
    }
  };

  // Open Ledger Modal
  const openCustomerLedger = async (cust: Customer | DebtorRow) => {
    setSelectedLedgerCustomer(cust);
    setIsLedgerModalOpen(true);
    setLedgerLoading(true);
    const targetId = 'id' in cust ? cust.id : cust.customer_id;
    try {
      const data = await apiGet<CustomerLedgerData>(`/sales/customers/${targetId}/ledger`);
      setLedgerData(data || null);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load customer ledger');
      setLedgerData(null);
    } finally {
      setLedgerLoading(false);
    }
  };

  // Open Add Debt Modal
  const openAddDebt = (targetCustId?: string) => {
    setDebtCustomerId(targetCustId || (customers[0]?.id || ''));
    setDebtForm({
      category: 'ASSEMBLY',
      description: '',
      amount: '',
      notes: '',
    });
    setIsDebtModalOpen(true);
  };

  const handleSaveDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!debtCustomerId) { addToast('error', 'Please select a customer.'); return; }
    const amt = Number(debtForm.amount);
    if (!amt || amt <= 0) { addToast('error', 'Please enter a valid charge amount.'); return; }
    if (!debtForm.description.trim()) { addToast('error', 'Please enter a description for this charge.'); return; }

    try {
      setDebtSubmitting(true);
      await apiPost(`/sales/customers/${debtCustomerId}/debts`, {
        category: debtForm.category,
        description: debtForm.description.trim(),
        amount: amt,
        notes: debtForm.notes.trim() || undefined,
      });

      addToast('success', `Manual charge of ${fmt(amt)} recorded and posted to General Ledger.`);
      setIsDebtModalOpen(false);
      loadAllData();

      // If ledger is open for this customer, refresh it
      if (selectedLedgerCustomer) {
        const curId = 'id' in selectedLedgerCustomer ? selectedLedgerCustomer.id : selectedLedgerCustomer.customer_id;
        if (curId === debtCustomerId) {
          openCustomerLedger(selectedLedgerCustomer);
        }
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to record manual debt charge');
    } finally {
      setDebtSubmitting(false);
    }
  };

  // Load unpaid bills (invoices and manual debts) when opening payment modal
  const loadBillsForCustomer = async (cId: string) => {
    if (!cId) return;
    setLoadingCustomerBills(true);
    try {
      const [invRes, debtsRes] = await Promise.all([
        apiGet<any[]>(`/sales/orders?customer_id=${cId}`),
        apiGet<ManualDebtItem[]>(`/sales/customers/${cId}/debts`),
      ]);

      const unpaidInvs: UnpaidInvoiceItem[] = (invRes || [])
        .filter((o: any) => o.invoice_id && (o.balance > 0.01 || o.payment_status !== 'PAID'))
        .map((o: any) => ({
          id: o.invoice_id,
          invoice_number: o.invoice_number || `INV-${o.order_number}`,
          order_number: o.order_number,
          total_amount: Number(o.invoice_total || o.net_total || 0),
          discount_amount: Number(o.invoice_discount || 0),
          amount_paid: Number(o.amount_paid || 0),
          balance: Number(o.balance || 0),
          issued_at: o.created_at,
        }));

      const activeDebts: ManualDebtItem[] = (debtsRes || []).filter(
        (d: ManualDebtItem) => Number(d.remaining_balance) > 0.01 && d.status !== 'PAID'
      );

      setUnpaidInvoices(unpaidInvs);
      setUnpaidDebts(activeDebts);
    } catch (err) {
      console.warn('Failed loading customer bills for payment modal:', err);
    } finally {
      setLoadingCustomerBills(false);
    }
  };

  // Open Payment Modal
  const openPaymentModal = (targetCustId?: string, prefillAmount?: number) => {
    const custId = targetCustId || (customers[0]?.id || '');
    setPaymentCustomerId(custId);
    setPaymentAllocation('ACCOUNT');

    // Determine target customer's current outstanding balance
    const targetCust = customers.find(c => c.id === custId);
    const targetDebtor = debtors.find(d => d.customer_id === custId);
    const bal = prefillAmount !== undefined
      ? prefillAmount
      : (targetDebtor?.outstanding_balance ?? targetCust?.outstanding_balance ?? 0);

    setPaymentForm({
      amount: bal > 0 ? String(bal) : '',
      paymentMethod: 'CASH',
      invoiceId: '',
      manualDebtId: '',
      notes: '',
    });

    setIsPaymentModalOpen(true);
    loadBillsForCustomer(custId);
  };

  const handleCustomerChangeInPayment = (newCustId: string) => {
    setPaymentCustomerId(newCustId);
    const targetCust = customers.find(c => c.id === newCustId);
    const targetDebtor = debtors.find(d => d.customer_id === newCustId);
    const bal = targetDebtor?.outstanding_balance ?? targetCust?.outstanding_balance ?? 0;
    setPaymentForm(prev => ({
      ...prev,
      amount: bal > 0 ? String(bal) : '',
      invoiceId: '',
      manualDebtId: '',
    }));
    loadBillsForCustomer(newCustId);
  };

  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentCustomerId) { addToast('error', 'Please select a customer.'); return; }
    const amt = Number(paymentForm.amount);
    if (!amt || amt <= 0) { addToast('error', 'Please enter a valid payment amount.'); return; }

    if (paymentAllocation === 'INVOICE' && !paymentForm.invoiceId) {
      addToast('error', 'Please select an unpaid sales invoice to allocate payment to.');
      return;
    }
    if (paymentAllocation === 'MANUAL_DEBT' && !paymentForm.manualDebtId) {
      addToast('error', 'Please select an unpaid manual debt charge to allocate payment to.');
      return;
    }

    try {
      setPaymentSubmitting(true);
      const res = await apiPost<{ success: boolean; receipt: PaymentReceipt }>('/sales/payments', {
        customerId: paymentCustomerId,
        allocationType: paymentAllocation,
        invoiceId: paymentAllocation === 'INVOICE' ? paymentForm.invoiceId : undefined,
        manualDebtId: paymentAllocation === 'MANUAL_DEBT' ? paymentForm.manualDebtId : undefined,
        amount: amt,
        paymentMethod: paymentForm.paymentMethod,
        notes: paymentForm.notes.trim() || undefined,
      });

      addToast('success', `Payment of ${fmt(amt)} recorded. Receipt generated!`);
      setIsPaymentModalOpen(false);
      loadAllData();

      // Show printable receipt modal
      if (res?.receipt) {
        setCurrentReceipt(res.receipt);
        setIsReceiptModalOpen(true);
      }

      // If ledger is open, refresh it
      if (selectedLedgerCustomer) {
        const curId = 'id' in selectedLedgerCustomer ? selectedLedgerCustomer.id : selectedLedgerCustomer.customer_id;
        if (curId === paymentCustomerId) {
          openCustomerLedger(selectedLedgerCustomer);
        }
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to process payment');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  // Customer Create / Edit Handlers
  const openCreateCustomer = () => {
    setEditCustomer(null);
    setCustomerForm({ name: '', phone: '', email: '', address: '' });
    setShowCustomerModal(true);
  };

  const openEditCustomer = (c: Customer) => {
    setEditCustomer(c);
    setCustomerForm({
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
    });
    setShowCustomerModal(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForm.name.trim()) { addToast('error', 'Customer name is required'); return; }
    try {
      setSavingCustomer(true);
      if (editCustomer) {
        await apiPatch(`/sales/customers/${editCustomer.id}`, customerForm);
        addToast('success', 'Customer profile updated.');
      } else {
        await apiPost('/sales/customers', customerForm);
        addToast('success', 'Customer registered successfully.');
      }
      setShowCustomerModal(false);
      loadAllData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to save customer');
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleDeleteCustomer = async (id: string, name: string) => {
    const confirmed = await confirmAction(
      'Delete Customer?',
      `Are you sure you want to permanently delete customer "${name}"? Sales orders will be retained.`,
      'Yes, Delete Customer',
      'warning'
    );
    if (!confirmed) return;
    try {
      await apiDelete(`/sales/customers/${id}`);
      addToast('success', 'Customer deleted.');
      loadAllData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to delete customer');
    }
  };

  // Filtered lists
  const filteredCustomers = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  }, [customers, search]);

  const activeDebtors = useMemo(() => {
    return debtors.filter(d => (d.outstanding_balance ?? (d as any).current_balance ?? 0) > 0.01);
  }, [debtors]);

  const filteredDebtors = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return activeDebtors;
    return activeDebtors.filter(d => {
      const name = d.customer_name || (d as any).name || '';
      const phone = d.customer_phone || (d as any).phone || '';
      const email = d.customer_email || (d as any).email || '';
      return (
        name.toLowerCase().includes(q) ||
        phone.includes(q) ||
        email.toLowerCase().includes(q)
      );
    });
  }, [activeDebtors, search]);

  // Printable Statement Trigger
  const handlePrintStatement = () => {
    if (!ledgerData) return;
    const w = window.open('', '_blank');
    if (!w) { addToast('error', 'Pop-up blocked. Please allow pop-ups to print statement.'); return; }

    const c = ledgerData.customer;
    const currentBal = ledgerData.current_balance ?? ledgerData.customer?.current_balance ?? 0;
    const entries = ledgerData.entries || (ledgerData as any).ledger || [];

    w.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Account Statement — ${c.name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 36px; color: #1e293b; max-width: 850px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; border-bottom: 3px solid #066006; padding-bottom: 16px; margin-bottom: 24px; }
          .header h1 { color: #066006; font-size: 24px; margin-bottom: 4px; }
          .header p { color: #64748b; font-size: 13px; }
          .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
          .card h3 { font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 6px; letter-spacing: 0.5px; }
          .card p { font-size: 14px; margin: 2px 0; }
          .balance-box { background: #fef2f2; border: 1.5px solid #fca5a5; border-radius: 8px; padding: 14px; text-align: right; }
          .balance-box h3 { font-size: 11px; text-transform: uppercase; color: #991b1b; }
          .balance-box .amount { font-size: 24px; font-weight: 700; color: #b91c1c; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 24px; font-size: 12px; }
          th { background: #066006; color: white; padding: 8px 10px; text-align: left; }
          td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
          tr:nth-child(even) { background: #f8fafc; }
          .debit { color: #b91c1c; font-weight: 600; text-align: right; }
          .credit { color: #15803d; font-weight: 600; text-align: right; }
          .run-bal { font-weight: 700; text-align: right; }
          .footer { text-align: center; color: #94a3b8; font-size: 11px; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 40px; }
          @media print { button { display: none !important; } body { padding: 15px; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:8px 16px;background:#066006;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Print Statement</button>
        <div class="header">
          <div>
            <h1>AL-HAYAT FURNITURE STORE</h1>
            <p>Customer Statement of Account & Debt Ledger</p>
          </div>
          <div style="text-align: right;">
            <p>Date: ${new Date().toLocaleDateString()}</p>
            <p>Generated by Store Management System</p>
          </div>
        </div>
        <div class="meta">
          <div class="card">
            <h3>Customer Profile</h3>
            <p><strong>${c.name}</strong></p>
            ${c.phone ? `<p>Phone: ${c.phone}</p>` : ''}
            ${c.email ? `<p>Email: ${c.email}</p>` : ''}
            ${c.address ? `<p>Address: ${c.address}</p>` : ''}
          </div>
          <div class="balance-box">
            <h3>Net Outstanding Balance</h3>
            <div class="amount">${fmt(currentBal)}</div>
            <p style="font-size: 11px; color: #7f1d1d; margin-top: 4px;">As of ${new Date().toLocaleDateString()}</p>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Reference</th>
              <th>Description</th>
              <th style="text-align: right;">Charge (DR)</th>
              <th style="text-align: right;">Payment (CR)</th>
              <th style="text-align: right;">Running Balance</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(e => {
              const debitVal = Number(e.debit ?? (e as any).charge ?? 0);
              const creditVal = Number(e.credit ?? (e as any).payment ?? 0);
              return `
              <tr>
                <td>${new Date(e.date).toLocaleDateString()}</td>
                <td style="font-family: monospace; font-weight: 600;">${e.reference}</td>
                <td>${e.description}</td>
                <td class="debit">${debitVal > 0 ? fmt(debitVal) : '—'}</td>
                <td class="credit">${creditVal > 0 ? fmt(creditVal) : '—'}</td>
                <td class="run-bal" style="color: ${e.running_balance > 0 ? '#b91c1c' : '#15803d'};">${fmt(e.running_balance)}</td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
        <div class="footer">
          <p>Thank you for choosing Al-Hayat Furniture Store. For billing inquiries, please contact management.</p>
        </div>
      </body>
      </html>
    `);
    w.document.close();
  };

  // Printable Receipt Trigger
  const handlePrintReceiptWindow = () => {
    if (!currentReceipt) return;
    const w = window.open('', '_blank');
    if (!w) { addToast('error', 'Pop-up blocked. Please allow pop-ups to print receipt.'); return; }

    w.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt — ${currentReceipt.receipt_number}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #1e293b; max-width: 550px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; margin-top: 20px; }
          .header { text-align: center; border-bottom: 2px dashed #94a3b8; padding-bottom: 16px; margin-bottom: 16px; }
          .header h1 { font-size: 20px; color: #066006; letter-spacing: 0.5px; }
          .header p { font-size: 12px; color: #64748b; margin-top: 2px; }
          .receipt-tag { display: inline-block; background: #dcfce7; color: #166534; font-weight: 700; font-size: 12px; padding: 3px 10px; border-radius: 4px; margin-top: 8px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; margin-bottom: 16px; }
          .info-group { background: #f8fafc; padding: 8px 12px; border-radius: 6px; }
          .info-group label { display: block; font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 600; }
          .info-group span { font-weight: 600; color: #0f172a; }
          .amount-banner { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 14px; text-align: center; margin-bottom: 16px; }
          .amount-banner .lbl { font-size: 11px; text-transform: uppercase; color: #15803d; font-weight: 600; }
          .amount-banner .val { font-size: 28px; font-weight: 800; color: #166534; margin: 4px 0; }
          .breakdown { border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 10px 0; margin-bottom: 16px; font-size: 13px; }
          .breakdown-row { display: flex; justify-content: space-between; padding: 4px 0; }
          .breakdown-row.strong { font-weight: 700; font-size: 14px; }
          .footer { text-align: center; font-size: 11px; color: #94a3b8; margin-top: 20px; line-height: 1.5; }
          @media print { button { display: none !important; } body { border: none; padding: 10px; margin-top: 0; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:8px 16px;background:#066006;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Print Receipt</button>
        <div class="header">
          <h1>AL-HAYAT FURNITURE STORE</h1>
          <p>Official Payment Receipt</p>
          <div class="receipt-tag">${currentReceipt.receipt_number}</div>
        </div>
        <div class="info-grid">
          <div class="info-group">
            <label>Customer Name</label>
            <span>${currentReceipt.customer_name}</span>
          </div>
          <div class="info-group">
            <label>Date & Time</label>
            <span>${new Date(currentReceipt.payment_date).toLocaleString()}</span>
          </div>
          <div class="info-group">
            <label>Payment Method</label>
            <span>${currentReceipt.payment_method.replace('_', ' ')}</span>
          </div>
          <div class="info-group">
            <label>Allocation</label>
            <span>${currentReceipt.allocation_type === 'INVOICE' ? 'Sale Invoice' : currentReceipt.allocation_type === 'MANUAL_DEBT' ? 'Manual Service Charge' : 'General Customer Account'}</span>
          </div>
        </div>
        <div class="amount-banner">
          <div class="lbl">Amount Received</div>
          <div class="val">${fmt(currentReceipt.amount)}</div>
        </div>
        <div class="breakdown">
          <div class="breakdown-row">
            <span>Previous Outstanding Balance:</span>
            <span>${fmt(currentReceipt.previous_balance)}</span>
          </div>
          <div class="breakdown-row" style="color: #15803d; font-weight: 600;">
            <span>Payment Applied:</span>
            <span>-${fmt(currentReceipt.amount)}</span>
          </div>
          <div class="breakdown-row strong" style="border-top: 1px dashed #cbd5e1; padding-top: 6px; margin-top: 4px; color: ${currentReceipt.remaining_balance > 0 ? '#b45309' : '#15803d'};">
            <span>Remaining Balance:</span>
            <span>${fmt(currentReceipt.remaining_balance)}</span>
          </div>
        </div>
        ${currentReceipt.notes ? `<div style="font-size: 12px; color: #475569; margin-bottom: 12px;"><strong>Notes:</strong> ${currentReceipt.notes}</div>` : ''}
        <div class="footer">
          <p>Thank you for your payment!</p>
          <p>Authorized Cashier Signature / Store Stamp</p>
        </div>
      </body>
      </html>
    `);
    w.document.close();
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#111827' }}>Customers & Debt Management</h2>
            <button
              onClick={loadAllData}
              title="Refresh customer data"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '14px' }}>
            Unified customer ledger, manual service charges, and real-time payment processing
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {hasPermission('manage_sales') && (
            <>
              <button
                type="button"
                onClick={() => openAddDebt()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 15px',
                  background: '#f8fafc',
                  color: '#b45309',
                  border: '1.5px solid #fde68a',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                <Wrench size={15} /> Add Manual Charge
              </button>

              <button
                type="button"
                onClick={() => openPaymentModal()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 15px',
                  background: '#f0fdf4',
                  color: '#15803d',
                  border: '1.5px solid #86efac',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                <CreditCard size={15} /> Record Payment
              </button>

              <button
                type="button"
                onClick={openCreateCustomer}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 16px',
                  background: '#0b8f08',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                <Plus size={16} /> New Customer
              </button>
            </>
          )}
        </div>
      </div>

      {/* Debt & Sales Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '22px' }}>
        <div style={{ background: '#fff', border: '1.5px solid #fecaca', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ background: '#fef2f2', borderRadius: '10px', padding: '12px', color: '#b91c1c' }}>
            <Wallet size={24} />
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#991b1b' }}>{fmt(debtSummary.total_outstanding_debt)}</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7f1d1d' }}>Total Outstanding Debt</div>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1.5px solid #bbf7d0', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '12px', color: '#16a34a' }}>
            <CheckCircle2 size={24} />
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d' }}>{fmt(debtSummary.total_debt_collected)}</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#166534' }}>Total Debt Collected</div>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1.5px solid #bfdbfe', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ background: '#eff6ff', borderRadius: '10px', padding: '12px', color: '#2563eb' }}>
            <Users size={24} />
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#1d4ed8' }}>
              {debtSummary.active_debtors ?? debtSummary.total_active_debtors ?? activeDebtors.length}
            </div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#1e40af' }}>Active Debtors</div>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px', color: '#475569' }}>
            <ShoppingBag size={24} />
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>{customers.length}</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Total Customers</div>
          </div>
        </div>
      </div>

      {/* Tabs & Search Header */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 18px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <Tabs
          tabs={[
            { id: 'ALL', label: `All Customers (${customers.length})` },
            { id: 'DEBTS', label: `Customer Debt Ledger (${activeDebtors.length})` },
          ]}
          activeTab={activeTab}
          onChange={(tab) => setActiveTab(tab as 'ALL' | 'DEBTS')}
        />

        <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name, phone, email…"
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Main Tab Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
          <Loader2 size={28} className="spin-icon" style={{ margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: '14px' }}>Loading customer financial records…</p>
        </div>
      ) : activeTab === 'DEBTS' ? (
        /* ── TAB 2: CUSTOMER DEBT LEDGER ───────────────────────────── */
        filteredDebtors.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#64748b', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <CheckCircle2 size={44} color="#16a34a" style={{ marginBottom: '12px' }} />
            <p style={{ margin: 0, fontWeight: 700, fontSize: '16px', color: '#15803d' }}>No Active Debtors Found</p>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              All customer furniture sales and non-inventory charges are fully settled.
            </p>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>Customer & Contact</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>Unpaid Sales</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>Manual Charges</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>Unallocated</th>
                    <th style={{ padding: '12px 16px', fontWeight: 700, color: '#991b1b', textAlign: 'right' }}>Net Outstanding Debt</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'center' }}>Last Activity</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDebtors.map((d) => {
                    const custId = d.customer_id || (d as any).id;
                    const custName = d.customer_name || (d as any).name || 'Unknown Customer';
                    const custPhone = d.customer_phone || (d as any).phone;
                    const custEmail = d.customer_email || (d as any).email;
                    const unpaidSales = Number(d.unpaid_sales ?? (d as any).unpaid_sales_balance ?? 0);
                    const unpaidManual = Number(d.unpaid_manual ?? (d as any).unpaid_manual_balance ?? 0);
                    const unallocated = Number(d.unallocated_payments ?? 0);
                    const netOutstanding = Number(d.outstanding_balance ?? (d as any).current_balance ?? 0);
                    const lastAct = d.last_activity_date || (d as any).last_payment_date;

                    return (
                      <tr key={custId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{custName}</div>
                          <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', gap: '10px', marginTop: '2px' }}>
                            {custPhone && <span>📞 {custPhone}</span>}
                            {custEmail && <span>✉️ {custEmail}</span>}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#334155' }}>
                          {fmt(unpaidSales)}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#b45309' }}>
                          {fmt(unpaidManual)}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>
                          {unallocated > 0 ? `-${fmt(unallocated)}` : '$0.00'}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <span style={{
                            fontWeight: 800,
                            fontSize: '14px',
                            color: '#b91c1c',
                            background: '#fef2f2',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid #fecaca',
                            display: 'inline-block',
                          }}>
                            {fmt(netOutstanding)}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
                          {lastAct ? new Date(lastAct).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button
                              type="button"
                              onClick={() => openCustomerLedger(d)}
                              title="View Chronological Ledger"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '5px 9px',
                                background: '#f8fafc',
                                color: '#0f172a',
                                border: '1px solid #cbd5e1',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              <BookOpen size={13} /> Ledger
                            </button>
                            {hasPermission('manage_sales') && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openAddDebt(custId)}
                                  title="Add Manual Charge (assembly, repair, upholstery)"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '5px 8px',
                                    background: '#fffbeb',
                                    color: '#b45309',
                                    border: '1px solid #fde68a',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  <Wrench size={13} /> Charge
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openPaymentModal(custId, netOutstanding)}
                                  title="Record Debt Payment"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '5px 8px',
                                  background: '#f0fdf4',
                                  color: '#15803d',
                                  border: '1px solid #86efac',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                <CreditCard size={13} /> Pay
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        /* ── TAB 1: ALL CUSTOMERS LIST ─────────────────────────────── */
        filteredCustomers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <Users size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
            <p style={{ margin: 0, fontWeight: 600 }}>No customers found</p>
            <p style={{ margin: '4px 0 0', fontSize: '13px' }}>Click "New Customer" to register a new account.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredCustomers.map(customer => {
              const isExpanded = expandedId === customer.id;
              const customerOrders = orders[customer.id];
              const orderCount = customerOrders !== undefined ? customerOrders.length : Number(customer.total_orders || 0);
              const totalSpent = customerOrders !== undefined
                ? customerOrders.reduce((sum, o) => {
                    const net = Math.max(0, (o.invoice_total || 0) - (o.invoice_discount || 0));
                    return sum + net;
                  }, 0)
                : Number(customer.total_spent || 0);

              const outBalance = Number(customer.outstanding_balance || 0);

              return (
                <div key={customer.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', transition: 'box-shadow 0.2s' }}>
                  {/* Customer Card Header Row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px', cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => toggleExpand(customer.id)}>
                    {/* Avatar */}
                    <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: outBalance > 0 ? '#fee2e2' : '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '16px', color: outBalance > 0 ? '#b91c1c' : '#0b8f08', flexShrink: 0 }}>
                      {customer.name.charAt(0).toUpperCase()}
                    </div>

                    {/* Customer Info */}
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: '#111827', fontSize: '15px' }}>{customer.name}</span>
                        {outBalance > 0 ? (
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#991b1b', background: '#fee2e2', border: '1px solid #fecaca', padding: '1px 8px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <AlertCircle size={11} /> Debt: {fmt(outBalance)}
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#166534', background: '#dcfce7', padding: '1px 8px', borderRadius: '12px' }}>
                            Settled
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' }}>
                        {customer.phone && <span style={{ fontSize: '13px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}><Phone size={12} />{customer.phone}</span>}
                        {customer.email && <span style={{ fontSize: '13px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}><Mail size={12} />{customer.email}</span>}
                        {customer.address && <span style={{ fontSize: '13px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={12} />{customer.address}</span>}
                      </div>
                    </div>

                    {/* Sales & Orders Stats */}
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '100px' }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{fmt(totalSpent)}</div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>{orderCount} {orderCount === 1 ? 'order' : 'orders'}</div>
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openCustomerLedger(customer)}
                        title="View Customer Ledger & Statement"
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', color: '#1e293b', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                      >
                        <BookOpen size={13} /> Ledger
                      </button>

                      {hasPermission('manage_sales') && (
                        <>
                          <button
                            type="button"
                            onClick={() => openAddDebt(customer.id)}
                            title="Add non-inventory manual service charge"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 9px', border: '1px solid #fde68a', borderRadius: '6px', background: '#fffbeb', color: '#b45309', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                          >
                            <Wrench size={13} /> Charge
                          </button>

                          <button
                            type="button"
                            onClick={() => openPaymentModal(customer.id, outBalance)}
                            title="Record Customer Payment"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 9px', border: '1px solid #86efac', borderRadius: '6px', background: '#f0fdf4', color: '#15803d', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                          >
                            <CreditCard size={13} /> Pay
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditCustomer(customer)}
                            style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
                            title="Edit Customer"
                          >
                            <Edit2 size={13} />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteCustomer(customer.id, customer.name)}
                            style={{ padding: '6px 8px', border: '1px solid #fee2e2', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}
                            title="Delete Customer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Expand arrow */}
                    <div style={{ color: '#94a3b8', flexShrink: 0 }}>
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>

                  {/* Orders Panel (Expanded) */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid #f1f5f9', padding: '16px 20px', background: '#f8fafc' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Sales Orders for {customer.name}
                        </h4>
                        <button
                          type="button"
                          onClick={() => openCustomerLedger(customer)}
                          style={{ background: 'none', border: 'none', color: '#0b8f08', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <BookOpen size={12} /> Open Full Statement & Ledger →
                        </button>
                      </div>

                      {loadingOrders === customer.id ? (
                        <div style={{ color: '#94a3b8', fontSize: '13px', padding: '12px 0' }}>
                          <Loader2 size={16} className="spin-icon" style={{ display: 'inline', marginRight: '6px' }} />
                          Fetching sales order records…
                        </div>
                      ) : (customerOrders || []).length === 0 ? (
                        <div style={{ color: '#94a3b8', fontSize: '13px', padding: '8px 0' }}>No sales orders recorded yet for this customer.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {(customerOrders || []).map(order => {
                            const net = Math.max(0, (order.invoice_total || 0) - (order.invoice_discount || 0));
                            const balance = Math.max(0, net - (order.amount_paid || 0));
                            return (
                              <div key={order.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0b8f08', fontSize: '13px' }}>{order.order_number}</span>
                                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '12px', background: `${STATUS_COLORS[order.status] || '#6b7280'}20`, color: STATUS_COLORS[order.status] || '#6b7280', fontWeight: 700 }}>
                                  {order.status}
                                </span>
                                {order.branch_name && <span style={{ fontSize: '12px', color: '#64748b' }}>{order.branch_name}</span>}
                                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                                  {net > 0 && <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>{fmt(net)}</div>}
                                  {balance > 0.01 ? (
                                    <div style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 700 }}>Unpaid Balance: {fmt(balance)}</div>
                                  ) : (
                                    <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>Fully Paid</div>
                                  )}
                                </div>
                                <div style={{ fontSize: '12px', color: '#94a3b8', flexShrink: 0 }}>{new Date(order.created_at).toLocaleDateString()}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── MODAL 1: CUSTOMER LEDGER / STATEMENT ────────────────────── */}
      <Modal
        isOpen={isLedgerModalOpen}
        onClose={() => setIsLedgerModalOpen(false)}
        title={`Customer Statement & Ledger — ${selectedLedgerCustomer?.name || (selectedLedgerCustomer as any)?.customer_name || 'Customer'}`}
        size="lg"
      >
        {ledgerLoading ? (
          <div style={{ textAlign: 'center', padding: '50px 0', color: '#64748b' }}>
            <Loader2 size={28} className="spin-icon" style={{ margin: '0 auto 10px' }} />
            <p style={{ margin: 0, fontSize: '14px' }}>Loading chronological customer ledger…</p>
          </div>
        ) : !ledgerData ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#dc2626' }}>
            Failed to load customer ledger. Please try again.
          </div>
        ) : (() => {
          const ledgerEntries = ledgerData.entries || (ledgerData as any).ledger || [];
          const currentBal = ledgerData.current_balance ?? ledgerData.customer?.current_balance ?? 0;

          return (
            <div>
              {/* Ledger Header Card with Running Balance */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <h4 style={{ margin: '0 0 6px', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>Customer Information</h4>
                  <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>{ledgerData.customer?.name}</div>
                  {ledgerData.customer?.phone && <div style={{ fontSize: '13px', color: '#475569', marginTop: '2px' }}>📞 {ledgerData.customer.phone}</div>}
                  {ledgerData.customer?.address && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>📍 {ledgerData.customer.address}</div>}
                </div>

                <div style={{
                  background: currentBal > 0 ? '#fef2f2' : '#f0fdf4',
                  border: `1.5px solid ${currentBal > 0 ? '#fca5a5' : '#86efac'}`,
                  borderRadius: '10px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}>
                  <div>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 700, color: currentBal > 0 ? '#991b1b' : '#166534' }}>
                      Current Net Outstanding Balance
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: 800, color: currentBal > 0 ? '#b91c1c' : '#15803d', marginTop: '2px' }}>
                      {fmt(currentBal)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                    {currentBal > 0 && hasPermission('manage_sales') && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsLedgerModalOpen(false);
                          openPaymentModal(ledgerData.customer.id, currentBal);
                        }}
                        style={{
                          padding: '5px 10px',
                          background: '#15803d',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <CreditCard size={13} /> Pay in Full
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePrintStatement}
                      style={{
                        padding: '5px 10px',
                        background: '#fff',
                        color: '#0f172a',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Printer size={13} /> Print Statement
                    </button>
                  </div>
                </div>
              </div>

              {/* Chronological Ledger Table */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ background: '#f8fafc', padding: '10px 14px', borderBottom: '1px solid #e2e8f0', fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>
                  Bank-Style Chronological Ledger Activity
                </div>
                {ledgerEntries.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                    No transaction records found in customer ledger.
                  </div>
                ) : (
                  <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', textAlign: 'left', position: 'sticky', top: 0 }}>
                          <th style={{ padding: '8px 12px', fontWeight: 600, color: '#475569' }}>Date</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600, color: '#475569' }}>Reference</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600, color: '#475569' }}>Description</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600, color: '#475569', textAlign: 'right' }}>Charge (DR)</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600, color: '#475569', textAlign: 'right' }}>Payment (CR)</th>
                          <th style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a', textAlign: 'right' }}>Running Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerEntries.map((entry, idx) => {
                          const debitVal = Number(entry.debit ?? (entry as any).charge ?? 0);
                          const creditVal = Number(entry.credit ?? (entry as any).payment ?? 0);
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '8px 12px', color: '#64748b' }}>
                                {new Date(entry.date).toLocaleDateString()}
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <span style={{
                                  fontFamily: 'monospace',
                                  fontWeight: 700,
                                  color: (entry.type || '').includes('PAYMENT') ? '#15803d' : '#0f172a',
                                  background: (entry.type || '').includes('PAYMENT') ? '#dcfce7' : '#f1f5f9',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                }}>
                                  {entry.reference}
                                </span>
                              </td>
                              <td style={{ padding: '8px 12px', color: '#334155' }}>
                                {entry.description}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: debitVal > 0 ? '#b91c1c' : '#94a3b8' }}>
                                {debitVal > 0 ? fmt(debitVal) : '—'}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: creditVal > 0 ? '#15803d' : '#94a3b8' }}>
                                {creditVal > 0 ? fmt(creditVal) : '—'}
                              </td>
                              <td style={{
                                padding: '8px 12px',
                                textAlign: 'right',
                                fontWeight: 700,
                                color: entry.running_balance > 0 ? '#b91c1c' : '#15803d',
                              }}>
                                {fmt(entry.running_balance)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsLedgerModalOpen(false)}
                >
                  Close Statement
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── MODAL 2: ADD MANUAL DEBT CHARGE ────────────────────────── */}
      <Modal
        isOpen={isDebtModalOpen}
        onClose={() => { if (!debtSubmitting) setIsDebtModalOpen(false); }}
        title="Add Customer Manual Debt Charge"
        size="md"
      >
        <form onSubmit={handleSaveDebt}>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px', marginBottom: '16px', color: '#92400e', fontSize: '13px' }}>
            <strong>Non-Inventory Service Charge</strong>
            <p style={{ margin: '4px 0 0', color: '#78350f' }}>
              This charge records non-stock customer debts (assembly, custom upholstery, repairs, or historical opening balance) without altering warehouse inventory. Automatically posted to Accounts Receivable (1020).
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-field">
              <label className="form-field__label">Target Customer *</label>
              <select
                className="form-select"
                value={debtCustomerId}
                onChange={(e) => setDebtCustomerId(e.target.value)}
                required
              >
                <option value="">Select a customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ''} — Current Debt: {fmt(c.outstanding_balance)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-field__label">Service / Charge Category *</label>
              <select
                className="form-select"
                value={debtForm.category}
                onChange={(e) => setDebtForm(prev => ({ ...prev, category: e.target.value }))}
                required
              >
                {DEBT_CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            <InputField
              label="Charge Description *"
              id="debtDescription"
              value={debtForm.description}
              onChange={(val) => setDebtForm(prev => ({ ...prev, description: val }))}
              placeholder="e.g. Living room sofa fabric upholstery and cushioning restoration"
              required
            />

            <InputField
              label="Charge Amount ($) *"
              id="debtAmount"
              type="number"
              value={debtForm.amount}
              onChange={(val) => setDebtForm(prev => ({ ...prev, amount: val }))}
              placeholder="0.00"
              required
            />

            <TextareaField
              label="Notes (optional)"
              id="debtNotes"
              value={debtForm.notes}
              onChange={(val) => setDebtForm(prev => ({ ...prev, notes: val }))}
              placeholder="Add technician name, warranty info, or customer instructions…"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsDebtModalOpen(false)}
              disabled={debtSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={debtSubmitting || !debtForm.description.trim() || !debtForm.amount}
              style={{ background: '#b45309', borderColor: '#92400e' }}
            >
              {debtSubmitting ? (
                <><Loader2 size={14} className="spin-icon" style={{ marginRight: '6px' }} /> Recording Charge…</>
              ) : (
                'Add Charge to Ledger'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL 3: RECORD CUSTOMER PAYMENT ───────────────────────── */}
      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => { if (!paymentSubmitting) setIsPaymentModalOpen(false); }}
        title="Process Customer Debt Payment"
        size="md"
      >
        <form onSubmit={handleProcessPayment}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Customer Picker */}
            <div className="form-field">
              <label className="form-field__label">Customer *</label>
              <select
                className="form-select"
                value={paymentCustomerId}
                onChange={(e) => handleCustomerChangeInPayment(e.target.value)}
                required
              >
                <option value="">Select a customer…</option>
                {customers.map((c) => {
                  const dMatch = debtors.find(d => d.customer_id === c.id);
                  const bal = dMatch?.outstanding_balance ?? c.outstanding_balance ?? 0;
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''} — Outstanding: {fmt(bal)}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Allocation Method Selector */}
            <div className="form-field">
              <label className="form-field__label">Payment Allocation Method *</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setPaymentAllocation('ACCOUNT')}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: `1.5px solid ${paymentAllocation === 'ACCOUNT' ? '#0b8f08' : '#e2e8f0'}`,
                    background: paymentAllocation === 'ACCOUNT' ? '#f0fdf4' : '#fff',
                    color: paymentAllocation === 'ACCOUNT' ? '#066006' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  General Account
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentAllocation('INVOICE')}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: `1.5px solid ${paymentAllocation === 'INVOICE' ? '#0b8f08' : '#e2e8f0'}`,
                    background: paymentAllocation === 'INVOICE' ? '#f0fdf4' : '#fff',
                    color: paymentAllocation === 'INVOICE' ? '#066006' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  Specific Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentAllocation('MANUAL_DEBT')}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: `1.5px solid ${paymentAllocation === 'MANUAL_DEBT' ? '#0b8f08' : '#e2e8f0'}`,
                    background: paymentAllocation === 'MANUAL_DEBT' ? '#f0fdf4' : '#fff',
                    color: paymentAllocation === 'MANUAL_DEBT' ? '#066006' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  Manual Charge
                </button>
              </div>
            </div>

            {/* Specific Invoice Dropdown */}
            {paymentAllocation === 'INVOICE' && (
              <div className="form-field">
                <label className="form-field__label">Select Unpaid Sales Invoice *</label>
                {loadingCustomerBills ? (
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Loading customer invoices…</div>
                ) : unpaidInvoices.length === 0 ? (
                  <div style={{ fontSize: '12px', color: '#b91c1c', background: '#fef2f2', padding: '8px', borderRadius: '6px' }}>
                    No unpaid sales invoices found for this customer.
                  </div>
                ) : (
                  <select
                    className="form-select"
                    value={paymentForm.invoiceId}
                    onChange={(e) => {
                      const selInv = unpaidInvoices.find(i => i.id === e.target.value);
                      setPaymentForm(prev => ({
                        ...prev,
                        invoiceId: e.target.value,
                        amount: selInv ? String(selInv.balance) : prev.amount,
                      }));
                    }}
                    required
                  >
                    <option value="">Select an invoice to settle…</option>
                    {unpaidInvoices.map(inv => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} (Order #{inv.order_number}) — Balance: {fmt(inv.balance)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Specific Manual Debt Dropdown */}
            {paymentAllocation === 'MANUAL_DEBT' && (
              <div className="form-field">
                <label className="form-field__label">Select Manual Debt Charge *</label>
                {loadingCustomerBills ? (
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Loading customer charges…</div>
                ) : unpaidDebts.length === 0 ? (
                  <div style={{ fontSize: '12px', color: '#b91c1c', background: '#fef2f2', padding: '8px', borderRadius: '6px' }}>
                    No unpaid manual charges found for this customer.
                  </div>
                ) : (
                  <select
                    className="form-select"
                    value={paymentForm.manualDebtId}
                    onChange={(e) => {
                      const selDebt = unpaidDebts.find(d => d.id === e.target.value);
                      setPaymentForm(prev => ({
                        ...prev,
                        manualDebtId: e.target.value,
                        amount: selDebt ? String(selDebt.remaining_balance) : prev.amount,
                      }));
                    }}
                    required
                  >
                    <option value="">Select a manual charge to settle…</option>
                    {unpaidDebts.map(debt => (
                      <option key={debt.id} value={debt.id}>
                        {debt.debt_number} ({debt.category}): {debt.description} — Balance: {fmt(debt.remaining_balance)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Payment Amount & Method */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px' }}>
              <InputField
                label="Payment Amount ($) *"
                id="payAmt"
                type="number"
                value={paymentForm.amount}
                onChange={(val) => setPaymentForm(prev => ({ ...prev, amount: val }))}
                placeholder="0.00"
                required
              />

              <div className="form-field">
                <label className="form-field__label">Payment Method *</label>
                <select
                  className="form-select"
                  value={paymentForm.paymentMethod}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, paymentMethod: e.target.value as PaymentMethod }))}
                >
                  {PAYMENT_METHODS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <TextareaField
              label="Payment Notes (optional)"
              id="paymentNotes"
              value={paymentForm.notes}
              onChange={(val) => setPaymentForm(prev => ({ ...prev, notes: val }))}
              placeholder="e.g. Deposit installment, bank reference #, or cheque number…"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsPaymentModalOpen(false)}
              disabled={paymentSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={paymentSubmitting || !paymentForm.amount}
            >
              {paymentSubmitting ? (
                <><Loader2 size={14} className="spin-icon" style={{ marginRight: '6px' }} /> Processing Payment…</>
              ) : (
                'Confirm & Issue Receipt'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL 4: PRINTABLE PAYMENT RECEIPT ──────────────────────── */}
      <Modal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        title="Official Payment Receipt"
        size="md"
      >
        {currentReceipt && (
          <div>
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '20px',
              textAlign: 'center',
              marginBottom: '16px',
            }}>
              <div style={{ color: '#066006', fontWeight: 800, fontSize: '18px' }}>
                AL-HAYAT FURNITURE STORE
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                Official Payment Receipt
              </div>
              <div style={{
                display: 'inline-block',
                background: '#dcfce7',
                color: '#15803d',
                fontFamily: 'monospace',
                fontWeight: 700,
                fontSize: '13px',
                padding: '3px 10px',
                borderRadius: '6px',
                marginTop: '8px',
              }}>
                {currentReceipt.receipt_number}
              </div>

              <div style={{
                background: '#f0fdf4',
                border: '1.5px solid #86efac',
                borderRadius: '8px',
                padding: '12px',
                marginTop: '16px',
              }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#15803d', fontWeight: 700 }}>
                  Amount Paid
                </div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#166534', margin: '2px 0' }}>
                  {fmt(currentReceipt.amount)}
                </div>
                <div style={{ fontSize: '12px', color: '#15803d' }}>
                  Method: {currentReceipt.payment_method.replace('_', ' ')}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '16px', fontSize: '12px', textAlign: 'left' }}>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '8px 10px', borderRadius: '6px' }}>
                  <span style={{ color: '#64748b' }}>Customer:</span>
                  <div style={{ fontWeight: 700 }}>{currentReceipt.customer_name}</div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '8px 10px', borderRadius: '6px' }}>
                  <span style={{ color: '#64748b' }}>Payment Date:</span>
                  <div style={{ fontWeight: 700 }}>{new Date(currentReceipt.payment_date).toLocaleDateString()}</div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '8px 10px', borderRadius: '6px' }}>
                  <span style={{ color: '#64748b' }}>Previous Balance:</span>
                  <div style={{ fontWeight: 700 }}>{fmt(currentReceipt.previous_balance)}</div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '8px 10px', borderRadius: '6px' }}>
                  <span style={{ color: '#64748b' }}>Remaining Balance:</span>
                  <div style={{ fontWeight: 700, color: currentReceipt.remaining_balance > 0 ? '#b91c1c' : '#15803d' }}>
                    {fmt(currentReceipt.remaining_balance)}
                  </div>
                </div>
              </div>

              {currentReceipt.notes && (
                <div style={{ marginTop: '12px', fontSize: '12px', color: '#475569', textAlign: 'left', background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <strong>Notes:</strong> {currentReceipt.notes}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsReceiptModalOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePrintReceiptWindow}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Printer size={15} /> Print Receipt
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── MODAL 5: CUSTOMER CREATE / EDIT ────────────────────────── */}
      <Modal
        isOpen={showCustomerModal}
        onClose={() => { if (!savingCustomer) setShowCustomerModal(false); }}
        title={editCustomer ? 'Edit Customer Profile' : 'Register New Customer'}
        size="md"
      >
        <form onSubmit={handleSaveCustomer}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <InputField
              label="Customer Full Name *"
              id="custName"
              value={customerForm.name}
              onChange={(val) => setCustomerForm(prev => ({ ...prev, name: val }))}
              placeholder="e.g. Ahmed Ali"
              required
            />
            <InputField
              label="Phone Number"
              id="custPhone"
              value={customerForm.phone}
              onChange={(val) => setCustomerForm(prev => ({ ...prev, phone: val }))}
              placeholder="+252 63..."
            />
            <InputField
              label="Email Address"
              id="custEmail"
              type="email"
              value={customerForm.email}
              onChange={(val) => setCustomerForm(prev => ({ ...prev, email: val }))}
              placeholder="customer@example.com"
            />
            <InputField
              label="Delivery / Residential Address"
              id="custAddress"
              value={customerForm.address}
              onChange={(val) => setCustomerForm(prev => ({ ...prev, address: val }))}
              placeholder="Street, District, City"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowCustomerModal(false)}
              disabled={savingCustomer}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingCustomer || !customerForm.name.trim()}
            >
              {savingCustomer ? 'Saving…' : editCustomer ? 'Save Changes' : 'Register Customer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
