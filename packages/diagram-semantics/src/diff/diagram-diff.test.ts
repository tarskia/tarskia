import { describe, expect, it } from 'vitest';
import { ingestSemanticDiagramDiff, serializeSemanticDiagramDiff } from '../io/diff';
import type { SchemaModule, SemanticDocument } from '../model/types';
import { parseDocument, serializeDocument } from '../util/serialization';
import {
  compileSemanticDiagramDiffUnion,
  diffSemanticDiagramDocuments,
  evolveSemanticDiagramDiffUnion,
  type SemanticDiagramDiffNode,
} from './diagram-diff';

it('evolves serialized diffs against parsed documents with optional fields, descriptions and unordered tags', () => {
  const before = parseDocument(
    serializeDocument({
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'a', type: 'service', description: 'Original', tags: ['z', 'a'] },
        { id: 'b', type: 'service' },
      ],
      relations: [{ id: 'ab', from: 'a', to: 'b', description: 'Calls B', tags: ['z', 'a'] }],
    }),
  );
  const after = structuredClone(before);
  after.entities[0].description = 'Updated';
  after.relations[0].description = 'Updated call';
  const ingested = ingestSemanticDiagramDiff(
    serializeSemanticDiagramDiff(diffSemanticDiagramDocuments({ before, after })),
  );
  expect(ingested.ok).toBe(true);
  const result = evolveSemanticDiagramDiffUnion({ before, diff: ingested.value! });
  expect(result.ok).toBe(true);
  expect(result.value?.afterDocument.entities[0].description).toBe('Updated');
  expect(result.value?.afterDocument.relations[0].description).toBe('Updated call');
});

const schema: SchemaModule = {
  owner: 'user',
  name: 'diff-test',
  version: '1',
  types: [
    { id: 'group', label: 'Group' },
    { id: 'service', label: 'Service' },
    { id: 'leaf', label: 'Leaf' },
  ],
  relations: [
    { id: 'calls', label: 'Calls', shortLabel: 'calls' },
    { id: 'reads', label: 'Reads', shortLabel: 'reads' },
  ],
};

const beforeDoc: SemanticDocument = {
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'old-parent', type: 'group' },
    { id: 'new-parent', type: 'group' },
    { id: 'stable', type: 'group' },
    {
      id: 'moved',
      type: 'service',
      name: 'Moved Service',
      parent: 'old-parent',
    },
    { id: 'child-a', type: 'leaf', name: 'Nested Child', parent: 'moved' },
    { id: 'source', type: 'service', parent: 'stable' },
    { id: 'target', type: 'service', parent: 'stable' },
    { id: 'route-target', type: 'service', parent: 'stable' },
  ],
  relations: [
    { id: 'rel-moved', type: 'calls', from: 'source', to: 'moved' },
    {
      id: 'rel-meta',
      type: 'reads',
      label: 'Reads data',
      from: 'source',
      to: 'target',
    },
    { id: 'rel-retarget', type: 'calls', from: 'source', to: 'target' },
    { id: 'rel-removed', type: 'calls', from: 'target', to: 'source' },
  ],
};

const afterDoc: SemanticDocument = {
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'old-parent', type: 'group' },
    { id: 'new-parent', type: 'group' },
    { id: 'stable', type: 'group' },
    {
      id: 'moved',
      type: 'service',
      name: 'Moved Service',
      parent: 'new-parent',
    },
    { id: 'child-a', type: 'leaf', name: 'Nested Child', parent: 'moved' },
    { id: 'source', type: 'service', parent: 'stable' },
    { id: 'target', type: 'service', parent: 'stable' },
    { id: 'route-target', type: 'service', parent: 'stable' },
    { id: 'added', type: 'leaf', parent: 'stable' },
  ],
  relations: [
    { id: 'rel-moved', type: 'calls', from: 'source', to: 'moved' },
    {
      id: 'rel-meta',
      type: 'reads',
      label: 'Queries data',
      from: 'source',
      to: 'target',
    },
    { id: 'rel-retarget', type: 'calls', from: 'source', to: 'route-target' },
    { id: 'rel-added', type: 'calls', from: 'added', to: 'target' },
  ],
};

type RevealedDiffNode = SemanticDiagramDiffNode & { reveal: RevealMetadata };

describe('diffSemanticDiagramDocuments', () => {
  it('detects entity and relation change kinds across two diagrams', () => {
    const diff = diffSemanticDiagramDocuments({
      before: beforeDoc,
      after: afterDoc,
    });

    expect(diff.entities.find((entry) => entry.entityId === 'moved')).toMatchObject({
      change: 'changed',
      changedFields: ['parent'],
    });
    expect(diff.entities.find((entry) => entry.entityId === 'child-a')).toMatchObject({
      change: 'unchanged',
      changedFields: [],
    });
    expect(diff.entities.find((entry) => entry.entityId === 'added')).toMatchObject({
      change: 'added',
    });
    expect(diff.relations.find((entry) => entry.relationId === 'rel-meta')).toMatchObject({
      change: 'changed',
      changedFields: ['label'],
    });
    expect(diff.relations.find((entry) => entry.relationId === 'rel-retarget')).toMatchObject({
      change: 'changed',
      changedFields: ['to'],
    });
    expect(diff.relations.find((entry) => entry.relationId === 'rel-moved')).toMatchObject({
      change: 'unchanged',
      changedFields: [],
    });
    expect(diff.relations.find((entry) => entry.relationId === 'rel-removed')).toMatchObject({
      change: 'removed',
    });
  });
});

describe('compileSemanticDiagramDiffUnion', () => {
  it('duplicates moved subtrees by side while preserving merged nodes elsewhere', () => {
    const union = compileSemanticDiagramDiffUnion({
      before: beforeDoc,
      after: afterDoc,
      schema,
    });

    expect(union.tree.byId.get('before:moved')).toMatchObject({
      parentId: 'old-parent',
      diff: {
        side: 'before',
        change: 'changed',
        changedFields: ['parent'],
        tombstone: true,
      },
    });
    expect(union.tree.byId.get('after:moved')).toMatchObject({
      parentId: 'new-parent',
      diff: {
        side: 'after',
        change: 'changed',
        changedFields: ['parent'],
        tombstone: false,
      },
    });
    expect(union.tree.byId.get('before:child-a')?.parentId).toBe('before:moved');
    expect(union.tree.byId.get('after:child-a')?.parentId).toBe('after:moved');
    expect(union.tree.byId.get('stable')?.diff.side).toBe('merged');
    expect(union.tree.byId.get('stable')?.diff.change).toBe('unchanged');
  });

  it('splits or merges edge instances based on projected endpoints', () => {
    const union = compileSemanticDiagramDiffUnion({
      before: beforeDoc,
      after: afterDoc,
      schema,
    });

    expect(
      union.edges.find((edge) => edge.relationId === 'rel-moved' && edge.diff.side === 'before'),
    ).toMatchObject({
      sourceId: 'source',
      targetId: 'before:moved',
      diff: { change: 'unchanged', side: 'before' },
    });
    expect(
      union.edges.find((edge) => edge.relationId === 'rel-moved' && edge.diff.side === 'after'),
    ).toMatchObject({
      sourceId: 'source',
      targetId: 'after:moved',
      diff: { change: 'unchanged', side: 'after' },
    });
    expect(
      union.edges.find((edge) => edge.relationId === 'rel-meta' && edge.diff.side === 'merged'),
    ).toMatchObject({
      sourceId: 'source',
      targetId: 'target',
      label: 'Queries data',
      before: expect.objectContaining({ label: 'Reads data' }),
      after: expect.objectContaining({ label: 'Queries data' }),
      diff: { change: 'changed', side: 'merged', changedFields: ['label'] },
    });
    expect(
      union.edges.find((edge) => edge.relationId === 'rel-retarget' && edge.diff.side === 'before'),
    ).toMatchObject({
      sourceId: 'source',
      targetId: 'target',
      diff: { change: 'changed', side: 'before', changedFields: ['to'] },
    });
    expect(
      union.edges.find((edge) => edge.relationId === 'rel-retarget' && edge.diff.side === 'after'),
    ).toMatchObject({
      sourceId: 'source',
      targetId: 'route-target',
      diff: { change: 'changed', side: 'after', changedFields: ['to'] },
    });
  });

  it('evolves the same union from a serialized sparse diff document', () => {
    const serializedDiff = serializeSemanticDiagramDiff(
      diffSemanticDiagramDocuments({ before: beforeDoc, after: afterDoc }),
    );
    const ingested = ingestSemanticDiagramDiff(serializedDiff);
    if (!ingested.ok || !ingested.value) {
      throw new Error('Expected sparse diff ingest to succeed');
    }

    const fromAfter = compileSemanticDiagramDiffUnion({
      before: beforeDoc,
      after: afterDoc,
      schema,
    });
    const fromDiff = compileSemanticDiagramDiffUnion({
      before: beforeDoc,
      diff: ingested.value,
      schema,
    });

    expect([...fromDiff.tree.byId.keys()].sort((left, right) => left.localeCompare(right))).toEqual(
      [...fromAfter.tree.byId.keys()].sort((left, right) => left.localeCompare(right)),
    );
    expect(fromDiff.edges).toEqual(fromAfter.edges);
    expect(fromDiff.pointsOfInterest).toEqual(fromAfter.pointsOfInterest);
  });

  it('returns a validated union result for external diff workflows', () => {
    const diff = diffSemanticDiagramDocuments({
      before: beforeDoc,
      after: afterDoc,
    });

    const evolved = evolveSemanticDiagramDiffUnion({
      before: beforeDoc,
      diff,
      schema,
    });

    expect(evolved.ok).toBe(true);
    expect(evolved.value).toEqual(
      compileSemanticDiagramDiffUnion({
        before: beforeDoc,
        diff,
        schema,
      }),
    );
  });

  it('rejects a diff whose before snapshot does not match the input document', () => {
    const diff = diffSemanticDiagramDocuments({
      before: beforeDoc,
      after: afterDoc,
    });
    const movedEntity = diff.entities.find((entry) => entry.entityId === 'moved');
    if (!movedEntity?.before) {
      throw new Error('Expected moved entity diff');
    }
    movedEntity.before = {
      ...movedEntity.before,
      name: 'Tampered',
    };

    expect(() =>
      compileSemanticDiagramDiffUnion({
        before: beforeDoc,
        diff,
        schema,
      }),
    ).toThrowError(/before snapshot does not match the before document/i);

    const evolved = evolveSemanticDiagramDiffUnion({
      before: beforeDoc,
      diff,
      schema,
    });
    expect(evolved.ok).toBe(false);
    expect(evolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.diff.before_snapshot_mismatch',
        }),
      ]),
    );
  });
});

describe('nested diff evolution', () => {
  const provenance = (path: string) => ({
    locations: [{ input: 'primary', path }],
  });
  const fixture = (): SemanticDocument => ({
    version: '1',
    schemaRefs: [],
    metadata: { title: 'Synthetic system' },
    entities: [
      {
        id: 'app',
        type: 'group',
        name: 'App',
        provenance: provenance('app.ts'),
        children: [
          {
            id: 'api',
            type: 'service',
            name: 'API',
            provenance: provenance('api.ts'),
            children: [
              {
                id: 'handler',
                type: 'leaf',
                name: 'Handler',
                provenance: provenance('handler.ts'),
              },
              { id: 'obsolete', type: 'leaf' },
            ],
          },
          { id: 'stable', type: 'leaf', props: { preserve: true } },
        ],
      },
      {
        id: 'other',
        type: 'group',
        children: [{ id: 'existing', type: 'leaf' }],
      },
    ],
    relations: [
      {
        id: 'calls',
        from: 'handler',
        to: 'stable',
        type: 'calls',
        provenance: provenance('calls.ts'),
      },
    ],
  });
  const evolve = (before: SemanticDocument, after: SemanticDocument) => {
    const diff = diffSemanticDiagramDocuments({ before, after });
    const result = evolveSemanticDiagramDiffUnion({ before, diff });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.value!.afterDocument).toEqual(after);
    expect(compileSemanticDiagramDiffUnion({ before, diff }).afterDocument).toEqual(after);
    return { diff, union: result.value! };
  };
  it.each(['nested', 'parent'] as const)('preserves a %s rename and untouched children', (kind) => {
    const before = fixture();
    const after = structuredClone(before);
    (kind === 'parent' ? after.entities[0] : after.entities[0].children![0]).name = 'Renamed';
    evolve(before, after);
    expect(before).toEqual(fixture());
  });
  it('moves a nested subtree after the destination existing children', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.entities[1].children!.push(after.entities[0].children!.shift()!);
    evolve(before, after);
  });
  it('appends added nested entities in declared order, not alphabetic order', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.entities[0].children![0].children!.push(
      { id: 'z-added', type: 'leaf' },
      { id: 'a-added', type: 'leaf', provenance: provenance('new.ts') },
    );
    const { diff } = evolve(before, after);
    const ingested = ingestSemanticDiagramDiff(serializeSemanticDiagramDiff(diff));
    expect(ingested.ok).toBe(true);
    expect(
      evolveSemanticDiagramDiffUnion({ before, diff: ingested.value! }).value?.afterDocument,
    ).toEqual(after);
  });
  it.each([
    'entity',
    'relation',
  ])('explicitly rejects unsupported %s provenance removal', (kind) => {
    const before = fixture();
    const after = structuredClone(before);
    if (kind === 'entity') delete after.entities[0].provenance;
    else delete after.relations[0].provenance;
    expect(() => diffSemanticDiagramDocuments({ before, after })).toThrow(
      /provenance removal is unsupported/,
    );
  });
  it.each([
    { locations: [null] },
    { locations: [{ path: 12 }] },
    { locations: [] },
    { locations: [{ path: 'a', input: {} }] },
    { locations: [{ path: 'a' }], confidence: 'high' },
  ])('rejects malformed provenance %j', (bad) => {
    const before = fixture();
    const after = structuredClone(before);
    after.entities[0].name = 'New app';
    const diff = diffSemanticDiagramDocuments({ before, after });
    Object.assign(diff.entities.find((entry) => entry.entityId === 'app')!.after!, {
      provenance: bad,
    });
    const result = ingestSemanticDiagramDiff(serializeSemanticDiagramDiff(diff));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'diagram.diff.invalid_snapshot',
        path: expect.stringContaining('provenance'),
      }),
    );
  });
  it('rejects removing a parent while retaining its children', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.entities.splice(0, 1);
    const diff = diffSemanticDiagramDocuments({ before, after });
    diff.entities = diff.entities.filter((entry) => entry.entityId === 'app');
    diff.relations = [];
    const result = evolveSemanticDiagramDiffUnion({ before, diff });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'diagram.diff.invalid_parent_reference',
        entityId: 'api',
      }),
    );
  });
  it('retains entity and relation moved-file provenance without architecture highlights', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.entities[0].children![0].provenance = provenance('cmd/api.ts');
    after.relations[0].provenance = provenance('cmd/calls.ts');
    const { diff, union } = evolve(before, after);
    expect(diff.entities.find((entry) => entry.entityId === 'api')).toMatchObject({
      changedFields: ['provenance'],
      after: { provenance: provenance('cmd/api.ts') },
    });
    expect(diff.entities.find((entry) => entry.entityId === 'api')!.before).not.toHaveProperty(
      'provenance',
    );
    expect(diff.relations[0].changedFields).toEqual(['provenance']);
    expect(union.pointsOfInterest).toEqual({ nodeIds: [], edgeIds: [] });
    const ingested = ingestSemanticDiagramDiff(serializeSemanticDiagramDiff(diff));
    expect(ingested.ok).toBe(true);
    const roundTrip = evolveSemanticDiagramDiffUnion({
      before,
      diff: ingested.value!,
    });
    expect(roundTrip.value?.afterDocument).toEqual(after);
  });
  it('preserves base provenance when a handwritten changed snapshot omits it', () => {
    const before = fixture();
    const result = evolveSemanticDiagramDiffUnion({
      before,
      diff: {
        kind: 'semantic-diagram-diff',
        version: 1,
        entities: [
          {
            entityId: 'api',
            change: 'changed',
            before: { id: 'api', type: 'service', name: 'API', parent: 'app' },
            after: {
              id: 'api',
              type: 'service',
              name: 'New API',
              parent: 'app',
            },
            changedFields: ['name'],
          },
        ],
        relations: [
          {
            relationId: 'calls',
            change: 'changed',
            before: {
              id: 'calls',
              from: 'handler',
              to: 'stable',
              type: 'calls',
            },
            after: {
              id: 'calls',
              from: 'handler',
              to: 'stable',
              type: 'reads',
            },
            changedFields: ['type'],
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.value?.afterDocument.entities[0].children?.[0].provenance).toEqual(
      provenance('api.ts'),
    );
    expect(result.value?.afterDocument.relations[0].provenance).toEqual(provenance('calls.ts'));
  });
  it('round trips combined edits over three levels exactly, including unchanged fields and sibling order', () => {
    const before = fixture();
    const after = structuredClone(before);
    const api = after.entities[0].children!.shift()!;
    api.children![0].name = 'HTTP Handler';
    api.children!.pop();
    api.provenance = provenance('cmd/api.ts');
    after.entities[1].children!.push(api, {
      id: 'new-service',
      type: 'service',
      provenance: provenance('new.ts'),
    });
    after.relations[0].label = 'Uses';
    const { diff } = evolve(before, after);
    const ingested = ingestSemanticDiagramDiff(serializeSemanticDiagramDiff(diff));
    expect(ingested.ok).toBe(true);
    expect(
      evolveSemanticDiagramDiffUnion({ before, diff: ingested.value! }).value?.afterDocument,
    ).toEqual(after);
  });
});

it('round-trips represents through diff snapshots and preserves it when evolving', () => {
  const before: SemanticDocument = {
    version: '1',
    schemaRefs: [],
    entities: [{ id: 'external', type: 'service', represents: 'api/old' }],
    relations: [],
  };
  const after: SemanticDocument = {
    ...before,
    entities: [{ ...before.entities[0], represents: 'api/new' }],
  };
  const diff = diffSemanticDiagramDocuments({ before, after });
  expect(diff.entities[0].changedFields).toEqual(['represents']);
  const parsed = ingestSemanticDiagramDiff(serializeSemanticDiagramDiff(diff));
  expect(parsed.ok).toBe(true);
  const evolved = evolveSemanticDiagramDiffUnion({ before, diff: parsed.value! });
  expect(evolved.value?.afterDocument.entities[0].represents).toBe('api/new');
});
