import { type ReactNode } from 'react';

export interface KanbanColumnDef {
  id: string;
  title: string;
  badgeTone?: 'green' | 'yellow' | 'red' | 'blue' | 'neutral' | 'purple' | 'orange';
  accentColor?: string;
}

interface KanbanBoardProps<T> {
  columns: KanbanColumnDef[];
  items: T[];
  getItemStage: (item: T) => string;
  keyExtractor: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onCardClick?: (item: T) => void;
  emptyColumnText?: (column: KanbanColumnDef) => string;
}

export function KanbanBoard<T>({
  columns,
  items,
  getItemStage,
  keyExtractor,
  renderCard,
  onCardClick,
  emptyColumnText = (col) => `No ${col.title.toLowerCase()}`,
}: KanbanBoardProps<T>) {
  // Group items by stage
  const itemsByStage = columns.reduce<Record<string, T[]>>((acc, col) => {
    acc[col.id] = [];
    return acc;
  }, {});

  items.forEach((item) => {
    const stage = getItemStage(item);
    if (itemsByStage[stage]) {
      itemsByStage[stage].push(item);
    } else {
      // Fallback for unexpected status
      if (!itemsByStage['_other']) itemsByStage['_other'] = [];
      itemsByStage['_other'].push(item);
    }
  });

  return (
    <div className="kanban-board-container">
      <div className="kanban-board">
        {columns.map((col) => {
          const stageItems = itemsByStage[col.id] || [];
          return (
            <div key={col.id} className="kanban-column" data-stage={col.id}>
              <div
                className="kanban-column__header"
                style={col.accentColor ? { borderTopColor: col.accentColor } : undefined}
              >
                <div className="kanban-column__title-wrap">
                  <span className="kanban-column__title">{col.title}</span>
                  <span className={`kanban-column__badge tone--${col.badgeTone || 'neutral'}`}>
                    {stageItems.length}
                  </span>
                </div>
              </div>

              <div className="kanban-column__content">
                {stageItems.length === 0 ? (
                  <div className="kanban-column__empty">
                    <span>{emptyColumnText(col)}</span>
                  </div>
                ) : (
                  stageItems.map((item) => (
                    <div
                      key={keyExtractor(item)}
                      className={`kanban-card${onCardClick ? ' kanban-card--clickable' : ''}`}
                      onClick={() => onCardClick?.(item)}
                    >
                      {renderCard(item)}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
