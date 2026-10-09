import { describe, expect, it } from 'vitest';
import {
  buildEntityIndex,
  buildEntityTree,
  collectDescendantIds,
  collectDescendantParentIds,
  compileDiagramViewState,
  compileSourceGraph,
  createMapSourceGraphResolver,
  type Entity,
  getAncestors,
  getSingleChildChainTop,
  indexTree,
  ingestSemanticDocument,
  ingestSemanticSourceDocument,
  ingestTrustedSemanticDocument,
  ingestTrustedSemanticSourceDocument,
  type SchemaModule,
} from '../index';

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Expected a parsed document');
  return value;
};

const schema: SchemaModule = {
  owner: 'test',
  name: 'hierarchy',
  version: '1',
  types: [{ id: 'group', containment: {} }, { id: 'leaf' }],
  relations: [],
};
const raw = (entities: Entity[], extra = {}) =>
  JSON.stringify({
    version: '0.1.0',
    schemaRefs: [],
    entities,
    relations: [],
    ...extra,
  });
const flat: Entity[] = [
  { id: 'platform', type: 'group' },
  { id: 'api', type: 'leaf', parent: 'platform' },
  { id: 'worker', type: 'leaf', parent: 'platform' },
];
const nested: Entity[] = [
  {
    id: 'platform',
    type: 'group',
    children: [
      { id: 'api', type: 'leaf' },
      { id: 'worker', type: 'leaf' },
    ],
  },
];

const ingestPaths = [
  {
    name: 'validated document',
    ingest: (text: string) => ingestSemanticDocument({ raw: text, schema }),
  },
  {
    name: 'source document',
    ingest: (text: string) => ingestSemanticSourceDocument({ raw: text }),
  },
  {
    name: 'trusted document',
    ingest: (text: string) => ingestTrustedSemanticDocument({ raw: text }),
  },
  {
    name: 'trusted source',
    ingest: (text: string) => ingestTrustedSemanticSourceDocument({ raw: text }),
  },
];

describe.each(ingestPaths)('$name hierarchy', ({ ingest }) => {
  it('gives parent references the same index, hierarchy and compiled view as children', () => {
    const fromParent = ingest(raw(flat));
    const fromChildren = ingest(raw(nested));
    expect(fromParent.ok).toBe(true);
    expect(fromParent.diagnostics).toEqual([]);
    expect(fromParent.value).toBeDefined();
    expect(fromParent.value).toEqual(fromChildren.value);
    const parent = required(fromParent.value);
    const children = required(fromChildren.value);
    expect(buildEntityIndex(parent.entities)).toEqual(buildEntityIndex(children.entities));
    expect(buildEntityTree(parent)).toEqual(buildEntityTree(children));
    for (const expanded of [false, true]) {
      const view = {
        kind: 'semantic-diagram-view' as const,
        version: 2 as const,
        nodesById: { platform: { expanded } },
      };
      expect(compileDiagramViewState({ doc: { ...parent, view }, schema })).toEqual(
        compileDiagramViewState({ doc: { ...children, view }, schema }),
      );
    }
    expect(buildEntityIndex(parent.entities).byId.get('api')).not.toHaveProperty('parent');
  });

  it.each([
    {
      label: 'missing parent',
      entities: [{ id: 'a', type: 'leaf', parent: 'missing' }],
      roots: ['a'],
      code: 'parent_not_found',
    },
    {
      label: 'self parent',
      entities: [{ id: 'a', type: 'leaf', parent: 'a' }],
      roots: ['a'],
      code: 'self_parent',
    },
    {
      label: 'cycle',
      entities: [
        { id: 'a', type: 'group', parent: 'b' },
        { id: 'b', type: 'group', parent: 'a' },
      ],
      roots: ['a', 'b'],
      code: 'parent_cycle',
    },
  ])('diagnoses $label while retaining visible roots', ({ entities, roots, code }) => {
    const result = ingest(raw(entities));
    expect(result.ok).toBe(false);
    expect(result.value?.entities.map((entity) => entity.id)).toEqual(roots);
    expect(
      result.diagnostics
        .filter((diagnostic) => diagnostic.code.endsWith(code))
        .map((diagnostic) => diagnostic.entityId)
        .sort(),
    ).toEqual(roots);
    const tree = buildEntityTree(required(result.value));
    expect(tree.root.children.map((entity) => entity.id)).toEqual(roots);
    for (const entity of required(result.value).entities)
      expect(entity).not.toHaveProperty('parent');
  });
});

it('resolves namespaced parent references only after imports have been compiled', () => {
  const source = ingestSemanticSourceDocument({
    raw: raw([{ id: 'api', type: 'leaf', parent: 'shared/platform' }], {
      imports: [{ namespace: 'shared', slug: 'shared' }],
    }),
  });
  expect(source.diagnostics).toEqual([]);
  const compiled = compileSourceGraph({
    source: required(source.value),
    sourceLabel: 'root',
    resolver: createMapSourceGraphResolver({
      shared: raw([
        { id: 'platform', type: 'group' },
        { id: 'worker', type: 'leaf', parent: 'platform' },
      ]),
    }),
  });
  expect(compiled.diagnostics).toEqual([]);
  const index = buildEntityIndex(required(compiled.result).doc.entities);
  expect(required(compiled.result).doc.entities.map((entity) => entity.id)).toEqual([
    'shared/platform',
  ]);
  expect(index.parentById.get('api')).toBe('shared/platform');
  expect(index.parentById.get('shared/worker')).toBe('shared/platform');
  for (const entity of index.byId.values()) expect(entity).not.toHaveProperty('parent');
});

it('keeps source-graph hierarchy failures recoverable without hiding import failures', () => {
  const compiled = compileSourceGraph({
    raw: raw([
      { id: 'a', type: 'group', parent: 'b' },
      { id: 'b', type: 'group', parent: 'a' },
    ]),
    sourceLabel: 'root',
  });
  expect(compiled.result?.doc.entities.map((entity) => entity.id)).toEqual(['a', 'b']);
  expect(compiled.diagnostics.filter((d) => d.code.endsWith('parent_cycle'))).toHaveLength(2);
  const unresolved = compileSourceGraph({
    raw: raw([], { imports: [{ namespace: 'missing', slug: 'missing' }] }),
    sourceLabel: 'root',
  });
  expect(unresolved.result).toBeUndefined();
  expect(unresolved.diagnostics.some((d) => d.code.includes('import'))).toBe(true);
});

it('terminates ancestor and descendant walks even on a malformed cyclic tree', () => {
  type Node = { id: string; parentId: string; children: Node[] };
  const a: Node = { id: 'a', parentId: 'b', children: [] };
  const b: Node = { id: 'b', parentId: 'a', children: [a] };
  a.children = [b];
  const tree = indexTree({
    rootId: 'a',
    byId: new Map([
      ['a', a],
      ['b', b],
    ]),
  });
  expect(getAncestors(tree, 'a')).toEqual(['b']);
  expect(getAncestors(tree, 'a', { includeSelf: true })).toEqual(['a', 'b']);
  expect([...collectDescendantIds(tree, 'a', { includeRoot: false })]).toEqual(['b']);
  expect(collectDescendantParentIds(tree, 'a', { includeRoot: false })).toEqual(['b']);
  expect(['a', 'b']).toContain(getSingleChildChainTop(tree, 'a'));
});

it('preserves nested ownership and keeps descendants of a broken cycle', () => {
  const result = ingestSemanticSourceDocument({
    raw: raw([
      {
        id: 'a',
        type: 'group',
        parent: 'b',
        children: [{ id: 'leaf', type: 'leaf', parent: 'missing' }],
      },
      { id: 'b', type: 'group', parent: 'a' },
    ]),
  });
  expect(result.value?.entities.map((entity) => entity.id)).toEqual(['a', 'b']);
  expect(required(result.value).entities[0].children?.map((entity) => entity.id)).toEqual(['leaf']);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    'diagram.document.parent_cycle',
    'diagram.document.parent_cycle',
  ]);
  expect(buildEntityIndex(required(result.value).entities).parentById.get('leaf')).toBe('a');
});
