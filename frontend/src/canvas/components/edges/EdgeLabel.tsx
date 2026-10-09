import type { CSSProperties } from 'react';
import type { CanvasOverlayEdgeView } from '../../rendering/presentation/presentation';
import { resolveEdgeLabelTransform } from './edge-label-placement';

type LabelEdge = Pick<
  CanvasOverlayEdgeView,
  | 'id'
  | 'relationId'
  | 'directionalLabels'
  | 'label'
  | 'state'
  | 'matched'
  | 'geometry'
  | 'labelAnchor'
  | 'opacity'
>;

/** Both visual directions retain their own keyboard and pointer selection target. */
export function EdgeLabel({
  edge,
  onSelect,
  interactive = true,
}: {
  edge: LabelEdge;
  onSelect?: (relationId: string) => void;
  interactive?: boolean;
}) {
  const directions = edge.directionalLabels;
  const merged = directions?.length === 2;
  const dot = edge.state === 'none' && (!merged || !edge.label);
  const text = dot ? '' : edge.label || 'set';
  const enabled = interactive && edge.opacity > 0.15;
  const className = `edge-label ${dot ? 'edge-label-dot' : 'edge-label-text'}${!dot && !edge.label ? ' edge-label-empty' : ''}${edge.matched ? ' edge-label-matched' : ''}${merged ? ' edge-label-pair' : ''}`;
  const style: CSSProperties = {
    transform: resolveEdgeLabelTransform(edge),
    opacity: edge.opacity,
    pointerEvents: enabled ? 'all' : 'none',
  };
  if (!interactive)
    return (
      <div className={className} style={style}>
        {text}
      </div>
    );
  if (!merged)
    return (
      <button
        type="button"
        className={className}
        data-relation-id={edge.relationId}
        style={style}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (enabled) onSelect?.(edge.relationId);
        }}
      >
        {text}
      </button>
    );
  const distinct = Boolean(
    directions[0].label && directions[1].label && directions[0].label !== directions[1].label,
  );
  return (
    <span className={`${className}${distinct ? '' : ' edge-label-pair-shared'}`} style={style}>
      {!distinct && (
        <span className="edge-label-shared-text" aria-hidden>
          {text}
        </span>
      )}
      {directions.map((direction, index) => (
        <span key={direction.relationId} className="edge-label-part">
          {index > 0 && distinct && (
            <span className="edge-label-separator" aria-hidden>
              {' '}
              /{' '}
            </span>
          )}
          <button
            type="button"
            className="edge-label-direction"
            data-relation-id={direction.relationId}
            aria-label={`${direction.label || 'Relation'}: ${direction.sourceId} → ${direction.targetId}`}
            title={`${direction.label || 'Relation'}: ${direction.sourceId} → ${direction.targetId}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (enabled) onSelect?.(direction.relationId);
            }}
          >
            {distinct ? (
              direction.label
            ) : (
              <span className="sr-only">{direction.label || 'Relation'}</span>
            )}
          </button>
        </span>
      ))}
    </span>
  );
}
