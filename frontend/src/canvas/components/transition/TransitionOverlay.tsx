import type { CSSProperties } from 'react';
import { useMemo, useSyncExternalStore } from 'react';
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
import type { OverlayFrameStore } from '../../rendering/transition/overlay-frame-store';
import { EdgeLabel } from '../edges/EdgeLabel';
import { EntityNodeView } from '../nodes/EntityNodeView';
import { GroupNodeView } from '../nodes/GroupNodeView';

const overlayNodeControls: CanvasNodeHostControls = {
  selected: false,
  disableControlActions: true,
  hideLocalEdgeLabels: false,
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

const subscribeToNoFrames = () => () => {};
const getNoFrame = () => null;

export function TransitionOverlay({
  state,
  frame: suppliedFrame,
  frameStore,
  nodeVisualMode,
}: {
  state: TransitionOverlayState;
  frame?: TransitionOverlayFrame;
  frameStore?: OverlayFrameStore;
  nodeVisualMode: NodeVisualMode;
}) {
  const storedFrame = useSyncExternalStore<TransitionOverlayFrame | null>(
    frameStore?.subscribe ?? subscribeToNoFrames,
    frameStore?.getSnapshot ?? getNoFrame,
    frameStore?.getSnapshot ?? getNoFrame,
  );
  const frameOverride = storedFrame ?? suppliedFrame;
  const transform = useStore((store) => store.transform);
  const [tx, ty, zoom] = transform;
  const frame = useMemo(
    () => frameOverride ?? resolveTransitionOverlayFrame(state, state.startedAt),
    [frameOverride, state],
  );

  const edgeById = useMemo(
    () => new Map(frame.edges.map((edge) => [edge.id, edge])),
    [frame.edges],
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
            return (
              <path
                key={edgeTrack.id}
                className="transition-overlay-edge-path"
                d={edge.geometry.path}
                fill="none"
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
        <div className="transition-overlay-label-layer">
          {frame.edges
            .filter((edge) => edge.kind === 'routed')
            .map((edge) => {
              const labelOpacity = resolveTransitionLabelOpacity({
                progress: frame.progress,
                baseOpacity: edge.opacity,
                staticOverlay,
              });
              if (labelOpacity <= VISIBILITY_EPSILON) {
                return null;
              }
              return (
                <EdgeLabel
                  key={`${edge.id}:label`}
                  edge={{ ...edge, opacity: labelOpacity }}
                  interactive={false}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}
