import { collectDescendantIds } from '../../../semantic';
import type { LayoutNode, LayoutTree } from '../layout/tree-traverser';

export type ViewportBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ViewportSpec = {
  x: number;
  y: number;
  zoom: number;
};

export type ViewRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function collectSubtreeIds(tree: LayoutTree, rootId: string): Set<string> {
  return collectDescendantIds(tree, rootId, { includeRoot: true });
}

export function collectLayoutBounds(tree: LayoutTree, ids?: Set<string>): ViewportBounds | null {
  let bounds: ViewportBounds | null = null;
  const queue: Array<{ node: LayoutNode; abs: { x: number; y: number } }> = [];
  for (const child of tree.root.children) {
    const pos = child.position ?? { x: 0, y: 0 };
    queue.push({ node: child, abs: pos });
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const { node, abs } = current;
    const include = !ids || ids.has(node.id);
    if (include) {
      const minX = abs.x;
      const minY = abs.y;
      const maxX = abs.x + node.size.width;
      const maxY = abs.y + node.size.height;
      if (!bounds) {
        bounds = { minX, minY, maxX, maxY };
      } else {
        bounds.minX = Math.min(bounds.minX, minX);
        bounds.minY = Math.min(bounds.minY, minY);
        bounds.maxX = Math.max(bounds.maxX, maxX);
        bounds.maxY = Math.max(bounds.maxY, maxY);
      }
    }
    for (const child of node.children) {
      const rel = child.position ?? { x: 0, y: 0 };
      const next = { x: abs.x + rel.x, y: abs.y + rel.y };
      queue.push({ node: child, abs: next });
    }
  }
  return bounds;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function computeViewRect(params: {
  viewport: ViewportSpec;
  canvas: { width: number; height: number };
}): ViewRect {
  const { viewport, canvas } = params;
  const minX = -viewport.x / viewport.zoom;
  const minY = -viewport.y / viewport.zoom;
  const maxX = (-viewport.x + canvas.width) / viewport.zoom;
  const maxY = (-viewport.y + canvas.height) / viewport.zoom;
  return { minX, minY, maxX, maxY };
}

export function computeViewportForBounds(params: {
  bounds: ViewportBounds;
  canvas: { width: number; height: number };
  padding?: number;
  mode?: 'center-top' | 'anchor';
  anchor?: { x: number; y: number };
  minZoom: number;
  maxZoom: number;
}): ViewportSpec {
  const { bounds, canvas, minZoom, maxZoom } = params;
  const padding = params.padding ?? 40;
  const mode = params.mode ?? 'center-top';
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const zoomX = (canvas.width - padding * 2) / width;
  const zoomY = (canvas.height - padding * 2) / height;
  const zoom = clamp(Math.min(zoomX, zoomY), minZoom, maxZoom);

  if (mode === 'anchor') {
    const anchor = params.anchor ?? { x: 0.5, y: 0.2 };
    return {
      x: -(bounds.minX * zoom) + canvas.width * anchor.x,
      y: -(bounds.minY * zoom) + canvas.height * anchor.y,
      zoom,
    };
  }

  return {
    x: -(bounds.minX * zoom) + (canvas.width - width * zoom) / 2,
    y: -(bounds.minY * zoom) + padding,
    zoom,
  };
}
