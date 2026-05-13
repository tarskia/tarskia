import { useMemo } from 'react';

import { EntityNode } from '../canvas/components/nodes/EntityNode';
import { GroupNode } from '../canvas/components/nodes/GroupNode';
import type { GraphModel } from '../canvas/rendering/graph/graph-model';
import { useCanvasSurfaceController } from '../canvas/useCanvasSurfaceController';
import type { NodeVisualMode } from '../node-visual-mode';
import type { Entity, EntityIndex, SchemaModule, SemanticDocument } from '../semantic';
import type { CanvasSemanticBindings } from '../shell/view-models';
import type { NavigationIntent } from './motion-types';
import type { useDiagramEngine } from './useDiagramEngine';

const nodeTypes = {
  entityNode: EntityNode,
  groupNode: GroupNode,
};

interface UseDiagramSurfaceArgs {
  doc: SemanticDocument;
  schema: SchemaModule;
  graph: GraphModel;
  entityIndex: EntityIndex;
  selectedEntityId?: string;
  selectedEdgeId?: string;
  focusRootId?: string;
  searchMatches?: {
    matchingEntityIds: Set<string>;
    matchingRelationIds: Set<string>;
  };
  setSelectedEntity: (id: string | undefined) => void;
  setSelectedEdge: (id: string | undefined) => void;
  traceSelection: (event: string, payload?: Record<string, unknown>) => void;
  canContainEntity: (parent: Entity, childType: string) => boolean;
  resolveDefaultEntityName: (
    typeId: string,
    requestedName: string | undefined,
    existingCount: number,
  ) => string | undefined;
  addEntity: (typeId: string, parentId?: string, name?: string) => string;
  commitDoc: (
    updater: SemanticDocument | ((prev: SemanticDocument) => SemanticDocument),
    options?: { undoable?: boolean },
  ) => void;
  deleteEntities: (ids: string[]) => void;
  showDebug: boolean;
  nodeVisualMode: NodeVisualMode;
  triggerEntityZoom: (entityId: string, direction: 'in' | 'out') => boolean;
  expandAllDetailsWithin: (rootId: string) => void;
  collapseAllDetailsWithin: (rootId: string) => void;
  expandChildGroupsWithin: (rootId: string) => void;
  collapseChildGroupsWithin: (rootId: string) => void;
  minZoom: number;
  maxZoom: number;
  readOnly?: boolean;
  semanticBindings: CanvasSemanticBindings;
  diagramEngine: ReturnType<typeof useDiagramEngine>;
}

export function useDiagramSurface({
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
  minZoom,
  maxZoom,
  readOnly = false,
  semanticBindings,
  diagramEngine,
}: UseDiagramSurfaceArgs) {
  const selectedEntity = useMemo(
    () => (selectedEntityId ? entityIndex.byId.get(selectedEntityId) : undefined),
    [entityIndex.byId, selectedEntityId],
  );
  const stableNodeTypes = useMemo(() => nodeTypes, []);

  return useCanvasSurfaceController({
    surface: {
      canvasRef: diagramEngine.canvasRef,
      onCanvasElementChange: diagramEngine.onCanvasElementChange,
      onCanvasInit: diagramEngine.onCanvasInit,
      onCanvasUnmount: diagramEngine.onCanvasUnmount,
      onLeftOcclusionChange: diagramEngine.setLeftOcclusion,
      screenToWorldPosition: diagramEngine.screenToWorldPosition,
      readOnly,
      showDebug,
      getCurrentCanvasSize: diagramEngine.getCurrentCanvasSize,
      canvasLayoutVersion: diagramEngine.canvasLayoutVersion,
      minZoom,
      maxZoom,
      nodeVisualMode,
      nodeTypes: stableNodeTypes,
    },
    graphState: {
      doc,
      schema,
      graph,
      entityIndex,
      selectedEntity,
      selectedEntityId,
      selectedEdgeId,
      focusRootId,
      searchMatches,
    },
    graphQueries: {
      canContainEntity,
      resolveDefaultEntityName,
    },
    semantic: semanticBindings,
    graphActions: {
      setSelectedEntity,
      setSelectedEdge,
      addEntity,
      commitDoc,
      deleteEntities,
      triggerEntityZoom,
      expandAllDetailsWithin,
      collapseAllDetailsWithin,
      expandChildGroupsWithin,
      collapseChildGroupsWithin,
    },
    transition: {
      getCurrentViewport: diagramEngine.getCurrentViewport,
      requestNavigation: (intent: NavigationIntent) => diagramEngine.requestNavigation(intent),
      reportUserGestureStart: diagramEngine.reportUserGestureStart,
      reportUserGestureMove: diagramEngine.reportUserGestureMove,
      reportUserGestureEnd: diagramEngine.reportUserGestureEnd,
      notifyDisplayHostSettled: diagramEngine.notifyDisplayHostSettled,
      presentation: diagramEngine.presentation,
      compiled: diagramEngine.compiled,
      transitionOverlay: diagramEngine.transitionOverlay,
      transitionOverlayFrame: diagramEngine.transitionOverlayFrame,
      hideHostVisuals: diagramEngine.hideHostVisuals,
      transitionLiteMode: diagramEngine.transitionLiteMode,
      isTransitionRunning: diagramEngine.isTransitionRunning,
      isTransitionQueued: diagramEngine.isTransitionQueued,
      motionPhase: diagramEngine.motionPhase,
      requiredHostGeneration: diagramEngine.requiredHostGeneration,
      frameDurations: diagramEngine.frameDurations,
    },
    telemetry: {
      traceSelection,
    },
  });
}
