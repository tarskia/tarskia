import { describe, expect, it } from 'vitest';
import {
  collectDescendantIds,
  collectDescendantParentIds,
  collectSingleChildChainDown,
  getAncestors,
  getSingleChildChainTop,
  indexTree,
  type TreeNodeLike,
} from './canonical-tree';

interface TestNode extends TreeNodeLike<TestNode> {
  id: string;
  label: string;
}

const buildTree = () => {
  const leafA: TestNode = { id: 'leaf-a', label: 'Leaf A', parentId: 'branch', children: [] };
  const leafB: TestNode = { id: 'leaf-b', label: 'Leaf B', parentId: 'branch', children: [] };
  const branch: TestNode = {
    id: 'branch',
    label: 'Branch',
    parentId: 'root',
    children: [leafA, leafB],
  };
  const root: TestNode = { id: 'root', label: 'Root', children: [branch] };
  return indexTree({
    rootId: 'root',
    byId: new Map([
      ['root', root],
      ['branch', branch],
      ['leaf-a', leafA],
      ['leaf-b', leafB],
    ]),
  });
};

describe('canonical-tree helpers', () => {
  it('collects ancestors from leaf to root', () => {
    const tree = buildTree();
    expect(getAncestors(tree, 'leaf-a')).toEqual(['branch', 'root']);
    expect(getAncestors(tree, 'leaf-a', { includeSelf: true })).toEqual([
      'leaf-a',
      'branch',
      'root',
    ]);
  });

  it('collects descendant ids and descendant parents', () => {
    const tree = buildTree();
    expect([...collectDescendantIds(tree, 'branch')].sort()).toEqual([
      'branch',
      'leaf-a',
      'leaf-b',
    ]);
    expect(collectDescendantParentIds(tree, 'root', { includeRoot: true })).toEqual([
      'root',
      'branch',
    ]);
  });

  it('resolves single-child chain helpers', () => {
    const tree = buildTree();
    expect(getSingleChildChainTop(tree, 'branch')).toBe('branch');
    expect(collectSingleChildChainDown(tree, 'root')).toEqual(['branch']);
  });
});
