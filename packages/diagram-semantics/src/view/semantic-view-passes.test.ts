import { describe, expect, it } from 'vitest';
import type { SemanticDocument } from '../model/types';
import { buildEntityTree } from '../tree/entity-tree';
import {
  applyEffectiveExpansion,
  applyRevealAndVisibility,
  applySemanticVisualAugmentation,
} from './compile-diagram-view-tree';
import { normalizeDiagramViewState } from './normalize-diagram-view';
import { buildSemanticViewWorkingTree } from './working-tree';

const buildDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'platform', type: 'group' },
    { id: 'database', type: 'group', parent: 'platform' },
    { id: 'table-group', type: 'group', parent: 'database' },
    { id: 'orders', type: 'leaf', parent: 'table-group' },
    { id: 'customers', type: 'leaf', parent: 'table-group' },
    { id: 'workers', type: 'group', parent: 'platform' },
    { id: 'job', type: 'leaf', parent: 'workers' },
  ],
  relations: [{ id: 'rel-1', type: 'calls', from: 'orders', to: 'job' }],
});

describe('semantic-view working tree passes', () => {
  it('normalizes view state once and strips empty node entries', () => {
    const normalized = normalizeDiagramViewState({
      kind: 'semantic-diagram-view',
      version: 2,
      scopeRootId: 'platform',
      nodesById: {
        platform: { expanded: true },
        empty: {},
      },
      layout: {
        viewport: { x: 1, y: 2, zoom: 3 },
      },
    });

    expect(normalized.view.nodesById).toEqual({
      platform: { expanded: true },
    });
    expect(normalized.layout).toEqual({
      viewport: { x: 1, y: 2, zoom: 3 },
    });
  });

  it('forces expansion down the scoped single-child chain', () => {
    const entityTree = buildEntityTree({
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'platform', type: 'group' },
        { id: 'database', type: 'group', parent: 'platform' },
        { id: 'table-group', type: 'group', parent: 'database' },
        { id: 'orders', type: 'leaf', parent: 'table-group' },
      ],
      relations: [],
      view: {
        kind: 'semantic-diagram-view',
        version: 2,
        scopeRootId: 'platform',
      },
    });
    const workingTree = buildSemanticViewWorkingTree(entityTree);

    const result = applyEffectiveExpansion({
      tree: workingTree,
      normalizedViewState: normalizeDiagramViewState({
        kind: 'semantic-diagram-view',
        version: 2,
        scopeRootId: 'platform',
      }),
    });

    expect(result.effectiveExpanded.platform).toBe(true);
    expect(result.effectiveExpanded.database).toBe(true);
    expect(result.effectiveExpanded['table-group']).toBe(true);
    expect(workingTree.byId.get('database')?.view.focusChainDepth).toBe(0);
    expect(workingTree.byId.get('table-group')?.view.focusChainDepth).toBe(1);
  });

  it('annotates reveal and visibility without materializing a revealed tree', () => {
    const doc = {
      ...buildDoc(),
      view: {
        kind: 'semantic-diagram-view',
        version: 2,
        nodesById: {
          platform: { expanded: true },
          database: { expanded: true },
          'table-group': { expanded: true },
        },
      },
    } satisfies SemanticDocument;
    const entityTree = buildEntityTree(doc);
    const workingTree = buildSemanticViewWorkingTree(entityTree);
    const effectiveExpansion = applyEffectiveExpansion({
      tree: workingTree,
      normalizedViewState: normalizeDiagramViewState(doc.view),
    });

    applyRevealAndVisibility({
      tree: workingTree,
      scopeRootId: effectiveExpansion.scopeRootId,
      effectiveExpanded: effectiveExpansion.effectiveExpanded,
      targetEntityIds: new Set(['orders']),
      targetRelationIds: new Set(),
      relations: doc.relations,
      forceRevealTargets: true,
      preserveExpandedBranches: true,
    });

    expect(workingTree.byId.get('orders')?.view.includedInProjection).toBe(true);
    expect(workingTree.byId.get('orders')?.view.reveal.isTarget).toBe(true);
    expect(workingTree.byId.get('customers')?.view.includedInProjection).toBe(true);
    expect(workingTree.byId.get('customers')?.view.reveal.isPreservedByExpansion).toBe(true);
    expect(workingTree.byId.get('job')?.view.includedInProjection).toBe(false);
  });

  it('computes semantic-visual controls from the working tree', () => {
    const doc = {
      ...buildDoc(),
      view: {
        kind: 'semantic-diagram-view',
        version: 2,
        nodesById: {
          platform: { expanded: true },
        },
      },
    } satisfies SemanticDocument;
    const entityTree = buildEntityTree(doc);
    const workingTree = buildSemanticViewWorkingTree(entityTree);
    const effectiveExpansion = applyEffectiveExpansion({
      tree: workingTree,
      normalizedViewState: normalizeDiagramViewState(doc.view),
    });
    applyRevealAndVisibility({
      tree: workingTree,
      scopeRootId: effectiveExpansion.scopeRootId,
      effectiveExpanded: effectiveExpansion.effectiveExpanded,
      relations: doc.relations,
    });
    applySemanticVisualAugmentation({
      tree: workingTree,
    });

    expect(workingTree.byId.get('platform')?.visual.controls).toEqual(
      expect.objectContaining({
        showZoomControls: true,
        canZoomIn: false,
        canZoomOut: true,
        showChildGroupControls: true,
      }),
    );
  });
});
