import { indexTree, type SemanticDocument } from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import type { StructuralChoreographyRequest } from '../../../diagram/motion-types';
import { computeViewportForBoundsInVisibleCanvas } from '../../viewport-visibility';
import type { LayoutResult } from '../layout/layout-pipeline';
import type { LayoutNode, LayoutTree } from '../layout/tree-traverser';
import type { CanvasRenderSnapshot } from '../presentation/presentation';
import { buildAbsolutePositions } from '../scene/scene';
import { DEFAULT_VIEWPORT_FIT_PADDING } from './animation-constants';
import { READABLE_MIN_ZOOM, resolveStructuralCamera } from './camera';

type NodeDef = {
  id: string;
  pos?: { x: number; y: number };
  size?: { width: number; height: number };
  children?: NodeDef[];
};

const buildNode = (def: NodeDef, parentId?: string): LayoutNode => {
  const children = (def.children ?? []).map((child) => buildNode(child, def.id));
  const size = def.size ?? { width: 120, height: 80 };
  return {
    id: def.id,
    entity: {
      id: def.id,
      type: 'core/test-node',
    },
    parentId,
    baseSize: size,
    size,
    position: def.pos ?? { x: 0, y: 0 },
    children,
  };
};

const buildTree = (defs: NodeDef[]): LayoutTree => {
  const root: LayoutNode = {
    id: 'root',
    entity: {
      id: 'root',
      type: 'viewport',
      name: 'Root',
    },
    baseSize: { width: 0, height: 0 },
    size: { width: 0, height: 0 },
    children: defs.map((def) => buildNode(def, 'root')),
  };
  const byId = new Map<string, LayoutNode>();
  const collect = (node: LayoutNode) => {
    byId.set(node.id, node);
    node.children.forEach(collect);
  };
  collect(root);
  return indexTree({ rootId: root.id, byId });
};

const buildLayout = (defs: NodeDef[]) => {
  const tree = buildTree(defs);
  return {
    doc: { entities: [], relations: [] } as unknown as SemanticDocument,
    schema: { entities: [], relations: [] },
    tree,
    visibleIds: new Set([...tree.byId.keys()].filter((id) => id !== tree.rootId)),
    absolutePositions: buildAbsolutePositions(tree),
    zIndexById: new Map(),
  } as unknown as LayoutResult;
};

const snapshot = (layout: LayoutResult): CanvasRenderSnapshot =>
  ({
    nodes: [...layout.visibleIds].map((id) => {
      const node = layout.tree.byId.get(id)!;
      return {
        id,
        rect: { ...layout.absolutePositions[id], ...node.size },
        opacity: 1,
        style: {},
      };
    }),
    overlayEdges: [],
  }) as CanvasRenderSnapshot;
const camera = (
  layout: LayoutResult,
  options: Partial<StructuralChoreographyRequest> & {
    canvasSize?: { width: number; height: number };
  } = {},
) =>
  resolveStructuralCamera({
    direction: 'in',
    focus: { kind: 'global' },
    endLayout: layout,
    startSnapshot: snapshot(layout),
    endSnapshot: snapshot(layout),
    currentViewport: { x: 0, y: 0, zoom: 1 },
    endPointOfInterestNodeIds: [...layout.visibleIds],
    canvasSize: { width: 1000, height: 600 },
    minZoom: 0.05,
    maxZoom: 2,
    ...options,
  });
const fitted = (
  bounds: { x: number; y: number; width: number; height: number },
  canvas = { width: 1000, height: 600 },
) =>
  computeViewportForBoundsInVisibleCanvas({
    bounds,
    canvas,
    minZoom: 0.05,
    maxZoom: 2,
    padding: DEFAULT_VIEWPORT_FIT_PADDING,
  });

describe('structural camera target', () => {
  it('only pans enough to reveal a subtree that fits at the current zoom', () => {
    const layout = buildLayout([
      { id: 'A', pos: { x: 900, y: 80 }, size: { width: 200, height: 150 } },
    ]);
    expect(camera(layout, { focus: { kind: 'single', rootId: 'A' } })).toEqual({
      x: -140,
      y: 0,
      zoom: 1,
    });
  });
  it('keeps an already visible local expansion at the current camera', () => {
    const layout = buildLayout([
      { id: 'A', pos: { x: 80, y: 80 }, size: { width: 200, height: 150 } },
    ]);
    expect(camera(layout, { focus: { kind: 'single', rootId: 'A' } })).toBeNull();
  });
  it('fits an oversized local expansion with shared padding and never zooms in', () => {
    const bounds = { x: 0, y: 0, width: 420, height: 320 };
    const layout = buildLayout([{ id: 'A', size: bounds }]);
    expect(
      camera(layout, {
        focus: { kind: 'single', rootId: 'A' },
        canvasSize: { width: 280, height: 220 },
      }),
    ).toEqual(fitted(bounds, { width: 280, height: 220 }));
  });
  it('centres a whole expanded scene when it fits readably', () => {
    const bounds = { x: 40, y: 30, width: 1000, height: 600 };
    const layout = buildLayout([{ id: 'A', pos: bounds, size: bounds }]);
    const target = camera(layout)!;
    expect(target).toEqual(fitted(bounds));
    expect(target.zoom).toBeGreaterThanOrEqual(READABLE_MIN_ZOOM);
  });
  it.each([
    1, 0.4, 0.2,
  ])('uses the readable floor without zooming in from %s and preserves the centre world point', (zoom) => {
    const layout = buildLayout([
      {
        id: 'A',
        pos: { x: 900, y: 800 },
        size: { width: 12000, height: 9000 },
      },
    ]);
    const currentViewport = { x: -420, y: 110, zoom };
    const target = camera(layout, { currentViewport })!;
    expect(target.zoom).toBe(Math.min(zoom, READABLE_MIN_ZOOM));
    expect((500 - target.x) / target.zoom).toBeCloseTo((500 - currentViewport.x) / zoom, 10);
    expect((300 - target.y) / target.zoom).toBeCloseTo((300 - currentViewport.y) / zoom, 10);
  });
  it('does not zoom in when Expand all already fits at a lower zoom', () => {
    const layout = buildLayout([
      { id: 'A', pos: { x: 80, y: 80 }, size: { width: 420, height: 160 } },
    ]);
    const currentViewport = { x: 100, y: 50, zoom: 0.5 };
    expect(camera(layout, { currentViewport })).toEqual(currentViewport);
  });
  it.each([
    { kind: 'global' } as const,
    { kind: 'single', rootId: 'A' } as const,
  ])('keeps the final full-scene collapse framing for $kind', (focus) => {
    const layout = buildLayout([
      { id: 'A', pos: { x: 40, y: 40 }, size: { width: 140, height: 100 } },
      { id: 'X', pos: { x: 240, y: 40 }, size: { width: 180, height: 180 } },
    ]);
    expect(
      camera(layout, {
        direction: 'out',
        focus,
        canvasSize: { width: 320, height: 320 },
        endPointOfInterestNodeIds: ['A'],
      }),
    ).toEqual(fitted({ x: 40, y: 40, width: 380, height: 180 }, { width: 320, height: 320 }));
  });
  it('recentres the full scene when collapsing a single-child chain to a top-level branch', () => {
    const layout = buildLayout([
      {
        id: 'A',
        pos: { x: 40, y: 30 },
        size: { width: 360, height: 280 },
        children: [
          {
            id: 'B',
            pos: { x: 48, y: 80 },
            size: { width: 220, height: 160 },
            children: [
              {
                id: 'C',
                pos: { x: 40, y: 48 },
                size: { width: 120, height: 80 },
              },
            ],
          },
        ],
      },
    ]);
    expect(
      camera(layout, {
        direction: 'out',
        focus: { kind: 'single', rootId: 'C' },
        canvasSize: { width: 320, height: 320 },
        endPointOfInterestNodeIds: ['C'],
      }),
    ).toEqual(fitted({ x: 40, y: 30, width: 360, height: 280 }, { width: 320, height: 320 }));
  });
  it('uses the same centred fit for Focus and exit Focus', () => {
    const bounds = { x: 40, y: 30, width: 1000, height: 600 };
    const layout = buildLayout([{ id: 'A', pos: bounds, size: bounds }]);
    for (const direction of ['in', 'out'] as const)
      expect(camera(layout, { direction, focus: null })).toEqual(fitted(bounds));
  });
});
