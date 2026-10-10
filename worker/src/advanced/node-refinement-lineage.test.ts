import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileSchemaSemantics, loadSchemaRegistry, validateDiagramYaml } from '../semantic';
import type { NodeRefinerInput } from './graph-builders';
import { buildNodeRefinementEdgeHandles } from './node-refinement-edge-handles';
import {
  buildInitialNodeRefinementState,
  evaluateNodeRefinementCandidate,
  runNodeRefinement,
} from './node-refinement-engine';
import { testGroupSemantics } from './refinement-test-context';
import { buildSchemaFlowCatalog } from './schema-flow-catalog';
import type { NodeRefinementResult } from './types';

const evidence = [{ path: 'src/runtime.ts', reason: 'Runtime call' }];
const child = (localId: string, expand = false) => ({
  localId,
  name: localId,
  typeId: 'core/web-app.types.service',
  scope: ['src/runtime.ts'],
  evidence,
  queueDecision: expand ? ('expand' as const) : ('leaf' as const),
});
async function fixture() {
  const schemaRegistry = await loadSchemaRegistry(
    path.resolve(process.cwd(), 'test/fixtures/schema-repo'),
  );
  const validated = validateDiagramYaml({
    schemaRegistry,
    yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: x
    type: core/web-app.types.service
  - id: y
    type: core/web-app.types.service
relations:
  - id: x-calls-y
    type: core/software.relations.calls
    from: x
    to: y
`,
  });
  expect(validated.ok).toBe(true);
  const baseDoc = validated.document!;
  const schema = validated.effectiveSchema!;
  const semantics = compileSchemaSemantics(schema);
  const areaPlan = {
    repoSummary: 'Runtime',
    initialSchemaActivations: baseDoc.schemaRefs,
    candidateSchemaRefs: [],
    keyConcepts: ['x', 'y'].map((id) => ({
      id,
      kind: 'service' as const,
      title: id,
      paths: ['src'],
      rationale: 'Runtime',
      evidence,
      groupingHints: [],
      openQuestions: [],
    })),
  };
  const state = buildInitialNodeRefinementState({
    semantics: testGroupSemantics,
    level0Doc: baseDoc,
    areaPlan,
    visibleResponsibilityIds: ['x', 'y'],
  });
  const schemaContext = {
    activeSchemaRefs: baseDoc.schemaRefs,
    candidateSchemaRefs: [],
    schema,
    semantics,
    schemaFlowCatalog: buildSchemaFlowCatalog({
      schema,
      semantics,
      activeSchemaRefs: baseDoc.schemaRefs,
    }),
  };
  return { baseDoc, areaPlan, state, schemaContext };
}
describe('current queue edges and split lineage', () => {
  it.each([
    0, 2,
  ])('rebuilds sibling tasks at depth %i after the first sibling splits the edge', async (splitDepth) => {
    const f = await fixture();
    const observed: NodeRefinerInput['task'][] = [];
    const cacheTasks: NodeRefinerInput['task'][] = [];
    const refined = await runNodeRefinement({
      workspace: {
        jobRoot: '/tmp/job',
        targetRepoPath: '/tmp/job/target-repo',
        schemaRepoPath: '/tmp/job/schema-repo',
        workspaceOutputDir: '/tmp/job/out',
        repoRevision: 'abc123',
      },
      repo: 'https://github.com/example/repo',
      repoCensus: {} as never,
      promptPackage: {} as never,
      baseDoc: f.baseDoc,
      areaPlan: f.areaPlan,
      initialState: f.state,
      getSchemaContext: () => f.schemaContext,
      logger: { info() {}, warn() {}, error() {} },
      loadCachedResult: ({ task }) => {
        cacheTasks.push(task);
        return undefined;
      },
      refiner: {
        refineNode: async ({ task }) => {
          observed.push(task);
          const outbound = task.nodeId.startsWith('x');
          const isLast = task.depth === splitDepth;
          const children = isLast
            ? outbound
              ? [child('a'), child('b')]
              : [child('h')]
            : [child('inner', true)];
          const edgeRefinements = (outbound ? task.outboundEdges : task.inboundEdges).flatMap(
            (edge) =>
              children.map((node) => ({
                edgeId: edge.id,
                ...(outbound
                  ? { fromChildLocalId: node.localId }
                  : { toChildLocalId: node.localId }),
              })),
          );
          const result: NodeRefinementResult = { children, relations: [], edgeRefinements };
          return { result, rawResponse: JSON.stringify(result), threadId: null };
        },
      },
    });
    const yTask = observed.find(
      (task) => task.nodeId.startsWith('y') && task.depth === splitDepth,
    )!;
    expect(yTask.inboundEdges).toHaveLength(2);
    expect(Object.keys(buildNodeRefinementEdgeHandles(yTask))).toEqual(['in-1', 'in-2']);
    expect(
      yTask.inboundEdges.every(
        (edge) => edge.sourceId.endsWith('/a') || edge.sourceId.endsWith('/b'),
      ),
    ).toBe(true);
    expect(cacheTasks.find((task) => task.nodeId === yTask.nodeId)).toEqual(yTask);
    expect(refined.edgeContracts).toHaveLength(2);
    expect(refined.edgeContracts.every((edge) => edge.targetId === `${yTask.nodeId}/h`)).toBe(true);
    expect(refined.refinementsByNodeId[yTask.nodeId].edgeRefinements).toHaveLength(2);
  });

  it('resolves transitive split lineage and preserves it through single-endpoint updates', async () => {
    const f = await fixture();
    const first = await evaluateNodeRefinementCandidate({
      ...f,
      task: f.state.queue[0],
      result: {
        children: [child('a', true), child('b')],
        relations: [],
        edgeRefinements: ['a', 'b'].map((id) => ({ edgeId: 'x-calls-y', fromChildLocalId: id })),
      },
    });
    const aTask = first.nextState.queue.find((task) => task.nodeId === 'x/a')!;
    const second = await evaluateNodeRefinementCandidate({
      ...f,
      state: first.nextState,
      task: aTask,
      result: {
        children: [child('aa'), child('ab')],
        relations: [],
        edgeRefinements: ['aa', 'ab'].map((id) => ({
          edgeId: aTask.outboundEdges[0].id,
          fromChildLocalId: id,
        })),
      },
    });
    const third = await evaluateNodeRefinementCandidate({
      ...f,
      state: second.nextState,
      task: f.state.queue[1],
      result: {
        children: [child('h')],
        relations: [],
        edgeRefinements: [{ edgeId: 'x-calls-y', toChildLocalId: 'h' }],
      },
    });
    expect(third.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(third.nextState.edgeContracts).toHaveLength(3);
    expect(
      third.nextState.edgeContracts.every((edge) => edge.targetId === 'y/h' && edge.refines),
    ).toBe(true);
    expect(third.nextState.refinementsByNodeId.y.edgeRefinements).toHaveLength(3);
    const scoped = await evaluateNodeRefinementCandidate({
      ...f,
      state: second.nextState,
      task: {
        ...f.state.queue[1],
        inboundEdges: [{ ...f.state.queue[1].inboundEdges[0], sourceId: 'x/a' }],
      },
      result: {
        children: [child('h')],
        relations: [],
        edgeRefinements: [{ edgeId: 'x-calls-y', toChildLocalId: 'h' }],
      },
    });
    expect(scoped.nextState.refinementsByNodeId.y.edgeRefinements).toHaveLength(2);
    expect(scoped.nextState.edgeContracts.find((edge) => edge.sourceId === 'x/b')?.targetId).toBe(
      'y',
    );
  });

  it('reports unknown refinements as hard repairable diagnostics', async () => {
    const f = await fixture();
    const evaluated = await evaluateNodeRefinementCandidate({
      ...f,
      task: f.state.queue[0],
      result: {
        children: [child('a')],
        relations: [],
        edgeRefinements: [{ edgeId: 'unknown', fromChildLocalId: 'a' }],
      },
    });
    expect(evaluated.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'diagram.node_refinement.unmatched_edge_refinement',
        severity: 'error',
        relationId: 'unknown',
      }),
    );
  });
});
