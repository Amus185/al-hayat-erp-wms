import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Loader2, Settings as SettingsIcon } from 'lucide-react';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { Tabs } from '../components/Tabs';
import { InputField, SelectField } from '../components/FormField';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { confirmAction } from '../utils/swal';
import {
  cancelWebRequest, convertWebRequest, getStorefrontSettings, getWebRequest, listWebRequests, saveStorefrontSettings,
  type RequestStatus, type StorefrontSettings, type WebRequestDetail, type WebRequestRow,
} from '../api/storefront';

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString();
const TONE: Record<RequestStatus, 'blue' | 'yellow' | 'green' | 'red'> = { NEW: 'blue', PROCESSING: 'yellow', CONVERTED: 'green', CANCELLED: 'red' };
const LABEL: Record<RequestStatus, string> = { NEW: 'New', PROCESSING: 'Processing', CONVERTED: 'Converted to order', CANCELLED: 'Cancelled' };

type Tab = 'NEW' | 'CONVERTED' | 'CANCELLED' | 'ALL';

export function WebRequestsPage() {
  const { addToast } = useToast();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('NEW');
  const [rows, setRows] = useState<WebRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [detail, setDetail] = useState<WebRequestDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listWebRequests(tab === 'ALL' ? undefined : tab));
      setBlocked(null);
    } catch (err: any) {
      // 403: this user's branch is not the web branch
      if (err?.status === 403) setBlocked(err.message);
      else addToast('error', err?.message || 'Could not load website requests');
    } finally {
      setLoading(false);
    }
  }, [tab, addToast]);

  useEffect(() => { load(); }, [load]);

  const open = async (row: WebRequestRow) => {
    try {
      setDetail(await getWebRequest(row.id));
    } catch (err: any) {
      addToast('error', err?.message || 'Could not open the request');
    }
  };

  const convert = async () => {
    if (!detail) return;
    const ok = await confirmAction(
      'Create a sales order?',
      `${detail.customer_name} (${detail.phone}) — ${money(detail.total_amount)}. A normal sales order is created at the quoted prices. Stock and accounts only move when you complete the sale.`,
      'Create order',
      'question',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await convertWebRequest(detail.id);
      addToast('success', 'Sales order created. Finish the sale under Sales.');
      setDetail(null);
      load();
    } catch (err: any) {
      addToast('error', err?.message || 'Could not create the order');
      load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!detail) return;
    const ok = await confirmAction('Cancel this request?', 'The customer is not notified automatically. Call them if you already spoke.', 'Cancel request', 'warning');
    if (!ok) return;
    setBusy(true);
    try {
      await cancelWebRequest(detail.id);
      addToast('success', 'Request cancelled');
      setDetail(null);
      load();
    } catch (err: any) {
      addToast('error', err?.message || 'Could not cancel the request');
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<WebRequestRow & Record<string, unknown>>[] = [
    { key: 'request_number', label: 'Request', render: (r) => <strong style={{ fontFamily: 'monospace' }}>{r.request_number}</strong> },
    { key: 'customer_name', label: 'Customer', render: (r) => <div><div>{r.customer_name}</div><div style={{ fontSize: '12px', color: '#64748b' }}>{r.phone}</div></div> },
    { key: 'line_count', label: 'Items', render: (r) => String(r.line_count) },
    { key: 'total_amount', label: 'Total', render: (r) => money(r.total_amount) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge label={LABEL[r.status] ?? r.status} tone={TONE[r.status] ?? 'neutral'} /> },
    { key: 'created_at', label: 'Received', render: (r) => when(r.created_at) },
  ];

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon"><Globe size={24} /></div>
        <div>
          <p>Website</p>
          <h2>Order requests from the website</h2>
        </div>
      </section>

      {isAdmin && <StorefrontSettingsCard />}

      {blocked ? (
        <div className="card" style={{ padding: '20px', color: '#64748b' }}>{blocked}</div>
      ) : (
        <>
          <Tabs
            id="web-request-tabs"
            activeTab={tab}
            onTabChange={(k) => setTab(k as Tab)}
            tabs={[{ key: 'NEW', label: 'New' }, { key: 'CONVERTED', label: 'Converted' }, { key: 'CANCELLED', label: 'Cancelled' }, { key: 'ALL', label: 'All' }]}
          />
          <DataTable
            id="web-requests"
            columns={columns}
            data={rows as (WebRequestRow & Record<string, unknown>)[]}
            keyExtractor={(r) => r.id}
            loading={loading}
            emptyMessage={tab === 'NEW' ? 'No new requests. They appear here when a customer sends one from the website.' : 'Nothing here.'}
            onRowClick={(r) => open(r)}
          />
        </>
      )}

      {detail && (
        <Modal isOpen title={`Request ${detail.request_number}`} onClose={() => setDetail(null)} width="lg">
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge label={LABEL[detail.status] ?? detail.status} tone={TONE[detail.status] ?? 'neutral'} />
              <span style={{ fontSize: '12px', color: '#64748b' }}>Received {when(detail.created_at)}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', fontSize: '14px' }}>
              <div><div style={{ fontSize: '11px', color: '#64748b' }}>CUSTOMER</div><strong>{detail.customer_name}</strong></div>
              <div><div style={{ fontSize: '11px', color: '#64748b' }}>PHONE</div><a href={`tel:${detail.phone}`}>{detail.phone}</a></div>
              {detail.email && <div><div style={{ fontSize: '11px', color: '#64748b' }}>EMAIL</div>{detail.email}</div>}
              {(detail.address || detail.city) && <div><div style={{ fontSize: '11px', color: '#64748b' }}>DELIVERY ADDRESS</div>{[detail.address, detail.city].filter(Boolean).join(', ')}</div>}
            </div>
            {detail.notes && <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', fontSize: '13px' }}><strong>Customer note:</strong> {detail.notes}</div>}

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '6px 4px' }}>Product</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Price</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l) => (
                  <tr key={l.product_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '6px 4px' }}>{l.product_name}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{l.quantity}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{money(l.unit_price)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{money(l.quantity * l.unit_price)}</td>
                  </tr>
                ))}
                <tr><td colSpan={3} style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700 }}>Total</td><td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700 }}>{money(detail.total_amount)}</td></tr>
              </tbody>
            </table>
            <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Prices are the ones the customer saw when sending the request.</p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
              {detail.status === 'NEW' && (
                <>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={cancel} style={{ color: '#b91c1c' }}>Cancel request</button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={convert}>
                    {busy && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />} Create sales order
                  </button>
                </>
              )}
              {detail.status === 'CONVERTED' && (
                <button type="button" className="btn btn-primary" onClick={() => navigate('/sales')}>Go to Sales</button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Administrators choose which branch the website sells from, and the stock buffers. */
function StorefrontSettingsCard() {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [locationId, setLocationId] = useState('');
  const [buffer, setBuffer] = useState('0');
  const [low, setLow] = useState('3');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getStorefrontSettings()
      .then((s) => { setSettings(s); setLocationId(s.locationId ?? ''); setBuffer(String(s.safetyBuffer)); setLow(String(s.lowStockThreshold)); })
      .catch((err) => addToast('error', err?.message || 'Could not load website settings'));
  }, [addToast]);

  if (!settings) return null;

  const save = async () => {
    setSaving(true);
    try {
      const body: { locationId?: string; safetyBuffer: number; lowStockThreshold: number } = { safetyBuffer: Number(buffer), lowStockThreshold: Number(low) };
      if (locationId) body.locationId = locationId;
      const saved = await saveStorefrontSettings(body);
      // keep the warnings in step with what was just saved
      setSettings((prev) => (prev ? { ...prev, locationId: saved.locationId, safetyBuffer: saved.safetyBuffer, lowStockThreshold: saved.lowStockThreshold } : prev));
      addToast('success', 'Website settings saved');
    } catch (err: any) {
      addToast('error', err?.message || 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  const problems = [
    !settings.locationId && 'Choose the branch the website sells from. Until then every product shows as out of stock.',
    !settings.imagesConfigured && 'Photo storage is not configured on the server yet, so photos cannot be uploaded.',
    !settings.requestsConfigured && 'The website request key is not set on the server, so customers cannot send requests yet.',
  ].filter(Boolean) as string[];

  return (
    <div className="card" style={{ padding: '16px', display: 'grid', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <SettingsIcon size={16} /> <strong>Website settings</strong>
      </div>
      {problems.map((p) => (
        <div key={p} role="alert" style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#7c4a03', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>{p}</div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <SelectField
          label="Sells from branch"
          id="web-branch"
          value={locationId}
          onChange={setLocationId}
          options={[{ value: '', label: 'Choose a branch…' }, ...settings.branches.map((b) => ({ value: b.id, label: b.name }))]}
        />
        <InputField label="Safety buffer (units held back)" id="web-buffer" type="number" min={0} value={buffer} onChange={setBuffer} />
        <InputField label="Show “low stock” at or below" id="web-low" type="number" min={0} value={low} onChange={setLow} />
      </div>
      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
        The website shows stock of the chosen branch only, minus the safety buffer. Stock held in a warehouse must be transferred to this branch before it can be sold online.
      </p>
      <div><button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button></div>
    </div>
  );
}
