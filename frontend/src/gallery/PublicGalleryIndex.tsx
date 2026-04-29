import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useListGalleryDiagrams } from '../api/generated/gallery/gallery';
import type { DtoGalleryDiagramSummaryResponse } from '../api/generated/model';
import { Input } from '../components/ui/input';
import { LoadingState } from '../components/ui/loading-state';
import {
  galleryRetryDelay,
  listGalleryDiagramsWithLocalFallback,
  retryGalleryQuery,
} from './gallery-query';
import { coerceGallerySummaryArray, coerceSuccessfulResponseBody } from './gallery-response';
import { describePublicGalleryRepository } from './public-gallery-repository';
import { formatCompactNumber } from './worker-build-summary';

const MISSING_VALUE = '\u2013';
const GITHUB_REPO_URL = 'https://github.com/tarskia/tarskia';
const DIAGRAM_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new?template=diagram_issue.yml`;
const REPO_REQUEST_URL = `${GITHUB_REPO_URL}/issues/new?template=repo_request.yml`;

type GalleryRow = DtoGalleryDiagramSummaryResponse & { namespace: string; slug: string };
const EMPTY_ROWS: GalleryRow[] = [];

export type SortKey = 'repository' | 'nodes' | 'tokens';
export type SortDirection = 'asc' | 'desc';

const DEFAULT_SORT: { sortKey: SortKey; sortDirection: SortDirection } = {
  sortKey: 'repository',
  sortDirection: 'asc',
};

function normalizeMetric(value: number | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function compareNullableNumber(
  left: number | undefined,
  right: number | undefined,
  direction: SortDirection,
): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return direction === 'asc' ? left - right : right - left;
}

function buildSearchText(diagram: GalleryRow): string {
  const repository = describePublicGalleryRepository({
    sourceRepository: diagram.sourceRepository,
    namespace: diagram.namespace,
    slug: diagram.slug,
  });
  return [repository.searchText, diagram.title?.trim(), diagram.slug, diagram.namespace]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n')
    .toLowerCase();
}

export function filterPublicGalleryRows(rows: GalleryRow[], query: string): GalleryRow[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return rows;
  }
  return rows.filter((diagram) => buildSearchText(diagram).includes(normalizedQuery));
}

export function sortPublicGalleryRows(
  rows: GalleryRow[],
  sort: { sortKey: SortKey; sortDirection: SortDirection },
): GalleryRow[] {
  return [...rows].sort((left, right) => {
    if (sort.sortKey === 'repository') {
      const leftRepository = describePublicGalleryRepository({
        sourceRepository: left.sourceRepository,
        namespace: left.namespace,
        slug: left.slug,
      }).label;
      const rightRepository = describePublicGalleryRepository({
        sourceRepository: right.sourceRepository,
        namespace: right.namespace,
        slug: right.slug,
      }).label;
      const comparison = compareText(leftRepository, rightRepository);
      return sort.sortDirection === 'asc' ? comparison : -comparison;
    }

    const comparison =
      sort.sortKey === 'nodes'
        ? compareNullableNumber(
            normalizeMetric(left.workerBuild?.nodes),
            normalizeMetric(right.workerBuild?.nodes),
            sort.sortDirection,
          )
        : compareNullableNumber(
            normalizeMetric(left.workerBuild?.approxTotalTokens),
            normalizeMetric(right.workerBuild?.approxTotalTokens),
            sort.sortDirection,
          );
    if (comparison !== 0) {
      return comparison;
    }
    const leftRepository = describePublicGalleryRepository({
      sourceRepository: left.sourceRepository,
      namespace: left.namespace,
      slug: left.slug,
    }).label;
    const rightRepository = describePublicGalleryRepository({
      sourceRepository: right.sourceRepository,
      namespace: right.namespace,
      slug: right.slug,
    }).label;
    return compareText(leftRepository, rightRepository);
  });
}

export default function PublicGalleryIndex() {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT.sortKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT.sortDirection);
  const galleryQuery = useListGalleryDiagrams({
    query: {
      staleTime: 30_000,
      retry: retryGalleryQuery,
      retryDelay: galleryRetryDelay,
      queryFn: ({ signal }) => listGalleryDiagramsWithLocalFallback({ signal }),
    },
  });

  const rows = useMemo<GalleryRow[]>(
    () =>
      coerceGallerySummaryArray(coerceSuccessfulResponseBody<unknown>(galleryQuery.data)).filter(
        (diagram): diagram is GalleryRow =>
          typeof diagram.namespace === 'string' && typeof diagram.slug === 'string',
      ),
    [galleryQuery.data],
  );
  const filteredRows = useMemo(() => filterPublicGalleryRows(rows, search), [rows, search]);
  const sortedRows = useMemo(
    () => sortPublicGalleryRows(filteredRows, { sortKey, sortDirection }),
    [filteredRows, sortDirection, sortKey],
  );
  const totalRowLabel = rows.length === 1 ? '1 diagram' : `${rows.length} diagrams`;
  const visibleRowLabel =
    sortedRows.length === rows.length ? totalRowLabel : `${sortedRows.length} of ${totalRowLabel}`;

  const toggleSort = (nextSortKey: SortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === 'repository' ? 'asc' : 'desc');
  };

  const renderSortIndicator = (headerKey: SortKey) => {
    if (sortKey !== headerKey) {
      return <ArrowUpDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-foreground" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3 w-3 text-foreground" aria-hidden="true" />
    );
  };

  const getAriaSort = (headerKey: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey !== headerKey ? 'none' : sortDirection === 'asc' ? 'ascending' : 'descending';

  if (galleryQuery.isPending) {
    return <LoadingState fullscreen label="Loading gallery" hint="Fetching curated diagrams." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-5 py-6">
      <div className="flex flex-col gap-5 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            AI-generated, schema-validated architecture diagrams for open-source repositories. Each
            diagram is built from public source at a captured commit and may miss or misclassify
            implementation details.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <a
              href={DIAGRAM_ISSUE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>Report diagram issue</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
            <a
              href={REPO_REQUEST_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>Request a repo</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="w-full max-w-sm md:w-[320px]">
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
          <div className="mt-2 text-xs text-muted-foreground md:text-right">{visibleRowLabel}</div>
        </div>
      </div>

      {galleryQuery.data?.status && galleryQuery.data.status !== 200 ? (
        <div className="mt-6 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load the gallery ({galleryQuery.data.status}).
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-surface px-5 py-8 text-sm text-muted-foreground">
          No gallery diagrams are available.
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-surface px-5 py-8 text-sm text-muted-foreground">
          No matching diagrams.
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  aria-sort={getAriaSort('repository')}
                  className="px-0 py-3 text-left"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('repository')}
                    className="inline-flex items-center gap-2 font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span>Repository</span>
                    {renderSortIndicator('repository')}
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={getAriaSort('nodes')}
                  className="w-[120px] px-0 py-3 text-right"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('nodes')}
                    className="ml-auto inline-flex items-center gap-2 font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span>Nodes</span>
                    {renderSortIndicator('nodes')}
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={getAriaSort('tokens')}
                  className="w-[120px] px-0 py-3 text-right"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('tokens')}
                    className="ml-auto inline-flex items-center gap-2 font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span>Tokens</span>
                    {renderSortIndicator('tokens')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((diagram) => {
                const repository = describePublicGalleryRepository({
                  sourceRepository: diagram.sourceRepository,
                  namespace: diagram.namespace,
                  slug: diagram.slug,
                });
                const nodes = normalizeMetric(diagram.workerBuild?.nodes);
                const tokens = normalizeMetric(diagram.workerBuild?.approxTotalTokens);
                const externalLabel = repository.href?.includes('github.com/') ? 'GitHub' : 'Repo';
                return (
                  <tr
                    key={`${diagram.namespace}/${diagram.slug}`}
                    className="border-b border-border"
                  >
                    <td className="px-0 py-4 pr-6 align-middle">
                      <div className="flex items-center gap-3">
                        <Link
                          to={`/gallery/${diagram.namespace}/${diagram.slug}`}
                          className="block font-medium tracking-tight text-foreground transition-colors hover:text-accent"
                          title={repository.label}
                        >
                          {repository.label}
                        </Link>
                        {repository.href ? (
                          <a
                            href={repository.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                            title={repository.href}
                          >
                            <span>{externalLabel}</span>
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-0 py-4 text-right align-middle text-foreground">
                      {typeof nodes === 'number' ? (
                        nodes
                      ) : (
                        <span className="text-muted-foreground">{MISSING_VALUE}</span>
                      )}
                    </td>
                    <td className="px-0 py-4 text-right align-middle text-foreground">
                      {typeof tokens === 'number' ? (
                        formatCompactNumber(tokens)
                      ) : (
                        <span className="text-muted-foreground">{MISSING_VALUE}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
