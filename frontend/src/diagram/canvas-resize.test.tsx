import { buildSemanticIndex } from '@tarskia/diagram-semantics';
// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasCamera } from '../canvas/camera';
import { DEFAULT_VIEWPORT_FIT_PADDING } from '../canvas/rendering/transition/animation-constants';
import { computeViewportForBoundsInVisibleCanvas } from '../canvas/viewport-visibility';
import { loadGallery } from '../test/curated-rendering';
import { DEFAULT_FIT_DURATION_MS } from './camera-navigation';
import { useDiagramEngine } from './useDiagramEngine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  'manual',
  'automatic',
  'transition',
  'focus',
] as const)('compensates canvas resize for %s framing', async (mode) => {
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
  let resize!: () => void;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const gallery = loadGallery('n8n.yaml');
  const initial = gallery.render([]);
  let engine!: ReturnType<typeof useDiagramEngine>;
  const persistViewport = vi.fn();
  function Harness() {
    engine = useDiagramEngine({
      index: buildSemanticIndex(initial.doc, gallery.graph.schema),
      view: initial.doc.view,
      skipTransitions: false,
      showDebug: false,
      persistViewport,
      initialViewportKey: 'n8n',
      minZoom: 0.01,
      maxZoom: 2,
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  let viewport = { x: 0, y: 0, zoom: 1 };
  let size = { width: 1440, height: 900 };
  const canvas = document.createElement('div');
  canvas.getBoundingClientRect = () => ({
    ...size,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: size.width,
    bottom: size.height,
    toJSON: () => ({}),
  });
  const step = async (time: number) => {
    await act(async () => {
      now = time;
      const queued = [...callbacks.values()];
      callbacks.clear();
      for (const callback of queued) callback(now);
    });
  };
  const settle = async () => {
    for (let i = 0; i < 60 && callbacks.size; i++) await step(now + 100);
  };
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      engine.onCanvasElementChange(canvas);
      engine.onCanvasInit({
        getViewport: () => viewport,
        setViewport: (next: typeof viewport) => {
          viewport = next;
          return Promise.resolve(true);
        },
      } as unknown as CanvasCamera);
    });
    await settle();
    const fittedBefore = { ...viewport };
    const focusNode = initial.presentation.nodes.find((node) => node.id === 'browser-editor-shell');
    if (!focusNode) throw new Error('Expected visible browser-editor-shell fixture');
    const focusRect = focusNode.rect;
    if (mode === 'manual')
      await act(async () => {
        // React Flow has already moved when the surface reports the first gesture event.
        viewport = { ...viewport, x: viewport.x + 120, zoom: viewport.zoom * 1.3 };
        engine.reportUserGestureStart();
        engine.reportUserGestureMove(viewport);
        engine.reportUserGestureEnd(viewport);
      });
    if (mode === 'focus' || mode === 'transition') {
      await act(async () =>
        engine.requestNavigation({
          kind: 'fit-node-set',
          nodeIds: [focusNode.id],
          preset: 'focus',
        }),
      );
      if (mode === 'transition') {
        await step(now + DEFAULT_FIT_DURATION_MS * 0.4);
        expect(engine.motionPhase).toBe('animating');
      } else await settle();
    }
    const beforeResize = { ...viewport };
    const transitionTarget = computeViewportForBoundsInVisibleCanvas({
      bounds: focusRect,
      canvas: size,
      minZoom: 0.01,
      maxZoom: 2,
      padding: DEFAULT_VIEWPORT_FIT_PADDING,
    });
    size = { width: 1020, height: 1000 };
    await act(async () => resize());
    if (mode === 'manual' || mode === 'transition') {
      expect(viewport).toEqual({
        ...beforeResize,
        x: beforeResize.x - 210,
        y: beforeResize.y + 50,
      });
    } else if (mode === 'focus') {
      expect(viewport).toEqual(
        computeViewportForBoundsInVisibleCanvas({
          bounds: focusRect,
          canvas: size,
          minZoom: 0.01,
          maxZoom: 2,
          padding: DEFAULT_VIEWPORT_FIT_PADDING,
        }),
      );
    } else {
      expect(viewport.zoom).toBeLessThan(fittedBefore.zoom);
      const nodes = initial.presentation.nodes;
      const minX = Math.min(...nodes.map((node) => node.rect.x));
      const minY = Math.min(...nodes.map((node) => node.rect.y));
      const maxX = Math.max(...nodes.map((node) => node.rect.x + node.rect.width));
      const maxY = Math.max(...nodes.map((node) => node.rect.y + node.rect.height));
      expect(viewport).toEqual(
        computeViewportForBoundsInVisibleCanvas({
          bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
          canvas: size,
          minZoom: 0.01,
          maxZoom: 2,
          padding: DEFAULT_VIEWPORT_FIT_PADDING,
        }),
      );
    }
    await settle();
    if (mode === 'transition')
      expect(viewport).toEqual({
        ...transitionTarget,
        x: transitionTarget.x - 210,
        y: transitionTarget.y + 50,
      });
    expect(engine.motionPhase).toBe('idle');
  } finally {
    await act(async () => root.unmount());
  }
});
