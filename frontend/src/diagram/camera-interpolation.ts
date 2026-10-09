import type { ViewportState } from '@tarskia/diagram-semantics';

/** Move the world point beneath the canvas centre steadily while zoom changes proportionally. */
export function interpolateCameraViewport({
  from,
  to,
  progress,
  canvas,
  minZoom,
  maxZoom,
}: {
  from: ViewportState;
  to: ViewportState;
  progress: number;
  canvas: { width: number; height: number };
  minZoom: number;
  maxZoom: number;
}): ViewportState {
  const amount = Math.max(0, Math.min(1, progress));
  const clampZoom = (value: number) => Math.max(minZoom, Math.min(maxZoom, value));
  const fromZoom = clampZoom(from.zoom);
  const toZoom = clampZoom(to.zoom);
  if (amount === 0) return { ...from, zoom: fromZoom };
  if (amount === 1) return { ...to, zoom: toZoom };
  const zoom = clampZoom(
    Math.exp(Math.log(fromZoom) + (Math.log(toZoom) - Math.log(fromZoom)) * amount),
  );
  const centre = { x: canvas.width / 2, y: canvas.height / 2 };
  const focusX = (centre.x - from.x) / fromZoom;
  const focusY = (centre.y - from.y) / fromZoom;
  const nextX = focusX + ((centre.x - to.x) / toZoom - focusX) * amount;
  const nextY = focusY + ((centre.y - to.y) / toZoom - focusY) * amount;
  return { x: centre.x - nextX * zoom, y: centre.y - nextY * zoom, zoom };
}
