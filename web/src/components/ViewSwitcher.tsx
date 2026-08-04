import { LayoutGrid, Table } from 'lucide-react';

interface ViewSwitcherProps {
  viewMode: 'kanban' | 'table';
  onViewChange: (mode: 'kanban' | 'table') => void;
}

export function ViewSwitcher({ viewMode, onViewChange }: ViewSwitcherProps) {
  return (
    <div className="view-switcher" role="radiogroup" aria-label="View Mode">
      <button
        type="button"
        className={`view-switcher__btn${viewMode === 'kanban' ? ' view-switcher__btn--active' : ''}`}
        onClick={() => onViewChange('kanban')}
        title="Kanban Board View"
      >
        <LayoutGrid size={15} />
        <span>Kanban</span>
      </button>
      <button
        type="button"
        className={`view-switcher__btn${viewMode === 'table' ? ' view-switcher__btn--active' : ''}`}
        onClick={() => onViewChange('table')}
        title="Dense Table View"
      >
        <Table size={15} />
        <span>Table</span>
      </button>
    </div>
  );
}
