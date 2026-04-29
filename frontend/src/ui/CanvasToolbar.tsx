import { ChevronsDownUp, ChevronsUpDown, Copy, Focus, LayoutGrid, Undo2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import type { SchemaOptionView } from '../shell/view-models';
import { SchemasPopover } from './SchemasPopover';

interface CanvasToolbarProps {
  onCenter: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onCopyDiagramView: () => void | Promise<void>;
  canCopyDiagramView: boolean;
  isCopyingDiagramView?: boolean;
  onFocusView?: () => void;
  onResetFocusView?: () => void;
  availableSchemas: SchemaOptionView[];
  onToggleSchema: (schemaRef: string) => void;
  showCopy?: boolean;
  showSchemas?: boolean;
  centerOffset?: number;
}

export function CanvasToolbar({
  onCenter,
  onExpandAll,
  onCollapseAll,
  onCopyDiagramView,
  canCopyDiagramView,
  isCopyingDiagramView = false,
  onFocusView,
  onResetFocusView,
  availableSchemas,
  onToggleSchema,
  showCopy = true,
  showSchemas = true,
  centerOffset = 0,
}: CanvasToolbarProps) {
  const centerTitle = 'Centre the diagram in the viewport';
  const focusActionClass =
    'rounded-none border-0 bg-transparent px-1 text-accent shadow-none hover:bg-transparent hover:text-accent focus-visible:ring-0';
  const exitFocusActionClass =
    'rounded-none border-0 bg-transparent px-1 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:ring-0';

  return (
    <div
      className="absolute bottom-3 -translate-x-1/2 z-30 flex items-center gap-1 rounded-lg border border-foreground/15 bg-surface px-1.5 py-1 shadow-[var(--shadow-toolbar)]"
      style={{ left: `calc(50% + ${centerOffset}px)` }}
    >
      {/* Layout actions */}
      <Button variant="ghost" size="sm" onClick={onCenter} title={centerTitle}>
        <LayoutGrid size={13} />
        Centre
      </Button>
      <Button variant="ghost" size="sm" onClick={onExpandAll} title="Expand all nodes">
        <ChevronsUpDown size={13} />
        Expand all
      </Button>
      <Button variant="ghost" size="sm" onClick={onCollapseAll} title="Collapse all nodes">
        <ChevronsDownUp size={13} />
        Collapse all
      </Button>

      {showCopy ? (
        <>
          <div className="w-px h-4 bg-border mx-0.5" />

          <Button
            variant="ghost"
            size="sm"
            onClick={onCopyDiagramView}
            disabled={!canCopyDiagramView || isCopyingDiagramView}
            title={
              canCopyDiagramView
                ? 'Copy the current diagram view to the clipboard as PNG'
                : 'Clipboard image copy unavailable'
            }
          >
            <Copy size={13} />
            Copy to clipboard
          </Button>
        </>
      ) : null}

      {/* Schemas */}
      {showSchemas ? (
        <>
          <div className="w-px h-4 bg-border mx-0.5" />
          <SchemasPopover availableSchemas={availableSchemas} onToggleSchema={onToggleSchema} />
        </>
      ) : null}
      {/* Focus controls */}
      {onFocusView || onResetFocusView ? (
        <>
          <div className="w-px h-4 bg-border mx-0.5" />
          {onFocusView ? (
            <Button variant="accent" size="sm" className={focusActionClass} onClick={onFocusView}>
              <Focus size={12} />
              Focus
            </Button>
          ) : null}
          {onResetFocusView ? (
            <Button
              variant="ghost"
              size="sm"
              className={exitFocusActionClass}
              onClick={onResetFocusView}
            >
              <Undo2 size={12} />
              Exit Focus
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
