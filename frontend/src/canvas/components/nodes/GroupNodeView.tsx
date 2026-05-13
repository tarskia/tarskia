import type { RefObject } from 'react';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import type { CanvasInteractionBindings, CanvasNodeHostControls } from '../../host/reactflow/types';
import type { CanvasNodeView } from '../../rendering/presentation/presentation';

interface GroupNodeViewProps {
  id: string;
  view: CanvasNodeView;
  bindings: CanvasInteractionBindings;
  controls: CanvasNodeHostControls;
  rootRef?: RefObject<HTMLDivElement>;
}

const stopCanvasGesture = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

const joinClassNames = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(' ');

export function GroupNodeView({ id, view, bindings, controls, rootRef }: GroupNodeViewProps) {
  const canZoomIn = view.controls.canZoomIn;
  const canZoomOut = view.controls.canZoomOut;
  const zoomControlsDisabled = controls.disableControlActions;
  const listMode = view.content.listMode;
  const showListType = view.content.listShowType !== false;
  const focusShell = view.content.focusShell === true;
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
  const typeStyle =
    primaryTagHue === undefined
      ? undefined
      : {
          color: `hsla(${primaryTagHue}, var(--type-label-s, 55%), var(--type-label-l, 72%), var(--type-label-a, 0.9))`,
        };
  const localOpacity =
    typeof view.content.childOpacity === 'number' ? view.content.childOpacity : 1;
  const showChildGroupControls = view.controls.showChildGroupControls && localOpacity >= 0.98;
  const debug = view.content.debug;
  const controlsTargetId = view.controls.targetId || id;

  return (
    <div
      ref={rootRef}
      className={`node group-node${listMode ? ' list-item' : ''}${focusShell ? ' focus-shell' : ''}${view.matched ? ' matched' : ''}`}
      data-node-id={id}
      data-zoomable
    >
      <div className="node-body">
        {listMode ? (
          <div className="list-content">
            {showListType && (
              <div className="list-type" style={typeStyle}>
                {view.content.entityType}
              </div>
            )}
            {hasLabel && (
              <div className="list-name" title={view.content.label}>
                {view.content.label}
              </div>
            )}
          </div>
        ) : focusShell ? null : (
          <>
            <div className="group-header">
              <div className="group-header-top">
                <span className="group-type" style={typeStyle}>
                  {view.content.entityType}
                </span>
                {primaryTagLabel ? (
                  <span className="node-tag-pill" style={primaryTagStyle} title={primaryTagLabel}>
                    {primaryTagLabel}
                  </span>
                ) : null}
              </div>
              {hasLabel ? (
                <span className="group-title" title={view.content.label}>
                  {view.content.label}
                </span>
              ) : null}
            </div>
            {(view.content.summaryLabel ||
              view.controls.showZoomControls ||
              view.controls.showDetailControls ||
              showChildGroupControls) && (
              <div className="group-meta">
                <div className="node-meta-bar nodrag nopan nowheel">
                  {view.controls.showZoomControls && (
                    <button
                      type="button"
                      className={joinClassNames(
                        'node-meta-cell',
                        'node-meta-step',
                        'nodrag',
                        'nopan',
                        'nowheel',
                        !canZoomOut && 'node-meta-cell-hidden',
                      )}
                      disabled={zoomControlsDisabled}
                      onPointerDown={stopCanvasGesture}
                      onMouseDown={stopCanvasGesture}
                      onClick={(event) => {
                        event.stopPropagation();
                        bindings.onZoomTrigger(controlsTargetId, 'out');
                      }}
                      aria-label="Zoom out details"
                      aria-hidden={!canZoomOut}
                    >
                      –
                    </button>
                  )}
                  <span className="node-meta-cell node-meta-text">
                    {view.content.summaryLabel ?? 'Details'}
                  </span>
                  {view.controls.showZoomControls && (
                    <button
                      type="button"
                      className={joinClassNames(
                        'node-meta-cell',
                        'node-meta-step',
                        'nodrag',
                        'nopan',
                        'nowheel',
                        !canZoomIn && 'node-meta-cell-hidden',
                      )}
                      disabled={zoomControlsDisabled}
                      onPointerDown={stopCanvasGesture}
                      onMouseDown={stopCanvasGesture}
                      onClick={(event) => {
                        event.stopPropagation();
                        bindings.onZoomTrigger(controlsTargetId, 'in');
                      }}
                      aria-label="Zoom in details"
                      aria-hidden={!canZoomIn}
                    >
                      +
                    </button>
                  )}
                  {(view.controls.showDetailControls || showChildGroupControls) && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="node-meta-cell node-meta-menu nodrag nopan nowheel"
                          disabled={controls.disableControlActions}
                          onPointerDown={stopCanvasGesture}
                          onMouseDown={stopCanvasGesture}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          aria-label="More expand and collapse actions"
                        >
                          ▾
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="node-meta-menu-panel nodrag nopan nowheel"
                        side="bottom"
                        align="end"
                        sideOffset={4}
                        onPointerDown={stopCanvasGesture}
                        onMouseDown={stopCanvasGesture}
                      >
                        {view.controls.showDetailControls && (
                          <div className="node-meta-menu-section">
                            <PopoverClose asChild>
                              <button
                                type="button"
                                className="node-meta-menu-item"
                                disabled={
                                  !view.controls.canExpandDetails || controls.disableControlActions
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  bindings.onExpandDetails(controlsTargetId);
                                }}
                              >
                                Expand all
                              </button>
                            </PopoverClose>
                            <PopoverClose asChild>
                              <button
                                type="button"
                                className="node-meta-menu-item"
                                disabled={
                                  !view.controls.canCollapseDetails ||
                                  controls.disableControlActions
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  bindings.onCollapseDetails(controlsTargetId);
                                }}
                              >
                                Collapse all
                              </button>
                            </PopoverClose>
                          </div>
                        )}
                        {showChildGroupControls && (
                          <div className="node-meta-menu-section">
                            <PopoverClose asChild>
                              <button
                                type="button"
                                className="node-meta-menu-item"
                                disabled={
                                  !view.controls.canExpandChildGroups ||
                                  controls.disableControlActions
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  bindings.onExpandChildGroups(controlsTargetId);
                                }}
                              >
                                Expand one level
                              </button>
                            </PopoverClose>
                            <PopoverClose asChild>
                              <button
                                type="button"
                                className="node-meta-menu-item"
                                disabled={
                                  !view.controls.canCollapseChildGroups ||
                                  controls.disableControlActions
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  bindings.onCollapseChildGroups(controlsTargetId);
                                }}
                              >
                                Collapse one level
                              </button>
                            </PopoverClose>
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
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
          {typeof debug.childOpacity === 'number' ? (
            <div>child: {debug.childOpacity.toFixed(2)}</div>
          ) : null}
          <div>
            pos: {Math.round(debug.absX)},{Math.round(debug.absY)}
          </div>
          <div>transition: {debug.transitioning ? 'yes' : 'no'}</div>
        </div>
      )}
    </div>
  );
}
