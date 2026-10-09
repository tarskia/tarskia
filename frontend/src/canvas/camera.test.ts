// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  canvasGestureFilter,
  canvasWheelDelta,
  getViewportForBounds,
  mountCanvasCamera,
} from './camera';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});
const mount = () => {
  const element = document.createElement('div'),
    world = document.createElement('div'),
    grid = document.createElement('div');
  element.append(grid, world);
  document.body.append(element);
  Object.defineProperties(element, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  element.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 810,
    bottom: 620,
    width: 800,
    height: 600,
    toJSON() {},
  });
  const onMove = vi.fn(),
    onMoveEnd = vi.fn();
  return {
    element,
    world,
    grid,
    onMove,
    onMoveEnd,
    ...mountCanvasCamera({ element, world, grid, minZoom: 0.05, maxZoom: 2, onMove, onMoveEnd }),
  };
};
it('updates camera, world and grid synchronously without gesture callbacks', () => {
  const host = mount();
  host.camera.setViewport({ x: 20, y: 30, zoom: 2 });
  expect(host.camera.getViewport()).toEqual({ x: 20, y: 30, zoom: 2 });
  expect(host.world.style.transform).toBe('translate(20px, 30px) scale(2)');
  expect(host.grid.style.backgroundSize).toBe('40px 40px');
  expect(host.camera.screenToWorldPosition({ x: 50, y: 70 })).toEqual({ x: 10, y: 10 });
  expect(host.onMove).not.toHaveBeenCalled();
  expect(host.onMoveEnd).not.toHaveBeenCalled();
  host.destroy();
});
it('retains RF wheel normalization on Mac and other platforms', () => {
  for (const [mode, expected] of [
    [0, -0.2],
    [1, -5],
    [2, -100],
  ]) {
    const event = new WheelEvent('wheel', { deltaY: 100, deltaMode: mode, ctrlKey: true });
    Object.defineProperty(event, 'ctrlKey', { value: true });
    expect(canvasWheelDelta(event, false)).toBe(expected);
    expect(canvasWheelDelta(event, true)).toBe(expected * 10);
  }
});
it('zooms from edge descendants, respects bounds and nowheel, and stops on destroy', async () => {
  vi.useFakeTimers();
  const host = mount();
  const edge = document.createElement('span');
  edge.dataset.relationId = 'relation';
  host.world.append(edge);
  const wheel = (target: HTMLElement, deltaY: number) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY,
      clientX: 410,
      clientY: 320,
    });
    target.dispatchEvent(event);
    return event;
  };
  expect(wheel(edge, -100).defaultPrevented).toBe(true);
  expect(host.camera.getViewport().zoom).toBeCloseTo(2 ** 0.2);
  expect(host.onMove).toHaveBeenCalledTimes(1);
  // Even during d3's open wheel gesture, programmatic moves stay silent.
  host.camera.setViewport({ x: 0, y: 0, zoom: 2 });
  expect(host.onMove).toHaveBeenCalledTimes(1);
  expect(wheel(edge, -100).defaultPrevented).toBe(true);
  expect(host.camera.getViewport().zoom).toBe(2);
  edge.className = 'nowheel';
  const count = host.onMove.mock.calls.length;
  expect(wheel(edge, 100).defaultPrevented).toBe(false);
  expect(host.onMove).toHaveBeenCalledTimes(count);
  host.destroy();
  edge.className = '';
  wheel(edge, 100);
  await vi.runAllTimersAsync();
  expect(host.onMove).toHaveBeenCalledTimes(count);
  expect(host.onMoveEnd).not.toHaveBeenCalled();
});
it('preserves left/middle drag, ctrl/right filtering and nopan exceptions', () => {
  const host = mount();
  const node = document.createElement('div');
  node.className = 'canvas-node nopan';
  host.world.append(node);
  const accepted: boolean[] = [];
  node.addEventListener('mousedown', (event) => accepted.push(canvasGestureFilter(event)));
  for (const button of [0, 1, 2]) node.dispatchEvent(new MouseEvent('mousedown', { button }));
  expect(accepted).toEqual([false, true, false]);
  expect(canvasGestureFilter(new MouseEvent('mousedown', { ctrlKey: true }))).toBe(false);
  expect(canvasGestureFilter(new MouseEvent('mousedown'), true)).toBe(false);
  host.destroy();
});
it('matches the existing framing padding and clamp arithmetic', () => {
  expect(
    getViewportForBounds({ x: 100, y: 200, width: 400, height: 200 }, 800, 600, 0.05, 2, 0.25),
  ).toEqual({ x: -80, y: -180, zoom: 1.6 });
});

it('pans with native mouse events and reports one settled gesture', async () => {
  vi.useFakeTimers();
  const host = mount();
  host.element.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 100,
      clientY: 100,
      view: window,
    }),
  );
  window.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      buttons: 1,
      clientX: 140,
      clientY: 125,
      view: window,
    }),
  );
  expect(host.camera.getViewport()).toEqual({ x: 40, y: 25, zoom: 1 });
  expect(host.onMove).toHaveBeenCalledTimes(1);
  window.dispatchEvent(
    new MouseEvent('mouseup', { bubbles: true, clientX: 140, clientY: 125, view: window }),
  );
  await vi.runAllTimersAsync();
  expect(host.onMoveEnd).toHaveBeenCalledExactlyOnceWith(expect.any(MouseEvent), {
    x: 40,
    y: 25,
    zoom: 1,
  });
  host.destroy();
});

it('settles an out-and-back drag but ignores an untouched click', async () => {
  vi.useFakeTimers();
  const host = mount();
  const mouse = (type: string, x: number, y: number) =>
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
      clientX: x,
      clientY: y,
      view: window,
    });
  host.element.dispatchEvent(mouse('mousedown', 100, 100));
  window.dispatchEvent(mouse('mousemove', 140, 125));
  window.dispatchEvent(mouse('mousemove', 100, 100));
  window.dispatchEvent(mouse('mouseup', 100, 100));
  await vi.runAllTimersAsync();
  expect(host.onMove).toHaveBeenCalledTimes(2);
  expect(host.camera.getViewport()).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(host.onMoveEnd).toHaveBeenCalledExactlyOnceWith(expect.any(MouseEvent), {
    x: 0,
    y: 0,
    zoom: 1,
  });
  host.element.dispatchEvent(mouse('mousedown', 100, 100));
  window.dispatchEvent(mouse('mouseup', 100, 100));
  await vi.runAllTimersAsync();
  expect(host.onMoveEnd).toHaveBeenCalledTimes(1);
  host.destroy();
});

it('Shift suppresses drag initiation while preserving wheel and double-click zoom', () => {
  expect(canvasGestureFilter(new MouseEvent('mousedown', { shiftKey: true }), true)).toBe(false);
  expect(canvasGestureFilter(new TouchEvent('touchstart', { shiftKey: true }), true)).toBe(false);
  expect(canvasGestureFilter(new WheelEvent('wheel', { shiftKey: true }), true)).toBe(true);
  expect(canvasGestureFilter(new MouseEvent('dblclick', { shiftKey: true }), true)).toBe(true);
});

it('projects from the inner border origin used by d3 pointer coordinates', () => {
  const host = mount();
  Object.defineProperties(host.element, { clientLeft: { value: 1 }, clientTop: { value: 2 } });
  host.camera.setViewport({ x: 20, y: 30, zoom: 2 });
  expect(host.camera.screenToWorldPosition({ x: 51, y: 72 })).toEqual({ x: 10, y: 10 });
  host.destroy();
});
