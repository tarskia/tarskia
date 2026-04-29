import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'reactflow';
import type { NodeVisualMode } from '../../../node-visual-mode';
import type { CanvasNodeHostControls } from '../../host/reactflow/types';
import type { CanvasNodeView } from '../../rendering/presentation/presentation';
import {
  overlayNodeBindings,
  resolveTransitionOverlayFrame,
  type TransitionOverlayFrame,
  type TransitionOverlayState,
} from '../../rendering/transition/overlay';
import { EdgeOverlayView } from '../edges/EdgeOverlayView';
import { resolveEdgeLabelTransform } from '../edges/edge-label-placement';
import { EntityNodeView } from '../nodes/EntityNodeView';
import { GroupNodeView } from '../nodes/GroupNodeView';

const overlayNodeControls: CanvasNodeHostControls = {
  selected: false,
  disableControlActions: true,
  hideLocalEdgeLabels: false,
  highlightSourceHandle: false,
  highlightTargetHandle: false,
};

const VISIBILITY_EPSILON = 0.001;
const TRANSITION_LABEL_FADE_START = 0.88;

const resolveTransitionLabelOpacity = (params: {
  progress: number;
  baseOpacity: number;
  staticOverlay: boolean;
}) => {
  const { progress, baseOpacity, staticOverlay } = params;
  if (staticOverlay) {
    return baseOpacity;
  }
  if (progress <= TRANSITION_LABEL_FADE_START) {
    return 0;
  }
  const span = Math.max(1 - TRANSITION_LABEL_FADE_START, Number.EPSILON);
  const fadeProgress = Math.min(1, Math.max(0, (progress - TRANSITION_LABEL_FADE_START) / span));
  return baseOpacity * fadeProgress;
};

const buildNodeShellStyle = (params: {
  rect: { x: number; y: number; width: number; height: number };
  opacity: number;
  view: CanvasNodeView;
  zIndex?: number;
}) => {
  const { rect, opacity, view, zIndex } = params;
  const baseStyle: CSSProperties = {
    position: 'absolute',
    transform: `translate(${rect.x}px, ${rect.y}px)`,
    width: rect.width,
    height: rect.height,
    zIndex: zIndex ?? view.zIndex,
    opacity,
    display: opacity > VISIBILITY_EPSILON && rect.width > 0 && rect.height > 0 ? 'block' : 'none',
    pointerEvents: 'none',
    ['--node-selection-ring' as string]: view.style.selectionRing,
    ['--node-selection-glow' as string]: view.style.selectionGlow,
    ['--node-selection-fill' as string]: view.style.selectionFill,
  };
  if (view.style.transparentChrome) {
    return {
      ...baseStyle,
      ['--node-bg' as string]: 'transparent',
      ['--node-border' as string]: '1px solid transparent',
      boxShadow: 'none',
    } satisfies CSSProperties;
  }
  return {
    ...baseStyle,
    ['--node-bg' as string]: view.style.background,
    ['--node-border' as string]: view.style.border,
    color: view.style.color,
  } satisfies CSSProperties;
};

export function TransitionOverlay({
  state,
  frame: frameOverride,
  nodeVisualMode,
}: {
  state: TransitionOverlayState;
  frame?: TransitionOverlayFrame;
  nodeVisualMode: NodeVisualMode;
}) {
  const transform = useStore((store) => store.transform);
  const [tx, ty, zoom] = transform;
  const [frameNow, setFrameNow] = useState(() =>
    typeof performance === 'undefined' ? state.startedAt : performance.now(),
  );

  useEffect(() => {
    if (frameOverride) {
      return;
    }
    setFrameNow(typeof performance === 'undefined' ? state.startedAt : performance.now());
  }, [frameOverride, state.startedAt]);

  const frame = useMemo(
    () => frameOverride ?? resolveTransitionOverlayFrame(state, frameNow),
    [frameNow, frameOverride, state],
  );

  useEffect(() => {
    if (frameOverride || frame.progress >= 1) {
      return;
    }
    let cancelled = false;
    const rafId = requestAnimationFrame((now) => {
      if (!cancelled) {
        setFrameNow(now);
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [frame.progress, frameOverride]);

  const edgeById = useMemo(
    () => new Map(frame.edges.map((edge) => [edge.id, edge])),
    [frame.edges],
  );
  const overlayNodes = useMemo(
    () =>
      frame.nodes.map((node) => ({
        ...node.view,
        rect: node.rect,
        zIndex: node.zIndex ?? node.view.zIndex,
        opacity: node.opacity,
        contentScale: node.contentScale,
        content: {
          ...node.view.content,
          childOpacity: node.childOpacity,
        },
      })),
    [frame.nodes],
  );
  const worldStyle = {
    transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
    transformOrigin: '0 0',
  } as const;
  const staticOverlay = state.duration <= 1;

  return (
    <div className={`transition-overlay transition-overlay-visual-${nodeVisualMode}`} aria-hidden>
      <div className="transition-overlay-world" style={worldStyle}>
        <svg
          className="transition-overlay-svg transition-overlay-svg-base"
          aria-hidden="true"
          focusable="false"
        >
          {state.edges.map((edgeTrack) => {
            const edge = edgeById.get(edgeTrack.id);
            if (!edge || edge.opacity <= VISIBILITY_EPSILON) {
              return null;
            }
            if (edge.kind === 'local') {
              const labelOpacity =
                edgeTrack.labelTrack?.label !== undefined
                  ? resolveTransitionLabelOpacity({
                      progress: frame.progress,
                      baseOpacity: edge.opacity,
                      staticOverlay,
                    })
                  : 0;
              return (
                <g
                  key={edgeTrack.id}
                  className="group-edge"
                  style={{
                    opacity: edge.opacity,
                  }}
                >
                  <path className="group-edge-path" d={edge.geometry.path} />
                  {edgeTrack.labelTrack?.label && labelOpacity > VISIBILITY_EPSILON ? (
                    <text
                      className="group-edge-label"
                      x={edge.labelAnchor.x}
                      y={edge.labelAnchor.y}
                      opacity={labelOpacity}
                    >
                      {edgeTrack.labelTrack.label}
                    </text>
                  ) : null}
                </g>
              );
            }
            return (
              <path
                key={edgeTrack.id}
                className="transition-overlay-edge-path"
                d={edge.geometry.path}
                style={{
                  opacity: edge.opacity,
                }}
              />
            );
          })}
        </svg>
        <div className="transition-overlay-node-layer">
          {frame.nodes.map((node) => {
            const overlayView: CanvasNodeView = {
              ...node.view,
              rect: node.rect,
              zIndex: node.zIndex ?? node.view.zIndex,
              opacity: node.opacity,
              contentScale: node.contentScale,
              content: {
                ...node.view.content,
                childOpacity: node.childOpacity,
              },
            };
            return (
              <div
                key={node.id}
                className="transition-overlay-node-shell"
                style={buildNodeShellStyle({
                  rect: node.rect,
                  opacity: node.opacity,
                  zIndex: node.zIndex,
                  view: overlayView,
                })}
              >
                {node.kind === 'group' ? (
                  <GroupNodeView
                    id={node.id}
                    view={overlayView}
                    bindings={overlayNodeBindings}
                    controls={overlayNodeControls}
                  />
                ) : (
                  <EntityNodeView id={node.id} view={overlayView} />
                )}
              </div>
            );
          })}
        </div>
        <EdgeOverlayView
          edges={frame.overlayEdges}
          nodes={overlayNodes}
          transform={{ tx: 0, ty: 0, zoom: 1 }}
          className="edge-overlay edge-overlay--transition"
        />
        <div className="transition-overlay-label-layer">
          {frame.edges
            .filter((edge) => edge.kind === 'routed')
            .map((edge) => {
              const labelText = edge.state === 'none' ? '' : (edge.label ?? 'set');
              const labelOpacity = resolveTransitionLabelOpacity({
                progress: frame.progress,
                baseOpacity: edge.opacity,
                staticOverlay,
              });
              if (labelOpacity <= VISIBILITY_EPSILON) {
                return null;
              }
              return (
                <div
                  key={`${edge.id}:label`}
                  className={
                    edge.state === 'none'
                      ? 'edge-label edge-label-dot'
                      : labelText
                        ? 'edge-label edge-label-text'
                        : 'edge-label edge-label-text edge-label-empty'
                  }
                  style={{
                    transform: resolveEdgeLabelTransform(edge),
                    opacity: labelOpacity,
                    display: labelOpacity > VISIBILITY_EPSILON ? undefined : 'none',
                    pointerEvents: 'none',
                  }}
                >
                  {edge.state === 'none' ? '' : labelText}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
