import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import type { SchemaReferenceSection } from './types';

interface ReferencePanelProps {
  sections: SchemaReferenceSection[];
}

export function ReferencePanel({ sections }: ReferencePanelProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(() => sections[0]?.id);

  useEffect(() => {
    if (sections.length === 0) {
      setSelectedId(undefined);
      return;
    }
    if (selectedId && sections.some((s) => s.id === selectedId)) return;
    setSelectedId(sections[0]?.id);
  }, [sections, selectedId]);

  const selected = sections.find((s) => s.id === selectedId) ?? sections[0];

  if (sections.length === 0 || !selected) {
    return (
      <div className="flex flex-col gap-2.5 h-full">
        <div className="text-base font-bold">Reference</div>
        <div className="text-sm text-warning/90">Reference content is unavailable.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      <div className="text-base font-bold">Reference</div>
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <nav className="shrink-0" aria-label="Schema reference sections">
          <div className="flex flex-col gap-1.5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Sections</div>
            <div className="flex flex-wrap gap-1.5">
              {sections.map((section) => (
                <Button
                  key={section.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`rounded-full border ${
                    section.id === selected.id
                      ? 'border-accent/42 bg-accent/16 hover:bg-accent/16'
                      : 'border-border bg-muted/30 hover:border-border/60'
                  }`}
                  onClick={() => setSelectedId(section.id)}
                >
                  {section.title}
                </Button>
              ))}
            </div>
          </div>
        </nav>

        <div className="flex flex-col gap-2 flex-1 min-h-0 p-2.5 rounded-md border border-border bg-[rgba(8,10,16,0.45)]">
          <div className="text-sm font-bold">{selected.title}</div>
          <div className="text-sm text-foreground/88">{selected.description}</div>
          <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-auto pr-0.5">
            {selected.entries.map((entry) => (
              <section
                key={entry.key}
                className="flex flex-col gap-1.5 pt-2.5 border-t border-border first:border-0 first:pt-0"
              >
                <div className="text-xs text-warning/95">
                  <code>{entry.key}</code>
                </div>
                <div className="text-sm font-semibold leading-snug">{entry.summary}</div>
                <div className="text-xs leading-relaxed text-foreground/82">{entry.details}</div>
                {entry.values?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {entry.values.map((value) => (
                      <span
                        key={`${entry.key}:${value}`}
                        className="inline-flex items-center px-2 py-0.5 rounded-full border border-border bg-muted/30 text-xs text-foreground/88"
                      >
                        {value}
                      </span>
                    ))}
                  </div>
                ) : null}
                {entry.example ? (
                  <pre className="m-0 p-2.5 rounded-md bg-[rgba(8,10,16,0.82)] border border-border text-xs leading-relaxed text-foreground/92 max-h-44 overflow-auto whitespace-pre">
                    <code>{entry.example}</code>
                  </pre>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
