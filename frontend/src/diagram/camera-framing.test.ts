import { describe, expect, it } from 'vitest';
import { captureDiagramCamera, restoreDiagramCamera } from './camera-framing';

const canvasSize = { width: 1440, height: 900 };
const viewport = { x: -100, y: -200, zoom: 2 };
const nodes = [
  { id: 'parent', rect: { x: 0, y: 0, width: 1000, height: 1000 } },
  { id: 'child', parentId: 'parent', rect: { x: 300, y: 200, width: 300, height: 300 } },
];
const capture = () => captureDiagramCamera({ viewport, canvasSize, nodes })!;
const restore = (size = canvasSize, offset = { x: 0, y: 0 }) =>
  restoreDiagramCamera({
    camera: capture(),
    canvasSize: size,
    sceneBounds: nodes[0].rect,
    minZoom: 0.01,
    maxZoom: 10,
    getNodeBounds: (id) => {
      const node = nodes.find((n) => n.id === id);
      return node ? { ...node.rect, x: node.rect.x + offset.x, y: node.rect.y + offset.y } : null;
    },
  })!;

describe('screen-independent saved camera framing', () => {
  it('anchors to the deepest visible containing entity', () => {
    expect(capture()).toEqual({
      anchorId: 'child',
      rect: { x: -250, y: -100, width: 720, height: 450 },
    });
  });
  it.each([
    { width: 390, height: 844 },
    canvasSize,
    { width: 2560, height: 1440 },
    { width: 1440 - 420, height: 900 },
  ])('fits the entire saved world rect centred in $width x $height', (size) => {
    const result = restore(size);
    const left = -result.x / result.zoom,
      top = -result.y / result.zoom;
    const right = left + size.width / result.zoom,
      bottom = top + size.height / result.zoom;
    expect(left).toBeLessThanOrEqual(50 + 1e-8);
    expect(right).toBeGreaterThanOrEqual(770 - 1e-8);
    expect(top).toBeLessThanOrEqual(100 + 1e-8);
    expect(bottom).toBeGreaterThanOrEqual(550 - 1e-8);
    expect((left + right) / 2).toBeCloseTo(410);
    expect((top + bottom) / 2).toBeCloseTo(325);
  });
  it('follows the anchor after layout moves', () => {
    const before = restore(),
      after = restore(canvasSize, { x: 800, y: -400 });
    expect(after.zoom).toBe(before.zoom);
    expect(after.x).toBe(before.x - 800 * before.zoom);
    expect(after.y).toBe(before.y + 400 * before.zoom);
  });
  it('falls back to the scope box, then the scene, when an anchor disappears', () => {
    const scope = { x: 100, y: 200, width: 200, height: 100 };
    const scene = { x: 0, y: 0, width: 720, height: 450 };
    const params = {
      camera: { ...capture(), anchorId: 'missing' },
      canvasSize,
      sceneBounds: scene,
      minZoom: 0.01,
      maxZoom: 10,
    };
    expect(
      restoreDiagramCamera({
        ...params,
        scopeRootId: 'scope',
        getNodeBounds: (id) => (id === 'scope' ? scope : null),
      }),
    ).toEqual({ x: -720, y: -1350, zoom: 7.2 });
    expect(restoreDiagramCamera({ ...params, getNodeBounds: () => null })).toEqual({
      x: 0,
      y: 0,
      zoom: 2,
    });
  });
  it('captures empty-space views with scope fallback or absolute world coordinates', () => {
    expect(
      captureDiagramCamera({
        viewport,
        canvasSize,
        nodes: [],
        scopeRootId: 'scope',
        scopeRootBounds: { x: 100, y: 100, width: 500, height: 500 },
      }),
    ).toEqual({ anchorId: 'scope', rect: { x: -50, y: 0, width: 720, height: 450 } });
    expect(captureDiagramCamera({ viewport, canvasSize, nodes: [] })).toEqual({
      rect: { x: 50, y: 100, width: 720, height: 450 },
    });
  });
  it('clamps zoom and waits for a measurable canvas', () => {
    expect(
      restoreDiagramCamera({
        camera: capture(),
        canvasSize: null,
        sceneBounds: null,
        minZoom: 0.1,
        maxZoom: 1,
        getNodeBounds: () => null,
      }),
    ).toBeNull();
    expect(
      restoreDiagramCamera({
        camera: { rect: { x: 0, y: 0, width: 10, height: 10 } },
        canvasSize,
        sceneBounds: null,
        minZoom: 0.1,
        maxZoom: 1,
        getNodeBounds: () => null,
      })?.zoom,
    ).toBe(1);
  });
});
