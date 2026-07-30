import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BookOpen, BarChart3, FileText, Scale, TrendingUp, Building2,
  DollarSign, Users, Package, Calendar, RefreshCw, Plus, Send,
  CheckCircle2, AlertCircle, Clock, ChevronDown, X, RotateCcw,
  Layers, Wallet, Receipt,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import { PageSkeleton } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';

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
  return (
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
    </div>
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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);

  // Shared data
  const [periods, setPeriods] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');

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
  const [ledgerDrill, setLedgerDrill] = useState<{ account: any; rows: any[] } | null>(null);
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

  // ── Load base data ────────────────────────────────────────────────
  useEffect(() => {
    async function loadBase() {
      setLoading(true);
      try {
        const [pList, aList, bList] = await Promise.all([
          apiGet<any[]>('/accounting/fiscal-periods').catch(() => []),
          apiGet<any[]>('/accounting/chart-of-accounts').catch(() => []),
          apiGet<any[]>('/branches').catch(() => []),
        ]);
        setPeriods(pList || []);
        setAccounts(aList || []);
        setBranches(bList || []);
        if (pList?.length) setSelectedPeriod(pList[0].id);
      } catch (e) {
        addToast('Failed to load accounting data', 'error');
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
        const d = await apiGet<any>(`/accounting/dashboard${p}`).catch(() => null);
        setDashboard(d);
      } else if (tab === 'journal') {
        const rows = await apiGet<any[]>(`/accounting/journal-entries${period ? `?period_id=${period}` : ''}`).catch(() => []);
        setJournalEntries(rows || []);
      } else if (tab === 'ledger') {
        const rows = await apiGet<any[]>(`/accounting/general-ledger${ledgerAccountId ? `?account_id=${ledgerAccountId}` : ''}`).catch(() => []);
        setLedger(rows || []);
      } else if (tab === 'trial-balance') {
        const d = await apiGet<any>(`/accounting/trial-balance?type=${trialType}${period ? `&period_id=${period}` : ''}`).catch(() => null);
        setTrialBalance(d);
      } else if (tab === 'income') {
        const d = await apiGet<any>(`/accounting/income-statement${p}`).catch(() => null);
        setIncomeStmt(d);
      } else if (tab === 'balance-sheet') {
        const d = await apiGet<any>(`/accounting/balance-sheet${p}`).catch(() => null);
        setBalanceSheet(d);
      } else if (tab === 'cash-flow') {
        const d = await apiGet<any>(`/accounting/cash-flow${p}`).catch(() => null);
        setCashFlow(d);
      } else if (tab === 'equity') {
        const d = await apiGet<any>(`/accounting/owners-equity${p}`).catch(() => null);
        setOwnersEquity(d);
      } else if (tab === 'inventory') {
        const rows = await apiGet<any[]>(`/accounting/inventory-counts${p}`).catch(() => []);
        setInvCounts(rows || []);
      } else if (tab === 'depreciation') {
        const rows = await apiGet<any[]>('/accounting/depreciation').catch(() => []);
        setDepreciation(rows || []);
      }
    } catch (e) {
      addToast('Failed to load data', 'error');
    }
  }, [ledgerAccountId, trialType]);

  useEffect(() => {
    if (!loading) loadTabData(activeTab, selectedPeriod);
  }, [activeTab, selectedPeriod, loading]);

  useEffect(() => {
    if (!loading && activeTab === 'ledger') loadTabData('ledger', selectedPeriod);
  }, [ledgerAccountId]);

  useEffect(() => {
    if (!loading && activeTab === 'trial-balance') loadTabData('trial-balance', selectedPeriod);
  }, [trialType]);

  // ── Submit Journal Entry ─────────────────────────────────────────
  async function submitJE() {
    const lines = jeForm.lines.filter(l => l.account_id);
    const totalDr = lines.reduce((s, l) => s + (parseFloat(l.debit_amount) || 0), 0);
    const totalCr = lines.reduce((s, l) => s + (parseFloat(l.credit_amount) || 0), 0);
    if (Math.abs(totalDr - totalCr) > 0.005) {
      addToast(`Entry not balanced: Debits $${fmtN(totalDr)} ≠ Credits $${fmtN(totalCr)}`, 'error');
      return;
    }
    if (!jeForm.description || lines.length < 2) {
      addToast('Description and at least 2 lines required', 'error');
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
      addToast('Journal entry created', 'success');
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
      addToast(e?.message || 'Failed to create journal entry', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Post JE ──────────────────────────────────────────────────────
  async function postEntry(id: string) {
    setJournalEntries((rows) => rows.map((row) => row.id === id ? { ...row, status: 'POSTED' } : row));
    addToast('Posting entry…', 'info');
    try {
      await apiPost(`/accounting/journal-entries/${id}/post`, {});
      addToast('Entry posted to General Ledger', 'success');
      loadTabData('journal', selectedPeriod);
    } catch (e: any) {
      addToast(e?.message || 'Failed to post entry', 'error');
    }
  }

  // ── Reverse JE ───────────────────────────────────────────────────
  async function reverseEntry(id: string) {
    setJournalEntries((rows) => rows.map((row) => row.id === id ? { ...row, status: 'REVERSED' } : row));
    addToast('Creating reversal…', 'info');
    try {
      await apiPost(`/accounting/journal-entries/${id}/reverse`, {});
      addToast('Reversal entry created', 'success');
      loadTabData('journal', selectedPeriod);
    } catch (e: any) {
      addToast(e?.message || 'Failed to reverse entry', 'error');
    }
  }

  // ── Submit CoA ───────────────────────────────────────────────────
  async function submitCoA() {
    if (!coaForm.code || !coaForm.name || !coaForm.account_type) {
      addToast('Code, name, and type are required', 'error'); return;
    }
    setSubmitting(true);
    try {
      await apiPost('/accounting/chart-of-accounts', coaForm);
      addToast('Account created', 'success');
      setShowCoAModal(false);
      setCoaForm({ code: '', name: '', account_type: 'ASSET', description: '' });
      const aList = await apiGet<any[]>('/accounting/chart-of-accounts').catch(() => []);
      setAccounts(aList || []);
    } catch (e: any) {
      addToast(e?.message || 'Failed to create account', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Submit Period ────────────────────────────────────────────────
  async function submitPeriod() {
    if (!periodForm.name || !periodForm.start_date || !periodForm.end_date) {
      addToast('All period fields required', 'error'); return;
    }
    setSubmitting(true);
    try {
      await apiPost('/accounting/fiscal-periods', periodForm);
      addToast('Fiscal period created', 'success');
      setShowPeriodModal(false);
      const pList = await apiGet<any[]>('/accounting/fiscal-periods').catch(() => []);
      setPeriods(pList || []);
    } catch (e: any) {
      addToast(e?.message || 'Failed to create period', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Submit Inventory Count ───────────────────────────────────────
  async function submitInvCount() {
    if (!invForm.fiscal_period_id || !invForm.count_date || !invForm.total_value) {
      addToast('Period, date, and value required', 'error'); return;
    }
    setSubmitting(true);
    try {
      await apiPost('/accounting/inventory-counts', {
        ...invForm, total_value: parseFloat(invForm.total_value)
      });
      addToast('Inventory count recorded', 'success');
      setShowInvCountModal(false);
      loadTabData('inventory', selectedPeriod);
    } catch (e: any) {
      addToast(e?.message || 'Failed to record count', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Submit Depreciation ──────────────────────────────────────────
  async function submitDep() {
    if (!depForm.asset_name || !depForm.acquisition_date || !depForm.cost || !depForm.period_depreciation) {
      addToast('Required fields missing', 'error'); return;
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
      addToast('Depreciation recorded', 'success');
      setShowDepModal(false);
      loadTabData('depreciation', selectedPeriod);
    } catch (e: any) {
      addToast(e?.message || 'Failed to record depreciation', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Generate Closing Entries ─────────────────────────────────────
  async function generateClosing() {
    if (!selectedPeriod) { addToast('Select a fiscal period first', 'error'); return; }
    setSubmitting(true);
    try {
      const res = await apiPost<any>('/accounting/closing-entries', { fiscal_period_id: selectedPeriod });
      addToast(`Closing entries generated — Net Income: ${fmt(res.net_income)}`, 'success');
      setShowClosingModal(false);
      loadTabData('journal', selectedPeriod);
    } catch (e: any) {
      addToast(e?.message || 'Failed to generate closing entries', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Open JE Detail ───────────────────────────────────────────────
  async function openJEDetail(id: string) {
    try {
      const d = await apiGet<any>(`/accounting/journal-entries/${id}`);
      setShowJEDetail(d);
    } catch (e) {
      addToast('Failed to load entry details', 'error');
    }
  }

  async function openLedgerDrill(account: any) {
    try {
      const rows = await apiGet<any[]>(`/accounting/general-ledger?account_id=${account.account_id || account.id}`);
      setLedgerDrill({ account, rows: rows || [] });
    } catch (e) {
      addToast('Failed to load account activity', 'error');
    }
  }

  if (loading) return <PageSkeleton />;

  // ─── Tab definitions ────────────────────────────────────────────
  const workspaceMenus = useMemo(() => [
    { label: 'Dashboard', items: [{ key: 'dashboard', label: 'KPI Overview' }] },
    { label: 'Accounting', items: [{ key: 'journal', label: 'Journal Entries' }, { key: 'ledger', label: 'General Ledger' }, { key: 'trial-balance', label: 'Journal Items & Trial Balance' }, { key: 'coa', label: 'Chart of Accounts' }] },
    { label: 'Reporting', items: [{ key: 'income', label: 'Income Statement' }, { key: 'balance-sheet', label: 'Balance Sheet' }, { key: 'cash-flow', label: 'Cash Flow' }, { key: 'equity', label: 'Executive Summary' }] },
    { label: 'Management', items: [{ key: 'inventory', label: 'Physical Inventory Counts' }, { key: 'depreciation', label: 'Asset Depreciation' }, { key: 'journal', label: 'Year-End Closing' }] },
  ], []);


  // JE lines total
  const jeLineTotalDr = jeForm.lines.reduce((s, l) => s + (parseFloat(l.debit_amount) || 0), 0);
  const jeLineTotalCr = jeForm.lines.reduce((s, l) => s + (parseFloat(l.credit_amount) || 0), 0);
  const jeBalanced = Math.abs(jeLineTotalDr - jeLineTotalCr) < 0.005 && jeLineTotalDr > 0;

  // ── Columns ──────────────────────────────────────────────────────
  const jeCols: Column[] = [
    { key: 'entry_number', header: 'Entry #', render: (r) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: G, cursor: 'pointer' }} onClick={() => openJEDetail(r.id)}>{r.entry_number}</span> },
    { key: 'entry_date', header: 'Date' },
    { key: 'description', header: 'Description', render: (r) => <span style={{ fontSize: '13px' }}>{r.description}</span> },
    { key: 'reference_type', header: 'Type', render: (r) => r.reference_type ? <Badge label={r.reference_type} color={BLUE} /> : <span style={{ color: '#999' }}>—</span> },
    { key: 'total_debit', header: 'Debit', render: (r) => <span style={{ fontFamily: 'monospace', color: G }}>{fmt(r.total_debit)}</span> },
    { key: 'total_credit', header: 'Credit', render: (r) => <span style={{ fontFamily: 'monospace', color: TEAL }}>{fmt(r.total_credit)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge label={r.status} color={statusColor(r.status)} /> },
    {
      key: 'actions', header: '', render: (r) => (
        <div style={{ display: 'flex', gap: '6px' }}>
          {r.status === 'DRAFT' && (
            <button onClick={() => postEntry(r.id)} style={{ background: G + '18', border: 'none', color: G, borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
              <Send size={11} style={{ marginRight: '4px' }} />Post
            </button>
          )}
          {r.status === 'POSTED' && (
            <button onClick={() => reverseEntry(r.id)} style={{ background: AMBER + '18', border: 'none', color: AMBER, borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
              <RotateCcw size={11} style={{ marginRight: '4px' }} />Reverse
            </button>
          )}
        </div>
      )
    },
  ];

  const coaCols: Column[] = [
    { key: 'code', header: 'Code', render: (r) => <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.code}</span> },
    { key: 'name', header: 'Account Name' },
    { key: 'account_type', header: 'Type', render: (r) => <Badge label={r.account_type} color={accountTypeColor(r.account_type)} /> },
    { key: 'normal_balance', header: 'Normal', render: (r) => <span style={{ fontSize: '12px', color: r.normal_balance === 'DEBIT' ? G : TEAL }}>{r.normal_balance}</span> },
    { key: 'description', header: 'Description', render: (r) => <span style={{ fontSize: '12px', color: '#6b7280' }}>{r.description || '—'}</span> },
  ];

  const tbCols: Column[] = [
    { key: 'code', header: 'Code', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.code}</span> },
    { key: 'account_name', header: 'Account Name', render: (r: any) => <button type='button' onClick={() => openLedgerDrill(r)} style={{ border: 0, background: 'transparent', color: G, cursor: 'pointer', fontWeight: 700, padding: 0 }}>{r.account_name}</button> },
    { key: 'account_type', header: 'Type', render: (r: any) => <Badge label={r.account_type} color={accountTypeColor(r.account_type)} /> },
    { key: 'total_debit', header: 'Debit ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', color: G }}>{r.total_debit > 0 ? fmtN(r.total_debit) : '—'}</span> },
    { key: 'total_credit', header: 'Credit ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', color: TEAL }}>{r.total_credit > 0 ? fmtN(r.total_credit) : '—'}</span> },
    { key: 'net_balance', header: 'Balance ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: Number(r.net_balance) >= 0 ? G : RED }}>{fmtN(r.net_balance)}</span> },
  ];

  const ledgerCols: Column[] = [
    { key: 'account_code', header: 'Account', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: G }}>{r.account_code}</span> },
    { key: 'account_name', header: 'Account Name', render: (r: any) => <span style={{ fontSize: '13px' }}>{r.account_name}</span> },
    { key: 'entry_date', header: 'Date' },
    { key: 'entry_number', header: 'Entry #', render: (r: any) => <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.entry_number}</span> },
    { key: 'description', header: 'Description', render: (r: any) => <span style={{ fontSize: '12px' }}>{r.description}</span> },
    { key: 'debit_amount', header: 'Debit ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', color: G }}>{r.debit_amount > 0 ? fmtN(r.debit_amount) : '—'}</span> },
    { key: 'credit_amount', header: 'Credit ($)', render: (r: any) => <span style={{ fontFamily: 'monospace', color: TEAL }}>{r.credit_amount > 0 ? fmtN(r.credit_amount) : '—'}</span> },
    { key: 'running_balance', header: 'Balance', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: Number(r.running_balance) >= 0 ? G : RED }}>{fmtN(r.running_balance)}</span> },
  ];

  const invCountCols: Column[] = [
    { key: 'period_name', header: 'Period', render: (r: any) => <span style={{ fontSize: '13px', fontWeight: 600 }}>{r.period_name}</span> },
    { key: 'branch_name', header: 'Branch', render: (r: any) => r.branch_name || <span style={{ color: '#999' }}>HQ / Warehouse</span> },
    { key: 'count_date', header: 'Count Date' },
    { key: 'total_value', header: 'Ending Inventory Value', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: G }}>{fmt(r.total_value)}</span> },
    { key: 'status', header: 'Status', render: (r: any) => <Badge label={r.status} color={statusColor(r.status)} /> },
    { key: 'counted_by_name', header: 'Counted By', render: (r: any) => r.counted_by_name || '—' },
    {
      key: 'actions', header: '', render: (r: any) => r.status === 'DRAFT' ? (
        <button onClick={async () => {
          try {
            await apiPatch(`/accounting/inventory-counts/${r.id}/approve`, {});
            addToast('Inventory count approved', 'success');
            loadTabData('inventory', selectedPeriod);
          } catch (e) { addToast('Failed to approve', 'error'); }
        }} style={{ background: G + '18', border: 'none', color: G, borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
          <CheckCircle2 size={11} style={{ marginRight: '4px' }} />Approve
        </button>
      ) : null
    },
  ];

  const depCols: Column[] = [
    { key: 'asset_name', header: 'Asset Name', render: (r: any) => <span style={{ fontWeight: 600 }}>{r.asset_name}</span> },
    { key: 'acquisition_date', header: 'Acquired' },
    { key: 'cost', header: 'Cost', render: (r: any) => <span style={{ fontFamily: 'monospace' }}>{fmt(r.cost)}</span> },
    { key: 'salvage_value', header: 'Salvage', render: (r: any) => <span style={{ fontFamily: 'monospace' }}>{fmt(r.salvage_value)}</span> },
    { key: 'useful_life_years', header: 'Life (Yrs)' },
    { key: 'method', header: 'Method', render: (r: any) => <Badge label={r.method.replace('_', ' ')} color={TEAL} /> },
    { key: 'period_depreciation', header: 'Period Dep.', render: (r: any) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: AMBER }}>{fmt(r.period_depreciation)}</span> },
    { key: 'period_name', header: 'Period', render: (r: any) => r.period_name || '—' },
  ];

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
      <button onClick={() => loadTabData(activeTab, selectedPeriod)}
        style={{ background: G + '18', border: 'none', color: G, borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
        <RefreshCw size={13} />Refresh
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
      {/* Page Header */}
      <div style={{
        background: `linear-gradient(135deg, ${G} 0%, #0a5e0a 100%)`,
        padding: '28px 32px', marginBottom: '28px', borderRadius: '0 0 20px 20px',
        boxShadow: '0 4px 20px rgba(6,96,6,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '12px', padding: '12px', display: 'flex' }}>
              <BookOpen size={24} color='#fff' />
            </div>
            <div>
              <h1 style={{ margin: 0, color: '#fff', fontSize: '22px', fontWeight: 800 }}>Financial Accounting</h1>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.75)', fontSize: '13px' }}>
                Complete accounting cycle — Periodic Inventory System | HQ + Branch Consolidation
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => setShowPeriodModal(true)} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Calendar size={14} />New Period
            </button>
            <button onClick={() => setShowJEModal(true)} style={{ background: '#fff', border: 'none', color: G, borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
              <Plus size={14} />New Journal Entry
            </button>
            <button onClick={() => setShowClosingModal(true)} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Layers size={14} />Year-End Close
            </button>
          </div>
        </div>

        {/* Quick KPI strip */}
        {dashboard && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginTop: '24px' }}>
            {[
              { label: 'Total Revenue', value: fmt(dashboard.total_revenue), color: '#a7f3d0' },
              { label: 'Total Expenses', value: fmt(dashboard.total_expenses), color: '#fed7aa' },
              { label: 'Net Income', value: fmt(dashboard.net_income), color: dashboard.net_income >= 0 ? '#a7f3d0' : '#fca5a5' },
              { label: 'Journal Entries', value: `${dashboard.posted_entries} Posted`, color: '#bfdbfe' },
              { label: 'Chart of Accounts', value: `${dashboard.chart_of_accounts} Accounts`, color: '#ddd6fe' },
            ].map((kpi) => (
              <div key={kpi.label} style={{ background: 'rgba(255,255,255,0.12)', borderRadius: '10px', padding: '12px 16px', backdropFilter: 'blur(10px)' }}>
                <p style={{ margin: 0, fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{kpi.label}</p>
                <p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 800, color: '#fff' }}>{kpi.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tab Container */}
      <div style={{ padding: '0 24px 40px' }}>
        <nav aria-label="Accounting workspace" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '8px', border: '1px solid #d7e6df', background: '#fff', borderRadius: '14px', boxShadow: '0 8px 24px rgba(5, 70, 54, 0.08)' }}>
          {workspaceMenus.map((menu) => (
            <details key={menu.label} style={{ position: 'relative' }}>
              <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '9px 13px', borderRadius: '9px', fontWeight: 700, fontSize: '13px', color: menu.items.some((item) => item.key === activeTab) ? '#065f46' : '#334155' }}>
                {menu.label} <ChevronDown size={14} style={{ verticalAlign: 'middle' }} />
              </summary>
              <div style={{ position: 'absolute', zIndex: 10, minWidth: '220px', top: '40px', left: 0, padding: '6px', borderRadius: '10px', background: '#fff', border: '1px solid #d7e6df', boxShadow: '0 16px 32px rgba(5, 70, 54, 0.16)' }}>
                {menu.items.map((item) => <button key={item.label} type="button" onClick={() => setActiveTab(item.key)} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, background: activeTab === item.key ? '#ecfdf5' : 'transparent', color: '#0f172a', borderRadius: '7px', cursor: 'pointer', padding: '9px 10px', fontSize: '13px' }}>{item.label}</button>)}
              </div>
            </details>
          ))}
        </nav>

        <div style={{ marginTop: '24px' }}>

          {/* ── DASHBOARD ──────────────────────────────────────────── */}
          {activeTab === 'dashboard' && (
            <div>
              <PeriodBar />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '28px' }}>
                <MetricCard label='Total Revenue' value={fmt(dashboard?.total_revenue || 0)} icon={<TrendingUp size={20} color={G} />} />
                <MetricCard label='Total Expenses' value={fmt(dashboard?.total_expenses || 0)} icon={<Receipt size={20} color={AMBER} />} />
                <MetricCard label='Net Income' value={fmt(dashboard?.net_income || 0)} icon={<DollarSign size={20} color={dashboard?.net_income >= 0 ? G2 : RED} />} />
                <MetricCard label='Journal Entries' value={String(dashboard?.journal_entries || 0)} icon={<FileText size={20} color={BLUE} />} />
              </div>

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
                      <Tooltip formatter={(v: number) => fmt(v)} />
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
              <DataTable data={journalEntries} columns={jeCols} emptyMessage='No journal entries yet. Create your first entry.' />
            </div>
          )}

          {/* ── GENERAL LEDGER ────────────────────────────────────── */}
          {activeTab === 'ledger' && (
            <div>
              <SectionHeader icon={BookOpen} title='General Ledger' sub='Running balance per account (posted entries only)' />
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
              <DataTable data={ledger} columns={ledgerCols} emptyMessage='No ledger entries. Post journal entries to see them here.' />
            </div>
          )}

          {/* ── TRIAL BALANCE ─────────────────────────────────────── */}
          {activeTab === 'trial-balance' && (
            <div>
              <SectionHeader icon={Scale} title='Trial Balance' sub='Verify debits equal credits across all accounts' />
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
                        {trialBalance.totals?.is_balanced ? '✓ Balanced' : '✗ Unbalanced'}
                      </p>
                    </div>
                  </div>
                  <DataTable data={trialBalance.accounts || []} columns={tbCols} emptyMessage='No entries for this period/type.' />
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
                    <StmtCard title='Consolidated Income Statement'>
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
                      {(incomeStmt.revenue || []).length > 0 ? (
                        <ResponsiveContainer width='100%' height={180}>
                          <PieChart>
                            <Pie data={incomeStmt.revenue} dataKey='amount' nameKey='name' cx='50%' cy='50%' outerRadius={70} label={({ name, percent }: any) => `${name?.slice(0, 12)}: ${(percent * 100).toFixed(0)}%`}>
                              {(incomeStmt.revenue || []).map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                            </Pie>
                            <Tooltip formatter={(v: number) => fmt(v)} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : <p style={{ padding: '20px', color: '#9ca3af', textAlign: 'center' }}>No revenue data posted yet.</p>}
                    </StmtCard>
                  </div>
                </div>
              ) : <p style={{ color: '#9ca3af' }}>Select a period and post journal entries to see the income statement.</p>}
            </div>
          )}

          {/* ── BALANCE SHEET ─────────────────────────────────────── */}
          {activeTab === 'balance-sheet' && (
            <div>
              <SectionHeader icon={Building2} title='Balance Sheet' sub="Assets = Liabilities + Owner's Equity" />

              <PeriodBar />
              {balanceSheet ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <StmtCard title='ASSETS'>
                    <StmtRow label='CURRENT ASSETS' value='' bold />
                    {(balanceSheet.assets || []).filter((a: any) => ['1010', '1020', '1021', '1030', '1031'].includes(a.code)).map((a: any) => (
                      <StmtRow key={a.id} label={a.account_name} value={fmt(a.balance)} indent={1} />
                    ))}
                    <StmtRow label='FIXED ASSETS' value='' bold />
                    {(balanceSheet.assets || []).filter((a: any) => ['1500', '1501', '1600', '1601'].includes(a.code)).map((a: any) => (
                      <StmtRow key={a.id} label={a.account_name} value={a.code === '1501' ? `(${fmt(Math.abs(a.balance))})` : fmt(a.balance)} indent={1} color={a.code === '1501' ? RED : '#374151'} />
                    ))}
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
                        {balanceSheet.totals?.is_balanced ? '✓ Balance Sheet Balanced' : '✗ Unbalanced — Check Entries'}
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
              {cashFlow ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <StmtCard title='Statement of Cash Flows (Direct Method)'>
                    <StmtRow label='OPERATING ACTIVITIES' value='' bold />
                    {(cashFlow.operating_activities || []).map((a: any, i: number) => (
                      <StmtRow key={i} label={`Cash ${a.reference_type || 'Transaction'}`} value={fmt(a.cash_in - a.cash_out)} indent={1} color={(a.cash_in - a.cash_out) >= 0 ? G : RED} />
                    ))}
                    <StmtRow label='Net Cash from Operations' value={fmt(cashFlow.summary?.net_cash_from_operations || 0)} bold color={G} separator />
                    <StmtRow label='Beginning Cash Balance' value={fmt(0)} indent={1} />
                    <StmtRow label='ENDING CASH BALANCE' value={fmt(cashFlow.summary?.ending_cash_balance || 0)} bold color={G} separator />
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
                  <StmtCard title="Statement of Owner's Equity">
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
              <DataTable data={accounts} columns={coaCols} emptyMessage='No accounts found.' />
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
              <DataTable data={invCounts} columns={invCountCols} emptyMessage='No inventory counts recorded. Conduct a physical count and record it here.' />
            </div>
          )}

          {/* ── DEPRECIATION ──────────────────────────────────────── */}
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
              <DataTable data={depreciation} columns={depCols} emptyMessage='No depreciation records. Add equipment assets and record annual depreciation.' />
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
                Dr: {fmtN(jeLineTotalDr)} | Cr: {fmtN(jeLineTotalCr)} {jeBalanced ? '✓' : '≠'}
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
      <Modal open={!!showJEDetail} onClose={() => setShowJEDetail(null)} title={showJEDetail ? `Entry: ${showJEDetail.entry_number}` : ''} width={680}>
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
            {submitting ? 'Generating...' : '⚡ Generate Closing Entries'}
          </button>
        </div>
      </Modal>

      <Modal open={!!ledgerDrill} onClose={() => setLedgerDrill(null)} title={`General Ledger — ${ledgerDrill?.account?.code || ''} ${ledgerDrill?.account?.account_name || ''}`} width={900}>
        <p style={{ marginTop: 0, color: '#64748b', fontSize: '13px' }}>Posted transaction activity for this account</p>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}><thead><tr>{['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance'].map((label) => <th key={label} style={{ textAlign: label === 'Description' ? 'left' : 'right', padding: '9px', borderBottom: '1px solid #d7e6df', color: '#475569' }}>{label}</th>)}</tr></thead><tbody>{ledgerDrill?.rows.map((row) => <tr key={row.id}><td style={{ padding: '9px' }}>{row.entry_date}</td><td style={{ padding: '9px' }}>{row.entry_number}</td><td style={{ padding: '9px' }}>{row.description}</td><td style={{ padding: '9px', textAlign: 'right', color: G }}>{Number(row.debit_amount) ? fmt(row.debit_amount) : '—'}</td><td style={{ padding: '9px', textAlign: 'right', color: TEAL }}>{Number(row.credit_amount) ? fmt(row.credit_amount) : '—'}</td><td style={{ padding: '9px', textAlign: 'right', fontWeight: 700 }}>{fmt(row.running_balance)}</td></tr>)}</tbody></table></div>
      </Modal>
    </div>
  );
}
