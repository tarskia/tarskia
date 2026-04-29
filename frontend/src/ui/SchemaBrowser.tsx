import { Button } from '../components/ui/button';
import { SchemaManagerPanel } from './editor/SchemaManagerPanel';
import type { SchemaManagerStream } from './editor/types';
import { SidebarPanelFrame } from './SidebarPanelFrame';

interface SchemaBrowserProps {
  streams: SchemaManagerStream[];
  notice?: string;
  onEditStream: (schemaRef: string) => void;
  onDeleteStream: (schemaRef: string) => void;
  onUndoDelete: () => void;
  onStartNew?: () => void;
}

export function SchemaBrowser({
  streams,
  notice,
  onEditStream,
  onDeleteStream,
  onUndoDelete,
  onStartNew,
}: SchemaBrowserProps) {
  return (
    <SidebarPanelFrame
      title="Schemas"
      actions={
        onStartNew ? (
          <Button variant="ghost" size="sm" className="text-accent" onClick={onStartNew}>
            + New
          </Button>
        ) : null
      }
      contentClassName="space-y-2 px-3 pb-3"
    >
      <SchemaManagerPanel
        streams={streams}
        notice={notice}
        onEditStream={onEditStream}
        onDeleteStream={onDeleteStream}
        onUndoDelete={onUndoDelete}
        showTitle={false}
      />
    </SidebarPanelFrame>
  );
}
