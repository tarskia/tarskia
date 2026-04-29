import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import type { SchemaDependency, SchemaDependencyObject, SchemaDependencySection } from './types';
import { DEPENDENCY_SECTION_LABELS } from './types';

interface DependencyPanelProps {
  dependencies: SchemaDependency[];
}

export function DependencyPanel({ dependencies }: DependencyPanelProps) {
  const [selectedSchemaRef, setSelectedSchemaRef] = useState<string | undefined>(
    () => dependencies[0]?.schemaRef,
  );
  const [selectedSection, setSelectedSection] = useState<SchemaDependencySection>('types');
  const [selectedObjectId, setSelectedObjectId] = useState<string | undefined>();
  const [filter, setFilter] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | undefined>();

  useEffect(() => {
    if (dependencies.length === 0) {
      setSelectedSchemaRef(undefined);
      return;
    }
    if (selectedSchemaRef && dependencies.some((d) => d.schemaRef === selectedSchemaRef)) return;
    setSelectedSchemaRef(dependencies[0]?.schemaRef);
  }, [dependencies, selectedSchemaRef]);

  const selectedDep =
    dependencies.find((d) => d.schemaRef === selectedSchemaRef) ?? dependencies[0];

  const depSections = useMemo(() => {
    const grouped = new Map<SchemaDependencySection, SchemaDependencyObject[]>();
    for (const obj of selectedDep?.objects ?? []) {
      const existing = grouped.get(obj.section);
      if (existing) existing.push(obj);
      else grouped.set(obj.section, [obj]);
    }
    return grouped;
  }, [selectedDep]);

  const visibleObjects = useMemo(() => {
    const objects = depSections.get(selectedSection) ?? [];
    const norm = filter.trim().toLowerCase();
    if (!norm) return objects;
    return objects.filter((o) =>
      [o.id, o.label, o.selectorPath].some((v) => v.toLowerCase().includes(norm)),
    );
  }, [filter, depSections, selectedSection]);

  const selectedObject = visibleObjects.find((o) => o.id === selectedObjectId) ?? visibleObjects[0];

  useEffect(() => {
    const sectionOrder: SchemaDependencySection[] = ['types', 'traits', 'relations', 'tags'];
    const available = sectionOrder.filter((s) => (depSections.get(s)?.length ?? 0) > 0);
    if (available.length === 0) {
      setSelectedObjectId(undefined);
      return;
    }
    if (!available.includes(selectedSection)) {
      setSelectedSection(available[0] ?? 'types');
      return;
    }
    if (selectedObjectId && visibleObjects.some((o) => o.id === selectedObjectId)) return;
    setSelectedObjectId(visibleObjects[0]?.id);
  }, [depSections, selectedObjectId, selectedSection, visibleObjects]);

  useEffect(() => {
    if (!copiedKey) return;
    const handle = window.setTimeout(() => setCopiedKey(undefined), 1600);
    return () => window.clearTimeout(handle);
  }, [copiedKey]);

  const copySelector = async (text: string, key: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedKey(key);
    } catch {
      setCopiedKey(undefined);
    }
  };

  if (dependencies.length === 0 || !selectedDep) {
    return (
      <div className="flex flex-col gap-2.5 h-full">
        <div className="text-base font-bold">Dependencies</div>
        <div className="text-sm text-warning/90">
          Add schemas in the <code>use</code> section to browse their contents here.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      <div className="text-base font-bold">Dependencies</div>
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <nav className="flex flex-col gap-2.5 shrink-0" aria-label="Imported schemas">
          <div className="flex flex-col gap-1.5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Imported schemas
            </div>
            <div className="flex flex-wrap gap-1.5">
              {dependencies.map((dep) => (
                <Button
                  key={`${dep.schemaRef}@${dep.version}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`rounded-full border ${
                    dep.schemaRef === selectedDep.schemaRef
                      ? 'border-accent/42 bg-accent/16 hover:bg-accent/16'
                      : 'border-border bg-muted/30 hover:border-border/60'
                  }`}
                  onClick={() => {
                    setSelectedSchemaRef(dep.schemaRef);
                    setFilter('');
                  }}
                >
                  {dep.schemaLabel}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Object type
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['types', 'traits', 'relations', 'tags'] as const)
                .filter((s) => (depSections.get(s)?.length ?? 0) > 0)
                .map((section) => (
                  <Button
                    key={section}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`rounded-full border ${
                      section === selectedSection
                        ? 'border-accent/42 bg-accent/16 hover:bg-accent/16'
                        : 'border-border bg-muted/30 hover:border-border/60'
                    }`}
                    onClick={() => {
                      setSelectedSection(section);
                      setFilter('');
                    }}
                  >
                    {DEPENDENCY_SECTION_LABELS[section]}
                  </Button>
                ))}
            </div>
          </div>
        </nav>

        <div className="flex flex-col gap-2 flex-1 min-h-0 p-2.5 rounded-md border border-border bg-[rgba(8,10,16,0.45)]">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-bold">{selectedDep.schemaLabel}</div>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              v{selectedDep.version}
            </span>
          </div>
          <div className="text-sm text-foreground/88">
            {selectedDep.alias ? `Imported as ${selectedDep.alias}` : 'Imported without an alias'}
          </div>
          <div className="grid grid-cols-[minmax(132px,150px)_minmax(0,1fr)] gap-2.5 flex-1 min-h-0">
            <div className="flex flex-col gap-2 min-h-0">
              <Input
                className="bg-muted px-2 py-1.5 text-xs"
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filter ${DEPENDENCY_SECTION_LABELS[selectedSection].toLowerCase()}`}
                spellCheck={false}
              />
              <div className="flex flex-col gap-1.5 min-h-0 overflow-auto pr-1">
                {visibleObjects.map((obj) => (
                  <Button
                    key={`${obj.section}.${obj.id}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`h-auto justify-start whitespace-normal rounded-md border px-2 py-1.5 text-left text-xs font-normal leading-snug ${
                      obj.id === selectedObject?.id
                        ? 'border-accent/42 bg-accent/16 hover:bg-accent/16'
                        : 'border-border bg-muted/30 hover:border-border/60'
                    }`}
                    onClick={() => setSelectedObjectId(obj.id)}
                  >
                    {obj.label}
                  </Button>
                ))}
              </div>
            </div>
            {selectedObject ? (
              <div className="flex flex-col gap-2 min-w-0 min-h-0">
                <div className="text-sm font-bold">{selectedObject.label}</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-foreground/88">
                    Selector: {selectedObject.selectorPath}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      void copySelector(
                        selectedObject.selectorPath,
                        `${selectedObject.section}.${selectedObject.id}`,
                      )
                    }
                  >
                    {copiedKey === `${selectedObject.section}.${selectedObject.id}`
                      ? 'Copied'
                      : 'Copy selector'}
                  </Button>
                </div>
                <pre className="m-0 p-2.5 rounded-md bg-[rgba(8,10,16,0.82)] border border-border text-xs leading-relaxed text-foreground/92 flex-1 min-h-0 overflow-auto whitespace-pre">
                  <code>{selectedObject.previewText}</code>
                </pre>
              </div>
            ) : (
              <div className="text-sm text-warning/90">No objects available in this section.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
