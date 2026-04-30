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
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  return {
    width: rect.width,
    height: rect.height,
  };
};
