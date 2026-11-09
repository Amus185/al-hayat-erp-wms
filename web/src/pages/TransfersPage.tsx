import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus, CheckCircle, ArrowRight, User, Calendar, Search, X } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { confirmAction } from '../utils/swal';
import { useOpenParam, useServerList } from '../utils/serverList';
import { ListToolbar } from '../components/ListToolbar';
import { StatusTabs } from '../components/StatusTabs';

interface TransferLine {
  id: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  product_barcode?: string;
  quantity_requested?: number;
  quantity_dispatched?: number;
  quantity_received?: number;
  quantity?: number;
}

interface Transfer {
  is_source?: boolean;
  is_dest?: boolean;
  id: string;
  transfer_number: string;
  status: string;
  source_owner_type: 'WAREHOUSE' | 'BRANCH';
  source_warehouse_id: string | null;
  source_branch_id: string | null;
  destination_owner_type: 'WAREHOUSE' | 'BRANCH';
  destination_warehouse_id: string | null;
  destination_branch_id: string | null;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  dispatched_by: string | null;
  dispatched_at: string | null;
  received_by: string | null;
  received_at: string | null;
  rejected_by?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  transfer_date?: string | null;
  notes?: string | null;
  source_name?: string;
  destination_name?: string;
  requester_name?: string;
  approver_name?: string;
  dispatcher_name?: string;
  receiver_name?: string;
  items_summary?: string | null;
  lines?: TransferLine[];
}

/**
 * One wording for every status. A transfer now has one step: the sender sends, the receiver
 * accepts (the stock moves then) or declines (nothing moves). "In transit" only appears on
 * transfers that were already on the way under the old steps.
 */
function transferStatus(t: { status: string; is_dest?: boolean; is_source?: boolean }): { label: string; tone: 'green' | 'yellow' | 'red' | 'neutral' | 'blue' } {
  switch (t.status) {
    case 'PENDING_APPROVAL':
      return { label: t.is_dest && !t.is_source ? 'Waiting for you' : t.is_source && !t.is_dest ? 'Waiting for receiver' : 'Waiting', tone: 'yellow' };
    case 'COMPLETED': case 'RECEIVED': return { label: 'Received', tone: 'green' };
    case 'REJECTED': return { label: 'Declined', tone: 'red' };
    case 'CANCELLED': return { label: 'Withdrawn', tone: 'neutral' };
    case 'APPROVED': return { label: 'Approved (old steps)', tone: 'blue' };
    case 'DISPATCHED': return { label: t.is_dest ? 'On the way: click Receive' : 'On the way', tone: 'blue' };
    default: return { label: t.status.replace(/_/g, ' ').toLowerCase(), tone: 'neutral' };
  }
}

export function TransfersPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  // Transfers: searched, filtered, sorted and paged on the server.
  const list = useServerList<Transfer>('/transfers', {
    key: 'transfers',
    filters: ['status', 'from', 'to', 'dateFrom', 'dateTo', 'direction'],
    defaultSort: 'date',
    defaultDir: 'desc',
  });
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);

  // Detail Modal
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [acceptQty, setAcceptQty] = useState<Record<string, string>>({});

  const loadData = async () => {
    try {
      list.refresh();
      const [whs, brs] = await Promise.all([
        apiGet<any[]>('/warehouses'),
        apiGet<any[]>('/branches'),
      ]);
      setWarehouses(whs || []);
      setBranches(brs || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch transfers');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openDetailModal = async (t: Transfer) => {
    setSelectedTransfer(t);
    setIsRejecting(false);
    setRejectReason('');
    setAcceptQty({});
    setModalLoading(true);
    try {
      const full = await apiGet<Transfer>(`/transfers/${t.id}`);
      // Only into the window still showing this transfer: never reopen a closed one.
      if (full) setSelectedTransfer((cur) => (cur && cur.id === t.id ? full : cur));
    } catch (err) {
      console.error('Failed to load transfer detail', err);
    } finally {
      setModalLoading(false);
    }
  };

  // ?open=<transfer id> (quick search, notifications): load it, then show it.
  useOpenParam((id) => {
    apiGet<Transfer>(`/transfers/${id}`).then((t) => { if (t) openDetailModal(t); }).catch(() => addToast('error', 'Could not open that transfer'));
  });

  const getOwnerName = (ownerType: string, whId: string | null, brId: string | null) => {
    if (ownerType === 'WAREHOUSE') {
      const wh = warehouses.find((w) => w.id === whId);
      return wh ? `${wh.name} (WH)` : 'Warehouse';
    } else {
      const br = branches.find((b) => b.id === brId);
      return br ? `${br.name} (Branch)` : 'Branch';
    }
  };

  const refreshSelectedTransfer = async (id: string) => {
    try {
      const full = await apiGet<Transfer>(`/transfers/${id}`);
      if (full) setSelectedTransfer((cur) => (cur && cur.id === id ? full : cur));
    } catch {
      // ignore
    }
  };

  const handleDispatch = async (id: string, stayOpen = true) => {
    const confirmed = await confirmAction(
      'Dispatch Transfer?',
      'Stock will be deducted from the origin location and placed in transit.',
      'Yes, Dispatch',
      'info'
    );
    if (!confirmed) return;
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/dispatch`, {});
      addToast('success', 'Transfer dispatched — stock deducted from origin');
      loadData();
      if (stayOpen && selectedTransfer?.id === id) {
        void refreshSelectedTransfer(id);
      } else if (!stayOpen) {
        setSelectedTransfer(null);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to dispatch transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReceive = async (id: string, stayOpen = true) => {
    const confirmed = await confirmAction(
      'Receive Transfer?',
      'Stock will be deposited into the destination warehouse/branch.',
      'Yes, Confirm Received',
      'success'
    );
    if (!confirmed) return;
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/receive`, {});
      addToast('success', 'Transfer received — stock deposited at destination');
      loadData();
      if (stayOpen && selectedTransfer?.id === id) {
        void refreshSelectedTransfer(id);
      } else if (!stayOpen) {
        setSelectedTransfer(null);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to receive transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAccept = async (t: Transfer) => {
    // From the list (no lines loaded): accept everything that was sent.
    if (!t.lines) {
      try {
        setActionLoading(true);
        await apiPost(`/transfers/${t.id}/accept`, {});
        addToast('success', 'Transfer accepted: the stock has moved to you');
        loadData();
      } catch (err: any) {
        addToast('error', err?.message || 'Could not accept the transfer');
      } finally {
        setActionLoading(false);
      }
      return;
    }
    const lines = (t.lines || []).map((l) => ({
      productId: l.product_id,
      quantity: Number(acceptQty[l.product_id] ?? (l.quantity_requested ?? l.quantity ?? 0)),
    }));
    if (lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 0)) { addToast('error', 'Enter whole numbers for the quantities you accept.'); return; }
    if (!lines.some((l) => l.quantity > 0)) { addToast('error', 'Enter a quantity to accept, or decline the transfer.'); return; }
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${t.id}/accept`, { lines });
      addToast('success', 'Transfer accepted: the stock has moved to you');
      loadData();
      void refreshSelectedTransfer(t.id);
    } catch (err: any) {
      addToast('error', err?.message || 'Could not accept the transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/reject`, { reason: rejectReason });
      addToast('success', 'Transfer declined: no stock was moved');
      loadData();
      if (selectedTransfer?.id === id) {
        void refreshSelectedTransfer(id);
      } else {
        setSelectedTransfer(null);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Could not decline the transfer');
    } finally {
      setActionLoading(false);
      setIsRejecting(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Withdraw this transfer? Nothing has moved yet, and the receiver will no longer see it as waiting.')) return;
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/cancel`, {});
      addToast('success', 'Transfer withdrawn: nothing was moved');
      loadData();
      if (selectedTransfer?.id === id) {
        void refreshSelectedTransfer(id);
      } else {
        setSelectedTransfer(null);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to cancel transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const columns: Column<Transfer>[] = [
    {
      key: 'transfer_number',
      sortable: true,
      sortKey: 'number',
      label: 'Transfer ID',
      render: (row) => (
        <span style={{ fontWeight: 700, color: '#0b8f08', fontFamily: 'monospace' }}>
          {row.transfer_number}
        </span>
      ),
    },
    {
      key: 'route',
      label: 'From → To',
      render: (row) => (
        <div style={{ display: 'grid', gap: '2px', fontWeight: 600, color: '#0f172a', whiteSpace: 'normal', minWidth: 120 }}>
          <span>{row.source_name || getOwnerName(row.source_owner_type, row.source_warehouse_id, row.source_branch_id)}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ArrowRight size={13} style={{ color: '#0b8f08', flexShrink: 0 }} />
            {row.destination_name || getOwnerName(row.destination_owner_type, row.destination_warehouse_id, row.destination_branch_id)}
          </span>
        </div>
      ),
    },
    {
      key: 'items_summary',
      label: 'Items',
      render: (row) => <span className="tr-items" title={row.items_summary ?? ''}>{row.items_summary || '—'}</span>,
    },
    {
      key: 'requested_at',
      sortable: true,
      sortKey: 'date',
      label: 'Requested On',
      render: (row) => new Date(row.requested_at).toLocaleDateString(),
    },
    {
      key: 'status',
      sortable: true,
      sortKey: 'status',
      label: 'Status',
      render: (row) => {
        const { label, tone } = transferStatus(row);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
            <StatusBadge label={label} tone={tone} />
            {row.is_dest && !row.is_source && (
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: '#dbeafe', color: '#1d4ed8' }}>
                INCOMING
              </span>
            )}
            {row.is_source && !row.is_dest && (
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: '#f1f5f9', color: '#475569' }}>
                OUTGOING
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={(e) => { e.stopPropagation(); openDetailModal(row); }}
          >
            Open
          </button>

          {hasPermission('manage_transfers') && row.status === 'PENDING_APPROVAL' && row.is_dest && (
            <>
              <button type="button" className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={(e) => { e.stopPropagation(); handleAccept(row); }} disabled={actionLoading}
                title="Accept everything that was sent: the stock moves to you now. Open it to accept only part.">
                <CheckCircle size={13} /> Accept
              </button>
              <button type="button" className="btn btn-sm btn-danger"
                onClick={(e) => { e.stopPropagation(); openDetailModal(row); setIsRejecting(true); }} disabled={actionLoading}
                title="Refuse it: nothing moves and the sender is told">
                Decline
              </button>
            </>
          )}
          {hasPermission('manage_transfers') && row.status === 'PENDING_APPROVAL' && row.is_source && !row.is_dest && (
            <button type="button" className="btn btn-sm btn-secondary"
              onClick={(e) => { e.stopPropagation(); handleCancel(row.id); }} disabled={actionLoading}
              title="Take the request back before it is accepted">
              Withdraw
            </button>
          )}
          {/* Transfers already on the way under the old steps */}
          {hasPermission('manage_transfers') && row.status === 'APPROVED' && row.is_source && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); handleDispatch(row.id, false); }}>
              Send now
            </button>
          )}
          {hasPermission('manage_transfers') && row.status === 'DISPATCHED' && row.is_dest && (
            <button type="button" className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onClick={(e) => { e.stopPropagation(); handleReceive(row.id, false); }}>
              <CheckCircle size={13} /> Receive
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <Truck size={24} />
        </div>
        <div className="module-header__info">
          <p>Movement</p>
          <h2>Warehouse-to-branch and branch-to-branch stock transfers</h2>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/transfers/new')}>
            <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> New Transfer
          </button>
        </div>
      </section>

      <section className="panel">
        {list.response?.hasLocation === true && (
          <StatusTabs
            id="transfer-direction-tabs"
            value={list.filters.direction}
            onChange={(v) => list.setFilter('direction', v)}
            tabs={[
              { key: 'ALL', label: 'All transfers' },
              { key: 'incoming', label: 'Incoming to my location' },
              { key: 'outgoing', label: 'Sent from my location' },
            ]}
          />
        )}
        <StatusTabs
          id="transfer-status-tabs"
          value={list.filters.status}
          counts={list.counts}
          onChange={(v) => list.setFilter('status', v)}
          tabs={[
            { key: 'ALL', label: 'All' },
            { key: 'PENDING_APPROVAL', label: 'Waiting' },
            { key: 'COMPLETED', label: 'Received' },
            { key: 'REJECTED', label: 'Declined' },
            { key: 'CANCELLED', label: 'Withdrawn' },
          ]}
        />
        <ListToolbar
          id="transfers-toolbar"
          list={list}
          searchPlaceholder="Search transfer number, location, requester or note…"
          dateRange
          filters={[
            { key: 'from', label: 'From anywhere', options: [
                ...warehouses.map((w: any) => ({ value: `W:${w.id}`, label: `Warehouse: ${w.name}` })),
                ...branches.map((b: any) => ({ value: `B:${b.id}`, label: `Branch: ${b.name}` })),
              ] },
            { key: 'to', label: 'To anywhere', options: [
                ...warehouses.map((w: any) => ({ value: `W:${w.id}`, label: `Warehouse: ${w.name}` })),
                ...branches.map((b: any) => ({ value: `B:${b.id}`, label: `Branch: ${b.name}` })),
              ] },
          ]}
        />
        <DataTable
          id="transfers-table"
          columns={columns}
          data={list.items}
          server={list}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => openDetailModal(row)}
          emptyMessage={list.activeFilters ? 'No transfers match your filters' : 'No transfers yet'}
        />
      </section>

      {/* Detail Action Modal */}
      <Modal
        isOpen={!!selectedTransfer}
        onClose={() => setSelectedTransfer(null)}
        title={selectedTransfer ? `Transfer: ${selectedTransfer.transfer_number}` : 'Transfer Details'}
        width="lg"
      >
        {selectedTransfer && (
          <div style={{ display: 'grid', gap: '16px' }}>
            {modalLoading && <LoadingSpinner />}

            {/* Source & Destination Card */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f7f9f7',
              padding: '14px 18px',
              borderRadius: '8px',
              border: '1px solid #e1e8e1'
            }}>
              <div>
                <span style={{ fontSize: '11px', color: '#667066', textTransform: 'uppercase', fontWeight: 600 }}>From</span>
                <p style={{ margin: '2px 0 0', fontWeight: '700', color: '#066006', fontSize: '15px' }}>
                  {selectedTransfer.source_name || getOwnerName(selectedTransfer.source_owner_type, selectedTransfer.source_warehouse_id, selectedTransfer.source_branch_id)}
                </p>
              </div>
              <ArrowRight size={22} style={{ color: '#0b8f08' }} />
              <div>
                <span style={{ fontSize: '11px', color: '#667066', textTransform: 'uppercase', fontWeight: 600 }}>To</span>
                <p style={{ margin: '2px 0 0', fontWeight: '700', color: '#066006', fontSize: '15px' }}>
                  {selectedTransfer.destination_name || getOwnerName(selectedTransfer.destination_owner_type, selectedTransfer.destination_warehouse_id, selectedTransfer.destination_branch_id)}
                </p>
              </div>
            </div>

            {/* Products Table */}
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#0f172a', fontWeight: 700 }}>
                Transfer Items
              </h4>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>Product</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>SKU / Barcode</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Requested</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Accepted / sent</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTransfer.lines && selectedTransfer.lines.length > 0 ? (
                      selectedTransfer.lines.map((l) => (
                        <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{l.product_name || 'Product'}</td>
                          <td style={{ padding: '8px 12px', color: '#64748b' }}>{l.product_sku || '—'} {l.product_barcode ? `(${l.product_barcode})` : ''}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{l.quantity_requested ?? l.quantity ?? 0}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#0369a1' }}>
                            {selectedTransfer.status === 'PENDING_APPROVAL' && selectedTransfer.is_dest && hasPermission('manage_transfers') ? (
                              <input type="number" min={0} max={l.quantity_requested ?? l.quantity ?? 0} className="form-input" style={{ width: 80, textAlign: 'right' }}
                                aria-label={`Accept quantity for ${l.product_name || 'product'}`}
                                value={acceptQty[l.product_id] ?? String(l.quantity_requested ?? l.quantity ?? 0)}
                                onChange={(e) => setAcceptQty((p) => ({ ...p, [l.product_id]: e.target.value }))} />
                            ) : (l.quantity_dispatched ?? '—')}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#15803d' }}>{l.quantity_received ?? '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} style={{ padding: '12px', textAlign: 'center', color: '#94a3b8' }}>
                          Loading items…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* What happened, in plain steps: sent, then accepted / declined / withdrawn */}
            {(() => {
              const t = selectedTransfer;
              const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : '');
              // "On the way" only for transfers sent under the old steps (dispatched, not yet received).
              const oldInTransit = t.status === 'DISPATCHED' || t.status === 'APPROVED';
              const second: { label: string; text: string; color: string } =
                t.status === 'COMPLETED' || t.status === 'RECEIVED' ? { label: 'Accepted', text: `${t.receiver_name || '—'} · ${when(t.received_at)}`, color: '#15803d' }
                : t.status === 'REJECTED' ? { label: 'Declined', text: when(t.rejected_at) || 'Declined', color: '#b91c1c' }
                : t.status === 'CANCELLED' ? { label: 'Withdrawn', text: 'Taken back by the sender. Nothing moved.', color: '#475569' }
                : oldInTransit ? { label: 'On the way', text: t.dispatched_at ? `Sent off · ${when(t.dispatched_at)}` : 'Approved, not sent off yet', color: '#0369a1' }
                : { label: 'Waiting', text: 'For the receiving branch to accept or decline. Nothing has moved yet.', color: '#a16207' };
              return (
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '12px' }}>
                    <div>
                      <span style={{ color: '#64748b' }}>Sent</span>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{t.requester_name || '—'} · {when(t.requested_at)}</div>
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>{second.label}</span>
                      <div style={{ fontWeight: 600, color: second.color }}>{second.text}</div>
                    </div>
                    {t.rejection_reason && (
                      <div style={{ gridColumn: '1 / -1', color: '#b91c1c', background: '#fef2f2', padding: '6px 10px', borderRadius: '6px', border: '1px solid #fecaca' }}>
                        <strong>Reason:</strong> {t.rejection_reason}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Rejection input box */}
            {isRejecting && (
              <div style={{ display: 'grid', gap: '8px', background: '#fff1f2', padding: '12px', borderRadius: '8px', border: '1px solid #fecdd3' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#9f1239' }}>Reason for declining:</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Stock needed for urgent order, incorrect branch selected..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsRejecting(false)}>Cancel</button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleReject(selectedTransfer.id)} disabled={actionLoading}>
                    {actionLoading ? 'Declining...' : 'Confirm decline'}
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons Panel */}
            <div style={{
              marginTop: '6px',
              borderTop: '1px solid #edf1ed',
              paddingTop: '14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div>
                <StatusBadge {...transferStatus(selectedTransfer)} />
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedTransfer(null)}
                  disabled={actionLoading}
                >
                  Close
                </button>

                {/* Waiting for the receiver: accept (all or part) or decline; the sender can withdraw */}
                {selectedTransfer.status === 'PENDING_APPROVAL' && hasPermission('manage_transfers') && !isRejecting && (
                  <>
                    {selectedTransfer.is_source && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCancel(selectedTransfer.id)} disabled={actionLoading}>
                        Withdraw request
                      </button>
                    )}
                    {selectedTransfer.is_dest && (
                      <>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => setIsRejecting(true)} disabled={actionLoading}>Decline</button>
                        <button type="button" id="accept-transfer" className="btn btn-primary" onClick={() => handleAccept(selectedTransfer)} disabled={actionLoading}
                          title="Stock moves now, for the quantities shown">
                          {actionLoading ? 'Moving stock…' : 'Accept'}
                        </button>
                      </>
                    )}
                  </>
                )}

                {/* Status APPROVED Action -> Dispatch */}
                {selectedTransfer.status === 'APPROVED' && hasPermission('manage_transfers') && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleDispatch(selectedTransfer.id, true)}
                    disabled={actionLoading}
                    style={{ background: '#0284c7', borderColor: '#0284c7' }}
                  >
                    {actionLoading ? 'Processing...' : 'Dispatch Transfer'}
                  </button>
                )}

                {/* Status DISPATCHED Action -> Receive */}
                {selectedTransfer.status === 'DISPATCHED' && hasPermission('manage_transfers') && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleReceive(selectedTransfer.id, true)}
                    disabled={actionLoading}
                  >
                    {actionLoading ? 'Processing...' : 'Receive Transfer'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
