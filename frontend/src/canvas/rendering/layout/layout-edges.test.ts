import { describe, expect, it } from 'vitest';
import type { SemanticDocument } from '../../../model/types';
import { buildCompiledDiagramEdgeId, buildEntityTree } from '../../../semantic';
import { buildSceneTree } from '../tree/scene-tree';
import { buildLayoutEdgesForParent } from './layout-edges';

describe('buildLayoutEdgesForParent', () => {
  it('maps cross-container relations to direct children of the parent', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'app-a', type: 'application', name: 'A' },
        { id: 'app-b', type: 'application', name: 'B' },
        { id: 'api-a', type: 'api', name: 'API A', parent: 'app-a' },
        { id: 'api-b', type: 'api', name: 'API B', parent: 'app-b' },
      ],
      relations: [{ id: 'rel-1', type: 'calls', from: 'api-a', to: 'api-b' }],
    };

    const tree = buildSceneTree({ tree: buildEntityTree(doc) });
    const rootChildren = tree.childrenByParent.get(tree.rootId) ?? [];
    const edges = buildLayoutEdgesForParent({
      parentId: tree.rootId,
      childIds: rootChildren.map((child) => child.id),
      edges: [
        {
          id: buildCompiledDiagramEdgeId('rel-1', 'app-a', 'app-b'),
          relationId: 'rel-1',
          sourceId: 'app-a',
          targetId: 'app-b',
          type: 'calls',
        },
      ],
      tree,
    });

    expect(edges).toEqual([{ source: 'app-a', target: 'app-b' }]);
  });

  it('projects expanded descendant endpoints back to the parent boundary', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'app-a', type: 'application', name: 'A' },
        { id: 'app-b', type: 'application', name: 'B' },
        { id: 'api-a', type: 'api', name: 'API A', parent: 'app-a' },
        { id: 'api-b', type: 'api', name: 'API B', parent: 'app-b' },
      ],
      relations: [{ id: 'rel-1', type: 'calls', from: 'api-a', to: 'api-b' }],
    };

    const tree = buildSceneTree({ tree: buildEntityTree(doc) });
    const rootChildren = tree.childrenByParent.get(tree.rootId) ?? [];
    const edges = buildLayoutEdgesForParent({
      parentId: tree.rootId,
      childIds: rootChildren.map((child) => child.id),
      edges: [
        {
          id: buildCompiledDiagramEdgeId('rel-1', 'api-a', 'api-b'),
          relationId: 'rel-1',
          sourceId: 'api-a',
          targetId: 'api-b',
          type: 'calls',
        },
      ],
      tree,
    });

    expect(edges).toEqual([{ source: 'app-a', target: 'app-b' }]);
  });

  it('drops edges when both endpoints collapse to the same direct child', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'db', type: 'datastore', name: 'DB' },
        { id: 'schema', type: 'schema', name: 'orders', parent: 'db' },
        { id: 't1', type: 'table', name: 'orders', parent: 'schema' },
        { id: 't2', type: 'table', name: 'customers', parent: 'schema' },
      ],
      relations: [{ id: 'rel-1', type: 'joins', from: 't1', to: 't2' }],
    };
    const tree = buildSceneTree({ tree: buildEntityTree(doc) });
    const children = tree.childrenByParent.get('db') ?? [];
    const edges = buildLayoutEdgesForParent({
      parentId: 'db',
      childIds: children.map((child) => child.id),
      edges: [
        {
          id: buildCompiledDiagramEdgeId('rel-1', 'schema', 'schema'),
          relationId: 'rel-1',
          sourceId: 'schema',
          targetId: 'schema',
          type: 'joins',
        },
      ],
      tree,
    });

    expect(edges).toEqual([]);
  });
});
