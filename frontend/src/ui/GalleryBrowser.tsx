import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DtoGalleryDiagramSummaryResponse } from '../api/generated/model';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { describeSourceRepository } from '../gallery/source-repository-summary';
import { formatWorkerBuildFacts } from '../gallery/worker-build-summary';
import { SidebarPanelFrame } from './SidebarPanelFrame';

interface GalleryBrowserProps {
  exampleDiagrams: DtoGalleryDiagramSummaryResponse[];
  loadingExampleKey?: string;
  notice?: string;
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

export function GalleryBrowser({
  exampleDiagrams,
  loadingExampleKey,
  notice,
  onLoadExampleDiagram,
}: GalleryBrowserProps) {
  const [search, setSearch] = useState('');
  const rows = getExampleRows(exampleDiagrams);
  const query = search.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (query.length === 0) {
      return rows;
    }

    return rows.filter((diagram) => {
      const title = diagram.title?.trim() || diagram.slug;
      return (
        title.toLowerCase().includes(query) ||
        diagram.namespace.toLowerCase().includes(query) ||
        diagram.slug.toLowerCase().includes(query)
      );
    });
  }, [query, rows]);

  return (
    <SidebarPanelFrame
      title="Diagram Gallery"
      headerContent={
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search gallery"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search gallery"
              className="bg-transparent py-1.5 pl-8 pr-3"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Opening a gallery diagram imports it into the current workspace as an editable copy.
          </p>
        </>
      }
      contentClassName="space-y-2 px-3 pb-3"
    >
      {notice ? (
        <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-sm text-warning/90">
          {notice}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="px-2 py-3 text-sm text-muted-foreground">
          No gallery diagrams are ready yet.
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="px-2 py-3 text-sm text-muted-foreground">No matching gallery diagrams.</div>
      ) : (
        <div className="flex flex-col">
          {filteredRows.map((diagram, index) => {
            const key = buildExampleKey(diagram);
            const isLoading = loadingExampleKey === key;
            const workerBuildFacts = formatWorkerBuildFacts(diagram.workerBuild);
            const sourceRepository = describeSourceRepository(diagram.sourceRepository);
            return (
              <div
                key={key}
                className={`grid grid-cols-[minmax(0,1fr)_120px_88px] items-center gap-3 py-2.5 ${
                  index > 0 ? 'border-t border-border' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {diagram.title?.trim() || diagram.slug}
                  </div>
                  {sourceRepository ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {sourceRepository.label ? (
                        sourceRepository.href ? (
                          <a
                            href={sourceRepository.href}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground hover:underline"
                          >
                            {sourceRepository.label}
                          </a>
                        ) : (
                          sourceRepository.label
                        )
                      ) : null}
                      {sourceRepository.label && sourceRepository.facts.length > 0 ? ' · ' : null}
                      {sourceRepository.facts.join(' · ')}
                    </div>
                  ) : null}
                  {workerBuildFacts.length > 0 ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {workerBuildFacts.join(' · ')}
                    </div>
                  ) : null}
                </div>
                <div className="truncate text-sm text-muted-foreground">{diagram.namespace}</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isLoading}
                  className="w-full justify-center"
                  title="Open this gallery diagram as a normal editable diagram."
                  onClick={() =>
                    onLoadExampleDiagram?.({
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
      )}
    </SidebarPanelFrame>
  );
}
