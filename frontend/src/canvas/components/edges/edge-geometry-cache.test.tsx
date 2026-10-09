// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Node } from 'reactflow';
import { afterEach, expect, it, vi } from 'vitest';
import { loadGallery } from '../../../test/curated-rendering';
import type { ReactFlowHostNodeData } from '../../host/reactflow/types';
import { EdgeOverlay } from './EdgeOverlay';
import { resolveCachedEdgeOverlayRenderState } from './edge-overlay-state';
import * as occlusion from './occluder-geometry';

vi.mock('reactflow', () => ({
  useStore: (selector: (state: { transform: number[] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reuses geometry across host selection/search updates while rendering fresh decorations', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const gallery = loadGallery('n8n.yaml');
  const snapshot = gallery.render(gallery.graph.entities.map((entity) => entity.id)).presentation;
  const flatten = vi.spyOn(occlusion, 'flattenOccluders');
  const nodes = snapshot.nodes.map((view) => ({
    id: view.id,
    position: { x: 0, y: 0 },
    data: { view, controls: { showConnectionHandles: false } },
  })) as Node<ReactFlowHostNodeData>[];
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <EdgeOverlay geometrySnapshot={snapshot} edges={snapshot.overlayEdges} nodes={nodes} />,
      ),
    );
    const calls = flatten.mock.calls.length;
    expect(calls).toBe(snapshot.overlayEdges.length);
    expect(calls).toBeGreaterThan(0);
    const before = resolveCachedEdgeOverlayRenderState(snapshot);
    const decorated = snapshot.overlayEdges.map((edge) => ({
      ...edge,
      selected: true,
      matched: true,
      opacity: 0.6,
    }));
    await act(async () =>
      root.render(
        <EdgeOverlay
          geometrySnapshot={snapshot}
          edges={decorated}
          nodes={nodes.map((node) => ({ ...node, selected: true }))}
        />,
      ),
    );
    expect(flatten).toHaveBeenCalledTimes(calls);
    expect(host.querySelectorAll('.edge-underlay-path-selected')).toHaveLength(decorated.length);
    expect(host.querySelectorAll('.edge-underlay-path-matched')).toHaveLength(decorated.length);
    const after = resolveCachedEdgeOverlayRenderState(snapshot, decorated);
    expect(after.edges[0].blockerOccluders).toBe(before.edges[0].blockerOccluders);
    expect(after.edges[0].solidClipPath).toBe(before.edges[0].solidClipPath);
    expect(after.edges[0]).toMatchObject({ selected: true, matched: true, opacity: 0.6 });
    const changed = {
      ...snapshot,
      nodes: snapshot.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              rect: { ...node.rect, x: node.rect.x + 50 },
              contentScale: 0.75,
              contentOccluders: [{ x: 0, y: 0, width: 40, height: 20 }],
            }
          : node,
      ),
    };
    const rebuilt = resolveCachedEdgeOverlayRenderState(changed);
    expect(flatten).toHaveBeenCalledTimes(calls * 2);
    expect(rebuilt).not.toBe(before);
    const rerouted = {
      ...changed,
      overlayEdges: changed.overlayEdges.map((edge) => ({
        ...edge,
        path: 'M 0,0 L 200,0',
        solidOverNodeIds: [],
      })),
    };
    expect(resolveCachedEdgeOverlayRenderState(rerouted)).not.toBe(rebuilt);
    expect(flatten).toHaveBeenCalledTimes(calls * 3);
  } finally {
    await act(async () => root.unmount());
  }
});
