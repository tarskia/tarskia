import {
  type AnimationSettings,
  DEFAULT_VIEWPORT_FIT_PADDING,
} from '../canvas/rendering/transition/animation-constants';
import {
  computeViewportForBoundsInVisibleCanvas,
  computeViewportToKeepRectVisible,
} from '../canvas/viewport-visibility';
import type { ViewportState } from '../model/types';
import type {
  CameraExecutionMode,
  DiagramCameraPolicy,
  DiagramCameraRect,
  NavigationIntent,
} from './motion-types';

export const DEFAULT_FIT_DURATION_MS = 260;
export const DEFAULT_ENSURE_PADDING = 40;
export const DEFAULT_ENSURE_DURATION_MS = 180;
export const VIEWPORT_EPSILON = 0.0001;

export interface ResolvedNavigationPolicy {
  mode: CameraExecutionMode;
  padding: number | undefined;
  durationMs: number;
  persist: boolean;
  waitForHostGeneration: boolean;
}

export interface ResolveNavigationViewportArgs {
  intent: NavigationIntent;
  policy: ResolvedNavigationPolicy;
  savedViewport?: ViewportState;
  canvasSize: { width: number; height: number } | null;
  sceneBounds: DiagramCameraRect | null;
  currentViewport: ViewportState;
  leftOcclusion: number;
  minZoom: number;
  maxZoom: number;
  getNodeSetBounds: (nodeIds: string[]) => DiagramCameraRect | null;
}

export const viewportStatesEqual = (
  left: ViewportState | null | undefined,
  right: ViewportState | null | undefined,
) =>
  Math.abs((left?.x ?? 0) - (right?.x ?? 0)) <= VIEWPORT_EPSILON &&
  Math.abs((left?.y ?? 0) - (right?.y ?? 0)) <= VIEWPORT_EPSILON &&
  Math.abs((left?.zoom ?? 1) - (right?.zoom ?? 1)) <= VIEWPORT_EPSILON;

export const resolveNavigationPolicy = (
  intent: NavigationIntent,
  animationSettings: AnimationSettings,
  cameraPolicy?: DiagramCameraPolicy,
): ResolvedNavigationPolicy => {
  const intentPadding = 'padding' in intent ? intent.padding : undefined;
  const mode =
    intent.mode ??
    (intent.kind === 'initialize-diagram'
      ? (cameraPolicy?.openingMode ?? 'immediate')
      : undefined) ??
    'animated';

  let defaultPadding: number | undefined;
  let defaultDurationMs = DEFAULT_FIT_DURATION_MS;
  let defaultPersist = true;
  let defaultWaitForHostGeneration = true;

  switch (intent.kind) {
    case 'initialize-diagram':
      defaultPadding = DEFAULT_VIEWPORT_FIT_PADDING;
      defaultDurationMs = animationSettings.viewport.fitDuration;
      defaultPersist = true;
      defaultWaitForHostGeneration = false;
      break;
    case 'restore-saved':
      defaultPadding = undefined;
      defaultDurationMs = 0;
      defaultPersist = false;
      defaultWaitForHostGeneration = true;
      break;
    case 'ensure-visible':
      defaultPadding = intent.padding ?? DEFAULT_ENSURE_PADDING;
      defaultDurationMs = DEFAULT_ENSURE_DURATION_MS;
      defaultPersist = true;
      defaultWaitForHostGeneration = false;
      break;
    case 'fit-rect':
    case 'fit-node-set':
      defaultPadding = DEFAULT_VIEWPORT_FIT_PADDING;
      defaultDurationMs = DEFAULT_FIT_DURATION_MS;
      defaultPersist = true;
      defaultWaitForHostGeneration = true;
      break;
    case 'fit-scene':
      defaultPadding = DEFAULT_VIEWPORT_FIT_PADDING;
      defaultDurationMs =
        intent.preset === 'layout'
          ? animationSettings.viewport.fitDuration
          : DEFAULT_FIT_DURATION_MS;
      defaultPersist = true;
      defaultWaitForHostGeneration = true;
      break;
  }

  return {
    mode,
    padding: intentPadding ?? defaultPadding,
    durationMs: mode === 'immediate' ? 0 : Math.max(0, intent.duration ?? defaultDurationMs),
    persist: intent.persist ?? defaultPersist,
    waitForHostGeneration:
      mode === 'immediate' ? false : (intent.waitForHostSettle ?? defaultWaitForHostGeneration),
  };
};

const resolveRestoreSavedViewport = (params: {
  savedViewport?: ViewportState;
  canvasSize: { width: number; height: number } | null;
  sceneBounds: DiagramCameraRect | null;
  padding: number | undefined;
  leftOcclusion: number;
  minZoom: number;
  maxZoom: number;
}): ViewportState | null => {
  const { savedViewport, canvasSize, sceneBounds, padding, leftOcclusion, minZoom, maxZoom } =
    params;
  if (!savedViewport) {
    return null;
  }
  if (!canvasSize || !sceneBounds) {
    return savedViewport;
  }
  const fittedViewport = computeViewportForBoundsInVisibleCanvas({
    bounds: sceneBounds,
    canvas: canvasSize,
    minZoom,
    maxZoom,
    padding: padding ?? DEFAULT_VIEWPORT_FIT_PADDING,
    leftOcclusion,
  });
  if (
    savedViewport.zoom <= minZoom + VIEWPORT_EPSILON &&
    fittedViewport.zoom > savedViewport.zoom + VIEWPORT_EPSILON
  ) {
    return fittedViewport;
  }
  return (
    computeViewportToKeepRectVisible({
      viewport: savedViewport,
      canvas: canvasSize,
      rect: sceneBounds,
      padding: DEFAULT_ENSURE_PADDING,
      leftOcclusion,
    }) ?? savedViewport
  );
};

const resolveSceneFitViewport = (params: {
  canvasSize: { width: number; height: number } | null;
  sceneBounds: DiagramCameraRect | null;
  padding: number | undefined;
  leftOcclusion: number;
  minZoom: number;
  maxZoom: number;
}): ViewportState | null => {
  const { canvasSize, sceneBounds, padding, leftOcclusion, minZoom, maxZoom } = params;
  if (!canvasSize || !sceneBounds) {
    return null;
  }
  return computeViewportForBoundsInVisibleCanvas({
    bounds: sceneBounds,
    canvas: canvasSize,
    minZoom,
    maxZoom,
    padding: padding ?? DEFAULT_VIEWPORT_FIT_PADDING,
    leftOcclusion,
  });
};

export const resolveNavigationViewport = ({
  intent,
  policy,
  savedViewport,
  canvasSize,
  sceneBounds,
  currentViewport,
  leftOcclusion,
  minZoom,
  maxZoom,
  getNodeSetBounds,
}: ResolveNavigationViewportArgs): ViewportState | null => {
  switch (intent.kind) {
    case 'initialize-diagram':
      return savedViewport
        ? resolveRestoreSavedViewport({
            savedViewport,
            canvasSize,
            sceneBounds,
            padding: policy.padding,
            leftOcclusion,
            minZoom,
            maxZoom,
          })
        : resolveSceneFitViewport({
            canvasSize,
            sceneBounds,
            padding: policy.padding,
            leftOcclusion,
            minZoom,
            maxZoom,
          });
    case 'restore-saved':
      return resolveRestoreSavedViewport({
        savedViewport,
        canvasSize,
        sceneBounds,
        padding: policy.padding,
        leftOcclusion,
        minZoom,
        maxZoom,
      });
    case 'fit-scene':
      return resolveSceneFitViewport({
        canvasSize,
        sceneBounds,
        padding: policy.padding,
        leftOcclusion,
        minZoom,
        maxZoom,
      });
    case 'fit-rect':
      if (!canvasSize) {
        return null;
      }
      return computeViewportForBoundsInVisibleCanvas({
        bounds: intent.rect,
        canvas: canvasSize,
        minZoom,
        maxZoom,
        padding: policy.padding ?? DEFAULT_VIEWPORT_FIT_PADDING,
        leftOcclusion,
      });
    case 'fit-node-set': {
      if (!canvasSize || intent.nodeIds.length === 0) {
        return null;
      }
      const bounds = getNodeSetBounds(intent.nodeIds);
      if (!bounds) {
        return null;
      }
      return computeViewportForBoundsInVisibleCanvas({
        bounds,
        canvas: canvasSize,
        minZoom,
        maxZoom,
        padding: policy.padding ?? DEFAULT_VIEWPORT_FIT_PADDING,
        leftOcclusion,
      });
    }
    case 'ensure-visible':
      if (!canvasSize) {
        return null;
      }
      return (
        computeViewportToKeepRectVisible({
          viewport: currentViewport,
          canvas: canvasSize,
          rect: intent.rect,
          padding: policy.padding ?? DEFAULT_ENSURE_PADDING,
          leftOcclusion,
        }) ?? null
      );
  }
};
