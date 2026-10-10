import {
  applyDiagramViewOperation,
  buildSchemaVersionCatalog,
  searchDiagramText,
} from '@tarskia/diagram-semantics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import type { DtoGalleryDiagramDetailResponse } from '../api/generated/model';
import Diagram from '../canvas/Diagram';
import { LoadingState } from '../components/ui/loading-state';
import { useDiagramEngine } from '../diagram/useDiagramEngine';
import { useDiagramSurface } from '../diagram/useDiagramSurface';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { PublicGalleryShellContext } from '../PublicGalleryShell';
import { semanticBootstrap } from '../semantic/bootstrap';
import { useDiagramSemanticRuntime } from '../semantic/runtime';
import { CanvasToolbar } from '../ui/CanvasToolbar';
import { GalleryInspector } from '../ui/GalleryInspector';
import { buildCanvasSemanticBindings } from '../viewer-core/buildCanvasSemanticBindings';
import {
  buildDiagramProvenanceSource,
  buildInspectorViewModel,
} from '../viewer-core/buildInspectorViewModel';
import { canFocusLayoutNode, useFocusViewController } from '../viewer-core/focus-view';
import {
  createBlankDiagramDocument,
  loadDiagramDocFromRaw,
} from '../viewer-core/loadDiagramDocFromRaw';
import { useDiagramActions } from '../viewer-core/useDiagramActions';
import { coerceSuccessfulResponseBody } from './gallery-response';
import { createSharedViewUrl } from './shared-view-link';
import { useGalleryDiagramQuery } from './useGalleryDiagramQuery';
import { useSharedGalleryView } from './useSharedGalleryView';
import { useViewerViewport } from './useViewerViewport';

const MIN_VIEW_ZOOM = 0.05;
const MAX_VIEW_ZOOM = 2;
const INSPECTOR_PANEL_WIDTH = 420;
const INSPECTOR_CENTER_OFFSET = INSPECTOR_PANEL_WIDTH / 2;

const buildViewerTitle = (params: { title?: string; slug?: string; namespace?: string }) =>
  params.title?.trim() || params.slug?.trim() || params.namespace?.trim() || 'Gallery diagram';

export const shouldDelayGalleryCanvasMount = (params: {
  viewerDocumentReady: boolean;
  hasSceneContent: boolean;
  defaultViewport?: { x: number; y: number; zoom: number };
  isLiveCanvasVisible?: boolean;
}) =>
  !params.viewerDocumentReady ||
  (params.hasSceneContent && !params.defaultViewport && !params.isLiveCanvasVisible);

export default function PublicGalleryViewer() {
  const reducedMotion = useReducedMotion();
  const { namespace = '', slug = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { setViewerSearchChrome, setViewerShareAction } =
    useOutletContext<PublicGalleryShellContext>();
  const detailQuery = useGalleryDiagramQuery(namespace, slug);

  const schemaVersionCatalog = useMemo(
    () => buildSchemaVersionCatalog(semanticBootstrap.builtInSchemaCatalogEntries),
    [],
  );
  const fallbackSchema = semanticBootstrap.schemaModules[0];
  const [selectedEntityId, setSelectedEntity] = useState<string | undefined>();
  const [selectedEdgeId, setSelectedEdge] = useState<string | undefined>();
  const revealFrameRef = useRef<number | null>(null);
  const viewerCanvasKey = `${namespace}/${slug}?view=${JSON.stringify(searchParams.get('view'))}`;
  const [visibleCanvasKey, setVisibleCanvasKey] = useState<string | undefined>();
  const isLiveCanvasVisible = visibleCanvasKey === viewerCanvasKey;

  const detail = coerceSuccessfulResponseBody<DtoGalleryDiagramDetailResponse>(detailQuery.data);
  const loadedDiagram = useMemo(() => {
    if (!detail?.raw) return undefined;
    return loadDiagramDocFromRaw({
      raw: detail.raw,
      streamName: buildViewerTitle(detail),
      sourceLabel: `${detail.namespace ?? namespace}/${detail.slug ?? slug}`,
    });
  }, [detail, namespace, slug]);

  const content = useMemo(() => {
    const { view: _view, ...content } = loadedDiagram?.doc ?? createBlankDiagramDocument('0.1.0');
    return content;
  }, [loadedDiagram]);

  useEffect(() => {
    if (!loadedDiagram || !viewerCanvasKey) return;
    setSelectedEntity(undefined);
    setSelectedEdge(undefined);
    setVisibleCanvasKey(undefined);
  }, [loadedDiagram, viewerCanvasKey]);

  useEffect(
    () => () => {
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
      }
    },
    [],
  );

  const { persistViewport } = useViewerViewport(loadedDiagram?.doc);

  const semanticRuntime = useDiagramSemanticRuntime({
    doc: content,
    validationDocument: loadedDiagram?.doc,
    schemaVersionCatalog,
    fallbackSchema,
    sourceDiagnostics: loadedDiagram?.sourceDiagnostics,
  });
  const { schema, entityIndex, index } = semanticRuntime;
  const shared = useSharedGalleryView({
    index,
    defaultView: loadedDiagram?.doc.view,
    encoded: searchParams.get('view'),
    namespace,
    slug,
    enabled: Boolean(loadedDiagram?.readable),
  });
  const { view, setView, savedCamera, ready: viewerDocumentReady } = shared;
  const focusRootId = view?.scopeRootId;
  const diagramSearchQuery = searchParams.get('q') ?? '';
  const diagramSearchMatches = useMemo(
    () => searchDiagramText({ doc: content, schema, query: diagramSearchQuery }),
    [diagramSearchQuery, content, schema],
  );

  const diagramEngine = useDiagramEngine({
    index,
    view,
    skipTransitions: reducedMotion,
    showDebug: false,
    persistViewport,
    savedCamera,
    initialViewportKey: viewerDocumentReady ? viewerCanvasKey : undefined,
    minZoom: MIN_VIEW_ZOOM,
    maxZoom: MAX_VIEW_ZOOM,
  });
  const shareRef = useRef<() => Promise<string>>(undefined);
  shareRef.current = () =>
    createSharedViewUrl(
      {
        kind: 'semantic-diagram-saved-view',
        version: 1,
        diagram: { namespace, slug },
        revision: shared.revision,
        view: {
          ...(view ?? { kind: 'semantic-diagram-view', version: 3 }),
          camera: diagramEngine.captureSavedCamera(),
        },
      },
      window.location.href,
    );
  useEffect(() => {
    setViewerShareAction?.(
      viewerDocumentReady && isLiveCanvasVisible ? () => shareRef.current!() : undefined,
    );
    return () => setViewerShareAction?.(undefined);
  }, [viewerDocumentReady, isLiveCanvasVisible, setViewerShareAction]);
  const {
    graph,
    compiled,
    requestNavigation,
    flushUserGesture,
    setPendingStructuralTransitionIntent,
  } = diagramEngine;
  const defaultViewport = diagramEngine.initialViewport;
  const hasSceneContent = content.entities.length > 0 || content.relations.length > 0;
  const shouldDelayCanvasMount = shouldDelayGalleryCanvasMount({
    viewerDocumentReady,
    hasSceneContent,
    defaultViewport,
    isLiveCanvasVisible,
  });

  const {
    centerScene,
    expandAll,
    collapseAll,
    toggleHighlight,
    clearHighlights,
    triggerEntityZoom,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
  } = useDiagramActions({
    state: { index, view },
    document: { commitView: setView },
    transition: {
      requestNavigation,
      flushUserGesture: diagramEngine.flushUserGesture,
      setPendingStructuralTransitionIntent: diagramEngine.setPendingStructuralTransitionIntent,
    },
  });

  const selectedEntity = useMemo(
    () => (selectedEntityId ? entityIndex.byId.get(selectedEntityId) : undefined),
    [entityIndex.byId, selectedEntityId],
  );
  const selectedEdge = useMemo(
    () => content.relations.find((relation) => relation.id === selectedEdgeId),
    [content.relations, selectedEdgeId],
  );
  const selectedEntityCanFocus = Boolean(
    selectedEntity &&
      canFocusLayoutNode({ sceneTree: compiled.tree, entityId: selectedEntity.id, index }),
  );
  const diagramProvenance = useMemo(() => buildDiagramProvenanceSource(content), [content]);
  const inspectorViewModel = useMemo(
    () =>
      buildInspectorViewModel({
        view,
        selectedEntity,
        selectedEdge,
        entityIndex,
        schema,
        scopeRootId: focusRootId,
        canFocusView: selectedEntityCanFocus,
        diagramProvenanceSource: diagramProvenance,
      }),
    [
      diagramProvenance,
      entityIndex,
      focusRootId,
      schema,
      selectedEdge,
      selectedEntity,
      selectedEntityCanFocus,
      view,
    ],
  );
  const showInspector = inspectorViewModel.kind !== 'empty';

  const canvasBindings = useMemo(
    () => buildCanvasSemanticBindings({ schema, entityIndex }),
    [schema, entityIndex],
  );

  const { canvasProps } = useDiagramSurface({
    schema,
    graph,
    entityIndex,
    selectedEntityId,
    selectedEdgeId,
    focusRootId,
    searchMatches:
      diagramSearchMatches.query.length > 0
        ? {
            matchingEntityIds: diagramSearchMatches.matchingEntityIds,
            matchingRelationIds: diagramSearchMatches.matchingRelationIds,
          }
        : undefined,
    setSelectedEntity,
    setSelectedEdge,
    showDebug: false,
    nodeVisualMode: 'outline',
    triggerEntityZoom,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
    minZoom: MIN_VIEW_ZOOM,
    maxZoom: MAX_VIEW_ZOOM,
    semanticBindings: canvasBindings,
    diagramEngine,
  });

  const handleCanvasInit = useCallback(
    (instance: Parameters<typeof canvasProps.onInit>[0]) => {
      canvasProps.onInit(instance);
      const revealKey = viewerCanvasKey;
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
      }
      revealFrameRef.current = requestAnimationFrame(() => {
        revealFrameRef.current = null;
        setVisibleCanvasKey(revealKey);
      });
    },
    [canvasProps, viewerCanvasKey],
  );

  const { clearFocus, focusViewOnEntity } = useFocusViewController({
    sceneTree: compiled.tree,
    getCurrentCanvasSize: diagramEngine.getCurrentCanvasSize,
    canvasLayoutVersion: diagramEngine.canvasLayoutVersion,
    showInspector,
    index,
    commitView: setView,
    flushUserGesture: diagramEngine.flushUserGesture,
    triggerEntityZoom,
    setSelectedEntity,
    setSelectedEdge,
  });

  const searchTotalMatches =
    diagramSearchMatches.matchingEntityIds.size + diagramSearchMatches.matchingRelationIds.size;
  const visibleSearchEntityMatchCount = useMemo(
    () =>
      [...diagramSearchMatches.matchingEntityIds].filter((id) => compiled.visibleIds.has(id))
        .length,
    [compiled.visibleIds, diagramSearchMatches.matchingEntityIds],
  );
  const visibleSearchRelationMatchCount = useMemo(
    () =>
      content.relations.filter(
        (relation) =>
          diagramSearchMatches.matchingRelationIds.has(relation.id) &&
          compiled.visibleIds.has(relation.from) &&
          compiled.visibleIds.has(relation.to),
      ).length,
    [compiled.visibleIds, diagramSearchMatches.matchingRelationIds, content.relations],
  );
  const searchHiddenMatches = Math.max(
    0,
    searchTotalMatches - visibleSearchEntityMatchCount - visibleSearchRelationMatchCount,
  );
  const revealDiagramSearchResults = useCallback(() => {
    if (searchTotalMatches === 0) {
      return;
    }
    flushUserGesture();
    setPendingStructuralTransitionIntent({
      direction: 'in',
      focus: { kind: 'global' },
      allowNonExpansionViewChanges: true,
    });
    setView((previous) =>
      applyDiagramViewOperation(index.tree, previous, {
        kind: 'search-reveal',
        entityIds: diagramSearchMatches.matchingEntityIds,
        relationIds: diagramSearchMatches.matchingRelationIds,
        relations: content.relations,
      }),
    );
  }, [
    index,
    content.relations,
    diagramSearchMatches.matchingEntityIds,
    diagramSearchMatches.matchingRelationIds,
    flushUserGesture,
    searchTotalMatches,
    setPendingStructuralTransitionIntent,
    setView,
  ]);
  useEffect(() => {
    setViewerSearchChrome({
      searchTotalMatches,
      searchHiddenMatches,
      onRevealSearchResults: searchHiddenMatches > 0 ? revealDiagramSearchResults : undefined,
    });
  }, [revealDiagramSearchResults, searchHiddenMatches, searchTotalMatches, setViewerSearchChrome]);

  useEffect(
    () => () => {
      setViewerSearchChrome({
        searchTotalMatches: 0,
        searchHiddenMatches: 0,
      });
    },
    [setViewerSearchChrome],
  );

  if (!detail && (detailQuery.isPending || detailQuery.isFetching)) {
    return <LoadingState fullscreen label="Loading gallery diagram" hint="Preparing the viewer." />;
  }

  if (detailQuery.data?.status === 404) {
    return (
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-center px-5 py-10">
        <div className="rounded-xl border border-border bg-surface px-6 py-6">
          <h1 className="text-xl font-semibold text-foreground">Gallery diagram not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The requested gallery entry could not be loaded.
          </p>
          <Link
            to="/gallery"
            className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
          >
            Back to gallery
          </Link>
        </div>
      </div>
    );
  }

  if (detailQuery.isError) {
    return (
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-center px-5 py-10">
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-6 py-6 text-sm text-destructive">
          <p>Couldn't load this diagram.</p>
          <div className="mt-4 flex items-center gap-4">
            <button
              type="button"
              onClick={() => void detailQuery.refetch()}
              className="border border-current px-3 py-1 font-medium hover:bg-destructive/10"
            >
              Retry
            </button>
            <Link to="/gallery" className="font-medium text-accent hover:underline">
              Back to gallery
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!detail || !loadedDiagram || !loadedDiagram.readable) {
    return (
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-center px-5 py-10">
        <div className="rounded-xl border border-border bg-surface px-6 py-6">
          <h1 className="text-xl font-semibold text-foreground">
            This diagram couldn't be loaded.
          </h1>
          <Link
            to="/gallery"
            className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
          >
            Back to gallery
          </Link>
        </div>
      </div>
    );
  }

  if (!viewerDocumentReady) {
    return <LoadingState fullscreen label="Loading gallery diagram" hint="Preparing the viewer." />;
  }

  return (
    <div className="flex h-full min-w-0 min-h-0 flex-1 flex-col">
      <div className="flex h-full flex-1 min-w-0 min-h-0">
        <div className="relative flex h-full flex-1 min-w-0 min-h-0">
          <div className="h-full flex-1 min-w-0 min-h-0">
            {shouldDelayCanvasMount ? (
              <div
                ref={diagramEngine.onCanvasElementChange}
                className="h-full w-full"
                aria-hidden="true"
              />
            ) : (
              <Diagram
                key={viewerCanvasKey}
                {...canvasProps}
                defaultViewport={defaultViewport}
                hidden={!isLiveCanvasVisible}
                onInit={handleCanvasInit}
              />
            )}
          </div>
          {shared.notice ? (
            <div
              role="status"
              className="absolute left-4 right-4 top-3 z-30 flex items-center justify-center gap-2 text-xs text-muted-foreground"
            >
              <span>
                This link was made for an earlier version of this diagram, so some of it couldn't be
                shown.
              </span>
              <button
                type="button"
                onClick={shared.dismissNotice}
                aria-label="Dismiss notice"
                className="px-1 hover:text-foreground"
              >
                ×
              </button>
            </div>
          ) : null}
          <CanvasToolbar
            onCenter={centerScene}
            onExpandAll={expandAll}
            onCollapseAll={collapseAll}
            onFocusView={
              inspectorViewModel.kind === 'entity' &&
              inspectorViewModel.canFocusView &&
              !inspectorViewModel.isFocusedEntity
                ? () => focusViewOnEntity(inspectorViewModel.entityId)
                : undefined
            }
            onResetFocusView={focusRootId ? clearFocus : undefined}
            centerOffset={showInspector ? INSPECTOR_CENTER_OFFSET : 0}
          />
        </div>
        {showInspector ? (
          <aside className="w-[420px] shrink-0 border-l border-border overflow-hidden flex flex-col">
            <GalleryInspector
              viewModel={inspectorViewModel}
              onToggleHighlight={toggleHighlight}
              onClearHighlights={clearHighlights}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
