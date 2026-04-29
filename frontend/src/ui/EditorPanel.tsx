import {
  AlertCircle,
  BookMarked,
  BookOpenText,
  CheckCircle2,
  Clock3,
  LibraryBig,
  Network,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import type { DiagnosticView } from '../shell/view-models';
import { CookbookPanel } from './editor/CookbookPanel';
import { DependencyPanel } from './editor/DependencyPanel';
import { ReferencePanel } from './editor/ReferencePanel';
import { SchemaManagerPanel } from './editor/SchemaManagerPanel';
import { SchemaTab } from './editor/SchemaTab';
import type {
  SchemaCookbookRecipe,
  SchemaDependency,
  SchemaDraftHighlight,
  SchemaManagerStream,
  SchemaReferenceSection,
} from './editor/types';

interface EditorPanelProps {
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
  referencePanelMode: 'cookbook' | 'dependencies' | 'reference' | 'schemas' | undefined;
  onSelectReferencePanel: (mode: 'cookbook' | 'dependencies' | 'reference' | 'schemas') => void;
  schemaCookbookRecipes: SchemaCookbookRecipe[];
  canInsertCookbook: boolean;
  schemaCookbookDisabledReason?: string;
  onInsertSchemaCookbookRecipe: (recipeId: string) => void;
  schemaDependencies: SchemaDependency[];
  schemaReferenceSections: SchemaReferenceSection[];
  schemaManagerStreams: SchemaManagerStream[];
  schemaManagerNotice?: string;
  onEditSchemaStream: (schemaRef: string) => void;
  onDeleteSchemaStream: (schemaRef: string) => void;
  onUndoDeleteSchemaStream: () => void;
}

const REF_MODES = [
  { key: 'cookbook', label: 'Cookbook', shortLabel: 'Cook', Icon: BookOpenText },
  { key: 'dependencies', label: 'Imports', shortLabel: 'Deps', Icon: Network },
  { key: 'reference', label: 'Reference', shortLabel: 'Ref', Icon: BookMarked },
  { key: 'schemas', label: 'Saved', shortLabel: 'Save', Icon: LibraryBig },
] as const;

const CHECK_META = {
  valid: {
    label: 'Ready',
    Icon: CheckCircle2,
    accentClassName: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-100',
    chipClassName: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  },
  invalid: {
    label: 'Issue',
    Icon: AlertCircle,
    accentClassName: 'border-amber-500/20 bg-amber-500/8 text-amber-100',
    chipClassName: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  },
  pending: {
    label: 'Pending',
    Icon: Clock3,
    accentClassName: 'border-sky-500/20 bg-sky-500/8 text-sky-100',
    chipClassName: 'border-sky-500/30 bg-sky-500/10 text-sky-100',
  },
} as const;

export function EditorPanel(props: EditorPanelProps) {
  const { referencePanelMode, onSelectReferencePanel, ...rest } = props;

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden rounded-xl border border-border bg-background">
      <div className="min-w-0 flex-1 flex flex-col border-r border-border bg-surface">
        <SchemaTab
          schemaDraftText={rest.schemaDraftText}
          schemaDraftName={rest.schemaDraftName}
          schemaDraftVersionLabel={rest.schemaDraftVersionLabel}
          onSchemaDraftChange={rest.onSchemaDraftChange}
          onSchemaDraftNameChange={rest.onSchemaDraftNameChange}
          onResetSchemaDraft={rest.onResetSchemaDraft}
          resetDraftLabel={rest.resetDraftLabel}
          draftSchemaDiagnostics={rest.draftSchemaDiagnostics}
          schemaDraftNoticeLines={rest.schemaDraftNoticeLines}
          schemaStateTone={rest.schemaStateTone}
          schemaStateLines={rest.schemaStateLines}
          diagramStateTone={rest.diagramStateTone}
          diagramStateLines={rest.diagramStateLines}
          schemaDraftHighlights={rest.schemaDraftHighlights}
          saveDraftLabel={rest.saveDraftLabel}
          saveDraftDisabled={rest.saveDraftDisabled}
          saveDraftDisabledReason={rest.saveDraftDisabledReason}
          onSaveDraft={rest.onSaveDraft}
          canPublish={rest.canPublish}
          publishLabel={rest.publishLabel}
          onPublish={rest.onPublish}
          showPublishedDiagramAction={rest.showPublishedDiagramAction}
          publishedDiagramActionLabel={rest.publishedDiagramActionLabel}
          publishedDiagramActionDisabled={rest.publishedDiagramActionDisabled}
          publishedDiagramActionDisabledReason={rest.publishedDiagramActionDisabledReason}
          onApplyPublishedSchema={rest.onApplyPublishedSchema}
        />
      </div>

      <aside className="flex min-h-0 w-80 shrink-0 flex-col bg-surface shadow-sm">
        <nav
          aria-label="Context tools"
          className="flex shrink-0 items-center justify-between gap-1 border-b border-border bg-muted/10 p-2 overflow-x-auto"
        >
          {REF_MODES.map(({ key, label, shortLabel, Icon }) => {
            const isActive = referencePanelMode === key;
            return (
              <Button
                key={key}
                type="button"
                variant="ghost"
                size="sm"
                className={`flex-1 rounded px-2 py-1.5 ${
                  isActive
                    ? 'border border-accent/20 bg-accent/15 text-foreground shadow-[var(--inset-shadow-glow)] hover:bg-accent/15 hover:text-foreground'
                    : 'border border-transparent text-muted-foreground hover:border-border/80 hover:bg-surface-hover hover:text-foreground'
                }`}
                onClick={() => onSelectReferencePanel(key)}
                aria-pressed={isActive}
                title={label}
              >
                <Icon size={14} className="shrink-0" />
                <span className="text-[11px] font-semibold tracking-wide">{shortLabel}</span>
              </Button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-auto p-3 space-y-4">
          <div className="space-y-2">
            <div className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Checks
            </div>
            <div className="flex flex-col gap-1.5">
              <InspectorCheckCard
                title="Schema"
                tone={rest.schemaStateTone}
                lines={rest.schemaStateLines}
                emptyLabel="This draft has no schema notes yet."
              />
              <InspectorCheckCard
                title="Diagram"
                tone={rest.diagramStateTone}
                lines={rest.diagramStateLines}
                emptyLabel="The current diagram has no compatibility notes yet."
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Context
            </div>
            <div className="flex flex-col rounded-xl border border-border bg-surface/70">
              {referencePanelMode === 'cookbook' ? (
                <CookbookPanel
                  recipes={rest.schemaCookbookRecipes}
                  canInsert={rest.canInsertCookbook}
                  disabledReason={rest.schemaCookbookDisabledReason}
                  onInsertRecipe={rest.onInsertSchemaCookbookRecipe}
                />
              ) : referencePanelMode === 'dependencies' ? (
                <DependencyPanel dependencies={rest.schemaDependencies} />
              ) : referencePanelMode === 'schemas' ? (
                <SchemaManagerPanel
                  streams={rest.schemaManagerStreams}
                  notice={rest.schemaManagerNotice}
                  onEditStream={rest.onEditSchemaStream}
                  onDeleteStream={rest.onDeleteSchemaStream}
                  onUndoDelete={rest.onUndoDeleteSchemaStream}
                />
              ) : referencePanelMode === 'reference' ? (
                <ReferencePanel sections={rest.schemaReferenceSections} />
              ) : (
                <div className="flex h-full min-h-[160px] items-center justify-center px-6 py-6 text-center text-muted-foreground">
                  <div className="max-w-[200px] space-y-2">
                    <p className="text-sm">
                      Choose a context tool above to open cookbook snippets, imported schemas, or
                      reference notes.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function InspectorCheckCard({
  title,
  tone,
  lines,
  emptyLabel,
}: {
  title: string;
  tone: 'valid' | 'invalid' | 'pending';
  lines: string[];
  emptyLabel: string;
}) {
  const meta = CHECK_META[tone];
  const Icon = meta.Icon;

  return (
    <section
      className={`rounded border px-2.5 py-2 backdrop-blur-sm shadow-sm ${meta.accentClassName}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon size={14} className="shrink-0" />
          <span className="text-xs font-semibold text-foreground">{title}</span>
        </div>
        <span
          className={`rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${meta.chipClassName}`}
        >
          {meta.label}
        </span>
      </div>
      {(lines.length > 0 || emptyLabel) && (
        <div className="mt-1.5 pl-5">
          {lines.length > 1 ? (
            <ul className="m-0 flex flex-col gap-1">
              {lines.map((line) => (
                <li
                  key={`${title}:${line}`}
                  className="text-[11px] leading-snug text-foreground/80 list-disc ml-2"
                >
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[11px] leading-relaxed text-foreground/80">
              {lines[0] ?? emptyLabel}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
