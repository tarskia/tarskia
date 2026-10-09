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
  if (intent.kind === 'initialize-diagram')
    return { mode: 'immediate', padding: DEFAULT_VIEWPORT_FIT_PADDING, durationMs: 0 };
  if (intent.kind === 'ensure-visible')
    return {
      mode: 'animated',
      padding: DEFAULT_ENSURE_PADDING,
      durationMs: DEFAULT_ENSURE_DURATION_MS,
    };
  return {
    mode: 'animated',
    padding: DEFAULT_VIEWPORT_FIT_PADDING,
    durationMs:
      intent.kind === 'fit-scene' && intent.preset === 'layout'
        ? ANIMATION_CONSTANTS.viewport.fitDuration
        : DEFAULT_FIT_DURATION_MS,
  };
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
  const fit = (bounds: DiagramCameraRect | null) =>
    canvasSize && bounds
      ? computeViewportForBoundsInVisibleCanvas({
          bounds,
          canvas: canvasSize,
          minZoom,
          maxZoom,
          padding: policy.padding ?? DEFAULT_VIEWPORT_FIT_PADDING,
        })
      : null;
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
        : fit(sceneBounds);
    case 'fit-scene':
      return fit(sceneBounds);
    case 'fit-node-set':
      return intent.nodeIds.length ? fit(getNodeSetBounds(intent.nodeIds)) : null;
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
