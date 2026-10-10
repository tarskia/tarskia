import { describe, expect, it } from 'vitest';
import type { DiagramView, SchemaModule, SemanticDocument } from '../model/types';
import { buildEntityTree } from '../tree/entity-tree';
import { compileDiagramViewTree, compileView } from './compile-diagram-view-tree';
import { getDiagramViewExpandedMap } from './normalize-diagram-view';
import { buildSemanticIndex } from './semantic-index';
import { applyDiagramViewOperation, type DiagramViewOperation } from './view-operations';

const doc: SemanticDocument = {
  version: '1',
  schemaRefs: [],
  relations: [{ id: 'calls', from: 'leaf', to: 'remote-leaf' }],
  entities: [
    {
      id: 'platform',
      type: 'group',
      children: [
        {
          id: 'shell',
          type: 'group',
          children: [{ id: 'runtime', type: 'group', children: [{ id: 'leaf', type: 'leaf' }] }],
        },
        { id: 'worker', type: 'group', children: [{ id: 'job', type: 'leaf' }] },
      ],
    },
    { id: 'remote', type: 'group', children: [{ id: 'remote-leaf', type: 'leaf' }] },
  ],
};
const tree = buildEntityTree(doc);
const initial: DiagramView = {
  kind: 'semantic-diagram-view',
  version: 3,
  camera: { rect: { x: 1, y: 2, width: 1440 / 0.5, height: 900 / 0.5 } },
  nodesById: { leaf: { highlighted: true } },
};
const apply = (operation: DiagramViewOperation, view: DiagramView | undefined = initial) =>
  applyDiagramViewOperation(tree, view, operation);
const expanded = (view: DiagramView | undefined) =>
  Object.keys(getDiagramViewExpandedMap(view)).sort();

describe('pure view operations', () => {
  it('toggles a node and preserves unrelated flags and camera state', () => {
    const opened = apply({ kind: 'toggle', entityId: 'shell' });
    expect(expanded(opened)).toEqual(['shell']);
    const closed = apply({ kind: 'toggle', entityId: 'shell' }, opened);
    expect(expanded(closed)).toEqual([]);
    expect(closed?.nodesById).toEqual(initial.nodesById);
    expect(closed?.camera).toEqual(initial.camera);
    expect(initial.nodesById?.shell).toBeUndefined();
  });
  it('expands single-child chains without writing leaf expansion', () => {
    const next = apply({
      kind: 'set-expansion',
      entityId: 'shell',
      expanded: true,
      expandSingleChildChain: true,
    });
    expect(expanded(next)).toEqual(['runtime', 'shell']);
    expect(
      expanded(apply({ kind: 'set-expansion', entityId: 'shell', expanded: false }, next)),
    ).toEqual(['runtime']);
    expect(apply({ kind: 'set-expansion', entityId: 'shell', expanded: true }, next)).toBe(next);
  });
  it('expands and collapses all structural parents without losing highlighted state', () => {
    const next = apply({ kind: 'expand-all' });
    expect(expanded(next)).toEqual(['platform', 'remote', 'runtime', 'shell', 'worker']);
    expect(apply({ kind: 'expand-all' }, next)).toBe(next);
    const closed = apply({ kind: 'collapse-all' }, next);
    expect(expanded(closed)).toEqual([]);
    expect(closed?.nodesById).toEqual(initial.nodesById);
    expect(apply({ kind: 'collapse-all' }, closed)).toBe(closed);
  });
  it('limits within operations to their subtree including the root', () => {
    const opened = apply({ kind: 'expand-within', entityId: 'shell' });
    expect(expanded(opened)).toEqual(['runtime', 'shell']);
    const all = apply({ kind: 'expand-all' }, opened);
    expect(expanded(apply({ kind: 'collapse-within', entityId: 'shell' }, all))).toEqual([
      'platform',
      'remote',
      'worker',
    ]);
  });
  it('gates child groups on an expanded parent and collapses their full branches', () => {
    expect(apply({ kind: 'expand-child-groups', entityId: 'platform' })).toBe(initial);
    const parent = apply({ kind: 'toggle', entityId: 'platform' });
    const children = apply({ kind: 'expand-child-groups', entityId: 'platform' }, parent);
    expect(expanded(children)).toEqual(['platform', 'shell', 'worker']);
    expect(apply({ kind: 'expand-child-groups', entityId: 'shell' }, children)).toBe(children);
    const deep = apply({ kind: 'expand-within', entityId: 'shell' }, children);
    expect(expanded(apply({ kind: 'collapse-child-groups', entityId: 'platform' }, deep))).toEqual([
      'platform',
    ]);
  });
  it('enters and clears focus without discarding the existing view', () => {
    const focused = apply({ kind: 'enter-focus', entityId: 'platform', expandTarget: true });
    expect(focused?.scopeRootId).toBe('platform');
    expect(expanded(focused)).toEqual(['platform']);
    expect(focused?.camera).toEqual(initial.camera);
    const cleared = apply({ kind: 'clear-focus' }, focused);
    expect(cleared?.scopeRootId).toBeUndefined();
    expect(expanded(cleared)).toEqual(['platform']);
    expect(apply({ kind: 'clear-focus' }, cleared)).toBe(cleared);
    expect(apply({ kind: 'enter-focus', entityId: 'leaf' })).toBe(initial);
    expect(apply({ kind: 'enter-focus', entityId: 'leaf', allowLeaf: true })?.scopeRootId).toBe(
      'leaf',
    );
    expect(apply({ kind: 'enter-focus', entityId: 'missing', allowLeaf: true })).toBe(initial);
  });
  it('reveals entity and relation matches with the package reveal closure, clearing focus', () => {
    const next = apply(
      {
        kind: 'search-reveal',
        entityIds: new Set(['leaf']),
        relationIds: new Set(['calls']),
        relations: doc.relations,
      },
      { ...initial, scopeRootId: 'platform' },
    );
    expect(next?.scopeRootId).toBeUndefined();
    expect(expanded(next)).toEqual(['platform', 'remote', 'runtime', 'shell']);
    expect(next?.nodesById?.leaf?.highlighted).toBe(true);
    expect(
      expanded(
        apply({
          kind: 'search-reveal',
          entityIds: new Set(['missing']),
          relationIds: new Set(),
          relations: [],
        }),
      ),
    ).toEqual([]);
  });
  it('disables Collapse all when an expanded descendant is hidden behind its collapsed parent', () => {
    const schema: SchemaModule = {
      owner: 'test',
      name: 'controls',
      version: '1',
      types: [{ id: 'group' }, { id: 'leaf' }],
      relations: [],
    };
    let view = apply({ kind: 'expand-within', entityId: 'platform' });
    view = apply({ kind: 'set-expansion', entityId: 'platform', expanded: false }, view);
    expect(view?.nodesById?.shell?.expanded).toBe(true);
    const compiled = compileDiagramViewTree({ doc: { ...doc, view }, schema });
    expect(compiled.byId.get('platform')?.view.controls.canCollapseDetails).toBe(false);
    expect(compiled.byId.get('platform')?.view.controls.canExpandDetails).toBe(true);
    const reopened = apply({ kind: 'toggle', entityId: 'platform' }, view);
    expect(
      compileDiagramViewTree({ doc: { ...doc, view: reopened }, schema }).byId.get('platform')?.view
        .controls.canCollapseDetails,
    ).toBe(true);
  });
});

it('toggles highlights and clears all flags without changing scope, expansion or camera', () => {
  const view = {
    ...initial,
    scopeRootId: 'platform',
    nodesById: {
      platform: { expanded: true },
      leaf: { highlighted: true },
      'remote-leaf': { highlighted: true },
    },
  };
  const next = apply({ kind: 'toggle-highlight', entityId: 'platform' }, view);
  expect(next?.nodesById?.platform).toEqual({ expanded: true, highlighted: true });
  expect(next?.scopeRootId).toBe(view.scopeRootId);
  expect(next?.camera).toEqual(view.camera);
  const clear = apply({ kind: 'clear-highlights' }, next);
  expect(clear?.nodesById).toEqual({ platform: { expanded: true } });
  expect(clear?.scopeRootId).toBe(view.scopeRootId);
  expect(clear?.camera).toEqual(view.camera);
  expect(apply({ kind: 'clear-highlights' }, clear)).toBe(clear);
  expect(apply({ kind: 'toggle-highlight', entityId: 'missing' }, view)).toBe(view);
});

it('retains semantic highlights outside a focused projection', () => {
  const index = buildSemanticIndex(doc, {
    owner: 'test',
    name: 'highlight',
    version: '1',
    types: [],
    relations: [],
  });
  const compiled = compileView(index, {
    ...initial,
    scopeRootId: 'platform',
    nodesById: { 'remote-leaf': { highlighted: true } },
  });
  expect(compiled.tree.byId.has('remote-leaf')).toBe(false);
  expect(compiled.highlightedIds).toEqual(['remote-leaf']);
});
