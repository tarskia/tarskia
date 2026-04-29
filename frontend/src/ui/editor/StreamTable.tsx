import { type KeyboardEvent, useCallback, useRef } from 'react';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

export type StreamTableStatusDot = 'active' | 'draft' | 'editing' | 'none';

export interface StreamTableItem {
  id: string;
  name: string;
  statusDot: StreamTableStatusDot;
  statusLabel?: string;
  meta?: string;
  actions?: StreamTableAction[];
}

export interface StreamTableAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

interface StreamTableProps {
  items: StreamTableItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onOpen?: (id: string) => void;
  emptyLabel?: string;
}

const DOT_COLORS: Record<StreamTableStatusDot, string> = {
  active: 'bg-success',
  draft: 'bg-warning',
  editing: 'bg-info',
  none: 'bg-transparent',
};

export function StreamTable({
  items,
  selectedId,
  onSelect,
  onOpen,
  emptyLabel = 'No items.',
}: StreamTableProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const focusItemButton = useCallback((itemId: string) => {
    listRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-stream-item-id="${itemId}"]`)
      ?.focus();
  }, []);

  const handleItemKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, itemId: string) => {
      if (items.length === 0) return;
      const currentIdx = items.findIndex((item) => item.id === itemId);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, items.length - 1);
        onSelect(items[next].id);
        focusItemButton(items[next].id);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        onSelect(items[prev].id);
        focusItemButton(items[prev].id);
      } else if (e.key === 'Enter' && onOpen) {
        e.preventDefault();
        onOpen(itemId);
      }
    },
    [focusItemButton, items, onOpen, onSelect],
  );

  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground py-3 px-2">{emptyLabel}</div>;
  }

  return (
    <div
      ref={listRef}
      className="flex flex-col rounded-md border border-border overflow-hidden bg-muted/20"
    >
      {items.map((item) => {
        const isSelected = item.id === selectedId;
        return (
          <div
            key={item.id}
            className={`flex items-start gap-3 px-3 py-2 cursor-pointer border-l-2 transition-colors ${
              isSelected
                ? 'border-l-accent bg-accent/8'
                : 'border-l-transparent hover:bg-surface-hover'
            } ${item.id !== items[0].id ? 'border-t border-t-border' : ''}`}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-stream-item-id={item.id}
              className="h-auto min-w-0 flex-1 justify-start gap-3 whitespace-normal rounded-none px-0 py-0 text-left font-normal hover:bg-transparent hover:text-inherit"
              aria-pressed={isSelected}
              onClick={() => onSelect(item.id)}
              onDoubleClick={() => onOpen?.(item.id)}
              onKeyDown={(event) => handleItemKeyDown(event, item.id)}
            >
              {/* Status dot */}
              {item.statusDot !== 'none' && (
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_COLORS[item.statusDot]}`}
                />
              )}

              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span className="min-w-0 max-w-full truncate text-sm font-medium">{item.name}</span>
                <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {item.statusLabel ? (
                    <span className="whitespace-nowrap">{item.statusLabel}</span>
                  ) : null}
                  {item.meta ? <span className="min-w-0 truncate">{item.meta}</span> : null}
                </span>
              </span>
            </Button>

            {/* Overflow menu */}
            {item.actions && item.actions.length > 0 && (
              <StreamOverflowMenu actions={item.actions} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StreamOverflowMenu({ actions }: { actions: StreamTableAction[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground">
          ⋮
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
            disabled={action.disabled}
            title={action.disabledReason}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
