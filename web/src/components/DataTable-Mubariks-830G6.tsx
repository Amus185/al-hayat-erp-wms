import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { TableSkeleton } from './LoadingSpinner';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
  width?: string;
}

export interface PaginationConfig {
  page: number;
  total: number;
  limit: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (columnKey: string) => void;
  onRowClick?: (row: T) => void;
  id?: string;
  pagination?: PaginationConfig;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyExtractor,
  loading = false,
  emptyMessage = 'No data found',
  emptyIcon,
  sortBy,
  sortOrder,
  onSort,
  onRowClick,
  id = 'data-table',
  pagination,
}: DataTableProps<T>) {
  if (loading) {
    return <TableSkeleton rows={5} columns={columns.length} />;
  }

  if (!data.length) {
    return (
      <div className="empty-state" id={`${id}-empty`}>
        {emptyIcon ?? <Inbox size={48} />}
        <p>{emptyMessage}</p>
      </div>
    );
  }

  const renderSortIcon = (col: Column<T>) => {
    if (!col.sortable) return null;
    if (sortBy === col.key) {
      return sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    }
    return <ArrowUpDown size={14} className="sort-icon--inactive" />;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="table-wrap" id={id} style={{ marginBottom: pagination ? '16px' : '0' }}>
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={col.sortable ? 'th--sortable' : ''}
                  onClick={() => col.sortable && onSort?.(col.key)}
                >
                  <span className="th__content">
                    {col.label}
                    {renderSortIcon(col)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={keyExtractor(row)}
                className={onRowClick ? 'tr--clickable' : ''}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td key={col.key}>
                    {col.render ? col.render(row) : (row[col.key] as ReactNode)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {pagination && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px', color: '#4b5563', fontSize: '13px' }}>
          <div>
            Showing <strong>{(pagination.page - 1) * pagination.limit + 1}</strong> to <strong>{Math.min(pagination.page * pagination.limit, pagination.total)}</strong> of <strong>{pagination.total}</strong> results
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '6px 10px' }}
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '6px 10px' }}
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
