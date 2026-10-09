import { useMemo } from 'react';
import type { Node } from 'reactflow';
import { useStore } from 'reactflow';
import type { CanvasNodeHostControls, ReactFlowHostNodeData } from '../../host/reactflow/types';
import type { CanvasPoint, CanvasRect } from '../../rendering/presentation/geometry';
import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
} from '../../rendering/presentation/presentation';
import { EdgeOverlayView } from './EdgeOverlayView';
import { resolveEdgeLabelTransform } from './edge-label-placement';
import { resolveEdgeOverlayRenderState } from './edge-overlay-state';
import { buildClipPathFromOccluders } from './occluder-geometry';

export interface EdgeOverlayInteractionBindings {
  onSelectEdge?: (edgeId: string) => void;
  onEdgeLabelClick?: (edgeId: string) => void;
}

export interface EdgeOverlayHandleDescriptor {
  nodeId: string;
  role: 'source' | 'target';
  point: CanvasPoint;
  highlighted: boolean;
}

const HANDLE_CENTER_OFFSET_PX = 3;

const resolveSourceHandlePoint = (rect: CanvasRect): CanvasPoint => ({
  x: rect.x + rect.width,
  y: rect.y + rect.height / 2,
});

const resolveTargetHandlePoint = (rect: CanvasRect): CanvasPoint => ({
  x: rect.x,
  y: rect.y + rect.height / 2,
});

const labelInteractivityEnabled = (edge: CanvasOverlayEdgeView) => edge.opacity > 0.15;

const resolveEdgeLabelClassName = (edge: CanvasOverlayEdgeView) => {
  const matchedClass = edge.matched ? ' edge-label-matched' : '';
  if (edge.state === 'none') {
    return `edge-label edge-label-dot${matchedClass}`;
  }
  if (edge.label) {
    return `edge-label edge-label-text${matchedClass}`;
  }
  return `edge-label edge-label-text edge-label-empty${matchedClass}`;
};

const resolveEdgeLabelText = (edge: CanvasOverlayEdgeView) => {
  if (edge.state === 'none') {
    return '';
  }
  return edge.label || 'set';
};

export const resolveEdgeSelectionId = (edge: { relationId?: string; id: string }) =>
  edge.relationId ?? edge.id;

export const buildOverlayHandleDescriptors = (
  nodes: Node<ReactFlowHostNodeData>[],
): EdgeOverlayHandleDescriptor[] =>
  nodes.flatMap((node) => {
    const data = node.data;
    const view = data?.view;
    const controls = data?.controls;
    if (!view || !controls) {
      return [];
    }
    if (view.content.focusShell || controls.showConnectionHandles === false) {
      return [];
    }
    return [
      {
        nodeId: view.id,
        role: 'source' as const,
        point: resolveSourceHandlePoint(view.rect),
        highlighted: controls.highlightSourceHandle,
      },
      {
        nodeId: view.id,
        role: 'target' as const,
        point: resolveTargetHandlePoint(view.rect),
        highlighted: controls.highlightTargetHandle,
      },
    ];
  });

const resolveOverlayNodes = (
  nodes: Node<ReactFlowHostNodeData>[],
): Array<{ view: CanvasNodeView; controls: CanvasNodeHostControls }> =>
  nodes.flatMap((node) => {
    const data = node.data;
    return data?.view && data?.controls ? [{ view: data.view, controls: data.controls }] : [];
  });

export function EdgeOverlay({
  edges,
  nodes,
  bindings,
}: {
  edges: CanvasOverlayEdgeView[];
  nodes: Node<ReactFlowHostNodeData>[];
  bindings?: EdgeOverlayInteractionBindings;
}) {
  const transform = useStore((state) => state.transform);
  const [tx, ty, zoom] = transform;
  const overlayNodes = useMemo(() => resolveOverlayNodes(nodes), [nodes]);
  const nodeViews = useMemo(() => overlayNodes.map((node) => node.view), [overlayNodes]);
  const overlayRenderState = useMemo(
    () =>
      resolveEdgeOverlayRenderState({
        edges,
        nodes: nodeViews,
      }),
    [edges, nodeViews],
  );
  const resolvedEdges = overlayRenderState.edges;
  const handleDescriptors = useMemo(() => buildOverlayHandleDescriptors(nodes), [nodes]);
  const transformStyle = useMemo(
    () =>
      ({
        transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }) as const,
    [tx, ty, zoom],
  );
  const interactionScopeId = 'edge-overlay-interaction'.replace(/[^a-zA-Z0-9_-]/g, '_');

  return (
    <div className="edge-overlay edge-overlay--host">
      <EdgeOverlayView
        edges={edges}
        nodes={nodeViews}
        transform={{ tx, ty, zoom }}
        className="edge-overlay edge-overlay-visual"
        renderState={overlayRenderState}
      />
      <div className="edge-overlay-interaction">
        <svg
          className="edge-overlay-svg edge-overlay-svg-interaction"
          style={transformStyle}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            {resolvedEdges.map((edge) => (
              <clipPath
                key={`clip-hit-solid-${edge.id}`}
                id={`edge-overlay-clip-${interactionScopeId}-solid-${edge.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                clipPathUnits="userSpaceOnUse"
              >
                <path
                  d={buildClipPathFromOccluders({
                    include: [overlayRenderState.overlayWorldBounds],
                    exclude: edge.blockerOccluders,
                  })}
                  clipRule="nonzero"
                />
              </clipPath>
            ))}
          </defs>
          {resolvedEdges.map((edge) => (
            /* biome-ignore lint/a11y/noStaticElementInteractions: SVG hit paths intentionally provide pointer-only edge selection without blocking the pane. */
            <path
              key={`${edge.id}-hit`}
              className="edge-hit-path"
              d={edge.path}
              fill="none"
              stroke="transparent"
              strokeWidth={28}
              strokeLinecap="round"
              clipPath={`url(#edge-overlay-clip-${interactionScopeId}-solid-${edge.id.replace(/[^a-zA-Z0-9_-]/g, '_')})`}
              pointerEvents={labelInteractivityEnabled(edge) ? 'stroke' : 'none'}
              onClick={(event) => {
                event.stopPropagation();
                bindings?.onSelectEdge?.(resolveEdgeSelectionId(edge));
              }}
            />
          ))}
        </svg>
        <div className="edge-overlay-world edge-overlay-world-labels" style={transformStyle}>
          {resolvedEdges.map((edge) =>
            edge.hideLabel ? null : (
              <button
                key={`${edge.id}-label`}
                type="button"
                className={resolveEdgeLabelClassName(edge)}
                style={{
                  transform: resolveEdgeLabelTransform(edge),
                  opacity: edge.opacity,
                  pointerEvents: labelInteractivityEnabled(edge) ? 'all' : 'none',
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!labelInteractivityEnabled(edge)) {
                    return;
                  }
                  bindings?.onEdgeLabelClick?.(resolveEdgeSelectionId(edge));
                }}
              >
                {resolveEdgeLabelText(edge)}
              </button>
            ),
          )}
        </div>
        <div className="edge-overlay-world edge-overlay-world-handles" style={transformStyle}>
          {handleDescriptors.map((handle) => {
            return (
              <div
                key={`${handle.nodeId}-${handle.role}`}
                className={`edge-handle-button edge-handle-button-${handle.role}${handle.highlighted ? ' edge-handle-button-highlighted' : ''}`}
                data-node-id={handle.nodeId}
                data-edge-handle-role={handle.role}
                style={{
                  transform: `translate(${handle.point.x - HANDLE_CENTER_OFFSET_PX}px, ${handle.point.y - HANDLE_CENTER_OFFSET_PX}px)`,
                  pointerEvents: 'none',
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
