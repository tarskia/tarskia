import { ExternalLink, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useParams, useSearchParams } from 'react-router-dom';

import { useGetGalleryDiagram, useListGalleryDiagrams } from './api/generated/gallery/gallery';
import type { DtoGalleryDiagramDetailResponse } from './api/generated/model';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import {
  GALLERY_QUERY_STALE_TIME_MS,
  galleryRetryDelay,
  getGalleryDiagramWithLocalFallback,
  listGalleryDiagramsWithLocalFallback,
  retryGalleryQuery,
} from './gallery/gallery-query';
import {
  coerceGallerySummaryArray,
  coerceSuccessfulResponseBody,
} from './gallery/gallery-response';
import {
  describePublicGalleryRepository,
  formatPublicGalleryCommit,
  readPublicGallerySourceRepositoryFromRaw,
} from './gallery/public-gallery-repository';
import { formatCompactNumber } from './gallery/worker-build-summary';
import { GalleryFeedbackMenu } from './ui/GalleryFeedbackMenu';
import { GitHubLink } from './ui/GitHubLink';
import { ThemeToggle } from './ui/ThemeToggle';

const buildViewerRouteLabel = (params: { namespace: string; slug: string }) =>
  [params.namespace, params.slug].filter((value) => value.trim()).join('/') || 'Gallery diagram';

export interface PublicGalleryViewerSearchChrome {
  searchTotalMatches: number;
  searchHiddenMatches: number;
  onRevealSearchResults?: () => void;
}

export interface PublicGalleryShellContext {
  setViewerSearchChrome: (chrome: PublicGalleryViewerSearchChrome) => void;
}

export default function PublicGalleryShell() {
  const { namespace = '', slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const inViewer = Boolean(namespace && slug);
  const [viewerSearchChrome, setViewerSearchChrome] = useState<PublicGalleryViewerSearchChrome>({
    searchTotalMatches: 0,
    searchHiddenMatches: 0,
  });
  const viewerRouteKey = `${namespace}/${slug}`;
  const [stableViewerRepositoryLabel, setStableViewerRepositoryLabel] = useState<
    { key: string; label: string } | undefined
  >();
  const revealSearchResultsRef = useRef<(() => void) | undefined>(undefined);
  const detailQuery = useGetGalleryDiagram(namespace, slug, {
    query: {
      enabled: inViewer,
      staleTime: GALLERY_QUERY_STALE_TIME_MS,
      retry: retryGalleryQuery,
      retryDelay: galleryRetryDelay,
      queryFn: ({ signal }) => getGalleryDiagramWithLocalFallback(namespace, slug, { signal }),
    },
  });
  const galleryQuery = useListGalleryDiagrams({
    query: {
      enabled: inViewer,
      staleTime: GALLERY_QUERY_STALE_TIME_MS,
      retry: retryGalleryQuery,
      retryDelay: galleryRetryDelay,
      queryFn: ({ signal }) => listGalleryDiagramsWithLocalFallback({ signal }),
    },
  });
  const detail = coerceSuccessfulResponseBody<DtoGalleryDiagramDetailResponse>(detailQuery.data);
  const detailSourceRepository = useMemo(
    () => readPublicGallerySourceRepositoryFromRaw(detail?.raw),
    [detail?.raw],
  );
  const gallerySummaries = useMemo(
    () => coerceGallerySummaryArray(coerceSuccessfulResponseBody<unknown>(galleryQuery.data)),
    [galleryQuery.data],
  );
  const currentSummary = useMemo(
    () =>
      gallerySummaries.find((diagram) => diagram.namespace === namespace && diagram.slug === slug),
    [gallerySummaries, namespace, slug],
  );
  const viewerSourceRepository = currentSummary?.sourceRepository ?? detailSourceRepository;
  const viewerRepository = viewerSourceRepository
    ? describePublicGalleryRepository({
        sourceRepository: viewerSourceRepository,
        namespace,
        slug,
      })
    : undefined;
  useEffect(() => {
    if (!inViewer) {
      setStableViewerRepositoryLabel(undefined);
      return;
    }
    if (!viewerRepository?.label) {
      return;
    }
    setStableViewerRepositoryLabel({ key: viewerRouteKey, label: viewerRepository.label });
  }, [inViewer, viewerRepository?.label, viewerRouteKey]);
  const fallbackViewerTitle =
    stableViewerRepositoryLabel?.key === viewerRouteKey
      ? stableViewerRepositoryLabel.label
      : buildViewerRouteLabel({ namespace, slug });
  const viewerTitle = inViewer ? viewerRepository?.label || fallbackViewerTitle : undefined;
  const viewerCommit = formatPublicGalleryCommit(viewerSourceRepository?.commit);
  const viewerMeta = useMemo(() => {
    if (!currentSummary) {
      return undefined;
    }
    const facts: string[] = [];
    if (
      typeof currentSummary.workerBuild?.nodes === 'number' &&
      currentSummary.workerBuild.nodes > 0
    ) {
      facts.push(`${currentSummary.workerBuild.nodes} nodes`);
    }
    if (
      typeof currentSummary.workerBuild?.approxTotalTokens === 'number' &&
      currentSummary.workerBuild.approxTotalTokens > 0
    ) {
      facts.push(`${formatCompactNumber(currentSummary.workerBuild.approxTotalTokens)} tokens`);
    }
    if (currentSummary.workerBuild?.model?.trim()) {
      facts.push(currentSummary.workerBuild.model.trim());
    }
    return facts.length > 0 ? facts : undefined;
  }, [currentSummary]);
  const searchQuery = searchParams.get('q') ?? '';
  const trimmedSearchQuery = searchQuery.trim();
  const syncViewerSearchChrome = useCallback((chrome: PublicGalleryViewerSearchChrome) => {
    revealSearchResultsRef.current = chrome.onRevealSearchResults;
    setViewerSearchChrome((previous) =>
      previous.searchTotalMatches === chrome.searchTotalMatches &&
      previous.searchHiddenMatches === chrome.searchHiddenMatches
        ? previous
        : {
            searchTotalMatches: chrome.searchTotalMatches,
            searchHiddenMatches: chrome.searchHiddenMatches,
          },
    );
  }, []);

  useEffect(() => {
    if (inViewer) {
      return;
    }
    revealSearchResultsRef.current = undefined;
    setViewerSearchChrome({
      searchTotalMatches: 0,
      searchHiddenMatches: 0,
    });
  }, [inViewer]);

  const updateSearchQuery = (nextQuery: string) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextQuery.trim().length === 0) {
      nextSearchParams.delete('q');
    } else {
      nextSearchParams.set('q', nextQuery);
    }
    setSearchParams(nextSearchParams, { replace: true });
  };

  const searchSummary = trimmedSearchQuery
    ? viewerSearchChrome.searchTotalMatches === 0
      ? 'No matches'
      : `${viewerSearchChrome.searchTotalMatches} match${
          viewerSearchChrome.searchTotalMatches === 1 ? '' : 'es'
        }${
          viewerSearchChrome.searchHiddenMatches > 0
            ? `, ${viewerSearchChrome.searchHiddenMatches} hidden`
            : ''
        }`
    : undefined;

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-6 py-4">
          <Link
            to="/gallery"
            className="inline-flex shrink-0 items-center gap-2.5 text-lg font-semibold text-accent transition-colors hover:text-accent/80"
          >
            <img src="/tarskia-icon.svg" alt="" aria-hidden="true" className="h-7 w-7" />
            tarskia
          </Link>
          <Link
            to="/about"
            className="hidden shrink-0 rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground sm:inline-flex"
          >
            About
          </Link>
          {viewerTitle ? (
            <>
              <div className="h-6 w-px bg-border" />
              <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                <span className="min-w-0 shrink truncate text-sm font-medium text-foreground">
                  {viewerTitle}
                </span>
                {viewerRepository?.href || viewerCommit || viewerMeta ? (
                  <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground">
                    {viewerCommit ? (
                      <div className="inline-flex min-w-0 items-center gap-2">
                        <span className="truncate">{viewerCommit}</span>
                        {viewerRepository?.href ? (
                          <a
                            href={viewerRepository.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center transition-colors hover:text-foreground"
                            title="Open repository in a new tab"
                            aria-label="Open repository in a new tab"
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    {!viewerCommit && viewerRepository?.href ? (
                      <a
                        href={viewerRepository.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center transition-colors hover:text-foreground"
                        title="Open repository in a new tab"
                        aria-label="Open repository in a new tab"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : null}
                    {viewerMeta?.map((fact, index) => (
                      <div key={fact} className="inline-flex min-w-0 items-center gap-2">
                        {index > 0 || viewerCommit || viewerRepository?.href ? (
                          <span aria-hidden="true">·</span>
                        ) : null}
                        <span className="truncate">{fact}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex-1" />
          )}
          {inViewer ? (
            <div className="flex min-w-0 items-center gap-2">
              {searchSummary ? (
                <span className="truncate whitespace-nowrap text-[11px] text-muted-foreground">
                  {searchSummary}
                </span>
              ) : null}
              {viewerSearchChrome.searchHiddenMatches > 0 && revealSearchResultsRef.current ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => revealSearchResultsRef.current?.()}
                  className="h-7 border border-info/30 bg-info/15 px-2 text-info hover:bg-info/25 hover:text-info"
                >
                  Reveal
                </Button>
              ) : null}
              <div className="relative w-56 shrink-0 sm:w-64">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => updateSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      updateSearchQuery('');
                    }
                    if (
                      event.key === 'Enter' &&
                      revealSearchResultsRef.current &&
                      viewerSearchChrome.searchHiddenMatches > 0
                    ) {
                      event.preventDefault();
                      revealSearchResultsRef.current?.();
                    }
                  }}
                  placeholder="Search diagram"
                  aria-label="Search diagram"
                  className="h-7 bg-background/75 pl-8 pr-8 text-xs placeholder:text-muted-foreground/70"
                />
                {trimmedSearchQuery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => updateSearchQuery('')}
                    className="absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                    aria-label="Clear diagram search"
                    title="Clear search"
                  >
                    <X size={12} />
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <GalleryFeedbackMenu />
            <GitHubLink />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet context={{ setViewerSearchChrome: syncViewerSearchChrome }} />
      </div>
    </div>
  );
}
