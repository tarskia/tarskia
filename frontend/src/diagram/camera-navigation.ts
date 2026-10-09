import type { DiagramCamera, ViewportState } from '@tarskia/diagram-semantics';
import {
  ANIMATION_CONSTANTS,
  DEFAULT_VIEWPORT_FIT_PADDING,
} from '../canvas/rendering/transition/animation-constants';
import {
  computeViewportForBoundsInVisibleCanvas,
  computeViewportToKeepRectVisible,
} from '../canvas/viewport-visibility';
import { restoreDiagramCamera } from './camera-framing';
import type { CameraExecutionMode, DiagramCameraRect, NavigationIntent } from './motion-types';

export const DEFAULT_FIT_DURATION_MS = 260;
export const DEFAULT_ENSURE_PADDING = 40;
export const DEFAULT_ENSURE_DURATION_MS = 180;
export const VIEWPORT_EPSILON = 0.0001;

export interface ResolvedNavigationPolicy {
  mode: CameraExecutionMode;
  padding: number | undefined;
  durationMs: number;
  waitForHostGeneration: boolean;
}

export interface ResolveNavigationViewportArgs {
  intent: NavigationIntent;
  policy: ResolvedNavigationPolicy;
  savedCamera?: DiagramCamera;
  scopeRootId?: string;
  canvasSize: { width: number; height: number } | null;
  sceneBounds: DiagramCameraRect | null;
  currentViewport: ViewportState;
  minZoom: number;
  maxZoom: number;
  getNodeSetBounds: (nodeIds: string[]) => DiagramCameraRect | null;
  getAnchorBounds?: (id: string) => DiagramCameraRect | null;
}

export const viewportStatesEqual = (
  left: ViewportState | null | undefined,
  right: ViewportState | null | undefined,
) =>
  Math.abs((left?.x ?? 0) - (right?.x ?? 0)) <= VIEWPORT_EPSILON &&
  Math.abs((left?.y ?? 0) - (right?.y ?? 0)) <= VIEWPORT_EPSILON &&
  Math.abs((left?.zoom ?? 1) - (right?.zoom ?? 1)) <= VIEWPORT_EPSILON;

export const resolveNavigationPolicy = (intent: NavigationIntent): ResolvedNavigationPolicy => {
  const mode = intent.kind === 'initialize-diagram' ? 'immediate' : 'animated';

  let defaultPadding: number | undefined;
  let defaultDurationMs = DEFAULT_FIT_DURATION_MS;
  let defaultWaitForHostGeneration = true;

  switch (intent.kind) {
    case 'initialize-diagram':
      defaultPadding = DEFAULT_VIEWPORT_FIT_PADDING;
      defaultDurationMs = ANIMATION_CONSTANTS.viewport.fitDuration;
      defaultWaitForHostGeneration = false;
      break;
    case 'ensure-visible':
      defaultPadding = DEFAULT_ENSURE_PADDING;
      defaultDurationMs = DEFAULT_ENSURE_DURATION_MS;
      defaultWaitForHostGeneration = false;
      break;
    case 'fit-node-set':
      defaultPadding = DEFAULT_VIEWPORT_FIT_PADDING;
      defaultDurationMs = DEFAULT_FIT_DURATION_MS;
      defaultWaitForHostGeneration = true;
      break;
    case 'fit-scene':
      defaultPadding = DEFAULT_VIEWPORT_FIT_PADDING;
      defaultDurationMs =
        intent.preset === 'layout'
          ? ANIMATION_CONSTANTS.viewport.fitDuration
          : DEFAULT_FIT_DURATION_MS;
      defaultWaitForHostGeneration = true;
      break;
  }

  return {
    mode,
    padding: defaultPadding,
    durationMs: mode === 'immediate' ? 0 : defaultDurationMs,
    waitForHostGeneration:
      mode === 'immediate' ? false : (intent.waitForHostSettle ?? defaultWaitForHostGeneration),
  };
};

const resolveSceneFitViewport = (params: {
  canvasSize: { width: number; height: number } | null;
  sceneBounds: DiagramCameraRect | null;
  padding: number | undefined;
  minZoom: number;
  maxZoom: number;
}): ViewportState | null => {
  const { canvasSize, sceneBounds, padding, minZoom, maxZoom } = params;
  if (!canvasSize || !sceneBounds) {
    return null;
  }
  return computeViewportForBoundsInVisibleCanvas({
    bounds: sceneBounds,
    canvas: canvasSize,
    minZoom,
    maxZoom,
    padding: padding ?? DEFAULT_VIEWPORT_FIT_PADDING,
  });
};

export const resolveNavigationViewport = ({
  intent,
  policy,
  savedCamera,
  scopeRootId,
  canvasSize,
  sceneBounds,
  currentViewport,
  minZoom,
  maxZoom,
  getNodeSetBounds,
  getAnchorBounds,
}: ResolveNavigationViewportArgs): ViewportState | null => {
  switch (intent.kind) {
    case 'initialize-diagram':
      return savedCamera
        ? restoreDiagramCamera({
            camera: savedCamera,
            canvasSize,
            sceneBounds,
            scopeRootId,
            getNodeBounds: getAnchorBounds ?? ((id) => getNodeSetBounds([id])),
            minZoom,
            maxZoom,
          })
        : resolveSceneFitViewport({
            canvasSize,
            sceneBounds,
            padding: policy.padding,
            minZoom,
            maxZoom,
          });
    case 'fit-scene':
      return resolveSceneFitViewport({
        canvasSize,
        sceneBounds,
        padding: policy.padding,
        minZoom,
        maxZoom,
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
        }) ?? null
      );
  }
};
