// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_ANIMATION_SETTINGS } from '../canvas/rendering/transition/animation-constants';
import { loadGallery } from '../test/curated-rendering';
import * as bootstrapModule from './useCanvasBootstrapController';
import { useDiagramEngine } from './useDiagramEngine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('stops measuring after bootstrap, but measures again for a new diagram', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getCurrentCanvasSize = vi.fn(() => ({ width: 1000, height: 700 }));
  const requestNavigation = vi.fn(() => ({ status: 'applied', reason: 'synchronous' }) as const);
  let result!: ReturnType<typeof bootstrapModule.useCanvasBootstrapController>;
  function Harness({ diagramKey, version }: { diagramKey: string; version: number }) {
    result = bootstrapModule.useCanvasBootstrapController({
      initialViewportKey: diagramKey,
      getCurrentCanvasSize,
      canvasLayoutVersion: version,
      sceneBounds: { x: 0, y: 0, width: 200, height: 100 },
      minZoom: 0.01,
      maxZoom: 2,
      animationSettings: DEFAULT_ANIMATION_SETTINGS,
      getLeftOcclusion: () => 0,
      canvasReady: true,
      requestNavigation,
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness diagramKey="first" version={0} />));
    expect(result.initialViewportPending).toBe(false);
    expect(requestNavigation).toHaveBeenCalledTimes(1);
    const viewport = result.defaultViewport;
    getCurrentCanvasSize.mockClear();
    for (let version = 1; version < 5; version++) {
      await act(async () => root.render(<Harness diagramKey="first" version={version} />));
    }
    expect(getCurrentCanvasSize).not.toHaveBeenCalled();
    expect(result.defaultViewport).toBe(viewport);
    await act(async () => root.render(<Harness diagramKey="second" version={5} />));
    expect(getCurrentCanvasSize).toHaveBeenCalled();
    expect(requestNavigation).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});

it('keeps camera bounds identity while the stable scene snapshot is unchanged', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const bootstrap = vi
    .spyOn(bootstrapModule, 'useCanvasBootstrapController')
    .mockReturnValue({ initialViewportPending: false });
  const gallery = loadGallery('prometheus.yaml');
  const doc = gallery.graph.doc;
  const persistViewport = vi.fn();
  function Harness({ leftOcclusion }: { leftOcclusion: number }) {
    useDiagramEngine({
      doc,
      schema: gallery.graph.schema,
      animationSettings: DEFAULT_ANIMATION_SETTINGS,
      skipTransitions: true,
      showDebug: false,
      persistViewport,
      minZoom: 0.01,
      maxZoom: 2,
      leftOcclusion,
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness leftOcclusion={0} />));
    const bounds = bootstrap.mock.lastCall![0].sceneBounds;
    expect(bounds).not.toBeNull();
    await act(async () => root.render(<Harness leftOcclusion={100} />));
    expect(bootstrap.mock.lastCall![0].sceneBounds).toBe(bounds);
  } finally {
    await act(async () => root.unmount());
  }
});
