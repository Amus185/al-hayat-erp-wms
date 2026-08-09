import { useState, useEffect, useCallback } from 'react';
import { Users, Phone, Mail, MapPin, Plus, Search, ShoppingBag, DollarSign, X, Edit2, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { getCached, setCached } from '../api/cache';

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  created_at: string;
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

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6b7280',
  CONFIRMED: '#2563eb',
  INVOICED: '#7c3aed',
  PARTIALLY_PAID: '#d97706',
  PAID: '#059669',
  CANCELLED: '#dc2626',
};

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, SalesOrder[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cacheKey = 'customers:list';
    const cached = getCached<Customer[]>(cacheKey);
    if (cached) {
      // Show stale data instantly, refresh silently in background
      setCustomers(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const data = await apiGet<Customer[]>('/sales/customers');
      const rows = Array.isArray(data) ? data : [];
      setCached(cacheKey, rows);
      setCustomers(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase())
  );

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

  const openCreate = () => {
    setEditCustomer(null);
    setForm({ name: '', phone: '', email: '', address: '' });
    setShowModal(true);
  };

  const openEdit = (c: Customer) => {
    setEditCustomer(c);
    setForm({ name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editCustomer) {
        await apiPatch(`/sales/customers/${editCustomer.id}`, form);
      } else {
        await apiPost('/sales/customers', form);
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await apiDelete(`/sales/customers/${id}`);
    setDeleteConfirm(null);
    load();
  };

  const totalRevenue = customers.reduce((acc, _c) => acc, 0);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#111827' }}>Customers</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '14px' }}>{customers.length} total customers</p>
        </div>
        <button
          onClick={openCreate}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', background: '#0b8f08', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
        >
          <Plus size={16} /> New Customer
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total Customers', value: customers.length, icon: <Users size={20} color="#0b8f08" /> },
          { label: 'Total Revenue', value: `$${totalRevenue.toLocaleString()}`, icon: <DollarSign size={20} color="#7c3aed" /> },
          { label: 'With Orders', value: Object.values(orders).filter(o => o.length > 0).length, icon: <ShoppingBag size={20} color="#2563eb" /> },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ background: '#f0fdf4', borderRadius: '8px', padding: '8px' }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{s.value}</div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: '20px' }}>
        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone, email..."
          style={{ width: '100%', padding: '10px 12px 10px 38px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Customers List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af' }}>Loading customers...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
          <Users size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <p style={{ margin: 0, fontWeight: 500 }}>No customers found</p>
          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>Click "New Customer" to get started</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(customer => {
            const isExpanded = expandedId === customer.id;
            const customerOrders = orders[customer.id] || [];
            const totalSpent = customerOrders.reduce((sum, o) => {
              const net = Math.max(0, (o.invoice_total || 0) - (o.invoice_discount || 0));
              return sum + net;
            }, 0);

            return (
              <div key={customer.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden', transition: 'box-shadow 0.2s' }}>
                {/* Customer Row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px', cursor: 'pointer' }} onClick={() => toggleExpand(customer.id)}>
                  {/* Avatar */}
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '16px', color: '#0b8f08', flexShrink: 0 }}>
                    {customer.name.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#111827', fontSize: '15px' }}>{customer.name}</div>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' }}>
                      {customer.phone && <span style={{ fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}><Phone size={12} />{customer.phone}</span>}
                      {customer.email && <span style={{ fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}><Mail size={12} />{customer.email}</span>}
                      {customer.address && <span style={{ fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={12} />{customer.address}</span>}
                    </div>
                  </div>

                  {/* Stats */}
                  {orders[customer.id] && (
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>${totalSpent.toLocaleString()}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{customerOrders.length} orders</div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => openEdit(customer)} style={{ padding: '6px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center' }} title="Edit">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => setDeleteConfirm(customer.id)} style={{ padding: '6px', border: '1px solid #fee2e2', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Expand arrow */}
                  <div style={{ color: '#9ca3af', flexShrink: 0 }}>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Orders Panel */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #f3f4f6', padding: '16px 20px', background: '#f9fafb' }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order History</h4>
                    {loadingOrders === customer.id ? (
                      <div style={{ color: '#9ca3af', fontSize: '13px' }}>Loading orders...</div>
                    ) : customerOrders.length === 0 ? (
                      <div style={{ color: '#9ca3af', fontSize: '13px' }}>No orders yet</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {customerOrders.map(order => {
                          const net = Math.max(0, (order.invoice_total || 0) - (order.invoice_discount || 0));
                          const balance = Math.max(0, net - (order.amount_paid || 0));
                          return (
                            <div key={order.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0b8f08', fontSize: '13px' }}>{order.order_number}</span>
                              <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '12px', background: `${STATUS_COLORS[order.status] || '#6b7280'}20`, color: STATUS_COLORS[order.status] || '#6b7280', fontWeight: 600 }}>{order.status}</span>
                              {order.branch_name && <span style={{ fontSize: '12px', color: '#9ca3af' }}>{order.branch_name}</span>}
                              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                                {net > 0 && <div style={{ fontWeight: 600, fontSize: '13px', color: '#111827' }}>${net.toLocaleString()}</div>}
                                {balance > 0 && <div style={{ fontSize: '11px', color: '#dc2626' }}>Balance: ${balance.toLocaleString()}</div>}
                              </div>
                              <div style={{ fontSize: '12px', color: '#9ca3af', flexShrink: 0 }}>{new Date(order.created_at).toLocaleDateString()}</div>
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
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', width: '480px', maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontWeight: 700, fontSize: '18px' }}>{editCustomer ? 'Edit Customer' : 'New Customer'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {(['name', 'phone', 'email', 'address'] as const).map(field => (
                <div key={field}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px', textTransform: 'capitalize' }}>
                    {field}{field === 'name' && <span style={{ color: '#dc2626' }}> *</span>}
                  </label>
                  <input
                    value={form[field]}
                    onChange={e => setForm(prev => ({ ...prev, [field]: e.target.value }))}
                    placeholder={field === 'name' ? 'Customer name' : field === 'phone' ? '+966...' : field === 'email' ? 'email@example.com' : 'Full address'}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '10px 18px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff', cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()} style={{ padding: '10px 20px', background: '#0b8f08', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', opacity: saving || !form.name.trim() ? 0.6 : 1 }}>
                {saving ? 'Saving...' : editCustomer ? 'Save Changes' : 'Create Customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', width: '380px', maxWidth: '95vw', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Trash2 size={22} color="#dc2626" />
            </div>
            <h3 style={{ margin: '0 0 8px', fontWeight: 700 }}>Delete Customer?</h3>
            <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: '14px' }}>This will permanently delete this customer. Orders will be kept.</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ padding: '10px 20px', border: '1px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ padding: '10px 20px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
