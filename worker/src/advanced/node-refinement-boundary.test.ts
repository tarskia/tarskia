import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateNodeRefinementCandidateCommand } from '../node-refinement-validator-cli';
import {
  compileSchemaSemantics,
  diagnosticFingerprint,
  loadSchemaRegistry,
  validateDiagramYaml,
} from '../semantic';
import { buildInitialNodeRefinementState, runNodeRefinement } from './node-refinement-engine';
import { validateIntermediateRefinedState } from './node-refinement-validator';
import { testGroupSemantics } from './refinement-test-context';
import { buildSchemaFlowCatalog } from './schema-flow-catalog';
import type { NodeRefinementResult } from './types';

const input = {
  id: 'primary',
  kind: 'git' as const,
  repo: 'https://github.com/example/repo',
  revision: 'abc123',
  role: 'primary' as const,
};
const evidence = [{ path: 'src/app.ts', reason: 'Runtime implementation' }];
const child = (group: boolean): NodeRefinementResult => ({
  children: [
    {
      localId: group ? 'members' : 'api',
      name: group ? 'Members' : 'API',
      typeId: group ? 'core/web-app.types.group' : 'core/web-app.types.api',
      scope: ['src/app.ts'],
      evidence,
      queueDecision: 'expand',
      ...(group ? { groupMode: 'mixed' as const } : {}),
    },
  ],
  relations: [],
  edgeRefinements: [],
});
async function fixture() {
  const registry = await loadSchemaRegistry(
    path.resolve(process.cwd(), 'test/fixtures/schema-repo'),
  );
  const validated = validateDiagramYaml({
    schemaRegistry: registry,
    documentInputs: [input],
    yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
relations: []
`,
  });
  expect(validated.ok).toBe(true);
  const schema = validated.effectiveSchema!;
  const semantics = compileSchemaSemantics(schema);
  const baseDoc = validated.document!;
  const areaPlan = {
    repoSummary: 'Runtime',
    initialSchemaActivations: baseDoc.schemaRefs!,
    candidateSchemaRefs: [],
    keyConcepts: [
      {
        id: 'app',
        kind: 'service' as const,
        title: 'App',
        paths: ['src'],
        rationale: 'Runtime',
        evidence,
        groupingHints: [],
        openQuestions: [],
      },
    ],
  };
  const state = buildInitialNodeRefinementState({
    semantics: testGroupSemantics,
    level0Doc: baseDoc,
    areaPlan,
    visibleResponsibilityIds: ['app'],
  });
  const schemaContext = {
    activeSchemaRefs: baseDoc.schemaRefs!,
    candidateSchemaRefs: [],
    schema,
    semantics,
    schemaFlowCatalog: buildSchemaFlowCatalog({
      schema,
      semantics,
      activeSchemaRefs: baseDoc.schemaRefs!,
    }),
  };
  return { baseDoc, areaPlan, state, schemaContext };
}
const turn = (result: NodeRefinementResult) => ({
  result,
  rawResponse: JSON.stringify(result),
  threadId: null,
});
async function run(
  f: Awaited<ReturnType<typeof fixture>>,
  refiner: Parameters<typeof runNodeRefinement>[0]['refiner'],
  repairer?: Parameters<typeof runNodeRefinement>[0]['repairer'],
) {
  return runNodeRefinement({
    workspace: {
      jobRoot: '/tmp/job',
      targetRepoPath: '/tmp/job/target-repo',
      schemaRepoPath: '/tmp/job/schema-repo',
      workspaceOutputDir: '/tmp/job/out',
      repoRevision: 'abc123',
    },
    repo: input.repo,
    repoCensus: {} as never,
    promptPackage: {} as never,
    baseDoc: f.baseDoc,
    areaPlan: f.areaPlan,
    initialState: f.state,
    getSchemaContext: () => f.schemaContext,
    refiner,
    repairer,
    logger: { info() {}, warn() {}, error() {} },
    stopBeforeDepth: 1,
  });
}
describe('final-depth policy and legacy checkpoint budgets', () => {
  it('repairs a group into concrete leaves at the maxDepth boundary', async () => {
    const f = await fixture();
    f.state.budgets.maxDepth = 1;
    const refiner = { refineNode: vi.fn().mockResolvedValue(turn(child(true))) };
    const repairer = { repairNode: vi.fn().mockResolvedValue(turn(child(false))) };
    const result = await run(f, refiner, repairer);
    expect(repairer.repairNode).toHaveBeenCalledTimes(1);
    expect(refiner.refineNode.mock.calls[0][0].childrenCanExpand).toBe(false);
    expect(repairer.repairNode.mock.calls[0][0].childrenCanExpand).toBe(false);
    expect(repairer.repairNode.mock.calls[0][0].diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.leaf_group_child',
          message: expect.stringContaining('direct children'),
        }),
      ]),
    );
    expect(result.nodesById['app/api'].queueDecision).toBe('leaf');
    expect(result.nodesById['app/members']).toBeUndefined();
    expect(result.budgets.turnsUsed).toBe(2);
  });

  it('keeps children expandable after a legacy work-item cap is reached', async () => {
    const f = await fixture();
    f.state.budgets.maxWorkItems = f.state.budgets.workItemsCreated;
    const refiner = { refineNode: vi.fn().mockResolvedValue(turn(child(false))) };
    const repairer = { repairNode: vi.fn() };
    const result = await run(f, refiner, repairer);
    expect(refiner.refineNode.mock.calls[0][0].childrenCanExpand).toBe(true);
    expect(repairer.repairNode).not.toHaveBeenCalled();
    expect(result.nodesById['app/api'].queueDecision).toBe('expand');
    expect(result.queue.map((task) => task.nodeId)).toEqual(['app/api']);
    expect(result.budgets.workItemsCreated).toBe(2);
  });

  it('keeps children expandable during repair after a legacy turn cap is reached', async () => {
    const f = await fixture();
    f.state.budgets.maxTurns = 1;
    const malformed = child(false);
    malformed.children[0].typeId = 'missing.types.unknown';
    const refiner = { refineNode: vi.fn().mockResolvedValue(turn(malformed)) };
    const repairer = { repairNode: vi.fn().mockResolvedValue(turn(child(false))) };
    const result = await run(f, refiner, repairer);
    expect(repairer.repairNode).toHaveBeenCalledTimes(1);
    expect(repairer.repairNode.mock.calls[0][0].childrenCanExpand).toBe(true);
    expect(result.nodesById['app/api'].queueDecision).toBe('expand');
    expect(result.queue.map((task) => task.nodeId)).toEqual(['app/api']);
    expect(result.budgets.turnsUsed).toBe(2);
  });

  it('continues a resumed task whose persisted turn count already reached its legacy cap', async () => {
    const f = await fixture();
    f.state.budgets.maxTurns = 1;
    f.state.budgets.turnsUsed = 1;
    const refiner = { refineNode: vi.fn().mockResolvedValue(turn(child(false))) };
    const result = await run(f, refiner);
    expect(refiner.refineNode).toHaveBeenCalledTimes(1);
    expect(refiner.refineNode.mock.calls[0][0].childrenCanExpand).toBe(true);
    expect(result.nodesById['app/api'].queueDecision).toBe('expand');
    expect(result.budgets.turnsUsed).toBe(2);
  });

  it('drains more than 150 real refinement tasks despite legacy persisted caps', async () => {
    const f = await fixture();
    const count = 257;
    f.baseDoc.entities = Array.from({ length: count }, (_, index) => ({
      ...f.baseDoc.entities[0],
      id: `app-${index}`,
    }));
    const state = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc: f.baseDoc,
      areaPlan: f.areaPlan,
      visibleResponsibilityIds: f.baseDoc.entities.map((entity) => entity.id),
    });
    state.budgets.maxTurns = 150;
    state.budgets.maxWorkItems = 256;
    f.state = JSON.parse(JSON.stringify(state));
    const refiner = {
      refineNode: vi
        .fn()
        .mockResolvedValue(turn({ children: [], relations: [], edgeRefinements: [] })),
    };
    const result = await run(f, refiner);
    expect(refiner.refineNode).toHaveBeenCalledTimes(count);
    expect(new Set(refiner.refineNode.mock.calls.map(([input]) => input.task.nodeId)).size).toBe(
      count,
    );
    expect(result.queue).toEqual([]);
    expect(Object.keys(result.refinementsByNodeId)).toHaveLength(count);
    expect(result.budgets.turnsUsed).toBe(count);
    expect(result.budgets.workItemsCreated).toBe(count);
  });

  it('CLI applies the same group policy and excludes existing baseline errors from hard diagnostics', async () => {
    const f = await fixture();
    f.state.budgets.maxDepth = 1;
    // An unrelated invalid relation exists before this node is refined.
    f.state.edgeContracts.push({
      id: 'existing',
      sourceId: 'absent',
      targetId: 'app',
      sourceTypeId: 'core/web-app.types.application',
      targetTypeId: 'core/web-app.types.application',
      relationTypeId: 'core/software.relations.calls',
      evidence,
    });
    const { assembleRefinedDocument } = await import('./node-refinement-engine');
    const baseline = validateIntermediateRefinedState({
      state: f.state,
      assembledDoc: assembleRefinedDocument({
        semantics: testGroupSemantics,
        state: f.state,
        baseDoc: f.baseDoc,
      }),
      schemaContext: f.schemaContext,
      primaryDocumentInput: input,
    });
    expect(
      baseline.some((d) => d.severity === 'error' && !d.code.startsWith('diagram.flow.')),
    ).toBe(true);
    const jobRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tar65-validator-'));
    try {
      await fs.cp(
        path.resolve(process.cwd(), 'test/fixtures/schema-repo'),
        path.join(jobRoot, 'schema-repo'),
        { recursive: true },
      );
      await fs.writeFile(
        path.join(jobRoot, 'context.json'),
        JSON.stringify({
          version: 1,
          task: f.state.queue[0],
          state: f.state,
          baseDoc: f.baseDoc,
          activeSchemaRefs: f.schemaContext.activeSchemaRefs,
          primaryDocumentInput: input,
          baselineDiagnosticFingerprints: baseline.map(diagnosticFingerprint),
        }),
      );
      const group = await validateNodeRefinementCandidateCommand({
        jobRoot,
        contextPath: 'context.json',
        rawResponse: JSON.stringify(child(true)),
      });
      expect(group.hardDiagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'diagram.node_refinement.leaf_group_child' }),
        ]),
      );
      const concrete = await validateNodeRefinementCandidateCommand({
        jobRoot,
        contextPath: 'context.json',
        rawResponse: JSON.stringify(child(false)),
      });
      expect(concrete.hardDiagnostics).toEqual([]);
      expect(concrete.hardOk).toBe(true);
    } finally {
      await fs.rm(jobRoot, { recursive: true, force: true });
    }
  });
});

it('does not silently prune an ambiguous inherited relation after bounded repairs', async () => {
  const f = await fixture();
  const edges = ['first', 'second'].map((id) => ({
    id,
    sourceId: 'app',
    sourceTypeId: 'core/web-app.types.application',
    targetId: 'store',
    targetTypeId: 'core/web-app.types.datastore',
    relationTypeId: 'core/software.relations.writes',
    evidence,
  }));
  f.state.edgeContracts = edges;
  f.state.queue[0].outboundEdges = edges.map((edge) => ({ ...edge, side: 'egress' as const }));
  const result = child(false);
  result.children[0].queueDecision = 'leaf';
  result.relations = [
    {
      localId: 'write',
      fromLocalId: 'api',
      toLocalId: 'store',
      typeId: 'core/software.relations.writes',
      evidence,
    },
  ];
  const repairer = { repairNode: vi.fn().mockResolvedValue(turn(result)) };
  await expect(
    run(f, { refineNode: vi.fn().mockResolvedValue(turn(result)) }, repairer),
  ).rejects.toThrow('matches several inherited edges (out-1, out-2)');
  expect(repairer.repairNode).toHaveBeenCalledTimes(2);
});
