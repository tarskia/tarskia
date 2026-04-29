import { Copy, Focus, Move, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../components/ui/button';
import type { InspectorEntityViewModel, InspectorStructureOptionView } from '../shell/view-models';

export interface NodeContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

interface NodeContextMenuProps {
  state: NodeContextMenuState;
  viewModel: InspectorEntityViewModel | undefined;
  onClose: () => void;
  onRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onFocusView?: (id: string) => void;
  onCreateChild: (parentId: string, typeId: string) => void;
  onCreateSibling: (siblingId: string, typeId: string) => void;
  onMove: (id: string, parentId?: string) => void;
}

function MenuDivider() {
  return <div className="h-px bg-border my-1" />;
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  variant = 'default',
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className={`h-auto w-full justify-start gap-2.5 px-3 py-1.5 text-left text-[13px] font-normal disabled:opacity-35 ${
        variant === 'danger'
          ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
          : 'text-foreground/90 hover:bg-surface-hover'
      }`}
    >
      <Icon size={14} className="shrink-0 opacity-60" />
      {label}
    </Button>
  );
}

function SubMenu({
  icon: Icon,
  label,
  options,
  onSelect,
}: {
  icon: React.ElementType;
  label: string;
  options: InspectorStructureOptionView[];
  onSelect: (optionId: string) => void;
}) {
  if (options.length === 0) return null;

  if (options.length === 1) {
    return (
      <MenuItem
        icon={Icon}
        label={`${label} ${options[0].label}`}
        onClick={() => onSelect(options[0].id)}
      />
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2.5 px-3 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        <Icon size={12} className="shrink-0 opacity-50" />
        {label}
      </div>
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSelect(option.id)}
          className="h-auto w-full justify-start rounded-md py-1.5 pl-9 pr-3 text-left text-[13px] font-normal text-foreground/90"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function NodeContextMenu({
  state,
  viewModel,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
  onFocusView,
  onCreateChild,
  onCreateSibling,
  onMove,
}: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as HTMLElement)) {
        onClose();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  if (!viewModel) return null;

  const hasChildren = viewModel.childTypeOptions.length > 0;
  const hasSiblings = viewModel.siblingTypeOptions.length > 0;
  const hasMoveTargets = viewModel.moveParentOptions.length > 0;
  const canFocus =
    viewModel.selectedChildCount > 0 &&
    viewModel.canFocusView &&
    !viewModel.isFocusedEntity &&
    onFocusView;

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[200px] max-w-[280px] rounded-lg border border-border bg-background/95 backdrop-blur-md shadow-[var(--shadow-dropdown)] py-1.5 px-1"
      style={{ left: state.x, top: state.y }}
    >
      <MenuItem
        icon={Pencil}
        label="Rename"
        onClick={() => {
          onRename(state.nodeId);
          onClose();
        }}
      />
      <MenuItem
        icon={Copy}
        label="Duplicate"
        onClick={() => {
          onDuplicate(state.nodeId);
          onClose();
        }}
      />

      {canFocus && (
        <MenuItem
          icon={Focus}
          label="Focus view"
          onClick={() => {
            onFocusView(state.nodeId);
            onClose();
          }}
        />
      )}

      {(hasChildren || hasSiblings) && (
        <>
          <MenuDivider />
          {hasChildren && (
            <SubMenu
              icon={Plus}
              label="Add child"
              options={viewModel.childTypeOptions}
              onSelect={(typeId) => {
                onCreateChild(state.nodeId, typeId);
                onClose();
              }}
            />
          )}
          {hasSiblings && (
            <SubMenu
              icon={Plus}
              label="Add sibling"
              options={viewModel.siblingTypeOptions}
              onSelect={(typeId) => {
                onCreateSibling(state.nodeId, typeId);
                onClose();
              }}
            />
          )}
        </>
      )}

      {hasMoveTargets && (
        <>
          <MenuDivider />
          <SubMenu
            icon={Move}
            label="Move to"
            options={viewModel.moveParentOptions}
            onSelect={(parentId) => {
              onMove(state.nodeId, parentId || undefined);
              onClose();
            }}
          />
        </>
      )}

      <MenuDivider />
      <MenuItem
        icon={Trash2}
        label="Delete"
        onClick={() => {
          onDelete(state.nodeId);
          onClose();
        }}
        variant="danger"
      />
    </div>
  );
}
