import {
  buildSemanticIndex,
  compileView,
  type SchemaModule,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { edgeLabelRect, rectanglesIntersect } from '../presentation/edge-routing';
import { buildStaticCanvasPresentation } from '../presentation/presentation';
import { buildLayoutResult } from './layout-pipeline';

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  types: [{ id: 'service', label: 'Service' }],
  relations: [{ id: 'calls', label: 'calls' }],
};
describe.each([false, true])('comparison parallel relations (antiparallel=%s)', (reverse) => {
  it('preserves removed/added and unchanged/added paths and labels without changing the normal cached layout', () => {
    for (const before of ['removed', 'unchanged']) {
      const doc: SemanticDocument = {
        version: '1',
        schemaRefs: [],
        entities: [
          { id: 'a', type: 'service' },
          { id: 'b', type: 'service' },
        ],
        relations: [
          { id: before, type: 'calls', from: 'a', to: 'b', label: 'old call' },
          {
            id: 'added',
            type: 'calls',
            from: reverse ? 'b' : 'a',
            to: reverse ? 'a' : 'b',
            label: 'new call',
          },
        ],
      };
      const graph = buildSemanticIndex(doc, schema);
      const viewState = compileView(graph);
      const normal = buildLayoutResult({ graph, viewState });
      const comparison = buildLayoutResult({ graph, viewState, preserveParallelEdges: true });
      expect(normal.edges).toHaveLength(1);
      expect(comparison.edges.map((edge) => edge.relationId).sort()).toEqual(
        [before, 'added'].sort(),
      );
      expect(buildLayoutResult({ graph, viewState })).toBe(normal);
      expect(buildLayoutResult({ graph, viewState, preserveParallelEdges: true })).toBe(comparison);
      const rendered = buildStaticCanvasPresentation({ scene: comparison }).overlayEdges;
      expect(rendered).toHaveLength(2);
      expect(new Set(rendered.map((edge) => edge.path)).size).toBe(2);
      expect(rendered[0].labelAnchor).not.toEqual(rendered[1].labelAnchor);
      expect(rectanglesIntersect(edgeLabelRect(rendered[0]), edgeLabelRect(rendered[1]))).toBe(
        false,
      );
    }
  });
});
