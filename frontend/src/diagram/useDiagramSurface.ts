import type { EntityIndex, SchemaModule, SemanticDocument } from '@tarskia/diagram-semantics';
import { useMemo } from 'react';
import { EntityNode } from '../canvas/components/nodes/EntityNode';
import { GroupNode } from '../canvas/components/nodes/GroupNode';
import type { GraphModel } from '../canvas/rendering/graph/graph-model';
import { useCanvasSurfaceController } from '../canvas/useCanvasSurfaceController';
import type { NodeVisualMode } from '../node-visual-mode';
import type { CanvasSemanticBindings } from '../viewer-core/view-models';
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
  showDebug: boolean;
  nodeVisualMode: NodeVisualMode;
  triggerEntityZoom: (entityId: string, direction: 'in' | 'out') => boolean;
  expandAllDetailsWithin: (rootId: string) => void;
  collapseAllDetailsWithin: (rootId: string) => void;
  expandChildGroupsWithin: (rootId: string) => void;
  collapseChildGroupsWithin: (rootId: string) => void;
  minZoom: number;
  maxZoom: number;
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
  showDebug,
  nodeVisualMode,
  triggerEntityZoom,
  expandAllDetailsWithin,
  collapseAllDetailsWithin,
  expandChildGroupsWithin,
  collapseChildGroupsWithin,
  minZoom,
  maxZoom,
  semanticBindings,
  diagramEngine,
}: UseDiagramSurfaceArgs) {
  const stableNodeTypes = useMemo(() => nodeTypes, []);

  return useCanvasSurfaceController({
    surface: {
      canvasRef: diagramEngine.canvasRef,
      onCanvasElementChange: diagramEngine.onCanvasElementChange,
      onCanvasInit: diagramEngine.onCanvasInit,
      onCanvasUnmount: diagramEngine.onCanvasUnmount,
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
      selectedEntityId,
      selectedEdgeId,
      focusRootId,
      searchMatches,
    },
    semantic: semanticBindings,
    graphActions: {
      setSelectedEntity,
      setSelectedEdge,
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
      overlayFrameStore: diagramEngine.overlayFrameStore,
      hideHostVisuals: diagramEngine.hideHostVisuals,
      transitionLiteMode: diagramEngine.transitionLiteMode,
      isTransitionRunning: diagramEngine.isTransitionRunning,
      isTransitionQueued: diagramEngine.isTransitionQueued,
      motionPhase: diagramEngine.motionPhase,
      requiredHostGeneration: diagramEngine.requiredHostGeneration,
    },
  });
}
