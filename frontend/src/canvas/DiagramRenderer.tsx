import { type MutableRefObject, memo, useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { CanvasInteractionBindings, CanvasNode, CanvasNodeTypes } from './canvas-types';
import { EdgeLabel } from './components/edges/EdgeLabel';
import { resolveEdgeLabelTransform } from './components/edges/edge-label-placement';
import {
  resolveCachedEdgeOverlayRenderState,
  resolveEdgeOverlayRenderState,
} from './components/edges/edge-overlay-state';
import { buildCanvasRenderState } from './node-presentation';
import type {
  CanvasOverlayEdgeView,
  CanvasRenderSnapshot,
} from './rendering/presentation/presentation';
import {
  captureTransitionFrameSnapshot,
  resolveAnimationFrame,
  type TransitionFrameState,
} from './rendering/transition/overlay';
import type { OverlayFrameStore } from './rendering/transition/overlay-frame-store';

/** One keyed DOM tree for both settled and moving geometry. Frames never enter React state. */
export const DiagramRenderer = memo(function DiagramRenderer({
  nodes,
  edges,
  nodeTypes,
  state,
  frameStore,
  bindings,
  selectedEntityId,
  selectedEdgeId,
  nodeRecordsRef,
  geometrySnapshot,
}: {
  geometrySnapshot?: CanvasRenderSnapshot;
  bindings?: CanvasInteractionBindings;
  selectedEntityId?: string;
  selectedEdgeId?: string;
  nodeRecordsRef?: MutableRefObject<CanvasNode[]>;
  nodes: CanvasNode[];
  edges: CanvasOverlayEdgeView[];
  nodeTypes: CanvasNodeTypes;
  state?: TransitionFrameState;
  frameStore?: OverlayFrameStore;
}) {
  const root = useRef<HTMLDivElement>(null);
  const clipScope = useId();
  const records = useMemo(() => {
    if (!state) return { nodes, edges };
    const liveBindings = bindings ?? nodes[0]?.data.bindings;
    if (!liveBindings) return { nodes, edges };
    const nodeViews = state.nodes.flatMap((track) => {
      const view = track.toView ?? track.fromView;
      return view ? [{ ...view, rect: track.fromRect, opacity: track.fromOpacity }] : [];
    });
    // Every track is mounted before the first frame, including fully transparent entrants.
    const first = captureTransitionFrameSnapshot({
      state,
      frame: resolveAnimationFrame(state, state.startedAt),
    });
    const last = captureTransitionFrameSnapshot({
      state,
      frame: resolveAnimationFrame(state, state.startedAt + state.duration),
    });
    const edgeMap = new Map(
      [...first.overlayEdges, ...last.overlayEdges].map((edge) => [edge.id, edge]),
    );
    const render = buildCanvasRenderState({
      presentation: { nodes: nodeViews, overlayEdges: [...edgeMap.values()] },
      bindings: liveBindings,
      selectedEntityId: selectedEntityId ?? nodes.find((node) => node.selected)?.id,
      selectedEdgeId: selectedEdgeId ?? edges.find((edge) => edge.selected)?.relationId,
    });
    return { nodes: render.nodes, edges: render.overlayEdges };
  }, [nodes, edges, state, bindings, selectedEntityId, selectedEdgeId]);
  useLayoutEffect(() => {
    if (nodeRecordsRef) nodeRecordsRef.current = records.nodes;
  }, [nodeRecordsRef, records]);
  const staticSnapshot = useMemo<CanvasRenderSnapshot>(
    () => ({ nodes: records.nodes.map((node) => node.data.view), overlayEdges: records.edges }),
    [records],
  );
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const nodeElements = new Map(
      [...container.querySelectorAll<HTMLElement>('[data-render-node]')].map((element) => [
        element.dataset.renderNode,
        element,
      ]),
    );
    const edgeElements = new Map(
      [...container.querySelectorAll<SVGGElement>('[data-render-edge]')].map((element) => [
        element.dataset.renderEdge,
        element,
      ]),
    );
    const labels = new Map(
      [...container.querySelectorAll<HTMLElement>('[data-render-label]')].map((element) => [
        element.dataset.renderLabel,
        element,
      ]),
    );
    const clips = new Map(
      [...container.querySelectorAll<SVGClipPathElement>('[data-render-clip]')].map((element) => [
        element.dataset.renderClip,
        element,
      ]),
    );
    const apply = () => {
      const frame = frameStore?.getSnapshot();
      const snapshot = state
        ? captureTransitionFrameSnapshot({
            state,
            frame: frame ?? resolveAnimationFrame(state, state.startedAt),
          })
        : staticSnapshot;
      const liveNodes = new Set(snapshot.nodes.map((node) => node.id));
      for (const [id, element] of nodeElements)
        if (!id || !liveNodes.has(id)) element.style.display = 'none';
      for (const node of snapshot.nodes) {
        const element = nodeElements.get(node.id);
        if (!element) continue;
        Object.assign(element.style, {
          transform: `translate(${node.rect.x}px, ${node.rect.y}px)`,
          width: `${node.rect.width}px`,
          height: `${node.rect.height}px`,
          opacity: String(node.opacity),
          display: '',
          zIndex: String(node.zIndex),
          pointerEvents: node.style.focusShell || node.opacity <= 0.001 ? 'none' : 'auto',
        });
        const body = element.querySelector<HTMLElement>('.entity-node > .node-body');
        if (body) body.style.transform = `scale(${node.contentScale})`;
      }
      const resolved = (
        state
          ? resolveEdgeOverlayRenderState({ nodes: snapshot.nodes, edges: snapshot.overlayEdges })
          : resolveCachedEdgeOverlayRenderState(geometrySnapshot ?? staticSnapshot, records.edges)
      ).edges;
      const liveEdges = new Set(resolved.map((edge) => edge.id));
      for (const [id, element] of edgeElements)
        if (!id || !liveEdges.has(id)) element.style.display = 'none';
      for (const [id, element] of labels)
        if (!id || !liveEdges.has(id)) element.style.display = 'none';
      for (const edge of resolved) {
        const element = edgeElements.get(edge.id);
        if (!element) continue;
        element.style.display = '';
        element.style.opacity = String(edge.opacity);
        for (const path of element.querySelectorAll('path')) path.setAttribute('d', edge.path);
        element
          .querySelector('.edge-hit-path')
          ?.setAttribute('pointer-events', edge.opacity > 0.15 ? 'stroke' : 'none');
        const solid = clips.get(`${edge.id}:solid`)?.firstElementChild;
        const blocked = clips.get(`${edge.id}:blocked`)?.firstElementChild;
        solid?.setAttribute('d', edge.solidClipPath);
        blocked?.setAttribute('d', edge.blockedClipPath);
        const label = labels.get(edge.id);
        if (label) {
          label.style.display = '';
          const labelOpacity = edge.opacity * (edge.labelOpacity ?? 1);
          for (const button of label.querySelectorAll('button'))
            button.disabled = labelOpacity <= 0.15;
          const content = label.firstElementChild as HTMLElement | null;
          if (content) {
            content.style.transform = resolveEdgeLabelTransform(edge);
            content.style.opacity = String(labelOpacity);
            content.style.pointerEvents = labelOpacity > 0.15 ? 'all' : 'none';
          }
        }
      }
    };
    apply();
    return frameStore?.subscribe(() => {
      if (!state || frameStore.getSnapshot()) apply();
    });
  }, [state, frameStore, staticSnapshot, geometrySnapshot, records.edges]);
  const clipId = (id: string, kind: string) =>
    `world-${[...`${clipScope}:${id}`].map((char) => char.codePointAt(0)?.toString(16)).join('-')}-${kind}`;
  const first = records.nodes.find((node) => node.selectable !== false)?.id;
  return (
    <div ref={root} className="diagram-renderer">
      <div className="canvas-nodes">
        {records.nodes.map((node) => {
          const Component = nodeTypes[node.type];
          if (!Component) return null;
          return (
            <div
              key={node.id}
              className={`canvas-node${node.selectable !== false ? ' selectable' : ''}${node.selected ? ' selected' : ''}`}
              data-entity-id={node.id}
              data-render-node={node.id}
              role="treeitem"
              aria-label={node.data.view.content.label || node.id}
              aria-selected={Boolean(node.selected)}
              tabIndex={node.selectable === false ? undefined : node.id === first ? 0 : -1}
              style={{
                ...node.style,
                position: 'absolute',
                transform: `translate(${node.position.x}px, ${node.position.y}px)`,
                zIndex: node.zIndex,
              }}
            >
              <Component id={node.id} data={node.data} selected={node.selected} />
            </div>
          );
        })}
      </div>
      <div className="edge-overlay edge-overlay--host">
        <svg className="edge-overlay-svg" aria-hidden="true">
          <defs>
            {records.edges.map((edge) => (
              <g key={edge.id}>
                {(['solid', 'blocked'] as const).map((kind) => (
                  <clipPath
                    key={kind}
                    id={clipId(edge.id, kind)}
                    data-render-clip={`${edge.id}:${kind}`}
                    clipPathUnits="userSpaceOnUse"
                  >
                    <path d="" clipRule="nonzero" />
                  </clipPath>
                ))}
              </g>
            ))}
          </defs>
          {records.edges.map((edge) => (
            <g key={edge.id} data-render-edge={edge.id} style={{ opacity: edge.opacity }}>
              <path
                className={`edge-underlay-path${edge.selected ? ' edge-underlay-path-selected' : ''}${edge.matched ? ' edge-underlay-path-matched' : ''}`}
                d={edge.path}
                fill="none"
                clipPath={`url(#${clipId(edge.id, 'solid')})`}
              />
              <path
                className={`edge-overlay-path${edge.selected ? ' edge-overlay-path-selected' : ''}${edge.matched ? ' edge-overlay-path-matched' : ''}`}
                d={edge.path}
                fill="none"
                clipPath={`url(#${clipId(edge.id, 'blocked')})`}
              />
              <path
                className="edge-hit-path"
                data-relation-id={edge.relationId}
                d={edge.path}
                fill="none"
                stroke="transparent"
                strokeWidth={28}
                strokeLinecap="round"
                clipPath={`url(#${clipId(edge.id, 'solid')})`}
                pointerEvents="stroke"
              />
            </g>
          ))}
        </svg>
        <div className="edge-overlay-world edge-overlay-world-labels">
          {records.edges.map((edge) => (
            <div key={edge.id} data-render-label={edge.id}>
              <EdgeLabel edge={edge} delegateClicks />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
