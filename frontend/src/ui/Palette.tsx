import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import type { PaletteViewModel } from '../shell/view-models';
import { SidebarPanelFrame } from './SidebarPanelFrame';

interface PaletteProps {
  viewModel: PaletteViewModel;
  onAdd: (typeId: string) => void;
}

export function Palette({ viewModel, onAdd }: PaletteProps) {
  const [search, setSearch] = useState('');
  const [activeSchema, setActiveSchema] = useState<string | null>(null);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const allTypes = viewModel.types;
  const schemaTabs = viewModel.schemaTabs;

  const effectiveSchema = activeSchema ?? schemaTabs[0]?.id ?? null;
  const isSearching = search.trim().length > 0;
  const query = search.trim().toLowerCase();

  const visibleTypes = useMemo(() => {
    if (isSearching) {
      return allTypes.filter(
        (t) => t.displayLabel.toLowerCase().includes(query) || t.id.toLowerCase().includes(query),
      );
    }
    if (!effectiveSchema) return allTypes;
    return allTypes.filter((t) => t.schemaId === effectiveSchema);
  }, [allTypes, isSearching, query, effectiveSchema]);

  const handleAdd = (typeId: string) => {
    onAdd(typeId);
  };

  return (
    <SidebarPanelFrame
      title="Palette"
      headerContent={
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search all types…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-muted/40 py-1.5 pl-8 pr-3"
            />
          </div>
          {!isSearching && schemaTabs.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {schemaTabs.map((tab) => (
                <Button
                  key={tab.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveSchema(tab.id)}
                  className={`h-auto ${
                    effectiveSchema === tab.id
                      ? 'bg-accent font-medium text-accent-foreground hover:bg-accent hover:text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
          )}
        </>
      }
      contentClassName="px-2 pb-3"
    >
      {/* Type list */}
      {visibleTypes.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {isSearching ? 'No matching types.' : 'No types available.'}
        </div>
      )}

      <div className="flex flex-col gap-px">
        {visibleTypes.map((type) => {
          const isExpanded = expandedType === type.id;
          const detail = isExpanded
            ? { description: type.description, lines: type.detailLines }
            : { description: undefined, lines: [] };
          const textColor = type.hue != null ? `hsl(${type.hue}, 50%, 68%)` : undefined;
          const selectionBg = type.hue != null ? `hsl(${type.hue}, 25%, 16%)` : undefined;
          const hoverBg = type.hue != null ? `hsl(${type.hue}, 15%, 13%)` : undefined;

          return (
            <div key={type.id}>
              <Button
                type="button"
                variant="ghost"
                className={`group h-auto w-full justify-start gap-2 px-2.5 py-2.5 transition-all duration-150 ${
                  isExpanded ? 'hover:bg-transparent' : 'hover:bg-accent/50'
                }`}
                style={isExpanded ? { backgroundColor: selectionBg } : undefined}
                onMouseEnter={(e) => {
                  if (!isExpanded && hoverBg) e.currentTarget.style.backgroundColor = hoverBg;
                }}
                onMouseLeave={(e) => {
                  if (!isExpanded) e.currentTarget.style.backgroundColor = '';
                }}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/semantic-type', type.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => setExpandedType(isExpanded ? null : type.id)}
              >
                <span
                  className="text-sm font-medium truncate flex-1 text-left"
                  style={textColor ? { color: textColor } : undefined}
                >
                  {type.displayLabel}
                </span>
              </Button>

              {/* Expanded detail panel */}
              {isExpanded && (
                <div className="mx-2 mb-1 space-y-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2.5">
                  {detail.description ? (
                    <p className="text-xs leading-relaxed text-foreground/82">
                      {detail.description}
                    </p>
                  ) : null}
                  {detail.lines.length > 0 ? (
                    <dl className="space-y-1">
                      {detail.lines.map((d) => (
                        <div key={d.label} className="flex gap-2">
                          <dt className="w-16 shrink-0 pt-px text-[11px] uppercase tracking-wider text-muted-foreground">
                            {d.label}
                          </dt>
                          <dd className="text-xs text-foreground/80">{d.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : !detail.description ? (
                    <p className="text-xs italic text-muted-foreground">No additional info.</p>
                  ) : null}

                  {/* Add button */}
                  <Button className="w-full" onClick={() => handleAdd(type.id)}>
                    <Plus className="h-3.5 w-3.5" />
                    Add to diagram
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isSearching && visibleTypes.length > 0 && (
        <div className="pt-3 text-center text-[11px] text-muted-foreground/60">
          Showing results across all schemas
        </div>
      )}
    </SidebarPanelFrame>
  );
}
