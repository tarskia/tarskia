import { buildEntityIndex } from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import type { CanvasRect } from '../canvas/rendering/presentation/geometry';
import type { CanvasRenderSnapshot } from '../canvas/rendering/presentation/presentation';
import {
  captureTransitionFrameSnapshot,
  resolveAnimationFrame,
} from '../canvas/rendering/transition/overlay';
import { resolveNavigationPolicy, resolveNavigationViewport } from '../diagram/camera-navigation';
import { galleryFiles, loadGallery, planGalleryTransition } from '../test/curated-rendering';

const inside = (child: CanvasRect, parent: CanvasRect) =>
  child.x >= parent.x - 0.5 &&
  child.y >= parent.y - 0.5 &&
  child.x + child.width <= parent.x + parent.width + 0.5 &&
  child.y + child.height <= parent.y + parent.height + 0.5;
const overlap = (a: CanvasRect, b: CanvasRect) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
const geometry = (snapshot: CanvasRenderSnapshot) => ({
  nodes: snapshot.nodes
    .filter((n) => n.opacity > 0.001)
    .map((n) => ({ id: n.id, rect: n.rect, opacity: n.opacity }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  edges: snapshot.overlayEdges
    .filter((e) => e.opacity > 0.001)
    .map((e) => ({ id: e.id, path: e.path, opacity: e.opacity }))
    .sort((a, b) => a.id.localeCompare(b.id)),
});
const assertContained = (snapshot: CanvasRenderSnapshot) => {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const violations: string[] = [];
  for (const node of snapshot.nodes) {
    if (node.opacity <= 0.001) continue;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent.opacity > 0.001 && !inside(node.rect, parent.rect))
      violations.push(`${node.id} outside ${parent.id}`);
  }
  expect(violations).toEqual([]);
};

describe.each(galleryFiles)('$file rendering behavior', ({ file }) => {
  const gallery = loadGallery(file);
  const cache = new Map<string, ReturnType<typeof gallery.render>>();
  const render = (expanded?: string[]) => {
    const key = JSON.stringify(expanded ?? null);
    let value = cache.get(key);
    if (!value) {
      value = gallery.render(expanded);
      cache.set(key, value);
    }
    return value;
  };
  const entityIndex = buildEntityIndex(gallery.graph.content.entities);
  const collapsed = render([]);
  const topIds = gallery.graph.content.entities
    .filter(
      (entity) => (gallery.graph.entityIndex.childrenByParent.get(entity.id)?.length ?? 0) > 0,
    )
    .map((entity) => entity.id);
  const variants = [
    undefined,
    ...topIds.map((id) => [id]),
    gallery.graph.entities.map((entity) => entity.id),
  ];

  it('keeps static views contained, disjoint, connected and deterministic', () => {
    for (const expanded of variants) {
      const { presentation } = render(expanded);
      assertContained(presentation);
      for (let i = 0; i < presentation.nodes.length; i++)
        for (let j = i + 1; j < presentation.nodes.length; j++) {
          const a = presentation.nodes[i],
            b = presentation.nodes[j];
          if (a.parentId === b.parentId)
            expect(overlap(a.rect, b.rect), `${a.id} overlaps ${b.id}`).toBe(false);
        }
      const visible = new Set(presentation.nodes.map((node) => node.id));
      const nearest = (id: string): string | undefined => {
        let current: string | undefined = id;
        while (current && !visible.has(current)) current = entityIndex.parentById.get(current);
        return current;
      };
      for (const edge of presentation.overlayEdges) {
        expect(visible.has(edge.sourceId) && visible.has(edge.targetId), edge.id).toBe(true);
        for (const relationId of edge.relationIds ?? [edge.relationId]) {
          const relation = gallery.graph.content.relations.find(
            (candidate) => candidate.id === relationId,
          );
          expect(relation, relationId).toBeDefined();
          if (relation)
            expect([edge.sourceId, edge.targetId].sort()).toEqual(
              [nearest(relation.from), nearest(relation.to)].sort(),
            );
        }
      }
      expect(geometry(gallery.render(expanded).presentation)).toEqual(geometry(presentation));
    }
  });

  it('starts and ends expansions and collapses at their presentations, with finite contained frames', () => {
    for (const id of topIds) {
      const expanded = render([id]);
      for (const [from, to, direction] of [
        [collapsed, expanded, 'in'],
        [expanded, collapsed, 'out'],
      ] as const) {
        const { overlay } = planGalleryTransition(from, to, direction);
        for (let step = 0; step <= 20; step++) {
          const frame = resolveAnimationFrame(overlay, step * 50);
          const snapshot = captureTransitionFrameSnapshot({ state: overlay, frame });
          expect(
            snapshot.nodes.every(
              (node) =>
                Object.values(node.rect).every(Number.isFinite) && Number.isFinite(node.opacity),
            ),
            `${id} frame ${step}: finite nodes`,
          ).toBe(true);
          expect(
            snapshot.overlayEdges.every((edge) => !/NaN|Infinity/.test(edge.path)),
            `${id} frame ${step}: finite edges`,
          ).toBe(true);
          assertContained(snapshot);
          if (step === 0) expect(geometry(snapshot)).toEqual(geometry(from.presentation));
          if (step === 20) expect(geometry(snapshot)).toEqual(geometry(to.presentation));
        }
      }
    }
  });

  it('fits initial and expanded bounds with padding on wide and resized canvases', () => {
    for (const expanded of [[], ...topIds.map((id) => [id])]) {
      const { presentation } = render(expanded);
      const rects = presentation.nodes.map((node) => node.rect);
      const x = Math.min(...rects.map((rect) => rect.x)),
        y = Math.min(...rects.map((rect) => rect.y));
      const bounds = {
        x,
        y,
        width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
        height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
      };
      for (const canvasSize of [
        { width: 1280, height: 720 },
        { width: 600, height: 900 },
      ]) {
        const intent = expanded.length
          ? { kind: 'fit-scene' as const }
          : { kind: 'initialize-diagram' as const };
        const policy = resolveNavigationPolicy(intent);
        const viewport = resolveNavigationViewport({
          intent,
          policy,
          canvasSize,
          sceneBounds: bounds,
          currentViewport: { x: 0, y: 0, zoom: 1 },
          minZoom: 0.01,
          maxZoom: 2,
          getNodeSetBounds: () => bounds,
        });
        expect(viewport).not.toBeNull();
        if (!viewport) continue;
        const padding = policy.padding ?? 0;
        const horizontal = (canvasSize.width * padding) / (2 * (1 + padding)),
          vertical = (canvasSize.height * padding) / (2 * (1 + padding));
        expect(bounds.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(horizontal - 0.5);
        expect(bounds.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(vertical - 0.5);
        expect((bounds.x + bounds.width) * viewport.zoom + viewport.x).toBeLessThanOrEqual(
          canvasSize.width - horizontal + 0.5,
        );
        expect((bounds.y + bounds.height) * viewport.zoom + viewport.y).toBeLessThanOrEqual(
          canvasSize.height - vertical + 0.5,
        );
      }
    }
  });
});
