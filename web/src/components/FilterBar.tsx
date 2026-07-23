import { Search, X } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDef {
  key: string;
  label: string;
  options: FilterOption[];
}

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  filters?: FilterDef[];
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search\u2026',
  filters = [],
  filterValues = {},
  onFilterChange,
}: FilterBarProps) {
  const hasActiveFilters =
    searchValue.trim() !== '' || Object.values(filterValues).some((v) => v !== '');

  const clearAll = () => {
    onSearchChange('');
    filters.forEach((f) => onFilterChange?.(f.key, ''));
  };

  return (
    <div className="filter-bar">
      <div className="filter-bar__search">
        <Search size={15} className="filter-bar__search-icon" />
        <input
          type="text"
          className="filter-bar__search-input"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchValue && (
          <button type="button" className="filter-bar__clear-x" onClick={() => onSearchChange('')}>
            <X size={13} />
          </button>
        )}
      </div>

      {filters.map((f) => (
        <div key={f.key} className="filter-bar__select-wrap">
          <select
            className="filter-bar__select"
            value={filterValues[f.key] ?? ''}
            onChange={(e) => onFilterChange?.(f.key, e.target.value)}
          >
            <option value="">{f.label}</option>
            {f.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      ))}

      {hasActiveFilters && (
        <button type="button" className="filter-bar__clear-btn" onClick={clearAll}>
          <X size={13} style={{ marginRight: 4 }} /> Clear filters
        </button>
      )}
    </div>
  );
}
