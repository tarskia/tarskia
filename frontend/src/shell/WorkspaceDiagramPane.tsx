import {
  forwardRef,
  memo,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import Diagram from '../canvas/Diagram';
import { useDiagramEngine } from '../diagram/useDiagramEngine';
import { useDiagramSurface } from '../diagram/useDiagramSurface';
import { getDiagramViewExpandedMap } from '../semantic';
import { CanvasToolbar } from '../ui/CanvasToolbar';
import { Inspector } from '../ui/Inspector';
import { NodeContextMenu, type NodeContextMenuState } from '../ui/NodeContextMenu';
import {
  canCopyDiagramViewToClipboard,
  copyDiagramViewToClipboard as copyDiagramViewToClipboardImage,
} from '../util/copy-diagram-view';
import { buildCanvasSemanticBindings } from './buildCanvasSemanticBindings';
import { buildDiagramProvenanceSource, buildInspectorViewModel } from './buildInspectorViewModel';
import { ensureDiagramView, ensureDiagramViewLayout } from './diagram-view';
import { useFocusViewController } from './focus-view';
import { useShellDiagramActions } from './useShellDiagramActions';
import type {
  WorkspaceDiagramModel,
  WorkspaceDiagramRuntimeHandle,
} from './workspace-diagram-types';

const MIN_VIEW_ZOOM = 0.05;
const MAX_VIEW_ZOOM = 2;
const INSPECTOR_PANEL_WIDTH = 320;
const INSPECTOR_CENTER_OFFSET = INSPECTOR_PANEL_WIDTH / 2;

export const shouldDelayWorkspaceCanvasMount = (params: {
  hasContent: boolean;
  defaultViewport?: { x: number; y: number; zoom: number };
}) => params.hasContent && !params.defaultViewport;

export interface WorkspaceDiagramPaneProps {
  model: WorkspaceDiagramModel;
  leftOcclusion: number;
}

const WorkspaceDiagramPaneInner = forwardRef<
  WorkspaceDiagramRuntimeHandle,
  WorkspaceDiagramPaneProps
>(function WorkspaceDiagramPaneInner({ model, leftOcclusion }, ref) {
  const {
    doc,
    viewportSessionKey,
    schema,
    schemaRuntime,
    entityIndex,
    selectedEntityId,
    selectedEdgeId,
    focusRootId,
    searchMatches,
    nodeVisualMode,
    showDebug,
    animationSettings,
    skipTransitions,
    showInspector,
    availableSchemas,
    onToggleSchema,
    canContainEntity,
    resolveDefaultEntityName,
    commitDoc,
    setSelectedEntity,
    setSelectedEdge,
    traceSelection,
  } = model;
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
  const revealFrameRef = useRef<number | null>(null);
  const [visibleCanvasKey, setVisibleCanvasKey] = useState<string | undefined>();
  const isLiveCanvasVisible = visibleCanvasKey === viewportSessionKey;

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

  const diagramEngine = useDiagramEngine({
    doc,
    schema,
    animationSettings,
    skipTransitions,
    showDebug,
    persistViewport,
    traceSelection,
    savedViewport: doc.view?.layout?.viewport,
    initialViewportKey: viewportSessionKey,
    leftOcclusion,
    minZoom: MIN_VIEW_ZOOM,
    maxZoom: MAX_VIEW_ZOOM,
  });
  const { graph, sceneQueries, compiled, requestNavigation, cancelTransitions } = diagramEngine;
  const defaultViewport = diagramEngine.initialViewport;
  const hasSceneContent = doc.entities.length > 0 || doc.relations.length > 0;

  useEffect(
    () => () => {
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
      }
    },
    [],
  );

  const shouldDelayCanvasMount = shouldDelayWorkspaceCanvasMount({
    hasContent: hasSceneContent,
    defaultViewport,
  });
  const expanded = useMemo(() => getDiagramViewExpandedMap(doc.view), [doc.view]);
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

  const canvasSemanticBindings = useMemo(
    () =>
      buildCanvasSemanticBindings({
        doc,
        schema,
        schemaRuntime,
        graph,
        entityIndex,
        commitDoc,
        canContainEntity,
        resolveDefaultEntityName,
      }),
    [
      canContainEntity,
      commitDoc,
      doc,
      entityIndex,
      graph,
      resolveDefaultEntityName,
      schema,
      schemaRuntime,
    ],
  );

  const {
    centerScene,
    expandAll,
    collapseAll,
    triggerEntityZoom,
    addEntity,
    createInspectorChild,
    createInspectorSibling,
    duplicateEntity,
    moveEntity,
    setEntityProp,
    removeEntityProp,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
    updateEntityName,
    updateEntityTags,
    deleteEntities,
    deleteEntity,
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
      resolveDefaultEntityName,
    },
    sceneQueries: {
      structure: sceneQueries.structure,
    },
  });

  const { canvasProps, clearCanvasTransientState } = useDiagramSurface({
    doc,
    schema,
    graph,
    entityIndex,
    selectedEntityId,
    selectedEdgeId,
    focusRootId,
    searchMatches,
    setSelectedEntity,
    setSelectedEdge,
    traceSelection,
    canContainEntity,
    resolveDefaultEntityName,
    addEntity,
    commitDoc,
    deleteEntities,
    showDebug,
    nodeVisualMode,
    triggerEntityZoom,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
    minZoom: MIN_VIEW_ZOOM,
    maxZoom: MAX_VIEW_ZOOM,
    semanticBindings: canvasSemanticBindings,
    diagramEngine,
  });

  const canCopyDiagramView = useMemo(() => canCopyDiagramViewToClipboard(), []);
  const [isCopyingDiagramView, setIsCopyingDiagramView] = useState(false);

  const clearTransientState = useCallback(() => {
    diagramEngine.flushUserGesture();
    cancelTransitions();
    diagramEngine.setPendingStructuralTransitionIntent(null);
    clearCanvasTransientState();
    setNodeContextMenu(null);
  }, [cancelTransitions, clearCanvasTransientState, diagramEngine]);

  const addEntityFromPalette = useCallback(
    (typeId: string) => {
      const parentId =
        selectedEntity && canContainEntity(selectedEntity, typeId) ? selectedEntity.id : undefined;
      const id = addEntity(typeId, parentId);
      if (id) {
        setSelectedEntity(id);
        setSelectedEdge(undefined);
      }
      setNodeContextMenu(null);
    },
    [addEntity, canContainEntity, selectedEntity, setSelectedEntity, setSelectedEdge],
  );

  useImperativeHandle(
    ref,
    () => ({
      requestNavigation,
      flushUserGesture: diagramEngine.flushUserGesture,
      setPendingStructuralTransitionIntent: diagramEngine.setPendingStructuralTransitionIntent,
      cancelTransitions,
      clearTransientState,
      addEntityFromPalette,
    }),
    [
      addEntityFromPalette,
      cancelTransitions,
      clearTransientState,
      diagramEngine.flushUserGesture,
      diagramEngine.setPendingStructuralTransitionIntent,
      requestNavigation,
    ],
  );

  const { clearFocus, focusViewOnEntity } = useFocusViewController({
    sceneTree: compiled.scene.tree,
    expanded,
    canvasSize: diagramEngine.canvasSize,
    skipTransitions,
    showInspector,
    commitDoc,
    flushUserGesture: diagramEngine.flushUserGesture,
    triggerEntityZoom,
    setSelectedEntity,
    setSelectedEdge,
    onClearTransientFocusChrome: () => setNodeContextMenu(null),
  });

  const copyDiagramViewToClipboard = useCallback(async () => {
    const canvasElement = diagramEngine.canvasRef.current;
    if (!canvasElement) {
      return;
    }
    setIsCopyingDiagramView(true);
    try {
      await copyDiagramViewToClipboardImage(canvasElement);
    } finally {
      setIsCopyingDiagramView(false);
    }
  }, [diagramEngine.canvasRef]);

  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: { id: string }) => {
      event.preventDefault();
      canvasProps.onNodeClick(event, node as Parameters<typeof canvasProps.onNodeClick>[1]);
      setNodeContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
    },
    [canvasProps],
  );

  const closeNodeContextMenu = useCallback(() => setNodeContextMenu(null), []);

  const handleCanvasInit = useCallback(
    (instance: Parameters<typeof canvasProps.onInit>[0]) => {
      canvasProps.onInit(instance);
      const revealKey = viewportSessionKey;
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
      }
      revealFrameRef.current = requestAnimationFrame(() => {
        revealFrameRef.current = null;
        setVisibleCanvasKey(revealKey);
      });
    },
    [canvasProps, viewportSessionKey],
  );

  return (
    <div className="flex h-full flex-1 min-w-0 min-h-0">
      <div className="relative flex h-full flex-col flex-1 min-w-0 min-h-0">
        <div className="relative flex h-full flex-1 min-h-0">
          <div className="h-full flex-1 min-w-0 min-h-0">
            {shouldDelayCanvasMount ? (
              <div
                ref={diagramEngine.onCanvasElementChange}
                className="h-full w-full"
                aria-hidden="true"
              />
            ) : (
              <Diagram
                key={viewportSessionKey}
                {...canvasProps}
                defaultViewport={defaultViewport}
                hidden={!isLiveCanvasVisible}
                leftOcclusion={leftOcclusion}
                onInit={handleCanvasInit}
                onNodeContextMenu={handleNodeContextMenu}
              />
            )}
          </div>

          <CanvasToolbar
            onCenter={centerScene}
            onCopyDiagramView={copyDiagramViewToClipboard}
            canCopyDiagramView={canCopyDiagramView}
            isCopyingDiagramView={isCopyingDiagramView}
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
            availableSchemas={availableSchemas}
            onToggleSchema={onToggleSchema}
            showSchemas
            centerOffset={showInspector ? INSPECTOR_CENTER_OFFSET : 0}
          />
        </div>
      </div>

      {showInspector ? (
        <aside className="w-[320px] shrink-0 border-l border-border overflow-hidden flex flex-col">
          <Inspector
            viewModel={inspectorViewModel}
            onUpdateName={updateEntityName}
            onUpdateTags={updateEntityTags}
            onCreateChild={createInspectorChild}
            onCreateSibling={createInspectorSibling}
            onDuplicate={duplicateEntity}
            onMove={moveEntity}
            onSetProp={setEntityProp}
            onDeleteProp={removeEntityProp}
            onDelete={deleteEntity}
            onFocusView={selectedEntityCanFocus && selectedEntity ? focusViewOnEntity : undefined}
          />
        </aside>
      ) : null}

      {nodeContextMenu && inspectorViewModel.kind === 'entity' ? (
        <NodeContextMenu
          state={nodeContextMenu}
          viewModel={inspectorViewModel}
          onClose={closeNodeContextMenu}
          onRename={() => {
            closeNodeContextMenu();
          }}
          onDuplicate={duplicateEntity}
          onDelete={deleteEntity}
          onFocusView={selectedEntityCanFocus ? focusViewOnEntity : undefined}
          onCreateChild={createInspectorChild}
          onCreateSibling={createInspectorSibling}
          onMove={moveEntity}
        />
      ) : null}
    </div>
  );
});

export const WorkspaceDiagramPane = memo(WorkspaceDiagramPaneInner);
