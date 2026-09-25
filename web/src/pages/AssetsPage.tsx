import { useState, useEffect, useCallback } from 'react';
import {
  Landmark, Building2, Users, Coins, Plus,
  Home, Activity, TrendingUp, AlertCircle, Calendar, CreditCard, Beef
} from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
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

  // Modals
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [propertyForm, setPropertyForm] = useState({ name: '', property_type: 'HOUSE', address: '', city: '', area_sqm: '', purchase_price: '', purchase_date: '', current_value: '', notes: '' });

  const [showPropExpenseModal, setShowPropExpenseModal] = useState<{ id: string; name: string } | null>(null);
  const [propExpenseForm, setPropExpenseForm] = useState({ title: '', amount: '', category: 'MAINTENANCE', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'CASH', notes: '' });

  const [showTenantModal, setShowTenantModal] = useState(false);
  const [tenantForm, setTenantForm] = useState({ name: '', phone: '', email: '', id_number: '', address: '' });

  const [showLeaseModal, setShowLeaseModal] = useState(false);
  const [leaseForm, setLeaseForm] = useState({ property_id: '', tenant_id: '', monthly_rent: '', start_date: '', end_date: '', payment_day: '1', deposit_amount: '', notes: '' });

  const [showRentModal, setShowRentModal] = useState(false);
  const [rentForm, setRentForm] = useState({ lease_agreement_id: '', amount: '', payment_method: 'BANK_TRANSFER', payment_date: new Date().toISOString().slice(0, 10), period_month: String(new Date().getMonth() + 1), period_year: String(new Date().getFullYear()), notes: '' });

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

  // Handlers
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

  const handlePropExpenseSubmit = async () => {
    if (!showPropExpenseModal || !propExpenseForm.title || !propExpenseForm.amount) return;
    setSaving(true);
    try {
      await apiPost('/assets/property-expenses', { property_id: showPropExpenseModal.id, ...propExpenseForm });
      addToast('success', 'Property expense recorded');
      setShowPropExpenseModal(null);
      setPropExpenseForm({ title: '', amount: '', category: 'MAINTENANCE', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'CASH', notes: '' });
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleTenantSubmit = async () => {
    if (!tenantForm.name) return;
    setSaving(true);
    try {
      await apiPost('/assets/tenants', tenantForm);
      addToast('success', 'Tenant registered');
      setShowTenantModal(false);
      setTenantForm({ name: '', phone: '', email: '', id_number: '', address: '' });
      loadData();
    } catch { /* */ }
    finally { setSaving(false); }
  };

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

  // Filtering (snake_case from API)
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

  // Column definitions (matching DataTable API: key, label, render)
  const propertyCols: Column<any>[] = [
    { key: 'name', label: 'Name' },
    { key: 'property_type', label: 'Type', render: (p) => <StatusBadge label={p.property_type} tone="neutral" /> },
    { key: 'city', label: 'City' },
    { key: 'area_sqm', label: 'Area (sqm)' },
    { key: 'current_value', label: 'Value', render: (p) => fmt(p.current_value || p.purchase_price) },
    { key: 'status', label: 'Status', render: (p) => <StatusBadge label={p.status} tone={propStatusTone(p.status)} /> },
    { key: 'actions', label: 'Actions', render: (p) => (
      <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); setShowPropExpenseModal({ id: p.id, name: p.name }); }}>Record Expense</button>
    )},
  ];

  const leaseCols: Column<any>[] = [
    { key: 'property_name', label: 'Property' },
    { key: 'tenant_name', label: 'Tenant' },
    { key: 'monthly_rent', label: 'Monthly Rent', render: (l) => fmt(l.monthly_rent) },
    { key: 'start_date', label: 'Start Date' },
    { key: 'end_date', label: 'End Date' },
    { key: 'status', label: 'Status', render: (l) => <StatusBadge label={l.status} tone={l.status === 'ACTIVE' ? 'green' : 'neutral'} /> },
    { key: 'actions', label: 'Actions', render: (l) => (
      l.status === 'ACTIVE' ? (
        <button className="btn btn--sm btn--primary" onClick={() => { setRentForm(p => ({ ...p, lease_agreement_id: l.id, amount: String(l.monthly_rent) })); setShowRentModal(true); }}>Receive Rent</button>
      ) : null
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
    { key: 'phone', label: 'Phone' },
    { key: 'id_number', label: 'ID Number' },
    { key: 'is_active', label: 'Status', render: (t) => <StatusBadge label={t.is_active ? 'ACTIVE' : 'INACTIVE'} tone={t.is_active ? 'green' : 'neutral'} /> },
  ];

  const livestockCols: Column<any>[] = [
    { key: 'tag_number', label: 'Tag / Name', render: (l) => l.tag_number ? `${l.tag_number} ${l.name ? '(' + l.name + ')' : ''}` : (l.name || 'Group') },
    { key: 'animal_type', label: 'Type' },
    { key: 'breed', label: 'Breed' },
    { key: 'quantity', label: 'Qty' },
    { key: 'total_value', label: 'Total Value', render: (l) => fmt(l.total_value) },
    { key: 'status', label: 'Status', render: (l) => <StatusBadge label={l.status} tone={lsStatusTone(l.status)} /> },
    { key: 'actions', label: 'Actions', render: (l) => (
      l.status === 'ACTIVE' ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); setShowLsExpenseModal({ id: l.id, name: l.tag_number || l.animal_type }); }}>Expense</button>
          <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); setShowLsBirthModal({ id: l.id, name: l.tag_number || l.animal_type }); }}>Birth</button>
          <button className="btn btn--sm" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={(e) => { e.stopPropagation(); setShowLsDeathModal({ id: l.id, name: l.tag_number || l.animal_type }); }}>Death</button>
          <button className="btn btn--sm btn--primary" onClick={(e) => { e.stopPropagation(); setShowLsSellModal({ id: l.id, name: l.tag_number || l.animal_type }); }}>Sell</button>
        </div>
      ) : null
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

              <h2 style={{ fontSize: 18, marginBottom: 16, marginTop: 32 }}>Lease Agreements</h2>
              <div style={{ marginBottom: 16, textAlign: 'right' }}>
                <button className="btn btn--primary" onClick={() => setShowLeaseModal(true)}>
                  <Plus size={16} style={{ marginRight: 8 }} /> Create Lease
                </button>
              </div>
              <DataTable data={leases} keyExtractor={(l) => l.id} columns={leaseCols} emptyMessage="No lease agreements yet" />

              <h2 style={{ fontSize: 18, marginBottom: 16, marginTop: 32 }}>Recent Payments</h2>
              <div style={{ marginBottom: 16, textAlign: 'right' }}>
                <button className="btn btn--primary" onClick={() => setShowRentModal(true)}>
                  <CreditCard size={16} style={{ marginRight: 8 }} /> Record Payment
                </button>
              </div>
              <DataTable data={rentalPayments} keyExtractor={(p) => p.id} columns={paymentCols} emptyMessage="No payments recorded yet" />

              <h2 style={{ fontSize: 18, marginBottom: 16, marginTop: 32 }}>Tenants Directory</h2>
              <div style={{ marginBottom: 16, textAlign: 'right' }}>
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

      {/* --- MODALS --- */}

      {/* Register Property */}
      <Modal isOpen={showPropertyModal} onClose={() => setShowPropertyModal(false)} title="Register Property" size="lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField id="prop-name" label="Property Name" value={propertyForm.name} onChange={(v) => setPropertyForm({ ...propertyForm, name: v })} />
          <SelectField id="prop-type" label="Type" value={propertyForm.property_type} onChange={(v) => setPropertyForm({ ...propertyForm, property_type: v })} options={[{ value: 'HOUSE', label: 'House' }, { value: 'LAND', label: 'Land' }, { value: 'BUILDING', label: 'Building' }, { value: 'APARTMENT', label: 'Apartment' }]} />
          <InputField id="prop-city" label="City" value={propertyForm.city} onChange={(v) => setPropertyForm({ ...propertyForm, city: v })} />
          <InputField id="prop-addr" label="Address" value={propertyForm.address} onChange={(v) => setPropertyForm({ ...propertyForm, address: v })} />
          <InputField id="prop-area" label="Area (sqm)" type="number" value={propertyForm.area_sqm} onChange={(v) => setPropertyForm({ ...propertyForm, area_sqm: v })} />
          <InputField id="prop-price" label="Purchase Price" type="number" value={propertyForm.purchase_price} onChange={(v) => setPropertyForm({ ...propertyForm, purchase_price: v })} />
          <InputField id="prop-val" label="Current Value" type="number" value={propertyForm.current_value} onChange={(v) => setPropertyForm({ ...propertyForm, current_value: v })} />
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

      {/* Property Expense */}
      <Modal isOpen={!!showPropExpenseModal} onClose={() => setShowPropExpenseModal(null)} title={`Record Expense: ${showPropExpenseModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <InputField id="pe-title" label="Title" value={propExpenseForm.title} onChange={(v) => setPropExpenseForm({ ...propExpenseForm, title: v })} />
          </div>
          <InputField id="pe-amount" label="Amount" type="number" value={propExpenseForm.amount} onChange={(v) => setPropExpenseForm({ ...propExpenseForm, amount: v })} />
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

      {/* Register Tenant */}
      <Modal isOpen={showTenantModal} onClose={() => setShowTenantModal(false)} title="Register Tenant">
        <div style={{ display: 'grid', gap: 16 }}>
          <InputField id="ten-name" label="Name" value={tenantForm.name} onChange={(v) => setTenantForm({ ...tenantForm, name: v })} />
          <InputField id="ten-phone" label="Phone" value={tenantForm.phone} onChange={(v) => setTenantForm({ ...tenantForm, phone: v })} />
          <InputField id="ten-email" label="Email" type="email" value={tenantForm.email} onChange={(v) => setTenantForm({ ...tenantForm, email: v })} />
          <InputField id="ten-id" label="ID Number" value={tenantForm.id_number} onChange={(v) => setTenantForm({ ...tenantForm, id_number: v })} />
          <TextareaField id="ten-addr" label="Address" value={tenantForm.address} onChange={(v) => setTenantForm({ ...tenantForm, address: v })} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowTenantModal(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleTenantSubmit} disabled={saving || !tenantForm.name}>{saving ? 'Saving...' : 'Register Tenant'}</button>
        </div>
      </Modal>

      {/* Create Lease */}
      <Modal isOpen={showLeaseModal} onClose={() => setShowLeaseModal(false)} title="Create Lease" size="lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <SelectField id="ls-prop" label="Property" value={leaseForm.property_id} onChange={(v) => setLeaseForm({ ...leaseForm, property_id: v })} options={[{ value: '', label: 'Select Property...' }, ...properties.map(p => ({ value: p.id, label: p.name }))]} />
          <SelectField id="ls-tenant" label="Tenant" value={leaseForm.tenant_id} onChange={(v) => setLeaseForm({ ...leaseForm, tenant_id: v })} options={[{ value: '', label: 'Select Tenant...' }, ...tenants.map(t => ({ value: t.id, label: t.name }))]} />
          <InputField id="ls-rent" label="Monthly Rent" type="number" value={leaseForm.monthly_rent} onChange={(v) => setLeaseForm({ ...leaseForm, monthly_rent: v })} />
          <InputField id="ls-dep" label="Deposit Amount" type="number" value={leaseForm.deposit_amount} onChange={(v) => setLeaseForm({ ...leaseForm, deposit_amount: v })} />
          <InputField id="ls-start" label="Start Date" type="date" value={leaseForm.start_date} onChange={(v) => setLeaseForm({ ...leaseForm, start_date: v })} />
          <InputField id="ls-end" label="End Date" type="date" value={leaseForm.end_date} onChange={(v) => setLeaseForm({ ...leaseForm, end_date: v })} />
          <InputField id="ls-day" label="Payment Day (1-28)" type="number" value={leaseForm.payment_day} onChange={(v) => setLeaseForm({ ...leaseForm, payment_day: v })} min={1} />
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField id="ls-notes" label="Notes" value={leaseForm.notes} onChange={(v) => setLeaseForm({ ...leaseForm, notes: v })} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLeaseModal(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLeaseSubmit} disabled={saving || !leaseForm.property_id || !leaseForm.tenant_id || !leaseForm.monthly_rent}>{saving ? 'Saving...' : 'Create Lease'}</button>
        </div>
      </Modal>

      {/* Record Rent Payment */}
      <Modal isOpen={showRentModal} onClose={() => setShowRentModal(false)} title="Record Rent Payment">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <SelectField id="rp-lease" label="Lease Agreement" value={rentForm.lease_agreement_id} onChange={(v) => {
              const l = leases.find((x: any) => x.id === v);
              setRentForm({ ...rentForm, lease_agreement_id: v, amount: l ? String(l.monthly_rent) : '' });
            }} options={[{ value: '', label: 'Select Lease...' }, ...leases.filter((l: any) => l.status === 'ACTIVE').map((l: any) => ({ value: l.id, label: `${l.property_name} - ${l.tenant_name}` }))]} />
          </div>
          <InputField id="rp-amount" label="Amount" type="number" value={rentForm.amount} onChange={(v) => setRentForm({ ...rentForm, amount: v })} />
          <InputField id="rp-date" label="Date" type="date" value={rentForm.payment_date} onChange={(v) => setRentForm({ ...rentForm, payment_date: v })} />
          <InputField id="rp-month" label="Period Month" type="number" value={rentForm.period_month} onChange={(v) => setRentForm({ ...rentForm, period_month: v })} min={1} />
          <InputField id="rp-year" label="Period Year" type="number" value={rentForm.period_year} onChange={(v) => setRentForm({ ...rentForm, period_year: v })} />
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

      {/* Register Livestock */}
      <Modal isOpen={showLivestockModal} onClose={() => setShowLivestockModal(false)} title="Register Livestock" size="lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <SelectField id="lv-type" label="Type" value={livestockForm.animal_type} onChange={(v) => setLivestockForm({ ...livestockForm, animal_type: v })} options={['CATTLE', 'SHEEP', 'GOAT', 'CAMEL', 'POULTRY', 'OTHER'].map(c => ({ value: c, label: c }))} />
          <InputField id="lv-breed" label="Breed" value={livestockForm.breed} onChange={(v) => setLivestockForm({ ...livestockForm, breed: v })} />
          <InputField id="lv-tag" label="Tag Number (optional)" value={livestockForm.tag_number} onChange={(v) => setLivestockForm({ ...livestockForm, tag_number: v })} />
          <InputField id="lv-name" label="Name / Identifier" value={livestockForm.name} onChange={(v) => setLivestockForm({ ...livestockForm, name: v })} />
          <InputField id="lv-qty" label="Quantity" type="number" value={livestockForm.quantity} onChange={(v) => setLivestockForm({ ...livestockForm, quantity: v })} />
          <InputField id="lv-cost" label="Unit Cost" type="number" value={livestockForm.unit_cost} onChange={(v) => setLivestockForm({ ...livestockForm, unit_cost: v })} />
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

      {/* Sell Livestock */}
      <Modal isOpen={!!showLsSellModal} onClose={() => setShowLsSellModal(null)} title={`Sell Livestock: ${showLsSellModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField id="sell-qty" label="Quantity to Sell" type="number" value={lsSellForm.quantity} onChange={(v) => setLsSellForm({ ...lsSellForm, quantity: v })} />
          <InputField id="sell-price" label="Unit Price" type="number" value={lsSellForm.unit_price} onChange={(v) => setLsSellForm({ ...lsSellForm, unit_price: v })} />
          <InputField id="sell-buyer" label="Buyer Name" value={lsSellForm.buyer_seller_name} onChange={(v) => setLsSellForm({ ...lsSellForm, buyer_seller_name: v })} />
          <InputField id="sell-date" label="Date" type="date" value={lsSellForm.transaction_date} onChange={(v) => setLsSellForm({ ...lsSellForm, transaction_date: v })} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField id="sell-notes" label="Notes" value={lsSellForm.notes} onChange={(v) => setLsSellForm({ ...lsSellForm, notes: v })} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsSellModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLsSell} disabled={saving || !lsSellForm.quantity || !lsSellForm.unit_price}>Record Sale</button>
        </div>
      </Modal>

      {/* Birth */}
      <Modal isOpen={!!showLsBirthModal} onClose={() => setShowLsBirthModal(null)} title={`Record Birth: ${showLsBirthModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField id="birth-qty" label="Quantity Born" type="number" value={lsBirthForm.quantity} onChange={(v) => setLsBirthForm({ ...lsBirthForm, quantity: v })} />
          <InputField id="birth-val" label="Estimated Unit Value" type="number" value={lsBirthForm.estimated_unit_value} onChange={(v) => setLsBirthForm({ ...lsBirthForm, estimated_unit_value: v })} />
          <InputField id="birth-date" label="Date" type="date" value={lsBirthForm.transaction_date} onChange={(v) => setLsBirthForm({ ...lsBirthForm, transaction_date: v })} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField id="birth-notes" label="Notes" value={lsBirthForm.notes} onChange={(v) => setLsBirthForm({ ...lsBirthForm, notes: v })} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsBirthModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLsBirth} disabled={saving || !lsBirthForm.quantity}>Record Birth</button>
        </div>
      </Modal>

      {/* Death */}
      <Modal isOpen={!!showLsDeathModal} onClose={() => setShowLsDeathModal(null)} title={`Record Death: ${showLsDeathModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField id="death-qty" label="Quantity Deceased" type="number" value={lsDeathForm.quantity} onChange={(v) => setLsDeathForm({ ...lsDeathForm, quantity: v })} />
          <InputField id="death-date" label="Date" type="date" value={lsDeathForm.transaction_date} onChange={(v) => setLsDeathForm({ ...lsDeathForm, transaction_date: v })} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField id="death-notes" label="Notes" value={lsDeathForm.notes} onChange={(v) => setLsDeathForm({ ...lsDeathForm, notes: v })} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsDeathModal(null)}>Cancel</button>
          <button className="btn btn--danger" onClick={handleLsDeath} disabled={saving || !lsDeathForm.quantity}>Record Death</button>
        </div>
      </Modal>

      {/* Livestock Expense */}
      <Modal isOpen={!!showLsExpenseModal} onClose={() => setShowLsExpenseModal(null)} title={`Record Expense: ${showLsExpenseModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <InputField id="le-title" label="Title" value={lsExpenseForm.title} onChange={(v) => setLsExpenseForm({ ...lsExpenseForm, title: v })} />
          </div>
          <InputField id="le-amount" label="Amount" type="number" value={lsExpenseForm.amount} onChange={(v) => setLsExpenseForm({ ...lsExpenseForm, amount: v })} />
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

    </div>
  );
}
