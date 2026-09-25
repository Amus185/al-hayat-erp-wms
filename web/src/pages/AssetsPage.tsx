import { useState, useEffect, useCallback } from 'react';
import {
  Landmark, Building2, Users, Coins, Search, Plus, Filter,
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
import type { 
  Property, Tenant, LeaseAgreement, RentalPayment, PropertyExpense,
  Livestock, LivestockTransaction, LivestockExpense
} from '../types';

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return '$0.00';
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AssetsPage() {
  const { isAdmin } = useAuth();
  const { addToast } = useToast();
  
  const [activeTab, setActiveTab] = useState('properties');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  
  // Dashboard metrics
  const [dashboard, setDashboard] = useState<any>(null);

  // Data states
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [leases, setLeases] = useState<LeaseAgreement[]>([]);
  const [rentalPayments, setRentalPayments] = useState<RentalPayment[]>([]);
  const [livestockList, setLivestockList] = useState<Livestock[]>([]);

  // Modals & form states
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [propertyForm, setPropertyForm] = useState({ name: '', property_type: 'HOUSE', address: '', city: '', area_sqm: '', purchase_price: '', purchase_date: '', current_value: '', notes: '' });

  const [showPropExpenseModal, setShowPropExpenseModal] = useState<{id: string, name: string} | null>(null);
  const [propExpenseForm, setPropExpenseForm] = useState({ title: '', amount: '', category: 'MAINTENANCE', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'CASH', notes: '' });

  const [showTenantModal, setShowTenantModal] = useState(false);
  const [tenantForm, setTenantForm] = useState({ name: '', phone: '', email: '', id_number: '', address: '' });

  const [showLeaseModal, setShowLeaseModal] = useState(false);
  const [leaseForm, setLeaseForm] = useState({ property_id: '', tenant_id: '', monthly_rent: '', start_date: '', end_date: '', payment_day: '1', deposit_amount: '', notes: '' });

  const [showRentModal, setShowRentModal] = useState(false);
  const [rentForm, setRentForm] = useState({ lease_agreement_id: '', amount: '', payment_method: 'BANK_TRANSFER', payment_date: new Date().toISOString().slice(0, 10), period_month: String(new Date().getMonth() + 1), period_year: String(new Date().getFullYear()), notes: '' });

  const [showLivestockModal, setShowLivestockModal] = useState(false);
  const [livestockForm, setLivestockForm] = useState({ animal_type: 'CATTLE', breed: '', tag_number: '', name: '', quantity: '1', unit_cost: '', purchase_date: '', notes: '' });

  const [showLsSellModal, setShowLsSellModal] = useState<{id: string, name: string} | null>(null);
  const [lsSellForm, setLsSellForm] = useState({ quantity: '1', unit_price: '', buyer_seller_name: '', transaction_date: new Date().toISOString().slice(0, 10), notes: '' });

  const [showLsBirthModal, setShowLsBirthModal] = useState<{id: string, name: string} | null>(null);
  const [lsBirthForm, setLsBirthForm] = useState({ quantity: '1', estimated_unit_value: '', transaction_date: new Date().toISOString().slice(0, 10), notes: '' });

  const [showLsDeathModal, setShowLsDeathModal] = useState<{id: string, name: string} | null>(null);
  const [lsDeathForm, setLsDeathForm] = useState({ quantity: '1', transaction_date: new Date().toISOString().slice(0, 10), notes: '' });

  const [showLsExpenseModal, setShowLsExpenseModal] = useState<{id: string, name: string} | null>(null);
  const [lsExpenseForm, setLsExpenseForm] = useState({ title: '', amount: '', category: 'FEED', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'CASH', notes: '' });

  // Load dashboard
  const loadDashboard = useCallback(async () => {
    try {
      const data = await apiGet('/assets/dashboard');
      setDashboard(data);
    } catch (err) {
      // errors handled by api client
    }
  }, []);

  // Load specific tab data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await loadDashboard();
      if (activeTab === 'properties') {
        const props = await apiGet<Property[]>('/assets/properties');
        setProperties(Array.isArray(props) ? props : []);
      } else if (activeTab === 'rentals') {
        const [t, l, r] = await Promise.all([
          apiGet<Tenant[]>('/assets/tenants'),
          apiGet<LeaseAgreement[]>('/assets/lease-agreements'),
          apiGet<RentalPayment[]>('/assets/rental-payments')
        ]);
        setTenants(Array.isArray(t) ? t : []);
        setLeases(Array.isArray(l) ? l : []);
        setRentalPayments(Array.isArray(r) ? r : []);
      } else if (activeTab === 'livestock') {
        const ls = await apiGet<Livestock[]>('/assets/livestock');
        setLivestockList(Array.isArray(ls) ? ls : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, loadDashboard]);

  useEffect(() => {
    loadData();
    setSearch('');
  }, [loadData]);

  // Actions
  const handlePropSubmit = async () => {
    if (!propertyForm.name || !propertyForm.city) return;
    setSaving(true);
    try {
      await apiPost('/assets/properties', propertyForm);
      addToast('success', 'Property registered successfully');
      setShowPropertyModal(false);
      setPropertyForm({ name: '', property_type: 'HOUSE', address: '', city: '', area_sqm: '', purchase_price: '', purchase_date: '', current_value: '', notes: '' });
      loadData();
    } catch (err) { }
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
    } catch (err) { }
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
    } catch (err) { }
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
    } catch (err) { }
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
    } catch (err) { }
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
    } catch (err) { }
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
    } catch (err) { }
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
    } catch (err) { }
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
    } catch (err) { }
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
    } catch (err) { }
    finally { setSaving(false); }
  };


  // Data filtering
  const filteredProperties = properties.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    (p.address || '').toLowerCase().includes(search.toLowerCase())
  );

  const filteredLivestock = livestockList.filter(l => 
    (l.tagNumber || '').toLowerCase().includes(search.toLowerCase()) ||
    (l.name || '').toLowerCase().includes(search.toLowerCase()) ||
    l.animalType.toLowerCase().includes(search.toLowerCase())
  );

  // Status Badge coloring
  const getPropStatus = (status: string) => {
    if (status === 'RENTED') return 'green';
    if (status === 'VACANT') return 'yellow';
    if (status === 'SOLD') return 'red';
    return 'blue';
  };
  const getLsStatus = (status: string) => {
    if (status === 'ACTIVE') return 'green';
    if (status === 'DECEASED') return 'red';
    if (status === 'SOLD') return 'yellow';
    return 'neutral';
  };

  if (!isAdmin) {
    return <div style={{ padding: 24, textAlign: 'center' }}>Access Denied</div>;
  }

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
                <MetricCard label="Total Properties" value={dashboard?.properties?.totalCount || 0} icon={<Building2 size={24} />} />
                <MetricCard label="Total Value" value={fmt(dashboard?.properties?.totalValue)} icon={<Landmark size={24} />} />
                <MetricCard label="Rented Properties" value={dashboard?.properties?.rentedCount || 0} icon={<Home size={24} />} />
                <MetricCard label="Vacant Properties" value={dashboard?.properties?.vacantCount || 0} icon={<AlertCircle size={24} />} />
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
                keyField="id"
                columns={[
                  { header: 'Name', accessor: 'name' },
                  { header: 'Type', accessor: (p) => <StatusBadge status={p.propertyType} tone="neutral" /> },
                  { header: 'City / Address', accessor: (p) => `${p.city} ${p.address ? '- ' + p.address : ''}` },
                  { header: 'Area (sqm)', accessor: 'areaSqm' },
                  { header: 'Value', accessor: (p) => fmt(p.currentValue || p.purchasePrice) },
                  { header: 'Status', accessor: (p) => <StatusBadge status={p.status} tone={getPropStatus(p.status)} /> },
                  { header: 'Actions', accessor: (p) => (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); setShowPropExpenseModal({id: p.id, name: p.name}) }}>Record Expense</button>
                    </div>
                  )}
                ]}
              />
            </>
          )}

          {/* RENTALS TAB */}
          {activeTab === 'rentals' && (
            <>
              <div className="metric-grid" style={{ marginBottom: 24 }}>
                <MetricCard label="Active Leases" value={dashboard?.rentals?.activeLeases || 0} icon={<Users size={24} />} />
                <MetricCard label="Expected Rent (Mo)" value={fmt(dashboard?.rentals?.monthlyExpected)} icon={<Calendar size={24} />} />
                <MetricCard label="Collected This Month" value={fmt(dashboard?.rentals?.collectedThisMonth)} icon={<Coins size={24} />} />
                <MetricCard label="Overdue Amount" value={fmt(dashboard?.rentals?.overdueAmount)} icon={<AlertCircle size={24} color="#dc2626" />} />
              </div>

              <h2 style={{ fontSize: 18, marginBottom: 16, marginTop: 32 }}>Lease Agreements</h2>
              <div style={{ marginBottom: 16, textAlign: 'right' }}>
                <button className="btn btn--primary" onClick={() => setShowLeaseModal(true)}>
                  <Plus size={16} style={{ marginRight: 8 }} /> Create Lease
                </button>
              </div>
              <DataTable
                data={leases}
                keyField="id"
                columns={[
                  { header: 'Property', accessor: 'propertyName' },
                  { header: 'Tenant', accessor: 'tenantName' },
                  { header: 'Monthly Rent', accessor: (l) => fmt(l.monthlyRent) },
                  { header: 'Start Date', accessor: 'startDate' },
                  { header: 'End Date', accessor: 'endDate' },
                  { header: 'Status', accessor: (l) => <StatusBadge status={l.status} tone={l.status === 'ACTIVE' ? 'green' : 'neutral'} /> },
                  { header: 'Actions', accessor: (l) => (
                    l.status === 'ACTIVE' ? <button className="btn btn--sm btn--primary" onClick={() => { setRentForm(p => ({...p, lease_agreement_id: l.id, amount: String(l.monthlyRent)})); setShowRentModal(true); }}>Receive Rent</button> : null
                  )}
                ]}
              />

              <h2 style={{ fontSize: 18, marginBottom: 16, marginTop: 32 }}>Recent Payments</h2>
              <div style={{ marginBottom: 16, textAlign: 'right' }}>
                <button className="btn btn--primary" onClick={() => setShowRentModal(true)}>
                  <CreditCard size={16} style={{ marginRight: 8 }} /> Record Payment
                </button>
              </div>
              <DataTable
                data={rentalPayments}
                keyField="id"
                columns={[
                  { header: 'Date', accessor: 'paymentDate' },
                  { header: 'Property', accessor: 'propertyName' },
                  { header: 'Tenant', accessor: 'tenantName' },
                  { header: 'Amount', accessor: (p) => fmt(p.amount) },
                  { header: 'Period', accessor: (p) => `${p.periodMonth}/${p.periodYear}` },
                  { header: 'Method', accessor: (p) => p.paymentMethod.replace('_', ' ') }
                ]}
              />

              <h2 style={{ fontSize: 18, marginBottom: 16, marginTop: 32 }}>Tenants Directory</h2>
              <div style={{ marginBottom: 16, textAlign: 'right' }}>
                <button className="btn btn--primary" onClick={() => setShowTenantModal(true)}>
                  <UserPlus size={16} style={{ marginRight: 8 }} /> Register Tenant
                </button>
              </div>
              <DataTable
                data={tenants}
                keyField="id"
                columns={[
                  { header: 'Name', accessor: 'name' },
                  { header: 'Phone', accessor: 'phone' },
                  { header: 'ID Number', accessor: 'idNumber' },
                  { header: 'Status', accessor: (t) => <StatusBadge status={t.isActive ? 'ACTIVE' : 'INACTIVE'} tone={t.isActive ? 'green' : 'neutral'} /> }
                ]}
              />
            </>
          )}

          {/* LIVESTOCK TAB */}
          {activeTab === 'livestock' && (
            <>
              <div className="metric-grid" style={{ marginBottom: 24 }}>
                <MetricCard label="Total Head Count" value={dashboard?.livestock?.headCount || 0} icon={<Beef size={24} />} />
                <MetricCard label="Total Value" value={fmt(dashboard?.livestock?.totalValue)} icon={<Landmark size={24} />} />
                <MetricCard label="Active Animals" value={dashboard?.livestock?.activeCount || 0} icon={<Activity size={24} />} />
                <MetricCard label="Revenue This Year" value={fmt(dashboard?.livestock?.revenueYtd)} icon={<TrendingUp size={24} />} />
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
                keyField="id"
                columns={[
                  { header: 'Tag / Name', accessor: (l) => l.tagNumber ? `${l.tagNumber} ${l.name ? '('+l.name+')' : ''}` : (l.name || 'Group') },
                  { header: 'Type', accessor: 'animalType' },
                  { header: 'Breed', accessor: 'breed' },
                  { header: 'Quantity', accessor: 'quantity' },
                  { header: 'Total Value', accessor: (l) => fmt(l.totalValue) },
                  { header: 'Status', accessor: (l) => <StatusBadge status={l.status} tone={getLsStatus(l.status)} /> },
                  { header: 'Actions', accessor: (l) => (
                    l.status === 'ACTIVE' ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); setShowLsExpenseModal({id: l.id, name: l.tagNumber || l.animalType}) }}>Expense</button>
                        <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); setShowLsBirthModal({id: l.id, name: l.tagNumber || l.animalType}) }}>Birth</button>
                        <button className="btn btn--sm btn--danger" style={{background: '#fff', color: '#dc2626', borderColor: '#dc2626'}} onClick={(e) => { e.stopPropagation(); setShowLsDeathModal({id: l.id, name: l.tagNumber || l.animalType}) }}>Death</button>
                        <button className="btn btn--sm btn--primary" onClick={(e) => { e.stopPropagation(); setShowLsSellModal({id: l.id, name: l.tagNumber || l.animalType}) }}>Sell</button>
                      </div>
                    ) : null
                  )}
                ]}
              />
            </>
          )}
        </div>
      )}

      {/* --- MODALS --- */}

      {/* Register Property */}
      <Modal isOpen={showPropertyModal} onClose={() => setShowPropertyModal(false)} title="Register Property" size="lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField label="Property Name" value={propertyForm.name} onChange={(e) => setPropertyForm({...propertyForm, name: e.target.value})} />
          <SelectField label="Type" value={propertyForm.property_type} onChange={(e) => setPropertyForm({...propertyForm, property_type: e.target.value})} options={[{value:'HOUSE',label:'House'},{value:'LAND',label:'Land'},{value:'BUILDING',label:'Building'},{value:'APARTMENT',label:'Apartment'}]} />
          <InputField label="City" value={propertyForm.city} onChange={(e) => setPropertyForm({...propertyForm, city: e.target.value})} />
          <InputField label="Address" value={propertyForm.address} onChange={(e) => setPropertyForm({...propertyForm, address: e.target.value})} />
          <InputField label="Area (sqm)" type="number" value={propertyForm.area_sqm} onChange={(e) => setPropertyForm({...propertyForm, area_sqm: e.target.value})} />
          <InputField label="Purchase Price" type="number" value={propertyForm.purchase_price} onChange={(e) => setPropertyForm({...propertyForm, purchase_price: e.target.value})} />
          <InputField label="Current Value" type="number" value={propertyForm.current_value} onChange={(e) => setPropertyForm({...propertyForm, current_value: e.target.value})} />
          <InputField label="Purchase Date" type="date" value={propertyForm.purchase_date} onChange={(e) => setPropertyForm({...propertyForm, purchase_date: e.target.value})} />
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField label="Notes" value={propertyForm.notes} onChange={(e) => setPropertyForm({...propertyForm, notes: e.target.value})} />
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
            <InputField label="Title" value={propExpenseForm.title} onChange={(e) => setPropExpenseForm({...propExpenseForm, title: e.target.value})} />
          </div>
          <InputField label="Amount" type="number" value={propExpenseForm.amount} onChange={(e) => setPropExpenseForm({...propExpenseForm, amount: e.target.value})} />
          <SelectField label="Category" value={propExpenseForm.category} onChange={(e) => setPropExpenseForm({...propExpenseForm, category: e.target.value})} options={['MAINTENANCE','TAX','INSURANCE','UTILITIES','RENOVATION','OTHER'].map(c => ({value: c, label: c}))} />
          <InputField label="Date" type="date" value={propExpenseForm.expense_date} onChange={(e) => setPropExpenseForm({...propExpenseForm, expense_date: e.target.value})} />
          <SelectField label="Payment Method" value={propExpenseForm.payment_method} onChange={(e) => setPropExpenseForm({...propExpenseForm, payment_method: e.target.value})} options={['CASH','BANK_TRANSFER','CARD','CHEQUE'].map(c => ({value: c, label: c.replace('_',' ')}))} />
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField label="Notes" value={propExpenseForm.notes} onChange={(e) => setPropExpenseForm({...propExpenseForm, notes: e.target.value})} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowPropExpenseModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handlePropExpenseSubmit} disabled={saving || !propExpenseForm.title || !propExpenseForm.amount}>{saving ? 'Saving...' : 'Record Expense'}</button>
        </div>
      </Modal>

      {/* Register Tenant */}
      <Modal isOpen={showTenantModal} onClose={() => setShowTenantModal(false)} title="Register Tenant">
        <div style={{ display: 'grid', gap: 16 }}>
          <InputField label="Name" value={tenantForm.name} onChange={(e) => setTenantForm({...tenantForm, name: e.target.value})} />
          <InputField label="Phone" value={tenantForm.phone} onChange={(e) => setTenantForm({...tenantForm, phone: e.target.value})} />
          <InputField label="Email" type="email" value={tenantForm.email} onChange={(e) => setTenantForm({...tenantForm, email: e.target.value})} />
          <InputField label="ID Number" value={tenantForm.id_number} onChange={(e) => setTenantForm({...tenantForm, id_number: e.target.value})} />
          <TextareaField label="Address" value={tenantForm.address} onChange={(e) => setTenantForm({...tenantForm, address: e.target.value})} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowTenantModal(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleTenantSubmit} disabled={saving || !tenantForm.name}>{saving ? 'Saving...' : 'Register Tenant'}</button>
        </div>
      </Modal>

      {/* Create Lease */}
      <Modal isOpen={showLeaseModal} onClose={() => setShowLeaseModal(false)} title="Create Lease" size="lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <SelectField label="Property" value={leaseForm.property_id} onChange={(e) => setLeaseForm({...leaseForm, property_id: e.target.value})} options={[{value:'',label:'Select Property...'}, ...properties.map(p => ({value: p.id, label: p.name}))]} />
          <SelectField label="Tenant" value={leaseForm.tenant_id} onChange={(e) => setLeaseForm({...leaseForm, tenant_id: e.target.value})} options={[{value:'',label:'Select Tenant...'}, ...tenants.map(t => ({value: t.id, label: t.name}))]} />
          <InputField label="Monthly Rent" type="number" value={leaseForm.monthly_rent} onChange={(e) => setLeaseForm({...leaseForm, monthly_rent: e.target.value})} />
          <InputField label="Deposit Amount" type="number" value={leaseForm.deposit_amount} onChange={(e) => setLeaseForm({...leaseForm, deposit_amount: e.target.value})} />
          <InputField label="Start Date" type="date" value={leaseForm.start_date} onChange={(e) => setLeaseForm({...leaseForm, start_date: e.target.value})} />
          <InputField label="End Date" type="date" value={leaseForm.end_date} onChange={(e) => setLeaseForm({...leaseForm, end_date: e.target.value})} />
          <InputField label="Payment Day (1-28)" type="number" min="1" max="28" value={leaseForm.payment_day} onChange={(e) => setLeaseForm({...leaseForm, payment_day: e.target.value})} />
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField label="Notes" value={leaseForm.notes} onChange={(e) => setLeaseForm({...leaseForm, notes: e.target.value})} />
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
            <SelectField label="Lease Agreement" value={rentForm.lease_agreement_id} onChange={(e) => {
              const l = leases.find(x => x.id === e.target.value);
              setRentForm({...rentForm, lease_agreement_id: e.target.value, amount: l ? String(l.monthlyRent) : ''});
            }} options={[{value:'',label:'Select Lease...'}, ...leases.filter(l => l.status === 'ACTIVE').map(l => ({value: l.id, label: `${l.propertyName} - ${l.tenantName}`}))]} />
          </div>
          <InputField label="Amount" type="number" value={rentForm.amount} onChange={(e) => setRentForm({...rentForm, amount: e.target.value})} />
          <InputField label="Date" type="date" value={rentForm.payment_date} onChange={(e) => setRentForm({...rentForm, payment_date: e.target.value})} />
          <InputField label="Period Month" type="number" min="1" max="12" value={rentForm.period_month} onChange={(e) => setRentForm({...rentForm, period_month: e.target.value})} />
          <InputField label="Period Year" type="number" value={rentForm.period_year} onChange={(e) => setRentForm({...rentForm, period_year: e.target.value})} />
          <div style={{ gridColumn: 'span 2' }}>
            <SelectField label="Payment Method" value={rentForm.payment_method} onChange={(e) => setRentForm({...rentForm, payment_method: e.target.value})} options={['CASH','BANK_TRANSFER','CARD','CHEQUE'].map(c => ({value: c, label: c.replace('_',' ')}))} />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField label="Notes" value={rentForm.notes} onChange={(e) => setRentForm({...rentForm, notes: e.target.value})} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowRentModal(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleRentSubmit} disabled={saving || !rentForm.lease_agreement_id || !rentForm.amount}>{saving ? 'Saving...' : 'Record Payment'}</button>
        </div>
      </Modal>

      {/* Register Livestock */}
      <Modal isOpen={showLivestockModal} onClose={() => setShowLivestockModal(false)} title="Register Livestock" size="lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <SelectField label="Type" value={livestockForm.animal_type} onChange={(e) => setLivestockForm({...livestockForm, animal_type: e.target.value})} options={['CATTLE','SHEEP','GOAT','CAMEL','POULTRY','OTHER'].map(c => ({value: c, label: c}))} />
          <InputField label="Breed" value={livestockForm.breed} onChange={(e) => setLivestockForm({...livestockForm, breed: e.target.value})} />
          <InputField label="Tag Number (optional)" value={livestockForm.tag_number} onChange={(e) => setLivestockForm({...livestockForm, tag_number: e.target.value})} />
          <InputField label="Name / Identifier" value={livestockForm.name} onChange={(e) => setLivestockForm({...livestockForm, name: e.target.value})} />
          <InputField label="Quantity" type="number" value={livestockForm.quantity} onChange={(e) => setLivestockForm({...livestockForm, quantity: e.target.value})} />
          <InputField label="Unit Cost" type="number" value={livestockForm.unit_cost} onChange={(e) => setLivestockForm({...livestockForm, unit_cost: e.target.value})} />
          <InputField label="Purchase Date" type="date" value={livestockForm.purchase_date} onChange={(e) => setLivestockForm({...livestockForm, purchase_date: e.target.value})} />
        </div>
        <div style={{ marginTop: 16 }}>
          <TextareaField label="Notes" value={livestockForm.notes} onChange={(e) => setLivestockForm({...livestockForm, notes: e.target.value})} />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLivestockModal(false)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLivestockSubmit} disabled={saving || !livestockForm.quantity}>{saving ? 'Saving...' : 'Register Livestock'}</button>
        </div>
      </Modal>

      {/* Livestock Actions Modals */}
      <Modal isOpen={!!showLsSellModal} onClose={() => setShowLsSellModal(null)} title={`Sell Livestock: ${showLsSellModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField label="Quantity to Sell" type="number" value={lsSellForm.quantity} onChange={(e) => setLsSellForm({...lsSellForm, quantity: e.target.value})} />
          <InputField label="Unit Price" type="number" value={lsSellForm.unit_price} onChange={(e) => setLsSellForm({...lsSellForm, unit_price: e.target.value})} />
          <InputField label="Buyer Name" value={lsSellForm.buyer_seller_name} onChange={(e) => setLsSellForm({...lsSellForm, buyer_seller_name: e.target.value})} />
          <InputField label="Date" type="date" value={lsSellForm.transaction_date} onChange={(e) => setLsSellForm({...lsSellForm, transaction_date: e.target.value})} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField label="Notes" value={lsSellForm.notes} onChange={(e) => setLsSellForm({...lsSellForm, notes: e.target.value})} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsSellModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLsSell} disabled={saving || !lsSellForm.quantity || !lsSellForm.unit_price}>Record Sale</button>
        </div>
      </Modal>

      <Modal isOpen={!!showLsBirthModal} onClose={() => setShowLsBirthModal(null)} title={`Record Birth: ${showLsBirthModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField label="Quantity Born" type="number" value={lsBirthForm.quantity} onChange={(e) => setLsBirthForm({...lsBirthForm, quantity: e.target.value})} />
          <InputField label="Estimated Unit Value" type="number" value={lsBirthForm.estimated_unit_value} onChange={(e) => setLsBirthForm({...lsBirthForm, estimated_unit_value: e.target.value})} />
          <InputField label="Date" type="date" value={lsBirthForm.transaction_date} onChange={(e) => setLsBirthForm({...lsBirthForm, transaction_date: e.target.value})} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField label="Notes" value={lsBirthForm.notes} onChange={(e) => setLsBirthForm({...lsBirthForm, notes: e.target.value})} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsBirthModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLsBirth} disabled={saving || !lsBirthForm.quantity}>Record Birth</button>
        </div>
      </Modal>

      <Modal isOpen={!!showLsDeathModal} onClose={() => setShowLsDeathModal(null)} title={`Record Death: ${showLsDeathModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <InputField label="Quantity Deceased" type="number" value={lsDeathForm.quantity} onChange={(e) => setLsDeathForm({...lsDeathForm, quantity: e.target.value})} />
          <InputField label="Date" type="date" value={lsDeathForm.transaction_date} onChange={(e) => setLsDeathForm({...lsDeathForm, transaction_date: e.target.value})} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField label="Notes" value={lsDeathForm.notes} onChange={(e) => setLsDeathForm({...lsDeathForm, notes: e.target.value})} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsDeathModal(null)}>Cancel</button>
          <button className="btn btn--danger" onClick={handleLsDeath} disabled={saving || !lsDeathForm.quantity}>Record Death</button>
        </div>
      </Modal>

      <Modal isOpen={!!showLsExpenseModal} onClose={() => setShowLsExpenseModal(null)} title={`Record Expense: ${showLsExpenseModal?.name}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <InputField label="Title" value={lsExpenseForm.title} onChange={(e) => setLsExpenseForm({...lsExpenseForm, title: e.target.value})} />
          </div>
          <InputField label="Amount" type="number" value={lsExpenseForm.amount} onChange={(e) => setLsExpenseForm({...lsExpenseForm, amount: e.target.value})} />
          <SelectField label="Category" value={lsExpenseForm.category} onChange={(e) => setLsExpenseForm({...lsExpenseForm, category: e.target.value})} options={['FEED','VETERINARY','SHELTER','TRANSPORT','LABOR','OTHER'].map(c => ({value: c, label: c}))} />
          <InputField label="Date" type="date" value={lsExpenseForm.expense_date} onChange={(e) => setLsExpenseForm({...lsExpenseForm, expense_date: e.target.value})} />
          <SelectField label="Payment Method" value={lsExpenseForm.payment_method} onChange={(e) => setLsExpenseForm({...lsExpenseForm, payment_method: e.target.value})} options={['CASH','BANK_TRANSFER','CARD','CHEQUE'].map(c => ({value: c, label: c.replace('_',' ')}))} />
        </div>
        <div style={{ marginTop: 16 }}><TextareaField label="Notes" value={lsExpenseForm.notes} onChange={(e) => setLsExpenseForm({...lsExpenseForm, notes: e.target.value})} /></div>
        <div className="form-actions">
          <button className="btn" onClick={() => setShowLsExpenseModal(null)}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLsExpense} disabled={saving || !lsExpenseForm.title || !lsExpenseForm.amount}>Record Expense</button>
        </div>
      </Modal>

    </div>
  );
}
