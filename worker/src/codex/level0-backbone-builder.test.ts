import { describe, expect, it, vi } from 'vitest';
import type { GraphifyHints } from '../advanced/graphify-hints';
import { testGroupSemantics } from '../advanced/refinement-test-context';
import type { SchemaFlowCatalog } from '../advanced/schema-flow-catalog';
import { buildSchemaActivation } from '../semantic';
import { GRAPHIFY_HINTS_GUARDRAIL } from './graphify-hints-prompt';
import {
  buildLevel0BackbonePrompt,
  buildLevel0BackboneRepairPrompt,
  CodexLevel0BackboneBuilder,
} from './level0-backbone-builder';

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
        {
          id: 'backend',
          kind: 'service' as const,
          title: 'Backend',
          paths: ['src/backend'],
          rationale: 'Serve the API.',
          evidence: [{ path: 'src/backend.ts', reason: 'API bootstrap' }],
          groupingHints: ['May absorb protocol concepts beneath it'],
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
    schemaValidationCommand: 'node out/analysis/validate-schema-selection.mjs',
    candidateSchemaRefs: [
      {
        schemaRef: 'core/code@0.1',
        suggestedLayer: 1,
        rationale: 'Internal implementation modules may be needed.',
        evidence: [{ path: 'src/frontend.tsx', reason: 'Frontend code surface' }],
      },
    ],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('CodexLevel0BackboneBuilder', () => {
  it('builds the level-0 prompt and parses YAML output', async () => {
    const thread = {
      id: 'thread-level0-123',
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
    type: core/web-app.types.external-api
    provenance:
      locations:
        - input: primary
          path: src/backend.ts
relations:
  - id: edge-1
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
    const builder = new CodexLevel0BackboneBuilder({ client });

    const result = await builder.buildLevel0Backbone(buildInput());

    expect(result.doc.entities.map((entity) => entity.id)).toEqual(['frontend', 'backend']);
    expect(result.doc.relations[0]?.id).toBe('edge-1');
    expect(thread.run.mock.calls[0][0]).toContain('Generate the level-0 semantic backbone YAML');
    expect(thread.run.mock.calls[0][0]).toContain(
      'Treat concept-plan items as evidence-backed review material, not required nodes.',
    );
    expect(thread.run.mock.calls[0][0]).toContain('Advisory concept plan:');
    expect(thread.run.mock.calls[0][0]).toContain('Planner-selected initial schema activations:');
    expect(thread.run.mock.calls[0][0]).toContain('Active schema flow catalogue:');
    expect(thread.run.mock.calls[0][0]).toContain('Schema selection validation command:');
    expect(thread.run.mock.calls[0][0]).toContain(
      'node out/analysis/validate-schema-selection.mjs',
    );
    expect(thread.run.mock.calls[0][0]).toContain('core/web-app.types.service');
    expect(thread.run.mock.calls[0][0]).toContain('Diagram meta-ontology:');
  });

  it('normalizes provenance input/paths shorthand from model output', async () => {
    const thread = {
      id: 'thread-level0-shorthand',
      run: vi.fn().mockResolvedValue({
        finalResponse: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: frontend
    type: core/web-app.types.application
    provenance:
      input: primary
      paths:
        - src/frontend.tsx
        - src/routes.ts
relations:
  - id: edge-1
    type: core/software.relations.calls
    from: frontend
    to: backend
    provenance:
      input: primary
      path: src/frontend.tsx
`,
      }),
    };
    const client = {
      startThread: vi.fn(() => thread),
    };
    const builder = new CodexLevel0BackboneBuilder({ client });

    const result = await builder.buildLevel0Backbone(buildInput());

    expect(result.doc.entities[0]?.provenance?.locations).toEqual([
      { input: 'primary', path: 'src/frontend.tsx' },
      { input: 'primary', path: 'src/routes.ts' },
    ]);
    expect(result.doc.relations[0]?.provenance?.locations).toEqual([
      { input: 'primary', path: 'src/frontend.tsx' },
    ]);
    expect(result.rawYaml).toContain('locations:');
    expect(result.rawYaml).not.toContain('paths:');
  });

  it('includes flow-state repair context in the repair prompt', () => {
    const prompt = buildLevel0BackboneRepairPrompt({
      ...buildInput(),
      previousBackboneYaml: 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []\n',
      diagnostics: [],
      attempt: 1,
      flowBuildState: {
        level0Doc: {
          version: '0.1.0',
          schemaRefs: [act('core/web-app@0.3')],
          entities: [],
          relations: [],
        },
        level0EdgeIds: ['edge-1'],
        activeFrontier: [
          {
            entityId: 'backend',
            entityTypeId: 'core/web-app.types.api',
            side: 'egress',
            flowRole: 'through',
            mayTerminate: true,
            attemptCount: 0,
          },
        ],
        terminatedNodes: [],
        refinementQueue: [],
        edgeBindings: [],
        visibleResponsibilityIds: ['frontend', 'backend'],
      },
    });

    expect(prompt).toContain('Current flow analysis summary:');
    expect(prompt).toContain('backend missing egress');
    expect(prompt).toContain('attempt continuation before leaving them unresolved');
    expect(prompt).toContain('Keep the backbone focused on runtime architecture.');
  });

  it('includes Graphify hints and guardrails in the backbone prompt', () => {
    const prompt = buildLevel0BackbonePrompt({
      ...buildInput(),
      graphifyHints: testGraphifyHints(),
    });

    expect(prompt).toContain('Graphify deterministic code-structure hints:');
    expect(prompt).toContain(GRAPHIFY_HINTS_GUARDRAIL);
    expect(prompt).toContain('GRAPHIFY_SENTINEL: App calls Api');
  });

  it('uses a compact warm-scope prompt shape when pre-refinement context already exists', () => {
    const prompt = buildLevel0BackbonePrompt(buildInput(), { compact: true });

    expect(prompt).toContain('Continue the existing pre-refinement conversation.');
    expect(prompt).not.toContain('Validation-backed contract:');
    expect(prompt).not.toContain('Schema selection catalog:');
    expect(prompt).toContain(
      'Use bootstrap files, package manifests, service units, postinstall hooks, completions, installers, and container/init wiring as evidence for shipped runtime boundaries',
    );
  });

  it('uses an injected prompt runner instead of starting its own thread', async () => {
    const client = {
      startThread: vi.fn(),
    };
    const promptRunner = {
      runPrompt: vi.fn().mockResolvedValue({
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
    type: core/web-app.types.external-api
    provenance:
      locations:
        - input: primary
          path: src/backend.ts
relations:
  - id: edge-1
    type: core/software.relations.calls
    from: frontend
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/frontend.tsx
`,
        items: [],
        usage: null,
        threadId: 'thread-shared',
      }),
      getThreadId: vi.fn(() => 'thread-shared'),
      isScopePrimed: vi.fn(() => false),
    };
    const builder = new CodexLevel0BackboneBuilder({ client });

    const result = await builder.buildLevel0Backbone({
      ...buildInput(),
      promptRunner,
      handoffArtifactPath: '/tmp/job/out/analysis/pre-refinement.handoff.md',
    });

    expect(promptRunner.runPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'advanced level-0 backbone drafting',
        scope: 'pre-refinement',
        handoffArtifactPath: '/tmp/job/out/analysis/pre-refinement.handoff.md',
      }),
    );
    expect(client.startThread).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-shared');
  });

  it('repairs from a mixed prose plus YAML response', async () => {
    const thread = {
      id: 'thread-level0-repair',
      run: vi.fn().mockResolvedValue({
        finalResponse: [
          'I read `out/analysis/level0-backbone.response.yaml`:',
          '',
          'version: 0.1.0',
          'schemaRefs:',
          '  - schema: core/web-app@0.3',
          '    layer: 0',
          'entities: []',
          'relations: []',
        ].join('\n'),
        items: [],
        usage: null,
      }),
    };
    const client = {
      startThread: vi.fn(() => thread),
    };
    const builder = new CodexLevel0BackboneBuilder({ client });

    const result = await builder.repairLevel0Backbone({
      ...buildInput(),
      previousBackboneYaml: 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []\n',
      diagnostics: [],
      attempt: 1,
      flowBuildState: {
        level0Doc: {
          version: '0.1.0',
          schemaRefs: [act('core/web-app@0.3')],
          entities: [],
          relations: [],
        },
        level0EdgeIds: [],
        activeFrontier: [],
        terminatedNodes: [],
        refinementQueue: [],
        edgeBindings: [],
        visibleResponsibilityIds: [],
      },
    });

    expect(result.doc.version).toBe('0.1.0');
    expect(result.doc.schemaRefs).toEqual([act('core/web-app@0.3')]);
  });
});
