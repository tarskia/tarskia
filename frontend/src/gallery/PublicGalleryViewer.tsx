import { buildDiagramViewForSearchReveal, searchDiagramText } from '@tarskia/diagram-semantics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import type { DtoGalleryDiagramDetailResponse } from '../api/generated/model';
import Diagram from '../canvas/Diagram';
import { LoadingState } from '../components/ui/loading-state';
import { useDiagramEngine } from '../diagram/useDiagramEngine';
import { useDiagramSurface } from '../diagram/useDiagramSurface';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { buildSchemaVersionCatalog } from '../model/validation/schema-closure';
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
import { canFocusSceneNode, useFocusViewController } from '../viewer-core/focus-view';
import {
  createBlankDiagramDocument,
  loadDiagramDocFromRaw,
} from '../viewer-core/loadDiagramDocFromRaw';
import { useDiagramActions } from '../viewer-core/useDiagramActions';
import { coerceSuccessfulResponseBody } from './gallery-response';

import { useGalleryDiagramQuery } from './useGalleryDiagramQuery';
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
  const { setViewerSearchChrome } = useOutletContext<PublicGalleryShellContext>();
  const detailQuery = useGalleryDiagramQuery(namespace, slug);

  const schemaVersionCatalog = useMemo(
    () => buildSchemaVersionCatalog(semanticBootstrap.builtInSchemaCatalogEntries),
    [],
  );
  const fallbackSchema = semanticBootstrap.schemaModules[0];
  const [doc, setDoc] = useState(() => createBlankDiagramDocument('0.1.0'));
  const [validationDocument, setValidationDocument] = useState(doc);
  const [sourceDiagnostics, setSourceDiagnostics] = useState<
    ReturnType<typeof loadDiagramDocFromRaw>['sourceDiagnostics']
  >([]);
  const [selectedEntityId, setSelectedEntity] = useState<string | undefined>();
  const [selectedEdgeId, setSelectedEdge] = useState<string | undefined>();
  const revealFrameRef = useRef<number | null>(null);
  const viewerCanvasKey = `${namespace}/${slug}`;
  const [loadedViewerCanvasKey, setLoadedViewerCanvasKey] = useState<string | undefined>();
  const [visibleCanvasKey, setVisibleCanvasKey] = useState<string | undefined>();
  const viewerDocumentReady = loadedViewerCanvasKey === viewerCanvasKey;
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

  useEffect(() => {
    if (!loadedDiagram) {
      return;
    }
    setDoc(loadedDiagram.doc);
    setValidationDocument(loadedDiagram.doc);
    setSourceDiagnostics(loadedDiagram.sourceDiagnostics);
    setSelectedEntity(undefined);
    setSelectedEdge(undefined);
    setVisibleCanvasKey(undefined);
    setLoadedViewerCanvasKey(viewerCanvasKey);
  }, [loadedDiagram, viewerCanvasKey]);

  useEffect(
    () => () => {
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
      }
    },
    [],
  );

  const commitDoc = useCallback((updater: typeof doc | ((previous: typeof doc) => typeof doc)) => {
    setDoc((previous) =>
      typeof updater === 'function'
        ? (updater as (previous: typeof doc) => typeof doc)(previous)
        : updater,
    );
  }, []);

  const { persistViewport, savedViewport } = useViewerViewport(loadedDiagram?.doc);

  const semanticRuntime = useDiagramSemanticRuntime({
    doc,
    validationDocument,
    schemaVersionCatalog,
    fallbackSchema,
    sourceDiagnostics,
  });
  const { schema, entityIndex } = semanticRuntime;
  const focusRootId = doc.view?.scopeRootId;
  const diagramSearchQuery = searchParams.get('q') ?? '';
  const diagramSearchMatches = useMemo(
    () => searchDiagramText({ doc, schema, query: diagramSearchQuery }),
    [diagramSearchQuery, doc, schema],
  );

  const diagramEngine = useDiagramEngine({
    doc,
    schema,
    skipTransitions: reducedMotion,
    showDebug: false,
    persistViewport,
    savedViewport,
    initialViewportKey: `${namespace}/${slug}`,
    minZoom: MIN_VIEW_ZOOM,
    maxZoom: MAX_VIEW_ZOOM,
  });
  const {
    graph,
    compiled,
    requestNavigation,
    flushUserGesture,
    setPendingStructuralTransitionIntent,
  } = diagramEngine;
  const defaultViewport = diagramEngine.initialViewport;
  const hasSceneContent = doc.entities.length > 0 || doc.relations.length > 0;
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
    triggerEntityZoom,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
  } = useDiagramActions({
    state: {
      doc,
    },
    document: {
      commitDoc,
    },
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
    () => doc.relations.find((relation) => relation.id === selectedEdgeId),
    [doc.relations, selectedEdgeId],
  );
  const selectedEntityCanFocus = Boolean(
    selectedEntity && canFocusSceneNode({ sceneTree: compiled.tree, entityId: selectedEntity.id }),
  );
  const diagramProvenance = useMemo(() => buildDiagramProvenanceSource(doc), [doc]);
  const inspectorViewModel = useMemo(
    () =>
      buildInspectorViewModel({
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
    ],
  );
  const showInspector = inspectorViewModel.kind !== 'empty';

  const canvasBindings = useMemo(
    () => buildCanvasSemanticBindings({ schema, entityIndex }),
    [schema, entityIndex],
  );

  const { canvasProps } = useDiagramSurface({
    doc,
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
    commitDoc,
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
      doc.relations.filter(
        (relation) =>
          diagramSearchMatches.matchingRelationIds.has(relation.id) &&
          compiled.visibleIds.has(relation.from) &&
          compiled.visibleIds.has(relation.to),
      ).length,
    [compiled.visibleIds, diagramSearchMatches.matchingRelationIds, doc.relations],
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
    commitDoc((previous) => ({
      ...previous,
      view: buildDiagramViewForSearchReveal({
        doc: previous,
        matchingEntityIds: diagramSearchMatches.matchingEntityIds,
        matchingRelationIds: diagramSearchMatches.matchingRelationIds,
      }),
    }));
  }, [
    commitDoc,
    diagramSearchMatches.matchingEntityIds,
    diagramSearchMatches.matchingRelationIds,
    flushUserGesture,
    searchTotalMatches,
    setPendingStructuralTransitionIntent,
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
          <CanvasToolbar
            onCenter={centerScene}
            onExpandAll={expandAll}
            onCollapseAll={collapseAll}
            onFocusView={
              inspectorViewModel.kind === 'entity' &&
              inspectorViewModel.selectedChildCount > 0 &&
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
            <GalleryInspector viewModel={inspectorViewModel} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
