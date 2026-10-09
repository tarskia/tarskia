import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  type Node,
  type NodeTypes,
  type OnMove,
  type OnMoveStart,
  type OnNodesChange,
  type ReactFlowInstance,
} from 'reactflow';
import type { NodeVisualMode } from '../node-visual-mode';
import { type DebugSummary, FlowDebugPanel } from '../ui/FlowDebugPanel';
import { CanvasFocusShellOverlay } from './CanvasFocusShellOverlay';
import { EdgeOverlay, type EdgeOverlayInteractionBindings } from './components/edges/EdgeOverlay';
import { TransitionOverlay } from './components/transition/TransitionOverlay';
import type { ReactFlowHostNodeData } from './host/reactflow/types';
import { scheduleHotReloadSafeUnmount } from './hot-reload-unmount';
import type { CanvasOverlayEdgeView } from './rendering/presentation/presentation';
import type { TransitionOverlayState } from './rendering/transition/overlay';
import type { OverlayFrameStore } from './rendering/transition/overlay-frame-store';

const EMPTY_FLOW_EDGES: never[] = [];

export interface DiagramCanvasProps {
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  onCanvasElementChange?: (element: HTMLDivElement | null) => void;
  defaultViewport?: { x: number; y: number; zoom: number };
  hidden?: boolean;
  leftOcclusion?: number;
  onLeftOcclusionChange?: (leftOcclusion: number) => void;
  nodeVisualMode: NodeVisualMode;
  hideHostVisuals: boolean;
  nodes: Node[];
  overlayEdges: CanvasOverlayEdgeView[];
  overlayInteractionBindings?: EdgeOverlayInteractionBindings;
  transitionOverlay?: TransitionOverlayState;
  overlayFrameStore?: OverlayFrameStore;
  nodeTypes: NodeTypes;
  onNodesChange: OnNodesChange;
  onNodeClick: (_event: unknown, node: Node) => void;
  onNodeContextMenu?: (event: React.MouseEvent, node: Node) => void;
  onInit: (instance: ReactFlowInstance) => void;
  onUnmount?: () => void;
  onPaneClick: () => void;
  onMoveStart: OnMoveStart;
  onMove: OnMove;
  onMoveEnd: OnMove;
  minZoom: number;
  maxZoom: number;
  showDebug: boolean;
  debugSummary: DebugSummary | null;
  onSelectFocusShell?: (id: string) => void;
  focusShells?: Array<{
    id: string;
    depth: number;
    displayName: string;
    typeLabel: string;
    hue?: number;
    isRoot?: boolean;
    frame: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    };
  }>;
}

export function DiagramCanvas({
  canvasRef,
  onCanvasElementChange,
  defaultViewport,
  hidden = false,
  leftOcclusion = 0,
  onLeftOcclusionChange,
  nodeVisualMode,
  hideHostVisuals,
  nodes,
  overlayEdges,
  overlayInteractionBindings,
  transitionOverlay,
  overlayFrameStore,
  nodeTypes,
  onNodesChange,
  onNodeClick,
  onNodeContextMenu,
  onInit,
  onUnmount,
  onPaneClick,
  onMoveStart,
  onMove,
  onMoveEnd,
  minZoom,
  maxZoom,
  showDebug,
  debugSummary,
  onSelectFocusShell,
  focusShells,
}: DiagramCanvasProps) {
  const overlayNodes = nodes as Node<ReactFlowHostNodeData>[];
  const unmountEffectGenerationRef = useRef(0);

  const handleCanvasElementRef = useCallback(
    (element: HTMLDivElement | null) => {
      canvasRef.current = element;
      onCanvasElementChange?.(element);
    },
    [canvasRef, onCanvasElementChange],
  );

  useLayoutEffect(() => {
    onLeftOcclusionChange?.(leftOcclusion);
  }, [leftOcclusion, onLeftOcclusionChange]);

  useEffect(() => {
    const effectGeneration = unmountEffectGenerationRef.current + 1;
    unmountEffectGenerationRef.current = effectGeneration;

    return () => {
      // Fast Refresh tears down effects before re-running them, but ReactFlow does not reliably
      // re-fire onInit in that path. Defer the cleanup and cancel it if a replacement effect
      // installs immediately so dev reloads do not strand the motion manager in "canvas unmounted".
      scheduleHotReloadSafeUnmount({
        onUnmount,
        effectGeneration,
        getCurrentEffectGeneration: () => unmountEffectGenerationRef.current,
      });
    };
  }, [onUnmount]);

  return (
    <div
      ref={handleCanvasElementRef}
      className={`canvas h-full w-full canvas-visual-${nodeVisualMode}${hideHostVisuals ? ' canvas-host-hidden' : ''}${hidden ? ' invisible' : ''}`}
    >
      {focusShells && focusShells.length > 0 ? (
        <CanvasFocusShellOverlay
          shells={focusShells}
          leftOcclusion={leftOcclusion}
          onSelectShell={onSelectFocusShell}
        />
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={EMPTY_FLOW_EDGES}
        nodeTypes={nodeTypes}
        defaultViewport={defaultViewport}
        onlyRenderVisibleElements={false}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onInit={onInit}
        onPaneClick={onPaneClick}
        onMoveStart={onMoveStart}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        nodesDraggable={false}
        nodesConnectable={false}
        elevateNodesOnSelect={false}
        elevateEdgesOnSelect={false}
        deleteKeyCode={null}
        minZoom={minZoom}
        maxZoom={maxZoom}
        preventScrolling
        zoomOnPinch
        zoomOnScroll
        noWheelClassName="nowheel"
      >
        <FlowDebugPanel show={showDebug} summary={debugSummary} />
        <Background gap={20} size={1.2} color="rgba(255,255,255,0.12)" />
        <EdgeOverlay
          edges={overlayEdges}
          nodes={overlayNodes}
          bindings={overlayInteractionBindings}
        />
        {transitionOverlay ? (
          <TransitionOverlay
            state={transitionOverlay}
            frameStore={overlayFrameStore}
            nodeVisualMode={nodeVisualMode}
          />
        ) : null}
      </ReactFlow>
    </div>
  );
}
