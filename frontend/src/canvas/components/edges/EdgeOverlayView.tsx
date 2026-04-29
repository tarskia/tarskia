import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
} from '../../rendering/presentation/presentation';
import { type EdgeOverlayRenderState, resolveEdgeOverlayRenderState } from './edge-overlay-state';
import { buildClipPathFromOccluders } from './occluder-geometry';

export interface EdgeOverlayTransform {
  tx: number;
  ty: number;
  zoom: number;
}

export function EdgeOverlayView({
  edges,
  nodes,
  transform,
  className,
  renderState,
}: {
  edges: CanvasOverlayEdgeView[];
  nodes: CanvasNodeView[];
  transform: EdgeOverlayTransform;
  className?: string;
  renderState?: EdgeOverlayRenderState;
}) {
  if (edges.length === 0) return null;

  const overlayScopeId = (className ?? 'edge-overlay').replace(/[^a-zA-Z0-9_-]/g, '_');
  const { overlayWorldBounds, edges: edgesWithResolvedOccluders } =
    renderState ?? resolveEdgeOverlayRenderState({ edges, nodes });

  const transformStyle = {
    transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.zoom})`,
    transformOrigin: '0 0',
  } as const;

  const buildClipId = (kind: 'solid' | 'blocked', edgeId?: string) =>
    `edge-overlay-clip-${overlayScopeId}-${kind}${edgeId ? `-${edgeId.replace(/[^a-zA-Z0-9_-]/g, '_')}` : ''}`;

  return (
    <div className={className ?? 'edge-overlay'} aria-hidden>
      <svg className="edge-overlay-svg" style={transformStyle} aria-hidden="true" focusable="false">
        <defs>
          {edgesWithResolvedOccluders.map((edge) =>
            edge.blockerOccluders.length > 0 ? (
              [
                <clipPath
                  key={`clip-solid-${edge.id}`}
                  id={buildClipId('solid', edge.id)}
                  clipPathUnits="userSpaceOnUse"
                >
                  <path
                    d={buildClipPathFromOccluders({
                      include: [overlayWorldBounds],
                      exclude: edge.blockerOccluders,
                    })}
                    clipRule="nonzero"
                  />
                </clipPath>,
                <clipPath
                  key={`clip-blocked-${edge.id}`}
                  id={buildClipId('blocked', edge.id)}
                  clipPathUnits="userSpaceOnUse"
                >
                  <path
                    d={buildClipPathFromOccluders({
                      include: edge.blockerOccluders,
                    })}
                    clipRule="nonzero"
                  />
                </clipPath>,
              ]
            ) : (
              <clipPath
                key={`clip-solid-${edge.id}`}
                id={buildClipId('solid', edge.id)}
                clipPathUnits="userSpaceOnUse"
              >
                <path
                  d={buildClipPathFromOccluders({
                    include: [overlayWorldBounds],
                  })}
                  clipRule="nonzero"
                />
              </clipPath>
            ),
          )}
        </defs>
        {edgesWithResolvedOccluders.map((edge) => {
          const solidClipId = buildClipId('solid', edge.id);
          const blockedClipId =
            edge.blockerOccluders.length > 0 ? buildClipId('blocked', edge.id) : undefined;
          return (
            <g key={`${edge.id}-overlay`} style={{ opacity: edge.opacity }}>
              <path
                className={`edge-underlay-path${edge.selected ? ' edge-underlay-path-selected' : ''}${edge.matched ? ' edge-underlay-path-matched' : ''}`}
                d={edge.path}
                clipPath={`url(#${solidClipId})`}
              />
              {blockedClipId ? (
                <path
                  className={`edge-overlay-path${edge.selected ? ' edge-overlay-path-selected' : ''}${edge.matched ? ' edge-overlay-path-matched' : ''}`}
                  d={edge.path}
                  clipPath={`url(#${blockedClipId})`}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
