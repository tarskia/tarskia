// @vitest-environment happy-dom
import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { loadGallery, planGalleryTransition } from '../test/curated-rendering';
import { EntityNode } from './components/nodes/EntityNode';
import { GroupNode } from './components/nodes/GroupNode';
import { DiagramRenderer } from './DiagramRenderer';
import { buildCanvasRenderState } from './node-presentation';
import {
  captureTransitionFrameSnapshot,
  resolveAnimationFrame,
} from './rendering/transition/overlay';
import { createOverlayFrameStore } from './rendering/transition/overlay-frame-store';

const nodeTypes = { entityNode: EntityNode, groupNode: GroupNode };
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('keeps one interactive node/edge tree through frames, retarget and final geometry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const gallery = loadGallery('n8n.yaml');
  const initial = gallery.render([]),
    expanded = gallery.render(['browser-editor-shell']);
  const { overlay: state } = planGalleryTransition(initial, expanded);
  const store = createOverlayFrameStore();
  const zoom = vi.fn(() => true);
  const bindings = {
    onZoomTrigger: zoom,
    onExpandDetails: vi.fn(),
    onCollapseDetails: vi.fn(),
    onExpandChildGroups: vi.fn(),
    onCollapseChildGroups: vi.fn(),
    onEdgeLabelClick: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const commits = vi.fn();
  const render = (snapshot: typeof initial.presentation, motion: typeof state | undefined) => {
    const mapped = buildCanvasRenderState({ presentation: snapshot, bindings });
    return (
      <Profiler id="world" onRender={commits}>
        <DiagramRenderer
          nodes={mapped.nodes}
          edges={mapped.overlayEdges}
          nodeTypes={nodeTypes}
          state={motion}
          frameStore={store}
        />
      </Profiler>
    );
  };
  try {
    await act(async () => root.render(render(initial.presentation, state)));
    const node = host.querySelector<HTMLElement>('[data-render-node="browser-editor-shell"]');
    if (!node) throw new Error('Expected real gallery node');
    const path = host.querySelector('[data-render-edge] .edge-underlay-path');
    const hiddenLabels = resolveAnimationFrame(state, 300);
    hiddenLabels.edges = hiddenLabels.edges.map((edge) => ({ ...edge, labelOpacity: 0 }));
    await act(async () => store.publish(hiddenLabels));
    const labelButtons = [
      ...host.querySelectorAll<HTMLButtonElement>('[data-render-label] button'),
    ];
    expect(labelButtons.length).toBeGreaterThan(0);
    expect(labelButtons.every((button) => button.disabled)).toBe(true);
    expect(
      [...host.querySelectorAll('[data-render-edge] .edge-hit-path')].some(
        (path) => path.getAttribute('pointer-events') === 'stroke',
      ),
    ).toBe(true);
    const initialCommits = commits.mock.calls.length;
    for (let step = 1; step <= 8; step++)
      await act(async () => store.publish(resolveAnimationFrame(state, step * 50)));
    expect(commits).toHaveBeenCalledTimes(initialCommits);
    expect(host.querySelector('[data-render-node="browser-editor-shell"]')).toBe(node);
    expect(host.querySelector('[data-render-edge] .edge-underlay-path')).toBe(path);
    const collapse = node.querySelector<HTMLButtonElement>('button[aria-label="Zoom out details"]');
    expect(collapse).not.toBeNull();
    expect(collapse?.disabled).toBe(false);
    await act(async () => collapse?.click());
    expect(zoom).toHaveBeenCalledWith('browser-editor-shell', 'out');
    const current = captureTransitionFrameSnapshot({
      state,
      frame: resolveAnimationFrame(state, 400),
    });
    const before = node.style.transform;
    const { overlay: retarget } = planGalleryTransition(
      { ...expanded, presentation: current },
      initial,
    );
    store.publish(resolveAnimationFrame(retarget, 0));
    await act(async () => root.render(render(current, retarget)));
    expect(node.style.transform).toBe(before);
    expect(host.querySelector('[data-render-node="browser-editor-shell"]')).toBe(node);
    await act(async () => store.publish(resolveAnimationFrame(retarget, 1000)));
    const lastTransform = node.style.transform;
    const lastWidth = node.style.width;
    const finalEdges = [...host.querySelectorAll<SVGPathElement>('[data-render-edge]')]
      .filter((element) => element.style.display !== 'none')
      .map((element) => element.querySelector('path')?.getAttribute('d'));
    await act(async () => root.render(render(initial.presentation, undefined)));
    expect(host.querySelector('[data-render-node="browser-editor-shell"]')).toBe(node);
    expect(
      host.querySelector<HTMLElement>('[data-render-node="browser-editor-shell"]')?.style.transform,
    ).toBe(lastTransform);
    expect(
      host.querySelector<HTMLElement>('[data-render-node="browser-editor-shell"]')?.style.width,
    ).toBe(lastWidth);
    expect(
      [...host.querySelectorAll('[data-render-edge]')].map((element) =>
        element.querySelector('path')?.getAttribute('d'),
      ),
    ).toEqual(finalEdges);
  } finally {
    await act(async () => root.unmount());
  }
});

it('uses URL-stable unique clip IDs for punctuation and hierarchical edge IDs', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const gallery = loadGallery('n8n.yaml').render([]);
  const source = gallery.presentation.overlayEdges[0];
  const edges = ['a/b:c%', 'a%2Fb:c%', 'a-b:c%'].map((id) => ({ ...source, id }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const bindings = {
    onZoomTrigger: () => true,
    onExpandDetails: vi.fn(),
    onCollapseDetails: vi.fn(),
    onExpandChildGroups: vi.fn(),
    onCollapseChildGroups: vi.fn(),
    onEdgeLabelClick: vi.fn(),
  };
  const mapped = buildCanvasRenderState({
    presentation: { ...gallery.presentation, overlayEdges: edges },
    bindings,
  });
  try {
    await act(async () =>
      root.render(
        <DiagramRenderer nodes={mapped.nodes} edges={mapped.overlayEdges} nodeTypes={nodeTypes} />,
      ),
    );
    const ids = [...host.querySelectorAll('clipPath')].map((element) => element.id);
    expect(new Set(ids).size).toBe(6);
    for (const element of host.querySelectorAll('[clip-path]')) {
      const id = element.getAttribute('clip-path')?.slice(5, -1);
      expect(id).toMatch(/^world-[0-9a-f-]+-(solid|blocked)$/);
      expect(decodeURIComponent(id ?? '')).toBe(id);
      expect(document.getElementById(id ?? '')?.tagName).toBe('clipPath');
    }
  } finally {
    await act(async () => root.unmount());
  }
});
