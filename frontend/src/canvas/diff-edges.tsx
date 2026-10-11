import type { ReactNode } from 'react';
import { EdgeLabel } from './components/edges/EdgeLabel';
import { useCanvasDiff } from './diff-context';
import type { CanvasOverlayEdgeView } from './rendering/presentation/presentation';
export function DiffEdgeGroup({
  edge,
  children,
}: {
  edge: CanvasOverlayEdgeView;
  children: ReactNode;
}) {
  const diff = useCanvasDiff();
  return (
    <g
      data-diff={diff?.relations.get(edge.relationId)}
      data-render-edge={edge.id}
      style={{ opacity: edge.opacity }}
    >
      {children}
    </g>
  );
}

export function DiffEdgeLabel({ edge }: { edge: CanvasOverlayEdgeView }) {
  const diff = useCanvasDiff();
  return (
    <div data-diff={diff?.relations.get(edge.relationId)} data-render-label={edge.id}>
      <EdgeLabel edge={edge} delegateClicks />
    </div>
  );
}
