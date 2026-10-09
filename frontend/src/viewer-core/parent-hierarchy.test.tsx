import {
  buildEntityIndex,
  getDiagramViewExpandedMap,
  normalizeDiagramView,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { buildGraphModel } from '../canvas/rendering/graph/graph-model';
import { buildCanonicalDiagramStructureQueries } from '../canvas/structure/queries';
import { loadDiagramDocFromRaw } from './loadDiagramDocFromRaw';
import { useDiagramActions } from './useDiagramActions';

it('Expand all uses parent-referenced children through the real viewer action', () => {
  const loaded = loadDiagramDocFromRaw({
    raw: JSON.stringify({
      version: '0.1.0',
      schemaRefs: [],
      relations: [],
      entities: [
        { id: 'platform', type: 'group' },
        { id: 'api', type: 'leaf', parent: 'platform' },
        { id: 'worker', type: 'leaf', parent: 'platform' },
      ],
    }),
    streamName: 'Test',
    sourceLabel: 'fixture',
  });
  expect(loaded.readable).toBe(true);
  let doc = loaded.doc;
  const schema = {
    owner: 'test',
    name: 'fixture',
    version: '1',
    types: [{ id: 'group', containment: {} }, { id: 'leaf' }],
    relations: [],
  };
  const structure = buildCanonicalDiagramStructureQueries(buildGraphModel(doc, schema));
  expect(structure.getChildren('platform').map((child) => child.id)).toEqual(['api', 'worker']);
  expect(structure.getDescendantParentIds('platform', true)).toEqual(['platform']);
  let actions!: ReturnType<typeof useDiagramActions>;
  const commitDoc = vi.fn(
    (updater: SemanticDocument | ((previous: SemanticDocument) => SemanticDocument)) => {
      doc = typeof updater === 'function' ? updater(doc) : updater;
    },
  );
  function Harness() {
    actions = useDiagramActions({
      state: { doc, expanded: getDiagramViewExpandedMap(doc.view) },
      document: { commitDoc, ensureDiagramView: normalizeDiagramView },
      transition: {
        requestNavigation: () => ({ status: 'applied', reason: 'synchronous' }),
        flushUserGesture: () => false,
        setPendingStructuralTransitionIntent: vi.fn(),
      },
      sceneQueries: { structure },
    });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  actions.expandAll();
  expect(commitDoc).toHaveBeenCalledOnce();
  expect(getDiagramViewExpandedMap(doc.view).platform).toBe(true);
  expect(buildEntityIndex(doc.entities).parentById.get('api')).toBe('platform');
});

it('keeps hierarchy diagnostics and visible entities instead of displaying an unreadable fallback', () => {
  const loaded = loadDiagramDocFromRaw({
    raw: JSON.stringify({
      version: '0.1.0',
      schemaRefs: [],
      relations: [],
      entities: [
        { id: 'a', type: 'group', parent: 'b' },
        { id: 'b', type: 'group', parent: 'a' },
        { id: 'orphan', type: 'leaf', parent: 'missing' },
      ],
    }),
    streamName: 'Test',
    sourceLabel: 'fixture',
  });
  expect(loaded.readable).toBe(true);
  expect(loaded.doc.entities.map((entity) => entity.id)).toEqual(['a', 'b', 'orphan']);
  expect(loaded.sourceDiagnostics).toHaveLength(3);
  expect(loaded.sourceDiagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(
    true,
  );
  expect(
    loadDiagramDocFromRaw({ raw: 'entities: [broken', streamName: 'Test', sourceLabel: 'fixture' })
      .readable,
  ).toBe(false);
});
