import { useMemo } from 'react';
import type { Node } from 'reactflow';
import { useStore } from 'reactflow';
import type { CanvasNodeHostControls, ReactFlowHostNodeData } from '../../host/reactflow/types';
import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
  CanvasRenderSnapshot,
} from '../../rendering/presentation/presentation';
import { EdgeOverlayView } from './EdgeOverlayView';
import { resolveEdgeLabelTransform } from './edge-label-placement';
import {
  resolveCachedEdgeOverlayRenderState,
  resolveEdgeOverlayRenderState,
} from './edge-overlay-state';

export interface EdgeOverlayInteractionBindings {
  onSelectEdge?: (edgeId: string) => void;
  onEdgeLabelClick?: (edgeId: string) => void;
}

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
  geometrySnapshot,
}: {
  geometrySnapshot?: CanvasRenderSnapshot;
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
      geometrySnapshot
        ? resolveCachedEdgeOverlayRenderState(geometrySnapshot, edges)
        : resolveEdgeOverlayRenderState({
            edges,
            nodes: nodeViews,
          }),
    [edges, nodeViews, geometrySnapshot],
  );
  const resolvedEdges = overlayRenderState.edges;
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
                <path d={edge.solidClipPath} clipRule="nonzero" />
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
      </div>
    </div>
  );
}
