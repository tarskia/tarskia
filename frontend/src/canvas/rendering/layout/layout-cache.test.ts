import { performance } from 'node:perf_hooks';
import { compileDiagramViewState } from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { galleryFiles, loadGallery } from '../../../test/curated-rendering';
import { buildGraphModel } from '../graph/graph-model';
import type { CanvasScene } from '../scene/scene';
import {
  clearComponentLayoutCache,
  type LayoutSpec,
  renderComponentLayout,
  renderComponentLayoutUncached,
} from './component-renderer';
import { buildLayoutEdgesForParent } from './layout-edges';
import { buildLayoutResult } from './layout-pipeline';

const geometry = (scene: CanvasScene) =>
  [...scene.tree.byId].map(([id, node]) => ({
    id,
    size: node.size,
    position: node.position,
    computed: node.computedChildPositions,
    mode: node.layoutMode,
    summary: node.summaryLabel,
    occluders: node.contentOccluders,
    visual: scene.nodeVisuals.get(id),
  }));
const spec: LayoutSpec = { padding: 16, headerHeight: 62, nodeSep: 16, rankSep: 22 };

describe('container layout cache', () => {
  it('shares immutable geometry and invalidates every layout input, retaining order', () => {
    clearComponentLayoutCache();
    const children = {
      a: { width: 101, height: 73 },
      b: { width: 52, height: 96 },
      c: { width: 70, height: 55 },
    };
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
    ];
    const first = renderComponentLayout(children, edges, spec);
    expect(renderComponentLayout({ ...children }, [...edges], { ...spec })).toBe(first);
    expect(() => {
      first.positions.a.x = 999;
    }).toThrow();
    expect(() => {
      // @ts-expect-error Runtime mutation must fail as well as readonly type checking.
      first.boxes.get('a')!.width = 999;
    }).toThrow();
    expect('set' in first.boxes).toBe(false);
    const variants = [
      [{ ...children, a: { width: 102, height: 73 } }, edges, spec],
      [{ ...children, a: { width: 101, height: 74 } }, edges, spec],
      [{ c: children.c, b: children.b, a: children.a }, edges, spec],
      [children, [...edges].reverse(), spec],
      [children, [{ source: 'b', target: 'a' }], spec],
      ...Object.entries({
        padding: 17,
        headerHeight: 63,
        nodeSep: 17,
        rankSep: 23,
        direction: 'TB',
        layoutMode: 'list',
        listGap: 10,
      }).map(([key, value]) => [children, edges, { ...spec, [key]: value }]),
    ] as Parameters<typeof renderComponentLayout>[];
    for (const args of variants) {
      const result = renderComponentLayout(...args);
      expect(result).not.toBe(first);
      const expected = renderComponentLayoutUncached(...args, true);
      expect(result.positions).toEqual(expected.positions);
      expect(result.requiredSize).toEqual(expected.requiredSize);
    }
    // Fill the LRU with cheap one-node layouts: eviction does not depend on Dagre.
    // Recent hits survive eviction; the oldest untouched entry does not.
    const fillerChildren = { a: children.a };
    for (let index = 0; index < 1999; index++)
      renderComponentLayout(fillerChildren, [], { ...spec, padding: index + 100 });
    expect(renderComponentLayout(children, edges, spec)).not.toBe(first);
    const recent = renderComponentLayout(children, edges, spec);
    for (let index = 0; index < 2001; index++) {
      renderComponentLayout(children, edges, spec);
      renderComponentLayout(fillerChildren, [], { ...spec, padding: index + 10000 });
    }
    expect(renderComponentLayout(children, edges, spec)).toBe(recent);
  });

  it('matches Dagre for small layouts, unequal sizes, directions, cycles and self loops', () => {
    for (const direction of ['LR', 'TB'] as const) {
      for (const children of [
        { a: { width: 101, height: 73 } },
        { a: { width: 101, height: 73 }, b: { width: 52, height: 96 } },
      ]) {
        const edgeSets =
          Object.keys(children).length === 1
            ? [[], [{ source: 'a', target: 'a' }]]
            : [
                [],
                [{ source: 'a', target: 'b' }],
                [{ source: 'b', target: 'a' }],
                [
                  { source: 'a', target: 'b' },
                  { source: 'b', target: 'a' },
                ],
              ];
        for (const edges of edgeSets) {
          expect(renderComponentLayoutUncached(children, edges, { ...spec, direction })).toEqual(
            renderComponentLayoutUncached(children, edges, { ...spec, direction }, true),
          );
        }
      }
    }
  });
});

for (const { file } of galleryFiles) {
  it(`${file}: 200 seeded toggles preserve every box and visual`, () => {
    const { graph } = loadGallery(file);
    const groups = graph.entities
      .filter((entity) => (graph.childrenByParent.get(entity.id)?.length ?? 0) > 0)
      .map((entity) => entity.id);
    const expanded = new Set(groups);
    let seed = 31;
    for (let index = 0; index < 200; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (index % 50 === 0) for (const id of groups) expanded.add(id);
      const id = groups[seed % groups.length];
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      const doc = {
        ...graph.doc,
        view: {
          kind: 'semantic-diagram-view' as const,
          version: 2 as const,
          nodesById: Object.fromEntries(
            graph.entities.map((entity) => [entity.id, { expanded: expanded.has(entity.id) }]),
          ),
        },
      };
      const params = {
        graph: buildGraphModel(doc, graph.schema),
        viewState: compileDiagramViewState({ doc, schema: graph.schema }),
      };
      const cached = buildLayoutResult(params);
      const uncached = buildLayoutResult({ ...params, uncached: true });
      expect(geometry(cached), `toggle ${index} (${id})`).toEqual(geometry(uncached));
    }
  }, 60000);
}

for (const name of ['n8n', 'supabase', 'chatwoot'])
  it(`${name}: expanded layout toggle benchmark`, () => {
    const file = galleryFiles.find((entry) => entry.file.includes(name))!.file;
    const { graph } = loadGallery(file);
    const groups = graph.entities
      .filter((entity) => (graph.childrenByParent.get(entity.id)?.length ?? 0) > 0)
      .map((entity) => entity.id);
    const timings: number[] = [];
    const baseline: number[] = [];
    clearComponentLayoutCache();
    for (let index = 0; index < 400; index++) {
      const collapsed = groups[index % groups.length];
      const doc = {
        ...graph.doc,
        view: {
          kind: 'semantic-diagram-view' as const,
          version: 2 as const,
          nodesById: Object.fromEntries(
            graph.entities.map((entity) => [entity.id, { expanded: entity.id !== collapsed }]),
          ),
        },
      };
      const params = {
        graph: buildGraphModel(doc, graph.schema),
        viewState: compileDiagramViewState({ doc, schema: graph.schema }),
      };
      const start = performance.now();
      buildLayoutResult(params);
      timings.push(performance.now() - start);
      const uncachedStart = performance.now();
      buildLayoutResult({ ...params, uncached: true });
      baseline.push(performance.now() - uncachedStart);
    }
    timings.sort((a, b) => a - b);
    baseline.sort((a, b) => a - b);
    const median = timings[Math.floor(timings.length / 2)];
    process.stdout.write(
      `${name} 400 expanded toggles: cached median ${median.toFixed(2)}ms; uncached ${baseline[200].toFixed(2)}ms; cached p95 ${timings[380].toFixed(2)}ms\n`,
    );
    if (name === 'n8n') expect(median).toBeLessThanOrEqual(6);
  }, 30000);

it('every small curated container and focus projection retain Dagre geometry', () => {
  let smallContainers = 0;
  for (const { file } of galleryFiles) {
    const { graph, render } = loadGallery(file);
    const groups = graph.entities
      .filter((entity) => (graph.childrenByParent.get(entity.id)?.length ?? 0) > 0)
      .map((entity) => entity.id);
    const scene = render(groups).scene;
    for (const node of scene.tree.byId.values()) {
      if (node.children.length < 1 || node.children.length > 2) continue;
      smallContainers++;
      const children = Object.fromEntries(node.children.map((child) => [child.id, child.size]));
      const edges = buildLayoutEdgesForParent({
        parentId: node.id,
        childIds: Object.keys(children),
        edges: scene.edges,
        tree: scene.tree,
      });
      for (const direction of ['LR', 'TB'] as const) {
        expect(renderComponentLayoutUncached(children, edges, { ...spec, direction })).toEqual(
          renderComponentLayoutUncached(children, edges, { ...spec, direction }, true),
        );
      }
    }
    for (const scopeRootId of groups.slice(0, 5)) {
      const doc = {
        ...graph.doc,
        view: {
          kind: 'semantic-diagram-view' as const,
          version: 2 as const,
          scopeRootId,
          nodesById: Object.fromEntries(groups.map((id) => [id, { expanded: true }])),
        },
      };
      const params = {
        graph: buildGraphModel(doc, graph.schema),
        viewState: compileDiagramViewState({ doc, schema: graph.schema }),
      };
      expect(geometry(buildLayoutResult(params))).toEqual(
        geometry(buildLayoutResult({ ...params, uncached: true })),
      );
    }
  }
  expect(smallContainers).toBeGreaterThan(100);
}, 30000);
