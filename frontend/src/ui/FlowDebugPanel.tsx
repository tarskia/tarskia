export type DebugSummary = {
  total: number;
  layout: number;
  visible: number;
  rendered: number;
  overlayEdges: number;
  transitionActive: boolean;
  missingLayout: string[];
  missingVisible: string[];
  missingRendered: string[];
  topLevelPositions: string[];
  topBounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  viewRect: { minX: number; minY: number; maxX: number; maxY: number } | null;
  overflowParents: string[];
  selectedEdgeTrace: {
    id: string;
    relationId: string;
    kind: 'routed' | 'local';
    sourceId: string;
    targetId: string;
    scopeId?: string;
    opacity: number;
    sourceSide: 'left' | 'right' | 'top' | 'bottom';
    targetSide: 'left' | 'right' | 'top' | 'bottom';
    sourcePoint: string;
    targetPoint: string;
    solidOverNodeIds: string[];
    shellOccluderCount: number;
    contentOccluderCount: number;
    blockerOccluderCount: number;
    blockerOccluders: string[];
    passes: {
      solid: boolean;
      blocked: boolean;
    };
  } | null;
};

export function FlowDebugPanel({ show, summary }: { show: boolean; summary: DebugSummary | null }) {
  if (!show || !summary) return null;
  return (
    <div className="debug-panel">
      <div>Entities: {summary.total}</div>
      <div>Layout nodes: {summary.layout}</div>
      <div>Visible ids: {summary.visible}</div>
      <div>Rendered nodes: {summary.rendered}</div>
      <div>Overlay edges: {summary.overlayEdges}</div>
      <div>Transition active: {summary.transitionActive ? 'yes' : 'no'}</div>
      <div>
        Missing (layout): {summary.missingLayout.length ? summary.missingLayout.join(', ') : 'none'}
      </div>
      <div>
        Missing (visible):{' '}
        {summary.missingVisible.length ? summary.missingVisible.join(', ') : 'none'}
      </div>
      <div>
        Missing (rendered):{' '}
        {summary.missingRendered.length ? summary.missingRendered.join(', ') : 'none'}
      </div>
      <div>
        Top-level: {summary.topLevelPositions.length ? summary.topLevelPositions.join(' ') : 'none'}
      </div>
      {summary.topBounds && (
        <div>
          Top bounds: {Math.round(summary.topBounds.minX)}, {Math.round(summary.topBounds.minY)} →{' '}
          {Math.round(summary.topBounds.maxX)}, {Math.round(summary.topBounds.maxY)}
        </div>
      )}
      {summary.viewRect && (
        <div>
          View: {Math.round(summary.viewRect.minX)}, {Math.round(summary.viewRect.minY)} →{' '}
          {Math.round(summary.viewRect.maxX)}, {Math.round(summary.viewRect.maxY)}
        </div>
      )}
      <div>
        Overflow parents:{' '}
        {summary.overflowParents.length ? summary.overflowParents.join(' ') : 'none'}
      </div>
      {summary.selectedEdgeTrace && (
        <>
          <div>
            Edge trace: {summary.selectedEdgeTrace.relationId} ({summary.selectedEdgeTrace.kind})
          </div>
          <div>
            Edge route: {summary.selectedEdgeTrace.sourceId} → {summary.selectedEdgeTrace.targetId}
          </div>
          {summary.selectedEdgeTrace.scopeId && (
            <div>Edge scope: {summary.selectedEdgeTrace.scopeId}</div>
          )}
          <div>
            Edge anchors: {summary.selectedEdgeTrace.sourceSide}{' '}
            {summary.selectedEdgeTrace.sourcePoint} → {summary.selectedEdgeTrace.targetSide}{' '}
            {summary.selectedEdgeTrace.targetPoint}
          </div>
          <div>Edge opacity: {summary.selectedEdgeTrace.opacity.toFixed(2)}</div>
          <div>
            Edge solid-over ids:{' '}
            {summary.selectedEdgeTrace.solidOverNodeIds.length
              ? summary.selectedEdgeTrace.solidOverNodeIds.join(', ')
              : 'none'}
          </div>
          <div>
            Edge passes: solid {summary.selectedEdgeTrace.passes.solid ? 'on' : 'off'} / blocked{' '}
            {summary.selectedEdgeTrace.passes.blocked ? 'on' : 'off'}
          </div>
          <div>
            Edge occluders: shell {summary.selectedEdgeTrace.shellOccluderCount} / content{' '}
            {summary.selectedEdgeTrace.contentOccluderCount} / blocker{' '}
            {summary.selectedEdgeTrace.blockerOccluderCount}
          </div>
          {summary.selectedEdgeTrace.blockerOccluders.length > 0 && (
            <div>Blocker rects: {summary.selectedEdgeTrace.blockerOccluders.join(' | ')}</div>
          )}
        </>
      )}
    </div>
  );
}
