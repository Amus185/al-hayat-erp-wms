import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react';
import { TableSkeleton } from './LoadingSpinner';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
  width?: string;
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
    <div className="table-wrap" id={id}>
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
  );
}
