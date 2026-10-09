export interface CanvasSize {
  width: number;
  height: number;
}

export type GetCurrentCanvasSize = () => CanvasSize | null;

export const measureCanvasElement = (element: HTMLElement | null): CanvasSize | null => {
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  // Camera coordinates belong to the inner world layer, excluding the canvas border.
  const width = element.clientWidth || rect.width;
  const height = element.clientHeight || rect.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    width,
    height,
  };
};
