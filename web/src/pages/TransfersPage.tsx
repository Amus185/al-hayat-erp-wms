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
  lines?: TransferLine[];
}

export function TransfersPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Detail Modal
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  const loadData = async () => {
    try {
      const [data, whs, brs] = await Promise.all([
        apiGet<Transfer[]>('/transfers'),
        apiGet<any[]>('/warehouses'),
        apiGet<any[]>('/branches'),
      ]);
      setTransfers(data || []);
      setWarehouses(whs || []);
      setBranches(brs || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch transfers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openDetailModal = async (t: Transfer) => {
    setSelectedTransfer(t);
    setIsRejecting(false);
    setRejectReason('');
    setModalLoading(true);
    try {
      const full = await apiGet<Transfer>(`/transfers/${t.id}`);
      if (full) setSelectedTransfer(full);
    } catch (err) {
      console.error('Failed to load transfer detail', err);
    } finally {
      setModalLoading(false);
    }
  };

  const getOwnerName = (ownerType: string, whId: string | null, brId: string | null) => {
    if (ownerType === 'WAREHOUSE') {
      const wh = warehouses.find((w) => w.id === whId);
      return wh ? `${wh.name} (WH)` : 'Warehouse';
    } else {
      const br = branches.find((b) => b.id === brId);
      return br ? `${br.name} (Branch)` : 'Branch';
    }
  };

  const handleApprove = async (id: string) => {
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/approve`, {});
      addToast('success', 'Transfer approved successfully');
      setSelectedTransfer(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to approve transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDispatch = async (id: string) => {
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/dispatch`, {});
      addToast('success', 'Transfer dispatched — stock deducted from source');
      setSelectedTransfer(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to dispatch transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReceive = async (id: string) => {
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/receive`, {});
      addToast('success', 'Transfer received — stock added to destination');
      setSelectedTransfer(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to receive transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/reject`, { reason: rejectReason });
      addToast('success', 'Transfer rejected');
      setSelectedTransfer(null);
      loadData();
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
      setSelectedTransfer(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to cancel transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredTransfers = transfers.filter((t) => {
    if (activeTab !== 'ALL') {
      if (activeTab === 'PENDING' && t.status !== 'PENDING_APPROVAL') return false;
      else if (activeTab === 'COMPLETED' && !['COMPLETED', 'RECEIVED'].includes(t.status)) return false;
      else if (activeTab !== 'PENDING' && activeTab !== 'COMPLETED' && t.status !== activeTab) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const src = (t.source_name || getOwnerName(t.source_owner_type, t.source_warehouse_id, t.source_branch_id)).toLowerCase();
      const dst = (t.destination_name || getOwnerName(t.destination_owner_type, t.destination_warehouse_id, t.destination_branch_id)).toLowerCase();
      if (!t.transfer_number.toLowerCase().includes(q) && !src.includes(q) && !dst.includes(q)) return false;
    }
    return true;
  });

  const columns: Column<Transfer>[] = [
    {
      key: 'transfer_number',
      label: 'Transfer ID',
      sortable: true,
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
      key: 'requested_at',
      label: 'Requested On',
      sortable: true,
      render: (row) => new Date(row.requested_at).toLocaleDateString(),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
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
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={(e) => { e.stopPropagation(); openDetailModal(row); }}
          >
            View / Manage
          </button>
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

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '240px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Transfer ID, origin or destination…"
            style={{ width: '100%', padding: '9px 10px 9px 32px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <select
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', cursor: 'pointer' }}
        >
          <option value="ALL">All Statuses</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
          <option value="APPROVED">Approved</option>
          <option value="DISPATCHED">Dispatched (In Transit)</option>
          <option value="COMPLETED">Completed / Received</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        {activeTab !== 'ALL' || searchQuery ? (
          <button
            onClick={() => { setActiveTab('ALL'); setSearchQuery(''); }}
            style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: '#6b7280' }}
          >
            <X size={14} /> Clear
          </button>
        ) : null}
      </div>

      <section className="panel">
        <DataTable
          columns={columns}
          data={filteredTransfers}
          keyExtractor={(row) => row.id}
          loading={loading}
          onRowClick={(row) => openDetailModal(row)}
          emptyMessage="No transfers match your filters"
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
                      <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Dispatched</th>
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
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#0369a1' }}>{l.quantity_dispatched ?? '—'}</td>
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
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#9f1239' }}>Reason for Rejection:</label>
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
                    {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
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

                {/* Status PENDING_APPROVAL Actions */}
                {selectedTransfer.status === 'PENDING_APPROVAL' && hasPermission('manage_transfers') && !isRejecting && (
                  <>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => setIsRejecting(true)}
                      disabled={actionLoading}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleCancel(selectedTransfer.id)}
                      disabled={actionLoading}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleApprove(selectedTransfer.id)}
                      disabled={actionLoading}
                    >
                      {actionLoading ? 'Processing...' : 'Approve Transfer'}
                    </button>
                  </>
                )}

                {/* Status APPROVED Action -> Dispatch */}
                {selectedTransfer.status === 'APPROVED' && hasPermission('manage_transfers') && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleDispatch(selectedTransfer.id)}
                    disabled={actionLoading}
                    style={{ background: '#0284c7', borderColor: '#0284c7' }}
                  >
                    {actionLoading ? 'Processing...' : '🚚 Dispatch Transfer (Transit)'}
                  </button>
                )}

                {/* Status DISPATCHED Action -> Receive */}
                {selectedTransfer.status === 'DISPATCHED' && hasPermission('manage_transfers') && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleReceive(selectedTransfer.id)}
                    disabled={actionLoading}
                  >
                    {actionLoading ? 'Processing...' : '✅ Receive Transfer (Complete)'}
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
