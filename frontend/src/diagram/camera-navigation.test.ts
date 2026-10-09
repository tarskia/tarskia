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

  it('restores and corrects a saved viewport through initialize-diagram', () => {
    const savedViewport = { x: 720, y: 520, zoom: 1 };
    const intent: NavigationIntent = { kind: 'initialize-diagram' };
    const policy = resolveNavigationPolicy(intent);

    expect(
      resolveNavigationViewport({
        intent,
        policy,
        savedViewport,
        canvasSize,
        sceneBounds,
        currentViewport,
        minZoom,
        maxZoom,
        getNodeSetBounds: () => null,
      }),
    ).toEqual(
      computeViewportToKeepRectVisible({
        viewport: savedViewport,
        canvas: canvasSize,
        rect: sceneBounds,
        padding: 40,
      }) ?? savedViewport,
    );
  });

  it('repairs a degenerate min-zoom saved viewport while initializing', () => {
    const savedViewport = { x: 417, y: -3.15, zoom: 0.05 };
    const intent: NavigationIntent = { kind: 'initialize-diagram' };
    const policy = resolveNavigationPolicy(intent);

    const viewport = resolveNavigationViewport({
      intent,
      policy,
      savedViewport,
      canvasSize,
      sceneBounds,
      currentViewport,
      minZoom: 0.05,
      maxZoom,
      getNodeSetBounds: () => null,
    });

    expect(viewport?.zoom).toBeGreaterThan(1);
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

  it('retains persistence and host-settle options on live intents', () => {
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

  it('retains a saved viewport when initialization has no measured canvas', () => {
    const savedViewport = { x: 24, y: 56, zoom: 1.25 };
    const intent: NavigationIntent = { kind: 'initialize-diagram' };
    expect(
      resolveNavigationViewport({
        intent,
        policy: resolveNavigationPolicy(intent),
        savedViewport,
        canvasSize: null,
        sceneBounds,
        currentViewport,
        minZoom,
        maxZoom,
        getNodeSetBounds: () => null,
      }),
    ).toBe(savedViewport);
  });
});
