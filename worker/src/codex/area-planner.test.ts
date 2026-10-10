import { describe, expect, it, vi } from 'vitest';
import { parseAreaPlanResponse } from '../advanced/area-plan';
import type { GraphifyHints } from '../advanced/graphify-hints';
import { buildAreaPlanningPrompt, CodexAreaPlanner } from './area-planner';
import { GRAPHIFY_HINTS_GUARDRAIL } from './graphify-hints-prompt';

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

describe('CodexAreaPlanner', () => {
  it('builds a bounded planning prompt and parses structured JSON', async () => {
    const thread = {
      id: 'thread-plan-123',
      run: vi.fn().mockResolvedValue({
        finalResponse: JSON.stringify({
          repoSummary: 'Web app plus backend service and deploy surface.',
          galleryDescription: 'Web app with backend service and deploy surface',
          initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
          candidateSchemaRefs: [
            {
              schemaRef: 'core/code@0.1',
              suggestedLayer: 1,
              rationale: 'Internal implementation structure is likely useful later.',
              evidence: [
                {
                  path: 'apps/web/src/routes/index.ts',
                  reason: 'Code-bearing route surface',
                },
              ],
            },
          ],
          keyConcepts: [
            {
              id: 'web',
              kind: 'frontend',
              title: 'Web app',
              paths: ['apps/web'],
              rationale: 'Contains the browser-facing app.',
              evidence: [
                {
                  path: 'apps/web/src/routes/index.ts',
                  reason: 'Route surface',
                },
              ],
              groupingHints: [],
              openQuestions: [],
            },
          ],
        }),
      }),
    };
    const client = {
      startThread: vi.fn(() => thread),
    };
    const planner = new CodexAreaPlanner({
      client,
      model: 'gpt-5.3-codex',
    });

    const result = await planner.planAreas({
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
          languages: { typescript: 200, go: 120 },
          topLevelPaths: [
            {
              path: 'apps',
              fileCount: 6,
              lineCount: 220,
              languages: { typescript: 200 },
            },
          ],
        },
        directories: [],
        manifests: [],
        signals: [
          {
            path: 'apps/web/src/routes/index.ts',
            kind: 'route-surface',
            confidence: 'medium',
            reason: 'Common route directory heuristic matched',
          },
        ],
        files: [],
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Tarskia Diagram Meta-Ontology\n\n## Flow First',
        schemaCatalogJson: '[]',
      },
      schemaValidationCommand: 'node out/analysis/validate-schema-selection.mjs',
    });

    expect(result.plan.repoSummary).toContain('Web app plus backend service');
    expect(result.plan.galleryDescription).toBe('Web app with backend service and deploy surface');
    expect(result.plan.keyConcepts).toHaveLength(1);
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: '/tmp/job',
        skipGitRepoCheck: true,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        webSearchMode: 'disabled',
        model: 'gpt-5.3-codex',
      }),
    );
    expect(thread.run.mock.calls[0][0]).toContain(
      'Repo census artifact: out/analysis/repo-census.json',
    );
    expect(thread.run.mock.calls[0][0]).toContain('Schema selection catalog:');
    expect(thread.run.mock.calls[0][0]).toContain('Schema selection validation command:');
    expect(thread.run.mock.calls[0][0]).toContain(
      'node out/analysis/validate-schema-selection.mjs',
    );
    expect(thread.run.mock.calls[0][0]).toContain(
      'At every level, prefer shipped runtime architecture over tests, tooling, examples, local dev helpers, packaging/install scaffolding, and dev-only endpoints.',
    );
    expect(thread.run.mock.calls[0][0]).toContain('Return JSON only with this exact shape:');
    expect(thread.run.mock.calls[0][0]).toContain('"galleryDescription": "80 characters or fewer"');
    expect(thread.run.mock.calls[0][0]).toContain(
      'The concepts are advisory review material for the backbone, not required nodes.',
    );
  });

  it('normalizes fenced JSON responses', () => {
    const plan = parseAreaPlanResponse(`\`\`\`json
{"repoSummary":"Summary","galleryDescription":"Backend API runtime","areas":[{"id":"api","title":"API","paths":["backend"],"rationale":"Important protocol surface","evidence":[{"path":"backend/cmd/api/main.go","reason":"Entrypoint"}],"groupingHints":["May sit under a broader backend runtime"],"openQuestions":["Which jobs are central?"]}]}
\`\`\``);

    expect(plan.keyConcepts?.[0]).toEqual(
      expect.objectContaining({
        id: 'api',
        title: 'API',
        groupingHints: ['May sit under a broader backend runtime'],
      }),
    );
    expect(plan.initialSchemaActivations).toEqual([]);
    expect(plan.candidateSchemaRefs).toEqual([]);
    expect(plan.galleryDescription).toBe('Backend API runtime');
  });

  it('normalizes concept ids to lowercase slugs', () => {
    const plan = parseAreaPlanResponse(
      JSON.stringify({
        repoSummary: 'Summary',
        galleryDescription:
          'Background job queue runtime that coordinates asynchronous work across modules.',
        initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
        candidateSchemaRefs: [
          {
            schemaRef: 'core/code@0.1',
            suggestedLayer: 1,
            rationale: 'Use code schema for internal modules',
            evidence: [{ path: 'workers/queue.ts', reason: 'Code-bearing runtime area' }],
          },
        ],
        keyConcepts: [
          {
            id: 'Background_Jobs_And_Queues',
            kind: 'async-plane',
            title: 'Background Jobs And Queues',
            paths: ['workers'],
            rationale: 'Async runtime area',
            evidence: [{ path: 'workers/queue.ts', reason: 'Queue worker entrypoint' }],
            groupingHints: ['May sit under a broader worker runtime'],
            openQuestions: [],
          },
        ],
      }),
    );

    expect(plan.keyConcepts?.[0]).toEqual(
      expect.objectContaining({
        id: 'background-jobs-and-queues',
      }),
    );
    expect(plan.galleryDescription?.length).toBeLessThanOrEqual(80);
  });

  it('accepts YAML-shaped concept-plan responses in addition to JSON', () => {
    const plan = parseAreaPlanResponse(`
repoSummary: Summary
galleryDescription: YAML-described API runtime
initialSchemaActivations:
  - schema: core/web-app@0.3
    layer: 0
keyConcepts:
  - id: api
    kind: protocol-surface
    title: API
    paths:
      - backend
    rationale: Main server area
    evidence:
      - path: backend/cmd/api/main.go
        reason: Entrypoint
    groupingHints:
      - May fold into a backend service root
`);

    expect(plan.initialSchemaActivations).toEqual([{ schema: 'core/web-app@0.3', layer: 0 }]);
    expect(plan.keyConcepts?.[0]).toEqual(
      expect.objectContaining({
        id: 'api',
        kind: 'protocol-surface',
      }),
    );
  });

  it('uses an injected prompt runner instead of starting its own thread', async () => {
    const client = {
      startThread: vi.fn(),
    };
    const promptRunner = {
      runPrompt: vi.fn().mockResolvedValue({
        finalResponse: JSON.stringify({
          repoSummary: 'Web app plus backend service and deploy surface.',
          galleryDescription: 'Web app with backend service and deploy surface',
          initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
          candidateSchemaRefs: [],
          keyConcepts: [
            {
              id: 'web',
              kind: 'frontend',
              title: 'Web app',
              paths: ['apps/web'],
              rationale: 'Contains the browser-facing app.',
              evidence: [
                {
                  path: 'apps/web/src/routes/index.ts',
                  reason: 'Route surface',
                },
              ],
              groupingHints: [],
              openQuestions: [],
            },
          ],
        }),
        items: [],
        usage: null,
        threadId: 'thread-shared',
      }),
      getThreadId: vi.fn(() => 'thread-shared'),
      isScopePrimed: vi.fn(() => false),
    };
    const planner = new CodexAreaPlanner({
      client,
      model: 'gpt-5.3-codex',
    });

    const result = await planner.planAreas({
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
          languages: { typescript: 200, go: 120 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Tarskia Diagram Meta-Ontology\n\n## Flow First',
        schemaCatalogJson: '[]',
      },
      promptRunner,
      handoffArtifactPath: '/tmp/job/out/analysis/pre-refinement.handoff.md',
    });

    expect(promptRunner.runPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'advanced area planning',
        scope: 'pre-refinement',
        handoffArtifactPath: '/tmp/job/out/analysis/pre-refinement.handoff.md',
      }),
    );
    expect(client.startThread).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-shared');
  });

  it('includes census facts in the planning prompt', () => {
    const prompt = buildAreaPlanningPrompt({
      workspace: {
        jobRoot: '/tmp/job',
        targetRepoPath: '/tmp/job/target-repo',
        schemaRepoPath: '/tmp/job/schema-repo',
        workspaceOutputDir: '/tmp/job/out',
        repoRevision: 'abc123',
      },
      repo: 'https://github.com/example/repo',
      ref: undefined,
      repoCensus: {
        repoUrl: 'https://github.com/example/repo',
        requestedRef: undefined,
        repoRevision: 'abc123',
        repoRoot: '/tmp/job/target-repo',
        generatedAt: '2026-01-01T00:00:00.000Z',
        summary: {
          totalFiles: 42,
          totalDirectories: 8,
          totalLines: 1200,
          languages: { typescript: 700, go: 500 },
          topLevelPaths: [
            {
              path: 'apps',
              fileCount: 21,
              lineCount: 700,
              languages: { typescript: 700 },
            },
          ],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      graphifyHints: testGraphifyHints(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Tarskia Diagram Meta-Ontology\n\n## Flow First',
        schemaCatalogJson: '[]',
      },
    });

    expect(prompt).toContain('Total files: 42');
    expect(prompt).toContain('Target repository: target-repo');
    expect(prompt).toContain('Repo census artifact: out/analysis/repo-census.json');
    expect(prompt).toContain('Graphify deterministic code-structure hints:');
    expect(prompt).toContain(GRAPHIFY_HINTS_GUARDRAIL);
    expect(prompt).toContain('GRAPHIFY_SENTINEL: App calls Api');
    expect(prompt).toContain('initialSchemaActivations');
    expect(prompt).toContain('Create 4 to 12 key architectural concepts');
    expect(prompt).toContain('keyConcepts');
    expect(prompt).toContain(
      'Never prefix them with target-repo/, schema-repo/, out/, or any absolute workspace directory.',
    );
  });
});
