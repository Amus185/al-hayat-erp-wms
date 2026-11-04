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

  const handleApprove = async (id: string, stayOpen = true) => {
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/approve`, {});
      addToast('success', 'Transfer approved successfully');
      loadData();
      if (stayOpen && selectedTransfer?.id === id) {
        await refreshSelectedTransfer(id);
      } else if (!stayOpen) {
        setSelectedTransfer(null);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to approve transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveAndDispatch = async (id: string, stayOpen = true) => {
    const confirmed = await confirmAction(
      'Approve & Dispatch Transfer?',
      'This will approve the transfer and immediately deduct stock from the origin for transit.',
      'Yes, Approve & Dispatch',
      'info'
    );
    if (!confirmed) return;
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/dispatch`, {});
      addToast('success', 'Transfer approved & dispatched! Stock deducted from origin.');
      loadData();
      if (stayOpen && selectedTransfer?.id === id) {
        await refreshSelectedTransfer(id);
      } else if (!stayOpen) {
        setSelectedTransfer(null);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to dispatch transfer');
    } finally {
      setActionLoading(false);
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
        await refreshSelectedTransfer(id);
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
        await refreshSelectedTransfer(id);
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
      await refreshSelectedTransfer(t.id);
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
        await refreshSelectedTransfer(id);
      } else {
        setSelectedTransfer(null);
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to reject transfer');
    } finally {
      setActionLoading(false);
      setIsRejecting(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Are you sure you want to cancel this transfer request?')) return;
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/cancel`, {});
      addToast('success', 'Transfer cancelled');
      loadData();
      if (selectedTransfer?.id === id) {
        await refreshSelectedTransfer(id);
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
      label: 'Source → Destination',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#0f172a' }}>
          <span>{row.source_name || getOwnerName(row.source_owner_type, row.source_warehouse_id, row.source_branch_id)}</span>
          <ArrowRight size={14} style={{ color: '#0b8f08' }} />
          <span>{row.destination_name || getOwnerName(row.destination_owner_type, row.destination_warehouse_id, row.destination_branch_id)}</span>
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
        let tone: 'green' | 'yellow' | 'red' | 'neutral' | 'blue' = 'neutral';
        if (row.status === 'APPROVED') tone = 'green';
        if (row.status === 'PENDING_APPROVAL') tone = 'yellow';
        if (row.status === 'DISPATCHED') tone = 'blue';
        if (['COMPLETED', 'RECEIVED'].includes(row.status)) tone = 'green';
        if (['REJECTED', 'CANCELLED'].includes(row.status)) tone = 'red';
        return <StatusBadge label={row.status.replace('_', ' ')} tone={tone} />;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={(e) => { e.stopPropagation(); openDetailModal(row); }}
          >
            View / Manage
          </button>

          {row.status === 'PENDING_APPROVAL' && hasPermission('manage_transfers') && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: '#0b8f08', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
              onClick={(e) => { e.stopPropagation(); handleApproveAndDispatch(row.id, false); }}
              title="Approve & Dispatch"
            >
              Approve & Dispatch
            </button>
          )}

          {row.status === 'APPROVED' && hasPermission('manage_transfers') && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: '#0284c7', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
              onClick={(e) => { e.stopPropagation(); handleDispatch(row.id, false); }}
              title="Dispatch transfer"
            >
              Dispatch
            </button>
          )}

          {row.status === 'DISPATCHED' && hasPermission('manage_transfers') && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: '#16a34a', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
              onClick={(e) => { e.stopPropagation(); handleReceive(row.id, false); }}
              title="Confirm transfer received"
            >
              Receive
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
            { key: 'PENDING_APPROVAL', label: 'Pending approval' },
            { key: 'APPROVED', label: 'Approved' },
            { key: 'DISPATCHED', label: 'In transit' },
            { key: 'COMPLETED', label: 'Received' },
            { key: 'REJECTED', label: 'Rejected' },
            { key: 'CANCELLED', label: 'Cancelled' },
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
                <span style={{ fontSize: '11px', color: '#667066', textTransform: 'uppercase', fontWeight: 600 }}>Source Origin</span>
                <p style={{ margin: '2px 0 0', fontWeight: '700', color: '#066006', fontSize: '15px' }}>
                  {selectedTransfer.source_name || getOwnerName(selectedTransfer.source_owner_type, selectedTransfer.source_warehouse_id, selectedTransfer.source_branch_id)}
                </p>
              </div>
              <ArrowRight size={22} style={{ color: '#0b8f08' }} />
              <div>
                <span style={{ fontSize: '11px', color: '#667066', textTransform: 'uppercase', fontWeight: 600 }}>Destination</span>
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

            {/* Complete Audit & Lifecycle Timeline */}
            <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#1e293b', fontWeight: 700 }}>
                Audit & History Timeline
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12px' }}>
                <div>
                  <span style={{ color: '#64748b' }}>Requested:</span>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                    {selectedTransfer.requester_name || 'System User'} — {new Date(selectedTransfer.requested_at).toLocaleString()}
                  </div>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>Approved:</span>
                  <div style={{ fontWeight: 600, color: selectedTransfer.approved_at ? '#15803d' : '#94a3b8' }}>
                    {selectedTransfer.approved_at
                      ? `${selectedTransfer.approver_name || 'Authorized User'} — ${new Date(selectedTransfer.approved_at).toLocaleString()}`
                      : 'Pending Approval'}
                  </div>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>Dispatched (Transit):</span>
                  <div style={{ fontWeight: 600, color: selectedTransfer.dispatched_at ? '#0369a1' : '#94a3b8' }}>
                    {selectedTransfer.dispatched_at
                      ? `${selectedTransfer.dispatcher_name || 'Authorized User'} — ${new Date(selectedTransfer.dispatched_at).toLocaleString()}`
                      : 'Not Dispatched Yet'}
                  </div>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>Received (Completed):</span>
                  <div style={{ fontWeight: 600, color: selectedTransfer.received_at ? '#15803d' : '#94a3b8' }}>
                    {selectedTransfer.received_at
                      ? `${selectedTransfer.receiver_name || 'Authorized User'} — ${new Date(selectedTransfer.received_at).toLocaleString()}`
                      : 'Not Received Yet'}
                  </div>
                </div>
                {selectedTransfer.rejection_reason && (
                  <div style={{ gridColumn: '1 / -1', color: '#b91c1c', background: '#fef2f2', padding: '6px 10px', borderRadius: '6px', border: '1px solid #fecaca' }}>
                    <strong>Rejection Reason:</strong> {selectedTransfer.rejection_reason}
                  </div>
                )}
              </div>
            </div>

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
              alignItems: 'center'
            }}>
              <div>
                <StatusBadge
                  label={selectedTransfer.status.replace('_', ' ')}
                  tone={
                    ['APPROVED', 'COMPLETED', 'RECEIVED'].includes(selectedTransfer.status)
                      ? 'green'
                      : selectedTransfer.status === 'PENDING_APPROVAL'
                      ? 'yellow'
                      : selectedTransfer.status === 'DISPATCHED'
                      ? 'blue'
                      : 'red'
                  }
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
