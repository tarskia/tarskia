// @vitest-environment happy-dom

import type { SemanticDocument } from '@tarskia/diagram-semantics';
import { act, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactFlowInstance } from 'reactflow';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_ANIMATION_SETTINGS } from '../canvas/rendering/transition/animation-constants';
import { resolveTransitionOverlayFrame } from '../canvas/rendering/transition/overlay';
import { loadGallery } from '../test/curated-rendering';
import { useDiagramEngine } from './useDiagramEngine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  30, 60,
])('delivers all %i animation frames without rerendering the engine host per frame', async (frameCount) => {
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
  let engine!: ReturnType<typeof useDiagramEngine>;
  const persistViewport = vi.fn(),
    traceSelection = vi.fn();
  let hostRenders = 0;
  const phases = new Set<string>();
  const receivedFrames = new Set<number>();
  function OverlayProbe({
    store,
  }: {
    store: ReturnType<typeof useDiagramEngine>['overlayFrameStore'];
  }) {
    const frame = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    if (frame) receivedFrames.add(frame.progress);
    return null;
  }
  function Harness({ doc }: { doc: SemanticDocument }) {
    hostRenders++;
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
    phases.add(engine.motionPhase);
    return <OverlayProbe store={engine.overlayFrameStore} />;
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
    await act(async () => root.render(<Harness doc={initial.scene.doc} />));
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
    const transitionStartRenders = hostRenders;
    phases.clear();
    await act(async () => {
      engine.setPendingStructuralTransitionIntent({ direction: 'in', focus: null });
      root.render(<Harness doc={expanded.scene.doc} />);
    });
    for (let i = 0; i < 30 && !engine.transitionOverlay; i++) await advance(now + 50);
    expect(engine.transitionOverlay).not.toBeNull();
    const overlay = engine.transitionOverlay;
    if (!overlay) throw new Error('Expected an active overlay');
    const beforeRenders = hostRenders;
    receivedFrames.clear();
    for (let i = 1; i <= frameCount; i++) {
      await advance(overlay.startedAt + overlay.duration * (0.05 + (0.8 * i) / frameCount));
      expect(engine.overlayFrameStore.getSnapshot()).toEqual(
        resolveTransitionOverlayFrame(overlay, now),
      );
    }
    const frameRenders = hostRenders - beforeRenders;
    expect(receivedFrames.size).toBe(frameCount);
    expect(frameRenders).toBeLessThanOrEqual(6);
    for (let i = 0; i < 60 && (callbacks.size || engine.requiredHostGeneration !== null); i++)
      await advance(now + 100);
    expect(engine.motionPhase).toBe('idle');
    expect(engine.overlayFrameStore.getSnapshot()).toBeNull();
    expect(phases.has('animating')).toBe(true);
    expect(phases.has('idle')).toBe(true);
    expect(hostRenders - transitionStartRenders).toBeLessThanOrEqual(6);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
