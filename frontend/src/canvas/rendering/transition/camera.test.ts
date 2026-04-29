import { describe, expect, it } from 'vitest';
import type { SemanticDocument } from '../../../model/types';
import { indexTree } from '../../../semantic';
import { computeViewportForBoundsInVisibleCanvas } from '../../viewport-visibility';
import type { LayoutResult } from '../layout/layout-pipeline';
import type { LayoutNode, LayoutTree } from '../layout/tree-traverser';
import { buildAbsolutePositions } from '../scene/scene';
import { DEFAULT_VIEWPORT_FIT_PADDING } from './animation-constants';
import { buildStructuralCameraAdvisory } from './camera';
import { computeViewportForBounds } from './viewport';

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
    layoutMeta: { level: 0 },
  } as unknown as LayoutResult;
};

const collectSubtreeIds = (tree: LayoutTree, rootId: string) => {
  const ids = new Set<string>();
  const walk = (id: string) => {
    ids.add(id);
    const node = tree.byId.get(id);
    for (const child of node?.children ?? []) {
      walk(child.id);
    }
  };
  walk(rootId);
  return ids;
};

const defaultCameraParams = {
  padding: 40,
  minZoom: 0.5,
  maxZoom: 2,
  collectSubtreeIds,
};

describe('buildStructuralCameraAdvisory', () => {
  it('does not prefit a collapse when the anchor journey is already visible', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 320, height: 320 },
        children: [{ id: 'B', pos: { x: 180, y: 180 }, size: { width: 80, height: 80 } }],
      },
      { id: 'X', pos: { x: 420, y: 0 }, size: { width: 180, height: 180 } },
    ]);
    const toLayout = buildLayout([
      { id: 'A', pos: { x: 40, y: 40 }, size: { width: 140, height: 100 } },
      { id: 'X', pos: { x: 240, y: 40 }, size: { width: 180, height: 180 } },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'out',
      focus: { kind: 'global' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasSize: { width: 320, height: 320 },
      endPointOfInterestNodeIds: ['A', 'X'],
      ...defaultCameraParams,
    });

    expect(advisory.prelude).toBeUndefined();
  });

  it('prefits a collapse corridor when the anchor journey is off-screen', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 320, height: 320 },
        children: [{ id: 'B', pos: { x: 180, y: 180 }, size: { width: 80, height: 80 } }],
      },
      { id: 'X', pos: { x: 420, y: 0 }, size: { width: 180, height: 180 } },
    ]);
    const toLayout = buildLayout([
      { id: 'A', pos: { x: 40, y: 40 }, size: { width: 140, height: 100 } },
      { id: 'X', pos: { x: 240, y: 40 }, size: { width: 180, height: 180 } },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'out',
      focus: { kind: 'single', rootId: 'B' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: -420, y: 0, zoom: 1 },
      canvasSize: { width: 260, height: 260 },
      endPointOfInterestNodeIds: ['A', 'X'],
      ...defaultCameraParams,
    });

    expect(advisory.prelude).toEqual(
      computeViewportForBounds({
        bounds: {
          minX: 16,
          minY: -8,
          maxX: 284,
          maxY: 308,
        },
        canvas: { width: 260, height: 260 },
        mode: 'center-top',
        padding: 40,
        minZoom: 0.5,
        maxZoom: 2,
      }),
    );
    expect(advisory.epilogue).toEqual(
      computeViewportForBoundsInVisibleCanvas({
        bounds: {
          x: 40,
          y: 40,
          width: 380,
          height: 180,
        },
        canvas: { width: 260, height: 260 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
  });

  it('falls back to the local focus root when the viewport anchor is outside that subtree', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 320, height: 320 },
        children: [{ id: 'B', pos: { x: 180, y: 180 }, size: { width: 80, height: 80 } }],
      },
      { id: 'X', pos: { x: 420, y: 0 }, size: { width: 180, height: 180 } },
    ]);
    const toLayout = buildLayout([
      { id: 'A', pos: { x: 40, y: 40 }, size: { width: 140, height: 100 } },
      { id: 'X', pos: { x: 240, y: 40 }, size: { width: 180, height: 180 } },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'out',
      focus: { kind: 'local', rootId: 'A' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: -440, y: 0, zoom: 1 },
      canvasSize: { width: 240, height: 240 },
      endPointOfInterestNodeIds: ['A', 'X'],
      ...defaultCameraParams,
    });

    expect(advisory.prelude).toEqual(
      computeViewportForBounds({
        bounds: {
          minX: -24,
          minY: -48,
          maxX: 344,
          maxY: 368,
        },
        canvas: { width: 240, height: 240 },
        mode: 'center-top',
        padding: 40,
        minZoom: 0.5,
        maxZoom: 2,
      }),
    );
  });

  it('prefits single-focus expansions to the expanded end subtree', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 140, height: 100 },
      },
    ]);
    const toLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 420, height: 320 },
        children: [
          { id: 'B', pos: { x: 24, y: 120 }, size: { width: 140, height: 100 } },
          { id: 'C', pos: { x: 220, y: 120 }, size: { width: 140, height: 100 } },
        ],
      },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'in',
      focus: { kind: 'single', rootId: 'A' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasSize: { width: 280, height: 220 },
      endPointOfInterestNodeIds: ['A', 'B', 'C'],
      ...defaultCameraParams,
    });

    expect(advisory.prelude).toBeDefined();
    expect(advisory.epilogue).toBeUndefined();
  });

  it('prefits global expands to the centered scene layout', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 140, height: 100 },
      },
    ]);
    const toLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 420, height: 320 },
        children: [
          { id: 'B', pos: { x: 24, y: 120 }, size: { width: 140, height: 100 } },
          { id: 'C', pos: { x: 220, y: 120 }, size: { width: 140, height: 100 } },
        ],
      },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'in',
      focus: { kind: 'global' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: 160, y: 120, zoom: 1.8 },
      canvasSize: { width: 280, height: 220 },
      endPointOfInterestNodeIds: ['A', 'B', 'C'],
      ...defaultCameraParams,
    });

    expect(advisory.prelude).toEqual(
      computeViewportForBoundsInVisibleCanvas({
        bounds: {
          x: 0,
          y: 0,
          width: 420,
          height: 320,
        },
        canvas: { width: 280, height: 220 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
    expect(advisory.epilogue).toBeUndefined();
  });

  it('recenters global expands even when the expanded scene already fits', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 80, y: 80 },
        size: { width: 140, height: 100 },
      },
    ]);
    const toLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 80, y: 80 },
        size: { width: 420, height: 160 },
      },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'in',
      focus: { kind: 'global' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasSize: { width: 800, height: 600 },
      endPointOfInterestNodeIds: ['A'],
      ...defaultCameraParams,
    });

    expect(advisory.prelude).toEqual(
      computeViewportForBoundsInVisibleCanvas({
        bounds: {
          x: 80,
          y: 80,
          width: 420,
          height: 160,
        },
        canvas: { width: 800, height: 600 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
    expect(advisory.epilogue).toBeUndefined();
  });

  it('treats space behind the left sidebar as non-visible for expansion prelude fits', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 40, y: 40 },
        size: { width: 180, height: 120 },
      },
    ]);
    const toLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 40, y: 40 },
        size: { width: 180, height: 120 },
      },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'in',
      focus: { kind: 'global' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasSize: { width: 280, height: 220 },
      leftOcclusion: 120,
      endPointOfInterestNodeIds: ['A'],
      ...defaultCameraParams,
    });

    const visibleFit = computeViewportForBoundsInVisibleCanvas({
      bounds: {
        x: 40,
        y: 40,
        width: 180,
        height: 120,
      },
      canvas: { width: 280, height: 220 },
      minZoom: 0.5,
      maxZoom: 2,
      padding: DEFAULT_VIEWPORT_FIT_PADDING,
      leftOcclusion: 120,
    });

    expect(advisory.prelude).toEqual(visibleFit);
  });

  it('adds an epilogue fit after collapse when the anchor journey is visible but the final target still needs framing', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 320, height: 320 },
        children: [{ id: 'B', pos: { x: 180, y: 180 }, size: { width: 80, height: 80 } }],
      },
      { id: 'X', pos: { x: 420, y: 0 }, size: { width: 180, height: 180 } },
    ]);
    const toLayout = buildLayout([
      { id: 'A', pos: { x: 40, y: 40 }, size: { width: 140, height: 100 } },
      { id: 'X', pos: { x: 240, y: 40 }, size: { width: 180, height: 180 } },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'out',
      focus: { kind: 'global' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasSize: { width: 320, height: 320 },
      endPointOfInterestNodeIds: ['A', 'X'],
      ...defaultCameraParams,
    });

    expect(advisory.prelude).toBeUndefined();
    expect(advisory.epilogue).toEqual(
      computeViewportForBoundsInVisibleCanvas({
        bounds: {
          x: 40,
          y: 40,
          width: 380,
          height: 180,
        },
        canvas: { width: 320, height: 320 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
  });

  it('recentres the full visible diagram after collapsing to a top-level node', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 320, height: 320 },
        children: [{ id: 'B', pos: { x: 180, y: 180 }, size: { width: 80, height: 80 } }],
      },
      { id: 'X', pos: { x: 420, y: 0 }, size: { width: 180, height: 180 } },
    ]);
    const toLayout = buildLayout([
      { id: 'A', pos: { x: 40, y: 40 }, size: { width: 140, height: 100 } },
      { id: 'X', pos: { x: 240, y: 40 }, size: { width: 180, height: 180 } },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'out',
      focus: { kind: 'single', rootId: 'A' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasSize: { width: 320, height: 320 },
      endPointOfInterestNodeIds: ['A'],
      ...defaultCameraParams,
    });

    expect(advisory.epilogue).toEqual(
      computeViewportForBoundsInVisibleCanvas({
        bounds: {
          x: 40,
          y: 40,
          width: 380,
          height: 180,
        },
        canvas: { width: 320, height: 320 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
  });

  it('recentres the full visible diagram after collapsing a single-child chain to a top-level branch', () => {
    const fromLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 0, y: 0 },
        size: { width: 520, height: 420 },
        children: [
          {
            id: 'B',
            pos: { x: 60, y: 120 },
            size: { width: 360, height: 240 },
            children: [
              {
                id: 'C',
                pos: { x: 80, y: 80 },
                size: { width: 180, height: 140 },
                children: [{ id: 'D', pos: { x: 24, y: 60 }, size: { width: 80, height: 60 } }],
              },
            ],
          },
        ],
      },
    ]);
    const toLayout = buildLayout([
      {
        id: 'A',
        pos: { x: 40, y: 30 },
        size: { width: 360, height: 280 },
        children: [
          {
            id: 'B',
            pos: { x: 48, y: 80 },
            size: { width: 220, height: 160 },
            children: [{ id: 'C', pos: { x: 40, y: 48 }, size: { width: 120, height: 80 } }],
          },
        ],
      },
    ]);

    const advisory = buildStructuralCameraAdvisory({
      direction: 'out',
      focus: { kind: 'single', rootId: 'C' },
      startLayout: fromLayout,
      endLayout: toLayout,
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasSize: { width: 320, height: 320 },
      endPointOfInterestNodeIds: ['C'],
      ...defaultCameraParams,
    });

    expect(advisory.epilogue).toEqual(
      computeViewportForBoundsInVisibleCanvas({
        bounds: {
          x: 40,
          y: 30,
          width: 360,
          height: 280,
        },
        canvas: { width: 320, height: 320 },
        minZoom: 0.5,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
      }),
    );
  });
});
