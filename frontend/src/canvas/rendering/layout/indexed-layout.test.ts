import { performance } from 'node:perf_hooks';
import {
  applyDiagramViewOperation,
  compileView,
  parseSemanticDocument,
  serializeSemanticDocument,
} from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { selectDeclarativeDiagramViewState } from '../../../semantic/view/declarative-view-state';
import { galleryFiles, loadGallery } from '../../../test/curated-rendering';
import { buildStaticCanvasPresentation } from '../presentation/presentation';
import { LayoutGeometryNode } from './layout-geometry';
import { buildLayoutResult } from './layout-pipeline';

describe('immutable indexed rendering', () => {
  it('retains compile, layout, and presentation identity through camera changes', () => {
    const { graph } = loadGallery('n8n.yaml');
    const view = applyDiagramViewOperation(graph.tree, undefined, { kind: 'expand-all' });
    const compiled = compileView(graph, view);
    const scene = buildLayoutResult({ graph, viewState: compiled });
    const presentation = buildStaticCanvasPresentation({ scene });
    const cameraView = {
      ...view!,
      camera: { rect: { x: 20, y: 40, width: 1440 / 2, height: 900 / 2 } },
    };
    expect(compileView(graph, cameraView)).toBe(compiled);
    expect(buildLayoutResult({ graph, viewState: compileView(graph, cameraView) })).toBe(scene);
    expect(buildStaticCanvasPresentation({ scene })).toBe(presentation);
    expect(selectDeclarativeDiagramViewState({ view: cameraView })).toBe(
      selectDeclarativeDiagramViewState({ view }),
    );
    const node = scene.tree.root.children[0];
    expect(node).toBeInstanceOf(LayoutGeometryNode);
    if (!(node instanceof LayoutGeometryNode)) throw new Error('Expected a geometry record');
    expect(node.semanticNode).toBe(compiled.tree.byId.get(node.id));
    expect(node.entity).toBe(compiled.tree.byId.get(node.id)?.entity);
    expect(Object.getPrototypeOf(node)).toBe(Object.getPrototypeOf(scene.tree.root));
    expect(Object.hasOwn(node, 'entity')).toBe(false);
    expect(() => {
      node.size.width = 1;
    }).toThrow();
    expect(() => scene.tree.byId.clear()).toThrow();
    const projected = presentation.nodes.find((entry) => entry.id === node.id)!;
    expect(projected.id).toBe(node.id);
    expect(projected.rect.width).toBe(node.size.width);
    // Presentation/export boundaries materialize fields explicitly, without spreading geometry.
    expect(JSON.parse(JSON.stringify(projected)).id).toBe(node.id);
  });

  it('preserves the saved-view format when content and camera are recombined at export', () => {
    for (const { file } of galleryFiles) {
      const { graph } = loadGallery(file);
      const view = applyDiagramViewOperation(graph.tree, undefined, { kind: 'expand-all' });
      const camera = { rect: { x: 123, y: -76, width: 1440, height: 900 } };
      const saved = { ...graph.content, view: { ...view!, camera } };
      const reloaded = parseSemanticDocument(serializeSemanticDocument(saved));
      expect(reloaded.view, file).toEqual(saved.view);
      expect(serializeSemanticDocument(reloaded), file).toBe(serializeSemanticDocument(saved));
    }
  });

  it('renders every curated diagram through immutable compiled geometry', () => {
    for (const { file } of galleryFiles) {
      const gallery = loadGallery(file);
      const expanded = applyDiagramViewOperation(gallery.graph.tree, undefined, {
        kind: 'expand-all',
      });
      const compiled = compileView(gallery.graph, expanded);
      const scene = buildLayoutResult({ graph: gallery.graph, viewState: compiled });
      const presentation = buildStaticCanvasPresentation({ scene });
      expect(presentation.nodes.length, file).toBe(scene.visibleIds.size);
      for (const node of presentation.nodes) {
        expect(node.id, file).toBeTruthy();
        expect(Number.isFinite(node.rect.x), file).toBe(true);
        expect(node.rect.width, file).toBeGreaterThan(0);
      }
      expect(buildLayoutResult({ graph: gallery.graph, viewState: compiled }), file).toBe(scene);
    }
  });

  it('keeps expanded n8n structural click-to-layout below 25ms', () => {
    const { graph } = loadGallery('n8n.yaml');
    let view = applyDiagramViewOperation(graph.tree, undefined, { kind: 'expand-all' });
    const groups = graph.entities.filter((entity) => graph.tree.byId.get(entity.id)?.hasChildren);
    buildLayoutResult({ graph, viewState: compileView(graph, view) });
    const timings: number[] = [];
    for (let i = 0; i < 80; i++) {
      const start = performance.now();
      view = applyDiagramViewOperation(graph.tree, view, {
        kind: 'toggle',
        entityId: groups[i % groups.length].id,
      });
      buildLayoutResult({ graph, viewState: compileView(graph, view) });
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const median = timings[Math.floor(timings.length / 2)];
    const p95 = timings[Math.floor(timings.length * 0.95)];
    process.stdout.write(
      `n8n structural click-to-layout median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms\n`,
    );
    expect(median).toBeLessThan(25);
  });
});
