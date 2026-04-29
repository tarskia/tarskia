import { describe, expect, it } from 'vitest';
import type { SemanticDocument } from '../../../model/types';
import { buildCompiledDiagramEdgeId, buildEntityTree } from '../../../semantic';
import type { EdgePlan } from '../transition/sequencer/types';
import { buildSceneTree } from '../tree/scene-tree';
import { buildEdgeLayeringPlan } from './edge-layering';

const buildPlans = (doc: SemanticDocument): EdgePlan[] =>
  doc.relations.map((rel) => ({
    id: buildCompiledDiagramEdgeId(rel.id, rel.from, rel.to),
    relationId: rel.id,
    sourceId: rel.from,
    targetId: rel.to,
    type: rel.type,
    label: rel.label,
  }));

describe('buildEdgeLayeringPlan', () => {
  it('renders sibling edges as local when both endpoints are direct children of the same owner', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'db', type: 'datastore', name: 'DB' },
        { id: 'orders', type: 'table', name: 'orders', parent: 'db' },
        { id: 'customers', type: 'table', name: 'customers', parent: 'db' },
      ],
      relations: [{ id: 'r1', type: 'joins', from: 'orders', to: 'customers' }],
    };
    const tree = buildSceneTree({ tree: buildEntityTree(doc) });
    const plans = buildPlans(doc);
    const visibleIds = new Set(doc.entities.map((entity) => entity.id));

    const layered = buildEdgeLayeringPlan({ tree, edgePlans: plans, visibleIds });

    expect(layered.localByOwner.get('db')?.length).toBe(1);
    expect(layered.routed.length).toBe(0);
  });

  it('routes cross-branch edges and records branch node ids', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'app-a', type: 'application', name: 'App A' },
        { id: 'app-b', type: 'application', name: 'App B' },
        { id: 'api-a', type: 'api', name: 'API A', parent: 'app-a' },
      ],
      relations: [{ id: 'r1', type: 'calls', from: 'api-a', to: 'app-b' }],
    };
    const tree = buildSceneTree({ tree: buildEntityTree(doc) });
    const plans = buildPlans(doc);
    const visibleIds = new Set(doc.entities.map((entity) => entity.id));

    const layered = buildEdgeLayeringPlan({ tree, edgePlans: plans, visibleIds });

    expect(layered.localByOwner.size).toBe(0);
    expect(layered.routed.length).toBe(1);
    expect(layered.routed[0]?.branchNodeIds).toEqual(
      expect.arrayContaining(['api-a', 'app-a', 'app-b']),
    );
  });

  it('omits edges when either endpoint is not visible', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'app-a', type: 'application', name: 'App A' },
        { id: 'app-b', type: 'application', name: 'App B' },
      ],
      relations: [{ id: 'r1', type: 'calls', from: 'app-a', to: 'app-b', tags: ['service'] }],
    };
    const tree = buildSceneTree({ tree: buildEntityTree(doc) });
    const plans = buildPlans(doc);

    const onlyAVisible = new Set<string>(['app-a']);
    const layeredOnlyA = buildEdgeLayeringPlan({
      tree,
      edgePlans: plans,
      visibleIds: onlyAVisible,
    });
    expect(layeredOnlyA.localByOwner.size).toBe(0);
    expect(layeredOnlyA.routed).toEqual([]);

    const bothVisible = new Set<string>(['app-a', 'app-b']);
    const layeredBoth = buildEdgeLayeringPlan({ tree, edgePlans: plans, visibleIds: bothVisible });
    expect(layeredBoth.routed.length).toBe(1);
  });
});
