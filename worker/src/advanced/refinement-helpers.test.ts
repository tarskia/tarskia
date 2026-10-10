import { expect, it } from 'vitest';
import { parseDocument } from '../semantic';
import {
  buildInitialNodeRefinementState,
  evaluateNodeRefinementCandidate,
  findDisconnectedExpandableGroupNodes,
} from './node-refinement-engine';
import { dedupeEdgeContracts, dedupeEdgeProposals } from './refinement-helpers';
import { testGroupSchema, testGroupSemantics } from './refinement-test-context';
import { applyWave1ReviewPatch, parseWave1ReviewPatchResponse } from './wave1-review';

const evidence = [{ path: 'src/app.ts', reason: 'implementation' }];
const areaPlan = {
  repoSummary: 'test',
  initialSchemaActivations: [],
  candidateSchemaRefs: [],
  areas: [],
};
const baseDoc = parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/kubernetes@0.3
    layer: 1
entities:
  - id: app
    name: App
    type: core/web-app.types.service
  - id: backend
    name: Backend
    type: core/web-app.types.external-api
relations:
  - id: original-edge
    type: core/software.relations.calls
    from: app
    to: backend
`);
function initialState() {
  return buildInitialNodeRefinementState({
    semantics: testGroupSemantics,
    level0Doc: baseDoc,
    areaPlan,
    visibleResponsibilityIds: ['app'],
  });
}

it.each([
  'core/web-app.types.group',
  'core/kubernetes.types.group',
])('auto-expands %s and retains group semantics throughout evaluation', async (typeId) => {
  const state = initialState();
  const candidate = await evaluateNodeRefinementCandidate({
    state,
    task: state.queue[0],
    baseDoc,
    schemaContext: {
      schema: testGroupSchema,
      semantics: testGroupSemantics,
      activeSchemaRefs: baseDoc.schemaRefs,
    },
    result: {
      children: [
        {
          localId: 'group',
          name: 'Group',
          typeId,
          groupMode: 'mixed',
          queueDecision: 'leaf',
          scope: ['src/app.ts'],
          evidence,
        },
      ],
      relations: [],
      edgeRefinements: [],
      edgeProposals: [{ edgeId: 'original-edge', endpoint: 'from', childLocalId: 'group' }],
    },
  });
  expect(candidate.result.children[0].queueDecision).toBe('expand');
  expect(candidate.diagnostics.map((item) => item.code)).not.toContain(
    'diagram.node_refinement.non_group_with_group_metadata',
  );
  expect(candidate.nextState.queue.map((task) => task.nodeId)).toContain('app/group');
  expect(candidate.assembledDoc.entities[0].children?.[0].props?.mode).toBe('mixed');
  const disconnected = structuredClone(candidate.nextState);
  disconnected.refinementsByNodeId.app.edgeProposals = [];
  disconnected.refinementsByNodeId.app.edgeRefinements = [];
  expect(findDisconnectedExpandableGroupNodes(disconnected, testGroupSemantics)).toContain(
    'app/group',
  );
});

it('wave-one duplicate contracts keep the first id while merging evidence', () => {
  const state = initialState();
  const reviewed = applyWave1ReviewPatch({
    semantics: testGroupSemantics,
    level0Doc: baseDoc,
    areaPlan,
    visibleResponsibilityIds: ['app'],
    previousState: state,
    patch: {
      addVisibleRelations: [
        {
          id: 'later-duplicate',
          typeId: 'core/software.relations.calls',
          fromId: 'app',
          toId: 'backend',
          evidence,
        },
      ],
    },
  });
  expect(reviewed.rebuiltState.edgeContracts.map((edge) => edge.id)).toEqual(['original-edge']);
  expect(reviewed.rebuiltState.edgeContracts[0].evidence).toEqual(evidence);
});

it('dedupes proposals and contracts without replacing the first record', () => {
  const first = { edgeId: 'e', endpoint: 'from' as const, childLocalId: 'a', extra: 'first' };
  expect(dedupeEdgeProposals([first, { ...first, extra: 'last' }])).toEqual([first]);
  const contract = { id: 'first', sourceId: 'a', targetId: 'b', evidence };
  expect(dedupeEdgeContracts([contract, { ...contract, id: 'last' }])).toEqual([contract]);
});

it('wave-one shares local slugification across children, relations and edge proposals', () => {
  const patch = parseWave1ReviewPatchResponse(
    JSON.stringify({
      rootEdits: [
        {
          rootId: 'app',
          refinement: {
            children: [
              {
                localId: 'Runtime Worker',
                name: 'Runtime',
                typeId: 'core/web-app.types.service',
                queueDecision: 'leaf',
                evidence,
              },
            ],
            relations: [
              {
                localId: 'CALLS Api',
                typeId: 'core/software.relations.calls',
                fromLocalId: 'Runtime Worker',
                toLocalId: 'storage/db',
                evidence,
              },
            ],
            edgeProposals: [
              { edgeId: 'original-edge', endpoint: 'from', childLocalId: 'Runtime Worker' },
            ],
          },
        },
      ],
    }),
  );
  const result = patch.rootEdits?.[0].refinement;
  expect(result?.children?.[0].localId).toBe('runtime-worker');
  expect(result?.relations?.[0]).toMatchObject({
    localId: 'calls-api',
    fromLocalId: 'runtime-worker',
    toLocalId: 'storage/db',
  });
  expect(result?.edgeProposals?.[0].childLocalId).toBe('runtime-worker');
});

it('wave-one cannot invent child evidence from a scope path', () => {
  expect(() =>
    parseWave1ReviewPatchResponse(
      JSON.stringify({
        rootEdits: [
          {
            rootId: 'app',
            refinement: {
              children: [
                {
                  localId: 'Runtime',
                  name: 'Runtime',
                  typeId: 'core/web-app.types.service',
                  queueDecision: 'leaf',
                  scope: ['src/app.ts'],
                },
              ],
            },
          },
        ],
      }),
    ),
  ).toThrow('evidence');
});
