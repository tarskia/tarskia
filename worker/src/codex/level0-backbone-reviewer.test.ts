import { describe, expect, it, vi } from 'vitest';
import type { GraphifyHints } from '../advanced/graphify-hints';
import { testGroupSemantics } from '../advanced/refinement-test-context';
import type { SchemaFlowCatalog } from '../advanced/schema-flow-catalog';
import { buildSchemaActivation, parseDocument } from '../semantic';
import { GRAPHIFY_HINTS_GUARDRAIL } from './graphify-hints-prompt';
import {
  buildLevel0BackboneReviewPrompt,
  buildLevel0BackboneReviewRepairPrompt,
  CodexLevel0BackboneReviewer,
} from './level0-backbone-reviewer';

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
          rationale: 'Internal implementation modules may be needed.',
          evidence: [{ path: 'src/frontend.tsx', reason: 'Frontend code surface' }],
        },
      ],
      keyConcepts: [
        {
          id: 'frontend',
          kind: 'frontend' as const,
          title: 'Frontend',
          paths: ['src/frontend'],
          rationale: 'Serve the browser app.',
          evidence: [{ path: 'src/frontend.tsx', reason: 'UI bootstrap' }],
          groupingHints: ['May stay top-level as the client boundary'],
          openQuestions: [] as string[],
        },
      ],
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
        rationale: 'Internal implementation modules may be needed.',
        evidence: [{ path: 'src/frontend.tsx', reason: 'Frontend code surface' }],
      },
    ],
    currentBackboneYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: frontend
    type: core/web-app.types.application
    provenance:
      locations:
        - input: primary
          path: src/frontend.tsx
  - id: backend
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: src/backend.ts
relations:
  - id: frontend-calls-backend
    type: core/software.relations.calls
    from: frontend
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/frontend.tsx
`,
    flowBuildState: {
      level0Doc: parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities: []
relations: []
`),
      level0EdgeIds: ['frontend-calls-backend'],
      activeFrontier: [],
      terminatedNodes: [],
      refinementQueue: [],
      edgeBindings: [],
      visibleResponsibilityIds: ['frontend', 'backend'],
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('CodexLevel0BackboneReviewer', () => {
  it('builds the review prompt and parses YAML output', async () => {
    const thread = {
      id: 'thread-review-123',
      run: vi.fn().mockResolvedValue({
        finalResponse: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: frontend
    type: core/web-app.types.application
    provenance:
      locations:
        - input: primary
          path: src/frontend.tsx
  - id: backend
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: src/backend.ts
relations:
  - id: frontend-calls-backend
    type: core/software.relations.calls
    from: frontend
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/frontend.tsx
`,
      }),
    };
    const client = {
      startThread: vi.fn(() => thread),
    };
    const reviewer = new CodexLevel0BackboneReviewer({ client });

    const result = await reviewer.reviewLevel0Backbone(buildInput());

    expect(result.doc.entities.map((entity) => entity.id)).toEqual(['frontend', 'backend']);
    expect(thread.run.mock.calls[0][0]).toContain('Current accepted level-0 YAML:');
    expect(thread.run.mock.calls[0][0]).toContain('Current flow analysis summary:');
    expect(thread.run.mock.calls[0][0]).toContain('Schema set artifact:');
    expect(thread.run.mock.calls[0][0]).toContain('Active schema flow catalogue:');
    expect(thread.run.mock.calls[0][0]).toContain(
      'Focus on architectural coherence, not local detail.',
    );
  });

  it('includes repair diagnostics and the current reviewed YAML in the repair prompt', () => {
    const prompt = buildLevel0BackboneReviewRepairPrompt({
      ...buildInput(),
      previousReviewYaml: 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []\n',
      diagnostics: [],
      attempt: 1,
    });

    expect(prompt).toContain('Current accepted backbone flow summary:');
    expect(prompt).toContain('Current reviewed YAML to repair:');
    expect(prompt).not.toContain('Accepted backbone before review:');
    expect(prompt).toContain(
      'Preserve the good parts of the reviewed backbone; do not restart from scratch',
    );
  });

  it('includes Graphify hints and guardrails in the review prompt', () => {
    const prompt = buildLevel0BackboneReviewPrompt({
      ...buildInput(),
      graphifyHints: testGraphifyHints(),
    });

    expect(prompt).toContain('Graphify deterministic code-structure hints:');
    expect(prompt).toContain(GRAPHIFY_HINTS_GUARDRAIL);
    expect(prompt).toContain('GRAPHIFY_SENTINEL: App calls Api');
  });

  it('uses the backbone-review scope when an injected prompt runner is available', async () => {
    const client = {
      startThread: vi.fn(),
    };
    const promptRunner = {
      runPrompt: vi.fn().mockResolvedValue({
        finalResponse: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities: []
relations: []
`,
        items: [],
        usage: null,
        threadId: 'thread-review-shared',
      }),
      getThreadId: vi.fn(() => 'thread-review-shared'),
      isScopePrimed: vi.fn(() => false),
    };
    const reviewer = new CodexLevel0BackboneReviewer({ client });

    const result = await reviewer.reviewLevel0Backbone({
      ...buildInput(),
      promptRunner,
      handoffArtifactPath: '/tmp/job/out/analysis/backbone-review.handoff.md',
    });

    expect(promptRunner.runPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'advanced level-0 backbone review',
        scope: 'backbone-review',
        handoffArtifactPath: '/tmp/job/out/analysis/backbone-review.handoff.md',
      }),
    );
    expect(client.startThread).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-review-shared');
  });

  it('can build a compact review prompt shape', () => {
    const prompt = buildLevel0BackboneReviewPrompt(buildInput(), { compact: true });

    expect(prompt).toContain('Continue the existing backbone-review conversation.');
    expect(prompt).not.toContain('Validation-backed contract:');
    expect(prompt).toContain('Current accepted level-0 YAML:');
  });
});
