// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactFlowInstance } from 'reactflow';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasRenderSnapshot } from '../canvas/rendering/presentation/presentation';
import type { SemanticDocument } from '../model/types';
import { loadGallery } from '../test/curated-rendering';
import { useDiagramEngine } from './useDiagramEngine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const appearance = (snapshot: CanvasRenderSnapshot) => ({
  nodes: snapshot.nodes.map(({ id, rect, opacity }) => ({ id, rect, opacity })),
  edges: snapshot.overlayEdges.map(({ id, path, opacity }) => ({ id, path, opacity })),
});

it('reduced motion expands, collapses and expands all to animated endpoints without animation frames', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let now = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const gallery = loadGallery('n8n.yaml');
  const collapsed = gallery.render([]);
  const expanded = gallery.render(['browser-editor-shell']);
  expect(expanded.presentation.nodes.length).toBeGreaterThan(collapsed.presentation.nodes.length);
  const expandedAll = gallery.render(gallery.graph.entities.map((entity) => entity.id));
  const targets = [
    { rendered: expanded, direction: 'in' as const },
    { rendered: collapsed, direction: 'out' as const },
    { rendered: expandedAll, direction: 'in' as const },
    { rendered: collapsed, direction: 'out' as const },
  ];

  const run = async (skipTransitions: boolean) => {
    let engine!: ReturnType<typeof useDiagramEngine>;
    const persistViewport = vi.fn();
    const observedOverlays: boolean[] = [];
    function Harness({ doc }: { doc: SemanticDocument }) {
      engine = useDiagramEngine({
        doc,
        schema: gallery.graph.schema,
        skipTransitions,
        showDebug: false,
        persistViewport,
        minZoom: 0.01,
        maxZoom: 2,
      });
      observedOverlays.push(engine.transitionOverlay !== null);
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let viewport = { x: 0, y: 0, zoom: 1 };
    const canvas = document.createElement('div');
    Object.defineProperties(canvas, {
      clientWidth: { value: 1280 },
      clientHeight: { value: 720 },
    });
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
    const settle = async () => {
      for (let i = 0; i < 200; i++) {
        const generation = engine.requiredHostGeneration;
        if (generation !== null) await act(async () => engine.notifyDisplayHostSettled(generation));
        if (!callbacks.size && engine.motionPhase === 'idle') break;
        await act(async () => {
          now += 50;
          const pending = [...callbacks.values()];
          callbacks.clear();
          for (const callback of pending) callback(now);
        });
      }
      expect(engine.motionPhase).toBe('idle');
      expect(callbacks.size).toBe(0);
    };
    try {
      await act(async () => root.render(<Harness doc={collapsed.doc} />));
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
      await settle();
      observedOverlays.length = 0;
      const results = [];
      for (const { rendered, direction } of targets) {
        await act(async () => {
          engine.setPendingStructuralTransitionIntent({ direction, focus: null });
          root.render(<Harness doc={rendered.doc} />);
        });
        if (skipTransitions) {
          // Host acknowledgement may remain, but no motion rAF is needed to reach the target.
          expect(engine.transitionOverlay).toBeNull();
          expect(engine.motionPhase).toBe('idle');
          expect(callbacks.size).toBe(0);
          expect(appearance(engine.presentation)).toEqual(appearance(rendered.presentation));
        }
        await settle();
        expect(appearance(engine.presentation)).toEqual(appearance(rendered.presentation));
        results.push({
          presentation: appearance(engine.presentation),
          viewport: { ...engine.getCurrentViewport() },
        });
      }
      expect(observedOverlays.some(Boolean)).toBe(!skipTransitions);
      return results;
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  };

  const animated = await run(false);
  const reduced = await run(true);
  expect(reduced).toEqual(animated);
});

it.each([
  'deferred-frame',
  'gesture',
  'unready-host',
] as const)('keeps %s navigation when reduced motion is enabled before it starts', async (queue) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let now = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const gallery = loadGallery('n8n.yaml');
  const initial = gallery.render([]);
  let engine!: ReturnType<typeof useDiagramEngine>;
  const persistViewport = vi.fn();
  function Harness({ reduced }: { reduced: boolean }) {
    engine = useDiagramEngine({
      doc: initial.doc,
      schema: gallery.graph.schema,
      skipTransitions: reduced,
      showDebug: false,
      persistViewport,
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
  Object.defineProperties(canvas, {
    clientWidth: { value: 1280 },
    clientHeight: { value: 720 },
  });
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
  const instance = {
    getViewport: () => viewport,
    setViewport: (next: typeof viewport) => {
      viewport = next;
      return Promise.resolve(true);
    },
  } as unknown as ReactFlowInstance;
  const advance = async () => {
    await act(async () => {
      now += 50;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    });
    const generation = engine.requiredHostGeneration;
    if (generation !== null) await act(async () => engine.notifyDisplayHostSettled(generation));
  };
  const intent = {
    kind: 'fit-node-set' as const,
    nodeIds: ['browser-editor-shell'],
    preset: 'focus' as const,
    waitForHostSettle: false,
  };
  try {
    await act(async () => root.render(<Harness reduced={false} />));
    await act(async () => {
      engine.onCanvasElementChange(canvas);
      engine.onCanvasInit(instance);
    });
    for (let i = 0; i < 100 && (callbacks.size || engine.motionPhase !== 'idle'); i++)
      await advance();
    const startingViewport = { ...engine.getCurrentViewport() };
    // Establish the target through the real animated path before testing queued execution.
    await act(async () => {
      engine.requestNavigation(intent);
    });
    for (let i = 0; i < 100 && (callbacks.size || engine.motionPhase !== 'idle'); i++)
      await advance();
    const target = { ...engine.getCurrentViewport() };
    expect(target).not.toEqual(startingViewport);
    await act(async () => {
      engine.reportUserGestureStart();
      viewport = startingViewport;
      engine.reportUserGestureEnd(startingViewport);
    });
    await act(async () => {
      if (queue === 'gesture') engine.reportUserGestureStart();
      if (queue === 'unready-host') engine.onCanvasUnmount();
      expect(
        engine.requestNavigation({ ...intent, deferUntilNextFrame: queue === 'deferred-frame' })
          .status,
      ).toBe('queued');
    });
    await act(async () => root.render(<Harness reduced={true} />));
    expect(engine.getCurrentViewport()).toEqual(startingViewport);
    if (queue === 'deferred-frame') await advance();
    else
      await act(async () => {
        if (queue === 'gesture') engine.reportUserGestureEnd(startingViewport);
        else engine.onCanvasInit(instance);
      });
    expect(engine.getCurrentViewport()).toEqual(target);
    expect(engine.motionPhase).toBe('idle');
    expect(engine.transitionOverlay).toBeNull();
    expect(callbacks.size).toBe(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
