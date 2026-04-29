import type { ReactNode } from 'react';
import type {
  InspectorPropertyEntryView,
  InspectorProvenanceView,
  InspectorViewModel,
} from '../shell/view-models';

const formatTypeStyle = (typeHue?: number) =>
  typeHue === undefined ? undefined : { color: `hsla(${typeHue}, 48%, 58%, 0.96)` };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border px-6 py-5">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-4 border-b border-border/70 py-2.5 last:border-b-0 last:pb-0 first:pt-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm text-foreground">{value}</div>
    </div>
  );
}

function ProvenancePanel({ provenance }: { provenance?: InspectorProvenanceView }) {
  if (!provenance || provenance.locations.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col">
      {typeof provenance.confidence === 'number' && Number.isFinite(provenance.confidence) ? (
        <DetailRow
          label="Confidence"
          value={<span className="font-medium text-foreground">{provenance.confidence}</span>}
        />
      ) : null}
      <div className="flex flex-col gap-3">
        {provenance.locations.map((location, index) => (
          <div
            key={`${location.path}:${location.symbol ?? index}`}
            className="border-b border-border/70 pb-3 last:border-b-0 last:pb-0"
          >
            {location.permalink ? (
              <a
                href={location.permalink}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm font-medium text-accent hover:underline"
                title={location.permalink}
              >
                {location.path}
              </a>
            ) : (
              <div className="break-all text-sm font-medium text-foreground">{location.path}</div>
            )}
            {location.symbol ? (
              <div className="mt-1 text-xs text-muted-foreground">Symbol: {location.symbol}</div>
            ) : null}
            {location.note ? (
              <div className="mt-1 text-xs text-muted-foreground">{location.note}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function PropertyRows({ entries }: { entries: InspectorPropertyEntryView[] }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col">
      {entries.map((entry) => (
        <DetailRow
          key={entry.path}
          label={entry.label}
          value={
            entry.href ? (
              <a
                href={entry.href}
                target="_blank"
                rel="noreferrer"
                className="break-all font-medium text-accent hover:underline"
                title={entry.href}
              >
                {entry.value}
              </a>
            ) : (
              <span className="break-words">{entry.value}</span>
            )
          }
        />
      ))}
    </div>
  );
}

function TagList({ tags }: { tags: Array<{ id: string; label: string; color?: string }> }) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="text-sm leading-6 text-foreground">
      {tags.map((tag, index) => (
        <span key={tag.id} style={tag.color ? { color: tag.color } : undefined}>
          {index > 0 ? ', ' : null}
          {tag.label}
        </span>
      ))}
    </div>
  );
}

export function GalleryInspector({ viewModel }: { viewModel: InspectorViewModel }) {
  if (viewModel.kind === 'empty') {
    return null;
  }

  const entityView = viewModel.kind === 'entity' ? viewModel : undefined;
  const relationView = viewModel.kind === 'relation' ? viewModel : undefined;
  const typeStyle = entityView ? formatTypeStyle(entityView.typeHue) : undefined;

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l border-border bg-surface">
      <div className="border-b border-border px-6 py-5">
        <div className="text-sm font-medium" style={typeStyle}>
          {entityView ? entityView.typeLabel : 'Relation'}
        </div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
          {entityView ? entityView.displayName : relationView?.relationLabel}
        </h2>
      </div>

      {relationView ? (
        <Section title="Endpoints">
          <div className="flex flex-col">
            <DetailRow label="From" value={relationView.sourceLabel} />
            <DetailRow label="To" value={relationView.targetLabel} />
          </div>
        </Section>
      ) : null}

      {entityView && entityView.displayedTags.length > 0 ? (
        <Section title="Tags">
          <TagList tags={entityView.displayedTags} />
        </Section>
      ) : null}

      {relationView && relationView.displayedTags.length > 0 ? (
        <Section title="Tags">
          <TagList tags={relationView.displayedTags} />
        </Section>
      ) : null}

      {entityView?.description ? (
        <Section title="Description">
          <div className="text-sm leading-6 whitespace-pre-wrap text-foreground">
            {entityView.description}
          </div>
        </Section>
      ) : null}

      {relationView?.description ? (
        <Section title="Description">
          <div className="text-sm leading-6 whitespace-pre-wrap text-foreground">
            {relationView.description}
          </div>
        </Section>
      ) : null}

      {entityView && entityView.propertyEntries.length > 0 ? (
        <Section title="Properties">
          <PropertyRows entries={entityView.propertyEntries} />
        </Section>
      ) : null}

      {relationView && relationView.propertyEntries.length > 0 ? (
        <Section title="Properties">
          <PropertyRows entries={relationView.propertyEntries} />
        </Section>
      ) : null}

      {entityView?.provenance ? (
        <Section title="Provenance">
          <ProvenancePanel provenance={entityView.provenance} />
        </Section>
      ) : null}

      {relationView?.provenance ? (
        <Section title="Provenance">
          <ProvenancePanel provenance={relationView.provenance} />
        </Section>
      ) : null}
    </div>
  );
}
