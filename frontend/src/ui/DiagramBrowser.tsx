import { Download, FolderOpen, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DtoGalleryDiagramSummaryResponse } from '../api/generated/model';
import { Button } from '../components/ui/button';
import { StreamTable, type StreamTableItem } from './editor/StreamTable';
import type { DiagramManagerStream } from './editor/types';
import { SidebarPanelFrame } from './SidebarPanelFrame';

interface DiagramBrowserProps {
  streams: DiagramManagerStream[];
  exampleDiagrams?: DtoGalleryDiagramSummaryResponse[];
  loadingExampleKey?: string;
  notice?: string;
  onOpenStream?: (streamId: string) => void;
  onRestoreRevision?: (revisionId: string) => void;
  onStartNew?: () => void;
  onImportDiagram?: (file: File) => void;
  onExportDiagram?: () => void;
  onLoadExampleDiagram?: (entry: { namespace: string; slug: string; title?: string }) => void;
}

const buildExampleKey = (entry: { namespace?: string; slug?: string }) =>
  `${entry.namespace ?? ''}/${entry.slug ?? ''}`;

const getExampleRows = (
  exampleDiagrams: DtoGalleryDiagramSummaryResponse[],
): (DtoGalleryDiagramSummaryResponse & { namespace: string; slug: string })[] =>
  exampleDiagrams.filter(
    (diagram): diagram is DtoGalleryDiagramSummaryResponse & { namespace: string; slug: string } =>
      Boolean(diagram.namespace && diagram.slug),
  );

export function DiagramBrowser({
  streams,
  exampleDiagrams = [],
  loadingExampleKey,
  notice,
  onOpenStream,
  onRestoreRevision,
  onStartNew,
  onImportDiagram,
  onExportDiagram,
  onLoadExampleDiagram,
}: DiagramBrowserProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const activeStreamId = streams.find((stream) => stream.isActive)?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => activeStreamId ?? streams[0]?.id,
  );
  const [selectedRevId, setSelectedRevId] = useState<string | undefined>();
  const exampleRows = getExampleRows(exampleDiagrams);
  const previousActiveStreamIdRef = useRef<string | undefined>(activeStreamId);

  const selectedStream = streams.find((s) => s.id === selectedId);
  const selectedRev = selectedStream?.revisions.find((r) => r.id === selectedRevId);

  useEffect(() => {
    const activeStreamChanged = previousActiveStreamIdRef.current !== activeStreamId;
    const selectionMissing = selectedId
      ? !streams.some((stream) => stream.id === selectedId)
      : true;

    if (activeStreamChanged || selectionMissing) {
      setSelectedId(activeStreamId ?? streams[0]?.id);
      setSelectedRevId(undefined);
    }

    previousActiveStreamIdRef.current = activeStreamId;
  }, [activeStreamId, selectedId, streams]);

  const items: StreamTableItem[] = streams.map((s) => ({
    id: s.id,
    name: s.hasPendingNameChange && s.draftName ? `${s.name} → ${s.draftName}` : s.name,
    statusDot: s.isActive ? 'active' : s.hasDraft ? 'draft' : 'none',
    statusLabel: s.isActive ? 'open' : undefined,
    meta: s.updatedAtLabel,
  }));

  const revItems: StreamTableItem[] = (selectedStream?.revisions ?? []).map((r) => ({
    id: r.id,
    name: `v${r.versionNumber}`,
    statusDot: r.isLatest ? 'active' : 'none',
    statusLabel: r.isLatest ? 'latest' : r.shortId,
    meta: r.checkpointedAtLabel,
  }));

  return (
    <SidebarPanelFrame
      title="Diagrams"
      actions={
        <>
          {onImportDiagram && (
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload size={12} />
              Import
            </Button>
          )}
          {onExportDiagram && (
            <Button variant="ghost" size="sm" onClick={onExportDiagram}>
              <Download size={12} />
              Download
            </Button>
          )}
          {onStartNew && (
            <Button variant="ghost" size="sm" className="text-accent" onClick={onStartNew}>
              + New
            </Button>
          )}
        </>
      }
      contentClassName="space-y-2 px-3 pb-3"
    >
      {notice ? (
        <div className="whitespace-pre-line rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-sm text-warning/90">
          {notice}
        </div>
      ) : null}
      <StreamTable
        items={items}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOpen={(id) => onOpenStream?.(id)}
        emptyLabel="No diagrams."
      />
      {selectedStream && !selectedStream.isActive && onOpenStream ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onOpenStream(selectedStream.id)}
        >
          <FolderOpen size={12} />
          Open selected
        </Button>
      ) : null}

      {selectedStream && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Revisions
          </div>
          <StreamTable
            items={revItems}
            selectedId={selectedRevId}
            onSelect={setSelectedRevId}
            emptyLabel="No checkpoints."
          />
          {selectedRev && (
            <Button
              variant="outline"
              size="sm"
              className="self-start mt-1"
              onClick={() => onRestoreRevision?.(selectedRev.id)}
            >
              Restore to draft
            </Button>
          )}
        </div>
      )}
      {onLoadExampleDiagram && exampleRows.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Examples</div>
          <div className="flex flex-col">
            {exampleRows.map((diagram, index) => {
              const key = buildExampleKey(diagram);
              const isLoading = loadingExampleKey === key;
              return (
                <div
                  key={key}
                  className={`grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3 py-2 ${
                    index > 0 ? 'border-t border-border' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {diagram.title?.trim() || diagram.slug}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {diagram.namespace}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isLoading}
                    className="w-full justify-center"
                    title="Open this example as a normal editable diagram."
                    onClick={() =>
                      onLoadExampleDiagram({
                        namespace: diagram.namespace,
                        slug: diagram.slug,
                        title: diagram.title,
                      })
                    }
                  >
                    {isLoading ? 'Opening…' : 'Open'}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept=".yaml,.yml,application/x-yaml,application/yaml,text/yaml,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onImportDiagram?.(file);
            e.currentTarget.value = '';
          }
        }}
      />
    </SidebarPanelFrame>
  );
}
