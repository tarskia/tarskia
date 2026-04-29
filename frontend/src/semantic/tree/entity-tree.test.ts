import { describe, expect, it } from 'vitest';
import { collectDescendantIds } from './canonical-tree';
import { buildEntityTree, ROOT_ID } from './entity-tree';

describe('buildEntityTree', () => {
  it('builds nested parent references from child arrays and parent ids', () => {
    const tree = buildEntityTree({
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'app',
          type: 'application',
          children: [{ id: 'svc-a', type: 'service' }],
        },
        { id: 'svc-b', type: 'service', parent: 'app' },
      ],
      relations: [],
    });

    expect(tree.rootId).toBe(ROOT_ID);
    expect(tree.childrenByParent.get(ROOT_ID)?.map((node) => node.id)).toEqual(['app']);
    expect(tree.childrenByParent.get('app')?.map((node) => node.id)).toEqual(['svc-a', 'svc-b']);
    expect(tree.byId.get('svc-a')?.parentId).toBe('app');
    expect(tree.byId.get('svc-b')?.parentId).toBe('app');
  });

  it('preserves descendant traversal parity for semantic hierarchies', () => {
    const tree = buildEntityTree({
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'platform',
          type: 'group',
          children: [
            {
              id: 'api',
              type: 'group',
              children: [{ id: 'handler', type: 'module' }],
            },
          ],
        },
      ],
      relations: [],
    });

    expect([...collectDescendantIds(tree, 'platform')].sort()).toEqual([
      'api',
      'handler',
      'platform',
    ]);
  });
});
