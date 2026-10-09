import type { MutableRefObject } from 'react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { NodeVisualMode } from '../node-visual-mode';
import type { CanvasDebugInputs } from './CanvasDebugPanel';
import { CanvasFocusShellOverlay } from './CanvasFocusShellOverlay';
import { type CanvasCamera, mountCanvasCamera } from './camera';
import type {
  CanvasInteractionBindings,
  CanvasMoveHandler,
  CanvasNode,
  CanvasNodeTypes,
  EdgeOverlayInteractionBindings,
} from './canvas-types';
import { DiagramRenderer } from './DiagramRenderer';
import { scheduleHotReloadSafeUnmount } from './hot-reload-unmount';
import type {
  CanvasOverlayEdgeView,
  CanvasRenderSnapshot,
} from './rendering/presentation/presentation';
import type { TransitionFrameState } from './rendering/transition/overlay';
import type { OverlayFrameStore } from './rendering/transition/overlay-frame-store';

const CanvasDebugPanel = lazy(() => import('./CanvasDebugPanel'));

export interface DiagramCanvasProps {
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  onCanvasElementChange?: (element: HTMLDivElement | null) => void;
  defaultViewport?: { x: number; y: number; zoom: number };
  hidden?: boolean;
  nodeVisualMode: NodeVisualMode;
  nodes: CanvasNode[];
  interactionBindings?: CanvasInteractionBindings;
  selectedEntityId?: string;
  selectedEdgeId?: string;
  overlayEdges: CanvasOverlayEdgeView[];
  edgeGeometrySnapshot?: CanvasRenderSnapshot;
  overlayInteractionBindings?: EdgeOverlayInteractionBindings;
  transitionFrame?: TransitionFrameState;
  overlayFrameStore?: OverlayFrameStore;
  nodeTypes: CanvasNodeTypes;
  onNodeClick: (_event: unknown, node: CanvasNode) => void;
  onNodeContextMenu?: (event: React.MouseEvent, node: CanvasNode) => void;
  onInit: (instance: CanvasCamera) => void;
  onUnmount?: () => void;
  onPaneClick: (force?: boolean) => void;
  onMove: CanvasMoveHandler;
  onMoveEnd: CanvasMoveHandler;
  minZoom: number;
  maxZoom: number;
  showDebug: boolean;
  debugInputs?: CanvasDebugInputs;
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
  nodeVisualMode,
  nodes,
  interactionBindings,
  selectedEntityId,
  selectedEdgeId,
  overlayEdges,
  edgeGeometrySnapshot,
  overlayInteractionBindings,
  transitionFrame,
  overlayFrameStore,
  nodeTypes,
  onNodeClick,
  onNodeContextMenu,
  onInit,
  onUnmount,
  onPaneClick,
  onMove,
  onMoveEnd,
  minZoom,
  maxZoom,
  showDebug,
  debugInputs,
  onSelectFocusShell,
  focusShells,
}: DiagramCanvasProps) {
  const worldRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const unmountEffectGenerationRef = useRef(0);
  const callbacks = useRef({ onMove, onMoveEnd, onInit });
  callbacks.current = { onMove, onMoveEnd, onInit };
  const initialViewport = useRef(defaultViewport);
  const handleCanvasElementRef = useCallback(
    (element: HTMLDivElement | null) => {
      canvasRef.current = element;
      onCanvasElementChange?.(element);
    },
    [canvasRef, onCanvasElementChange],
  );
  useLayoutEffect(() => {
    const element = canvasRef.current,
      world = worldRef.current,
      grid = gridRef.current;
    if (!element || !world || !grid) return;
    const mounted = mountCanvasCamera({
      element,
      world,
      grid,
      defaultViewport: initialViewport.current,
      minZoom,
      maxZoom,
      onMove: (event, viewport) => callbacks.current.onMove(event, viewport),
      onMoveEnd: (event, viewport) => callbacks.current.onMoveEnd(event, viewport),
    });
    callbacks.current.onInit(mounted.camera);
    return mounted.destroy;
  }, [canvasRef, minZoom, maxZoom]);
  useEffect(() => {
    const effectGeneration = ++unmountEffectGenerationRef.current;
    return () =>
      scheduleHotReloadSafeUnmount({
        onUnmount,
        effectGeneration,
        getCurrentEffectGeneration: () => unmountEffectGenerationRef.current,
      });
  }, [onUnmount]);
  const renderedNodesRef = useRef(nodes);
  const nodeAt = (target: EventTarget | null) => {
    const element =
      target instanceof Element ? target.closest<HTMLElement>('[data-entity-id]') : null;
    return renderedNodesRef.current.find((node) => node.id === element?.dataset.entityId);
  };
  return (
    <div
      role="tree"
      aria-label="Diagram"
      ref={handleCanvasElementRef}
      className={`canvas canvas-host h-full w-full canvas-visual-${nodeVisualMode}${hidden ? ' invisible' : ''}`}
      onClick={(event) => {
        const target = event.target as Element;
        const relation = target.closest<HTMLElement>('[data-relation-id]');
        if (relation) {
          if (relation.matches(':disabled')) return;
          const select = relation.matches('button')
            ? overlayInteractionBindings?.onEdgeLabelClick
            : overlayInteractionBindings?.onSelectEdge;
          if (relation.dataset.relationId) select?.(relation.dataset.relationId);
          return;
        }
        const node = nodeAt(target);
        if (node && node.selectable !== false) {
          onNodeClick(event, node);
          return;
        }
        if (!target.closest('button, a, input, .canvas-focus-shell-overlay')) onPaneClick();
      }}
      onContextMenu={(event) => {
        const node = nodeAt(event.target);
        if (node) onNodeContextMenu?.(event, node);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onPaneClick(true);
          return;
        }
        const target = event.target as HTMLElement;
        if (!target.matches('.canvas-node')) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const node = nodeAt(target);
          if (node) onNodeClick(event, node);
          return;
        }
        if (event.key === 'Tab') {
          const elements = [
            ...(worldRef.current?.querySelectorAll<HTMLElement>('.canvas-node.selectable') ?? []),
          ].filter(
            (element) =>
              element.style.display !== 'none' &&
              element.style.pointerEvents !== 'none' &&
              (element.style.opacity === '' || Number(element.style.opacity) > 0.001),
          );
          const next = elements[elements.indexOf(target) + (event.shiftKey ? -1 : 1)];
          if (next) {
            event.preventDefault();
            target.tabIndex = -1;
            next.tabIndex = 0;
            next.focus({ preventScroll: true });
          }
        }
      }}
    >
      <div ref={gridRef} className="canvas-grid" aria-hidden />
      <div ref={worldRef} className="canvas-world">
        <DiagramRenderer
          nodes={nodes}
          bindings={interactionBindings}
          selectedEntityId={selectedEntityId}
          selectedEdgeId={selectedEdgeId}
          nodeRecordsRef={renderedNodesRef}
          geometrySnapshot={edgeGeometrySnapshot}
          edges={overlayEdges}
          nodeTypes={nodeTypes}
          state={transitionFrame}
          frameStore={overlayFrameStore}
        />
      </div>
      <Suspense fallback={null}>
        {showDebug && debugInputs ? <CanvasDebugPanel {...debugInputs} /> : null}
      </Suspense>
      {focusShells && focusShells.length > 0 ? (
        <CanvasFocusShellOverlay shells={focusShells} onSelectShell={onSelectFocusShell} />
      ) : null}
    </div>
  );
}
