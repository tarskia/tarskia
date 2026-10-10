import { describe, expect, it, vi } from 'vitest';
import type { NodeRefinerInput } from '../advanced/graph-builders';
import type { SchemaFlowCatalog } from '../advanced/schema-flow-catalog';
import { buildSchemaActivation } from '../semantic';
import {
  buildNodeRefinementPrompt,
  buildNodeRefinementRepairPrompt,
  CodexNodeRefiner,
} from './node-refiner';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

function testSchemaFlowCatalog(): SchemaFlowCatalog {
  return {
    activeSchemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
    entries: [
      {
        typeId: 'core/code.types.module',
        label: 'Module',
        flowRole: 'through',
        expectsIngress: true,
        expectsEgress: true,
        mayTerminate: false,
        expectedRelationIds: ['core/software.relations.calls'],
        relationParticipation: [
          { relationId: 'core/software.relations.calls', from: true, to: true },
        ],
        traitIds: [],
      },
      {
        typeId: 'core/web-app.types.group',
        label: 'Group',
        flowRole: 'none',
        expectsIngress: false,
        expectsEgress: false,
        mayTerminate: false,
        expectedRelationIds: [],
        relationParticipation: [],
        traitIds: [],
      },
    ],
    groups: {
      sources: [],
      through: ['core/code.types.module'],
      sinks: [],
      none: ['core/web-app.types.group'],
      preferredWithoutFlow: [],
    },
  };
}

function testInput(): NodeRefinerInput {
  return {
    workspace: {
      jobRoot: '/tmp/job',
      targetRepoPath: '/tmp/job/target-repo',
      schemaRepoPath: '/tmp/job/schema-repo',
      workspaceOutputDir: '/tmp/job/out',
      repoRevision: 'abc123',
    },
    repo: 'https://github.com/example/repo',
    ref: 'main',
    repoCensus: {
      repoUrl: 'https://github.com/example/repo',
      requestedRef: 'main',
      repoRevision: 'abc123',
      repoRoot: '/tmp/job/target-repo',
      generatedAt: '2026-01-01T00:00:00.000Z',
      summary: {
        totalFiles: 8,
        totalDirectories: 3,
        totalLines: 200,
        languages: { typescript: 200 },
        topLevelPaths: [],
      },
      directories: [],
      manifests: [],
      signals: [],
      files: [],
    },
    areaPlan: {
      repoSummary: 'Test repo',
      initialSchemaActivations: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
      candidateSchemaRefs: [],
      areas: [],
    },
    task: {
      nodeId: 'persistence-domain-model/commands',
      nodeTypeId: 'core/code.types.module',
      nodeName: 'Persistence commands',
      parentNodeId: 'persistence-domain-model',
      scope: ['server/commands'],
      evidence: [
        {
          path: 'server/commands/documentCollaborativeUpdater.ts',
          reason: 'Transactional persistence path for collaborative updates.',
        },
      ],
      depth: 1,
      inboundEdges: [
        {
          id: 'rel-collaboration-service-calls-persistence-domain-model',
          relationTypeId: 'core/software.relations.calls',
          sourceId: 'collaboration-service',
          targetId: 'persistence-domain-model/commands',
          evidence: [],
          side: 'ingress',
        },
      ],
      outboundEdges: [
        {
          id: 'persistence-domain-model--commands-calls-storage',
          relationTypeId: 'core/software.relations.calls',
          sourceId: 'persistence-domain-model/commands',
          targetId: 'persistence-domain-model/storage',
          evidence: [],
          side: 'egress',
        },
      ],
    },
    activeSchemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
    candidateSchemaRefs: [],
    allowedChildTypeIds: ['core/code.types.module', 'core/web-app.types.group'],
    relationMatrix: {
      'core/code.types.module': {
        'core/code.types.module': ['core/software.relations.calls'],
        'core/web-app.types.group': [],
      },
      'core/web-app.types.group': {
        'core/code.types.module': [],
        'core/web-app.types.group': [],
      },
    },
    schemaFlowCatalog: testSchemaFlowCatalog(),
    surroundingContext: {
      ancestorChain: [
        {
          id: 'persistence-domain-model',
          name: 'Persistence domain model',
          typeId: 'core/code.types.module',
          scope: ['server'],
          directChildren: [
            {
              id: 'persistence-domain-model/commands',
              name: 'Persistence commands',
              typeId: 'core/code.types.module',
            },
            {
              id: 'persistence-domain-model/storage',
              name: 'Persistence storage',
              typeId: 'core/code.types.module',
            },
          ],
        },
      ],
      acceptedSiblings: [
        {
          id: 'persistence-domain-model/storage',
          name: 'Persistence storage',
          typeId: 'core/code.types.module',
        },
      ],
      nearbyAcceptedConcepts: [
        {
          id: 'persistence-domain-model/storage/database-adapters',
          name: 'Database adapters',
          typeId: 'core/code.types.module',
          scope: ['server/storage'],
          reasons: ['overlapping scope/evidence: server'],
        },
      ],
    },
    validationCommand: 'node out/analysis/validate-node-refinement.mjs',
    schemaValidationCommand: 'node out/analysis/validate-schema-selection.mjs',
    promptPackage: {
      contract: { schemaCatalog: [] } as never,
      renderedContract: 'Validation-backed contract:',
      metaOntologyMarkdown: '# Meta ontology',
      schemaCatalogJson: '[]',
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('CodexNodeRefiner prompt', () => {
  it('tells the model to keep inherited-edge refinements selective rather than exhaustive', () => {
    const prompt = buildNodeRefinementPrompt(testInput());

    expect(prompt).toContain('Refined inherited edges are selective, not exhaustive.');
    expect(prompt).toContain(
      'emit as many descendant edge refinements as needed to explain the primary flow through this node coherently.',
    );
    expect(prompt).toContain(
      'You may change the relationTypeId of an inherited edge refinement when refinement changes the correct boundary semantics.',
    );
    expect(prompt).toContain(
      "set edgeId to the handle of one of this task's inboundEdges or outboundEdges",
    );
    expect(prompt).toContain(
      'emit whatever direct children are needed to make the runtime/data flow through this node intelligible and structurally coherent.',
    );
    expect(prompt).toContain(
      'Do not collapse a broad node to a single wrapper child just to stay minimal.',
    );
    expect(prompt).toContain('Keep descriptions short.');
    expect(prompt).toContain('"description": "optional short noun phrase or one sentence"');
    expect(prompt).toContain(
      '"props": {"propertyId": "value when supported by the chosen child type"}',
    );
    expect(prompt).toContain(
      '"relationTypeId": "optional overridden core/...relations.... when refinement changes the edge semantics"',
    );
    expect(prompt).toContain(
      'Do not fan one inherited coarse edge across a broad inventory of similar helpers.',
    );
    expect(prompt).toContain(
      'For an inherited edge that is outbound from this node, refine the local/source side with fromChildLocalId.',
    );
    expect(prompt).toContain(
      'For an inherited edge that is inbound to this node, refine the local/target side with toChildLocalId.',
    );
    expect(prompt).toContain(
      'Do not add relationTypeId to an edgeProposal unless you are intentionally changing the inherited edge semantics.',
    );
    expect(prompt).toContain(
      'populate child props using the exact property ids from the active schemas.',
    );
    expect(prompt).toContain(
      "prefer making the runtime child expandable and emit the implementation child during that child's later refinement",
    );
    expect(prompt).toContain('Surrounding modeled context:');
    expect(prompt).toContain('Ancestor chain for this node:');
    expect(prompt).toContain(
      'Persistence domain model [core/code.types.module] (persistence-domain-model)',
    );
    expect(prompt).toContain('accepted direct children: Persistence commands, Persistence storage');
    expect(prompt).toContain('Already accepted siblings under the same parent/root:');
    expect(prompt).toContain(
      'Nearby accepted concepts in this root subtree that may overlap this node:',
    );
    expect(prompt).toContain('Database adapters [core/code.types.module]');
    expect(prompt).toContain(
      'Do not recreate, reparent, or restate those ancestor, sibling, or nearby concepts',
    );
    expect(prompt).toContain('Schema flow context for this node:');
    expect(prompt).toContain('Allowed flow-through children: core/code.types.module');
    expect(prompt).toContain('A group child must use queueDecision=expand.');
    expect(prompt).toContain('Never emit a group child as leaf');
    expect(prompt).toContain("every direct concrete child must use the parent's groupTypeId");
    expect(prompt).toContain(
      'Do not leave an expandable group disconnected from inherited edge refinements',
    );
    expect(prompt).toContain(
      'A group that would contain only one child is usually the wrong boundary.',
    );
    expect(prompt).not.toContain('explicit leaf group');
    expect(prompt).toContain('Soft caps for this turn: aim for no more than');
    expect(prompt).toContain('treat these as guidance rather than a target');
    expect(prompt).toContain('Local validation command:');
    expect(prompt).toContain('node out/analysis/validate-node-refinement.mjs');
    expect(prompt).toContain('Schema selection validation command:');
    expect(prompt).toContain('node out/analysis/validate-schema-selection.mjs');
    expect(prompt).toContain('Before signing off, run the local validation command at least once');
    expect(prompt).toContain(
      '"description": "optional short noun phrase or one or two short sentences describing this node"',
    );
    expect(prompt).toContain('All levels are about shipped runtime architecture.');
  });

  it('uses a compact warm-scope prompt when node-refinement context is already in-thread', () => {
    const prompt = buildNodeRefinementPrompt(
      {
        workspace: {
          jobRoot: '/tmp/job',
          targetRepoPath: '/tmp/job/target-repo',
          schemaRepoPath: '/tmp/job/schema-repo',
          workspaceOutputDir: '/tmp/job/out',
          repoRevision: 'abc123',
        },
        repo: 'https://github.com/example/repo',
        ref: 'main',
        repoCensus: {
          repoUrl: 'https://github.com/example/repo',
          requestedRef: 'main',
          repoRevision: 'abc123',
          repoRoot: '/tmp/job/target-repo',
          generatedAt: '2026-01-01T00:00:00.000Z',
          summary: {
            totalFiles: 8,
            totalDirectories: 3,
            totalLines: 200,
            languages: { typescript: 200 },
            topLevelPaths: [],
          },
          directories: [],
          manifests: [],
          signals: [],
          files: [],
        },
        areaPlan: {
          repoSummary: 'Test repo',
          initialSchemaActivations: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
          candidateSchemaRefs: [],
          areas: [],
        },
        task: {
          nodeId: 'runtime',
          nodeTypeId: 'core/web-app.types.service',
          nodeName: 'Runtime',
          scope: ['src/runtime'],
          evidence: [{ path: 'src/runtime.ts', reason: 'Runtime entrypoint' }],
          depth: 1,
          inboundEdges: [],
          outboundEdges: [],
        },
        activeSchemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
        candidateSchemaRefs: [],
        allowedChildTypeIds: ['core/code.types.module', 'core/web-app.types.group'],
        relationMatrix: {
          'core/code.types.module': {
            'core/code.types.module': ['core/software.relations.calls'],
            'core/web-app.types.group': [],
          },
          'core/web-app.types.group': {
            'core/code.types.module': [],
            'core/web-app.types.group': [],
          },
        },
        schemaFlowCatalog: testSchemaFlowCatalog(),
        surroundingContext: {
          ancestorChain: [],
          acceptedSiblings: [
            {
              id: 'gateway',
              name: 'Gateway',
              typeId: 'core/web-app.types.service',
            },
          ],
          nearbyAcceptedConcepts: [
            {
              id: 'runtime/http-surface',
              name: 'HTTP surface',
              typeId: 'core/web-app.types.api',
              scope: ['src/http'],
              reasons: ['overlapping scope/evidence: src'],
            },
          ],
        },
        promptPackage: {
          contract: { schemaCatalog: [] } as never,
          renderedContract: 'Validation-backed contract:',
          metaOntologyMarkdown: '# Meta ontology',
          schemaCatalogJson: '[]',
        },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      },
      { compact: true },
    );

    expect(prompt).toContain('Continue the existing node-refinement conversation.');
    expect(prompt).toContain(
      'Reuse the schema contract and detailed node-refinement guidance already established earlier in this thread.',
    );
    expect(prompt).toContain('Already accepted siblings under the same parent/root:');
    expect(prompt).toContain('Gateway [core/web-app.types.service] (gateway)');
    expect(prompt).toContain(
      'scope paths and evidence.path values must be relative to the target repository root only.',
    );
    expect(prompt).toContain('Cross-boundary flow belongs in edgeRefinements or edgeProposals');
    expect(prompt).toContain('do not wrap all evidence in one same-typed group child');
    expect(prompt).toContain(
      'When an expandable child has scope/evidence that overlaps an inherited edge evidence path',
    );
    expect(prompt).toContain('"children": [{"localId":"child-id","name":"Child name"');
    expect(prompt).not.toContain('      "localId": "child-id",');
  });
});

describe('node refinement edge handles', () => {
  function inputWithFourEdges() {
    const input = testInput();
    input.task.inboundEdges.push({ ...input.task.inboundEdges[0], id: 'real.incoming-second' });
    input.task.outboundEdges.push({ ...input.task.outboundEdges[0], id: 'real.outgoing-second' });
    return input;
  }

  it('shows only task handles in full and compact prompts', () => {
    const input = inputWithFourEdges();
    for (const compact of [false, true]) {
      const prompt = buildNodeRefinementPrompt(input, { compact });
      for (const handle of ['in-1', 'in-2', 'out-1', 'out-2'])
        expect(prompt).toContain(`"id": "${handle}"`);
      for (const edge of [...input.task.inboundEdges, ...input.task.outboundEdges])
        expect(prompt).not.toContain(edge.id);
      expect(prompt).toContain(input.task.outboundEdges[1].targetId);
    }
  });

  it('maps repair prose, nested suggestions and previous results back to handles', () => {
    const input = inputWithFourEdges();
    const edgeId = input.task.outboundEdges[1].id;
    const prompt = buildNodeRefinementRepairPrompt({
      ...input,
      attempt: 1,
      diagnostics: [
        {
          domain: 'diagram',
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.test',
          message: `Repair edge ${edgeId}`,
          details: { suggestedEdgeRefinements: [{ edgeId }] },
        },
      ],
      previousResult: {
        children: [],
        relations: [],
        edgeRefinements: [{ edgeId, fromChildLocalId: 'runtime' }],
        edgeProposals: [
          { edgeId: input.task.inboundEdges[1].id, endpoint: 'to', childLocalId: 'runtime' },
        ],
      },
    });
    expect(prompt).toContain('Repair edge out-2');
    expect(prompt).toContain('"edgeId": "out-2"');
    expect(prompt).toContain('"edgeId": "in-2"');
    for (const edge of [...input.task.inboundEdges, ...input.task.outboundEdges])
      expect(prompt).not.toContain(edge.id);
  });

  it('maps both refinement and repair responses before returning worker results', async () => {
    const input = inputWithFourEdges();
    input.promptRunner = {
      isScopePrimed: () => false,
      runPrompt: vi.fn().mockResolvedValue({
        finalResponse: JSON.stringify({
          children: [],
          relations: [],
          edgeRefinements: [{ edgeId: 'out-2', fromChildLocalId: 'runtime' }],
        }),
        threadId: 'test',
        usage: null,
      }),
    } as unknown as NodeRefinerInput['promptRunner'];
    const refiner = new CodexNodeRefiner();
    const first = await refiner.refineNode(input);
    expect(first.result.edgeRefinements[0].edgeId).toBe(input.task.outboundEdges[1].id);
    const repaired = await refiner.repairNode({
      ...input,
      attempt: 1,
      diagnostics: [],
      previousResult: first.result,
    });
    expect(repaired.result.edgeRefinements[0].edgeId).toBe(input.task.outboundEdges[1].id);
  });
});

it('uses an actionable leaf-only contract in refine and repair prompts at expansion limits', () => {
  const input = { ...testInput(), childrenCanExpand: false };
  for (const compact of [false, true]) {
    const prompts = [
      buildNodeRefinementPrompt(input, { compact }),
      buildNodeRefinementRepairPrompt(
        {
          ...input,
          attempt: 1,
          diagnostics: [],
          previousResult: { children: [], relations: [], edgeRefinements: [] },
        },
        { compact },
      ),
    ];
    for (const prompt of prompts) {
      expect(prompt).toContain('Every child must be a leaf');
      expect(prompt).toContain('Return their concrete members as direct children instead');
      expect(prompt).not.toContain('A group child must use queueDecision=expand');
      expect(prompt).not.toContain('collapsing breadth into explicit expandable groups');
    }
  }
});
