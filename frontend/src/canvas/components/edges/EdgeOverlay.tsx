import { useMemo } from 'react';
import type { CanvasNode, CanvasNodeData, CanvasNodeHostControls } from '../../canvas-types';
import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
  CanvasRenderSnapshot,
} from '../../rendering/presentation/presentation';
import { EdgeLabel } from './EdgeLabel';
import { EdgeOverlayView } from './EdgeOverlayView';
import {
  resolveCachedEdgeOverlayRenderState,
  resolveEdgeOverlayRenderState,
} from './edge-overlay-state';

export interface EdgeOverlayInteractionBindings {
  onSelectEdge?: (edgeId: string) => void;
  onEdgeLabelClick?: (edgeId: string) => void;
}

const labelInteractivityEnabled = (edge: CanvasOverlayEdgeView) => edge.opacity > 0.15;

export const resolveEdgeSelectionId = (edge: { relationId?: string; id: string }) =>
  edge.relationId ?? edge.id;

const resolveOverlayNodes = (
  nodes: CanvasNode<CanvasNodeData>[],
): Array<{ view: CanvasNodeView; controls: CanvasNodeHostControls }> =>
  nodes.flatMap((node) => {
    const data = node.data;
    return data?.view && data?.controls ? [{ view: data.view, controls: data.controls }] : [];
  });

export function EdgeOverlay({
  edges,
  nodes,
  geometrySnapshot,
}: {
  geometrySnapshot?: CanvasRenderSnapshot;
  edges: CanvasOverlayEdgeView[];
  nodes: CanvasNode<CanvasNodeData>[];
}) {
  const tx = 0,
    ty = 0,
    zoom = 1;
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
  const transformStyle = { transformOrigin: '0 0' } as const;
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
            <path
              key={`${edge.id}-hit`}
              className="edge-hit-path"
              data-relation-id={resolveEdgeSelectionId(edge)}
              d={edge.path}
              fill="none"
              stroke="transparent"
              strokeWidth={28}
              strokeLinecap="round"
              clipPath={`url(#edge-overlay-clip-${interactionScopeId}-solid-${edge.id.replace(/[^a-zA-Z0-9_-]/g, '_')})`}
              pointerEvents={labelInteractivityEnabled(edge) ? 'stroke' : 'none'}
            />
          ))}
        </svg>
        <div className="edge-overlay-world edge-overlay-world-labels" style={transformStyle}>
          {resolvedEdges.map((edge) =>
            edge.hideLabel ? null : (
              <EdgeLabel key={`${edge.id}-label`} edge={edge} delegateClicks />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
