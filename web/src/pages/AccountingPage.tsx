import { useEffect, useState, useCallback } from 'react';
import {
  BookOpen, BarChart3, FileText, Scale, TrendingUp, Building2,
  DollarSign, Users, Package, Calendar, RefreshCw, Plus, Send,
  CheckCircle2, AlertCircle, Clock, ChevronDown, X, RotateCcw,
  Layers, Wallet, Receipt, Trash2,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { apiGet, apiPost, apiPatch, apiDelete, invalidateApiCache } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import { PageSkeleton } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { confirmAction } from '../utils/swal';
import { createPortal } from 'react-dom';
import { useServerList } from '../utils/serverList';
import { ListToolbar } from '../components/ListToolbar';
import { ModalLoading } from '../components/ModalLoading';
import { useLatest } from '../utils/latest';

// ─── Theme ──────────────────────────────────────────────────────────
const G = '#066006';
const G2 = '#16a34a';
const AMBER = '#d97706';
const RED = '#dc2626';
const BLUE = '#0284c7';
const TEAL = '#0d9488';
const PIE_COLORS = [G, G2, AMBER, BLUE, TEAL, RED, '#7c3aed', '#db2777'];

// ─── Helpers ────────────────────────────────────────────────────────
const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
const CASH_LABELS: Record<string, string> = {
  SALE: 'Customers (sales & receipts)', PURCHASE: 'Suppliers', EXPENSE: 'Operating expenses',
  OPENING: 'Owner funding / opening cash', MANUAL: 'Manual journals & reversals', TRANSFER: 'Inter-branch transfers',
  INVENTORY_ADJUSTMENT: 'Stock adjustments', MANUFACTURING: 'Manufacturing', DEPRECIATION: 'Depreciation', CLOSING: 'Closing entries',
};
const fmtN = (v: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px',
      fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      background: color + '22', color,
    }}>{label}</span>
  );
}

function statusColor(s: string) {
  if (s === 'POSTED' || s === 'APPROVED' || s === 'OPEN') return G2;
  if (s === 'DRAFT') return AMBER;
  if (s === 'REVERSED' || s === 'LOCKED' || s === 'CLOSED') return RED;
  return BLUE;
}

function accountTypeColor(t: string) {
  const map: Record<string, string> = {
    ASSET: BLUE, LIABILITY: RED, EQUITY: TEAL,
    REVENUE: G2, EXPENSE: AMBER, COGS: '#7c3aed',
  };
  return map[t] || '#666';
}

// ─── Section Header ─────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, sub, action }: {
  icon: any; title: string; sub?: string; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ background: G + '18', borderRadius: '10px', padding: '10px', display: 'flex' }}>
          <Icon size={20} color={G} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1a2e1a' }}>{title}</h2>
          {sub && <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, width = 580 }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: number;
}) {
  if (!open) return null;
  // Drawn into <body> so a hovering/transformed parent card cannot trap or shake it.
  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#fff', borderRadius: '16px', width: '100%', maxWidth: width,
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: '1px solid #e9f0e9',
          position: 'sticky', top: 0, background: '#fff', zIndex: 1,
        }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1a2e1a' }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px', borderRadius: '8px', color: '#6b7280' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '24px' }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function FormField({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}{required && <span style={{ color: RED }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: '8px',
  fontSize: '14px', color: '#1a2e1a', outline: 'none', boxSizing: 'border-box',
  background: '#fafafa',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'none' };

// ══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════
export function AccountingPage() {
  const { addToast } = useToast();
  const { user, branchId: myBranchId, hasPermission } = useAuth();
  // Admins/accountants: consolidated view by default, filterable per branch.
  // Everyone else is pinned to their branch by the server (this is display only).
  const canChooseBranch = user?.role === 'admin' || user?.role === 'accountant';
  const [branchFilter, setBranchFilter] = useState('ALL');
  const withBranch = (url: string) => (!canChooseBranch || branchFilter === 'ALL')
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}branch_id=${encodeURIComponent(branchFilter)}`;
  const [activeTab, setActiveTab] = useState('dashboard');
  const [branchSummary, setBranchSummary] = useState<any>(null);
  const [openingRows, setOpeningRows] = useState<any[]>([]);
  const [openingCash, setOpeningCash] = useState<Record<string, string>>({});
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Shared data
  const [periods, setPeriods] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const branchName = (id: string | null) => branches.find((b: any) => b.id === id)?.name;
  const scopeLabel = canChooseBranch
    ? (branchFilter === 'ALL' ? 'All branches (consolidated)' : branchFilter === 'UNASSIGNED' ? 'Company-level (no branch)' : (branchName(branchFilter) || 'Selected branch'))
    : (branchName(myBranchId) || 'Your branch');

  // Tab-specific data
  const [dashboard, setDashboard] = useState<any>(null);
  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [trialBalance, setTrialBalance] = useState<any>(null);
  const [trialType, setTrialType] = useState('UNADJUSTED');
  const [incomeStmt, setIncomeStmt] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [cashFlow, setCashFlow] = useState<any>(null);
  const [ownersEquity, setOwnersEquity] = useState<any>(null);
  const [invCounts, setInvCounts] = useState<any[]>([]);
  const [depreciation, setDepreciation] = useState<any[]>([]);

  // Modals
  const [showJEModal, setShowJEModal] = useState(false);
  const [showJEDetail, setShowJEDetail] = useState<any>(null);
  const [jeOpening, setJeOpening] = useState(false); // the entry window is open, its data still loading
  const jeRequest = useLatest();
  // rows: null while the account's activity loads (the window is already open)
  const [ledgerDrill, setLedgerDrill] = useState<{ account: any; rows: any[] | null } | null>(null);
  const drillRequest = useLatest();
  const [showCoAModal, setShowCoAModal] = useState(false);
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [showInvCountModal, setShowInvCountModal] = useState(false);
  const [showDepModal, setShowDepModal] = useState(false);
  const [showClosingModal, setShowClosingModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // JE Form state
  const [jeForm, setJeForm] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    description: '', fiscal_period_id: '', branch_id: '', reference_type: 'MANUAL', notes: '',
    lines: [
      { account_id: '', description: '', debit_amount: '', credit_amount: '' },
      { account_id: '', description: '', debit_amount: '', credit_amount: '' },
    ]
  });

  // CoA Form
  const [coaForm, setCoaForm] = useState({ code: '', name: '', account_type: 'ASSET', description: '' });
  // Period Form
  const [periodForm, setPeriodForm] = useState({ name: '', period_type: 'ANNUAL', start_date: '', end_date: '' });
  // Inv Count Form
  const [invForm, setInvForm] = useState({ fiscal_period_id: '', branch_id: '', count_date: new Date().toISOString().split('T')[0], total_value: '', notes: '' });
  // Depreciation Form
  const [depForm, setDepForm] = useState({ asset_name: '', acquisition_date: '', cost: '', salvage_value: '0', useful_life_years: '10', period_depreciation: '', fiscal_period_id: '', notes: '' });

  // Ledger filter
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  // Journal entries and the general ledger page, search and filter on the
  // server (journal entries used to show only the latest 50).
  const branchParam = canChooseBranch && branchFilter !== 'ALL' ? branchFilter : undefined;
  const jeList = useServerList<any>('/accounting/journal-entries', {
    key: 'journal-entries', prefix: 'je',
    filters: ['status', 'referenceType', 'dateFrom', 'dateTo'],
    defaultSort: 'date', defaultDir: 'desc',
    fixed: { period_id: selectedPeriod || undefined, branch_id: branchParam },
    enabled: activeTab === 'journal',
  });
  const glList = useServerList<any>('/accounting/general-ledger', {
    key: 'general-ledger', prefix: 'gl',
    filters: ['dateFrom', 'dateTo'],
    defaultSort: 'date', defaultDir: 'asc',
    fixed: { account_id: ledgerAccountId || undefined, branch_id: branchParam },
    enabled: activeTab === 'ledger',
  });
  const [jeTypes, setJeTypes] = useState<string[]>([]);
  useEffect(() => {
    if (activeTab === 'journal' && !jeTypes.length) apiGet<string[]>('/accounting/journal-reference-types').then((t) => setJeTypes(t || [])).catch(() => {});
  }, [activeTab, jeTypes.length]);
  // a copy of the journal page, so "Post" updates the row at once
  useEffect(() => { setJournalEntries(jeList.items); }, [jeList.items]);

  // ── Load base data ────────────────────────────────────────────────
  useEffect(() => {
    async function loadBase() {
      setLoading(true);
      try {
        const [pList, aList, bList, dashData] = await Promise.all([
          apiGet<any[]>('/accounting/fiscal-periods').catch(() => []),
          apiGet<any[]>('/accounting/chart-of-accounts').catch(() => []),
          apiGet<any[]>('/branches').catch(() => []),
          apiGet<any>('/accounting/dashboard').catch(() => null),
        ]);
        setPeriods(pList || []);
        setAccounts(aList || []);
        setBranches(bList || []);
        setDashboard(dashData || null);
        if (pList?.length) {
          const today = new Date().toISOString().split('T')[0];
          const activePeriod = pList.find((p: any) => p.status === 'OPEN' && p.start_date <= today && p.end_date >= today)
            || pList.find((p: any) => p.start_date <= today && p.end_date >= today)
            || pList.find((p: any) => p.status === 'OPEN')
            || pList[0];
          setSelectedPeriod(activePeriod.id);
        }
      } catch (e) {
        addToast('error', 'Failed to load accounting data');
      } finally {
        setLoading(false);
      }
    }
    loadBase();
  }, []);

  // ── Load tab-specific data ────────────────────────────────────────
  const loadTabData = useCallback(async (tab: string, period: string) => {
    const p = period ? `?period_id=${period}` : '';
    try {
      if (tab === 'dashboard') {
        const [d, s] = await Promise.all([
          apiGet<any>(withBranch(`/accounting/dashboard${p}`)).catch(() => null),
          apiGet<any>(withBranch(`/accounting/branch-summary${p}`)).catch(() => null),
        ]);
        setDashboard(d);
        setBranchSummary(s);
      } else if (tab === 'journal') {
        jeList.refresh();
      } else if (tab === 'ledger') {
        glList.refresh();
      } else if (tab === 'trial-balance') {
        const d = await apiGet<any>(withBranch(`/accounting/trial-balance?type=${trialType}${period ? `&period_id=${period}` : ''}`)).catch(() => null);
        setTrialBalance(d);
      } else if (tab === 'income') {
        const d = await apiGet<any>(withBranch(`/accounting/income-statement${p}`)).catch(() => null);
        setIncomeStmt(d);
      } else if (tab === 'balance-sheet') {
        const d = await apiGet<any>(withBranch(`/accounting/balance-sheet${p}`)).catch(() => null);
        setBalanceSheet(d);
      } else if (tab === 'cash-flow') {
        const d = await apiGet<any>(withBranch(`/accounting/cash-flow${p}`)).catch(() => null);
        setCashFlow(d);
      } else if (tab === 'equity') {
        const d = await apiGet<any>(withBranch(`/accounting/owners-equity${p}`)).catch(() => null);
        setOwnersEquity(d);
      } else if (tab === 'inventory') {
        const rows = await apiGet<any[]>(withBranch(`/accounting/inventory-counts${p}`)).catch(() => []);
        setInvCounts(rows || []);
      } else if (tab === 'opening') {
        const rows = canChooseBranch ? await apiGet<any[]>('/accounting/opening-balances').catch(() => []) : [];
        setOpeningRows(rows || []);
      } else if (tab === 'depreciation') {
        const rows = await apiGet<any[]>(withBranch('/accounting/depreciation')).catch(() => []);
        setDepreciation(rows || []);
      }
    } catch (e) {
      addToast('error', 'Failed to load data');
    }
  }, [ledgerAccountId, trialType, branchFilter]);

  useEffect(() => {
    if (!loading) loadTabData(activeTab, selectedPeriod);
  }, [activeTab, selectedPeriod, loading, branchFilter]);

  useEffect(() => {
    if (!loading && activeTab === 'ledger') loadTabData('ledger', selectedPeriod);
  }, [ledgerAccountId]);

  useEffect(() => {
    if (!loading && activeTab === 'trial-balance') loadTabData('trial-balance', selectedPeriod);
  }, [trialType]);

  // ── Refresh Handler ──────────────────────────────────────────────
  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      invalidateApiCache('/accounting');
      await Promise.all([
        loadTabData(activeTab, selectedPeriod),
        apiGet<any[]>('/accounting/fiscal-periods').then(pList => { if (pList?.length) setPeriods(pList); }).catch(() => {}),
        apiGet<any[]>('/accounting/chart-of-accounts').then(aList => { if (aList?.length) setAccounts(aList); }).catch(() => {}),
      ]);
      addToast('success', 'Accounting data refreshed');
    } catch (e) {
      addToast('error', 'Failed to refresh data');
    } finally {
      setRefreshing(false);
    }
  }

  // ── Submit Journal Entry ─────────────────────────────────────────
  async function submitJE() {
    const lines = jeForm.lines.filter(l => l.account_id);
    const totalDr = lines.reduce((s, l) => s + (parseFloat(l.debit_amount) || 0), 0);
    const totalCr = lines.reduce((s, l) => s + (parseFloat(l.credit_amount) || 0), 0);
    if (Math.abs(totalDr - totalCr) > 0.005) {
      addToast('error', `Entry not balanced: Debits $${fmtN(totalDr)} ≠ Credits $${fmtN(totalCr)}`);
      return;
    }
    if (!jeForm.description || lines.length < 2) {
      addToast('error', 'Description and at least 2 lines required');
      return;
    }
    setSubmitting(true);
    try {
      await apiPost('/accounting/journal-entries', {
        ...jeForm,
        fiscal_period_id: jeForm.fiscal_period_id || null,
        branch_id: jeForm.branch_id || null,
        lines: lines.map(l => ({
          account_id: l.account_id,
          description: l.description,
          debit_amount: parseFloat(l.debit_amount) || 0,
          credit_amount: parseFloat(l.credit_amount) || 0,
        }))
      });
      addToast('success', 'Journal entry created');
      setShowJEModal(false);
      setJeForm({
        entry_date: new Date().toISOString().split('T')[0],
        description: '', fiscal_period_id: '', branch_id: '', reference_type: 'MANUAL', notes: '',
        lines: [
          { account_id: '', description: '', debit_amount: '', credit_amount: '' },
          { account_id: '', description: '', debit_amount: '', credit_amount: '' },
        ]
      });
      loadTabData('journal', selectedPeriod);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to create journal entry');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Post JE ──────────────────────────────────────────────────────
  async function postEntry(id: string) {
    setJournalEntries((rows) => rows.map((row) => row.id === id ? { ...row, status: 'POSTED' } : row));
    addToast('info', 'Posting entry…');
    try {
      await apiPost(`/accounting/journal-entries/${id}/post`, {});
      addToast('success', 'Entry posted to General Ledger');
      loadTabData('journal', selectedPeriod);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to post entry');
    }
  }

  // ── Reverse JE ───────────────────────────────────────────────────
  async function reverseEntry(id: string, currentStatus: string) {
    if (currentStatus === 'REVERSED') {
      addToast('info', 'This journal entry has already been reversed — a counter-entry exists in the ledger.');
      return;
    }
    if (currentStatus !== 'POSTED') {
      addToast('error', `Cannot reverse a ${currentStatus} entry. Only POSTED entries can be reversed.`);
      return;
    }
    addToast('info', 'Creating reversal entry…');
    try {
      await apiPost(`/accounting/journal-entries/${id}/reverse`, {});
      addToast('success', 'Reversal entry created — debits and credits have been swapped and posted.');
      loadTabData('journal', selectedPeriod);
      loadTabData('dashboard', selectedPeriod);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to reverse entry');
    }
  }

  // ── Submit CoA ───────────────────────────────────────────────────
  async function submitCoA() {
    if (!coaForm.code || !coaForm.name || !coaForm.account_type) {
      addToast('error', 'Code, name, and type are required'); return;
    }
    setSubmitting(true);
    try {
      await apiPost('/accounting/chart-of-accounts', coaForm);
      addToast('success', 'Account created');
      setShowCoAModal(false);
      setCoaForm({ code: '', name: '', account_type: 'ASSET', description: '' });
      const aList = await apiGet<any[]>('/accounting/chart-of-accounts').catch(() => []);
      setAccounts(aList || []);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Submit Period ────────────────────────────────────────────────
  async function submitPeriod() {
    if (!periodForm.name || !periodForm.start_date || !periodForm.end_date) {
      addToast('error', 'All period fields required'); return;
    }
    setSubmitting(true);
    try {
      await apiPost('/accounting/fiscal-periods', periodForm);
      addToast('success', 'Fiscal period created');
      setShowPeriodModal(false);
      const pList = await apiGet<any[]>('/accounting/fiscal-periods').catch(() => []);
      setPeriods(pList || []);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to create period');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Submit Inventory Count ───────────────────────────────────────
  async function submitInvCount() {
    if (!invForm.fiscal_period_id || !invForm.count_date || !invForm.total_value) {
      addToast('error', 'Period, date, and value required'); return;
    }
    setSubmitting(true);
    try {
      await apiPost('/accounting/inventory-counts', {
        ...invForm, total_value: parseFloat(invForm.total_value)
      });
      addToast('success', 'Inventory count recorded');
      setShowInvCountModal(false);
      loadTabData('inventory', selectedPeriod);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to record count');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Submit Depreciation ──────────────────────────────────────────
  async function submitDep() {
    if (!depForm.asset_name || !depForm.acquisition_date || !depForm.cost || !depForm.period_depreciation) {
      addToast('error', 'Required fields missing'); return;
    }
    setSubmitting(true);
    try {
      await apiPost('/accounting/depreciation', {
        ...depForm,
        cost: parseFloat(depForm.cost),
        salvage_value: parseFloat(depForm.salvage_value) || 0,
        useful_life_years: parseInt(depForm.useful_life_years) || 10,
        period_depreciation: parseFloat(depForm.period_depreciation),
        fiscal_period_id: depForm.fiscal_period_id || null,
      });
      addToast('success', 'Depreciation recorded');
      setShowDepModal(false);
      loadTabData('depreciation', selectedPeriod);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to record depreciation');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Generate Closing Entries ─────────────────────────────────────
  async function generateClosing() {
    if (!selectedPeriod) { addToast('error', 'Select a fiscal period first'); return; }
    setSubmitting(true);
    try {
      const res = await apiPost<any>('/accounting/closing-entries', { fiscal_period_id: selectedPeriod });
      addToast('success', `Closing entries generated — Net Income: ${fmt(res.net_income)}`);
      setShowClosingModal(false);
      loadTabData('journal', selectedPeriod);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to generate closing entries');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Open JE Detail ───────────────────────────────────────────────
  async function openJEDetail(id: string) {
    const isCurrent = jeRequest.start();
    setShowJEDetail(null);
    setJeOpening(true);
    try {
      const d = await apiGet<any>(`/accounting/journal-entries/${id}`);
      if (isCurrent()) setShowJEDetail(d);
    } catch (e) {
      if (isCurrent()) addToast('error', 'Failed to load entry details');
    } finally {
      if (isCurrent()) setJeOpening(false);
    }
  }

  function closeJEDetail() {
    jeRequest.cancel();
    setJeOpening(false);
    setShowJEDetail(null);
  }

  async function postOpening(r: any) {
    if (submitting) return;
    const cash = Number(openingCash[r.branch_id] || 0);
    const stock = Number(r.unrecorded_stock_value || 0);
    if (stock === 0 && !(cash > 0)) return;
    const ok = await confirmAction(
      `Post opening balances for ${r.branch_name}?`,
      `Stock value: ${fmt(stock)} · Opening cash: ${fmt(cash)}. This posts journal entries against Owner's Capital.`,
      'Post', 'question'
    );
    if (!ok) return;
    setSubmitting(true);
    try {
      await apiPost('/accounting/opening-balances', { branch_id: r.branch_id, include_stock: stock !== 0, opening_cash: cash });
      addToast('success', `Opening balances posted for ${r.branch_name}`);
      setOpeningCash((prev) => ({ ...prev, [r.branch_id]: '' }));
      invalidateApiCache('/accounting');
      await loadTabData('opening', selectedPeriod);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to post opening balances');
    } finally {
      setSubmitting(false);
    }
  }

  async function openLedgerDrill(account: any) {
    const isCurrent = drillRequest.start();
    setLedgerDrill({ account, rows: null });
    try {
      const rows = await apiGet<any[]>(withBranch(`/accounting/general-ledger?account_id=${account.account_id || account.id}`));
      if (isCurrent()) setLedgerDrill({ account, rows: rows || [] });
    } catch (e) {
      if (isCurrent()) {
        addToast('error', 'Failed to load account activity');
        setLedgerDrill(null);
      }
    }
  }

  function closeLedgerDrill() {
    drillRequest.cancel();
    setLedgerDrill(null);
  }

  if (loading) return <PageSkeleton />;

  // ─── Tab definitions ────────────────────────────────────────────
  const workspaceMenus = [
    { label: 'Dashboard', items: [{ key: 'dashboard', label: 'KPI Overview' }] },
    { label: 'Accounting', items: [{ key: 'journal', label: 'Journal Entries' }, { key: 'ledger', label: 'General Ledger' }, { key: 'trial-balance', label: 'Journal Items & Trial Balance' }, { key: 'coa', label: 'Chart of Accounts' }] },
    { label: 'Reporting', items: [{ key: 'income', label: 'Income Statement' }, { key: 'balance-sheet', label: 'Balance Sheet' }, { key: 'cash-flow', label: 'Cash Flow' }, { key: 'equity', label: 'Executive Summary' }] },
    { label: 'Management', items: [{ key: 'inventory', label: 'Physical Inventory Counts' }, { key: 'depreciation', label: 'Asset Depreciation' }, { key: 'opening', label: 'Opening Balances' }, { key: 'journal', label: 'Year-End Closing' }] },
  ];


  // JE lines total
  const jeLineTotalDr = jeForm.lines.reduce((s, l) => s + (parseFloat(l.debit_amount) || 0), 0);
  const jeLineTotalCr = jeForm.lines.reduce((s, l) => s + (parseFloat(l.credit_amount) || 0), 0);
  const jeBalanced = Math.abs(jeLineTotalDr - jeLineTotalCr) < 0.005 && jeLineTotalDr > 0;

  // ── Columns ──────────────────────────────────────────────────────
  const jeCols: Column<any>[] = [
    { key: 'entry_number', label: 'Entry #', render: (r) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: G, cursor: 'pointer' }} onClick={() => openJEDetail(r.id)}>{r.entry_number}</span> },
    { key: 'entry_date', label: 'Date' },
    { key: 'description', label: 'Description', render: (r) => <span style={{ fontSize: '13px' }}>{r.description}</span> },
    { key: 'reference_type', label: 'Type', render: (r) => r.reference_type ? <Badge label={r.reference_type} color={BLUE} /> : <span style={{ color: '#999' }}>—</span> },
    { key: 'total_debit', label: 'Debit', render: (r) => <span style={{ fontFamily: 'monospace', color: G }}>{fmt(r.total_debit)}</span> },
    { key: 'total_credit', label: 'Credit', render: (r) => <span style={{ fontFamily: 'monospace', color: TEAL }}>{fmt(r.total_credit)}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge label={r.status} color={statusColor(r.status)} /> },
    {
      key: 'actions', label: '', render: (r) => (
        <div style={{ display: 'flex', gap: '6px' }}>
          {r.status === 'DRAFT' && (
            <button onClick={() => postEntry(r.id)} style={{ background: G + '18', border: 'none', color: G, borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
              <Send size={11} style={{ marginRight: '4px' }} />Post
            </button>
          )}
          {r.status === 'POSTED' && (
            <button
              onClick={() => reverseEntry(r.id, r.status)}
              title="Reverse: Creates a counter-entry that cancels this posting (swaps debits and credits)"
              style={{ background: AMBER + '18', border: 'none', color: AMBER, borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
            >
              <RotateCcw size={11} style={{ marginRight: '4px' }} />Reverse
            </button>
          )}
          {r.status === 'REVERSED' && (
            <span style={{ fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>Already reversed</span>
          )}
        </div>
      )
    },
  ];

  const coaCols: Column<any>[] = [
    { key: 'code', label: 'Code', render: (r) => <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.code}</span> },
    { key: 'name', label: 'Account Name' },
    { key: 'account_type', label: 'Type', render: (r) => <Badge label={r.account_type} color={accountTypeColor(r.account_type)} /> },
    { key: 'normal_balance', label: 'Normal', render: (r) => <span style={{ fontSize: '12px', color: r.normal_balance === 'DEBIT' ? G : TEAL }}>{r.normal_balance}</span> },
    { key: 'description', label: 'Description', render: (r) => <span style={{ fontSize: '12px', color: '#6b7280' }}>{r.description || '—'}</span> },
  ];

  const tbCols: Column<any>[] = [
    { key: 'code', label: 'Code', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.code}</span> },
    { key: 'account_name', label: 'Account Name', render: (r: any) => <button type='button' onClick={() => openLedgerDrill(r)} style={{ border: 0, background: 'transparent', color: G, cursor: 'pointer', fontWeight: 700, padding: 0 }}>{r.account_name}</button> },
    { key: 'account_type', label: 'Type', render: (r: any) => <Badge label={r.account_type} color={accountTypeColor(r.account_type)} /> },
    { key: 'total_debit', label: 'Debit ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', color: G }}>{r.total_debit > 0 ? fmtN(r.total_debit) : '—'}</span> },
    { key: 'total_credit', label: 'Credit ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', color: TEAL }}>{r.total_credit > 0 ? fmtN(r.total_credit) : '—'}</span> },
    { key: 'net_balance', label: 'Balance ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: Number(r.net_balance) >= 0 ? G : RED }}>{fmtN(r.net_balance)}</span> },
  ];

  const ledgerCols: Column<any>[] = [
    { key: 'account_code', label: 'Account', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: G }}>{r.account_code}</span> },
    { key: 'account_name', label: 'Account Name', render: (r: any) => <span style={{ fontSize: '13px' }}>{r.account_name}</span> },
    { key: 'entry_date', label: 'Date' },
    { key: 'entry_number', label: 'Entry #', render: (r: any) => <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.entry_number}</span> },
    { key: 'description', label: 'Description', render: (r: any) => <span style={{ fontSize: '12px' }}>{r.description}</span> },
    { key: 'debit_amount', label: 'Debit ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', color: G }}>{r.debit_amount > 0 ? fmtN(r.debit_amount) : '—'}</span> },
    { key: 'credit_amount', label: 'Credit ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', color: TEAL }}>{r.credit_amount > 0 ? fmtN(r.credit_amount) : '—'}</span> },
    { key: 'running_balance', label: 'Balance', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: Number(r.running_balance) >= 0 ? G : RED }}>{fmtN(r.running_balance)}</span> },
  ];

  const invCountCols: Column<any>[] = [
    { key: 'period_name', label: 'Period', render: (r: any) => <span style={{ fontSize: '13px', fontWeight: 600 }}>{r.period_name}</span> },
    { key: 'branch_name', label: 'Branch', render: (r: any) => r.branch_name || <span style={{ color: '#999' }}>HQ / Warehouse</span> },
    { key: 'count_date', label: 'Count Date' },
    { key: 'total_value', label: 'Ending Inventory Value', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: G }}>{fmt(r.total_value)}</span> },
    { key: 'status', label: 'Status', render: (r: any) => <Badge label={r.status} color={statusColor(r.status)} /> },
    { key: 'counted_by_name', label: 'Counted By', render: (r: any) => r.counted_by_name || '—' },
    {
      key: 'actions', label: '', render: (r: any) => r.status === 'DRAFT' ? (
        <button onClick={async () => {
          try {
            await apiPatch(`/accounting/inventory-counts/${r.id}/approve`, {});
            addToast('success', 'Inventory count approved');
            loadTabData('inventory', selectedPeriod);
          } catch (e) { addToast('error', 'Failed to approve'); }
        }} style={{ background: G + '18', border: 'none', color: G, borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
          <CheckCircle2 size={11} style={{ marginRight: '4px' }} />Approve
        </button>
      ) : null
    },
  ];

  const depCols: Column<any>[] = [
    { key: 'asset_name', label: 'Asset Name', render: (r: any) => <span style={{ fontWeight: 600 }}>{r.asset_name}</span> },
    { key: 'acquisition_date', label: 'Acquired' },
    { key: 'cost', label: 'Cost', render: (r: any) => <span style={{ fontFamily: 'monospace' }}>{fmt(r.cost)}</span> },
    { key: 'salvage_value', label: 'Salvage', render: (r: any) => <span style={{ fontFamily: 'monospace' }}>{fmt(r.salvage_value)}</span> },
    { key: 'useful_life_years', label: 'Life (Yrs)' },
    { key: 'method', label: 'Method', render: (r: any) => <Badge label={r.method.replace('_', ' ')} color={TEAL} /> },
    { key: 'period_depreciation', label: 'Period Dep.', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: AMBER }}>{fmt(r.period_depreciation)}</span> },
    { key: 'period_name', label: 'Period', render: (r: any) => r.period_name || '—' },
    {
      key: 'actions', label: '', render: (r: any) => hasPermission('manage_purchasing') ? (
        <button type="button" onClick={() => deleteDepreciation(r)} title="Delete this depreciation (its journal entry is reversed)"
          style={{ border: '1px solid #fecaca', background: '#fff', color: '#dc2626', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
          <Trash2 size={13} /> Delete
        </button>
      ) : null,
    },
  ];

  async function deleteDepreciation(r: any) {
    const ok = await confirmAction(
      `Delete depreciation for ${r.asset_name}?`,
      `Its journal entry (${fmt(r.period_depreciation)}) is reversed with a counter-entry, so the books stay correct, and the record is removed.`,
      'Delete', 'warning',
    );
    if (!ok) return;
    try {
      await apiDelete(`/accounting/depreciation/${r.id}`);
      addToast('success', 'Depreciation deleted and its journal entry reversed');
      setDepreciation((rows: any[]) => rows.filter((x) => x.id !== r.id));
      invalidateApiCache('/accounting');
    } catch (e: any) {
      addToast('error', e?.message || 'Could not delete the depreciation');
    }
  }

  // ─── Shared filter bar ─────────────────────────────────────────
  const PeriodBar = () => (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Calendar size={15} color={G} />
        <span style={{ fontSize: '13px', color: '#4b5563', fontWeight: 600 }}>Fiscal Period:</span>
      </div>
      <select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}
        style={{ ...selectStyle, maxWidth: '220px', background: '#f0faf0', borderColor: G + '44' }}>
        <option value=''>All Periods</option>
        {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}
      </select>
      {canChooseBranch ? (
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label='Branch'
          style={{ ...selectStyle, maxWidth: '240px', background: '#f0faf0', borderColor: G + '44' }}>
          <option value='ALL'>All branches (consolidated)</option>
          {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          <option value='UNASSIGNED'>Company-level (no branch)</option>
        </select>
      ) : (
        <span style={{ fontSize: '13px', fontWeight: 600, color: G, background: G + '14', borderRadius: '8px', padding: '7px 12px' }}>
          Branch: {branches.find((b: any) => b.id === myBranchId)?.name || 'Your branch'}
        </span>
      )}
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        title="Refresh accounting data"
        style={{
          background: G + '18',
          border: 'none',
          color: G,
          borderRadius: '8px',
          padding: '8px 14px',
          cursor: refreshing ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '13px',
          fontWeight: 600,
          opacity: refreshing ? 0.7 : 1,
          transition: 'all 0.15s ease'
        }}
      >
        <RefreshCw
          size={13}
          style={{
            animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
            display: 'inline-block'
          }}
        />
        {refreshing ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>
  );

  // ─── Statement row helper ──────────────────────────────────────
  const StmtRow = ({ label, value, indent = 0, bold = false, color = '#1a2e1a', separator = false }: any) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: `${separator ? '10px' : '7px'} 20px`, paddingLeft: `${20 + indent * 20}px`,
      borderBottom: separator ? `2px solid ${G}33` : '1px solid #f0f4f0',
      background: bold ? G + '08' : 'transparent',
    }}>
      <span style={{ fontSize: '14px', fontWeight: bold ? 700 : 400, color: '#374151' }}>{label}</span>
      <span style={{ fontSize: '14px', fontFamily: 'monospace', fontWeight: bold ? 700 : 500, color }}>{value}</span>
    </div>
  );

  const StmtCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #e5ede5', overflow: 'hidden', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ background: `linear-gradient(135deg, ${G} 0%, #0a5e0a 100%)`, padding: '14px 20px' }}>
        <h3 style={{ margin: 0, color: '#fff', fontSize: '15px', fontWeight: 700 }}>{title}</h3>
      </div>
      {children}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════
  return (
    <div style={{ padding: '0' }}>
      {/* Executive Hero Header Banner */}
      <section style={{
        margin: '24px 24px 20px',
        padding: '24px 28px',
        borderRadius: '16px',
        color: '#f8fafc',
        background: 'linear-gradient(135deg, #0b4f2c 0%, #065f46 60%, #0d9488 100%)',
        boxShadow: '0 12px 28px rgba(6, 95, 70, 0.2)',
        border: '1px solid rgba(255,255,255,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '12px', padding: '12px', display: 'flex' }}>
              <BookOpen size={24} color='#a7f3d0' />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#a7f3d0', fontSize: '11px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Financial Engine</span>
                <span style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' }}>Double-Entry</span>
              </div>
              <h1 style={{ margin: '4px 0 0', color: '#fff', fontSize: '24px', fontWeight: 800 }}>Financial Accounting</h1>
              <p style={{ margin: '4px 0 0', color: 'rgba(236,253,245,0.8)', fontSize: '13px' }}>Real-time General Ledger, Automated Double-Entry Postings & Financial Statements</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => setShowPeriodModal(true)} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#ecfdf5', borderRadius: '10px', padding: '10px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Calendar size={14} /> Fiscal Period
            </button>
            <button onClick={() => setShowClosingModal(true)} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#ecfdf5', borderRadius: '10px', padding: '10px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Layers size={14} /> Close Year
            </button>
            <button onClick={() => setShowJEModal(true)} style={{ background: '#ecfdf5', border: 'none', color: '#065f46', borderRadius: '10px', padding: '10px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 14px rgba(0,0,0,0.15)' }}>
              <Plus size={16} /> New Journal Entry
            </button>
          </div>
        </div>
      </section>

      {/* Page Content Container */}
      <div style={{ padding: '0 24px 40px' }}>
        {/* Grouped Dropdown Navigation Menus */}
        <nav aria-label="Accounting workspace" style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          padding: '6px 8px',
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
          marginBottom: '24px'
        }}>
          {[
            { label: 'Dashboard', items: [{ key: 'dashboard', label: 'KPI Overview' }] },
            { label: 'Accounting', items: [{ key: 'journal', label: 'Journal Entries' }, { key: 'ledger', label: 'General Ledger' }, { key: 'trial-balance', label: 'Journal Items & Trial Balance' }, { key: 'coa', label: 'Chart of Accounts' }] },
            { label: 'Reporting', items: [{ key: 'income', label: 'Income Statement' }, { key: 'balance-sheet', label: 'Balance Sheet' }, { key: 'cash-flow', label: 'Cash Flow' }, { key: 'equity', label: 'Executive Summary' }] },
            { label: 'Management', items: [{ key: 'inventory', label: 'Physical Inventory Counts' }, { key: 'depreciation', label: 'Asset Depreciation' }, { key: 'opening', label: 'Opening Balances' }] },
          ].map((menu) => {
            const isOpen = openMenu === menu.label;
            const isActive = menu.items.some((item) => item.key === activeTab);
            return (
              <div key={menu.label} style={{ position: 'relative' }}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenMenu(isOpen ? null : menu.label)}
                  style={{
                    border: 0,
                    background: isOpen || isActive ? '#ecfdf5' : 'transparent',
                    cursor: 'pointer',
                    padding: '9px 15px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '13px',
                    color: isActive ? '#065f46' : '#374151',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: isActive ? 'inset 0 0 0 1.5px #a7f3d0' : 'none',
                  }}
                >
                  {menu.label} <ChevronDown size={14} style={{ transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform 150ms ease' }} />
                </button>
                {isOpen && (
                  <div style={{
                    position: 'absolute',
                    zIndex: 50,
                    minWidth: '220px',
                    top: '42px',
                    left: 0,
                    padding: '6px',
                    borderRadius: '10px',
                    background: '#fff',
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 12px 28px rgba(0,0,0,0.12)'
                  }}>
                    {menu.items.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => { setActiveTab(item.key); setOpenMenu(null); }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          border: 0,
                          background: activeTab === item.key ? '#ecfdf5' : 'transparent',
                          color: activeTab === item.key ? '#065f46' : '#1f2937',
                          fontWeight: activeTab === item.key ? 700 : 500,
                          borderRadius: '7px',
                          cursor: 'pointer',
                          padding: '9px 12px',
                          fontSize: '13px'
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div>
          {/* ── DASHBOARD ──────────────────────────────────────────── */}
          {activeTab === 'dashboard' && (
            <div>
              <PeriodBar />

              {/* KPI Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                {/* Revenue */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                  <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '10px', display: 'flex' }}><TrendingUp size={22} color="#0b8f08" /></div>
                  <div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{fmt(dashboard?.total_revenue || 0)}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Total Revenue</div>
                  </div>
                </div>
                {/* COGS */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                  <div style={{ background: '#fff7ed', borderRadius: '10px', padding: '10px', display: 'flex' }}><Package size={22} color="#c2410c" /></div>
                  <div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{fmt(dashboard?.total_cogs || 0)}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Cost of Goods Sold</div>
                  </div>
                </div>
                {/* Operating Expenses */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                  <div style={{ background: '#fef2f2', borderRadius: '10px', padding: '10px', display: 'flex' }}><Receipt size={22} color="#dc2626" /></div>
                  <div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{fmt(dashboard?.total_operating_expenses || 0)}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Operating Expenses</div>
                    <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>Rent, salaries, overhead</div>
                  </div>
                </div>
                {/* Net Income */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                  <div style={{ background: (dashboard?.net_income || 0) >= 0 ? '#f0fdf4' : '#fef2f2', borderRadius: '10px', padding: '10px', display: 'flex' }}>
                    <DollarSign size={22} color={(dashboard?.net_income || 0) >= 0 ? '#0b8f08' : '#dc2626'} />
                  </div>
                  <div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: (dashboard?.net_income || 0) >= 0 ? '#065f46' : '#dc2626' }}>{fmt(dashboard?.net_income || 0)}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Net Income</div>
                    <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>Revenue − COGS − Expenses</div>
                  </div>
                </div>
                {/* Journal Entries */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                  <div style={{ background: '#f0fdfa', borderRadius: '10px', padding: '10px', display: 'flex' }}><FileText size={22} color="#0d9488" /></div>
                  <div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{dashboard?.posted_entries || 0}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Posted Journal Entries</div>
                  </div>
                </div>
              </div>


              {/* Each branch's books side by side */}
              {branchSummary?.branches?.length > 0 && (
                <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #e5ede5', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflowX: 'auto' as const }}>
                  <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700, color: '#1a2e1a' }}>By branch</h3>
                  <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#6b7280' }}>
                    Profit &amp; loss for the selected period; cash, receivables and inventory to date. "Company-level" holds purchasing, warehouse stock and costs recorded without a branch.
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '760px' }}>
                    <thead>
                      <tr>
                        {['Branch', 'Revenue', 'Cost of goods', 'Expenses', 'Net income', 'Cash', 'Receivables', 'Inventory'].map((h) => (
                          <th key={h} style={{ textAlign: h === 'Branch' ? 'left' : 'right', padding: '8px 10px', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5ede5' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {branchSummary.branches.map((r: any) => (
                        <tr key={r.branch_id ?? 'company'}>
                          <td style={{ textAlign: 'left' as const, padding: '9px 10px', borderBottom: '1px solid #f0f4f0' }}>
                            {canChooseBranch
                              ? <button type='button' onClick={() => setBranchFilter(r.branch_id ?? 'UNASSIGNED')} title='Show this branch only' style={{ background: 'none', border: 'none', padding: 0, color: G, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>{r.branch_name}</button>
                              : <strong>{r.branch_name}</strong>}
                          </td>
                          {[r.revenue, r.cogs, r.expenses, r.net_income, r.cash, r.receivables, r.inventory].map((v: number, i: number) => (
                            <td key={i} style={{ ...{ textAlign: 'right' as const, padding: '9px 10px', borderBottom: '1px solid #f0f4f0', fontFamily: 'monospace' }, color: v < 0 ? RED : '#111827' }}>{fmt(v)}</td>
                          ))}
                        </tr>
                      ))}
                      {branchSummary.branches.length > 1 && (
                        <tr>
                          <td style={{ ...{ textAlign: 'left' as const, padding: '9px 10px', borderBottom: '1px solid #f0f4f0' }, fontWeight: 800 }}>Total</td>
                          {['revenue', 'cogs', 'expenses', 'net_income', 'cash', 'receivables', 'inventory'].map((k) => (
                            <td key={k} style={{ ...{ textAlign: 'right' as const, padding: '9px 10px', borderBottom: '1px solid #f0f4f0', fontFamily: 'monospace' }, fontWeight: 800, color: branchSummary.totals[k] < 0 ? RED : '#111827' }}>{fmt(branchSummary.totals[k])}</td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Income vs Expense Bar */}
              {dashboard && (
                <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #e5ede5', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700, color: '#1a2e1a' }}>Financial Summary</h3>
                  <ResponsiveContainer width='100%' height={220}>
                    <BarChart data={[
                      { name: 'Revenue', amount: dashboard.total_revenue },
                      { name: 'Expenses', amount: dashboard.total_expenses },
                      { name: 'Net Income', amount: Math.max(0, dashboard.net_income) },
                    ]} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray='3 3' stroke='#f0f4f0' />
                      <XAxis dataKey='name' tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v) => fmt(Number(v))} />
                      <Bar dataKey='amount' fill={G} radius={[6, 6, 0, 0]}>
                        {[G, AMBER, G2].map((color, i) => <Cell key={i} fill={color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Accounting Cycle Info */}
              <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #e5ede5', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700, color: '#1a2e1a' }}>The Accounting Cycle — Periodic Inventory System</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  {[
                    { step: 'Step 1', title: 'Identify Transactions', desc: 'Sales, Purchases, Expenses, Adjustments' },
                    { step: 'Step 2', title: 'Journal Entries', desc: 'Double-entry recording in draft → posted' },
                    { step: 'Step 3', title: 'General Ledger', desc: 'T-accounts with running balances per account' },
                    { step: 'Step 4', title: 'Unadjusted Trial Balance', desc: 'Test that debits = credits pre-adjustment' },
                    { step: 'Step 5', title: 'Adjusting Entries', desc: 'Depreciation, accruals, inventory counts' },
                    { step: 'Step 6', title: 'Adjusted Trial Balance', desc: 'Post-adjustment balance check' },
                    { step: 'Step 7', title: 'Financial Statements', desc: 'Income, Balance Sheet, Cash Flow, Equity' },
                    { step: 'Step 8', title: 'Closing Entries', desc: 'Close revenue & expenses to retained earnings' },
                    { step: 'Step 9', title: 'Post-Closing Trial Balance', desc: 'Only permanent accounts remain' },
                  ].map((s) => (
                    <div key={s.step} style={{ background: G + '08', borderRadius: '10px', padding: '12px', borderLeft: `3px solid ${G}` }}>
                      <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: G, textTransform: 'uppercase' }}>{s.step}</p>
                      <p style={{ margin: '4px 0 2px', fontSize: '13px', fontWeight: 700, color: '#1a2e1a' }}>{s.title}</p>
                      <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>{s.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── JOURNAL ENTRIES ───────────────────────────────────── */}
          {activeTab === 'journal' && (
            <div>
              <SectionHeader icon={FileText} title='Journal Entries' sub='All double-entry bookkeeping records'
                action={<button onClick={() => setShowJEModal(true)} style={{ background: G, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={14} />New Entry
                </button>} />
              <PeriodBar />
              <ListToolbar
                id="je-toolbar"
                list={jeList}
                searchPlaceholder="Search entry number, description or reference…"
                dateRange
                filters={[
                  { key: 'status', label: 'All statuses', options: [{ value: 'DRAFT', label: 'Draft' }, { value: 'POSTED', label: 'Posted' }, { value: 'REVERSED', label: 'Reversed' }] },
                  { key: 'referenceType', label: 'All types', options: jeTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ').toLowerCase() })) },
                ]}
              />
              <DataTable id="je-table" data={journalEntries} columns={jeCols} server={jeList} keyExtractor={(row: any) => String(row.id ?? row.account_id ?? row.entry_number)} emptyMessage={jeList.activeFilters ? 'No journal entries match your filters' : 'No journal entries yet. Create your first entry.'} />
            </div>
          )}

          {/* ── GENERAL LEDGER ────────────────────────────────────── */}
          {activeTab === 'ledger' && (
            <div>
              <SectionHeader icon={BookOpen} title='General Ledger' sub={`Running balance per account (posted entries only) · ${scopeLabel}`} />
              <PeriodBar />
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)}
                  style={{ ...selectStyle, maxWidth: '320px', background: '#f0faf0', borderColor: G + '44' }}>
                  <option value=''>All Accounts</option>
                  {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
                <button onClick={() => loadTabData('ledger', selectedPeriod)}
                  style={{ background: G + '18', border: 'none', color: G, borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RefreshCw size={13} />Refresh
                </button>
              </div>
              <ListToolbar id="gl-toolbar" list={glList} searchPlaceholder="Search entry number or description…" dateRange />
              <DataTable id="gl-table" data={glList.items} columns={ledgerCols} server={glList} keyExtractor={(row: any) => String(row.id ?? row.account_id ?? row.entry_number)} emptyMessage={glList.activeFilters ? 'No ledger lines match your filters' : 'No ledger entries. Post journal entries to see them here.'} />
            </div>
          )}

          {/* ── TRIAL BALANCE ─────────────────────────────────────── */}
          {activeTab === 'trial-balance' && (
            <div>
              <SectionHeader icon={Scale} title='Trial Balance' sub={`Verify debits equal credits across all accounts · ${scopeLabel}`} />
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                <PeriodBar />
                <div style={{ display: 'flex', background: '#f0f4f0', borderRadius: '10px', padding: '3px', gap: '2px' }}>
                  {['UNADJUSTED', 'ADJUSTED', 'POST_CLOSING'].map((t) => (
                    <button key={t} onClick={() => setTrialType(t)}
                      style={{ border: 'none', borderRadius: '8px', padding: '7px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, background: trialType === t ? G : 'transparent', color: trialType === t ? '#fff' : '#4b5563', transition: 'all 0.2s' }}>
                      {t.replace('_', '-')}
                    </button>
                  ))}
                </div>
              </div>
              {trialBalance && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ background: '#fff', borderRadius: '10px', padding: '14px 20px', border: '1px solid #e5ede5', flex: 1, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>Total Debits</p>
                      <p style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 800, color: G, fontFamily: 'monospace' }}>{fmt(trialBalance.totals?.grand_debit || 0)}</p>
                    </div>
                    <div style={{ background: '#fff', borderRadius: '10px', padding: '14px 20px', border: '1px solid #e5ede5', flex: 1, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>Total Credits</p>
                      <p style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 800, color: TEAL, fontFamily: 'monospace' }}>{fmt(trialBalance.totals?.grand_credit || 0)}</p>
                    </div>
                    <div style={{ background: trialBalance.totals?.is_balanced ? G + '12' : RED + '12', borderRadius: '10px', padding: '14px 20px', border: `1px solid ${trialBalance.totals?.is_balanced ? G : RED}44`, flex: 1, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>Status</p>
                      <p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 800, color: trialBalance.totals?.is_balanced ? G : RED }}>
                        {trialBalance.totals?.is_balanced ? 'Balanced' : 'Unbalanced'}
                      </p>
                    </div>
                  </div>
                  <DataTable data={trialBalance.accounts || []} columns={tbCols} keyExtractor={(row: any) => String(row.id ?? row.account_id ?? row.entry_number)} emptyMessage='No entries for this period/type.' />
                </div>
              )}
            </div>
          )}

          {/* ── INCOME STATEMENT ─────────────────────────────────── */}
          {activeTab === 'income' && (
            <div>
              <SectionHeader icon={TrendingUp} title='Income Statement' sub='Periodic system — COGS = Purchases − Ending Inventory' />
              <PeriodBar />
              {incomeStmt ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <StmtCard title={`Income Statement — ${scopeLabel}`}>
                      <StmtRow label='Sales Revenue' value={fmt(incomeStmt.summary.total_revenue)} bold color={G} />
                      <StmtRow label='Less: Cost of Goods Sold' value={`(${fmt(incomeStmt.summary.total_cogs)})`} color={RED} />
                      <StmtRow label='Gross Profit' value={fmt(incomeStmt.summary.gross_profit)} bold color={incomeStmt.summary.gross_profit >= 0 ? G : RED} separator />
                      <StmtRow label='Operating Expenses' value={`(${fmt(incomeStmt.summary.total_expenses)})`} color={AMBER} />
                      <StmtRow label='NET INCOME / (LOSS)' value={fmt(incomeStmt.summary.net_income)} bold color={incomeStmt.summary.net_income >= 0 ? G : RED} separator />
                      <div style={{ padding: '12px 20px', display: 'flex', gap: '20px', background: '#f9fdfb' }}>
                        <div>
                          <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>Gross Margin</p>
                          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: G }}>{incomeStmt.summary.gross_margin_pct.toFixed(1)}%</p>
                        </div>
                        <div>
                          <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>Net Margin</p>
                          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: G2 }}>{incomeStmt.summary.net_margin_pct.toFixed(1)}%</p>
                        </div>
                      </div>
                    </StmtCard>
                  </div>
                  <div>
                    <StmtCard title='COGS Formula (Periodic System)'>
                      <div style={{ padding: '16px 20px', background: '#f9fdfb' }}>
                        <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 700, color: '#374151' }}>COGS = Beginning Inventory + Purchases/Shipments − Ending Inventory</p>
                        {(incomeStmt.inventory_counts || []).map((ic: any) => (
                          <div key={ic.id} style={{ background: '#fff', borderRadius: '8px', padding: '10px 14px', marginBottom: '8px', border: '1px solid #e5ede5' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '13px', fontWeight: 600 }}>{ic.branch_name || 'HQ'} — {ic.count_date}</span>
                              <Badge label={ic.status} color={statusColor(ic.status)} />
                            </div>
                            <p style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 800, color: G, fontFamily: 'monospace' }}>Ending Inventory: {fmt(ic.total_value)}</p>
                          </div>
                        ))}
                        {(!incomeStmt.inventory_counts || incomeStmt.inventory_counts.length === 0) && (
                          <p style={{ color: '#9ca3af', fontSize: '13px' }}>No approved inventory counts for this period. Record physical counts in the Inventory Counts tab.</p>
                        )}
                      </div>
                    </StmtCard>

                    <StmtCard title='Revenue Breakdown'>
                      {(() => {
                        const activeRevenue = (incomeStmt.revenue || []).filter((r: any) => Number(r.amount || 0) > 0);
                        if (activeRevenue.length === 0) {
                          return <p style={{ padding: '20px', color: '#9ca3af', textAlign: 'center' }}>No revenue data posted yet.</p>;
                        }
                        return (
                          <div style={{ padding: '8px' }}>
                            <ResponsiveContainer width='100%' height={190}>
                              <PieChart>
                                <Pie
                                  data={activeRevenue}
                                  dataKey='amount'
                                  nameKey='name'
                                  cx='50%'
                                  cy='50%'
                                  outerRadius={65}
                                  innerRadius={25}
                                  paddingAngle={activeRevenue.length > 1 ? 3 : 0}
                                  label={({ name, percent }: any) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                  labelLine={{ stroke: '#64748b', strokeWidth: 1 }}
                                >
                                  {activeRevenue.map((_: any, i: number) => (
                                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip formatter={(v) => [fmt(Number(v)), 'Revenue']} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        );
                      })()}
                    </StmtCard>
                  </div>
                </div>
              ) : <p style={{ color: '#9ca3af' }}>Select a period and post journal entries to see the income statement.</p>}
            </div>
          )}

          {/* ── BALANCE SHEET ─────────────────────────────────────── */}
          {activeTab === 'balance-sheet' && (
            <div>
              <SectionHeader icon={Building2} title='Balance Sheet' sub={`Assets = Liabilities + Owner's Equity · ${scopeLabel}`} />

              <PeriodBar />
              {(balanceSheet?.warnings || []).map((w: string, i: number) => (
                <div key={i} role='alert' style={{ background: AMBER + '14', border: `1px solid ${AMBER}55`, color: '#7c4a03', borderRadius: '10px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', fontWeight: 600 }}>
                  {w}
                </div>
              ))}
              {balanceSheet ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <StmtCard title='ASSETS'>
                    <StmtRow label='CURRENT ASSETS' value='' bold />
                    {(balanceSheet.assets || []).filter((a: any) => a.code.startsWith('10')).map((a: any) => (
                      <StmtRow key={a.id} label={a.account_name} value={fmt(a.balance)} indent={1} />
                    ))}
                    <StmtRow label='FIXED ASSETS' value='' bold />
                    {(balanceSheet.assets || []).filter((a: any) => a.code.startsWith('15') || a.code.startsWith('16')).map((a: any) => (
                      <StmtRow key={a.id} label={a.account_name} value={a.code === '1501' ? `(${fmt(Math.abs(a.balance))})` : fmt(a.balance)} indent={1} color={a.code === '1501' ? RED : '#374151'} />
                    ))}
                    {(balanceSheet.assets || []).filter((a: any) => !a.code.startsWith('10') && !a.code.startsWith('15') && !a.code.startsWith('16')).length > 0 && (
                      <>
                        <StmtRow label='OTHER ASSETS' value='' bold />
                        {(balanceSheet.assets || []).filter((a: any) => !a.code.startsWith('10') && !a.code.startsWith('15') && !a.code.startsWith('16')).map((a: any) => (
                          <StmtRow key={a.id} label={a.account_name} value={fmt(a.balance)} indent={1} />
                        ))}
                      </>
                    )}
                    <StmtRow label='TOTAL ASSETS' value={fmt(balanceSheet.totals?.total_assets || 0)} bold color={G} separator />
                  </StmtCard>
                  <div>
                    <StmtCard title='LIABILITIES'>
                      {(balanceSheet.liabilities || []).map((a: any) => (
                        <StmtRow key={a.id} label={a.account_name} value={fmt(a.balance)} indent={1} />
                      ))}
                      <StmtRow label='TOTAL LIABILITIES' value={fmt(balanceSheet.totals?.total_liabilities || 0)} bold color={RED} separator />
                    </StmtCard>
                    <StmtCard title="OWNER'S EQUITY">
                      {(balanceSheet.equity || []).map((a: any) => (
                        <StmtRow key={a.id} label={a.account_name} value={fmt(a.balance)} indent={1} />
                      ))}
                      <StmtRow label="TOTAL OWNER'S EQUITY" value={fmt(balanceSheet.totals?.total_equity || 0)} bold color={TEAL} separator />
                    </StmtCard>
                    <div style={{ background: (balanceSheet.totals?.is_balanced ? G : RED) + '12', borderRadius: '10px', padding: '14px 20px', border: `1px solid ${(balanceSheet.totals?.is_balanced ? G : RED)}44`, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontWeight: 800, color: balanceSheet.totals?.is_balanced ? G : RED, fontSize: '15px' }}>
                        {balanceSheet.totals?.is_balanced && balanceSheet.verification?.trial_balance_balanced !== false ? 'Balance Sheet Balanced · ledger debits = credits' : 'Unbalanced — check the trial balance'}
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
                        Total Assets: {fmt(balanceSheet.totals?.total_assets || 0)} | Liabilities + Equity: {fmt(balanceSheet.totals?.total_liabilities_and_equity || 0)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : <p style={{ color: '#9ca3af' }}>Post journal entries to see the balance sheet.</p>}
            </div>
          )}

          {/* ── CASH FLOW ─────────────────────────────────────────── */}
          {activeTab === 'cash-flow' && (
            <div>
              <SectionHeader icon={Wallet} title='Cash Flow Statement' sub='Direct method — from Cash & Bank account movements' />
              <PeriodBar />
              {(cashFlow?.warnings || []).map((w: string, i: number) => (
                <div key={i} role='alert' style={{ background: AMBER + '14', border: `1px solid ${AMBER}55`, color: '#7c4a03', borderRadius: '10px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', fontWeight: 600 }}>
                  {w}
                </div>
              ))}
              {cashFlow ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <StmtCard title={`Statement of Cash Flows (Direct Method) — ${scopeLabel}`}>

                    <StmtRow label='OPERATING ACTIVITIES' value='' bold />
                    {(cashFlow.operating_activities || []).map((a: any, i: number) => (
                      <StmtRow key={i} label={CASH_LABELS[a.reference_type] || a.reference_type} value={fmt(a.net)} indent={1} color={a.net >= 0 ? G : RED} />
                    ))}
                    {(cashFlow.operating_activities || []).length === 0 && <StmtRow label='None' value={fmt(0)} indent={1} />}
                    <StmtRow label='Net cash from operating activities' value={fmt(cashFlow.summary?.net_cash_from_operations || 0)} bold color={(cashFlow.summary?.net_cash_from_operations || 0) >= 0 ? G : RED} separator />
                    <StmtRow label='INVESTING ACTIVITIES' value='' bold />
                    {(cashFlow.investing_activities || []).map((a: any, i: number) => (
                      <StmtRow key={i} label={CASH_LABELS[a.reference_type] || a.reference_type} value={fmt(a.net)} indent={1} color={a.net >= 0 ? G : RED} />
                    ))}
                    {(cashFlow.investing_activities || []).length === 0 && <StmtRow label='None' value={fmt(0)} indent={1} />}
                    <StmtRow label='Net cash from investing activities' value={fmt(cashFlow.summary?.net_cash_from_investing || 0)} bold color={(cashFlow.summary?.net_cash_from_investing || 0) >= 0 ? G : RED} separator />
                    <StmtRow label='FINANCING ACTIVITIES' value='' bold />
                    {(cashFlow.financing_activities || []).map((a: any, i: number) => (
                      <StmtRow key={i} label={CASH_LABELS[a.reference_type] || a.reference_type} value={fmt(a.net)} indent={1} color={a.net >= 0 ? G : RED} />
                    ))}
                    {(cashFlow.financing_activities || []).length === 0 && <StmtRow label='None' value={fmt(0)} indent={1} />}
                    <StmtRow label='Net cash from financing activities' value={fmt(cashFlow.summary?.net_cash_from_financing || 0)} bold color={(cashFlow.summary?.net_cash_from_financing || 0) >= 0 ? G : RED} separator />
                    <StmtRow label='Net change in cash' value={fmt(cashFlow.summary?.net_change_in_cash || 0)} bold />
                    <StmtRow label='Beginning cash balance' value={fmt(cashFlow.summary?.beginning_cash_balance || 0)} indent={1} />
                    <StmtRow label='ENDING CASH BALANCE' value={fmt(cashFlow.summary?.ending_cash_balance || 0)} bold color={(cashFlow.summary?.ending_cash_balance || 0) >= 0 ? G : RED} separator />
                  </StmtCard>
                  <div>
                    <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #e5ede5', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                      <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700 }}>Cash Summary</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div style={{ background: G + '12', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
                          <p style={{ margin: 0, fontSize: '11px', color: G, fontWeight: 700, textTransform: 'uppercase' }}>Cash In</p>
                          <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: G, fontFamily: 'monospace' }}>{fmt(cashFlow.summary?.total_cash_in || 0)}</p>
                        </div>
                        <div style={{ background: RED + '12', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
                          <p style={{ margin: 0, fontSize: '11px', color: RED, fontWeight: 700, textTransform: 'uppercase' }}>Cash Out</p>
                          <p style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: RED, fontFamily: 'monospace' }}>{fmt(cashFlow.summary?.total_cash_out || 0)}</p>
                        </div>
                        <div style={{ background: BLUE + '12', borderRadius: '10px', padding: '14px', textAlign: 'center', gridColumn: '1 / -1' }}>
                          <p style={{ margin: 0, fontSize: '11px', color: BLUE, fontWeight: 700, textTransform: 'uppercase' }}>Ending Cash Balance</p>
                          <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 800, color: BLUE, fontFamily: 'monospace' }}>{fmt(cashFlow.summary?.ending_cash_balance || 0)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : <p style={{ color: '#9ca3af' }}>Post journal entries affecting Cash & Bank to see cash flow.</p>}
            </div>
          )}

          {/* ── OWNER'S EQUITY ────────────────────────────────────── */}
          {activeTab === 'equity' && (
            <div>
              <SectionHeader icon={Users} title="Statement of Owner's Equity" sub='Changes in owner capital for the period' />
              <PeriodBar />
              {ownersEquity ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <StmtCard title={`Statement of Owner's Equity — ${scopeLabel}`}>
                    <StmtRow label='Beginning Capital' value={fmt(ownersEquity.statement?.beginning_capital || 0)} />
                    <StmtRow label='Add: Net Income for Period' value={`+ ${fmt(ownersEquity.statement?.add_net_income || 0)}`} indent={1} color={G} />
                    <StmtRow label='Less: Owner Drawings' value={`− ${fmt(ownersEquity.statement?.less_drawings || 0)}`} indent={1} color={AMBER} />
                    <StmtRow label="ENDING OWNER'S EQUITY" value={fmt(ownersEquity.statement?.ending_owner_equity || 0)} bold color={G} separator />
                  </StmtCard>
                  <StmtCard title='Equity Account Balances'>
                    {(ownersEquity.equity_accounts || []).map((a: any) => (
                      <StmtRow key={a.id} label={`${a.code} — ${a.account_name}`} value={fmt(a.balance)} color={a.balance >= 0 ? G : RED} />
                    ))}
                  </StmtCard>
                </div>
              ) : <p style={{ color: '#9ca3af' }}>Post journal entries to equity accounts to see the equity statement.</p>}
            </div>
          )}

          {/* ── CHART OF ACCOUNTS ─────────────────────────────────── */}
          {activeTab === 'coa' && (
            <div>
              <SectionHeader icon={Layers} title='Chart of Accounts' sub='All ledger accounts and their classifications'
                action={<button onClick={() => setShowCoAModal(true)} style={{ background: G, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={14} />New Account
                </button>} />
              {/* Type summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                {['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS'].map((t) => {
                  const cnt = accounts.filter((a: any) => a.account_type === t).length;
                  return (
                    <div key={t} style={{ background: accountTypeColor(t) + '12', borderRadius: '10px', padding: '12px', border: `1px solid ${accountTypeColor(t)}33`, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: accountTypeColor(t), textTransform: 'uppercase' }}>{t}</p>
                      <p style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 800, color: '#1a2e1a' }}>{cnt}</p>
                    </div>
                  );
                })}
              </div>
              <DataTable data={accounts} columns={coaCols} keyExtractor={(row: any) => String(row.id ?? row.account_id ?? row.entry_number)} emptyMessage='No accounts found.' />
            </div>
          )}

          {/* ── INVENTORY COUNTS ──────────────────────────────────── */}
          {activeTab === 'inventory' && (
            <div>
              <SectionHeader icon={Package} title='Physical Inventory Counts' sub='Period-end physical counts — used to compute COGS under periodic system'
                action={<button onClick={() => setShowInvCountModal(true)} style={{ background: G, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={14} />Record Count
                </button>} />
              <PeriodBar />
              <div style={{ background: AMBER + '10', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', border: `1px solid ${AMBER}33`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertCircle size={16} color={AMBER} />
                <p style={{ margin: 0, fontSize: '13px', color: AMBER, fontWeight: 600 }}>
                  Under the Periodic Inventory System, COGS is computed at period-end: <strong>COGS = Beginning Inventory + Purchases − Ending Inventory</strong>. Approve counts to use them in financial statements.
                </p>
              </div>
              <DataTable data={invCounts} columns={invCountCols} keyExtractor={(row: any) => String(row.id ?? row.account_id ?? row.entry_number)} emptyMessage='No inventory counts recorded. Conduct a physical count and record it here.' />
            </div>
          )}

          {/* ── DEPRECIATION ──────────────────────────────────────── */}

          {/* ── OPENING BALANCES ─────────────────────────────────── */}
          {activeTab === 'opening' && (
            <div>
              <SectionHeader icon={Calendar} title='Opening Balances' sub={"Each branch's starting cash and the value of stock that was entered without a cost in the books"} />
              {!canChooseBranch ? (
                <p style={{ color: '#6b7280' }}>Only administrators and accountants can record opening balances.</p>
              ) : (
                <>
                  <div style={{ background: BLUE + '10', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', border: `1px solid ${BLUE}33`, fontSize: '13px', color: '#1e3a5f', lineHeight: 1.5 }}>
                    <strong>Stock value</strong> is found automatically: quantities on hand that no purchase, transfer or sale explains, valued at each product's cost price.
                    Posting records <strong>Dr Inventory / Cr Owner's Capital</strong> (and <strong>Dr Cash / Cr Owner's Capital</strong> for opening cash), dated the start of the current fiscal year, in that branch's books.
                  </div>
                  <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #e5ede5', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflowX: 'auto' as const }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '720px' }}>
                      <thead>
                        <tr>
                          {['Branch', 'Stock value not yet in the books', 'Opening cash posted', 'Opening cash to record', ''].map((h, i) => (
                            <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5ede5' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {openingRows.map((r: any) => (
                          <tr key={r.branch_id}>
                            <td style={{ textAlign: 'left' as const, padding: '9px 10px', borderBottom: '1px solid #f0f4f0' }}><strong>{r.branch_name}</strong></td>
                            <td style={{ textAlign: 'right' as const, padding: '9px 10px', borderBottom: '1px solid #f0f4f0', fontFamily: 'monospace' }}>{fmt(r.unrecorded_stock_value)}{r.unrecorded_stock_lines ? <span style={{ color: '#9ca3af', fontSize: '11px' }}> ({r.unrecorded_stock_lines} items)</span> : null}</td>
                            <td style={{ textAlign: 'right' as const, padding: '9px 10px', borderBottom: '1px solid #f0f4f0', fontFamily: 'monospace' }}>{fmt(r.opening_cash_posted)}</td>
                            <td style={{ textAlign: 'right' as const, padding: '9px 10px', borderBottom: '1px solid #f0f4f0', fontFamily: 'monospace' }}>
                              <input type='number' min='0' step='0.01' placeholder='0.00' aria-label={`Opening cash for ${r.branch_name}`}
                                disabled={r.opening_cash_posted > 0}
                                value={openingCash[r.branch_id] ?? ''}
                                onChange={(e) => setOpeningCash((prev) => ({ ...prev, [r.branch_id]: e.target.value }))}
                                style={{ ...selectStyle, maxWidth: '140px', textAlign: 'right' }} />
                            </td>
                            <td style={{ textAlign: 'right' as const, padding: '9px 10px', borderBottom: '1px solid #f0f4f0', fontFamily: 'monospace' }}>
                              <button type='button' onClick={() => postOpening(r)}
                                disabled={submitting || (r.unrecorded_stock_value === 0 && !(Number(openingCash[r.branch_id]) > 0))}
                                style={{ background: G, border: 'none', color: '#fff', borderRadius: '8px', padding: '7px 14px', cursor: 'pointer', fontWeight: 700, opacity: submitting || (r.unrecorded_stock_value === 0 && !(Number(openingCash[r.branch_id]) > 0)) ? 0.45 : 1 }}>
                                Post
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'depreciation' && (
            <div>
              <SectionHeader icon={Calendar} title='Depreciation Schedules' sub='Fixed asset depreciation allocation per fiscal period'
                action={<button onClick={() => setShowDepModal(true)} style={{ background: G, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={14} />Record Depreciation
                </button>} />
              <div style={{ background: BLUE + '10', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', border: `1px solid ${BLUE}33`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <BarChart3 size={16} color={BLUE} />
                <p style={{ margin: 0, fontSize: '13px', color: BLUE, fontWeight: 600 }}>
                  Straight-Line Formula: <strong>Annual Dep. = (Cost − Salvage Value) ÷ Useful Life</strong>. Record a journal entry to post the depreciation expense.
                </p>
              </div>
              <DataTable data={depreciation} columns={depCols} keyExtractor={(row: any) => String(row.id ?? row.account_id ?? row.entry_number)} emptyMessage='No depreciation records. Add equipment assets and record annual depreciation.' />
            </div>
          )}

        </div>
      </div>

      {/* ══ MODALS ════════════════════════════════════════════════ */}

      {/* New Journal Entry Modal */}
      <Modal open={showJEModal} onClose={() => setShowJEModal(false)} title='New Journal Entry' width={700}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormField label='Entry Date' required>
            <input type='date' value={jeForm.entry_date} onChange={(e) => setJeForm({ ...jeForm, entry_date: e.target.value })} style={inputStyle} />
          </FormField>
          <FormField label='Fiscal Period'>
            <select value={jeForm.fiscal_period_id} onChange={(e) => setJeForm({ ...jeForm, fiscal_period_id: e.target.value })} style={selectStyle}>
              <option value=''>Select period...</option>
              {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label='Description' required>
          <input type='text' value={jeForm.description} onChange={(e) => setJeForm({ ...jeForm, description: e.target.value })} style={inputStyle} placeholder='e.g. Record central purchases of building materials' />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormField label='Reference Type'>
            <select value={jeForm.reference_type} onChange={(e) => setJeForm({ ...jeForm, reference_type: e.target.value })} style={selectStyle}>
              {['MANUAL', 'PURCHASE', 'SALE', 'TRANSFER', 'EXPENSE', 'DEPRECIATION', 'CLOSING'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label='Branch'>
            <select value={jeForm.branch_id} onChange={(e) => setJeForm({ ...jeForm, branch_id: e.target.value })} style={selectStyle}>
              <option value=''>HQ / All</option>
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </FormField>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Journal Lines <span style={{ color: RED }}>*</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: jeBalanced ? G : RED, fontWeight: 700 }}>
                Dr: {fmtN(jeLineTotalDr)} | Cr: {fmtN(jeLineTotalCr)} {jeBalanced ? '(Balanced)' : '(Unbalanced)'}
              </span>
              <button onClick={() => setJeForm({ ...jeForm, lines: [...jeForm.lines, { account_id: '', description: '', debit_amount: '', credit_amount: '' }] })}
                style={{ background: G + '18', border: 'none', color: G, borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                <Plus size={11} style={{ marginRight: '3px' }} />Add Line
              </button>
            </div>
          </div>
          <div style={{ border: '1.5px solid #e5ede5', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 32px', background: '#f9fdfb', padding: '8px 12px', gap: '8px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
              <span>Account</span><span>Description</span><span>Debit</span><span>Credit</span><span></span>
            </div>
            {jeForm.lines.map((line, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 32px', padding: '6px 12px', gap: '8px', borderTop: '1px solid #f0f4f0', alignItems: 'center' }}>
                <select value={line.account_id} onChange={(e) => { const l = [...jeForm.lines]; l[idx] = { ...l[idx], account_id: e.target.value }; setJeForm({ ...jeForm, lines: l }); }}
                  style={{ ...selectStyle, padding: '6px 8px', fontSize: '12px' }}>
                  <option value=''>Select account...</option>
                  {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
                <input type='text' value={line.description} onChange={(e) => { const l = [...jeForm.lines]; l[idx] = { ...l[idx], description: e.target.value }; setJeForm({ ...jeForm, lines: l }); }}
                  style={{ ...inputStyle, padding: '6px 8px', fontSize: '12px' }} placeholder='Description...' />
                <input type='number' min='0' step='0.01' value={line.debit_amount} onChange={(e) => { const l = [...jeForm.lines]; l[idx] = { ...l[idx], debit_amount: e.target.value }; setJeForm({ ...jeForm, lines: l }); }}
                  style={{ ...inputStyle, padding: '6px 8px', fontSize: '12px', color: G, fontFamily: 'monospace' }} placeholder='0.00' />
                <input type='number' min='0' step='0.01' value={line.credit_amount} onChange={(e) => { const l = [...jeForm.lines]; l[idx] = { ...l[idx], credit_amount: e.target.value }; setJeForm({ ...jeForm, lines: l }); }}
                  style={{ ...inputStyle, padding: '6px 8px', fontSize: '12px', color: TEAL, fontFamily: 'monospace' }} placeholder='0.00' />
                {jeForm.lines.length > 2 ? (
                  <button onClick={() => setJeForm({ ...jeForm, lines: jeForm.lines.filter((_, i) => i !== idx) })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, padding: '4px', borderRadius: '6px' }}>
                    <X size={14} />
                  </button>
                ) : <span />}
              </div>
            ))}
          </div>
        </div>

        <FormField label='Notes'>
          <textarea value={jeForm.notes} onChange={(e) => setJeForm({ ...jeForm, notes: e.target.value })} style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder='Optional notes...' />
        </FormField>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid #e9f0e9' }}>
          <button onClick={() => setShowJEModal(false)} style={{ background: '#f3f4f6', border: 'none', color: '#374151', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={submitJE} disabled={submitting || !jeBalanced}
            style={{ background: jeBalanced ? G : '#9ca3af', border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 20px', cursor: jeBalanced ? 'pointer' : 'not-allowed', fontWeight: 700, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Saving...' : 'Save Journal Entry'}
          </button>
        </div>
      </Modal>

      {/* JE Detail Modal */}
      <Modal open={!!showJEDetail || jeOpening} onClose={closeJEDetail} title={showJEDetail ? `Entry: ${showJEDetail.entry_number}` : 'Journal entry'} width={680}>
        {!showJEDetail && <ModalLoading />}
        {showJEDetail && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div><p style={{ margin: 0, fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>DATE</p><p style={{ margin: '3px 0 0', fontWeight: 700 }}>{showJEDetail.entry_date}</p></div>
              <div><p style={{ margin: 0, fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>STATUS</p><div style={{ marginTop: '3px' }}><Badge label={showJEDetail.status} color={statusColor(showJEDetail.status)} /></div></div>
              <div><p style={{ margin: 0, fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>PERIOD</p><p style={{ margin: '3px 0 0', fontWeight: 700 }}>{showJEDetail.period_name || '—'}</p></div>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#374151' }}>{showJEDetail.description}</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f0faf0' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#374151' }}>Account</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#374151' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: G }}>Debit ($)</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: TEAL }}>Credit ($)</th>
                </tr>
              </thead>
              <tbody>
                {(showJEDetail.lines || []).map((l: any) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid #f0f4f0' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{l.account_code} — {l.account_name}</td>
                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{l.description || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: G }}>{l.debit_amount > 0 ? fmtN(l.debit_amount) : '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: TEAL }}>{l.credit_amount > 0 ? fmtN(l.credit_amount) : '—'}</td>
                  </tr>
                ))}
                <tr style={{ background: '#f9fdfb', fontWeight: 700, borderTop: `2px solid ${G}33` }}>
                  <td colSpan={2} style={{ padding: '8px 12px' }}>TOTALS</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: G }}>{fmtN(showJEDetail.total_debit)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: TEAL }}>{fmtN(showJEDetail.total_credit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* New CoA Modal */}
      <Modal open={showCoAModal} onClose={() => setShowCoAModal(false)} title='New Chart of Accounts Entry'>
        <FormField label='Account Code' required><input type='text' value={coaForm.code} onChange={(e) => setCoaForm({ ...coaForm, code: e.target.value })} style={inputStyle} placeholder='e.g. 1050' /></FormField>
        <FormField label='Account Name' required><input type='text' value={coaForm.name} onChange={(e) => setCoaForm({ ...coaForm, name: e.target.value })} style={inputStyle} placeholder='e.g. Petty Cash' /></FormField>
        <FormField label='Account Type' required>
          <select value={coaForm.account_type} onChange={(e) => setCoaForm({ ...coaForm, account_type: e.target.value })} style={selectStyle}>
            {['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label='Description'><input type='text' value={coaForm.description} onChange={(e) => setCoaForm({ ...coaForm, description: e.target.value })} style={inputStyle} placeholder='Brief description...' /></FormField>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid #e9f0e9' }}>
          <button onClick={() => setShowCoAModal(false)} style={{ background: '#f3f4f6', border: 'none', color: '#374151', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={submitCoA} disabled={submitting} style={{ background: G, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 700, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Saving...' : 'Create Account'}
          </button>
        </div>
      </Modal>

      {/* New Period Modal */}
      <Modal open={showPeriodModal} onClose={() => setShowPeriodModal(false)} title='New Fiscal Period'>
        <FormField label='Period Name' required><input type='text' value={periodForm.name} onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })} style={inputStyle} placeholder='e.g. FY 2026' /></FormField>
        <FormField label='Period Type'>
          <select value={periodForm.period_type} onChange={(e) => setPeriodForm({ ...periodForm, period_type: e.target.value })} style={selectStyle}>
            {['ANNUAL', 'QUARTERLY', 'MONTHLY'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormField label='Start Date' required><input type='date' value={periodForm.start_date} onChange={(e) => setPeriodForm({ ...periodForm, start_date: e.target.value })} style={inputStyle} /></FormField>
          <FormField label='End Date' required><input type='date' value={periodForm.end_date} onChange={(e) => setPeriodForm({ ...periodForm, end_date: e.target.value })} style={inputStyle} /></FormField>
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid #e9f0e9' }}>
          <button onClick={() => setShowPeriodModal(false)} style={{ background: '#f3f4f6', border: 'none', color: '#374151', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={submitPeriod} disabled={submitting} style={{ background: G, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 700, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Saving...' : 'Create Period'}
          </button>
        </div>
      </Modal>

      {/* Inventory Count Modal */}
      <Modal open={showInvCountModal} onClose={() => setShowInvCountModal(false)} title='Record Physical Inventory Count'>
        <FormField label='Fiscal Period' required>
          <select value={invForm.fiscal_period_id} onChange={(e) => setInvForm({ ...invForm, fiscal_period_id: e.target.value })} style={selectStyle}>
            <option value=''>Select period...</option>
            {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormField>
        <FormField label='Branch'>
          <select value={invForm.branch_id} onChange={(e) => setInvForm({ ...invForm, branch_id: e.target.value })} style={selectStyle}>
            <option value=''>HQ / All</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FormField>
        <FormField label='Count Date' required><input type='date' value={invForm.count_date} onChange={(e) => setInvForm({ ...invForm, count_date: e.target.value })} style={inputStyle} /></FormField>
        <FormField label='Total Ending Inventory Value ($)' required><input type='number' min='0' step='0.01' value={invForm.total_value} onChange={(e) => setInvForm({ ...invForm, total_value: e.target.value })} style={inputStyle} placeholder='e.g. 27000' /></FormField>
        <FormField label='Notes'><textarea value={invForm.notes} onChange={(e) => setInvForm({ ...invForm, notes: e.target.value })} style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder='Physical count details...' /></FormField>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid #e9f0e9' }}>
          <button onClick={() => setShowInvCountModal(false)} style={{ background: '#f3f4f6', border: 'none', color: '#374151', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={submitInvCount} disabled={submitting} style={{ background: G, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 700, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Saving...' : 'Record Count'}
          </button>
        </div>
      </Modal>

      {/* Depreciation Modal */}
      <Modal open={showDepModal} onClose={() => setShowDepModal(false)} title='Record Depreciation Schedule'>
        <FormField label='Asset Name' required><input type='text' value={depForm.asset_name} onChange={(e) => setDepForm({ ...depForm, asset_name: e.target.value })} style={inputStyle} placeholder='e.g. Equipment & Vehicles' /></FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormField label='Acquisition Date' required><input type='date' value={depForm.acquisition_date} onChange={(e) => setDepForm({ ...depForm, acquisition_date: e.target.value })} style={inputStyle} /></FormField>
          <FormField label='Cost ($)' required><input type='number' min='0' value={depForm.cost} onChange={(e) => setDepForm({ ...depForm, cost: e.target.value })} style={inputStyle} placeholder='20000' /></FormField>
          <FormField label='Salvage Value ($)'><input type='number' min='0' value={depForm.salvage_value} onChange={(e) => setDepForm({ ...depForm, salvage_value: e.target.value })} style={inputStyle} /></FormField>
          <FormField label='Useful Life (Years)' required><input type='number' min='1' value={depForm.useful_life_years} onChange={(e) => setDepForm({ ...depForm, useful_life_years: e.target.value })} style={inputStyle} /></FormField>
        </div>
        <FormField label='Period Depreciation Amount ($)' required><input type='number' min='0' step='0.01' value={depForm.period_depreciation} onChange={(e) => setDepForm({ ...depForm, period_depreciation: e.target.value })} style={inputStyle} placeholder='2500' /></FormField>
        <FormField label='Fiscal Period'>
          <select value={depForm.fiscal_period_id} onChange={(e) => setDepForm({ ...depForm, fiscal_period_id: e.target.value })} style={selectStyle}>
            <option value=''>Select period...</option>
            {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormField>
        {depForm.cost && depForm.salvage_value !== '' && depForm.useful_life_years && (
          <div style={{ background: G + '10', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', border: `1px solid ${G}33` }}>
            <p style={{ margin: 0, fontSize: '13px', color: G, fontWeight: 600 }}>
              Straight-Line: ({fmt(parseFloat(depForm.cost) || 0)} − {fmt(parseFloat(depForm.salvage_value) || 0)}) ÷ {depForm.useful_life_years} = <strong>{fmt(((parseFloat(depForm.cost) || 0) - (parseFloat(depForm.salvage_value) || 0)) / (parseInt(depForm.useful_life_years) || 1))}/yr</strong>
            </p>
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid #e9f0e9' }}>
          <button onClick={() => setShowDepModal(false)} style={{ background: '#f3f4f6', border: 'none', color: '#374151', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={submitDep} disabled={submitting} style={{ background: G, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 700, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Saving...' : 'Save Depreciation'}
          </button>
        </div>
      </Modal>

      {/* Year-End Closing Modal */}
      <Modal open={showClosingModal} onClose={() => setShowClosingModal(false)} title='Generate Year-End Closing Entries'>
        <div style={{ background: AMBER + '10', borderRadius: '10px', padding: '16px', marginBottom: '16px', border: `1px solid ${AMBER}33` }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <AlertCircle size={18} color={AMBER} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: AMBER, fontSize: '14px' }}>This action generates closing journal entries</p>
              <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#92400e' }}>
                Closing entries will:<br />
                1. Close all Revenue accounts → Income Summary<br />
                2. Close all Expense / COGS accounts → Income Summary<br />
                3. Close Income Summary → Retained Earnings<br />
                These entries will be auto-posted for period: <strong>{periods.find(p => p.id === selectedPeriod)?.name || '—'}</strong>
              </p>
            </div>
          </div>
        </div>
        <FormField label='Fiscal Period (Closing for)'>
          <select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)} style={selectStyle}>
            <option value=''>Select period...</option>
            {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormField>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid #e9f0e9' }}>
          <button onClick={() => setShowClosingModal(false)} style={{ background: '#f3f4f6', border: 'none', color: '#374151', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          <button onClick={generateClosing} disabled={submitting || !selectedPeriod}
            style={{ background: selectedPeriod ? AMBER : '#9ca3af', border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 20px', cursor: selectedPeriod ? 'pointer' : 'not-allowed', fontWeight: 700, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Generating...' : 'Generate Closing Entries'}
          </button>
        </div>
      </Modal>

      <Modal open={!!ledgerDrill} onClose={closeLedgerDrill} title={`General Ledger — ${ledgerDrill?.account?.code || ''} ${ledgerDrill?.account?.account_name || ''}`} width={900}>
        <p style={{ marginTop: 0, color: '#64748b', fontSize: '13px' }}>Posted transaction activity for this account</p>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}><thead><tr>{['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance'].map((label) => <th key={label} style={{ textAlign: label === 'Description' ? 'left' : 'right', padding: '9px', borderBottom: '1px solid #d7e6df', color: '#475569' }}>{label}</th>)}</tr></thead><tbody>{ledgerDrill?.rows === null && <tr><td colSpan={6}><ModalLoading text="Loading account activity…" /></td></tr>}{ledgerDrill?.rows?.map((row) => <tr key={row.id}><td style={{ padding: '9px' }}>{row.entry_date}</td><td style={{ padding: '9px' }}>{row.entry_number}</td><td style={{ padding: '9px' }}>{row.description}</td><td style={{ padding: '9px', textAlign: 'right', color: G }}>{Number(row.debit_amount) ? fmt(row.debit_amount) : '—'}</td><td style={{ padding: '9px', textAlign: 'right', color: TEAL }}>{Number(row.credit_amount) ? fmt(row.credit_amount) : '—'}</td><td style={{ padding: '9px', textAlign: 'right', fontWeight: 700 }}>{fmt(row.running_balance)}</td></tr>)}</tbody></table></div>
      </Modal>
    </div>
  );
}
