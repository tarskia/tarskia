import { useCallback, useRef } from 'react';
import type { ReactFlowInstance } from 'reactflow';

interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

export function useCanvasViewportAdapter() {
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);
  const leftOcclusionRef = useRef(0);

  const onCanvasInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowRef.current = instance;
  }, []);

  const onCanvasUnmount = useCallback(() => {
    reactFlowRef.current = null;
  }, []);

  const setLeftOcclusion = useCallback((leftOcclusion: number) => {
    leftOcclusionRef.current = Math.max(0, leftOcclusion);
  }, []);

  const getCurrentViewport = useCallback((): ViewportState => {
    const live = reactFlowRef.current?.getViewport();
    if (live) return live;
    return { x: 0, y: 0, zoom: 1 };
  }, []);

  const getLeftOcclusion = useCallback(() => leftOcclusionRef.current, []);

  const setViewport = useCallback((viewport: ViewportState) => {
    reactFlowRef.current?.setViewport(viewport, { duration: 0 });
  }, []);

  const screenToWorldPosition = useCallback((point: ScreenPoint): ScreenPoint => {
    const projected = reactFlowRef.current?.screenToFlowPosition(point);
    if (projected) {
      return projected;
    }
    return point;
  }, []);

  return {
    onCanvasInit,
    onCanvasUnmount,
    setLeftOcclusion,
    getCurrentViewport,
    getLeftOcclusion,
    setViewport,
    screenToWorldPosition,
  };
}
