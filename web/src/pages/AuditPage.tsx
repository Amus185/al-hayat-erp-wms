import { useEffect, useState } from 'react';
import { FileClock, Search, Calendar, ShieldCheck } from 'lucide-react';
import { apiGet } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { SearchInput } from '../components/SearchInput';
import { FormField } from '../components/FormField';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: any;
  new_value: any;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
}

export function AuditPage() {
  const { addToast } = useToast();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [searchText, setSearchText] = useState('');
  
  // Detail log viewer state
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (selectedEntity) {
        params.entityType = selectedEntity;
      }
      const data = await apiGet<AuditLog[]>('/audit-logs', params);
      setLogs(data || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to retrieve governance logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [selectedEntity]);

  // Client-side text filter
  const filteredLogs = logs.filter((log) => {
    const text = searchText.toLowerCase();
    if (!text) return true;
    return (
      log.action.toLowerCase().includes(text) ||
      log.entity_type.toLowerCase().includes(text) ||
      (log.actor_name && log.actor_name.toLowerCase().includes(text)) ||
      (log.actor_email && log.actor_email.toLowerCase().includes(text))
    );
  });

  const columns: Column<AuditLog>[] = [
    {
      key: 'created_at',
      label: 'Timestamp',
      render: (row) => new Date(row.created_at).toLocaleString(),
    },
    { key: 'actor_name', label: 'Actor', render: (row) => row.actor_name || 'System / Batch Job' },
    {
      key: 'action',
      label: 'Action',
      render: (row) => <span style={{ fontFamily: 'monospace', fontWeight: '700', fontSize: '13px' }}>{row.action}</span>,
    },
    { key: 'entity_type', label: 'Entity Type' },
    { key: 'entity_id', label: 'Entity Reference ID', render: (row) => row.entity_id || '—' },
    {
      key: 'details',
      label: 'Details',
      render: (row) => (
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedLog(row);
          }}
        >
          View Values
        </button>
      ),
    },
  ];

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <FileClock size={24} />
        </div>
        <div>
          <p>Governance</p>
          <h2>Critical action audit logs and security telemetry logs</h2>
        </div>
        <div></div>
      </section>

      {/* Filters */}
      <section className="panel" style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '240px' }}>
          <SearchInput
            value={searchText}
            onChange={setSearchText}
            placeholder="Search by action keyword or actor user name..."
          />
        </div>
        <div>
          <select
            value={selectedEntity}
            onChange={(e) => setSelectedEntity(e.target.value)}
            className="form-select"
            style={{ minHeight: '38px', borderRadius: '8px', border: '1px solid #d9e2d9', padding: '0 10px' }}
          >
            <option value="">All Entities</option>
            <option value="users">users</option>
            <option value="products">products</option>
            <option value="transfers">transfers</option>
            <option value="sales_orders">sales_orders</option>
            <option value="purchase_orders">purchase_orders</option>
            <option value="branches">branches</option>
            <option value="warehouses">warehouses</option>
          </select>
        </div>
      </section>

      <section className="panel">
        <DataTable
          columns={columns}
          data={filteredLogs}
          keyExtractor={(row) => row.id}
          loading={loading}
          emptyMessage="No security/audit logs match the current criteria"
        />
      </section>

      {/* Values Modal */}
      <Modal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title={selectedLog ? `Log Details: ${selectedLog.action}` : 'Log Values'}
        width="md"
      >
        {selectedLog && (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ fontSize: '13px', background: '#f7f9f7', padding: '12px', borderRadius: '8px', border: '1px solid #e1e8e1' }}>
              <p style={{ margin: '0 0 6px' }}>
                Actor: <strong>{selectedLog.actor_name || 'System'}</strong> ({selectedLog.actor_email || 'cron'})
              </p>
              <p style={{ margin: '0 0 6px' }}>
                Entity: <strong>{selectedLog.entity_type}</strong> (Ref: {selectedLog.entity_id || 'None'})
              </p>
              <p style={{ margin: '0' }}>
                Timestamp: <strong>{new Date(selectedLog.created_at).toLocaleString()}</strong>
              </p>
            </div>

            <div>
              <h4 style={{ margin: '0 0 6px', color: '#066006' }}>Audit Context Changes (JSON)</h4>
              <pre style={{
                margin: '0',
                padding: '12px',
                background: '#1a1a1a',
                color: '#22c55e',
                borderRadius: '8px',
                fontSize: '12px',
                fontFamily: 'monospace',
                overflowX: 'auto',
                maxHeight: '260px'
              }}>
                {JSON.stringify(selectedLog.new_value || selectedLog.old_value || { message: "No payload modifications stored" }, null, 2)}
              </pre>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #edf1ed', paddingTop: '12px' }}>
              <button type="button" className="btn btn--outline" onClick={() => setSelectedLog(null)}>
                Close Viewer
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
