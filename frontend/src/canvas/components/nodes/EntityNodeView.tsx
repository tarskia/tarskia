import type { Ref, RefObject } from 'react';
import type { CanvasNodeView } from '../../rendering/presentation/presentation';
import { RichNodeContent } from './RichNodeContent';

interface EntityNodeViewProps {
  id: string;
  view: CanvasNodeView;
  rootRef?: RefObject<HTMLDivElement>;
  bodyRef?: Ref<HTMLDivElement>;
}

export function EntityNodeView({ id, view, rootRef, bodyRef }: EntityNodeViewProps) {
  const richContent = view.content.richContent;
  const listMode = view.content.listMode;
  const showListType = view.content.listShowType !== false;
  const hasLabel = view.content.label.trim().length > 0;
  const primaryTagLabel =
    typeof view.content.primaryTagLabel === 'string' &&
    view.content.primaryTagLabel.trim().length > 0
      ? view.content.primaryTagLabel
      : undefined;
  const primaryTagHue =
    typeof view.content.primaryTagHue === 'number' ? view.content.primaryTagHue : undefined;
  const primaryTagStyle =
    primaryTagHue === undefined
      ? undefined
      : {
          color: `hsla(${primaryTagHue}, var(--tag-pill-s, 88%), var(--tag-pill-l, 80%), 0.95)`,
        };
  const debug = view.content.debug;

  return (
    <div
      ref={rootRef}
      className={`node entity-node${listMode ? ' list-item' : ''}${richContent ? ' has-rich-content' : ''}${view.matched ? ' matched' : ''}`}
      data-node-id={id}
    >
      <div
        ref={bodyRef}
        className={`node-body${richContent ? ' node-body-rich' : ''}`}
        style={{
          transform: `scale(${view.contentScale})`,
          transformOrigin: 'top left',
        }}
      >
        {listMode ? (
          <div className="list-content">
            {showListType && <div className="list-type">{view.content.entityType}</div>}
            {hasLabel && (
              <div className="list-name" title={view.content.label}>
                {view.content.label}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="entity-header">
              <div className="node-header-top">
                <span className="node-subtitle">{view.content.entityType}</span>
                {primaryTagLabel ? (
                  <span className="node-tag-pill" style={primaryTagStyle} title={primaryTagLabel}>
                    {primaryTagLabel}
                  </span>
                ) : null}
              </div>
              {hasLabel ? (
                <span className="node-title" title={view.content.label}>
                  {view.content.label}
                </span>
              ) : null}
            </div>
            {richContent ? (
              <RichNodeContent content={richContent} fallbackAlt={view.content.label} />
            ) : null}
            {view.content.summaryLabel && (
              <div className="node-count">{view.content.summaryLabel}</div>
            )}
          </>
        )}
      </div>
      {debug && (
        <div className="node-debug">
          <div>id: {debug.id}</div>
          <div>parent: {debug.parentId ?? 'root'}</div>
          <div>vis: {debug.visible ? 'yes' : 'no'}</div>
          <div>op: {debug.opacity.toFixed(2)}</div>
          <div>
            pos: {Math.round(debug.absX)},{Math.round(debug.absY)}
          </div>
          <div>transition: {debug.transitioning ? 'yes' : 'no'}</div>
        </div>
      )}
    </div>
  );
}
