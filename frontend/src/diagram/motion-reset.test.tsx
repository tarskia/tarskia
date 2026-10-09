// @vitest-environment happy-dom
import type { SchemaModule, SemanticDocument } from '@tarskia/diagram-semantics';
import { buildSemanticIndex } from '@tarskia/diagram-semantics';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactFlowInstance } from 'reactflow';
import { afterEach, expect, it, vi } from 'vitest';
import { loadGallery } from '../test/curated-rendering';
import { useDiagramEngine } from './useDiagramEngine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  'canvas-unmount',
  'diagram-key',
] as const)('%s clears the previous diagram overlay and queued navigation', async (reset) => {
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
  const first = loadGallery('n8n.yaml');
  const second = loadGallery('prometheus.yaml');
  const initial = first.render([]);
  const expanded = first.render(['browser-editor-shell']);
  const target = second.render([]);
  let engine!: ReturnType<typeof useDiagramEngine>;
  const persistViewport = vi.fn();
  function Harness({
    doc,
    schema,
    diagramKey,
  }: {
    doc: SemanticDocument;
    schema: SchemaModule;
    diagramKey: string;
  }) {
    engine = useDiagramEngine({
      index: buildSemanticIndex(doc, schema),
      view: doc.view,
      initialViewportKey: diagramKey,
      skipTransitions: false,
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
  const setViewport = vi.fn((next: typeof viewport) => {
    viewport = next;
    return Promise.resolve(true);
  });
  const instance = { getViewport: () => viewport, setViewport } as unknown as ReactFlowInstance;
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
    const generation = engine.requiredHostGeneration;
    if (generation !== null) await act(async () => engine.notifyDisplayHostSettled(generation));
  };
  try {
    await act(async () =>
      root.render(<Harness doc={initial.doc} schema={first.graph.schema} diagramKey="n8n" />),
    );
    await act(async () => {
      engine.onCanvasElementChange(canvas);
      engine.onCanvasInit(instance);
    });
    for (let i = 0; i < 40 && (callbacks.size || engine.requiredHostGeneration !== null); i++)
      await advance(now + 50);
    await act(async () => {
      engine.setPendingStructuralTransitionIntent({ direction: 'in', focus: null });
      root.render(<Harness doc={expanded.doc} schema={first.graph.schema} diagramKey="n8n" />);
    });
    for (let i = 0; i < 40 && !engine.transitionOverlay; i++) await advance(now + 50);
    const overlay = engine.transitionOverlay;
    expect(overlay).not.toBeNull();
    if (!overlay) throw new Error('Expected a real in-flight expansion');
    await advance(overlay.startedAt + overlay.duration * 0.4);
    expect(engine.hideHostVisuals).toBe(true);
    expect(engine.motionPhase).not.toBe('idle');
    if (reset === 'diagram-key') {
      await act(async () => {
        engine.reportUserGestureStart();
        expect(
          engine.requestNavigation({
            kind: 'fit-node-set',
            nodeIds: ['browser-editor-shell'],
            preset: 'focus',
          }).status,
        ).toBe('queued');
        expect(
          engine.requestNavigation({
            kind: 'fit-scene',
            preset: 'layout',
            deferUntilNextFrame: true,
          }).status,
        ).toBe('queued');
      });
    } else {
      await act(async () => engine.onCanvasUnmount());
      expect(engine.transitionOverlay).toBeNull();
      expect(engine.overlayFrameStore.getSnapshot()).toBeNull();
      expect(engine.hideHostVisuals).toBe(false);
      expect(callbacks.size).toBe(0);
    }
    await act(async () =>
      root.render(
        <Harness doc={target.doc} schema={second.graph.schema} diagramKey="prometheus" />,
      ),
    );
    if (reset === 'canvas-unmount') await act(async () => engine.onCanvasInit(instance));
    expect(engine.transitionOverlay).toBeNull();
    expect(engine.overlayFrameStore.getSnapshot()).toBeNull();
    expect(engine.hideHostVisuals).toBe(false);
    expect(engine.motionPhase).toBe('idle');
    expect(engine.presentation.nodes.map((node) => node.id)).toEqual(
      target.presentation.nodes.map((node) => node.id),
    );
    const settledViewport = { ...engine.getCurrentViewport() };
    setViewport.mockClear();
    await advance(now + 1000);
    // Ending the old gesture cannot resurrect navigation queued for the old diagram.
    await act(async () => engine.reportUserGestureEnd(settledViewport));
    await advance(now + 1000);
    expect(engine.getCurrentViewport()).toEqual(settledViewport);
    expect(setViewport).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
    expect(engine.presentation.nodes.map((node) => node.id)).toEqual(
      target.presentation.nodes.map((node) => node.id),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
