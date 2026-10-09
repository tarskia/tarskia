// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasRenderSnapshot } from '../canvas/rendering/presentation/presentation';
import { useDiagramMotionManager } from './useDiagramMotionManager';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountManager() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let now = 0;
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  let viewport = { x: 0, y: 0, zoom: 1 };
  const snapshot: CanvasRenderSnapshot = { nodes: [], overlayEdges: [] };
  const args = {
    stableSnapshot: snapshot,
    getCurrentCanvasSize: () => ({ width: 960, height: 640 }),
    minZoom: 0.1,
    maxZoom: 2,
    persistViewport: vi.fn(),
    onCanvasInit: vi.fn(),
    onCanvasUnmount: vi.fn(),
    getCurrentViewport: () => viewport,
    getSceneBounds: () => ({ x: 0, y: 0, width: 480, height: 320 }),
    getNodeSetBounds: () => ({ x: 120, y: 80, width: 120, height: 90 }),
    setViewport: (next: typeof viewport) => {
      viewport = next;
    },
  };
  let manager!: ReturnType<typeof useDiagramMotionManager>;
  function Harness() {
    manager = useDiagramMotionManager(args);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness />));
  await act(async () => manager.onCanvasInit({} as never));
  const step = async () => {
    await act(async () => {
      now += 50;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    });
  };
  return {
    get manager() {
      return manager;
    },
    get viewport() {
      return viewport;
    },
    step,
    settle: async () => {
      for (let i = 0; i < 30 && frames.size; i++) await step();
      expect(frames.size).toBe(0);
    },
    unmount: () => act(async () => root.unmount()),
  };
}
const callbacks = () => ({ onComplete: vi.fn(), onSettled: vi.fn() });
const sceneIntent = { kind: 'fit-scene' } as const;
const focusIntent = {
  kind: 'fit-node-set' as const,
  nodeIds: ['node-1'],
};

it.each([
  'completed',
  'superseded',
  'cancelled',
  'gesture',
] as const)('settles an active navigation exactly once as %s', async (reason) => {
  const harness = await mountManager();
  const first = callbacks();
  const second = callbacks();
  try {
    await act(async () => {
      harness.manager.requestNavigation(sceneIntent, first);
    });
    await harness.step();
    expect(harness.manager.motionPhase).toBe('animating');
    expect(first.onSettled).not.toHaveBeenCalled();
    await act(async () => {
      if (reason === 'superseded') harness.manager.requestNavigation(focusIntent, second);
      if (reason === 'cancelled') harness.manager.cancelMotion();
      if (reason === 'gesture') harness.manager.reportUserGestureStart();
    });
    await harness.settle();
    if (reason === 'gesture')
      await act(async () => harness.manager.reportUserGestureEnd(harness.viewport));
    expect(first.onSettled).toHaveBeenCalledExactlyOnceWith(reason);
    expect(first.onComplete).toHaveBeenCalledTimes(reason === 'completed' ? 1 : 0);
    if (reason === 'superseded') {
      expect(second.onSettled).toHaveBeenCalledExactlyOnceWith('completed');
      expect(second.onComplete).toHaveBeenCalledTimes(1);
    }
    await act(async () => {
      harness.manager.cancelMotion();
      harness.manager.onCanvasUnmount();
    });
    expect(first.onSettled).toHaveBeenCalledTimes(1);
  } finally {
    await harness.unmount();
  }
});

it.each([
  'gesture',
  'unready-host',
  'deferred-frame',
] as const)('settles replaced %s navigation and resumes its replacement once', async (queue) => {
  const harness = await mountManager();
  const first = callbacks();
  const second = callbacks();
  try {
    await act(async () => {
      if (queue === 'gesture') harness.manager.reportUserGestureStart();
      if (queue === 'unready-host') harness.manager.onCanvasUnmount();
      expect(
        harness.manager.requestNavigation(
          { ...sceneIntent, deferUntilNextFrame: queue === 'deferred-frame' },
          first,
        ).status,
      ).toBe('queued');
      expect(
        harness.manager.requestNavigation(
          { ...focusIntent, deferUntilNextFrame: queue === 'deferred-frame' },
          second,
        ).status,
      ).toBe('queued');
    });
    expect(first.onSettled).toHaveBeenCalledExactlyOnceWith('superseded');
    expect(first.onComplete).not.toHaveBeenCalled();
    expect(second.onSettled).not.toHaveBeenCalled();
    await act(async () => {
      if (queue === 'gesture') harness.manager.reportUserGestureEnd(harness.viewport);
      if (queue === 'unready-host') harness.manager.onCanvasInit({} as never);
    });
    await harness.settle();
    expect(second.onSettled).toHaveBeenCalledExactlyOnceWith('completed');
    expect(second.onComplete).toHaveBeenCalledTimes(1);
    await act(async () => harness.manager.onCanvasUnmount());
    expect(first.onSettled).toHaveBeenCalledTimes(1);
    expect(second.onSettled).toHaveBeenCalledTimes(1);
  } finally {
    await harness.unmount();
  }
});

it('keeps the newest reentrant deferred request and settles both superseded requests once', async () => {
  const harness = await mountManager();
  const first = callbacks();
  const outerReplacement = callbacks();
  const reentrant = callbacks();
  first.onSettled.mockImplementation((reason) => {
    if (reason === 'superseded')
      harness.manager.requestNavigation({ ...focusIntent, deferUntilNextFrame: true }, reentrant);
  });
  try {
    await act(async () => {
      harness.manager.requestNavigation({ ...sceneIntent, deferUntilNextFrame: true }, first);
      harness.manager.requestNavigation(
        { ...sceneIntent, deferUntilNextFrame: true },
        outerReplacement,
      );
    });
    expect(first.onSettled).toHaveBeenCalledExactlyOnceWith('superseded');
    expect(outerReplacement.onSettled).toHaveBeenCalledExactlyOnceWith('superseded');
    expect(reentrant.onSettled).not.toHaveBeenCalled();
    await harness.settle();
    expect(reentrant.onSettled).toHaveBeenCalledExactlyOnceWith('completed');
    expect(reentrant.onComplete).toHaveBeenCalledTimes(1);
    expect(first.onComplete).not.toHaveBeenCalled();
    expect(outerReplacement.onComplete).not.toHaveBeenCalled();
    const finalViewport = { ...harness.viewport };
    await act(async () => harness.manager.onCanvasUnmount());
    await harness.step();
    expect(harness.viewport).toEqual(finalViewport);
    expect(first.onSettled).toHaveBeenCalledTimes(1);
    expect(outerReplacement.onSettled).toHaveBeenCalledTimes(1);
    expect(reentrant.onSettled).toHaveBeenCalledTimes(1);
  } finally {
    await harness.unmount();
  }
});
