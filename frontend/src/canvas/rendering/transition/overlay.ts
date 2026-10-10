import { routeCanvasEdges } from '../presentation/edge-routing';
import type { CanvasRect } from '../presentation/geometry';
import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
  CanvasPresentation,
} from '../presentation/presentation';

export interface TransitionFrameNodeTrack {
  id: string;
  kind: CanvasNodeView['kind'];
  fromView?: CanvasNodeView;
  toView?: CanvasNodeView;
  fromRect: CanvasRect;
  toRect: CanvasRect;
  fromOpacity: number;
  toOpacity: number;
}
export interface TransitionFrameEdgeTrack {
  id: string;
  view: CanvasOverlayEdgeView;
  fromLabelOpacity: number;
  fromOpacity: number;
  toOpacity: number;
}
export interface TransitionFrameState {
  id: number;
  startedAt: number;
  duration: number;
  settleDuration: number;
  nodes: TransitionFrameNodeTrack[];
  edges: TransitionFrameEdgeTrack[];
}
export interface TransitionFrameNodeFrame {
  id: string;
  kind: CanvasNodeView['kind'];
  view: CanvasNodeView;
  rect: CanvasRect;
  zIndex?: number;
  opacity: number;
  contentScale: number;
  childOpacity: number;
}
export type TransitionFrameEdgeFrame = CanvasOverlayEdgeView;
export interface AnimationFrame {
  progress: number;
  nodes: TransitionFrameNodeFrame[];
  edges: TransitionFrameEdgeFrame[];
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
export const easeMotion = (value: number) => (1 - Math.cos(Math.PI * clamp(value))) / 2;

// Find the nearest visible ancestor; deeply nested entrants share its origin, without depth timing.
const parentRect = (
  node: CanvasNodeView,
  own: Map<string, CanvasNodeView>,
  other: Map<string, CanvasNodeView>,
) => {
  let id = node.parentId;
  while (id) {
    const ancestor = other.get(id);
    if (ancestor) return ancestor.rect;
    id = own.get(id)?.parentId;
  }
  return node.rect;
};
export function buildTransitionFrameState({
  id,
  startedAt,
  duration,
  settleDuration = 0,
  fromPresentation,
  toPresentation,
}: {
  id: number;
  startedAt: number;
  duration: number;
  settleDuration?: number;
  fromPresentation: CanvasPresentation;
  toPresentation: CanvasPresentation;
}): TransitionFrameState {
  const from = new Map(fromPresentation.nodes.map((node) => [node.id, node]));
  const to = new Map(toPresentation.nodes.map((node) => [node.id, node]));
  const nodes = [...new Set([...from.keys(), ...to.keys()])].map((id) => {
    const fromView = from.get(id);
    const toView = to.get(id);
    const view = (toView ?? fromView)!;
    return {
      id,
      kind: view.kind,
      fromView,
      toView,
      fromRect: fromView?.rect ?? parentRect(view, to, from),
      toRect: toView?.rect ?? parentRect(view, from, to),
      fromOpacity: fromView?.opacity ?? 0,
      toOpacity: toView?.opacity ?? 0,
    };
  });
  const incoming = new Map(toPresentation.overlayEdges.map((edge) => [edge.id, edge]));
  const edges: TransitionFrameEdgeTrack[] = [];
  for (const edge of fromPresentation.overlayEdges) {
    const next = incoming.get(edge.id);
    if (next && next.sourceId === edge.sourceId && next.targetId === edge.targetId) {
      edges.push({
        id: edge.id,
        view: next,
        fromLabelOpacity: edge.labelOpacity ?? 1,
        fromOpacity: edge.opacity,
        toOpacity: next.opacity,
      });
      incoming.delete(edge.id);
    } else {
      // Keep each attachment on its own moving endpoints, even when the relation is retained.
      const id = next ? `${edge.id}::out` : edge.id;
      edges.push({
        id,
        view: { ...edge, id },
        fromLabelOpacity: edge.labelOpacity ?? 1,
        fromOpacity: edge.opacity,
        toOpacity: 0,
      });
    }
  }
  for (const edge of incoming.values())
    edges.push({
      id: edge.id,
      view: edge,
      fromLabelOpacity: 0,
      fromOpacity: 0,
      toOpacity: edge.opacity,
    });
  return { id, startedAt, duration, settleDuration, nodes, edges };
}
export function resolveAnimationFrame(state: TransitionFrameState, now: number): AnimationFrame {
  const elapsed = Math.max(0, now - state.startedAt);
  const structureDuration = Math.max(0, state.duration - state.settleDuration);
  const progress = state.duration <= 0 ? 1 : clamp(elapsed / state.duration);
  const amount = easeMotion(structureDuration <= 0 ? 1 : elapsed / structureDuration);
  const nodes: TransitionFrameNodeFrame[] = state.nodes.flatMap((track) => {
    const context = [track.fromView, track.toView].some(
      (node) => node?.content.externalContext || node?.content.focusBoundary,
    );
    if (context && progress > 0 && progress < 1) return [];
    const view = (
      amount === 0 ? (track.fromView ?? track.toView) : (track.toView ?? track.fromView)
    )!;
    const rect = {
      x: lerp(track.fromRect.x, track.toRect.x, amount),
      y: lerp(track.fromRect.y, track.toRect.y, amount),
      width: lerp(track.fromRect.width, track.toRect.width, amount),
      height: lerp(track.fromRect.height, track.toRect.height, amount),
    };
    const opacity = lerp(track.fromOpacity, track.toOpacity, amount);
    if (opacity <= 0.001 || rect.width <= 0.001 || rect.height <= 0.001) return [];
    return [
      {
        id: track.id,
        kind: track.kind,
        view,
        rect,
        zIndex:
          amount > 0 && amount < 1
            ? Math.max(track.fromView?.zIndex ?? 0, track.toView?.zIndex ?? 0) || undefined
            : view.zIndex,
        opacity,
        contentScale: lerp(
          track.fromView?.contentScale ?? 0.94,
          track.toView?.contentScale ?? 0.94,
          amount,
        ),
        childOpacity: lerp(
          track.fromView?.content.childOpacity ?? 1,
          track.toView?.content.childOpacity ?? 1,
          amount,
        ),
      },
    ];
  });
  const visible = new Set(nodes.map((node) => node.id));
  const labelProgress =
    state.settleDuration <= 0 ? 1 : clamp((elapsed - structureDuration) / state.settleDuration);
  const edges = state.edges.flatMap((track) => {
    const opacity = lerp(track.fromOpacity, track.toOpacity, amount);
    return opacity > 0.001 && visible.has(track.view.sourceId) && visible.has(track.view.targetId)
      ? [
          {
            ...track.view,
            opacity,
            labelOpacity:
              state.settleDuration <= 0
                ? (track.view.labelOpacity ?? 1)
                : lerp(track.fromLabelOpacity, 0, amount) +
                  labelProgress * (track.view.labelOpacity ?? 1),
          },
        ]
      : [];
  });
  return {
    progress,
    nodes,
    edges: routeCanvasEdges(
      nodes.map((node) => ({ ...node.view, rect: node.rect })),
      edges,
    ),
  };
}
export const captureTransitionFrameSnapshot = ({
  frame,
}: {
  state: TransitionFrameState;
  frame: AnimationFrame;
}): CanvasPresentation => ({
  nodes: frame.nodes.map((node) => ({
    ...node.view,
    rect: node.rect,
    zIndex: node.zIndex,
    opacity: node.opacity,
    contentScale: node.contentScale,
    content: { ...node.view.content, childOpacity: node.childOpacity },
  })),
  overlayEdges: frame.edges.map((edge) => ({ ...edge, path: edge.geometry.path })),
});
export const buildStaticTransitionFrameState = ({
  snapshot,
  id,
  startedAt,
}: {
  snapshot: CanvasPresentation;
  id: number;
  startedAt: number;
}) =>
  buildTransitionFrameState({
    id,
    startedAt,
    duration: 0,
    fromPresentation: snapshot,
    toPresentation: snapshot,
  });
