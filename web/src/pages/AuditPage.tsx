import { useEffect, useState } from 'react';
import { FileClock, Search, Calendar, ShieldCheck } from 'lucide-react';
import { apiGet } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { ListToolbar } from '../components/ListToolbar';
import { useServerList } from '../utils/serverList';
import { FormField } from '../components/FormField';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Modal } from '../components/Modal';
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

  // The audit trail: searched, filtered, sorted and paged on the server.
  const list = useServerList<AuditLog>('/audit', {
    key: 'audit',
    filters: ['entityType', 'action', 'actor', 'dateFrom', 'dateTo'],
    defaultSort: 'date',
    defaultDir: 'desc',
  });
  const [facets, setFacets] = useState<{ entityTypes: string[]; actions: string[] }>({ entityTypes: [], actions: [] });
  useEffect(() => {
    apiGet<{ entityTypes: string[]; actions: string[] }>('/audit/facets').then(setFacets).catch(() => addToast('error', 'Could not load the audit filters'));
  }, [addToast]);
  // Detail log viewer state
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const columns: Column<AuditLog>[] = [
    {
      key: 'created_at',
      label: 'Timestamp',
      sortable: true,
      sortKey: 'date',
      render: (row) => new Date(row.created_at).toLocaleString(),
    },
    { key: 'actor_name', label: 'Actor', sortable: true, sortKey: 'who', render: (row) => row.actor_name || 'System / Batch Job' },
    {
      key: 'action',
      label: 'Action',
      sortable: true,
      sortKey: 'action',
      render: (row) => <span style={{ fontFamily: 'monospace', fontWeight: '700', fontSize: '13px' }}>{row.action}</span>,
    },
    { key: 'entity_type', label: 'Entity Type', sortable: true, sortKey: 'type' },
    { key: 'entity_id', label: 'Entity Reference ID', render: (row) => row.entity_id || '—' },
    {
      key: 'details',
      label: 'Details',
      render: (row) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
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
        <div className="module-header__info">
          <p>Governance</p>
          <h2>System-wide immutable audit trail and security events</h2>
        </div>
        <div></div>
      </section>

      <section className="panel">
        <ListToolbar
          id="audit-toolbar"
          list={list}
          searchPlaceholder="Search action, record, values or person…"
          dateRange
          filters={[
            { key: 'entityType', label: 'All record types', options: facets.entityTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })) },
            { key: 'action', label: 'All actions', options: facets.actions.map((a) => ({ value: a, label: a.replace(/_/g, ' ').toLowerCase() })) },
          ]}
        >
          <input
            className="list-toolbar__select"
            aria-label="Person"
            placeholder="Person (name or email)…"
            defaultValue={list.filters.actor}
            onBlur={(e) => list.setFilter('actor', e.target.value.trim())}
            onKeyDown={(e) => { if (e.key === 'Enter') list.setFilter('actor', (e.target as HTMLInputElement).value.trim()); }}
            style={{ width: '200px' }}
          />
        </ListToolbar>
        <DataTable
          id="audit-table"
          columns={columns}
          data={list.items}
          server={list}
          keyExtractor={(row) => row.id}
          emptyMessage={list.activeFilters ? 'No audit entries match your filters' : 'No audit entries yet'}
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

            <div style={{ display: 'grid', gap: '12px' }}>
              {selectedLog.old_value && (
                <div>
                  <h4 style={{ margin: '0 0 6px', color: '#991b1b' }}>Previous State (Old Values)</h4>
                  <pre style={{
                    margin: '0', padding: '10px', background: '#1a1a1a', color: '#f87171',
                    borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace', overflowX: 'auto', maxHeight: '180px'
                  }}>
                    {typeof selectedLog.old_value === 'object' ? JSON.stringify(selectedLog.old_value, null, 2) : String(selectedLog.old_value)}
                  </pre>
                </div>
              )}
              {selectedLog.new_value && (
                <div>
                  <h4 style={{ margin: '0 0 6px', color: '#066006' }}>New State (Changes / New Values)</h4>
                  <pre style={{
                    margin: '0', padding: '10px', background: '#1a1a1a', color: '#22c55e',
                    borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace', overflowX: 'auto', maxHeight: '180px'
                  }}>
                    {typeof selectedLog.new_value === 'object' ? JSON.stringify(selectedLog.new_value, null, 2) : String(selectedLog.new_value)}
                  </pre>
                </div>
              )}
              {!selectedLog.old_value && !selectedLog.new_value && (
                <div>
                  <h4 style={{ margin: '0 0 6px', color: '#666' }}>Audit Context Changes</h4>
                  <pre style={{
                    margin: '0', padding: '10px', background: '#1a1a1a', color: '#aaa',
                    borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace', overflowX: 'auto'
                  }}>
                    No payload modifications recorded for this action.
                  </pre>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #edf1ed', paddingTop: '12px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedLog(null)}>
                Close Viewer
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
