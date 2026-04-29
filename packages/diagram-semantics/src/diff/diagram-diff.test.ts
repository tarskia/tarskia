import { describe, expect, it } from 'vitest';
import { ingestSemanticDiagramDiff, serializeSemanticDiagramDiff } from '../io/diff';
import type { SchemaModule, SemanticDocument } from '../model/types';
import { buildRevealedTree, type RevealMetadata } from '../view/reveal-tree';
import {
  compileSemanticDiagramDiffUnion,
  diffSemanticDiagramDocuments,
  evolveSemanticDiagramDiffUnion,
  type SemanticDiagramDiffNode,
} from './diagram-diff';

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
    { id: 'moved', type: 'service', name: 'Moved Service', parent: 'old-parent' },
    { id: 'child-a', type: 'leaf', name: 'Nested Child', parent: 'moved' },
    { id: 'source', type: 'service', parent: 'stable' },
    { id: 'target', type: 'service', parent: 'stable' },
    { id: 'route-target', type: 'service', parent: 'stable' },
  ],
  relations: [
    { id: 'rel-moved', type: 'calls', from: 'source', to: 'moved' },
    { id: 'rel-meta', type: 'reads', label: 'Reads data', from: 'source', to: 'target' },
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
    { id: 'moved', type: 'service', name: 'Moved Service', parent: 'new-parent' },
    { id: 'child-a', type: 'leaf', name: 'Nested Child', parent: 'moved' },
    { id: 'source', type: 'service', parent: 'stable' },
    { id: 'target', type: 'service', parent: 'stable' },
    { id: 'route-target', type: 'service', parent: 'stable' },
    { id: 'added', type: 'leaf', parent: 'stable' },
  ],
  relations: [
    { id: 'rel-moved', type: 'calls', from: 'source', to: 'moved' },
    { id: 'rel-meta', type: 'reads', label: 'Queries data', from: 'source', to: 'target' },
    { id: 'rel-retarget', type: 'calls', from: 'source', to: 'route-target' },
    { id: 'rel-added', type: 'calls', from: 'added', to: 'target' },
  ],
};

type RevealedDiffNode = SemanticDiagramDiffNode & { reveal: RevealMetadata };

describe('diffSemanticDiagramDocuments', () => {
  it('detects entity and relation change kinds across two diagrams', () => {
    const diff = diffSemanticDiagramDocuments({ before: beforeDoc, after: afterDoc });

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
      diff: { side: 'before', change: 'changed', changedFields: ['parent'], tombstone: true },
    });
    expect(union.tree.byId.get('after:moved')).toMatchObject({
      parentId: 'new-parent',
      diff: { side: 'after', change: 'changed', changedFields: ['parent'], tombstone: false },
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

  it('returns rendered-instance POIs that the shared closure helper can retain', () => {
    const union = compileSemanticDiagramDiffUnion({
      before: beforeDoc,
      after: afterDoc,
      schema,
    });

    expect(union.pointsOfInterest.nodeIds).toEqual(
      expect.arrayContaining(['after:child-a', 'after:moved', 'before:child-a', 'before:moved']),
    );
    expect(union.pointsOfInterest.edgeIds).toEqual(
      expect.arrayContaining([
        'before:rel-moved:source->before:moved',
        'after:rel-moved:source->after:moved',
        'rel-meta:source->target',
      ]),
    );

    const revealed = buildRevealedTree<SemanticDiagramDiffNode, RevealedDiffNode>({
      tree: union.tree,
      expanded: {},
      targetNodeIds: new Set(union.pointsOfInterest.nodeIds),
      targetEdgeIds: new Set(union.pointsOfInterest.edgeIds),
      edges: union.edges.map((edge) => ({
        id: edge.id,
        from: edge.sourceId,
        to: edge.targetId,
      })),
      forceExpandToTargets: true,
      cloneRoot: (node, reveal) => ({
        ...node,
        children: [],
        reveal,
      }),
      cloneNode: (node, parentId, reveal) => ({
        ...node,
        parentId,
        children: [],
        reveal,
      }),
    });

    expect(revealed.byId.has('old-parent')).toBe(true);
    expect(revealed.byId.has('new-parent')).toBe(true);
    expect(revealed.byId.has('before:moved')).toBe(true);
    expect(revealed.byId.has('after:moved')).toBe(true);
    expect(revealed.byId.has('before:child-a')).toBe(true);
    expect(revealed.byId.has('after:child-a')).toBe(true);
    expect(revealed.byId.get('source')?.reveal.isRelationEndpoint).toBe(true);
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
    const diff = diffSemanticDiagramDocuments({ before: beforeDoc, after: afterDoc });

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
    const diff = diffSemanticDiagramDocuments({ before: beforeDoc, after: afterDoc });
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
        expect.objectContaining({ code: 'diagram.diff.before_snapshot_mismatch' }),
      ]),
    );
  });
});
