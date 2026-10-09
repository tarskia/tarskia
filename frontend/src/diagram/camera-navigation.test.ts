import { describe, expect, it } from 'vitest';

import {
  ANIMATION_CONSTANTS,
  DEFAULT_VIEWPORT_FIT_PADDING,
} from '../canvas/rendering/transition/animation-constants';
import {
  computeViewportForBoundsInVisibleCanvas,
  computeViewportToKeepRectVisible,
} from '../canvas/viewport-visibility';
import { resolveNavigationPolicy, resolveNavigationViewport } from './camera-navigation';
import type { NavigationIntent } from './motion-types';

const canvasSize = { width: 960, height: 640 };
const sceneBounds = { x: 0, y: 0, width: 480, height: 320 };
const currentViewport = { x: 0, y: 0, zoom: 1 };
const minZoom = 0.5;
const maxZoom = 2;

const resolveViewport = (intent: NavigationIntent) => {
  const policy = resolveNavigationPolicy(intent);
  const viewport = resolveNavigationViewport({
    intent,
    policy,
    canvasSize,
    sceneBounds,
    currentViewport,
    minZoom,
    maxZoom,
    getNodeSetBounds: () => null,
  });
  return { policy, viewport };
};

describe('camera navigation helpers', () => {
  it('resolves initialize-diagram with the shared scene-fit padding', () => {
    const { policy, viewport } = resolveViewport({
      kind: 'initialize-diagram',
    });

    expect(policy.mode).toBe('immediate');
    expect(policy.padding).toBe(DEFAULT_VIEWPORT_FIT_PADDING);
    expect(viewport).toEqual(
      computeViewportForBoundsInVisibleCanvas({
        bounds: sceneBounds,
        canvas: canvasSize,
        minZoom,
        maxZoom,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
  });

  it('restores a framing with no scene-fit padding', () => {
    const intent: NavigationIntent = { kind: 'initialize-diagram' };
    expect(
      resolveNavigationViewport({
        intent,
        policy: resolveNavigationPolicy(intent),
        savedCamera: { rect: sceneBounds },
        canvasSize,
        sceneBounds,
        currentViewport,
        minZoom,
        maxZoom,
        getNodeSetBounds: () => null,
      }),
    ).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it('uses the same fit target for immediate initialization and animated layout fitting', () => {
    const initialized = resolveViewport({ kind: 'initialize-diagram' });
    const fitted = resolveViewport({ kind: 'fit-scene', preset: 'layout' });
    expect(initialized.policy.durationMs).toBe(0);
    expect(initialized.policy.waitForHostGeneration).toBe(false);
    expect(fitted.policy.mode).toBe('animated');
    expect(fitted.policy.durationMs).toBe(ANIMATION_CONSTANTS.viewport.fitDuration);
    expect(fitted.policy.waitForHostGeneration).toBe(true);
    expect(fitted.viewport).toEqual(initialized.viewport);
  });

  it('retains host-settle options on live intents', () => {
    expect(
      resolveNavigationPolicy({
        kind: 'fit-node-set',
        nodeIds: ['a'],
        waitForHostSettle: false,
      }),
    ).toMatchObject({
      mode: 'animated',
      durationMs: 260,
      waitForHostGeneration: false,
    });
    expect(resolveNavigationPolicy({ kind: 'ensure-visible', rect: sceneBounds })).toMatchObject({
      mode: 'animated',
      durationMs: 180,
      padding: 40,
      waitForHostGeneration: false,
    });
  });

  it('restores against a saved anchor even when ordinary node-fit bounds exclude it', () => {
    const intent: NavigationIntent = { kind: 'initialize-diagram' };
    expect(
      resolveNavigationViewport({
        intent,
        policy: resolveNavigationPolicy(intent),
        savedCamera: { anchorId: 'shell', rect: { x: 0, y: 0, width: 480, height: 320 } },
        canvasSize,
        sceneBounds,
        currentViewport,
        minZoom,
        maxZoom,
        getNodeSetBounds: () => null,
        getAnchorBounds: () => ({ x: 100, y: 200, width: 480, height: 320 }),
      }),
    ).toEqual({ x: -200, y: -400, zoom: 2 });
  });

  it('waits for measured canvas dimensions before restoring saved framing', () => {
    const intent: NavigationIntent = { kind: 'initialize-diagram' };
    expect(
      resolveNavigationViewport({
        intent,
        policy: resolveNavigationPolicy(intent),
        savedCamera: { rect: sceneBounds },
        canvasSize: null,
        sceneBounds,
        currentViewport,
        minZoom,
        maxZoom,
        getNodeSetBounds: () => null,
      }),
    ).toBeNull();
  });
});
