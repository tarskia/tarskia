import { describe, expect, it, vi } from 'vitest';
import type { GraphifyHints } from '../advanced/graphify-hints';
import { testGroupSemantics } from '../advanced/refinement-test-context';
import type { SchemaFlowCatalog } from '../advanced/schema-flow-catalog';
import { buildSchemaActivation, parseDocument } from '../semantic';
import { GRAPHIFY_HINTS_GUARDRAIL } from './graphify-hints-prompt';
import {
  buildWave1ReviewPrompt,
  buildWave1ReviewRepairPrompt,
  CodexWave1Reviewer,
} from './wave1-reviewer';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

function testSchemaFlowCatalog(): SchemaFlowCatalog {
  return {
    activeSchemaRefs: [act('core/web-app@0.3')],
    entries: [
      {
        typeId: 'core/web-app.types.service',
        label: 'Service',
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
    ],
    groups: {
      sources: [],
      through: ['core/web-app.types.service'],
      sinks: [],
      none: [],
      preferredWithoutFlow: [],
    },
  };
}

function testGraphifyHints(): GraphifyHints {
  return {
    version: 1,
    status: 'available',
    mode: 'code-only',
    generatedAt: '2026-01-01T00:00:00.000Z',
    graphifyPackage: 'graphifyy==0.6.7',
    corpus: {
      codeFiles: 2,
      nodes: 3,
      edges: 2,
      communities: 1,
      extractedEdges: 1,
      inferredEdges: 1,
      ambiguousEdges: 0,
    },
    centralNodes: [],
    communities: [],
    bridgeNodes: [],
    extractedRelations: [],
    inferredRelations: [],
    warnings: [],
    artifacts: {
      graphJson: 'analysis/graphify/graph.json',
      extractionJson: 'analysis/graphify/extraction.json',
      reportMarkdown: 'analysis/graphify/GRAPH_REPORT.md',
      summaryMarkdown: 'analysis/graphify-hints.md',
    },
    summaryMarkdown: '# Graphify Code-Structure Hints\n\nGRAPHIFY_SENTINEL: App calls Api\n',
  };
}

function buildInput() {
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
        totalFiles: 10,
        totalDirectories: 4,
        totalLines: 320,
        languages: { typescript: 200 },
        topLevelPaths: [],
      },
      directories: [],
      manifests: [],
      signals: [],
      files: [],
    },
    areaPlan: {
      repoSummary: 'Repository runtime.',
      initialSchemaActivations: [act('core/web-app@0.3')],
      candidateSchemaRefs: [
        {
          schemaRef: 'core/code@0.1',
          suggestedLayer: 1,
          rationale: 'Internal code modules may be needed.',
          evidence: [{ path: 'src/app.ts', reason: 'App code surface' }],
        },
      ],
      keyConcepts: [],
      areas: [],
    },
    promptPackage: {
      contract: { schemaCatalog: [] } as never,
      renderedContract: 'Validation-backed contract:',
      metaOntologyMarkdown: '# Tarskia Diagram Meta-Ontology\n\n## Flow First',
      schemaCatalogJson: '[]',
    },
    activeSchemaRefs: [act('core/web-app@0.3')],
    semantics: testGroupSemantics,
    schemaFlowCatalog: testSchemaFlowCatalog(),
    candidateSchemaRefs: [
      {
        schemaRef: 'core/code@0.1',
        suggestedLayer: 1,
        rationale: 'Internal code modules may be needed.',
        evidence: [{ path: 'src/app.ts', reason: 'App code surface' }],
      },
    ],
    level0BackboneYaml: `version: 0.1.0
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
  - id: backend
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: src/backend.ts
relations:
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
    flowBuildState: {
      level0Doc: parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities: []
relations: []
`),
      level0EdgeIds: ['app-calls-backend'],
      activeFrontier: [],
      terminatedNodes: [],
      refinementQueue: [],
      edgeBindings: [],
      visibleResponsibilityIds: ['app', 'backend'],
    },
    wave1DocumentYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    children:
      - id: app/runtime
        type: core/web-app.types.service
  - id: backend
    type: core/web-app.types.service
relations:
  - id: app-runtime-calls-backend
    type: core/software.relations.calls
    from: app/runtime
    to: backend
`,
    wave1Summary: {
      rootIds: ['app', 'backend'],
      roots: [
        {
          rootId: 'app',
          typeId: 'core/web-app.types.application',
          name: 'App',
          scope: ['src/app.ts'],
          evidence: [{ path: 'src/app.ts', reason: 'App root' }],
          queuedForRefinement: true,
          directChildren: [
            {
              id: 'app/runtime',
              localId: 'runtime',
              name: 'Runtime',
              typeId: 'core/web-app.types.service',
              queueDecision: 'expand' as const,
              scope: ['src/app.ts'],
              evidence: [{ path: 'src/app.ts', reason: 'Runtime' }],
            },
          ],
          refinement: {
            description: 'Runtime split',
            openQuestions: [],
            relations: [],
            edgeRefinements: [
              {
                edgeId: 'app-calls-backend',
                fromChildLocalId: 'runtime',
              },
            ],
            edgeProposals: [],
          },
        },
      ],
      rootRelations: [
        {
          id: 'app-calls-backend',
          typeId: 'core/software.relations.calls',
          fromId: 'app',
          toId: 'backend',
          evidence: [{ path: 'src/app.ts', reason: 'App calls backend' }],
        },
      ],
      visibleRelations: [
        {
          id: 'app-runtime-calls-backend',
          typeId: 'core/software.relations.calls',
          fromId: 'app/runtime',
          toId: 'backend',
          evidence: [{ path: 'src/app.ts', reason: 'Runtime calls backend' }],
        },
      ],
      activeEdgeProposals: [],
      pendingDepth1NodeIds: ['app/runtime'],
      pendingDepth1QueueDecisionByNodeId: {
        'app/runtime': 'expand' as const,
      },
      reviewedDepths: [],
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('CodexWave1Reviewer', () => {
  it('builds the wave-1 review prompt and parses a JSON patch', async () => {
    const thread = {
      id: 'thread-wave1-123',
      run: vi.fn().mockResolvedValue({
        finalResponse: `{
  "rootEdits": [
    {
      "rootId": "app",
      "refinement": {
        "children": [
          {
            "localId": "runtime",
            "name": "Runtime",
            "typeId": "core/web-app.types.service",
            "scope": ["src/app.ts"],
            "evidence": [{"path": "src/app.ts", "reason": "Runtime"}],
            "queueDecision": "expand"
          }
        ],
        "relations": [],
        "edgeRefinements": [
          {
            "edgeId": "app-calls-backend",
            "fromChildLocalId": "runtime"
          }
        ]
      }
    }
  ]
}`,
      }),
    };
    const client = {
      startThread: vi.fn(() => thread),
    };
    const reviewer = new CodexWave1Reviewer({ client });

    const result = await reviewer.reviewWave1(buildInput());

    expect(result.patch.rootEdits?.[0]?.rootId).toBe('app');
    expect(thread.run.mock.calls[0][0]).toContain('Current wave-1 partial document YAML:');
    expect(thread.run.mock.calls[0][0]).toContain('Current wave-1 summary JSON:');
    expect(thread.run.mock.calls[0][0]).toContain('Review the current first-level decomposition');
    expect(thread.run.mock.calls[0][0]).toContain('replaceRootRelations');
    expect(thread.run.mock.calls[0][0]).not.toContain('architectureOverview');
    expect(thread.run.mock.calls[0][0]).toContain('omitted fields preserve the existing value');
    expect(thread.run.mock.calls[0][0]).toContain('Empty replaceRootRelations is ignored');
    expect(thread.run.mock.calls[0][0]).toContain('must not contain nested children');
    expect(thread.run.mock.calls[0][0]).toContain('Active schema flow catalogue:');
    expect(thread.run.mock.calls[0][0]).toContain(
      'Do not break source/sink/flow-through continuity',
    );
    expect(thread.run.mock.calls[0][0]).toContain(
      'Relation endpoints deeper than root/direct-child',
    );
  });

  it('includes diagnostics and the previous patch in the repair prompt', () => {
    const prompt = buildWave1ReviewRepairPrompt({
      ...buildInput(),
      previousPatch: {
        removeVisibleRelationIds: ['old-edge'],
      },
      candidateWave1DocumentYaml: 'version: 0.1.0\nentities: []\nrelations: []\n',
      diagnostics: [],
      attempt: 1,
    });

    expect(prompt).toContain('Diagnostics to fix:');
    expect(prompt).toContain('Previous patch to repair:');
    expect(prompt).toContain('Candidate wave-1 document after previous patch');
    expect(prompt).toContain('complete replacement patch');
    expect(prompt).toContain('Current wave-1 partial document YAML:');
    expect(prompt).toContain('Current wave-1 summary JSON:');
  });

  it('includes Graphify hints and guardrails in the wave-1 review prompt', () => {
    const prompt = buildWave1ReviewPrompt({
      ...buildInput(),
      graphifyHints: testGraphifyHints(),
    });

    expect(prompt).toContain('Graphify deterministic code-structure hints:');
    expect(prompt).toContain(GRAPHIFY_HINTS_GUARDRAIL);
    expect(prompt).toContain('GRAPHIFY_SENTINEL: App calls Api');
  });

  it('uses the wave1-review scope when an injected prompt runner is available', async () => {
    const client = {
      startThread: vi.fn(),
    };
    const promptRunner = {
      runPrompt: vi.fn().mockResolvedValue({
        finalResponse: '{}',
        items: [],
        usage: null,
        threadId: 'thread-wave1-shared',
      }),
      getThreadId: vi.fn(() => 'thread-wave1-shared'),
      isScopePrimed: vi.fn(() => false),
    };
    const reviewer = new CodexWave1Reviewer({ client });

    const result = await reviewer.reviewWave1({
      ...buildInput(),
      promptRunner,
      handoffArtifactPath: '/tmp/job/out/analysis/wave1-review.handoff.md',
    });

    expect(promptRunner.runPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'advanced wave-1 review',
        scope: 'wave1-review',
        handoffArtifactPath: '/tmp/job/out/analysis/wave1-review.handoff.md',
      }),
    );
    expect(client.startThread).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-wave1-shared');
  });

  it('can build a compact wave-1 review prompt shape', () => {
    const prompt = buildWave1ReviewPrompt(buildInput(), { compact: true });

    expect(prompt).toContain('Continue the existing wave1-review conversation');
    expect(prompt).not.toContain('Validation-backed contract:');
    expect(prompt).toContain('Current wave-1 summary JSON:');
  });
});
