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
import { ModalLoading } from '../components/ModalLoading';
import { useLatest } from '../utils/latest';
import { useLiveRefresh } from '../utils/live';
import {
  cancelWebRequest, convertWebRequest, getStorefrontSettings, getWebRequest, listWebRequests, saveStorefrontSettings,
  type StorefrontSettings, type WebOrderStage, type WebRequestDetail, type WebRequestRow,
} from '../api/storefront';

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString();
// One stage per web order, from the request through its sales order and delivery.
const STAGE: Record<WebOrderStage, { label: string; tone: 'blue' | 'yellow' | 'green' | 'red' | 'neutral' }> = {
  NEW: { label: 'New request', tone: 'blue' },
  ORDERED: { label: 'Sales order created', tone: 'yellow' },
  INVOICED: { label: 'Invoiced', tone: 'yellow' },
  PAID: { label: 'Paid', tone: 'green' },
  DELIVERY_SCHEDULED: { label: 'Delivery scheduled', tone: 'yellow' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', tone: 'yellow' },
  DELIVERED: { label: 'Delivered', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};
const stageOf = (s: WebOrderStage | undefined) => STAGE[s ?? 'NEW'] ?? { label: String(s), tone: 'neutral' as const };

type Tab = 'NEW' | 'CONVERTED' | 'CANCELLED' | 'ALL';

/** The web orders inbox. Embedded in the Online store page (its header and settings live there). */
export function WebRequestsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { addToast } = useToast();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('NEW');
  const [rows, setRows] = useState<WebRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [detail, setDetail] = useState<WebRequestDetail | null>(null);
  const [detailRow, setDetailRow] = useState<WebRequestRow | null>(null);
  const detailRequest = useLatest();
  const closeDetail = () => { detailRequest.cancel(); setDetail(null); setDetailRow(null); };
  const [busy, setBusy] = useState(false);

  // quiet: a background refresh (no spinner, no error toast)
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setRows(await listWebRequests(tab === 'ALL' ? undefined : tab));
      setBlocked(null);
    } catch (err: any) {
      if (quiet) return;
      // 403: this user's branch is not the web branch
      if (err?.status === 403) setBlocked(err.message);
      else addToast('error', err?.message || 'Could not load website requests');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [tab, addToast]);

  useEffect(() => { load(); }, [load]);
  // New online orders appear without refreshing the page.
  useLiveRefresh(() => load(true));

  // The window opens at once with the row; its lines load inside it.
  const open = async (row: WebRequestRow) => {
    const isCurrent = detailRequest.start();
    setDetail(null);
    setDetailRow(row);
    try {
      const full = await getWebRequest(row.id);
      if (isCurrent()) setDetail(full);
    } catch (err: any) {
      if (!isCurrent()) return;
      addToast('error', err?.message || 'Could not open the request');
      setDetailRow(null);
    }
  };

  const convert = async () => {
    if (!detail) return;
    const ok = await confirmAction(
      'Create a sales order?',
      `${detail.customer_name} (${detail.phone}) — ${money(detail.total_amount)}. A normal sales order is created at the quoted prices. The stock stays held for it; stock and accounts move when you complete the sale.`,
      'Create order',
      'question',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await convertWebRequest(detail.id);
      addToast('success', 'Sales order created. Finish the sale under Sales.');
      closeDetail();
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
    const ok = await confirmAction('Cancel this request?', 'The held stock goes back on sale. The customer is not notified automatically: call them if you already spoke.', 'Cancel request', 'warning');
    if (!ok) return;
    setBusy(true);
    try {
      await cancelWebRequest(detail.id);
      addToast('success', 'Request cancelled');
      closeDetail();
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
    {
      key: 'stage', label: 'Stage', render: (r) => (
        <div>
          <StatusBadge label={stageOf(r.stage).label} tone={stageOf(r.stage).tone} />
          {r.order_number && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', fontFamily: 'monospace' }}>{r.order_number}</div>}
        </div>
      ),
    },
    { key: 'reserved_units', label: 'Stock held', render: (r) => (r.reserved_units ? `${r.reserved_units} unit${r.reserved_units === 1 ? '' : 's'}` : '—') },
    { key: 'created_at', label: 'Received', render: (r) => when(r.created_at) },
  ];

  return (
    <div className={embedded ? undefined : 'module-page'} style={embedded ? { display: 'grid', gap: '16px' } : undefined}>
      {!embedded && (
        <section className="module-header">
          <div className="module-header__icon"><Globe size={24} /></div>
          <div>
            <p>Website</p>
            <h2>Web orders</h2>
          </div>
        </section>
      )}

      {isAdmin && !embedded && <StorefrontSettingsCard />}

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

      {detailRow && (
        <Modal isOpen title={`Request ${detail?.request_number ?? detailRow.request_number}`} onClose={closeDetail} width="lg">
          {!detail ? <ModalLoading /> : (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge label={stageOf(detailRow?.stage).label} tone={stageOf(detailRow?.stage).tone} />
              {detailRow?.order_number && <span style={{ fontSize: '12px', fontFamily: 'monospace' }}>{detailRow.order_number}</span>}
              {!!detailRow?.reserved_units && <span style={{ fontSize: '12px', color: '#64748b' }}>{detailRow.reserved_units} unit{detailRow.reserved_units === 1 ? '' : 's'} held in stock</span>}
              <span style={{ fontSize: '12px', color: '#64748b' }}>Received {when(detail.created_at)}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', fontSize: '14px' }}>
              <div><div style={{ fontSize: '11px', color: '#64748b' }}>CUSTOMER</div><strong>{detail.customer_name}</strong></div>
              <div><div style={{ fontSize: '11px', color: '#64748b' }}>PHONE</div><a href={`tel:${detail.phone}`}>{detail.phone}</a></div>
              {detail.email && <div><div style={{ fontSize: '11px', color: '#64748b' }}>EMAIL</div>{detail.email}</div>}
              {(detail.address || detail.city) && <div><div style={{ fontSize: '11px', color: '#64748b' }}>DELIVERY ADDRESS</div>{[detail.address, detail.city].filter(Boolean).join(', ')}</div>}
            </div>
            {detail.cancel_reason && <div role="note" style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#7c4a03', borderRadius: '8px', padding: '10px 12px', fontSize: '13px' }}><strong>Cancelled automatically:</strong> {detail.cancel_reason}</div>}
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
              <button type="button" className="btn btn-secondary" onClick={closeDetail}>Close</button>
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
          )}
        </Modal>
      )}
    </div>
  );
}

/** Administrators choose which branch the website sells from, and the stock buffers. */
export function StorefrontSettingsCard() {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [locationId, setLocationId] = useState('');
  const [buffer, setBuffer] = useState('0');
  const [low, setLow] = useState('3');
  const [showQty, setShowQty] = useState(false);
  const [hold, setHold] = useState('48');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getStorefrontSettings()
      .then((s) => { setSettings(s); setLocationId(s.locationId ?? ''); setBuffer(String(s.safetyBuffer)); setLow(String(s.lowStockThreshold)); setShowQty(Boolean(s.showQuantities)); setHold(String(s.holdHours ?? 48)); })
      .catch((err) => addToast('error', err?.message || 'Could not load website settings'));
  }, [addToast]);

  if (!settings) return null;

  const save = async () => {
    setSaving(true);
    try {
      const body: { locationId?: string; safetyBuffer: number; lowStockThreshold: number; showQuantities: boolean; holdHours: number } = { safetyBuffer: Number(buffer), lowStockThreshold: Number(low), showQuantities: showQty, holdHours: Number(hold) };
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
        <div>
          <InputField label="Release unconfirmed orders after (hours)" id="web-hold" type="number" min={0} value={hold} onChange={setHold} />
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>A new online order holds its stock this long. If nobody creates its sales order by then, it is cancelled and the stock goes back on the shop. 0 = hold until handled.</p>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
        <input type="checkbox" checked={showQty} onChange={(e) => setShowQty(e.target.checked)} />
        Show customers the exact number in stock (otherwise only “In stock”, “Only a few left” or “Sold out”)
      </label>
      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
        The website shows stock of the chosen branch only, minus the safety buffer. Stock held in a warehouse must be transferred to this branch before it can be sold online.
      </p>
      <div><button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button></div>
    </div>
  );
}
