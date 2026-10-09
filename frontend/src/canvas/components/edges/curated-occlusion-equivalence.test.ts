// Frozen resolver from 5f1b8bc: intentionally retain the pre-optimization algorithm.
import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
  CanvasOverlayOccluder,
} from '../../rendering/presentation/presentation';
import {
  collapseNestedOccluders,
  expandOccluderRect,
  flattenOccluders,
  splitOccludersByNodeIds,
} from './occluder-geometry';

interface ResolvedOverlayEdgeView extends CanvasOverlayEdgeView {
  blockerOccluders: CanvasOverlayOccluder[];
}

interface EdgeOverlayRenderState {
  shellOccluders: CanvasOverlayOccluder[];
  contentOccluders: CanvasOverlayOccluder[];
  overlayWorldBounds: CanvasOverlayOccluder;
  edges: ResolvedOverlayEdgeView[];
}

const DEFAULT_OVERLAY_WORLD_BOUNDS: CanvasOverlayOccluder = {
  x: -2048,
  y: -2048,
  width: 4096,
  height: 4096,
};

const resolveFrozenEdgeOverlayRenderState = (params: {
  edges: CanvasOverlayEdgeView[];
  nodes: CanvasNodeView[];
}): EdgeOverlayRenderState => {
  const { edges, nodes } = params;
  const occluderNodes = nodes.map((node) => ({
    id: node.id,
    rect: node.rect,
    zIndex: node.zIndex,
    focusShell: node.style.focusShell,
  }));

  const contentOccluders: CanvasOverlayOccluder[] = nodes.flatMap((node) => {
    const contentScale = node.kind === 'entity' ? node.contentScale : 1;
    return (node.contentOccluders ?? []).map((occluder) => ({
      x: node.rect.x + occluder.x * contentScale,
      y: node.rect.y + occluder.y * contentScale,
      width: occluder.width * contentScale,
      height: occluder.height * contentScale,
    }));
  });

  const shellOccluders = collapseNestedOccluders(
    occluderNodes
      .filter((node) => !node.focusShell && node.rect.width > 0 && node.rect.height > 0)
      .map((node) =>
        expandOccluderRect({
          x: node.rect.x,
          y: node.rect.y,
          width: node.rect.width,
          height: node.rect.height,
          ...(typeof node.zIndex === 'number' ? { zIndex: node.zIndex } : {}),
        }),
      ),
  );

  const points = [
    ...shellOccluders.flatMap((rect) => [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    ]),
    ...edges.flatMap((edge) => [
      edge.geometry.sourcePoint,
      edge.geometry.control1,
      edge.geometry.control2,
      edge.geometry.targetPoint,
    ]),
  ];
  const overlayWorldBounds =
    points.length === 0
      ? DEFAULT_OVERLAY_WORLD_BOUNDS
      : (() => {
          const minX = Math.min(...points.map((point) => point.x));
          const minY = Math.min(...points.map((point) => point.y));
          const maxX = Math.max(...points.map((point) => point.x));
          const maxY = Math.max(...points.map((point) => point.y));
          const padding = 128;
          return {
            x: minX - padding,
            y: minY - padding,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2,
          } satisfies CanvasOverlayOccluder;
        })();

  const resolvedEdges = edges.map((edge) => {
    const { ghostOccluders } = splitOccludersByNodeIds({
      nodes: occluderNodes,
      solidOverNodeIds: edge.solidOverNodeIds,
      excludedNodeIds: [edge.sourceId, edge.targetId],
    });
    return {
      ...edge,
      blockerOccluders: flattenOccluders([
        ...ghostOccluders.map((rect) => expandOccluderRect(rect)),
        ...contentOccluders,
      ]),
    } satisfies ResolvedOverlayEdgeView;
  });

  return {
    shellOccluders,
    contentOccluders,
    overlayWorldBounds,
    edges: resolvedEdges,
  };
};

import { expect, test } from 'vitest';
import { galleryFiles, loadGallery } from '../../../test/curated-rendering';
import { resolveEdgeOverlayRenderState as resolveCurrent } from './edge-overlay-state';

type Point = { x: number; y: number };
// Independent SVG endpoint-to-center arc conversion; samples the rendered path,
// rather than the legacy Bezier controls which no longer describe routed edges.
function pathSamples(path: string): Point[] {
  const samples: Point[] = [];
  let start: Point = { x: 0, y: 0 };
  for (const [, command, raw] of path.matchAll(/([MLAC])([^MLAC]*)/g)) {
    const v = raw.trim().split(/[ ,]+/).map(Number);
    if (command === 'M') {
      start = { x: v[0], y: v[1] };
      continue;
    }
    const from = start;
    const end = { x: v[v.length - 2], y: v[v.length - 1] };
    let curve: (t: number) => Point;
    if (command === 'L')
      curve = (t) => ({ x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t });
    else if (command === 'C')
      curve = (t) => ({
        x:
          (1 - t) ** 3 * from.x +
          3 * (1 - t) ** 2 * t * v[0] +
          3 * (1 - t) * t * t * v[2] +
          t ** 3 * end.x,
        y:
          (1 - t) ** 3 * from.y +
          3 * (1 - t) ** 2 * t * v[1] +
          3 * (1 - t) * t * t * v[3] +
          t ** 3 * end.y,
      });
    else {
      let rx = Math.abs(v[0]),
        ry = Math.abs(v[1]);
      const phi = (v[2] * Math.PI) / 180,
        cos = Math.cos(phi),
        sin = Math.sin(phi);
      const dx = (from.x - end.x) / 2,
        dy = (from.y - end.y) / 2;
      const xp = cos * dx + sin * dy,
        yp = -sin * dx + cos * dy;
      const scale = Math.sqrt((xp * xp) / (rx * rx) + (yp * yp) / (ry * ry));
      if (scale > 1) {
        rx *= scale;
        ry *= scale;
      }
      const sign = v[3] === v[4] ? -1 : 1;
      const factor =
        sign *
        Math.sqrt(
          Math.max(
            0,
            (rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp) /
              (rx * rx * yp * yp + ry * ry * xp * xp),
          ),
        );
      const cxp = (factor * rx * yp) / ry,
        cyp = (-factor * ry * xp) / rx;
      const cx = cos * cxp - sin * cyp + (from.x + end.x) / 2,
        cy = sin * cxp + cos * cyp + (from.y + end.y) / 2;
      const angle = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
      let delta = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - angle;
      if (!v[4] && delta > 0) delta -= 2 * Math.PI;
      if (v[4] && delta < 0) delta += 2 * Math.PI;
      curve = (t) => ({
        x: cx + cos * rx * Math.cos(angle + delta * t) - sin * ry * Math.sin(angle + delta * t),
        y: cy + sin * rx * Math.cos(angle + delta * t) + cos * ry * Math.sin(angle + delta * t),
      });
    }
    const count = Math.min(
      128,
      Math.max(16, Math.ceil(Math.hypot(end.x - from.x, end.y - from.y) / 10)),
    );
    for (let i = 0; i <= count; i++) {
      const t = i / count,
        p = curve(t),
        a = curve(Math.max(0, t - 0.0001)),
        b = curve(Math.min(1, t + 0.0001));
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      for (const offset of [-14, -7, 0, 7, 14])
        samples.push({
          x: p.x - ((b.y - a.y) / length) * offset,
          y: p.y + ((b.x - a.x) / length) * offset,
        });
    }
    start = end;
  }
  return samples;
}
const covered = (rects: CanvasOverlayOccluder[], p: Point) =>
  rects.some((r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height);
function compare(nodes: CanvasNodeView[], edges: CanvasOverlayEdgeView[]) {
  const before = performance.now();
  const old = resolveFrozenEdgeOverlayRenderState({ nodes, edges });
  const oldMs = performance.now() - before;
  const begin = performance.now();
  const current = resolveCurrent({ nodes, edges });
  const newMs = performance.now() - begin;
  let points = 0;
  for (let i = 0; i < edges.length; i++) {
    const samples = pathSamples(edges[i].path);
    expect(samples.length, edges[i].id).toBeGreaterThan(0);
    for (const p of samples) {
      if (
        covered(old.edges[i].blockerOccluders, p) !== covered(current.edges[i].blockerOccluders, p)
      )
        throw new Error(
          `${edges[i].id} coverage differs at ${JSON.stringify(p)} on ${edges[i].path}`,
        );
    }
    points += samples.length;
  }
  return { oldMs, newMs, edges: edges.length, points };
}

test.each(
  galleryFiles,
)('$file retains blocker union coverage along routed paths and their 28-unit hit stroke', ({
  file,
}) => {
  const gallery = loadGallery(file);
  const snapshot = gallery.render(gallery.graph.entities.map((e) => e.id)).presentation;
  const metrics = compare(snapshot.nodes, snapshot.overlayEdges);
  expect(metrics.points).toBeGreaterThan(0);
  if (file === 'n8n.yaml' || file === 'supabase.yaml') {
    // Informational only: machine load/JIT must not turn timing into a flaky gate.
    process.stdout.write(`occluder comparison ${file}: ${JSON.stringify(metrics)}\n`);
    expect(Number.isFinite(metrics.oldMs + metrics.newMs)).toBe(true);
  }
}, 20000);

test('covers backward and mixed-side orthogonal arcs plus conservative legacy cubic fallback', () => {
  const template = loadGallery('n8n.yaml').render([]).presentation;
  const paths = [
    'M 180 0 L 200 0 A 10 10 0 0 1 210 10 L 210 100 A 10 10 0 0 1 200 110 L 0 110',
    'M 0 100 L 0 10 A 10 10 0 0 1 10 0 L 100 0 A 10 10 0 0 1 110 10 L 110 100',
    'M 180 0 C 300 180 -100 -40 0 110',
  ];
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    ...template.nodes[0],
    id: `blocker-${i}`,
    rect: { x: (i % 6) * 40 - 5, y: Math.floor(i / 6) * 30 - 15, width: 13, height: 18 },
    contentOccluders: [{ x: 1, y: 1, width: 8, height: 8 }],
  }));
  const edges = paths.map((path, i) => ({
    ...template.overlayEdges[0],
    id: `shape-${i}`,
    path,
    sourceId: 'source',
    targetId: 'target',
    solidOverNodeIds: ['blocker-2'],
  }));
  expect(compare(nodes, edges).points).toBeGreaterThan(100);
});
