import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnimationSettings } from '../canvas/rendering/transition/animation-constants';
import type { ViewportState } from '../model/types';
import { resolveNavigationPolicy, resolveNavigationViewport } from './camera-navigation';
import type { CanvasSize, GetCurrentCanvasSize } from './canvas-size';
import type {
  DiagramCameraPolicy,
  DiagramCameraRect,
  NavigationIntent,
  NavigationRequestResult,
} from './motion-types';

const MIN_BOOTSTRAP_CANVAS_LENGTH = 32;

export const isBootstrapCanvasSizeUsable = (canvasSize: CanvasSize | null) =>
  Boolean(
    canvasSize &&
      canvasSize.width >= MIN_BOOTSTRAP_CANVAS_LENGTH &&
      canvasSize.height >= MIN_BOOTSTRAP_CANVAS_LENGTH,
  );

interface UseCanvasBootstrapControllerArgs {
  initialViewportKey?: string;
  savedViewport?: ViewportState;
  getCurrentCanvasSize: GetCurrentCanvasSize;
  canvasLayoutVersion: number;
  sceneBounds: DiagramCameraRect | null;
  minZoom: number;
  maxZoom: number;
  animationSettings: AnimationSettings;
  cameraPolicy?: DiagramCameraPolicy;
  getLeftOcclusion: () => number;
  canvasReady: boolean;
  requestNavigation: (intent: NavigationIntent) => NavigationRequestResult;
}

export interface CanvasBootstrapControllerResult {
  defaultViewport?: ViewportState;
  initialViewportPending: boolean;
}

export function useCanvasBootstrapController({
  initialViewportKey,
  savedViewport,
  getCurrentCanvasSize,
  canvasLayoutVersion,
  sceneBounds,
  minZoom,
  maxZoom,
  animationSettings,
  cameraPolicy,
  getLeftOcclusion,
  canvasReady,
  requestNavigation,
}: UseCanvasBootstrapControllerArgs): CanvasBootstrapControllerResult {
  const initializeIntent = useMemo<NavigationIntent>(
    () => ({
      kind: 'initialize-diagram',
      mode: cameraPolicy?.openingMode,
      persist: true,
      waitForHostSettle: false,
    }),
    [cameraPolicy?.openingMode],
  );
  const initializePolicy = useMemo(
    () => resolveNavigationPolicy(initializeIntent, animationSettings, cameraPolicy),
    [animationSettings, cameraPolicy, initializeIntent],
  );
  const defaultViewport = useMemo(() => {
    // ResizeObserver only signals that layout changed; the getter reads the actual size here.
    void canvasLayoutVersion;
    const canvasSize = getCurrentCanvasSize();
    const usableCanvasSize = isBootstrapCanvasSizeUsable(canvasSize) ? canvasSize : null;
    const leftOcclusion = getLeftOcclusion();
    return (
      resolveNavigationViewport({
        intent: initializeIntent,
        policy: {
          ...initializePolicy,
          persist: false,
        },
        savedViewport,
        canvasSize: usableCanvasSize,
        sceneBounds,
        currentViewport: savedViewport ?? { x: 0, y: 0, zoom: 1 },
        leftOcclusion,
        minZoom,
        maxZoom,
        getNodeSetBounds: () => null,
      }) ?? undefined
    );
  }, [
    canvasLayoutVersion,
    getCurrentCanvasSize,
    getLeftOcclusion,
    initializeIntent,
    initializePolicy,
    maxZoom,
    minZoom,
    savedViewport,
    sceneBounds,
  ]);
  const [pendingKey, setPendingKey] = useState<string | undefined>(initialViewportKey);
  const lastObservedKeyRef = useRef<string | undefined>(initialViewportKey);

  useEffect(() => {
    if (lastObservedKeyRef.current === initialViewportKey) {
      return;
    }
    lastObservedKeyRef.current = initialViewportKey;
    setPendingKey(initialViewportKey);
  }, [initialViewportKey]);

  useEffect(() => {
    // Re-run pending bootstrap when the canvas reports a new layout version.
    void canvasLayoutVersion;
    if (!initialViewportKey || pendingKey !== initialViewportKey) {
      return;
    }
    if (!isBootstrapCanvasSizeUsable(getCurrentCanvasSize())) {
      return;
    }
    if (!defaultViewport) {
      if (!savedViewport && !sceneBounds) {
        setPendingKey((current) => (current === initialViewportKey ? undefined : current));
      }
      return;
    }
    if (!canvasReady) {
      return;
    }
    requestNavigation(initializeIntent);
    setPendingKey((current) => (current === initialViewportKey ? undefined : current));
  }, [
    canvasReady,
    canvasLayoutVersion,
    defaultViewport,
    getCurrentCanvasSize,
    initialViewportKey,
    initializeIntent,
    pendingKey,
    requestNavigation,
    savedViewport,
    sceneBounds,
  ]);

  return {
    defaultViewport,
    initialViewportPending: initialViewportKey !== undefined && pendingKey === initialViewportKey,
  };
}
