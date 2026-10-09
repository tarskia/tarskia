import 'd3-transition';
import { select } from 'd3-selection';
import { type D3ZoomEvent, zoom, zoomIdentity } from 'd3-zoom';

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}
export interface CanvasPoint {
  x: number;
  y: number;
}
export interface CanvasCamera {
  getViewport(): CanvasViewport;
  setViewport(viewport: CanvasViewport): void;
  screenToWorldPosition(point: CanvasPoint): CanvasPoint;
}

/** React Flow 11's wheel speed, including its platform-specific pinch multiplier. */
export const canvasWheelDelta = (event: WheelEvent, isMac = navigator.userAgent.includes('Mac')) =>
  -event.deltaY *
  (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) *
  (event.ctrlKey && isMac ? 10 : 1);

const closest = (event: Event, selector: string) =>
  event.target instanceof Element && Boolean(event.target.closest(selector));

export const canvasGestureFilter = (
  event: MouseEvent | TouchEvent | WheelEvent,
  shiftPressed = false,
) => {
  const button = 'button' in event ? event.button : 0;
  if (
    !shiftPressed &&
    button === 1 &&
    event.type === 'mousedown' &&
    closest(event, '.canvas-node, [data-entity-id], [data-relation-id]')
  )
    return true;
  if (shiftPressed && (event.type === 'mousedown' || event.type === 'touchstart')) return false;
  if (event.type === 'wheel' && closest(event, '.nowheel')) return false;
  if (event.type !== 'wheel' && closest(event, '.nopan')) return false;
  return (!event.ctrlKey || event.type === 'wheel') && button <= 1;
};

export const getViewportForBounds = (
  bounds: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  minZoom: number,
  maxZoom: number,
  padding = 0.1,
): CanvasViewport => {
  const scale = Math.max(
    minZoom,
    Math.min(
      maxZoom,
      width / (bounds.width * (1 + padding)),
      height / (bounds.height * (1 + padding)),
    ),
  );
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: height / 2 - (bounds.y + bounds.height / 2) * scale,
    zoom: scale,
  };
};

export function mountCanvasCamera({
  element,
  world,
  grid,
  defaultViewport = { x: 0, y: 0, zoom: 1 },
  minZoom,
  maxZoom,
  onMove,
  onMoveEnd,
}: {
  element: HTMLElement;
  world: HTMLElement;
  grid: HTMLElement;
  defaultViewport?: CanvasViewport;
  minZoom: number;
  maxZoom: number;
  onMove: (event: Event | null, viewport: CanvasViewport) => void;
  onMoveEnd: (event: Event | null, viewport: CanvasViewport) => void;
}): { camera: CanvasCamera; destroy(): void } {
  let viewport = {
    ...defaultViewport,
    zoom: Math.max(minZoom, Math.min(maxZoom, defaultViewport.zoom)),
  };
  let destroyed = false;
  let programmatic = false;
  let shiftPressed = false;
  let deliveredUserMove = false;
  let mouseWindow: Window | null = null;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  const selection = select(element);
  const write = (next: CanvasViewport) => {
    viewport = { ...next };
    world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
    world.style.transformOrigin = '0 0';
    grid.style.backgroundPosition = `${next.x}px ${next.y}px`;
    grid.style.backgroundSize = `${20 * next.zoom}px ${20 * next.zoom}px`;
    grid.style.setProperty('--canvas-grid-dot-size', `${1.2 * next.zoom}px`);
  };
  const behavior = zoom<HTMLElement, unknown>()
    .scaleExtent([minZoom, maxZoom])
    .wheelDelta((event: WheelEvent) => canvasWheelDelta(event))
    .filter((event: MouseEvent | TouchEvent | WheelEvent) =>
      canvasGestureFilter(event, shiftPressed),
    )
    .on('start.canvas', (event: D3ZoomEvent<HTMLElement, unknown>) => {
      if (!event.sourceEvent || destroyed || programmatic) return;
      deliveredUserMove = false;
      if (event.sourceEvent.type === 'mousedown') mouseWindow = event.sourceEvent.view;
    })
    .on('zoom.canvas', (event: D3ZoomEvent<HTMLElement, unknown>) => {
      if (destroyed) return;
      write({ x: event.transform.x, y: event.transform.y, zoom: event.transform.k });
      if (event.sourceEvent && !programmatic) {
        deliveredUserMove = true;
        onMove(event.sourceEvent, { ...viewport });
      }
    })
    .on('end.canvas', (event: D3ZoomEvent<HTMLElement, unknown>) => {
      if (!event.sourceEvent || destroyed || programmatic) return;
      mouseWindow = null;
      if (!deliveredUserMove) return;
      deliveredUserMove = false;
      clearTimeout(endTimer);
      const settled = { ...viewport };
      endTimer = setTimeout(() => {
        if (!destroyed) onMoveEnd(event.sourceEvent, settled);
      }, 0);
    });
  selection.call(behavior);
  // RF prevents page scrolling even when d3 has reached its zoom limits.
  const d3Wheel = selection.on('wheel.zoom');
  selection.on(
    'wheel.zoom',
    function (event: WheelEvent) {
      if (closest(event, '.nowheel')) return;
      event.preventDefault();
      d3Wheel?.call(this, event, undefined);
    },
    { passive: false },
  );
  const keydown = (event: KeyboardEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    if (event.key === 'Shift') shiftPressed = true;
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.key === 'Shift') shiftPressed = false;
  };
  const blur = () => {
    shiftPressed = false;
  };
  const ownerWindow = element.ownerDocument.defaultView;
  ownerWindow?.addEventListener('keydown', keydown);
  ownerWindow?.addEventListener('keyup', keyup);
  ownerWindow?.addEventListener('blur', blur);
  const camera: CanvasCamera = {
    getViewport: () => ({ ...viewport }),
    setViewport: (next) => {
      if (destroyed) return;
      programmatic = true;
      try {
        selection.interrupt();
        // Calling transform on the selection (not a transition) is synchronous.
        selection.call(behavior.transform, zoomIdentity.translate(next.x, next.y).scale(next.zoom));
      } finally {
        programmatic = false;
      }
    },
    screenToWorldPosition: (point) => {
      const rect = element.getBoundingClientRect();
      return {
        x: (point.x - rect.left - element.clientLeft - viewport.x) / viewport.zoom,
        y: (point.y - rect.top - element.clientTop - viewport.y) / viewport.zoom,
      };
    },
  };
  camera.setViewport(viewport);
  return {
    camera,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(endTimer);
      behavior.on('.canvas', null);
      selection.interrupt().on('.zoom', null);
      // d3 installs drag listeners on the window until mouseup; release them on unmount.
      if (mouseWindow) {
        select(mouseWindow).on('mousemove.zoom mouseup.zoom', null);
        select(mouseWindow).on('dragstart.drag selectstart.drag', null);
        const root = mouseWindow.document.documentElement as HTMLElement & { __noselect?: string };
        if ('__noselect' in root) {
          root.style.setProperty('-moz-user-select', root.__noselect ?? '');
          delete root.__noselect;
        }
      }
      ownerWindow?.removeEventListener('keydown', keydown);
      ownerWindow?.removeEventListener('keyup', keyup);
      ownerWindow?.removeEventListener('blur', blur);
    },
  };
}
