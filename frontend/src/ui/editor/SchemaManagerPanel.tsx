import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { StreamTable, type StreamTableItem } from './StreamTable';
import type { SchemaManagerStream } from './types';

interface SchemaManagerPanelProps {
  streams: SchemaManagerStream[];
  notice?: string;
  onEditStream: (schemaRef: string) => void;
  onDeleteStream: (schemaRef: string) => void;
  onUndoDelete: () => void;
  showTitle?: boolean;
}

export function SchemaManagerPanel({
  streams,
  notice,
  onEditStream,
  onDeleteStream,
  onUndoDelete,
  showTitle = true,
}: SchemaManagerPanelProps) {
  const [selectedRef, setSelectedRef] = useState<string | undefined>(() => streams[0]?.schemaRef);
  const [selectedVersionKey, setSelectedVersionKey] = useState<string | undefined>();
  const [copiedKey, setCopiedKey] = useState<string | undefined>();

  useEffect(() => {
    if (streams.length === 0) {
      setSelectedRef(undefined);
      return;
    }
    if (selectedRef && streams.some((s) => s.schemaRef === selectedRef)) return;
    setSelectedRef(streams[0]?.schemaRef);
  }, [streams, selectedRef]);

  const selectedStream = streams.find((s) => s.schemaRef === selectedRef) ?? streams[0];

  useEffect(() => {
    if (!selectedStream || selectedStream.versions.length === 0) {
      setSelectedVersionKey(undefined);
      return;
    }
    if (selectedVersionKey && selectedStream.versions.some((v) => v.key === selectedVersionKey))
      return;
    setSelectedVersionKey(selectedStream.versions[0]?.key);
  }, [selectedStream, selectedVersionKey]);

  const selectedVersion =
    selectedStream?.versions.find((v) => v.key === selectedVersionKey) ??
    selectedStream?.versions[0];

  useEffect(() => {
    if (!copiedKey) return;
    const handle = window.setTimeout(() => setCopiedKey(undefined), 1600);
    return () => window.clearTimeout(handle);
  }, [copiedKey]);

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedKey(key);
    } catch {
      setCopiedKey(undefined);
    }
  };

  // Build stream table items with actions in overflow menu
  const schemaItems: StreamTableItem[] = streams.map((stream) => ({
    id: stream.schemaRef,
    name: stream.name,
    statusDot: stream.isEditing
      ? 'editing'
      : stream.hasDraft
        ? 'draft'
        : stream.latestVersion
          ? 'active'
          : 'none',
    statusLabel: stream.isEditing
      ? 'editing'
      : stream.hasDraft
        ? 'draft'
        : stream.latestVersion
          ? `v${stream.latestVersion}`
          : undefined,
    meta: stream.updatedAtLabel,
    actions: [
      {
        label: stream.isEditing ? 'Continue editing' : 'Edit',
        onClick: () => onEditStream(stream.schemaRef),
      },
      {
        label: 'Delete',
        onClick: () => onDeleteStream(stream.schemaRef),
        disabled: stream.deleteDisabled,
        disabledReason: stream.deleteDisabledReason,
      },
    ],
  }));

  // Build version table items
  const versionItems: StreamTableItem[] = (selectedStream?.versions ?? []).map((version) => ({
    id: version.key,
    name: `v${version.version}`,
    statusDot: version.isLatest ? 'active' : version.isAppliedToDiagram ? 'editing' : 'none',
    statusLabel: version.isLatest ? 'latest' : version.isAppliedToDiagram ? 'applied' : undefined,
    meta: version.publishedAtLabel,
  }));

  if (streams.length === 0) {
    return (
      <div className="flex flex-col gap-2.5 h-full">
        {showTitle ? <div className="text-base font-bold">Schemas</div> : null}
        <div className="text-sm text-muted-foreground">No personal schemas yet.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {showTitle ? <div className="text-base font-bold">Schemas</div> : null}

      {/* Notice banner */}
      {notice && (
        <div className="flex items-center justify-between gap-2.5 text-sm text-warning/90 px-3 py-2 rounded-md border border-warning/20 bg-warning/5">
          <span>{notice}</span>
          <Button variant="outline" size="sm" onClick={onUndoDelete}>
            Undo
          </Button>
        </div>
      )}

      {/* Schema picker */}
      <StreamTable
        items={schemaItems}
        selectedId={selectedRef}
        onSelect={setSelectedRef}
        onOpen={(id) => onEditStream(id)}
        emptyLabel="No schemas."
      />

      {/* Detail strip */}
      {selectedStream && (
        <div className="flex flex-col gap-2.5 border-t border-border bg-muted/20 rounded-md p-3 flex-1 min-h-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-bold">{selectedStream.name}</div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => onEditStream(selectedStream.schemaRef)}>
                {selectedStream.isEditing ? 'Continue editing' : 'Edit'}
              </Button>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            {selectedStream.hasDraft
              ? `Draft${selectedStream.draftBaseVersion ? ` based on v${selectedStream.draftBaseVersion}` : ''}`
              : selectedStream.latestVersion
                ? `Latest: v${selectedStream.latestVersion}`
                : 'Unpublished'}
            {selectedStream.inUse ? ' • In use' : ''}
          </div>

          {/* Version browser */}
          {selectedStream.versions.length > 0 && (
            <div className="flex flex-col gap-2 flex-1 min-h-0">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Published versions
              </div>
              <StreamTable
                items={versionItems}
                selectedId={selectedVersionKey}
                onSelect={setSelectedVersionKey}
                emptyLabel="No published versions."
              />

              {selectedVersion && (
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">v{selectedVersion.version}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copyText(selectedVersion.previewText, selectedVersion.key)
                      }
                    >
                      {copiedKey === selectedVersion.key ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  {selectedVersion.summaryLines.length > 0 && (
                    <ul className="m-0 pl-4.5 flex flex-col gap-1.5">
                      {selectedVersion.summaryLines.map((line) => (
                        <li key={line} className="text-sm leading-snug">
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                  <pre className="m-0 p-2.5 rounded-md bg-[rgba(8,10,16,0.82)] border border-border text-xs leading-relaxed text-foreground/92 max-h-48 overflow-auto whitespace-pre">
                    <code>{selectedVersion.previewText}</code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
