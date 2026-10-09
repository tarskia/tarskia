import type { DiagramCamera, ViewportState } from '@tarskia/diagram-semantics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveNavigationPolicy, resolveNavigationViewport } from './camera-navigation';
import type { CanvasSize, GetCurrentCanvasSize } from './canvas-size';
import type { DiagramCameraRect, NavigationIntent, NavigationRequestResult } from './motion-types';

const MIN_BOOTSTRAP_CANVAS_LENGTH = 32;

export const isBootstrapCanvasSizeUsable = (canvasSize: CanvasSize | null) =>
  Boolean(
    canvasSize &&
      canvasSize.width >= MIN_BOOTSTRAP_CANVAS_LENGTH &&
      canvasSize.height >= MIN_BOOTSTRAP_CANVAS_LENGTH,
  );

interface UseCanvasBootstrapControllerArgs {
  initialViewportKey?: string;
  savedCamera?: DiagramCamera;
  scopeRootId?: string;
  getCurrentCanvasSize: GetCurrentCanvasSize;
  canvasLayoutVersion: number;
  sceneBounds: DiagramCameraRect | null;
  getNodeSetBounds: (ids: string[]) => DiagramCameraRect | null;
  minZoom: number;
  maxZoom: number;
  canvasReady: boolean;
  requestNavigation: (intent: NavigationIntent) => NavigationRequestResult;
}

export interface CanvasBootstrapControllerResult {
  defaultViewport?: ViewportState;
  initialViewportPending: boolean;
}

export type PendingBootstrapAction = 'idle' | 'wait' | 'request-navigation';

export const resolvePendingBootstrapAction = (params: {
  initialViewportKey?: string;
  pendingKey?: string;
  hasUsableCanvas: boolean;
  defaultViewport?: ViewportState;
  canvasReady: boolean;
}): PendingBootstrapAction => {
  const { initialViewportKey, pendingKey, hasUsableCanvas, defaultViewport, canvasReady } = params;
  if (!initialViewportKey || pendingKey !== initialViewportKey) {
    return 'idle';
  }
  if (!hasUsableCanvas || !defaultViewport || !canvasReady) {
    return 'wait';
  }
  return 'request-navigation';
};

export function useCanvasBootstrapController({
  initialViewportKey,
  savedCamera,
  scopeRootId,
  getNodeSetBounds,
  getCurrentCanvasSize,
  canvasLayoutVersion,
  sceneBounds,
  minZoom,
  maxZoom,
  canvasReady,
  requestNavigation,
}: UseCanvasBootstrapControllerArgs): CanvasBootstrapControllerResult {
  const [pendingKey, setPendingKey] = useState<string | undefined>(initialViewportKey);
  const lastObservedKeyRef = useRef<string | undefined>(initialViewportKey);
  const lastDefaultViewportRef = useRef<ViewportState | undefined>(undefined);
  const initializeIntent = useMemo<NavigationIntent>(
    () => ({
      kind: 'initialize-diagram',
      waitForHostSettle: false,
    }),
    [],
  );
  const initializePolicy = useMemo(
    () => resolveNavigationPolicy(initializeIntent),
    [initializeIntent],
  );
  const defaultViewport = useMemo(() => {
    if (!initialViewportKey || pendingKey !== initialViewportKey) {
      return lastDefaultViewportRef.current;
    }
    // ResizeObserver only signals that layout changed; the getter reads the actual size here.
    void canvasLayoutVersion;
    const canvasSize = getCurrentCanvasSize();
    const usableCanvasSize = isBootstrapCanvasSizeUsable(canvasSize) ? canvasSize : null;
    const viewport =
      resolveNavigationViewport({
        intent: initializeIntent,
        policy: {
          ...initializePolicy,
        },
        savedCamera,
        scopeRootId,
        getNodeSetBounds,
        canvasSize: usableCanvasSize,
        sceneBounds,
        currentViewport: { x: 0, y: 0, zoom: 1 },
        minZoom,
        maxZoom,
      }) ?? undefined;
    lastDefaultViewportRef.current = viewport;
    return viewport;
  }, [
    initialViewportKey,
    pendingKey,
    canvasLayoutVersion,
    getCurrentCanvasSize,

    initializeIntent,
    initializePolicy,
    maxZoom,
    minZoom,
    savedCamera,
    scopeRootId,
    getNodeSetBounds,
    sceneBounds,
  ]);

  useEffect(() => {
    if (lastObservedKeyRef.current === initialViewportKey) {
      return;
    }
    lastObservedKeyRef.current = initialViewportKey;
    setPendingKey(initialViewportKey);
  }, [initialViewportKey]);

  useEffect(() => {
    if (!initialViewportKey || pendingKey !== initialViewportKey) {
      return;
    }
    // Re-run pending bootstrap when the canvas reports a new layout version.
    void canvasLayoutVersion;
    const action = resolvePendingBootstrapAction({
      initialViewportKey,
      pendingKey,
      hasUsableCanvas: isBootstrapCanvasSizeUsable(getCurrentCanvasSize()),
      defaultViewport,
      canvasReady,
    });
    if (action !== 'request-navigation') {
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
  ]);

  return {
    defaultViewport,
    initialViewportPending: initialViewportKey !== undefined && pendingKey === initialViewportKey,
  };
}
