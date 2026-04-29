import { Download, FilePlus, FolderOpen, RotateCcw, Save, Settings, Upload } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

interface TopBarProps {
  onExport: () => void;
  onImport: (file: File) => void;
  diagramName?: string;
  onDiagramNameChange?: (name: string) => void;
  diagramStatusLabel?: string;
  onCheckpointDiagram?: () => void;
  checkpointDiagramLabel?: string;
  checkpointDiagramDisabled?: boolean;
  checkpointDiagramDisabledReason?: string;
  checkpointDiagramVisible?: boolean;
  saveAsNewDiagramLabel?: string;
  saveAsNewDiagramDisabled?: boolean;
  saveAsNewDiagramDisabledReason?: string;
  onSaveAsNewDiagram?: () => void;
  onStartNewDiagram?: () => void;
  onRevertDiagramName?: () => void;
  onOpenDiagramManager?: () => void;
  showDevToolbox: boolean;
  onToggleDevToolbox: () => void;
}

export function TopBar({
  onExport,
  onImport,
  diagramName,
  onDiagramNameChange,
  diagramStatusLabel,
  onCheckpointDiagram,
  checkpointDiagramLabel = 'Checkpoint',
  checkpointDiagramDisabled = false,
  checkpointDiagramDisabledReason,
  checkpointDiagramVisible = true,
  saveAsNewDiagramLabel = 'Save as new',
  saveAsNewDiagramDisabled = false,
  saveAsNewDiagramDisabledReason,
  onSaveAsNewDiagram,
  onStartNewDiagram,
  onRevertDiagramName,
  onOpenDiagramManager,
  showDevToolbox,
  onToggleDevToolbox,
}: TopBarProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <header className="flex items-center gap-3 px-4 py-2 bg-background/90 backdrop-blur-xl border-b border-border z-50 min-h-[48px]">
      {/* Brand */}
      <div className="font-bold text-xs tracking-widest uppercase text-foreground shrink-0">
        Semantic Diagrammer
      </div>

      {/* Diagram name */}
      {diagramName !== undefined && (
        <div className="flex items-center gap-2 ml-2 border-l border-border pl-3">
          <Input
            className="min-w-[180px] max-w-[280px] rounded-sm bg-transparent px-2 py-1"
            type="text"
            aria-label="Diagram name"
            value={diagramName}
            onChange={(e) => onDiagramNameChange?.(e.target.value)}
            spellCheck={false}
          />
          {diagramStatusLabel && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {diagramStatusLabel}
            </span>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Primary actions */}
      <div className="flex items-center gap-1.5">
        {onCheckpointDiagram && checkpointDiagramVisible && (
          <Button
            variant="accent"
            onClick={onCheckpointDiagram}
            disabled={checkpointDiagramDisabled}
            title={checkpointDiagramDisabledReason ?? checkpointDiagramLabel}
          >
            <Save size={14} />
            <span className="hidden sm:inline">{checkpointDiagramLabel}</span>
          </Button>
        )}

        {onSaveAsNewDiagram && (
          <Button
            variant="outline"
            onClick={onSaveAsNewDiagram}
            disabled={saveAsNewDiagramDisabled}
            title={saveAsNewDiagramDisabledReason ?? saveAsNewDiagramLabel}
          >
            <FilePlus size={14} />
            <span className="hidden sm:inline">Save as new</span>
          </Button>
        )}

        {onRevertDiagramName && (
          <Button
            variant="outline"
            onClick={onRevertDiagramName}
            title="Revert pending name change"
          >
            <RotateCcw size={14} />
          </Button>
        )}

        <div className="w-px h-5 bg-border mx-1" />

        <Button variant="outline" onClick={() => fileRef.current?.click()} title="Import YAML">
          <Upload size={14} />
          <span className="hidden md:inline">Import</span>
        </Button>

        <Button variant="outline" onClick={onExport} title="Download YAML">
          <Download size={14} />
          <span className="hidden md:inline">Download</span>
        </Button>

        {onStartNewDiagram && (
          <Button variant="outline" onClick={onStartNewDiagram} title="Start a new diagram">
            <FilePlus size={14} />
            <span className="hidden md:inline">New</span>
          </Button>
        )}

        {onOpenDiagramManager && (
          <Button variant="outline" onClick={onOpenDiagramManager} title="Diagram manager">
            <FolderOpen size={14} />
            <span className="hidden md:inline">Diagrams</span>
          </Button>
        )}

        <div className="w-px h-5 bg-border mx-1" />

        <Button
          variant={showDevToolbox ? 'accent' : 'outline'}
          onClick={onToggleDevToolbox}
          title={showDevToolbox ? 'Hide dev panel' : 'Show dev panel'}
        >
          <Settings size={14} />
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".yaml,.yml,application/x-yaml,application/yaml,text/yaml,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onImport(file);
            e.currentTarget.value = '';
          }
        }}
      />
    </header>
  );
}
