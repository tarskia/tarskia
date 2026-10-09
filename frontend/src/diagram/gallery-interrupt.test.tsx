// @vitest-environment happy-dom

import type { SemanticDocument } from '@tarskia/diagram-semantics';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactFlowInstance } from 'reactflow';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasRenderSnapshot } from '../canvas/rendering/presentation/presentation';
import { DEFAULT_ANIMATION_SETTINGS } from '../canvas/rendering/transition/animation-constants';
import { captureTransitionOverlaySnapshot } from '../canvas/rendering/transition/overlay';
import { loadGallery } from '../test/curated-rendering';
import { useDiagramEngine } from './useDiagramEngine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('interrupts an n8n expansion at 40% without a display jump and settles at the new target', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let now = 0,
    nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const gallery = loadGallery('n8n.yaml');
  const initial = gallery.render([]),
    expanded = gallery.render(['browser-editor-shell']);
  expect(expanded.presentation.nodes.length).toBeGreaterThan(initial.presentation.nodes.length);
  const target = gallery.render([]);
  let engine!: ReturnType<typeof useDiagramEngine>;
  const persistViewport = vi.fn(),
    traceSelection = vi.fn();
  function Harness({ doc }: { doc: SemanticDocument }) {
    engine = useDiagramEngine({
      doc,
      schema: gallery.graph.schema,
      animationSettings: DEFAULT_ANIMATION_SETTINGS,
      skipTransitions: false,
      showDebug: false,
      persistViewport,
      traceSelection,
      minZoom: 0.01,
      maxZoom: 2,
    });
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let viewport = { x: 0, y: 0, zoom: 1 };
  const canvas = document.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 1280 }, clientHeight: { value: 720 } });
  canvas.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1280,
    bottom: 720,
    width: 1280,
    height: 720,
    toJSON: () => ({}),
  });
  const snapshot = (): CanvasRenderSnapshot =>
    engine.transitionOverlay && engine.overlayFrameStore.getSnapshot()
      ? captureTransitionOverlaySnapshot({
          state: engine.transitionOverlay,
          frame: engine.overlayFrameStore.getSnapshot()!,
        })
      : engine.presentation;
  const appearance = (value: CanvasRenderSnapshot) => ({
    nodes: value.nodes
      .map((node) => ({ id: node.id, rect: node.rect, opacity: node.opacity }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: value.overlayEdges
      .map((edge) => ({ id: edge.id, path: edge.path, opacity: edge.opacity }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  const advance = async (time: number) => {
    await act(async () => {
      now = time;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    });
    const requiredGeneration = engine.requiredHostGeneration;
    if (requiredGeneration !== null)
      await act(async () => engine.notifyDisplayHostSettled(requiredGeneration));
  };
  try {
    await act(async () => root.render(<Harness doc={initial.doc} />));
    await act(async () => {
      engine.onCanvasElementChange(canvas);
      engine.onCanvasInit({
        getViewport: () => viewport,
        setViewport: (next: typeof viewport) => {
          viewport = next;
          return Promise.resolve(true);
        },
      } as unknown as ReactFlowInstance);
    });
    for (let i = 0; i < 30 && (callbacks.size || engine.requiredHostGeneration !== null); i++)
      await advance(now + 100);
    await act(async () => {
      engine.setPendingStructuralTransitionIntent({ direction: 'in', focus: null });
      root.render(<Harness doc={expanded.doc} />);
    });
    for (let i = 0; i < 30 && !engine.transitionOverlay; i++) await advance(now + 50);
    expect(engine.transitionOverlay).not.toBeNull();
    const overlay = engine.transitionOverlay;
    if (!overlay) throw new Error('Expansion must create an overlay');
    await advance(overlay.startedAt + overlay.duration * 0.4);
    const before = appearance(snapshot());
    const viewportBeforeInterrupt = { ...engine.getCurrentViewport() };
    expect(before).not.toEqual(appearance(initial.presentation));
    expect(before).not.toEqual(appearance(expanded.presentation));
    await act(async () => {
      engine.setPendingStructuralTransitionIntent({ direction: 'out', focus: null });
      root.render(<Harness doc={target.doc} />);
    });
    expect(appearance(snapshot())).toEqual(before);
    expect(engine.getCurrentViewport()).toEqual(viewportBeforeInterrupt);
    for (let i = 0; i < 200 && (callbacks.size || engine.motionPhase !== 'idle'); i++)
      await advance(now + 50);
    expect(engine.motionPhase).toBe('idle');
    expect(appearance(snapshot())).toEqual(appearance(target.presentation));
    expect(callbacks.size).toBe(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
