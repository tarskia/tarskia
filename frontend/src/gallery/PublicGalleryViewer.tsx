import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { useGetGalleryDiagram } from '../api/generated/gallery/gallery';
import type { DtoGalleryDiagramDetailResponse } from '../api/generated/model';
import Diagram from '../canvas/Diagram';
import { LoadingState } from '../components/ui/loading-state';
import { cloneAnimationSettings } from '../diagram/animation-settings';
import { useDiagramEngine } from '../diagram/useDiagramEngine';
import { useDiagramSurface } from '../diagram/useDiagramSurface';
import type { PublicGalleryShellContext } from '../PublicGalleryShell';
import {
  buildDiagramViewForSearchReveal,
  buildSchemaVersionCatalog,
  CORE_GROUP_TYPE_ID,
  type Entity,
  getDiagramViewExpandedMap,
  resolveTypeDef,
  searchDiagramText,
  traitMatches,
  typeMatches,
  useDiagramSemanticRuntime,
} from '../semantic';
import { semanticBootstrap } from '../semantic/bootstrap';
import { buildCanvasSemanticBindings } from '../shell/buildCanvasSemanticBindings';
import {
  buildDiagramProvenanceSource,
  buildInspectorViewModel,
} from '../shell/buildInspectorViewModel';
import { ensureDiagramView, ensureDiagramViewLayout } from '../shell/diagram-view';
import { useFocusViewController } from '../shell/focus-view';
import { createBlankDiagramDocument, loadDiagramDocFromRaw } from '../shell/loadDiagramDocFromRaw';
import { useShellDiagramActions } from '../shell/useShellDiagramActions';
import { CanvasToolbar } from '../ui/CanvasToolbar';
import { GalleryInspector } from '../ui/GalleryInspector';
import {
  GALLERY_QUERY_STALE_TIME_MS,
  galleryRetryDelay,
  getGalleryDiagramWithLocalFallback,
  retryGalleryQuery,
} from './gallery-query';
import { coerceSuccessfulResponseBody } from './gallery-response';

const MIN_VIEW_ZOOM = 0.05;
const MAX_VIEW_ZOOM = 2;
const INSPECTOR_PANEL_WIDTH = 420;
const INSPECTOR_CENTER_OFFSET = INSPECTOR_PANEL_WIDTH / 2;

const NOOP_TRACE_SELECTION = () => {};

const buildViewerTitle = (params: { title?: string; slug?: string; namespace?: string }) =>
  params.title?.trim() || params.slug?.trim() || params.namespace?.trim() || 'Gallery diagram';

export default function PublicGalleryViewer() {
  const { namespace = '', slug = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { setViewerSearchChrome } = useOutletContext<PublicGalleryShellContext>();
  const detailQuery = useGetGalleryDiagram(namespace, slug, {
    query: {
      staleTime: GALLERY_QUERY_STALE_TIME_MS,
      retry: retryGalleryQuery,
      retryDelay: galleryRetryDelay,
      queryFn: ({ signal }) => getGalleryDiagramWithLocalFallback(namespace, slug, { signal }),
    },
  });

  const schemaVersionCatalog = useMemo(
    () => buildSchemaVersionCatalog(semanticBootstrap.builtInSchemaCatalogEntries),
    [],
  );
  const fallbackSchema = semanticBootstrap.schemaModules[0];
  const [doc, setDoc] = useState(() =>
    createBlankDiagramDocument(semanticBootstrap.primaryStarter.document.version),
  );
  const [sourceDiagnostics, setSourceDiagnostics] = useState<
    ReturnType<typeof loadDiagramDocFromRaw>['sourceDiagnostics']
  >([]);
  const [selectedEntityId, setSelectedEntity] = useState<string | undefined>();
  const [selectedEdgeId, setSelectedEdge] = useState<string | undefined>();
  const [animationSettings] = useState(() => cloneAnimationSettings());
  const revealFrameRef = useRef<number | null>(null);
  const viewerCanvasKey = `${namespace}/${slug}`;
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

  useEffect(() => {
    if (!loadedDiagram) {
      return;
    }
    setDoc(loadedDiagram.doc);
    setSourceDiagnostics(loadedDiagram.sourceDiagnostics);
    setSelectedEntity(undefined);
    setSelectedEdge(undefined);
  }, [loadedDiagram]);

  useEffect(
    () => () => {
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
      }
    },
    [],
  );

  const commitDoc = useCallback(
    (
      updater: typeof doc | ((previous: typeof doc) => typeof doc),
      _options?: { undoable?: boolean },
    ) => {
      setDoc((previous) =>
        typeof updater === 'function'
          ? (updater as (previous: typeof doc) => typeof doc)(previous)
          : updater,
      );
    },
    [],
  );

  const persistViewport = useCallback(
    (viewport: { x: number; y: number; zoom: number }) => {
      commitDoc(
        (previous) => {
          const view = ensureDiagramView(previous.view);
          const layout = ensureDiagramViewLayout(previous.view);
          return {
            ...previous,
            view: {
              ...view,
              layout: {
                ...layout,
                viewport,
              },
            },
          };
        },
        { undoable: false },
      );
    },
    [commitDoc],
  );

  const semanticRuntime = useDiagramSemanticRuntime({
    doc,
    schemaVersionCatalog,
    fallbackSchema,
    sourceDiagnostics,
  });
  const { schema, schemaRuntime, entityIndex } = semanticRuntime;
  const expanded = useMemo(() => getDiagramViewExpandedMap(doc.view), [doc.view]);
  const focusRootId = doc.view?.scopeRootId;
  const diagramSearchQuery = searchParams.get('q') ?? '';
  const diagramSearchMatches = useMemo(
    () => searchDiagramText({ doc, schema, query: diagramSearchQuery }),
    [diagramSearchQuery, doc, schema],
  );

  const canContainEntity = useCallback(
    (parent: Entity, childType: string) => {
      const parentDef = resolveTypeDef(schema, parent.type);
      const containment = parentDef?.containment;
      if (!containment) return false;
      const typeOk = containment.allowedChildTypes
        ? typeMatches(schema, childType, containment.allowedChildTypes)
        : true;
      const traitOk = containment.allowedChildTraits
        ? traitMatches(schema, childType, containment.allowedChildTraits)
        : true;
      if (!typeOk || !traitOk) return false;
      if (parent.type !== CORE_GROUP_TYPE_ID) return true;
      const props = parent.props as Record<string, unknown> | undefined;
      if (props?.mode !== 'typed') return true;
      const groupType = typeof props.groupType === 'string' ? props.groupType.trim() : '';
      if (!groupType) return true;
      return childType === groupType;
    },
    [schema],
  );

  const diagramEngine = useDiagramEngine({
    doc,
    schema,
    animationSettings,
    skipTransitions: false,
    showDebug: false,
    persistViewport,
    traceSelection: NOOP_TRACE_SELECTION,
    savedViewport: doc.view?.layout?.viewport,
    initialViewportKey: `${namespace}/${slug}`,
    cameraPolicy: {
      openingMode: 'immediate',
    },
    minZoom: MIN_VIEW_ZOOM,
    maxZoom: MAX_VIEW_ZOOM,
  });
  const {
    graph,
    sceneQueries,
    compiled,
    requestNavigation,
    cancelTransitions,
    flushUserGesture,
    setPendingStructuralTransitionIntent,
  } = diagramEngine;
  const defaultViewport = diagramEngine.initialViewport;
  const hasSceneContent = doc.entities.length > 0 || doc.relations.length > 0;
  const shouldDelayCanvasMount = hasSceneContent && !defaultViewport && !isLiveCanvasVisible;

  const {
    centerScene,
    expandAll,
    collapseAll,
    triggerEntityZoom,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
  } = useShellDiagramActions({
    state: {
      doc,
      expanded,
      entityIndex,
    },
    document: {
      commitDoc,
      ensureDiagramView,
    },
    transition: {
      requestNavigation,
      cancelTransitions,
      flushUserGesture: diagramEngine.flushUserGesture,
      setPendingStructuralTransitionIntent: diagramEngine.setPendingStructuralTransitionIntent,
    },
    selection: {
      setSelectedEntity,
      setSelectedEdge,
    },
    rules: {
      canContainEntity,
      resolveDefaultEntityName: () => undefined,
    },
    sceneQueries: {
      structure: sceneQueries.structure,
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
  const selectedSceneNode = useMemo(
    () => (selectedEntity ? compiled.scene.tree.byId.get(selectedEntity.id) : undefined),
    [compiled.scene.tree.byId, selectedEntity],
  );
  const selectedEntityCanFocus = Boolean(
    selectedEntity && selectedSceneNode?.hasChildren && selectedSceneNode.layoutMode !== 'list',
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

  const readOnlyCanvasBindings = useMemo(() => {
    const bindings = buildCanvasSemanticBindings({
      doc,
      schema,
      schemaRuntime,
      graph,
      entityIndex,
      commitDoc: () => {},
      canContainEntity,
      resolveDefaultEntityName: () => undefined,
    });
    return {
      ...bindings,
      createRelation: () => {},
      createRelatedEntity: () => undefined,
      listCandidateTypes: () => [],
      listCandidateEntities: () => [],
      listRelationOptions: () => [],
      setRelationType: () => {},
      applyRelationOption: () => {},
    };
  }, [canContainEntity, doc, entityIndex, graph, schema, schemaRuntime]);

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
    traceSelection: NOOP_TRACE_SELECTION,
    canContainEntity,
    resolveDefaultEntityName: () => undefined,
    addEntity: () => '',
    commitDoc,
    deleteEntities: () => {},
    showDebug: false,
    nodeVisualMode: 'outline',
    triggerEntityZoom,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
    minZoom: MIN_VIEW_ZOOM,
    maxZoom: MAX_VIEW_ZOOM,
    semanticBindings: readOnlyCanvasBindings,
    diagramEngine,
    readOnly: true,
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
    sceneTree: compiled.scene.tree,
    expanded,
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
      [...diagramSearchMatches.matchingEntityIds].filter((id) => compiled.scene.visibleIds.has(id))
        .length,
    [compiled.scene.visibleIds, diagramSearchMatches.matchingEntityIds],
  );
  const visibleSearchRelationMatchCount = useMemo(
    () =>
      doc.relations.filter(
        (relation) =>
          diagramSearchMatches.matchingRelationIds.has(relation.id) &&
          compiled.scene.visibleIds.has(relation.from) &&
          compiled.scene.visibleIds.has(relation.to),
      ).length,
    [compiled.scene.visibleIds, diagramSearchMatches.matchingRelationIds, doc.relations],
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
    commitDoc(
      (previous) => ({
        ...previous,
        view: buildDiagramViewForSearchReveal({
          doc: previous,
          matchingEntityIds: diagramSearchMatches.matchingEntityIds,
          matchingRelationIds: diagramSearchMatches.matchingRelationIds,
        }),
      }),
      { undoable: false },
    );
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

  if (!detail || !loadedDiagram) {
    return (
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-center px-5 py-10">
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-6 py-6 text-sm text-destructive">
          Failed to load the gallery diagram.
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
            onCopyDiagramView={() => {}}
            canCopyDiagramView={false}
            availableSchemas={[]}
            onToggleSchema={() => {}}
            showSchemas={false}
            showCopy={false}
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
