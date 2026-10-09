import { expect, it } from 'vitest';
import { measureCanvasElement } from './canvas-size';

it('measures the inner camera viewport rather than its surrounding border', () => {
  const canvas = {
    clientWidth: 1000,
    clientHeight: 600,
    getBoundingClientRect: () => ({ width: 1002, height: 602 }),
  } as HTMLElement;
  expect(measureCanvasElement(canvas)).toEqual({ width: 1000, height: 600 });
});

it('falls back to measurable bounds when client dimensions are unavailable', () => {
  const canvas = {
    clientWidth: 0,
    clientHeight: 0,
    getBoundingClientRect: () => ({ width: 1000, height: 600 }),
  } as HTMLElement;
  expect(measureCanvasElement(canvas)).toEqual({ width: 1000, height: 600 });
});

it('ignores a missing or unmeasurable canvas', () => {
  expect(measureCanvasElement(null)).toBeNull();
  expect(
    measureCanvasElement({
      clientWidth: 0,
      clientHeight: 0,
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
    } as HTMLElement),
  ).toBeNull();
});
