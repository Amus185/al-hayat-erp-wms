import { useState, useEffect, useCallback } from 'react';
import {
  Landmark, Building2, Users, Coins, Plus,
  Home, Activity, TrendingUp, AlertCircle, Calendar, CreditCard, Beef,
  Eye, Edit, Trash2, CheckCircle2, XCircle, ArrowUpRight
} from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Tabs } from '../components/Tabs';
import { MetricCard } from '../components/MetricCard';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { InputField, SelectField, TextareaField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { PageSkeleton } from '../components/LoadingSpinner';
import { SearchInput } from '../components/SearchInput';

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return '$0.00';
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const clampNonNegative = (val: string) => {
  if (val === '') return '';
  const num = Number(val);
  return isNaN(num) || num < 0 ? '0' : val;
};

const propStatusTone = (s: string) => {
  if (s === 'RENTED') return 'green' as const;
  if (s === 'VACANT') return 'yellow' as const;
  if (s === 'SOLD') return 'red' as const;
  return 'blue' as const;
};

const lsStatusTone = (s: string) => {
  if (s === 'ACTIVE') return 'green' as const;
  if (s === 'DECEASED') return 'red' as const;
  if (s === 'SOLD') return 'yellow' as const;
  return 'neutral' as const;
};

export function AssetsPage() {
  const { isAdmin } = useAuth();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState('properties');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Dashboard
  const [dashboard, setDashboard] = useState<any>(null);

  // Data
  const [properties, setProperties] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [leases, setLeases] = useState<any[]>([]);
  const [rentalPayments, setRentalPayments] = useState<any[]>([]);
  const [livestockList, setLivestockList] = useState<any[]>([]);

  // Modals - Properties
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [propertyForm, setPropertyForm] = useState({ name: '', property_type: 'HOUSE', address: '', city: '', area_sqm: '', purchase_price: '', purchase_date: '', current_value: '', notes: '' });
  const [editProperty, setEditProperty] = useState<any | null>(null);
  const [viewProperty, setViewProperty] = useState<any | null>(null);
  const [loadingPropDetails, setLoadingPropDetails] = useState(false);

  // Modals - Property Expense
  const [showPropExpenseModal, setShowPropExpenseModal] = useState<{ id: string; name: string } | null>(null);
  const [propExpenseForm, setPropExpenseForm] = useState({ title: '', amount: '', category: 'MAINTENANCE', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'CASH', notes: '' });

  // Modals - Tenants
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [showInlineTenantModal, setShowInlineTenantModal] = useState(false);
  const [tenantForm, setTenantForm] = useState({ name: '', phone: '', email: '', id_number: '', address: '' });
  const [editTenant, setEditTenant] = useState<any | null>(null);
  const [viewTenant, setViewTenant] = useState<any | null>(null);
  const [loadingTenantDetails, setLoadingTenantDetails] = useState(false);

  // Modals - Leases
  const [showLeaseModal, setShowLeaseModal] = useState(false);
  const [leaseForm, setLeaseForm] = useState({ property_id: '', tenant_id: '', monthly_rent: '', start_date: '', end_date: '', payment_day: '1', deposit_amount: '', notes: '' });

  // Modals - Rental Payments
  const [showRentModal, setShowRentModal] = useState(false);
  const [rentForm, setRentForm] = useState({ lease_agreement_id: '', amount: '', payment_method: 'BANK_TRANSFER', payment_date: new Date().toISOString().slice(0, 10), period_month: String(new Date().getMonth() + 1), period_year: String(new Date().getFullYear()), notes: '' });

  // Modals - Livestock
  const [showLivestockModal, setShowLivestockModal] = useState(false);
  const [livestockForm, setLivestockForm] = useState({ animal_type: 'CATTLE', breed: '', tag_number: '', name: '', quantity: '1', unit_cost: '', purchase_date: '', notes: '' });
  const [showLsSellModal, setShowLsSellModal] = useState<{ id: string; name: string } | null>(null);
  const [lsSellForm, setLsSellForm] = useState({ quantity: '1', unit_price: '', buyer_seller_name: '', transaction_date: new Date().toISOString().slice(0, 10), notes: '' });
  const [showLsBirthModal, setShowLsBirthModal] = useState<{ id: string; name: string } | null>(null);
  const [lsBirthForm, setLsBirthForm] = useState({ quantity: '1', estimated_unit_value: '', transaction_date: new Date().toISOString().slice(0, 10), notes: '' });
  const [showLsDeathModal, setShowLsDeathModal] = useState<{ id: string; name: string } | null>(null);
  const [lsDeathForm, setLsDeathForm] = useState({ quantity: '1', transaction_date: new Date().toISOString().slice(0, 10), notes: '' });
  const [showLsExpenseModal, setShowLsExpenseModal] = useState<{ id: string; name: string } | null>(null);
  const [lsExpenseForm, setLsExpenseForm] = useState({ title: '', amount: '', category: 'FEED', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'CASH', notes: '' });

  // Generic Confirm Delete Modal
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'property' | 'tenant' | 'lease' | 'livestock' | 'propExpense';
    id: string;
    name: string;
  } | null>(null);

  // Load
  const loadDashboard = useCallback(async () => {
    try {
      const data = await apiGet('/assets/dashboard');
      setDashboard(data);
    } catch { /* api client handles */ }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await loadDashboard();
      if (activeTab === 'properties') {
        const props = await apiGet<any[]>('/assets/properties');
        setProperties(Array.isArray(props) ? props : []);
      } else if (activeTab === 'rentals') {
        const [t, l, r] = await Promise.all([
          apiGet<any[]>('/assets/tenants'),
          apiGet<any[]>('/assets/lease-agreements'),
          apiGet<any[]>('/assets/rental-payments')
        ]);
        setTenants(Array.isArray(t) ? t : []);
        setLeases(Array.isArray(l) ? l : []);
        setRentalPayments(Array.isArray(r) ? r : []);
      } else if (activeTab === 'livestock') {
        const ls = await apiGet<any[]>('/assets/livestock');
        setLivestockList(Array.isArray(ls) ? ls : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, loadDashboard]);

  useEffect(() => { loadData(); setSearch(''); }, [loadData]);

  // Handlers - Properties
  const handlePropSubmit = async () => {
    if (!propertyForm.name || !propertyForm.city) return;
    setSaving(true);
    try {
      await apiPost('/assets/properties', propertyForm);
      addToast('success', 'Property registered successfully');
      setShowPropertyModal(false);
      setPropertyForm({ name: '', property_type: 'HOUSE', address: '', city: '', area_sqm: '', purchase_price: '', purchase_date: '', current_value: '', notes: '' });
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleUpdateProperty = async () => {
    if (!editProperty || !editProperty.name) return;
    setSaving(true);
    try {
      await apiPatch(`/assets/properties/${editProperty.id}`, editProperty);
      addToast('success', 'Property updated successfully');
      setEditProperty(null);
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleViewProperty = async (id: string) => {
    setLoadingPropDetails(true);
    try {
      const data = await apiGet<any>(`/assets/properties/${id}`);
      setViewProperty(data);
    } catch {
      addToast('error', 'Could not load property details');
    } finally {
      setLoadingPropDetails(false);
    }
  };

  // Handlers - Expenses
  const handlePropExpenseSubmit = async () => {
    if (!showPropExpenseModal || !propExpenseForm.title || !propExpenseForm.amount) return;
    setSaving(true);
    try {
      await apiPost('/assets/property-expenses', { property_id: showPropExpenseModal.id, ...propExpenseForm });
      addToast('success', 'Property expense recorded');
      setShowPropExpenseModal(null);
      setPropExpenseForm({ title: '', amount: '', category: 'MAINTENANCE', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'CASH', notes: '' });
      loadData();
      if (viewProperty && viewProperty.id === showPropExpenseModal.id) {
        handleViewProperty(showPropExpenseModal.id);
      }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  // Handlers - Tenants
  const handleTenantSubmit = async (isInline = false) => {
    if (!tenantForm.name) return;
    setSaving(true);
    try {
      const newTenant = await apiPost<any>('/assets/tenants', tenantForm);
      addToast('success', 'Tenant registered');
      setShowTenantModal(false);
      setShowInlineTenantModal(false);
      setTenantForm({ name: '', phone: '', email: '', id_number: '', address: '' });
      if (isInline && newTenant?.id) {
        setTenants(prev => [...prev, newTenant]);
        setLeaseForm(prev => ({ ...prev, tenant_id: newTenant.id }));
      } else {
        loadData();
      }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleUpdateTenant = async () => {
    if (!editTenant || !editTenant.name) return;
    setSaving(true);
    try {
      await apiPatch(`/assets/tenants/${editTenant.id}`, editTenant);
      addToast('success', 'Tenant updated successfully');
      setEditTenant(null);
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleViewTenant = async (id: string) => {
    setLoadingTenantDetails(true);
    try {
      const data = await apiGet<any>(`/assets/tenants/${id}`);
      setViewTenant(data);
    } catch {
      addToast('error', 'Could not load tenant details');
    } finally {
      setLoadingTenantDetails(false);
    }
  };

  // Handlers - Leases
  const handleLeaseSubmit = async () => {
    if (!leaseForm.property_id || !leaseForm.tenant_id || !leaseForm.monthly_rent) return;
    setSaving(true);
    try {
      await apiPost('/assets/lease-agreements', leaseForm);
      addToast('success', 'Lease created successfully');
      setShowLeaseModal(false);
      setLeaseForm({ property_id: '', tenant_id: '', monthly_rent: '', start_date: '', end_date: '', payment_day: '1', deposit_amount: '', notes: '' });
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleTerminateLease = async (id: string, propName: string) => {
    try {
      await apiPatch(`/assets/lease-agreements/${id}`, { status: 'TERMINATED' });
      addToast('success', `Lease for ${propName} terminated. Property is now VACANT.`);
      loadData();
      if (viewProperty) handleViewProperty(viewProperty.id);
    } catch {
      addToast('error', 'Failed to terminate lease');
    }
  };

  // Handlers - Rent Payment
  const handleRentSubmit = async () => {
    if (!rentForm.lease_agreement_id || !rentForm.amount) return;
    setSaving(true);
    try {
      await apiPost('/assets/rental-payments', rentForm);
      addToast('success', 'Rent payment recorded');
      setShowRentModal(false);
      setRentForm(prev => ({ ...prev, lease_agreement_id: '', amount: '', notes: '' }));
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  // Handlers - Deletes
  const handleExecuteDelete = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      if (confirmDelete.type === 'property') {
        await apiDelete(`/assets/properties/${confirmDelete.id}`);
        addToast('success', 'Property deleted successfully');
        if (viewProperty?.id === confirmDelete.id) setViewProperty(null);
      } else if (confirmDelete.type === 'tenant') {
        await apiDelete(`/assets/tenants/${confirmDelete.id}`);
        addToast('success', 'Tenant deleted successfully');
        if (viewTenant?.id === confirmDelete.id) setViewTenant(null);
      } else if (confirmDelete.type === 'lease') {
        await apiDelete(`/assets/lease-agreements/${confirmDelete.id}`);
        addToast('success', 'Lease deleted successfully');
        if (viewProperty) handleViewProperty(viewProperty.id);
      } else if (confirmDelete.type === 'livestock') {
        await apiDelete(`/assets/livestock/${confirmDelete.id}`);
        addToast('success', 'Livestock deleted successfully');
      } else if (confirmDelete.type === 'propExpense') {
        await apiDelete(`/assets/property-expenses/${confirmDelete.id}`);
        addToast('success', 'Expense deleted');
        if (viewProperty) handleViewProperty(viewProperty.id);
      }
      setConfirmDelete(null);
      loadData();
    } catch {
      addToast('error', 'Delete operation failed');
    } finally {
      setSaving(false);
    }
  };

  // Handlers - Livestock
  const handleLivestockSubmit = async () => {
    if (!livestockForm.quantity) return;
    setSaving(true);
    try {
      await apiPost('/assets/livestock', livestockForm);
      addToast('success', 'Livestock registered');
      setShowLivestockModal(false);
      setLivestockForm({ animal_type: 'CATTLE', breed: '', tag_number: '', name: '', quantity: '1', unit_cost: '', purchase_date: '', notes: '' });
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleLsSell = async () => {
    if (!showLsSellModal || !lsSellForm.quantity || !lsSellForm.unit_price) return;
    setSaving(true);
    try {
      await apiPost(`/assets/livestock/${showLsSellModal.id}/sell`, lsSellForm);
      addToast('success', 'Sale recorded');
      setShowLsSellModal(null);
      setLsSellForm({ quantity: '1', unit_price: '', buyer_seller_name: '', transaction_date: new Date().toISOString().slice(0, 10), notes: '' });
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleLsBirth = async () => {
    if (!showLsBirthModal || !lsBirthForm.quantity) return;
    setSaving(true);
    try {
      await apiPost(`/assets/livestock/${showLsBirthModal.id}/birth`, lsBirthForm);
      addToast('success', 'Birth recorded');
      setShowLsBirthModal(null);
      setLsBirthForm({ quantity: '1', estimated_unit_value: '', transaction_date: new Date().toISOString().slice(0, 10), notes: '' });
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleLsDeath = async () => {
    if (!showLsDeathModal || !lsDeathForm.quantity) return;
    setSaving(true);
    try {
      await apiPost(`/assets/livestock/${showLsDeathModal.id}/death`, lsDeathForm);
      addToast('success', 'Death recorded');
      setShowLsDeathModal(null);
      setLsDeathForm({ quantity: '1', transaction_date: new Date().toISOString().slice(0, 10), notes: '' });
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleLsExpense = async () => {
    if (!showLsExpenseModal || !lsExpenseForm.title || !lsExpenseForm.amount) return;
    setSaving(true);
    try {
      await apiPost('/assets/livestock-expenses', { livestock_id: showLsExpenseModal.id, ...lsExpenseForm });
      addToast('success', 'Livestock expense recorded');
      setShowLsExpenseModal(null);
      setLsExpenseForm({ title: '', amount: '', category: 'FEED', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'CASH', notes: '' });
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  // Filter
  const filteredProperties = properties.filter(p =>
    (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.address || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.city || '').toLowerCase().includes(search.toLowerCase())
  );

  const filteredLivestock = livestockList.filter(l =>
    (l.tag_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (l.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (l.animal_type || '').toLowerCase().includes(search.toLowerCase())
  );

  if (!isAdmin) {
    return <div style={{ padding: 24, textAlign: 'center' }}>Access Denied</div>;
  }

  // Column definitions
  const propertyCols: Column<any>[] = [
    { key: 'name', label: 'Name' },
    { key: 'property_type', label: 'Type', render: (p) => <StatusBadge label={p.property_type} tone="neutral" /> },
    { key: 'city', label: 'City' },
    { key: 'area_sqm', label: 'Area (sqm)', render: (p) => p.area_sqm ? `${p.area_sqm} m²` : '—' },
    { key: 'current_value', label: 'Value', render: (p) => fmt(p.current_value || p.purchase_price) },
    { key: 'status', label: 'Status', render: (p) => <StatusBadge label={p.status} tone={propStatusTone(p.status)} /> },
    { key: 'actions', label: 'Actions', render: (p) => (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          className="btn btn--sm"
          title="View Details"
          onClick={(e) => { e.stopPropagation(); handleViewProperty(p.id); }}
        >
          <Eye size={13} style={{ marginRight: 4 }} /> View
        </button>
        <button
          className="btn btn--sm"
          title="Edit Property"
          onClick={(e) => { e.stopPropagation(); setEditProperty({ ...p }); }}
        >
          <Edit size={13} style={{ marginRight: 4 }} /> Edit
        </button>
        <button
          className="btn btn--sm"
          title="Record Expense"
          onClick={(e) => { e.stopPropagation(); setShowPropExpenseModal({ id: p.id, name: p.name }); }}
        >
          Expense
        </button>
        <button
          className="btn btn--sm"
          style={{ color: '#dc2626', borderColor: '#fca5a5' }}
          title="Delete Property"
          onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: 'property', id: p.id, name: p.name }); }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    )},
  ];

  const leaseCols: Column<any>[] = [
    { key: 'property_name', label: 'Property' },
    { key: 'tenant_name', label: 'Tenant' },
    { key: 'monthly_rent', label: 'Monthly Rent', render: (l) => fmt(l.monthly_rent) },
    { key: 'deposit_amount', label: 'Deposit', render: (l) => fmt(l.deposit_amount) },
    { key: 'start_date', label: 'Start Date' },
    { key: 'end_date', label: 'End Date' },
    { key: 'status', label: 'Status', render: (l) => <StatusBadge label={l.status} tone={l.status === 'ACTIVE' ? 'green' : 'neutral'} /> },
    { key: 'actions', label: 'Actions', render: (l) => (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {l.status === 'ACTIVE' && (
          <>
            <button
              className="btn btn--sm btn--primary"
              onClick={() => { setRentForm(p => ({ ...p, lease_agreement_id: l.id, amount: String(l.monthly_rent) })); setShowRentModal(true); }}
            >
              Receive Rent
            </button>
            <button
              className="btn btn--sm"
              style={{ color: '#d97706', borderColor: '#fcd34d' }}
              title="Terminate Lease"
              onClick={() => handleTerminateLease(l.id, l.property_name)}
            >
              Terminate
            </button>
          </>
        )}
        <button
          className="btn btn--sm"
          style={{ color: '#dc2626', borderColor: '#fca5a5' }}
          title="Delete Lease"
          onClick={() => setConfirmDelete({ type: 'lease', id: l.id, name: `Lease for ${l.property_name}` })}
        >
          <Trash2 size={13} />
        </button>
      </div>
    )},
  ];

  const paymentCols: Column<any>[] = [
    { key: 'payment_date', label: 'Date' },
    { key: 'property_name', label: 'Property' },
    { key: 'tenant_name', label: 'Tenant' },
    { key: 'amount', label: 'Amount', render: (p) => fmt(p.amount) },
    { key: 'period', label: 'Period', render: (p) => `${p.period_month}/${p.period_year}` },
    { key: 'payment_method', label: 'Method', render: (p) => (p.payment_method || '').replace(/_/g, ' ') },
  ];

  const tenantCols: Column<any>[] = [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone', render: (t) => t.phone || '—' },
    { key: 'email', label: 'Email', render: (t) => t.email || '—' },
    { key: 'id_number', label: 'ID Number', render: (t) => t.id_number || '—' },
    { key: 'is_active', label: 'Status', render: (t) => <StatusBadge label={t.is_active ? 'ACTIVE' : 'INACTIVE'} tone={t.is_active ? 'green' : 'neutral'} /> },
    { key: 'actions', label: 'Actions', render: (t) => (
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn btn--sm"
          title="View Tenant Details"
          onClick={() => handleViewTenant(t.id)}
        >
          <Eye size={13} style={{ marginRight: 4 }} /> Details
        </button>
        <button
          className="btn btn--sm"
          title="Edit Tenant"
          onClick={() => setEditTenant({ ...t })}
        >
          <Edit size={13} style={{ marginRight: 4 }} /> Edit
        </button>
        <button
          className="btn btn--sm"
          style={{ color: '#dc2626', borderColor: '#fca5a5' }}
          title="Delete Tenant"
          onClick={() => setConfirmDelete({ type: 'tenant', id: t.id, name: t.name })}
        >
          <Trash2 size={13} />
        </button>
      </div>
    )},
  ];

  const livestockCols: Column<any>[] = [
    { key: 'tag_number', label: 'Tag / Name', render: (l) => l.tag_number ? `${l.tag_number} ${l.name ? '(' + l.name + ')' : ''}` : (l.name || 'Group') },
    { key: 'animal_type', label: 'Type' },
    { key: 'breed', label: 'Breed' },
    { key: 'quantity', label: 'Qty' },
    { key: 'total_value', label: 'Total Value', render: (l) => fmt(l.total_value) },
    { key: 'status', label: 'Status', render: (l) => <StatusBadge label={l.status} tone={lsStatusTone(l.status)} /> },
    { key: 'actions', label: 'Actions', render: (l) => (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {l.status === 'ACTIVE' && (
          <>
            <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); setShowLsExpenseModal({ id: l.id, name: l.tag_number || l.animal_type }); }}>Expense</button>
            <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); setShowLsBirthModal({ id: l.id, name: l.tag_number || l.animal_type }); }}>Birth</button>
            <button className="btn btn--sm" style={{ color: '#dc2626', borderColor: '#fca5a5' }} onClick={(e) => { e.stopPropagation(); setShowLsDeathModal({ id: l.id, name: l.tag_number || l.animal_type }); }}>Death</button>
            <button className="btn btn--sm btn--primary" onClick={(e) => { e.stopPropagation(); setShowLsSellModal({ id: l.id, name: l.tag_number || l.animal_type }); }}>Sell</button>
          </>
        )}
        <button
          className="btn btn--sm"
          style={{ color: '#dc2626', borderColor: '#fca5a5' }}
          title="Delete Livestock"
          onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: 'livestock', id: l.id, name: l.tag_number || l.name || l.animal_type }); }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    )},
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <h1 className="page-title">Owner's Assets & Investments</h1>
      </div>

      <Tabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          { key: 'properties', label: 'Properties' },
          { key: 'rentals', label: 'Rentals & Leases' },
          { key: 'livestock', label: 'Livestock' }
        ]}
      />

      {loading && !dashboard ? (
        <PageSkeleton />
      ) : (
        <div style={{ marginTop: 24 }}>
          {/* PROPERTIES TAB */}
          {activeTab === 'properties' && (
            <>
              <div className="metric-grid" style={{ marginBottom: 24 }}>
                <MetricCard label="Total Properties" value={String(properties.length)} icon={<Building2 size={24} />} />
                <MetricCard label="Total Value" value={fmt(dashboard?.total_property_value)} icon={<Landmark size={24} />} />
                <MetricCard label="Rented" value={String(properties.filter(p => p.status === 'RENTED').length)} icon={<Home size={24} />} />
                <MetricCard label="Vacant" value={String(properties.filter(p => p.status === 'VACANT').length)} icon={<AlertCircle size={24} />} />
              </div>

              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ width: 300 }}>
                  <SearchInput value={search} onChange={setSearch} placeholder="Search properties..." />
                </div>
                <button className="btn btn--primary" onClick={() => setShowPropertyModal(true)} style={{ marginLeft: 'auto' }}>
                  <Plus size={16} style={{ marginRight: 8 }} /> Register Property
                </button>
              </div>

              <DataTable
                data={filteredProperties}
                keyExtractor={(p) => p.id}
                columns={propertyCols}
                emptyMessage="No properties registered yet"
              />
            </>
          )}

          {/* RENTALS TAB */}
          {activeTab === 'rentals' && (
            <>
              <div className="metric-grid" style={{ marginBottom: 24 }}>
                <MetricCard label="Active Leases" value={String(leases.filter(l => l.status === 'ACTIVE').length)} icon={<Users size={24} />} />
                <MetricCard label="Expected Rent (Mo)" value={fmt(dashboard?.monthly_rental_expected)} icon={<Calendar size={24} />} />
                <MetricCard label="Collected This Month" value={fmt(dashboard?.monthly_rental_collected)} icon={<Coins size={24} />} />
                <MetricCard label="Overdue Amount" value={fmt((dashboard?.monthly_rental_expected || 0) - (dashboard?.monthly_rental_collected || 0))} icon={<AlertCircle size={24} />} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, margin: 0 }}>Lease Agreements</h2>
                <button className="btn btn--primary" onClick={() => setShowLeaseModal(true)}>
                  <Plus size={16} style={{ marginRight: 8 }} /> Create Lease
                </button>
              </div>
              <DataTable data={leases} keyExtractor={(l) => l.id} columns={leaseCols} emptyMessage="No lease agreements yet" />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, margin: 0 }}>Recent Payments</h2>
                <button className="btn btn--primary" onClick={() => setShowRentModal(true)}>
                  <CreditCard size={16} style={{ marginRight: 8 }} /> Record Payment
                </button>
              </div>
              <DataTable data={rentalPayments} keyExtractor={(p) => p.id} columns={paymentCols} emptyMessage="No payments recorded yet" />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, margin: 0 }}>Tenants Directory</h2>
                <button className="btn btn--primary" onClick={() => setShowTenantModal(true)}>
                  <Plus size={16} style={{ marginRight: 8 }} /> Register Tenant
                </button>
              </div>
              <DataTable data={tenants} keyExtractor={(t) => t.id} columns={tenantCols} emptyMessage="No tenants registered yet" />
            </>
          )}

          {/* LIVESTOCK TAB */}
          {activeTab === 'livestock' && (
            <>
              <div className="metric-grid" style={{ marginBottom: 24 }}>
                <MetricCard label="Total Head Count" value={String(livestockList.reduce((s, l) => s + (l.quantity || 0), 0))} icon={<Beef size={24} />} />
                <MetricCard label="Total Value" value={fmt(dashboard?.total_livestock_value)} icon={<Landmark size={24} />} />
                <MetricCard label="Active Animals" value={String(livestockList.filter(l => l.status === 'ACTIVE').length)} icon={<Activity size={24} />} />
                <MetricCard label="Revenue This Year" value={fmt(dashboard?.livestock_revenue_ytd)} icon={<TrendingUp size={24} />} />
              </div>

              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ width: 300 }}>
                  <SearchInput value={search} onChange={setSearch} placeholder="Search by tag, name, type..." />
                </div>
                <button className="btn btn--primary" onClick={() => setShowLivestockModal(true)} style={{ marginLeft: 'auto' }}>
                  <Plus size={16} style={{ marginRight: 8 }} /> Register Livestock
                </button>
              </div>

              <DataTable
                data={filteredLivestock}
                keyExtractor={(l) => l.id}
                columns={livestockCols}
                emptyMessage="No livestock registered yet"
              />
            </>
          )}
        </div>
      )}

      {/* ── MODALS ────────────────────────────────────────── */}

      {/* 1. Register Property */}
      <Modal isOpen={showPropertyModal} onClose={() => setShowPropertyModal(false)} title="Register Property" size="lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField id="prop-name" label="Property Name" value={propertyForm.name} onChange={(v) => setPropertyForm({ ...propertyForm, name: v })} required />
          <SelectField id="prop-type" label="Type" value={propertyForm.property_type} onChange={(v) => setPropertyForm({ ...propertyForm, property_type: v })} options={[{ value: 'HOUSE', label: 'House' }, { value: 'LAND', label: 'Land' }, { value: 'BUILDING', label: 'Building' }, { value: 'APARTMENT', label: 'Apartment' }]} />
          <InputField id="prop-city" label="City" value={propertyForm.city} onChange={(v) => setPropertyForm({ ...propertyForm, city: v })} required />
          <InputField id="prop-addr" label="Address" value={propertyForm.address} onChange={(v) => setPropertyForm({ ...propertyForm, address: v })} />
          <InputField id="prop-area" label="Area (sqm)" type="number" min={0} value={propertyForm.area_sqm} onChange={(v) => setPropertyForm({ ...propertyForm, area_sqm: clampNonNegative(v) })} />
          <InputField id="prop-price" label="Purchase Price ($)" type="number" min={0} value={propertyForm.purchase_price} onChange={(v) => setPropertyForm({ ...propertyForm, purchase_price: clampNonNegative(v) })} />
          <InputField id="prop-val" label="Current Value ($)" type="number" min={0} value={propertyForm.current_value} onChange={(v) => setPropertyForm({ ...propertyForm, current_value: clampNonNegative(v) })} />
          <InputField id="prop-date" label="Purchase Date" type="date" value={propertyForm.purchase_date} onChange={(v) => setPropertyForm({ ...propertyForm, purchase_date: v })} />
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField id="prop-notes" label="Notes" value={propertyForm.notes} onChange={(v) => setPropertyForm({ ...propertyForm, notes: v })} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowPropertyModal(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handlePropSubmit} disabled={saving || !propertyForm.name || !propertyForm.city}>{saving ? 'Saving...' : 'Register Property'}</button>
        </div>
      </Modal>

      {/* 2. Edit Property Modal */}
      <Modal isOpen={!!editProperty} onClose={() => setEditProperty(null)} title={`Edit Property: ${editProperty?.name}`} size="lg">
        {editProperty && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <InputField id="ep-name" label="Property Name" value={editProperty.name} onChange={(v) => setEditProperty({ ...editProperty, name: v })} required />
              <SelectField id="ep-type" label="Type" value={editProperty.property_type} onChange={(v) => setEditProperty({ ...editProperty, property_type: v })} options={[{ value: 'HOUSE', label: 'House' }, { value: 'LAND', label: 'Land' }, { value: 'BUILDING', label: 'Building' }, { value: 'APARTMENT', label: 'Apartment' }]} />
              <InputField id="ep-city" label="City" value={editProperty.city} onChange={(v) => setEditProperty({ ...editProperty, city: v })} required />
              <InputField id="ep-addr" label="Address" value={editProperty.address || ''} onChange={(v) => setEditProperty({ ...editProperty, address: v })} />
              <InputField id="ep-area" label="Area (sqm)" type="number" min={0} value={editProperty.area_sqm || ''} onChange={(v) => setEditProperty({ ...editProperty, area_sqm: clampNonNegative(v) })} />
              <InputField id="ep-price" label="Purchase Price ($)" type="number" min={0} value={editProperty.purchase_price || ''} onChange={(v) => setEditProperty({ ...editProperty, purchase_price: clampNonNegative(v) })} />
              <InputField id="ep-val" label="Current Value ($)" type="number" min={0} value={editProperty.current_value || ''} onChange={(v) => setEditProperty({ ...editProperty, current_value: clampNonNegative(v) })} />
              <SelectField id="ep-status" label="Status" value={editProperty.status || 'VACANT'} onChange={(v) => setEditProperty({ ...editProperty, status: v })} options={[{ value: 'VACANT', label: 'Vacant' }, { value: 'RENTED', label: 'Rented' }, { value: 'SOLD', label: 'Sold' }]} />
            </div>
            <div style={{ marginTop: 16 }}>
              <TextareaField id="ep-notes" label="Notes" value={editProperty.notes || ''} onChange={(v) => setEditProperty({ ...editProperty, notes: v })} />
            </div>
            <div className="form-actions">
              <button className="btn" onClick={() => setEditProperty(null)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleUpdateProperty} disabled={saving || !editProperty.name || !editProperty.city}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* 3. View Property Details Modal */}
      <Modal isOpen={!!viewProperty} onClose={() => setViewProperty(null)} title={`Property Details: ${viewProperty?.name}`} size="lg">
        {viewProperty && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header badges */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: 14, borderRadius: 8 }}>
              <div>
                <span style={{ fontSize: 13, color: '#64748b' }}>Status: </span>
                <StatusBadge label={viewProperty.status} tone={propStatusTone(viewProperty.status)} />
                <span style={{ marginLeft: 12, fontSize: 13, color: '#64748b' }}>Type: </span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{viewProperty.property_type}</span>
              </div>
              <div>
                <span style={{ fontSize: 13, color: '#64748b' }}>Location: </span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{viewProperty.city} {viewProperty.address ? `• ${viewProperty.address}` : ''}</span>
              </div>
            </div>

            {/* Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <div style={{ background: '#f1f5f9', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Purchase Price</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(viewProperty.purchase_price)}</div>
              </div>
              <div style={{ background: '#f1f5f9', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Current Value</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a' }}>{fmt(viewProperty.current_value)}</div>
              </div>
              <div style={{ background: '#f1f5f9', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Total Expenses</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#dc2626' }}>
                  {fmt((viewProperty.expenses || []).reduce((s: number, e: any) => s + Number(e.amount || 0), 0))}
                </div>
              </div>
              <div style={{ background: '#f1f5f9', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Active Leases</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {(viewProperty.leases || []).filter((l: any) => l.status === 'ACTIVE').length}
                </div>
              </div>
            </div>

            {/* Linked Leases */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>Lease Agreements ({viewProperty.leases?.length || 0})</h3>
              </div>
              {viewProperty.leases?.length === 0 ? (
                <div style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>No lease agreements registered for this property.</div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px' }}>Tenant</th>
                        <th style={{ padding: '8px 12px' }}>Monthly Rent</th>
                        <th style={{ padding: '8px 12px' }}>Dates</th>
                        <th style={{ padding: '8px 12px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewProperty.leases.map((l: any) => (
                        <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{l.tenant_name || 'Tenant'}</td>
                          <td style={{ padding: '8px 12px' }}>{fmt(l.monthly_rent)}</td>
                          <td style={{ padding: '8px 12px', color: '#64748b' }}>{l.start_date || '—'} ➔ {l.end_date || 'Ongoing'}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <StatusBadge label={l.status} tone={l.status === 'ACTIVE' ? 'green' : 'neutral'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Linked Expenses */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>Expenses & Maintenance ({viewProperty.expenses?.length || 0})</h3>
                <button
                  className="btn btn--sm"
                  onClick={() => setShowPropExpenseModal({ id: viewProperty.id, name: viewProperty.name })}
                >
                  <Plus size={13} style={{ marginRight: 4 }} /> Add Expense
                </button>
              </div>
              {viewProperty.expenses?.length === 0 ? (
                <div style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>No maintenance or operating expenses logged.</div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 200, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px' }}>Date</th>
                        <th style={{ padding: '8px 12px' }}>Category</th>
                        <th style={{ padding: '8px 12px' }}>Title</th>
                        <th style={{ padding: '8px 12px' }}>Amount</th>
                        <th style={{ padding: '8px 12px' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewProperty.expenses.map((e: any) => (
                        <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px', color: '#64748b' }}>{e.expense_date}</td>
                          <td style={{ padding: '8px 12px' }}><StatusBadge label={e.category} tone="neutral" /></td>
                          <td style={{ padding: '8px 12px', fontWeight: 500 }}>{e.title}</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: '#dc2626' }}>{fmt(e.amount)}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <button
                              className="btn btn--sm"
                              style={{ color: '#dc2626', borderColor: '#fca5a5', padding: '2px 6px' }}
                              onClick={() => setConfirmDelete({ type: 'propExpense', id: e.id, name: e.title })}
                              title="Delete Expense"
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="form-actions" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => setViewProperty(null)}>Close</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 4. Property Expense Modal */}
      <Modal isOpen={!!showPropExpenseModal} onClose={() => setShowPropExpenseModal(null)} title={`Record Expense: ${showPropExpenseModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <InputField id="pe-title" label="Title" value={propExpenseForm.title} onChange={(v) => setPropExpenseForm({ ...propExpenseForm, title: v })} required />
          </div>
          <InputField id="pe-amount" label="Amount ($)" type="number" min={0} value={propExpenseForm.amount} onChange={(v) => setPropExpenseForm({ ...propExpenseForm, amount: clampNonNegative(v) })} required />
          <SelectField id="pe-cat" label="Category" value={propExpenseForm.category} onChange={(v) => setPropExpenseForm({ ...propExpenseForm, category: v })} options={['MAINTENANCE', 'TAX', 'INSURANCE', 'UTILITIES', 'RENOVATION', 'OTHER'].map(c => ({ value: c, label: c }))} />
          <InputField id="pe-date" label="Date" type="date" value={propExpenseForm.expense_date} onChange={(v) => setPropExpenseForm({ ...propExpenseForm, expense_date: v })} />
          <SelectField id="pe-method" label="Payment Method" value={propExpenseForm.payment_method} onChange={(v) => setPropExpenseForm({ ...propExpenseForm, payment_method: v })} options={['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE'].map(c => ({ value: c, label: c.replace(/_/g, ' ') }))} />
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField id="pe-notes" label="Notes" value={propExpenseForm.notes} onChange={(v) => setPropExpenseForm({ ...propExpenseForm, notes: v })} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowPropExpenseModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handlePropExpenseSubmit} disabled={saving || !propExpenseForm.title || !propExpenseForm.amount}>{saving ? 'Saving...' : 'Record Expense'}</button>
        </div>
      </Modal>

      {/* 5. Register Tenant Modal */}
      <Modal isOpen={showTenantModal || showInlineTenantModal} onClose={() => { setShowTenantModal(false); setShowInlineTenantModal(false); }} title="Register Tenant">
        <div style={{ display: 'grid', gap: 16 }}>
          <InputField id="ten-name" label="Name" value={tenantForm.name} onChange={(v) => setTenantForm({ ...tenantForm, name: v })} required />
          <InputField id="ten-phone" label="Phone" value={tenantForm.phone} onChange={(v) => setTenantForm({ ...tenantForm, phone: v })} />
          <InputField id="ten-email" label="Email" type="email" value={tenantForm.email} onChange={(v) => setTenantForm({ ...tenantForm, email: v })} />
          <InputField id="ten-id" label="ID / Passport Number" value={tenantForm.id_number} onChange={(v) => setTenantForm({ ...tenantForm, id_number: v })} />
          <TextareaField id="ten-addr" label="Address" value={tenantForm.address} onChange={(v) => setTenantForm({ ...tenantForm, address: v })} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => { setShowTenantModal(false); setShowInlineTenantModal(false); }}>Cancel</button>
          <button className="btn btn--primary" onClick={() => handleTenantSubmit(showInlineTenantModal)} disabled={saving || !tenantForm.name}>
            {saving ? 'Saving...' : 'Register Tenant'}
          </button>
        </div>
      </Modal>

      {/* 6. Edit Tenant Modal */}
      <Modal isOpen={!!editTenant} onClose={() => setEditTenant(null)} title={`Edit Tenant: ${editTenant?.name}`}>
        {editTenant && (
          <div style={{ display: 'grid', gap: 16 }}>
            <InputField id="et-name" label="Name" value={editTenant.name} onChange={(v) => setEditTenant({ ...editTenant, name: v })} required />
            <InputField id="et-phone" label="Phone" value={editTenant.phone || ''} onChange={(v) => setEditTenant({ ...editTenant, phone: v })} />
            <InputField id="et-email" label="Email" type="email" value={editTenant.email || ''} onChange={(v) => setEditTenant({ ...editTenant, email: v })} />
            <InputField id="et-id" label="ID / Passport Number" value={editTenant.id_number || ''} onChange={(v) => setEditTenant({ ...editTenant, id_number: v })} />
            <SelectField id="et-status" label="Status" value={String(editTenant.is_active ?? 1)} onChange={(v) => setEditTenant({ ...editTenant, is_active: Number(v) })} options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} />
            <TextareaField id="et-addr" label="Address" value={editTenant.address || ''} onChange={(v) => setEditTenant({ ...editTenant, address: v })} />
            <div className="form-actions">
              <button className="btn" onClick={() => setEditTenant(null)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleUpdateTenant} disabled={saving || !editTenant.name}>
                {saving ? 'Saving...' : 'Save Tenant'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 7. View Tenant Details Modal */}
      <Modal isOpen={!!viewTenant} onClose={() => setViewTenant(null)} title={`Tenant Details: ${viewTenant?.name}`} size="lg">
        {viewTenant && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, background: '#f8fafc', padding: 14, borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Phone</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{viewTenant.phone || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Email</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{viewTenant.email || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b' }}>ID / Passport</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{viewTenant.id_number || '—'}</div>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: 15, margin: '0 0 10px 0', fontWeight: 600 }}>Lease Agreements ({viewTenant.leases?.length || 0})</h3>
              {viewTenant.leases?.length === 0 ? (
                <div style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>No leases registered for this tenant.</div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px' }}>Property</th>
                        <th style={{ padding: '8px 12px' }}>Monthly Rent</th>
                        <th style={{ padding: '8px 12px' }}>Dates</th>
                        <th style={{ padding: '8px 12px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewTenant.leases.map((l: any) => (
                        <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{l.property_name || 'Property'}</td>
                          <td style={{ padding: '8px 12px' }}>{fmt(l.monthly_rent)}</td>
                          <td style={{ padding: '8px 12px', color: '#64748b' }}>{l.start_date || '—'} ➔ {l.end_date || 'Ongoing'}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <StatusBadge label={l.status} tone={l.status === 'ACTIVE' ? 'green' : 'neutral'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="form-actions">
              <button className="btn" onClick={() => setViewTenant(null)}>Close</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 8. Create Lease Modal (Strict Non-Negative Validations + Inline Tenant Creation) */}
      <Modal isOpen={showLeaseModal} onClose={() => setShowLeaseModal(false)} title="Create Lease" size="lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <SelectField id="ls-prop" label="Property" value={leaseForm.property_id} onChange={(v) => setLeaseForm({ ...leaseForm, property_id: v })} options={[{ value: '', label: 'Select Property...' }, ...properties.map(p => ({ value: p.id, label: `${p.name} (${p.status})` }))]} required />
          
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <SelectField id="ls-tenant" label="Tenant" value={leaseForm.tenant_id} onChange={(v) => setLeaseForm({ ...leaseForm, tenant_id: v })} options={[{ value: '', label: 'Select Tenant...' }, ...tenants.map(t => ({ value: t.id, label: t.name }))]} required />
              </div>
              <button
                type="button"
                className="btn btn--sm"
                style={{ height: 38, marginBottom: 2, whiteSpace: 'nowrap' }}
                onClick={() => setShowInlineTenantModal(true)}
                title="Register New Tenant"
              >
                <Plus size={13} style={{ marginRight: 2 }} /> New
              </button>
            </div>
          </div>

          <InputField id="ls-rent" label="Monthly Rent ($)" type="number" min={0} value={leaseForm.monthly_rent} onChange={(v) => setLeaseForm({ ...leaseForm, monthly_rent: clampNonNegative(v) })} placeholder="0.00" required />
          <InputField id="ls-dep" label="Deposit Amount ($)" type="number" min={0} value={leaseForm.deposit_amount} onChange={(v) => setLeaseForm({ ...leaseForm, deposit_amount: clampNonNegative(v) })} placeholder="0.00" />
          <InputField id="ls-start" label="Start Date" type="date" value={leaseForm.start_date} onChange={(v) => setLeaseForm({ ...leaseForm, start_date: v })} required />
          <InputField id="ls-end" label="End Date" type="date" value={leaseForm.end_date} onChange={(v) => setLeaseForm({ ...leaseForm, end_date: v })} />
          <InputField id="ls-day" label="Payment Day (1-28)" type="number" min={1} value={leaseForm.payment_day} onChange={(v) => setLeaseForm({ ...leaseForm, payment_day: clampNonNegative(v) })} />
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField id="ls-notes" label="Notes" value={leaseForm.notes} onChange={(v) => setLeaseForm({ ...leaseForm, notes: v })} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLeaseModal(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLeaseSubmit} disabled={saving || !leaseForm.property_id || !leaseForm.tenant_id || !leaseForm.monthly_rent}>{saving ? 'Saving...' : 'Create Lease'}</button>
        </div>
      </Modal>

      {/* 9. Record Rent Payment Modal */}
      <Modal isOpen={showRentModal} onClose={() => setShowRentModal(false)} title="Record Rent Payment">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <SelectField id="rp-lease" label="Lease Agreement" value={rentForm.lease_agreement_id} onChange={(v) => {
              const l = leases.find((x: any) => x.id === v);
              setRentForm({ ...rentForm, lease_agreement_id: v, amount: l ? String(l.monthly_rent) : '' });
            }} options={[{ value: '', label: 'Select Lease...' }, ...leases.filter((l: any) => l.status === 'ACTIVE').map((l: any) => ({ value: l.id, label: `${l.property_name} - ${l.tenant_name}` }))]} required />
          </div>
          <InputField id="rp-amount" label="Amount ($)" type="number" min={0} value={rentForm.amount} onChange={(v) => setRentForm({ ...rentForm, amount: clampNonNegative(v) })} required />
          <InputField id="rp-date" label="Date" type="date" value={rentForm.payment_date} onChange={(v) => setRentForm({ ...rentForm, payment_date: v })} />
          <InputField id="rp-month" label="Period Month" type="number" min={1} value={rentForm.period_month} onChange={(v) => setRentForm({ ...rentForm, period_month: clampNonNegative(v) })} />
          <InputField id="rp-year" label="Period Year" type="number" min={2020} value={rentForm.period_year} onChange={(v) => setRentForm({ ...rentForm, period_year: clampNonNegative(v) })} />
          <div style={{ gridColumn: 'span 2' }}>
            <SelectField id="rp-method" label="Payment Method" value={rentForm.payment_method} onChange={(v) => setRentForm({ ...rentForm, payment_method: v })} options={['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE'].map(c => ({ value: c, label: c.replace(/_/g, ' ') }))} />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField id="rp-notes" label="Notes" value={rentForm.notes} onChange={(v) => setRentForm({ ...rentForm, notes: v })} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowRentModal(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleRentSubmit} disabled={saving || !rentForm.lease_agreement_id || !rentForm.amount}>{saving ? 'Saving...' : 'Record Payment'}</button>
        </div>
      </Modal>

      {/* 10. Register Livestock */}
      <Modal isOpen={showLivestockModal} onClose={() => setShowLivestockModal(false)} title="Register Livestock" size="lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <SelectField id="lv-type" label="Type" value={livestockForm.animal_type} onChange={(v) => setLivestockForm({ ...livestockForm, animal_type: v })} options={['CATTLE', 'SHEEP', 'GOAT', 'CAMEL', 'POULTRY', 'OTHER'].map(c => ({ value: c, label: c }))} />
          <InputField id="lv-breed" label="Breed" value={livestockForm.breed} onChange={(v) => setLivestockForm({ ...livestockForm, breed: v })} />
          <InputField id="lv-tag" label="Tag Number (optional)" value={livestockForm.tag_number} onChange={(v) => setLivestockForm({ ...livestockForm, tag_number: v })} />
          <InputField id="lv-name" label="Name / Identifier" value={livestockForm.name} onChange={(v) => setLivestockForm({ ...livestockForm, name: v })} />
          <InputField id="lv-qty" label="Quantity" type="number" min={1} value={livestockForm.quantity} onChange={(v) => setLivestockForm({ ...livestockForm, quantity: clampNonNegative(v) })} required />
          <InputField id="lv-cost" label="Unit Cost ($)" type="number" min={0} value={livestockForm.unit_cost} onChange={(v) => setLivestockForm({ ...livestockForm, unit_cost: clampNonNegative(v) })} />
          <InputField id="lv-date" label="Purchase Date" type="date" value={livestockForm.purchase_date} onChange={(v) => setLivestockForm({ ...livestockForm, purchase_date: v })} />
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField id="lv-notes" label="Notes" value={livestockForm.notes} onChange={(v) => setLivestockForm({ ...livestockForm, notes: v })} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLivestockModal(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLivestockSubmit} disabled={saving || !livestockForm.quantity}>{saving ? 'Saving...' : 'Register Livestock'}</button>
        </div>
      </Modal>

      {/* 11. Sell Livestock */}
      <Modal isOpen={!!showLsSellModal} onClose={() => setShowLsSellModal(null)} title={`Sell Livestock: ${showLsSellModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField id="sell-qty" label="Quantity to Sell" type="number" min={1} value={lsSellForm.quantity} onChange={(v) => setLsSellForm({ ...lsSellForm, quantity: clampNonNegative(v) })} required />
          <InputField id="sell-price" label="Unit Price ($)" type="number" min={0} value={lsSellForm.unit_price} onChange={(v) => setLsSellForm({ ...lsSellForm, unit_price: clampNonNegative(v) })} required />
          <InputField id="sell-buyer" label="Buyer Name" value={lsSellForm.buyer_seller_name} onChange={(v) => setLsSellForm({ ...lsSellForm, buyer_seller_name: v })} />
          <InputField id="sell-date" label="Date" type="date" value={lsSellForm.transaction_date} onChange={(v) => setLsSellForm({ ...lsSellForm, transaction_date: v })} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField id="sell-notes" label="Notes" value={lsSellForm.notes} onChange={(v) => setLsSellForm({ ...lsSellForm, notes: v })} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsSellModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLsSell} disabled={saving || !lsSellForm.quantity || !lsSellForm.unit_price}>Record Sale</button>
        </div>
      </Modal>

      {/* 12. Birth */}
      <Modal isOpen={!!showLsBirthModal} onClose={() => setShowLsBirthModal(null)} title={`Record Birth: ${showLsBirthModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField id="birth-qty" label="Quantity Born" type="number" min={1} value={lsBirthForm.quantity} onChange={(v) => setLsBirthForm({ ...lsBirthForm, quantity: clampNonNegative(v) })} required />
          <InputField id="birth-val" label="Estimated Unit Value ($)" type="number" min={0} value={lsBirthForm.estimated_unit_value} onChange={(v) => setLsBirthForm({ ...lsBirthForm, estimated_unit_value: clampNonNegative(v) })} />
          <InputField id="birth-date" label="Date" type="date" value={lsBirthForm.transaction_date} onChange={(v) => setLsBirthForm({ ...lsBirthForm, transaction_date: v })} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField id="birth-notes" label="Notes" value={lsBirthForm.notes} onChange={(v) => setLsBirthForm({ ...lsBirthForm, notes: v })} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsBirthModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLsBirth} disabled={saving || !lsBirthForm.quantity}>Record Birth</button>
        </div>
      </Modal>

      {/* 13. Death */}
      <Modal isOpen={!!showLsDeathModal} onClose={() => setShowLsDeathModal(null)} title={`Record Death: ${showLsDeathModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField id="death-qty" label="Quantity Deceased" type="number" min={1} value={lsDeathForm.quantity} onChange={(v) => setLsDeathForm({ ...lsDeathForm, quantity: clampNonNegative(v) })} required />
          <InputField id="death-date" label="Date" type="date" value={lsDeathForm.transaction_date} onChange={(v) => setLsDeathForm({ ...lsDeathForm, transaction_date: v })} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField id="death-notes" label="Notes" value={lsDeathForm.notes} onChange={(v) => setLsDeathForm({ ...lsDeathForm, notes: v })} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsDeathModal(null)}>Cancel</button>
          <button className="btn btn--danger" onClick={handleLsDeath} disabled={saving || !lsDeathForm.quantity}>Record Death</button>
        </div>
      </Modal>

      {/* 14. Livestock Expense */}
      <Modal isOpen={!!showLsExpenseModal} onClose={() => setShowLsExpenseModal(null)} title={`Record Expense: ${showLsExpenseModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <InputField id="le-title" label="Title" value={lsExpenseForm.title} onChange={(v) => setLsExpenseForm({ ...lsExpenseForm, title: v })} required />
          </div>
          <InputField id="le-amount" label="Amount ($)" type="number" min={0} value={lsExpenseForm.amount} onChange={(v) => setLsExpenseForm({ ...lsExpenseForm, amount: clampNonNegative(v) })} required />
          <SelectField id="le-cat" label="Category" value={lsExpenseForm.category} onChange={(v) => setLsExpenseForm({ ...lsExpenseForm, category: v })} options={['FEED', 'VETERINARY', 'SHELTER', 'TRANSPORT', 'LABOR', 'OTHER'].map(c => ({ value: c, label: c }))} />
          <InputField id="le-date" label="Date" type="date" value={lsExpenseForm.expense_date} onChange={(v) => setLsExpenseForm({ ...lsExpenseForm, expense_date: v })} />
          <SelectField id="le-method" label="Payment Method" value={lsExpenseForm.payment_method} onChange={(v) => setLsExpenseForm({ ...lsExpenseForm, payment_method: v })} options={['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE'].map(c => ({ value: c, label: c.replace(/_/g, ' ') }))} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField id="le-notes" label="Notes" value={lsExpenseForm.notes} onChange={(v) => setLsExpenseForm({ ...lsExpenseForm, notes: v })} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsExpenseModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLsExpense} disabled={saving || !lsExpenseForm.title || !lsExpenseForm.amount}>Record Expense</button>
        </div>
      </Modal>

      {/* 15. Generic Confirm Delete Modal */}
      <Modal isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Confirm Deletion">
        {confirmDelete && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 14, color: '#334155' }}>
              Are you sure you want to permanently delete <strong>{confirmDelete.name}</strong>?
            </p>
            {confirmDelete.type === 'property' && (
              <p style={{ margin: 0, fontSize: 13, color: '#dc2626', background: '#fee2e2', padding: 10, borderRadius: 6 }}>
                ⚠️ Warning: Deleting this property will also remove all associated lease agreements, rental payments, and property expenses.
              </p>
            )}
            {confirmDelete.type === 'tenant' && (
              <p style={{ margin: 0, fontSize: 13, color: '#dc2626', background: '#fee2e2', padding: 10, borderRadius: 6 }}>
                ⚠️ Warning: Deleting this tenant will also remove their associated lease agreements and rental records.
              </p>
            )}
            <div className="form-actions">
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={handleExecuteDelete} disabled={saving}>
                {saving ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
