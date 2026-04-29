import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ANIMATION_SETTINGS,
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
  const policy = resolveNavigationPolicy(intent, DEFAULT_ANIMATION_SETTINGS);
  const viewport = resolveNavigationViewport({
    intent,
    policy,
    canvasSize,
    sceneBounds,
    currentViewport,
    leftOcclusion: 0,
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
        leftOcclusion: 0,
      }),
    );
  });

  it('restores and corrects a saved viewport through initialize-diagram', () => {
    const savedViewport = { x: 720, y: 520, zoom: 1 };
    const intent: NavigationIntent = { kind: 'initialize-diagram' };
    const policy = resolveNavigationPolicy(intent, DEFAULT_ANIMATION_SETTINGS);

    expect(
      resolveNavigationViewport({
        intent,
        policy,
        savedViewport,
        canvasSize,
        sceneBounds,
        currentViewport,
        leftOcclusion: 0,
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
        leftOcclusion: 0,
      }) ?? savedViewport,
    );
  });

  it('repairs a degenerate min-zoom saved viewport while initializing', () => {
    const savedViewport = { x: 417, y: -3.15, zoom: 0.05 };
    const intent: NavigationIntent = { kind: 'initialize-diagram' };
    const policy = resolveNavigationPolicy(intent, DEFAULT_ANIMATION_SETTINGS);

    const viewport = resolveNavigationViewport({
      intent,
      policy,
      savedViewport,
      canvasSize,
      sceneBounds,
      currentViewport,
      leftOcclusion: 240,
      minZoom: 0.05,
      maxZoom,
      getNodeSetBounds: () => null,
    });

    expect(viewport?.zoom).toBeGreaterThan(1);
  });

  it('resolves the same fit-scene target for immediate and animated modes', () => {
    const animatedIntent: NavigationIntent = {
      kind: 'fit-scene',
      preset: 'layout',
      mode: 'animated',
    };
    const immediateIntent: NavigationIntent = {
      kind: 'fit-scene',
      preset: 'layout',
      mode: 'immediate',
    };
    const animatedPolicy = resolveNavigationPolicy(animatedIntent, DEFAULT_ANIMATION_SETTINGS);
    const immediatePolicy = resolveNavigationPolicy(immediateIntent, DEFAULT_ANIMATION_SETTINGS);

    const animatedViewport = resolveNavigationViewport({
      intent: animatedIntent,
      policy: animatedPolicy,
      canvasSize,
      sceneBounds,
      currentViewport,
      leftOcclusion: 0,
      minZoom,
      maxZoom,
      getNodeSetBounds: () => null,
    });
    const immediateViewport = resolveNavigationViewport({
      intent: immediateIntent,
      policy: immediatePolicy,
      canvasSize,
      sceneBounds,
      currentViewport,
      leftOcclusion: 0,
      minZoom,
      maxZoom,
      getNodeSetBounds: () => null,
    });

    expect(animatedPolicy.durationMs).toBe(DEFAULT_ANIMATION_SETTINGS.viewport.fitDuration);
    expect(immediatePolicy.durationMs).toBe(0);
    expect(immediateViewport).toEqual(animatedViewport);
  });
});
