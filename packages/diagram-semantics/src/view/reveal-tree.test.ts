import { describe, expect, it } from 'vitest';
import { buildEntityTree } from '../tree/entity-tree';
import { buildRevealedEntityTree } from './reveal-tree';

const buildTree = () =>
  buildEntityTree({
    version: '1',
    schemaRefs: [],
    entities: [
      { id: 'platform', type: 'group' },
      { id: 'api', type: 'group', parent: 'platform' },
      { id: 'workers', type: 'group', parent: 'platform' },
      { id: 'orders', type: 'leaf', parent: 'api' },
      { id: 'customers', type: 'leaf', parent: 'api' },
      { id: 'job', type: 'leaf', parent: 'workers' },
    ],
    relations: [{ id: 'rel-1', type: 'calls', from: 'orders', to: 'job' }],
  });

describe('buildRevealedEntityTree', () => {
  it('returns the normal expansion view when no targets are supplied', () => {
    const tree = buildTree();
    const revealed = buildRevealedEntityTree({
      tree,
      expanded: { platform: true, api: true },
    });

    expect(revealed.childrenByParent.get(tree.rootId)?.map((node) => node.id)).toEqual([
      'platform',
    ]);
    expect(revealed.childrenByParent.get('platform')?.map((node) => node.id)).toEqual([
      'api',
      'workers',
    ]);
    expect(revealed.childrenByParent.get('api')?.map((node) => node.id)).toEqual([
      'orders',
      'customers',
    ]);
    expect(revealed.childrenByParent.has('workers')).toBe(false);
  });

  it('keeps target descendants hidden when force reveal is disabled', () => {
    const tree = buildTree();
    const revealed = buildRevealedEntityTree({
      tree,
      expanded: { platform: true },
      targetEntityIds: new Set(['orders']),
    });

    expect(revealed.byId.has('platform')).toBe(true);
    expect(revealed.byId.has('api')).toBe(true);
    expect(revealed.byId.has('orders')).toBe(false);
  });

  it('forces ancestor paths open for targets when requested', () => {
    const tree = buildTree();
    const revealed = buildRevealedEntityTree({
      tree,
      expanded: { platform: true },
      targetEntityIds: new Set(['orders']),
      forceExpandToTargets: true,
    });

    expect(revealed.byId.has('platform')).toBe(true);
    expect(revealed.byId.has('api')).toBe(true);
    expect(revealed.byId.has('orders')).toBe(true);
    expect(revealed.byId.get('platform')?.reveal.isAncestorContext).toBe(true);
    expect(revealed.byId.get('orders')?.reveal.isTarget).toBe(true);
  });

  it('preserves explicitly expanded siblings only inside the retained closure', () => {
    const tree = buildTree();
    const revealed = buildRevealedEntityTree({
      tree,
      expanded: { platform: true, api: true },
      targetEntityIds: new Set(['orders']),
      forceExpandToTargets: true,
      preserveExpandedBranches: true,
    });

    expect(revealed.byId.has('customers')).toBe(true);
    expect(revealed.byId.has('workers')).toBe(true);
    expect(revealed.byId.has('job')).toBe(false);
    expect(revealed.byId.get('customers')?.reveal.isPreservedByExpansion).toBe(true);
    expect(revealed.byId.get('workers')?.reveal.isPreservedByExpansion).toBe(true);
  });

  it('promotes relation endpoints and respects scope roots', () => {
    const tree = buildTree();
    const revealed = buildRevealedEntityTree({
      tree,
      expanded: { api: true },
      scopeRootId: 'api',
      targetRelationIds: new Set(['rel-1']),
      relations: [{ id: 'rel-1', type: 'calls', from: 'orders', to: 'job' }],
      forceExpandToTargets: true,
    });

    expect(revealed.byId.has('orders')).toBe(true);
    expect(revealed.byId.has('job')).toBe(false);
    expect(revealed.byId.get('orders')?.reveal.isRelationEndpoint).toBe(true);
  });
});
