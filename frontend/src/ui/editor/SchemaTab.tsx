import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import type { DiagnosticView } from '../../shell/view-models';
import { formatDiagnosticMessage, locateSchemaDiagnostic } from '../schema-diagnostic-location';
import { SchemaTextarea } from './SchemaTextarea';
import type { SchemaDraftHighlight } from './types';

interface SchemaTabProps {
  schemaDraftText: string;
  schemaDraftName: string;
  schemaDraftVersionLabel: string;
  onSchemaDraftChange: (next: string) => void;
  onSchemaDraftNameChange: (next: string) => void;
  onResetSchemaDraft: () => void;
  resetDraftLabel: string;
  draftSchemaDiagnostics: DiagnosticView[];
  schemaDraftNoticeLines: string[];
  schemaStateTone: 'valid' | 'invalid' | 'pending';
  schemaStateLines: string[];
  diagramStateTone: 'valid' | 'invalid' | 'pending';
  diagramStateLines: string[];
  schemaDraftHighlights: SchemaDraftHighlight[];
  saveDraftLabel: string;
  saveDraftDisabled?: boolean;
  saveDraftDisabledReason?: string;
  onSaveDraft: () => void;
  canPublish: boolean;
  publishLabel: string;
  onPublish: () => void;
  showPublishedDiagramAction: boolean;
  publishedDiagramActionLabel?: string;
  publishedDiagramActionDisabled: boolean;
  publishedDiagramActionDisabledReason?: string;
  onApplyPublishedSchema: () => void;
}

type SummaryTone = 'valid' | 'invalid' | 'pending';

const STATUS_META: Record<
  SummaryTone,
  {
    label: string;
    pillClassName: string;
    Icon: typeof CheckCircle2;
  }
> = {
  valid: {
    label: 'Ready',
    pillClassName:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-100 shadow-[var(--inset-shadow-glow)]',
    Icon: CheckCircle2,
  },
  invalid: {
    label: 'Issue',
    pillClassName:
      'border-amber-500/30 bg-amber-500/10 text-amber-100 shadow-[var(--inset-shadow-glow)]',
    Icon: AlertCircle,
  },
  pending: {
    label: 'Pending',
    pillClassName: 'border-sky-500/30 bg-sky-500/10 text-sky-100 shadow-[var(--inset-shadow-glow)]',
    Icon: Clock3,
  },
};

export function SchemaTab({
  schemaDraftText,
  schemaDraftName,
  schemaDraftVersionLabel,
  onSchemaDraftChange,
  onSchemaDraftNameChange,
  onResetSchemaDraft,
  resetDraftLabel,
  draftSchemaDiagnostics,
  schemaDraftNoticeLines,
  schemaStateTone,
  schemaStateLines: _schemaStateLines,
  diagramStateTone,
  diagramStateLines: _diagramStateLines,
  schemaDraftHighlights,
  saveDraftLabel,
  saveDraftDisabled,
  saveDraftDisabledReason,
  onSaveDraft,
  canPublish,
  publishLabel,
  onPublish,
  showPublishedDiagramAction,
  publishedDiagramActionLabel,
  publishedDiagramActionDisabled,
  publishedDiagramActionDisabledReason,
  onApplyPublishedSchema,
}: SchemaTabProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const draftSchemaIssue = draftSchemaDiagnostics.find((d) => d.severity === 'error');
  const primaryDraftLocation = useMemo(
    () =>
      draftSchemaIssue ? locateSchemaDiagnostic(schemaDraftText, draftSchemaIssue) : undefined,
    [draftSchemaIssue, schemaDraftText],
  );
  const primaryDraftLocationLabel = primaryDraftLocation
    ? `${primaryDraftLocation.displayPath} · line ${primaryDraftLocation.startLine}${
        primaryDraftLocation.endLine > primaryDraftLocation.startLine
          ? `-${primaryDraftLocation.endLine}`
          : ''
      }`
    : undefined;
  const visibleDraftHighlights = primaryDraftLocation ? [] : schemaDraftHighlights;
  const _schemaMeta = STATUS_META[schemaStateTone];
  const _diagramMeta = STATUS_META[diagramStateTone];
  const _draftNoticeSummary =
    schemaDraftNoticeLines.length === 0
      ? undefined
      : schemaDraftNoticeLines.length === 1
        ? schemaDraftNoticeLines[0]
        : `${schemaDraftNoticeLines[0]} +${schemaDraftNoticeLines.length - 1} more`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-surface/60 px-4 py-2 z-10 relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Input
              className="w-[180px] border-transparent bg-transparent px-2 py-1 font-semibold hover:border-border/50 focus:bg-surface"
              type="text"
              aria-label="Schema name"
              value={schemaDraftName}
              onChange={(event) => onSchemaDraftNameChange(event.target.value)}
              spellCheck={false}
            />
            <span className="whitespace-nowrap rounded border border-info/20 bg-info/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-info">
              {schemaDraftVersionLabel}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onSaveDraft}
              disabled={saveDraftDisabled}
              title={saveDraftDisabledReason}
            >
              {saveDraftLabel}
            </Button>
            {showPublishedDiagramAction ? (
              <span title={publishedDiagramActionDisabledReason}>
                <Button
                  size="sm"
                  onClick={onApplyPublishedSchema}
                  disabled={publishedDiagramActionDisabled}
                >
                  {publishedDiagramActionLabel}
                </Button>
              </span>
            ) : (
              <Button size="sm" onClick={onPublish} disabled={!canPublish}>
                {publishLabel}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onResetSchemaDraft}>
              {resetDraftLabel}
            </Button>
          </div>
        </div>

        {primaryDraftLocation ? (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-500/20 bg-amber-500/8 px-3 py-1.5 text-xs text-foreground/90 shadow-sm">
            <div className="min-w-0">
              <span className="font-medium">
                {formatDiagnosticMessage(draftSchemaIssue?.message ?? '')}
              </span>
              {primaryDraftLocationLabel ? (
                <span className="ml-2 text-xs text-foreground/70">{primaryDraftLocationLabel}</span>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const target = textareaRef.current;
                if (!target) return;
                const computed = window.getComputedStyle(target);
                const fontSize = Number.parseFloat(computed.fontSize) || 14;
                const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.4;
                const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
                const targetTop = paddingTop + (primaryDraftLocation.startLine - 1) * lineHeight;
                target.scrollTop = Math.max(0, targetTop - lineHeight * 2);
                target.focus();
                target.setSelectionRange(
                  primaryDraftLocation.startOffset,
                  primaryDraftLocation.endOffset,
                );
              }}
            >
              Locate issue
            </Button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 flex flex-col p-3">
        <SchemaTextarea
          value={schemaDraftText}
          onChange={onSchemaDraftChange}
          highlights={visibleDraftHighlights}
          errorHighlight={
            primaryDraftLocation
              ? { startLine: primaryDraftLocation.startLine, endLine: primaryDraftLocation.endLine }
              : null
          }
          textareaRef={textareaRef}
        />
      </div>
    </div>
  );
}

function _StatusPill({
  tone,
  label,
  Icon,
}: {
  tone: SummaryTone;
  label: string;
  Icon: typeof CheckCircle2;
}) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide backdrop-blur-sm ${STATUS_META[tone].pillClassName}`}
    >
      <Icon size={12} className="shrink-0" />
      <span>{label}</span>
    </div>
  );
}
