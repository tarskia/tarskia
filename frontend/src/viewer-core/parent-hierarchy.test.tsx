import {
  buildEntityIndex,
  buildSemanticIndex,
  type DiagramView,
  getDiagramViewExpandedMap,
} from '@tarskia/diagram-semantics';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
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
  const doc = loaded.doc;
  let view = doc.view;
  const index = buildSemanticIndex(doc, {
    owner: 'test',
    name: 'hierarchy',
    version: '1',
    types: [],
    relations: [],
  });
  let actions!: ReturnType<typeof useDiagramActions>;
  const commitView = vi.fn(
    (
      updater:
        | DiagramView
        | undefined
        | ((previous: DiagramView | undefined) => DiagramView | undefined),
    ) => {
      view = typeof updater === 'function' ? updater(view) : updater;
    },
  );
  function Harness() {
    actions = useDiagramActions({
      state: { index, view },
      document: { commitView },
      transition: {
        requestNavigation: () => ({ status: 'applied', reason: 'synchronous' }),
        flushUserGesture: () => false,
        setPendingStructuralTransitionIntent: vi.fn(),
      },
    });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  actions.expandAll();
  expect(commitView).toHaveBeenCalledOnce();
  expect(getDiagramViewExpandedMap(view).platform).toBe(true);
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
