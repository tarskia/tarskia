import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ThreadOptions } from '@openai/codex-sdk';
import { simpleGit } from 'simple-git';
import { describe, expect, it, vi } from 'vitest';
import type { GraphifyHints, GraphifyHintsBuilder } from './advanced/graphify-hints';
import * as schemaFlowCatalog from './advanced/schema-flow-catalog';
import { buildDiagram, derivePartialOutputPath } from './build-diagram';
import { ModelOutputParseError } from './codex/model-output-error';
import { runCodexPrompt } from './codex/run-codex-prompt';
import { retainPartialDocument, TurnBudgetExhaustedError } from './codex/turn-policy';
import { readJobMetadata, writeJobMetadata } from './job-metadata';
import { schemaRepoFixture } from './schema-repo-fixture';
import {
  loadSchemaRegistry,
  parseDocument,
  serializeDocument,
  validateDiagramYaml,
} from './semantic';
import { CANONICAL_EXAMPLE_YAML } from './semantic/diagram-synthesis-contract';
import { emptyTokenUsageTotals } from './token-usage';

const fixturePath = (...segments: string[]) =>
  segments[0] === 'schema-repo'
    ? path.join(schemaRepoFixture(), ...segments.slice(1))
    : path.resolve(process.cwd(), 'test', 'fixtures', ...segments);

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createGitRepo(files: Record<string, string>): Promise<string> {
  const repoRoot = await createTempDir('diagram-worker-repo-');
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(repoRoot, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, 'utf8');
  }

  const git = simpleGit(repoRoot);
  await git.init();
  await git.addConfig('user.name', 'Diagram Worker Test');
  await git.addConfig('user.email', 'diagram-worker@example.com');
  await git.add('.');
  await git.commit('Initial commit');
  return repoRoot;
}

function quietLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function sampleGraphifyHints(): GraphifyHints {
  return {
    version: 1,
    status: 'available',
    mode: 'code-only',
    generatedAt: '2026-01-01T00:00:00.000Z',
    graphifyPackage: 'graphifyy==0.6.7',
    corpus: {
      codeFiles: 1,
      nodes: 2,
      edges: 1,
      communities: 1,
      extractedEdges: 1,
      inferredEdges: 0,
      ambiguousEdges: 0,
    },
    centralNodes: [
      {
        id: 'src/index.ts::app',
        label: 'Application runtime',
        degree: 1,
        sourceFile: 'src/index.ts',
        sourceLocation: '1',
        community: 0,
      },
    ],
    communities: [],
    bridgeNodes: [],
    extractedRelations: [
      {
        sourceId: 'src/index.ts::app',
        sourceLabel: 'Application runtime',
        targetId: 'src/index.ts::backend',
        targetLabel: 'Backend',
        relation: 'calls',
        confidence: 'EXTRACTED',
        sourceFile: 'src/index.ts',
        sourceLocation: '1',
      },
    ],
    inferredRelations: [],
    warnings: [],
    artifacts: {
      graphJson: 'analysis/graphify/graph.json',
      extractionJson: 'analysis/graphify/extraction.json',
      reportMarkdown: 'analysis/graphify/GRAPH_REPORT.md',
      summaryMarkdown: 'analysis/graphify-hints.md',
    },
    summaryMarkdown: '# Graphify Code-Structure Hints\n\n- Application runtime calls Backend\n',
  };
}

function createGraphifyHintsBuilder(): GraphifyHintsBuilder {
  return {
    buildGraphifyHints: vi.fn().mockImplementation(async ({ workspace }) => {
      await fs.access(path.join(workspace.workspaceOutputDir, 'analysis/repo-census.json'));
      return sampleGraphifyHints();
    }),
  };
}

function createPassthroughLevel0Reviewers(
  reviewThreadId = 'thread-level0-review',
  repairThreadId = 'thread-level0-review-repair',
) {
  return {
    level0BackboneReviewer: {
      reviewLevel0Backbone: vi.fn().mockImplementation(async ({ currentBackboneYaml }) => ({
        rawYaml: currentBackboneYaml,
        doc: parseDocument(currentBackboneYaml),
        rawResponse: 'review-ok',
        threadId: reviewThreadId,
      })),
    },
    level0BackboneReviewerRepairer: {
      repairLevel0BackboneReview: vi.fn().mockImplementation(async ({ previousReviewYaml }) => ({
        rawYaml: previousReviewYaml,
        doc: parseDocument(previousReviewYaml),
        rawResponse: 'review-repair-ok',
        threadId: repairThreadId,
      })),
    },
  };
}

function createPassthroughWave1Reviewers(
  reviewThreadId = 'thread-wave1-review',
  repairThreadId = 'thread-wave1-review-repair',
) {
  return {
    wave1Reviewer: {
      reviewWave1: vi.fn().mockResolvedValue({
        patch: {},
        rawResponse: '{}',
        threadId: reviewThreadId,
      }),
    },
    wave1ReviewerRepairer: {
      repairWave1Review: vi.fn().mockResolvedValue({
        patch: {},
        rawResponse: '{}',
        threadId: repairThreadId,
      }),
    },
  };
}

function createPassthroughFinalReviewers(
  reviewThreadId = 'thread-final-review',
  repairThreadId = 'thread-final-review-repair',
) {
  return {
    graphifyHintsBuilder: createGraphifyHintsBuilder(),
    finalGraphReviewer: {
      reviewFinalGraph: vi.fn().mockImplementation(async ({ currentFinalGraphYaml }) => ({
        rawYaml: currentFinalGraphYaml,
        doc: parseDocument(currentFinalGraphYaml),
        rawResponse: 'final-review-ok',
        threadId: reviewThreadId,
      })),
    },
    finalGraphReviewerRepairer: {
      repairFinalGraphReview: vi.fn().mockImplementation(async ({ previousReviewYaml }) => ({
        rawYaml: previousReviewYaml,
        doc: parseDocument(previousReviewYaml),
        rawResponse: 'final-review-repair-ok',
        threadId: repairThreadId,
      })),
    },
  };
}

function createAdvancedDependencies() {
  const graphifyHintsBuilder = createGraphifyHintsBuilder();
  const areaPlanner = {
    planAreas: vi.fn().mockResolvedValue({
      plan: {
        repoSummary: 'Repository runtime.',
        galleryDescription: 'Application runtime with backend service',
        initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
        candidateSchemaRefs: [],
        areas: [
          {
            id: 'app',
            namespace: 'app',
            title: 'Application',
            paths: ['src'],
            complexity: 'medium' as const,
            recommendedAction: 'analyze' as const,
            rationale: 'Serve the primary runtime.',
            evidence: [{ path: 'src/index.ts', reason: 'Entrypoint' }],
            openQuestions: [],
          },
        ],
      },
      rawResponse: '{}',
      threadId: 'thread-plan',
    }),
  };
  const level0BackboneBuilder = {
    buildLevel0Backbone: vi.fn().mockResolvedValue({
      rawYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
`,
      doc: parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
`),
      rawResponse: 'ok',
      threadId: 'thread-level0',
    }),
  };
  const level0BackboneRepairer = {
    repairLevel0Backbone: vi.fn(),
  };
  const level0BackboneReviewer = {
    reviewLevel0Backbone: vi.fn().mockImplementation(async ({ currentBackboneYaml }) => ({
      rawYaml: currentBackboneYaml,
      doc: parseDocument(currentBackboneYaml),
      rawResponse: 'review-ok',
      threadId: 'thread-level0-review',
    })),
  };
  const level0BackboneReviewerRepairer = {
    repairLevel0BackboneReview: vi.fn().mockImplementation(async ({ previousReviewYaml }) => ({
      rawYaml: previousReviewYaml,
      doc: parseDocument(previousReviewYaml),
      rawResponse: 'review-repair-ok',
      threadId: 'thread-level0-review-repair',
    })),
  };
  const wave1Reviewer = {
    reviewWave1: vi.fn().mockResolvedValue({
      patch: {},
      rawResponse: '{}',
      threadId: 'thread-wave1-review',
    }),
  };
  const wave1ReviewerRepairer = {
    repairWave1Review: vi.fn().mockResolvedValue({
      patch: {},
      rawResponse: '{}',
      threadId: 'thread-wave1-review-repair',
    }),
  };
  const finalGraphReviewer = {
    reviewFinalGraph: vi.fn().mockImplementation(async ({ currentFinalGraphYaml }) => ({
      rawYaml: currentFinalGraphYaml,
      doc: parseDocument(currentFinalGraphYaml),
      rawResponse: 'final-review-ok',
      threadId: 'thread-final-review',
    })),
  };
  const finalGraphReviewerRepairer = {
    repairFinalGraphReview: vi.fn().mockImplementation(async ({ previousReviewYaml }) => ({
      rawYaml: previousReviewYaml,
      doc: parseDocument(previousReviewYaml),
      rawResponse: 'final-review-repair-ok',
      threadId: 'thread-final-review-repair',
    })),
  };
  const nodeRefiner = {
    refineNode: vi.fn().mockResolvedValue({
      result: {
        children: [],
        relations: [],
        edgeRefinements: [],
      },
      rawResponse: '{}',
      threadId: 'thread-node',
    }),
    repairNode: vi.fn().mockImplementation(async ({ previousResult }) => ({
      result: previousResult,
      rawResponse: JSON.stringify(previousResult),
      threadId: 'thread-node-repair',
    })),
  };
  const graphCollator = {
    // Collation preserves accepted items; refinements belong to the refinement stage.
    collateGraph: vi.fn().mockImplementation(async ({ assembledDoc }) => {
      const doc = {
        ...assembledDoc,
        metadata: {
          ...assembledDoc.metadata,
          description: 'Application runtime with backend service',
        },
      };
      return { rawYaml: serializeDocument(doc), doc, rawResponse: 'ok', threadId: 'thread-graph' };
    }),
  };
  return {
    areaPlanner,
    graphifyHintsBuilder,
    level0BackboneBuilder,
    level0BackboneRepairer,
    level0BackboneReviewer,
    level0BackboneReviewerRepairer,
    wave1Reviewer,
    wave1ReviewerRepairer,
    finalGraphReviewer,
    finalGraphReviewerRepairer,
    nodeRefiner,
    nodeRefinerRepairer: nodeRefiner,
    graphCollator,
  };
}

function createAdvancedDependenciesWithLinkedEdgeWarning() {
  const areaPlanner = {
    planAreas: vi.fn().mockResolvedValue({
      plan: {
        repoSummary: 'Repository runtime.',
        initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
        candidateSchemaRefs: [],
        areas: [
          {
            id: 'app',
            namespace: 'app',
            title: 'Application',
            paths: ['src/app'],
            complexity: 'medium' as const,
            recommendedAction: 'analyze' as const,
            rationale: 'Serve the primary runtime.',
            evidence: [{ path: 'src/app.ts', reason: 'Entrypoint' }],
            openQuestions: [],
          },
        ],
      },
      rawResponse: '{}',
      threadId: 'thread-plan',
    }),
  };
  const level0BackboneBuilder = {
    buildLevel0Backbone: vi.fn().mockResolvedValue({
      rawYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/backend.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
      doc: parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/backend.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`),
      rawResponse: 'ok',
      threadId: 'thread-level0',
    }),
  };
  const level0BackboneRepairer = {
    repairLevel0Backbone: vi.fn().mockImplementation(async ({ previousBackboneYaml }) => ({
      rawYaml: previousBackboneYaml,
      doc: parseDocument(previousBackboneYaml),
      rawResponse: 'ok',
      threadId: 'thread-level0-repair',
    })),
  };
  const level0BackboneReviewer = {
    reviewLevel0Backbone: vi.fn().mockImplementation(async ({ currentBackboneYaml }) => ({
      rawYaml: currentBackboneYaml,
      doc: parseDocument(currentBackboneYaml),
      rawResponse: 'review-ok',
      threadId: 'thread-level0-review',
    })),
  };
  const level0BackboneReviewerRepairer = {
    repairLevel0BackboneReview: vi.fn().mockImplementation(async ({ previousReviewYaml }) => ({
      rawYaml: previousReviewYaml,
      doc: parseDocument(previousReviewYaml),
      rawResponse: 'review-repair-ok',
      threadId: 'thread-level0-review-repair',
    })),
  };
  const nodeRefiner = {
    refineNode: vi.fn().mockResolvedValue({
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Application runtime',
            typeId: 'core/web-app.types.service',
            responsibility: 'Boot the app',
            scope: ['src/app'],
            evidence: [{ path: 'src/app.ts', reason: 'Entrypoint' }],
            queueDecision: 'leaf' as const,
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'browser-calls-app',
            toChildLocalId: 'runtime',
          },
          {
            edgeId: 'app-calls-backend',
            fromChildLocalId: 'runtime',
          },
        ],
      },
      rawResponse: '{}',
      threadId: 'thread-node',
    }),
    repairNode: vi.fn().mockImplementation(async ({ previousResult }) => ({
      result: previousResult,
      rawResponse: JSON.stringify(previousResult),
      threadId: 'thread-node-repair',
    })),
  };
  const graphCollator = {
    collateGraph: vi.fn().mockResolvedValue({
      rawYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
    children:
      - id: app/runtime
        type: core/web-app.types.service
        name: Application runtime
        provenance:
          locations:
            - input: primary
              path: src/app.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/backend.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app/runtime
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app/runtime
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
      doc: parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
    children:
      - id: app/runtime
        type: core/web-app.types.service
        name: Application runtime
        provenance:
          locations:
            - input: primary
              path: src/app.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/backend.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app/runtime
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app/runtime
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`),
      rawResponse: 'ok',
      threadId: 'thread-graph',
    }),
  };
  const finalReviewDependencies = createPassthroughFinalReviewers();

  return {
    areaPlanner,
    level0BackboneBuilder,
    level0BackboneRepairer,
    level0BackboneReviewer,
    level0BackboneReviewerRepairer,
    ...finalReviewDependencies,
    nodeRefiner,
    nodeRefinerRepairer: nodeRefiner,
    graphCollator,
  };
}

function createSharedAdvancedThreadClient(
  threadIds = [
    'thread-advanced',
    'thread-backbone-review',
    'thread-wave1-review',
    'thread-final-review',
  ],
) {
  const threads = threadIds.map((threadId) => ({
    id: threadId,
    run: vi.fn().mockResolvedValue({
      finalResponse: 'ok',
      items: [],
      usage: null,
    }),
  }));
  let startCount = 0;
  return {
    threads,
    client: {
      startThread: vi.fn(
        (_options?: ThreadOptions) => threads[Math.min(startCount++, threads.length - 1)],
      ),
      resumeThread: vi.fn((threadId?: string) => {
        if (!threadId) {
          return threads[0];
        }
        return threads.find((thread) => thread.id === threadId) ?? threads[0];
      }),
    },
  };
}

function createPromptRunnerBackedAdvancedDependencies() {
  const usedThreadIds: string[] = [];
  const graphifyHintsBuilder = createGraphifyHintsBuilder();
  const areaPlan = {
    repoSummary: 'Repository runtime.',
    initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
    candidateSchemaRefs: [],
    areas: [
      {
        id: 'app',
        namespace: 'app',
        title: 'Application',
        paths: ['src'],
        complexity: 'medium' as const,
        recommendedAction: 'analyze' as const,
        rationale: 'Serve the primary runtime.',
        evidence: [{ path: 'src/index.ts', reason: 'Entrypoint' }],
        openQuestions: [],
      },
    ],
  };
  const level0Yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
`;

  return {
    usedThreadIds,
    graphifyHintsBuilder,
    areaPlanner: {
      planAreas: vi.fn().mockImplementation(async (input) => {
        if (!input.promptRunner || !input.handoffArtifactPath) {
          throw new Error('shared prompt runner was not provided to area planning');
        }
        const turn = await input.promptRunner.runPrompt({
          prompt: 'plan areas',
          operation: 'area planning',
          scope: 'pre-refinement',
          handoffArtifactPath: input.handoffArtifactPath,
        });
        usedThreadIds.push(turn.threadId ?? 'none');
        return {
          plan: areaPlan,
          rawResponse: turn.finalResponse,
          threadId: turn.threadId,
        };
      }),
    },
    level0BackboneBuilder: {
      buildLevel0Backbone: vi.fn().mockImplementation(async (input) => {
        if (!input.promptRunner || !input.handoffArtifactPath) {
          throw new Error('shared prompt runner was not provided to level-0 backbone');
        }
        const turn = await input.promptRunner.runPrompt({
          prompt: 'build backbone',
          operation: 'level-0 backbone',
          scope: 'pre-refinement',
          handoffArtifactPath: input.handoffArtifactPath,
        });
        usedThreadIds.push(turn.threadId ?? 'none');
        return {
          rawYaml: level0Yaml,
          doc: parseDocument(level0Yaml),
          rawResponse: turn.finalResponse,
          threadId: turn.threadId,
        };
      }),
    },
    level0BackboneRepairer: {
      repairLevel0Backbone: vi.fn(),
    },
    level0BackboneReviewer: {
      reviewLevel0Backbone: vi.fn().mockImplementation(async (input) => {
        if (!input.promptRunner || !input.handoffArtifactPath) {
          throw new Error('shared prompt runner was not provided to backbone review');
        }
        const turn = await input.promptRunner.runPrompt({
          prompt: 'review backbone',
          operation: 'level-0 backbone review',
          scope: 'backbone-review',
          handoffArtifactPath: input.handoffArtifactPath,
        });
        usedThreadIds.push(turn.threadId ?? 'none');
        return {
          rawYaml: input.currentBackboneYaml,
          doc: parseDocument(input.currentBackboneYaml),
          rawResponse: turn.finalResponse,
          threadId: turn.threadId,
        };
      }),
    },
    level0BackboneReviewerRepairer: {
      repairLevel0BackboneReview: vi.fn(),
    },
    wave1Reviewer: {
      reviewWave1: vi.fn().mockImplementation(async (input) => {
        if (!input.promptRunner || !input.handoffArtifactPath) {
          throw new Error('shared prompt runner was not provided to wave-1 review');
        }
        const turn = await input.promptRunner.runPrompt({
          prompt: 'review wave1',
          operation: 'wave-1 review',
          scope: 'wave1-review',
          handoffArtifactPath: input.handoffArtifactPath,
        });
        usedThreadIds.push(turn.threadId ?? 'none');
        return {
          patch: {},
          rawResponse: turn.finalResponse,
          threadId: turn.threadId,
        };
      }),
    },
    wave1ReviewerRepairer: {
      repairWave1Review: vi.fn(),
    },
    finalGraphReviewer: {
      reviewFinalGraph: vi.fn().mockImplementation(async (input) => {
        if (!input.promptRunner || !input.handoffArtifactPath) {
          throw new Error('shared prompt runner was not provided to final review');
        }
        const turn = await input.promptRunner.runPrompt({
          prompt: 'review final graph',
          operation: 'final review',
          scope: 'final-review',
          handoffArtifactPath: input.handoffArtifactPath,
        });
        usedThreadIds.push(turn.threadId ?? 'none');
        return {
          rawYaml: input.currentFinalGraphYaml,
          doc: parseDocument(input.currentFinalGraphYaml),
          rawResponse: turn.finalResponse,
          threadId: turn.threadId,
        };
      }),
    },
    finalGraphReviewerRepairer: {
      repairFinalGraphReview: vi.fn(),
    },
    nodeRefiner: {
      refineNode: vi.fn().mockImplementation(async (input) => {
        if (!input.promptRunner || !input.handoffArtifactPath) {
          throw new Error('shared prompt runner was not provided to node refinement');
        }
        const turn = await input.promptRunner.runPrompt({
          prompt: `refine ${input.task.nodeId}`,
          operation: `node refinement ${input.task.nodeId}`,
          scope: 'node-refinement',
          handoffArtifactPath: input.handoffArtifactPath,
        });
        usedThreadIds.push(turn.threadId ?? 'none');
        return {
          result: {
            children: [],
            relations: [],
            edgeRefinements: [],
          },
          rawResponse: turn.finalResponse,
          threadId: turn.threadId,
        };
      }),
      repairNode: vi.fn(),
    },
    graphCollator: {
      collateGraph: vi.fn().mockImplementation(async (input) => {
        if (!input.promptRunner || !input.handoffArtifactPath) {
          throw new Error('shared prompt runner was not provided to graph collation');
        }
        const turn = await input.promptRunner.runPrompt({
          prompt: 'collate graph',
          operation: 'graph collation',
          scope: 'graph-collation',
          handoffArtifactPath: input.handoffArtifactPath,
        });
        usedThreadIds.push(turn.threadId ?? 'none');
        return {
          rawYaml: serializeDocument(input.assembledDoc),
          doc: input.assembledDoc,
          rawResponse: turn.finalResponse,
          threadId: turn.threadId,
        };
      }),
    },
  };
}

function cannedDiagramService(yaml: string) {
  return {
    generateDiagram: vi.fn().mockResolvedValue({
      finalYaml: yaml,
      document: parseDocument(yaml),
      threadId: 'thread-canned',
      repaired: false,
      diagnostics: [],
      resolvedSchemaIds: [],
      turnCount: 1,
      tokenUsage: emptyTokenUsageTotals(),
    }),
  };
}

describe('buildDiagram', () => {
  it('rejects invalid reasoning effort before preparing a workspace', async () => {
    const repositoryService = { prepareRepositoryContext: vi.fn() };
    await expect(
      buildDiagram(
        {
          repo: 'https://github.com/example/repo.git',
          schemaSource: fixturePath('schema-repo'),
          out: '/tmp/unused-effort-test.yaml',
          reasoningEffort: 'typo' as never,
        },
        { repositoryService, logger: quietLogger() },
      ),
    ).rejects.toThrow('Invalid reasoning effort');
    expect(repositoryService.prepareRepositoryContext).not.toHaveBeenCalled();
  });

  it('rejects output paths that look like macOS absolute paths missing a leading slash', async () => {
    const repositoryService = {
      prepareRepositoryContext: vi.fn(),
    };

    await expect(
      buildDiagram(
        {
          repo: 'https://github.com/example/repo.git',
          schemaSource: fixturePath('schema-repo'),
          out: 'Users/example/code/project/.tmp/test.yaml',
        },
        {
          logger: quietLogger(),
          repositoryService,
        },
      ),
    ).rejects.toThrow(/missing its leading slash/);

    expect(repositoryService.prepareRepositoryContext).not.toHaveBeenCalled();
  });

  it('persists reported SDK usage before a later agent failure', async () => {
    const repoRoot = await createGitRepo({ 'src/index.ts': 'export const value = 1;\n' });
    const outputPath = path.join(await createTempDir('diagram-worker-usage-'), 'diagram.yaml');
    const aiDiagramService = {
      generateDiagram: vi.fn().mockImplementation(async ({ workspace }) => {
        await runCodexPrompt(
          {
            id: 'persisted-failed-thread',
            run: async () => ({
              finalResponse: 'unparseable',
              items: [],
              usage: {
                input_tokens: 100,
                cached_input_tokens: 40,
                cache_write_input_tokens: 10,
                output_tokens: 30,
                reasoning_output_tokens: 20,
              },
            }),
          },
          'draft',
          { operation: 'draft' },
        );
        // Usage is already durable, before returning from the adapter or validation.
        expect(
          (await readJobMetadata(workspace.jobRoot))?.usageAccounting?.totals.approxTotalTokens,
        ).toBe(130);
        throw new Error('invalid model output after reported turn');
      }),
    };
    await expect(
      buildDiagram(
        { repo: repoRoot, schemaSource: fixturePath('schema-repo'), out: outputPath },
        { aiDiagramService, logger: quietLogger() },
      ),
    ).rejects.toThrow('invalid model output');
    const metadata = await readJobMetadata(`${outputPath}.job`);
    expect(metadata?.status).toBe('failed');
    expect(metadata?.usageAccounting).toMatchObject({
      reportedTurns: 1,
      totals: {
        inputTokens: 100,
        cachedInputTokens: 40,
        nonCachedInputTokens: 60,
        outputTokens: 30,
        reasoningOutputTokens: 20,
        approxTotalTokens: 130,
      },
      lastUsageByThread: { 'persisted-failed-thread': { input_tokens: 100, output_tokens: 30 } },
    });
  });

  it('stamps source repository metadata from the checked-out commit and origin remote', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const git = simpleGit(repoRoot);
    await git.addRemote('origin', 'git@github.com:example/test-repo.git');
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const aiDiagramService = cannedDiagramService(CANONICAL_EXAMPLE_YAML);

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        aiDiagramService,
        logger: quietLogger(),
      },
    );

    const writtenDoc = parseDocument(await fs.readFile(outputPath, 'utf8'));
    const sourceRepository = (
      writtenDoc.metadata as
        | {
            sourceRepository?: {
              repo: string;
              url?: string;
              commit: string;
              committedAt?: string;
            };
          }
        | undefined
    )?.sourceRepository;

    expect(sourceRepository).toMatchObject({
      repo: 'git@github.com:example/test-repo.git',
      url: 'https://github.com/example/test-repo',
      commit: result.workspace.repoRevision,
    });
    expect(Date.parse(sourceRepository?.committedAt ?? '')).not.toBeNaN();

    const metadata = await readJobMetadata(`${outputPath}.job`);
    expect(metadata?.sourceRepository).toEqual(sourceRepository);
  });

  it('does not stamp a gallery description from the repository readme', async () => {
    const repoRoot = await createGitRepo({
      'README.md': `# Test Repo

[![Build](https://example.com/badge.svg)](https://example.com)

Test Repo is a collaborative diagramming app for turning source code into semantic architecture diagrams.

## Install

\`\`\`sh
npm install
\`\`\`
`,
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const aiDiagramService = cannedDiagramService(CANONICAL_EXAMPLE_YAML);

    await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        aiDiagramService,
        logger: quietLogger(),
      },
    );

    const writtenDoc = parseDocument(await fs.readFile(outputPath, 'utf8'));
    expect(writtenDoc.metadata?.description).toBeUndefined();

    const metadata = await readJobMetadata(`${outputPath}.job`);
    expect(metadata?.appDescription).toBeNull();
  });

  it.each([
    false,
    true,
  ])('writes generated schema sidecar or rejects source collision (existing=%s)', async (alreadyActive) => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const schemaOut = path.join(await createTempDir('diagram-worker-schema-out-'), 'schema.yaml');
    const generatedSchemaArtifact = path.join(
      await createTempDir('diagram-worker-generated-schema-'),
      'schema.yaml',
    );
    await fs.writeFile(
      generatedSchemaArtifact,
      ['owner: repo', 'name: test-repo', 'version: "0.1"', 'types: []', 'relations: []', ''].join(
        '\n',
      ),
      'utf8',
    );
    const schemaSource = await createTempDir('diagram-worker-schema-source-');
    await fs.cp(fixturePath('schema-repo'), schemaSource, { recursive: true });
    if (alreadyActive) {
      // An existing activation must resolve in the registry before final sidecar merging.
      await fs.writeFile(
        path.join(schemaSource, 'src', 'schemas', 'test-repo.yaml'),
        ['owner: repo', 'name: test-repo', 'version: "0.2"', 'types: []', 'relations: []', ''].join(
          '\n',
        ),
        'utf8',
      );
    }
    const candidate = parseDocument(CANONICAL_EXAMPLE_YAML);
    if (alreadyActive) candidate.schemaRefs.push({ schema: 'repo/test-repo@0.2', layer: 7 });
    const candidateYaml = serializeDocument(candidate);
    const aiDiagramService = cannedDiagramService(candidateYaml);
    const generatedSchemaService = {
      prepareGeneratedSchema: vi.fn().mockResolvedValue({
        status: 'succeeded',
        schemaId: 'repo/test-repo',
        schemaRef: 'repo/test-repo@0.1',
        artifactPath: generatedSchemaArtifact,
        repaired: false,
        reused: false,
        usedByDiagram: false,
        threadId: 'thread-schema',
        diagnostics: [],
        failureMessage: null,
      }),
    };

    if (alreadyActive) {
      await expect(
        buildDiagram(
          { repo: repoRoot, schemaSource, out: outputPath, schemaOut, schemaId: 'repo/test-repo' },
          {
            aiDiagramService,
            generatedSchemaService: generatedSchemaService as never,
            logger: quietLogger(),
          },
        ),
      ).rejects.toThrow(
        `schema id repo/test-repo already exists in ${schemaSource}; pass a different --schema-id.`,
      );
      expect(generatedSchemaService.prepareGeneratedSchema).not.toHaveBeenCalled();
      expect(aiDiagramService.generateDiagram).not.toHaveBeenCalled();
      expect(
        await fs.readFile(path.join(schemaSource, 'src/schemas/test-repo.yaml'), 'utf8'),
      ).toContain('version: "0.2"');
      return;
    }

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource,
        out: outputPath,
        schemaOut,
        schemaId: 'repo/test-repo',
      },
      {
        aiDiagramService,
        generatedSchemaService: generatedSchemaService as never,
        logger: quietLogger(),
      },
    );

    expect(result.generatedSchema.status).toBe('succeeded');
    expect(result.generatedSchema.schemaRef).toBe('repo/test-repo@0.1');
    expect(result.generatedSchema.artifactPath).toBe(schemaOut);
    expect(result.generatedSchema.usedByDiagram).toBe(!alreadyActive);
    expect(generatedSchemaService.prepareGeneratedSchema).toHaveBeenCalledTimes(1);

    const writtenDoc = parseDocument(await fs.readFile(outputPath, 'utf8'));
    expect(
      writtenDoc.schemaRefs.filter((activation) => activation.schema.startsWith('repo/test-repo@')),
    ).toEqual([
      alreadyActive
        ? { schema: 'repo/test-repo@0.2', layer: 7 }
        : { schema: 'repo/test-repo@0.1', layer: 0 },
    ]);
    expect(await fs.readFile(schemaOut, 'utf8')).toContain('owner: repo');

    const metadata = await readJobMetadata(`${outputPath}.job`);
    expect(metadata?.generateSchema).toBe(true);
    expect(metadata?.schemaId).toBe('repo/test-repo');
    expect(metadata?.schemaOutPath).toBe(schemaOut);
    expect(metadata?.generatedSchema?.status).toBe('succeeded');
    expect(metadata?.generatedSchema?.schemaRef).toBe('repo/test-repo@0.1');
  });

  it('runs the advanced pipeline through backbone-first node refinement and graph collation', async () => {
    const catalogBuilder = vi.spyOn(schemaFlowCatalog, 'buildSchemaFlowCatalog');
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...dependencies,
        logger: quietLogger(),
      },
    );

    expect(catalogBuilder).toHaveBeenCalledTimes(1);
    catalogBuilder.mockRestore();
    expect(dependencies.areaPlanner.planAreas).toHaveBeenCalledTimes(1);
    expect(dependencies.graphifyHintsBuilder.buildGraphifyHints).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(dependencies.graphifyHintsBuilder.buildGraphifyHints).mock.invocationCallOrder[0],
    ).toBeLessThan(dependencies.areaPlanner.planAreas.mock.invocationCallOrder[0]);
    expect(dependencies.areaPlanner.planAreas).toHaveBeenCalledWith(
      expect.objectContaining({
        graphifyHints: expect.objectContaining({
          corpus: expect.objectContaining({ nodes: 2, edges: 1 }),
        }),
      }),
    );
    expect(dependencies.level0BackboneBuilder.buildLevel0Backbone).toHaveBeenCalledTimes(1);
    expect(dependencies.level0BackboneBuilder.buildLevel0Backbone).toHaveBeenCalledWith(
      expect.objectContaining({
        graphifyHints: expect.objectContaining({
          summaryMarkdown: expect.stringContaining('Graphify Code-Structure Hints'),
        }),
      }),
    );
    expect(dependencies.nodeRefiner.refineNode).toHaveBeenCalledTimes(1);
    expect(dependencies.graphCollator.collateGraph).toHaveBeenCalledTimes(1);
    expect(dependencies.graphCollator.collateGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeRefinementState: expect.objectContaining({
          rootNodeIds: ['browser-client', 'app', 'backend'],
        }),
        level0Backbone: expect.objectContaining({ visibleResponsibilityIds: ['app'] }),
      }),
    );
    expect(dependencies.finalGraphReviewer.reviewFinalGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        graphifyHints: expect.objectContaining({
          graphifyPackage: 'graphifyy==0.6.7',
        }),
      }),
    );
    expect(result.threadId).toBe('thread-final-review');
    expect(result.buildSummary).toMatchObject({
      model: 'Codex CLI default',
      turns: 6,
      nodes: 3,
      edges: 2,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      approxTotalTokens: 0,
    });
    expect(result.buildSummary.durationMs).toBeGreaterThanOrEqual(0);

    const writtenDoc = parseDocument(await fs.readFile(outputPath, 'utf8'));
    const workerBuild = (
      writtenDoc.metadata as
        | {
            workerBuild?: {
              model: string;
              builtAt: string;
              durationMs: number;
              turns: number;
              nodes: number;
              edges: number;
            };
          }
        | undefined
    )?.workerBuild;
    expect(workerBuild).toEqual(result.buildSummary);
    expect(writtenDoc.metadata?.description).toBe('Application runtime with backend service');

    const metadata = await readJobMetadata(`${outputPath}.job`);
    expect(metadata?.appDescription).toBe('Application runtime with backend service');
    expect(metadata?.advanced?.lastCompletedStage).toBe('bundle-compile');
    expect(metadata?.advanced?.currentNodeRefinementArtifact).toBeTruthy();
    expect(metadata?.buildSummary).toEqual(result.buildSummary);
    expect(metadata?.finishedAt).toBe(result.buildSummary.builtAt);

    const jobOutputDir = path.join(`${outputPath}.job`, 'out');
    await expect(
      fs.readFile(path.join(jobOutputDir, 'analysis/validate-node-refinement.mjs'), 'utf8'),
    ).resolves.toContain("'internal'");
    await expect(
      fs.readFile(path.join(jobOutputDir, 'analysis/validate-schema-selection.mjs'), 'utf8'),
    ).resolves.toContain("'internal'");
  }, 40000);

  it.each([
    true,
    false,
  ])('resolves final relation direction from the active schema (directed=%s)', async (directed) => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const schemaSource = await createTempDir('diagram-worker-dedup-schemas-');
    await fs.cp(fixturePath('schema-repo'), schemaSource, { recursive: true });
    const softwarePath = path.join(schemaSource, 'src/schemas/software.yaml');
    await fs.writeFile(
      softwarePath,
      (await fs.readFile(softwarePath, 'utf8')).replace(
        '  - id: calls\n',
        `  - id: calls\n    directed: ${directed}\n`,
      ),
    );
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const duplicateRelationYaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/index.ts
    children:
      - id: app/runtime
        type: core/web-app.types.service
        name: Application runtime
        provenance:
          locations:
            - input: primary
              path: src/index.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/state.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app/runtime
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app/runtime
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: backend-calls-app
    type: core/software.relations.calls
    from: backend
    to: app/runtime
    provenance:
      locations:
        - input: primary
          path: src/state.ts
`;
    const duplicateRelationDoc = parseDocument(duplicateRelationYaml);
    const aiDiagramService = {
      generateDiagram: vi.fn().mockResolvedValue({
        finalYaml: duplicateRelationYaml,
        document: duplicateRelationDoc,
        threadId: 'thread-canned',
        repaired: false,
        diagnostics: [],
        resolvedSchemaIds: ['core/web-app', 'core/software'],
        turnCount: 1,
        tokenUsage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          approxTotalTokens: 0,
        },
      }),
    };

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource,
        out: outputPath,
      },
      {
        aiDiagramService: aiDiagramService as never,
        logger: quietLogger(),
      },
    );

    expect(result.buildSummary.edges).toBe(directed ? 3 : 2);
    expect(aiDiagramService.generateDiagram).toHaveBeenCalledTimes(1);
    const writtenDoc = parseDocument(await fs.readFile(outputPath, 'utf8'));
    expect(writtenDoc.relations).toHaveLength(directed ? 3 : 2);
    expect(
      writtenDoc.relations.find((r) => r.id === 'app-calls-backend')?.provenance?.locations,
    ).toEqual(
      directed
        ? [{ input: 'primary', path: 'src/index.ts' }]
        : [
            { input: 'primary', path: 'src/index.ts' },
            { input: 'primary', path: 'src/state.ts' },
          ],
    );
    expect(
      writtenDoc.relations.find((r) => r.id === 'backend-calls-app')?.provenance?.locations,
    ).toEqual(directed ? [{ input: 'primary', path: 'src/state.ts' }] : undefined);
  }, 40000);

  it('falls back to the assembled refined document when graph collation flattens refined structure', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();
    const flattenedYaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
`;

    dependencies.nodeRefiner.refineNode.mockResolvedValue({
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Application runtime',
            typeId: 'core/web-app.types.service',
            scope: ['src'],
            evidence: [{ path: 'src/index.ts', reason: 'Runtime entrypoint.' }],
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'browser-calls-app',
            toChildLocalId: 'runtime',
          },
          {
            edgeId: 'app-calls-backend',
            fromChildLocalId: 'runtime',
          },
        ],
      },
      rawResponse: '{}',
      threadId: 'thread-node',
    });
    dependencies.graphCollator.collateGraph.mockResolvedValue({
      rawYaml: flattenedYaml,
      doc: parseDocument(flattenedYaml),
      rawResponse: 'flattened graph output',
      threadId: 'thread-graph',
    });
    const reviewedYaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/index.ts
    children:
      - id: app/runtime
        type: core/web-app.types.service
        name: Application runtime
        provenance:
          locations:
            - input: primary
              path: src/index.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app/runtime
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app/runtime
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
`;
    dependencies.finalGraphReviewer.reviewFinalGraph.mockResolvedValue({
      rawYaml: reviewedYaml,
      doc: parseDocument(reviewedYaml),
      rawResponse: 'reviewed graph output',
      threadId: 'thread-final-review',
    });

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...dependencies,
        logger: quietLogger(),
      },
    );

    const writtenDoc = parseDocument(await fs.readFile(outputPath, 'utf8'));
    const app = writtenDoc.entities.find((entity) => entity.id === 'app');

    expect(app?.children?.map((entity) => entity.id)).toEqual(['app/runtime']);
    expect(writtenDoc.relations.find((relation) => relation.id === 'browser-calls-app')).toEqual(
      expect.objectContaining({
        from: 'browser-client',
        to: 'app/runtime',
      }),
    );
    expect(dependencies.finalGraphReviewer.reviewFinalGraph).toHaveBeenCalledTimes(1);
    expect(dependencies.finalGraphReviewer.reviewFinalGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        currentFinalGraphYaml: expect.stringContaining('to: app/runtime'),
        finalReviewSummary: expect.objectContaining({
          removedEntityIds: [],
          rewrittenRelationIds: [],
        }),
      }),
    );
    expect(result.repaired).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'diagram.review.reverted_edit' })]),
    );
    expect((await readJobMetadata(`${outputPath}.job`))?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'diagram.review.reverted_edit' })]),
    );
    const metadata = await readJobMetadata(`${outputPath}.job`);
    expect(metadata?.advanced?.currentGraphReviewCompleted).toBe(true);
    await expect(
      fs.readFile(
        path.join(outputPath + '.job', 'out', 'analysis', 'final-graph.pre-review.yaml'),
        'utf8',
      ),
    ).resolves.toContain('backend');
    await expect(
      fs.readFile(
        path.join(outputPath + '.job', 'out', 'analysis', 'final-review.summary.json'),
        'utf8',
      ),
    ).resolves.toContain('"removedEntityIds"');
    await expect(
      fs.readFile(
        path.join(outputPath + '.job', 'out', 'analysis', 'final-review.response.yaml'),
        'utf8',
      ),
    ).resolves.toContain('reviewed graph output');
  }, 40000);

  it('restores an invalid rewrite of a valid entity before bundle compile', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();
    const invalidReviewedYaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app
    type: core/unknown.types.missing
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
`;
    const repairedFinalYaml = invalidReviewedYaml.replace(
      'core/unknown.types.missing',
      'core/web-app.types.application',
    );
    dependencies.finalGraphReviewer.reviewFinalGraph.mockResolvedValue({
      rawYaml: invalidReviewedYaml,
      doc: parseDocument(invalidReviewedYaml),
      rawResponse: 'invalid final review output',
      threadId: 'thread-final-review',
    });
    dependencies.finalGraphReviewerRepairer.repairFinalGraphReview.mockImplementation(async () => ({
      rawYaml: repairedFinalYaml,
      doc: parseDocument(repairedFinalYaml),
      rawResponse: 'final review repair output',
      threadId: 'thread-final-review-repair',
    }));

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...dependencies,
        logger: quietLogger(),
      },
    );

    expect(dependencies.finalGraphReviewer.reviewFinalGraph).toHaveBeenCalledTimes(1);
    expect(dependencies.finalGraphReviewerRepairer.repairFinalGraphReview).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-final-review');
    expect(result.repaired).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'diagram.review.reverted_edit', entityId: 'app' }),
      ]),
    );
  }, 40000);

  it.each([
    false,
    true,
  ])('blocks surviving final flow errors after one repair (fixed=%s)', async (fixed) => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const out = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();
    dependencies.graphCollator.collateGraph.mockImplementation(async ({ assembledDoc }) => ({
      doc: assembledDoc,
      rawYaml: serializeDocument(assembledDoc),
      rawResponse: 'unchanged',
      threadId: 'thread-graph',
    }));
    dependencies.finalGraphReviewer.reviewFinalGraph.mockImplementation(
      async ({ currentFinalGraphYaml }) => {
        const doc = parseDocument(currentFinalGraphYaml);
        doc.entities.push({
          id: 'unconnected',
          type: 'core/web-app.types.service',
          provenance: { locations: [{ input: 'primary', path: 'src/index.ts' }] },
        });
        doc.entities.push({
          id: 'valid-addition',
          type: 'core/web-app.types.external-api',
          provenance: { locations: [{ input: 'primary', path: 'src/index.ts' }] },
        });
        return {
          doc,
          rawYaml: serializeDocument(doc),
          rawResponse: 'added service',
          threadId: 'thread-final-review',
        };
      },
    );
    dependencies.finalGraphReviewerRepairer.repairFinalGraphReview.mockImplementation(
      async ({ previousReviewYaml }) => {
        const doc = parseDocument(previousReviewYaml);
        if (fixed)
          doc.entities = doc.entities.filter(
            (entity) => entity.id !== 'unconnected' && entity.id !== 'valid-addition',
          );
        return {
          doc,
          rawYaml: serializeDocument(doc),
          rawResponse: 'repair service',
          threadId: 'thread-final-review-repair',
        };
      },
    );
    const run = buildDiagram(
      { repo: repoRoot, schemaSource: fixturePath('schema-repo'), out },
      { ...dependencies, logger: quietLogger() },
    );
    if (fixed) await expect(run).resolves.toMatchObject({ threadId: 'thread-final-review-repair' });
    else
      await expect(run).rejects.toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: expect.stringMatching(/^diagram\.flow\./),
            severity: 'error',
          }),
        ]),
      });
    if (fixed) {
      const doc = parseDocument(await fs.readFile(out, 'utf8'));
      expect(doc.entities.some((entity) => entity.id === 'valid-addition')).toBe(true);
      expect(doc.entities.some((entity) => entity.id === 'unconnected')).toBe(false);
      expect((await readJobMetadata(`${out}.job`))?.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'diagram.review.reverted_edit',
            entityId: 'valid-addition',
          }),
        ]),
      );
    }
    expect(dependencies.finalGraphReviewerRepairer.repairFinalGraphReview).toHaveBeenCalledTimes(1);
  }, 40000);

  it('reopens a previously reviewed checkpoint with flow errors for final repair', async () => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;\n' });
    const out = path.join(await createTempDir('final-flow-resume-'), 'diagram.yaml');
    const options = {
      repo,
      out,

      schemaSource: fixturePath('schema-repo'),
    };
    await buildDiagram(options, { ...createAdvancedDependencies(), logger: quietLogger() });
    const metadata = await readJobMetadata(`${out}.job`);
    const artifact = metadata!.advanced!.currentGraphArtifact!;
    const doc = parseDocument(await fs.readFile(artifact, 'utf8'));
    doc.entities.push({
      id: 'orphan',
      type: 'core/web-app.types.service',
      provenance: { locations: [{ input: 'primary', path: 'src/index.ts' }] },
    });
    await fs.writeFile(artifact, serializeDocument(doc));
    await fs.rm(out);
    const dependencies = createAdvancedDependencies();
    dependencies.finalGraphReviewerRepairer.repairFinalGraphReview.mockImplementation(
      async ({ previousReviewYaml }) => {
        const repairedDoc = parseDocument(previousReviewYaml);
        repairedDoc.entities = repairedDoc.entities.filter((entity) => entity.id !== 'orphan');
        return {
          doc: repairedDoc,
          rawYaml: serializeDocument(repairedDoc),
          rawResponse: 'repair',
          threadId: 'repaired-review',
        };
      },
    );
    await expect(
      buildDiagram(options, { ...dependencies, logger: quietLogger() }),
    ).resolves.toMatchObject({ threadId: 'repaired-review' });
    expect(dependencies.graphCollator.collateGraph).not.toHaveBeenCalled();
    expect(dependencies.finalGraphReviewerRepairer.repairFinalGraphReview).toHaveBeenCalledTimes(1);
  }, 40000);

  it('can stop after the validated level-0 backbone', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,

        stopAfter: 'level0-backbone',
      },
      {
        ...dependencies,
        logger: quietLogger(),
      },
    );

    expect(dependencies.areaPlanner.planAreas).toHaveBeenCalledTimes(1);
    expect(dependencies.level0BackboneBuilder.buildLevel0Backbone).toHaveBeenCalledTimes(1);
    expect(dependencies.nodeRefiner.refineNode).not.toHaveBeenCalled();
    expect(dependencies.graphCollator.collateGraph).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-level0');

    const writtenYaml = await fs.readFile(result.outputPath, 'utf8');
    const writtenDoc = parseDocument(writtenYaml);
    expect(writtenDoc.entities.map((entity) => entity.id)).toEqual([
      'browser-client',
      'app',
      'backend',
    ]);

    const metadata = await readJobMetadata(`${outputPath}.job`);
    expect(result.outputPath).toBe(outputPath.replace('.yaml', '.partial.yaml'));
    await expect(fs.access(outputPath)).rejects.toThrow();
    expect(metadata?.status).toBe('stopped');
    expect(metadata?.advanced?.lastCompletedStage).toBe('level0-backbone');
  }, 40000);

  it('can stop after the reviewed level-0 backbone', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();

    await fs.writeFile(outputPath, 'existing final output');
    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,

        stopAfter: 'level0-review',
      },
      {
        ...dependencies,
        logger: quietLogger(),
      },
    );

    expect(dependencies.areaPlanner.planAreas).toHaveBeenCalledTimes(1);
    expect(dependencies.level0BackboneBuilder.buildLevel0Backbone).toHaveBeenCalledTimes(1);
    expect(dependencies.level0BackboneReviewer.reviewLevel0Backbone).toHaveBeenCalledTimes(1);
    expect(dependencies.nodeRefiner.refineNode).not.toHaveBeenCalled();
    expect(dependencies.graphCollator.collateGraph).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-level0-review');

    const metadata = await readJobMetadata(`${outputPath}.job`);
    expect(metadata?.advanced?.lastCompletedStage).toBe('level0-review');
    expect(metadata?.status).toBe('stopped');
    expect(await fs.readFile(outputPath, 'utf8')).toBe('existing final output');
    expect(result.outputPath).toBe(outputPath.replace('.yaml', '.partial.yaml'));

    await expect(
      fs.readFile(
        path.join(outputPath + '.job', 'out', 'analysis', 'level0-backbone.pre-review.yaml'),
        'utf8',
      ),
    ).resolves.toContain('browser-client');
    await expect(
      fs.readFile(
        path.join(outputPath + '.job', 'out', 'analysis', 'level0-review.response.yaml'),
        'utf8',
      ),
    ).resolves.toContain('review-ok');
  }, 40000);

  it('applies a node-refinement max depth override in advanced mode', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();

    await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,

        nodeRefinementMaxDepth: 2,
      },
      {
        ...dependencies,
        logger: quietLogger(),
      },
    );

    const nodeRefinementState = JSON.parse(
      await fs.readFile(
        path.join(outputPath + '.job', 'out', 'analysis', 'node-refinement-state.json'),
        'utf8',
      ),
    ) as { budgets?: { maxDepth?: number } };

    expect(nodeRefinementState.budgets?.maxDepth).toBe(2);
  }, 40000);

  it('skips frontier-driven backbone repair when stopping after level 0', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const areaPlanner = {
      planAreas: vi.fn().mockResolvedValue({
        plan: {
          repoSummary: 'Repository runtime.',
          initialSchemaActivations: [
            { schema: 'core/software@0.1', layer: 0 },
            { schema: 'core/web-app@0.3', layer: 1 },
          ],
          candidateSchemaRefs: [],
          areas: [
            {
              id: 'client',
              namespace: 'client',
              title: 'Client',
              paths: ['src/index.ts'],
              complexity: 'medium' as const,
              recommendedAction: 'analyze' as const,
              rationale: 'Client entrypoint.',
              evidence: [{ path: 'src/index.ts', reason: 'Entrypoint' }],
              openQuestions: [],
            },
            {
              id: 'server',
              namespace: 'server',
              title: 'Server',
              paths: ['src/index.ts'],
              complexity: 'medium' as const,
              recommendedAction: 'analyze' as const,
              rationale: 'Server runtime.',
              evidence: [{ path: 'src/index.ts', reason: 'Entrypoint' }],
              openQuestions: [],
            },
          ],
        },
        rawResponse: '{}',
        threadId: 'thread-plan',
      }),
    };
    const level0Yaml = `version: 0.1.0
schemaRefs:
  - schema: core/software@0.1
    layer: 0
  - schema: core/web-app@0.3
    layer: 1
entities:
  - id: client
    type: core/software.types.system
    name: Client
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: server
    type: core/web-app.types.service
    name: Server
    provenance:
      locations:
        - input: primary
          path: src/index.ts
relations:
  - id: rel-client-calls-server
    type: core/software.relations.calls
    from: client
    to: server
    provenance:
      locations:
        - input: primary
          path: src/index.ts
`;
    const level0BackboneBuilder = {
      buildLevel0Backbone: vi.fn().mockResolvedValue({
        rawYaml: level0Yaml,
        doc: parseDocument(level0Yaml),
        rawResponse: 'ok',
        threadId: 'thread-level0',
      }),
    };
    const level0BackboneRepairer = {
      repairLevel0Backbone: vi.fn(),
    };
    const reviewDependencies = createPassthroughLevel0Reviewers();
    const nodeRefiner = {
      refineNode: vi.fn(),
      repairNode: vi.fn(),
    };
    const graphCollator = {
      collateGraph: vi.fn(),
    };
    const finalReviewDependencies = createPassthroughFinalReviewers();

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,

        stopAfter: 'level0-backbone',
      },
      {
        areaPlanner,
        level0BackboneBuilder,
        level0BackboneRepairer,
        ...reviewDependencies,
        ...finalReviewDependencies,
        nodeRefiner,
        nodeRefinerRepairer: nodeRefiner,
        graphCollator,
        logger: quietLogger(),
      },
    );

    expect(level0BackboneRepairer.repairLevel0Backbone).not.toHaveBeenCalled();
    expect(nodeRefiner.refineNode).not.toHaveBeenCalled();
    expect(graphCollator.collateGraph).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-level0');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.unresolved_ingress',
          entityId: 'client',
        }),
        expect.objectContaining({
          code: 'diagram.flow.unresolved_egress',
          entityId: 'server',
        }),
      ]),
    );
  }, 40000);

  it('accepts advisory backbone flow errors but rejects them when still present after final repairs', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const areaPlanner = {
      planAreas: vi.fn().mockResolvedValue({
        plan: {
          repoSummary: 'Repository runtime.',
          initialSchemaActivations: [
            { schema: 'core/software@0.1', layer: 0 },
            { schema: 'core/web-app@0.3', layer: 1 },
          ],
          candidateSchemaRefs: [],
          areas: [
            {
              id: 'client-runtime',
              namespace: 'client_runtime',
              title: 'Client Runtime',
              paths: ['src/index.ts'],
              complexity: 'medium' as const,
              recommendedAction: 'analyze' as const,
              rationale: 'Client entrypoint.',
              evidence: [{ path: 'src/index.ts', reason: 'Entrypoint' }],
              openQuestions: [],
            },
            {
              id: 'server-runtime',
              namespace: 'server_runtime',
              title: 'Server Runtime',
              paths: ['src/index.ts'],
              complexity: 'medium' as const,
              recommendedAction: 'analyze' as const,
              rationale: 'Server runtime.',
              evidence: [{ path: 'src/index.ts', reason: 'Entrypoint' }],
              openQuestions: [],
            },
          ],
        },
        rawResponse: '{}',
        threadId: 'thread-plan',
      }),
    };
    const advisoryBackboneYaml = `version: 0.1.0
schemaRefs:
  - schema: core/software@0.1
    layer: 0
  - schema: core/web-app@0.3
    layer: 1
entities:
  - id: client-runtime
    type: core/software.types.system
    name: Client Runtime
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: server-runtime
    type: core/web-app.types.service
    name: Server Runtime
    provenance:
      locations:
        - input: primary
          path: src/index.ts
relations:
  - id: rel-client-calls-server
    type: core/software.relations.calls
    from: client-runtime
    to: server-runtime
    provenance:
      locations:
        - input: primary
          path: src/index.ts
`;
    const level0BackboneBuilder = {
      buildLevel0Backbone: vi.fn().mockResolvedValue({
        rawYaml: advisoryBackboneYaml,
        doc: parseDocument(advisoryBackboneYaml),
        rawResponse: 'ok',
        threadId: 'thread-level0',
      }),
    };
    const level0BackboneRepairer = {
      repairLevel0Backbone: vi.fn().mockResolvedValue({
        rawYaml: advisoryBackboneYaml,
        doc: parseDocument(advisoryBackboneYaml),
        rawResponse: 'repair',
        threadId: 'thread-level0-repair',
      }),
    };
    const reviewDependencies = createPassthroughLevel0Reviewers();
    const nodeRefiner = {
      refineNode: vi.fn().mockResolvedValue({
        result: {
          children: [],
          relations: [],
          edgeRefinements: [],
        },
        rawResponse: '{}',
        threadId: 'thread-node',
      }),
      repairNode: vi.fn(),
    };
    const graphCollator = {
      collateGraph: vi.fn().mockResolvedValue({
        rawYaml: advisoryBackboneYaml,
        doc: parseDocument(advisoryBackboneYaml),
        rawResponse: 'ok',
        threadId: 'thread-graph',
      }),
    };
    const finalReviewDependencies = createPassthroughFinalReviewers();

    const result = buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        areaPlanner,
        level0BackboneBuilder,
        level0BackboneRepairer,
        ...reviewDependencies,
        ...finalReviewDependencies,
        nodeRefiner,
        nodeRefinerRepairer: nodeRefiner,
        graphCollator,
        logger: quietLogger(),
      },
    );

    await expect(result).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/^diagram\.flow\./),
          severity: 'error',
        }),
      ]),
    });
    expect(level0BackboneRepairer.repairLevel0Backbone).toHaveBeenCalledTimes(3);
    expect(nodeRefiner.refineNode).toHaveBeenCalled();
    expect(graphCollator.collateGraph).toHaveBeenCalledTimes(1);
  }, 40000);

  it('keeps one-sided endpoint refinement without triggering graph repair', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/app.ts': 'export const app = true;\n',
      'src/backend.ts': 'export const backend = true;\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createAdvancedDependenciesWithLinkedEdgeWarning();

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...dependencies,
        logger: quietLogger(),
      },
    );

    expect(dependencies.graphCollator.collateGraph).toHaveBeenCalledTimes(1);
    expect(dependencies.level0BackboneRepairer.repairLevel0Backbone).not.toHaveBeenCalled();
    expect(dependencies.nodeRefiner.repairNode).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-final-review');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'diagram.review.reverted_edit', entityId: 'app/runtime' }),
    ]);
  }, 40000);

  it('resumes from node-refinement and graph-collation checkpoints without rerunning prior stages', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const firstDependencies = createAdvancedDependencies();

    await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...firstDependencies,
        logger: quietLogger(),
      },
    );

    const resumedDependencies = createAdvancedDependencies();
    resumedDependencies.areaPlanner.planAreas.mockImplementation(() => {
      throw new Error('planner should not rerun');
    });
    resumedDependencies.nodeRefiner.refineNode.mockImplementation(() => {
      throw new Error('node refinement should not rerun');
    });
    resumedDependencies.level0BackboneBuilder.buildLevel0Backbone.mockImplementation(() => {
      throw new Error('level-0 backbone should not rerun');
    });
    resumedDependencies.graphCollator.collateGraph.mockImplementation(() => {
      throw new Error('graph collation should not rerun');
    });
    resumedDependencies.finalGraphReviewer.reviewFinalGraph.mockImplementation(() => {
      throw new Error('final review should not rerun');
    });

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...resumedDependencies,
        logger: quietLogger(),
      },
    );

    expect(result.threadId).toBe('thread-graph');
    expect(resumedDependencies.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(resumedDependencies.level0BackboneBuilder.buildLevel0Backbone).not.toHaveBeenCalled();
    expect(resumedDependencies.nodeRefiner.refineNode).not.toHaveBeenCalled();
    expect(resumedDependencies.graphCollator.collateGraph).not.toHaveBeenCalled();
    expect(resumedDependencies.finalGraphReviewer.reviewFinalGraph).not.toHaveBeenCalled();
  }, 40000);

  it('reruns final review when resuming an unreviewed graph checkpoint', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const firstDependencies = createAdvancedDependencies();

    await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...firstDependencies,
        logger: quietLogger(),
      },
    );

    const metadata = await readJobMetadata(`${outputPath}.job`);
    if (!metadata?.advanced) {
      throw new Error('expected advanced metadata after initial build');
    }
    await writeJobMetadata(`${outputPath}.job`, {
      ...metadata,
      status: 'running',
      finishedAt: null,
      advanced: {
        ...metadata.advanced,
        lastCompletedStage: 'graph-collation',
        currentGraphReviewCompleted: false,
      },
    });

    const resumedDependencies = createAdvancedDependencies();
    resumedDependencies.areaPlanner.planAreas.mockImplementation(() => {
      throw new Error('planner should not rerun');
    });
    resumedDependencies.level0BackboneBuilder.buildLevel0Backbone.mockImplementation(() => {
      throw new Error('level-0 backbone should not rerun');
    });
    resumedDependencies.nodeRefiner.refineNode.mockImplementation(() => {
      throw new Error('node refinement should not rerun');
    });
    resumedDependencies.graphCollator.collateGraph.mockImplementation(() => {
      throw new Error('graph collation should not rerun');
    });

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...resumedDependencies,
        logger: quietLogger(),
      },
    );

    expect(resumedDependencies.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(resumedDependencies.level0BackboneBuilder.buildLevel0Backbone).not.toHaveBeenCalled();
    expect(resumedDependencies.nodeRefiner.refineNode).not.toHaveBeenCalled();
    expect(resumedDependencies.graphCollator.collateGraph).not.toHaveBeenCalled();
    expect(resumedDependencies.finalGraphReviewer.reviewFinalGraph).toHaveBeenCalledTimes(1);
    expect(result.threadId).toBe('thread-final-review');
  }, 40000);

  it('recomputes review while retaining the raw backbone when restarting from level0-review', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const firstDependencies = createAdvancedDependencies();

    await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,

        stopAfter: 'level0-review',
      },
      {
        ...firstDependencies,
        logger: quietLogger(),
      },
    );

    const resumedDependencies = createAdvancedDependencies();
    resumedDependencies.level0BackboneBuilder.buildLevel0Backbone.mockImplementation(() => {
      throw new Error('level-0 backbone should not rerun');
    });

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,

        restartFrom: 'level0-review',
      },
      {
        ...resumedDependencies,
        logger: quietLogger(),
      },
    );

    expect(result.threadId).toBe('thread-final-review');
    expect(resumedDependencies.level0BackboneBuilder.buildLevel0Backbone).not.toHaveBeenCalled();
    expect(resumedDependencies.level0BackboneReviewer.reviewLevel0Backbone).toHaveBeenCalledTimes(
      1,
    );
    expect(resumedDependencies.nodeRefiner.refineNode).toHaveBeenCalled();
    expect(resumedDependencies.graphCollator.collateGraph).toHaveBeenCalled();
  }, 40000);

  it('resumes node refinement from the last successful task after a failure', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/app.ts': 'export const app = true;\n',
      'src/worker.ts': 'export const worker = true;\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');

    const firstDependencies = {
      areaPlanner: {
        planAreas: vi.fn().mockResolvedValue({
          plan: {
            repoSummary: 'Repository runtime.',
            initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
            candidateSchemaRefs: [],
            areas: [
              {
                id: 'app',
                namespace: 'app',
                title: 'Application',
                paths: ['src/app.ts'],
                complexity: 'medium' as const,
                recommendedAction: 'analyze' as const,
                rationale: 'Serve the primary runtime.',
                evidence: [{ path: 'src/app.ts', reason: 'Entrypoint' }],
                openQuestions: [],
              },
              {
                id: 'worker',
                namespace: 'worker',
                title: 'Worker',
                paths: ['src/worker.ts'],
                complexity: 'medium' as const,
                recommendedAction: 'analyze' as const,
                rationale: 'Process jobs.',
                evidence: [{ path: 'src/worker.ts', reason: 'Worker entrypoint' }],
                openQuestions: [],
              },
            ],
          },
          rawResponse: '{}',
          threadId: 'thread-plan',
        }),
      },
      level0BackboneBuilder: {
        buildLevel0Backbone: vi.fn().mockResolvedValue({
          rawYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: worker
    type: core/web-app.types.external-api
    name: Worker
    provenance:
      locations:
        - input: primary
          path: src/worker.ts
relations:
  - id: app-calls-worker
    type: core/software.relations.calls
    from: app
    to: worker
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
          doc: parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: worker
    type: core/web-app.types.external-api
    name: Worker
    provenance:
      locations:
        - input: primary
          path: src/worker.ts
relations:
  - id: app-calls-worker
    type: core/software.relations.calls
    from: app
    to: worker
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`),
          rawResponse: 'ok',
          threadId: 'thread-level0',
        }),
      },
      level0BackboneRepairer: {
        repairLevel0Backbone: vi.fn(),
      },
      ...createPassthroughLevel0Reviewers(),
      ...createPassthroughWave1Reviewers(),
      ...createPassthroughFinalReviewers(),
      nodeRefiner: {
        refineNode: vi
          .fn()
          .mockResolvedValueOnce({
            result: {
              children: [],
              relations: [],
              edgeRefinements: [],
            },
            rawResponse: '{}',
            threadId: 'thread-node-app',
          })
          .mockRejectedValueOnce(new Error('worker refinement blew up')),
        repairNode: vi.fn(),
      },
      graphCollator: {
        collateGraph: vi.fn(),
      },
    };

    await expect(
      buildDiagram(
        {
          repo: repoRoot,
          schemaSource: fixturePath('schema-repo'),
          out: outputPath,
        },
        {
          ...firstDependencies,
          logger: quietLogger(),
        },
      ),
    ).rejects.toThrow('worker refinement blew up');

    const failedMetadata = await readJobMetadata(`${outputPath}.job`);
    expect(failedMetadata?.advanced?.lastCompletedStage).toBe('level0-review');
    expect(failedMetadata?.advanced?.currentNodeRefinementArtifact).toBeTruthy();
    const failureArtifact = JSON.parse(
      await fs.readFile(`${outputPath}.job/out/analysis/node-refinement.failure.json`, 'utf8'),
    );
    expect(failureArtifact.failedNodeId).toBe('worker');

    const resumedDependencies = {
      areaPlanner: {
        planAreas: vi.fn().mockImplementation(() => {
          throw new Error('planner should not rerun');
        }),
      },
      level0BackboneBuilder: {
        buildLevel0Backbone: vi.fn().mockImplementation(() => {
          throw new Error('level-0 backbone should not rerun');
        }),
      },
      level0BackboneRepairer: {
        repairLevel0Backbone: vi.fn(),
      },
      ...createPassthroughLevel0Reviewers(),
      ...createPassthroughWave1Reviewers(),
      ...createPassthroughFinalReviewers(),
      nodeRefiner: {
        refineNode: vi.fn().mockResolvedValue({
          result: {
            children: [],
            relations: [],
            edgeRefinements: [],
          },
          rawResponse: '{}',
          threadId: 'thread-node-worker',
        }),
        repairNode: vi.fn(),
      },
      graphCollator: {
        collateGraph: vi.fn().mockResolvedValue({
          rawYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: worker
    type: core/web-app.types.external-api
    name: Worker
    provenance:
      locations:
        - input: primary
          path: src/worker.ts
relations:
  - id: app-calls-worker
    type: core/software.relations.calls
    from: app
    to: worker
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
          doc: parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: worker
    type: core/web-app.types.external-api
    name: Worker
    provenance:
      locations:
        - input: primary
          path: src/worker.ts
relations:
  - id: app-calls-worker
    type: core/software.relations.calls
    from: app
    to: worker
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`),
          rawResponse: 'ok',
          threadId: 'thread-graph',
        }),
      },
    };

    const resumedResult = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...resumedDependencies,
        logger: quietLogger(),
      },
    );

    expect(resumedResult.threadId).toBe('thread-final-review');
    expect(resumedDependencies.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(resumedDependencies.level0BackboneBuilder.buildLevel0Backbone).not.toHaveBeenCalled();
    expect(resumedDependencies.nodeRefiner.refineNode).toHaveBeenCalledTimes(1);
    expect(resumedDependencies.nodeRefiner.refineNode).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          nodeId: 'worker',
        }),
      }),
    );
  });

  it('clears cached successful nodes when restarting the node-refinement stage', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/app.ts': 'export const app = true;\n',
      'src/worker.ts': 'export const worker = true;\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');

    const firstDependencies = {
      areaPlanner: {
        planAreas: vi.fn().mockResolvedValue({
          plan: {
            repoSummary: 'Repository runtime.',
            initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
            candidateSchemaRefs: [],
            areas: [
              {
                id: 'app',
                namespace: 'app',
                title: 'Application',
                paths: ['src/app.ts'],
                complexity: 'medium' as const,
                recommendedAction: 'analyze' as const,
                rationale: 'Serve the primary runtime.',
                evidence: [{ path: 'src/app.ts', reason: 'Entrypoint' }],
                openQuestions: [],
              },
              {
                id: 'worker',
                namespace: 'worker',
                title: 'Worker',
                paths: ['src/worker.ts'],
                complexity: 'medium' as const,
                recommendedAction: 'analyze' as const,
                rationale: 'Process jobs.',
                evidence: [{ path: 'src/worker.ts', reason: 'Worker entrypoint' }],
                openQuestions: [],
              },
            ],
          },
          rawResponse: '{}',
          threadId: 'thread-plan',
        }),
      },
      level0BackboneBuilder: {
        buildLevel0Backbone: vi.fn().mockResolvedValue({
          rawYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: worker
    type: core/web-app.types.external-api
    name: Worker
    provenance:
      locations:
        - input: primary
          path: src/worker.ts
relations:
  - id: app-calls-worker
    type: core/software.relations.calls
    from: app
    to: worker
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
          doc: parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: worker
    type: core/web-app.types.external-api
    name: Worker
    provenance:
      locations:
        - input: primary
          path: src/worker.ts
relations:
  - id: app-calls-worker
    type: core/software.relations.calls
    from: app
    to: worker
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`),
          rawResponse: 'ok',
          threadId: 'thread-level0',
        }),
      },
      level0BackboneRepairer: {
        repairLevel0Backbone: vi.fn(),
      },
      ...createPassthroughLevel0Reviewers(),
      ...createPassthroughWave1Reviewers(),
      ...createPassthroughFinalReviewers(),
      nodeRefiner: {
        refineNode: vi
          .fn()
          .mockResolvedValueOnce({
            result: {
              children: [],
              relations: [],
              edgeRefinements: [],
            },
            rawResponse: '{}',
            threadId: 'thread-node-app',
          })
          .mockRejectedValueOnce(new Error('worker refinement blew up')),
        repairNode: vi.fn(),
      },
      graphCollator: {
        collateGraph: vi.fn(),
      },
    };

    await expect(
      buildDiagram(
        {
          repo: repoRoot,
          schemaSource: fixturePath('schema-repo'),
          out: outputPath,
        },
        {
          ...firstDependencies,
          logger: quietLogger(),
        },
      ),
    ).rejects.toThrow('worker refinement blew up');

    const resumedDependencies = {
      areaPlanner: {
        planAreas: vi.fn().mockImplementation(() => {
          throw new Error('planner should not rerun');
        }),
      },
      level0BackboneBuilder: {
        buildLevel0Backbone: vi.fn().mockImplementation(() => {
          throw new Error('level-0 backbone should not rerun');
        }),
      },
      level0BackboneRepairer: {
        repairLevel0Backbone: vi.fn(),
      },
      ...createPassthroughLevel0Reviewers(),
      ...createPassthroughWave1Reviewers(),
      ...createPassthroughFinalReviewers(),
      nodeRefiner: {
        refineNode: vi.fn().mockResolvedValue({
          result: {
            children: [],
            relations: [],
            edgeRefinements: [],
          },
          rawResponse: '{}',
          threadId: 'thread-node-worker',
        }),
        repairNode: vi.fn(),
      },
      graphCollator: {
        collateGraph: vi.fn().mockResolvedValue({
          rawYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: worker
    type: core/web-app.types.external-api
    name: Worker
    provenance:
      locations:
        - input: primary
          path: src/worker.ts
relations:
  - id: app-calls-worker
    type: core/software.relations.calls
    from: app
    to: worker
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
          doc: parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: worker
    type: core/web-app.types.external-api
    name: Worker
    provenance:
      locations:
        - input: primary
          path: src/worker.ts
relations:
  - id: app-calls-worker
    type: core/software.relations.calls
    from: app
    to: worker
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`),
          rawResponse: 'ok',
          threadId: 'thread-graph',
        }),
      },
    };

    const resumedResult = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,

        restartFrom: 'node-refinement',
      },
      {
        ...resumedDependencies,
        logger: quietLogger(),
      },
    );

    expect(resumedResult.threadId).toBe('thread-final-review');
    expect(resumedDependencies.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(resumedDependencies.level0BackboneBuilder.buildLevel0Backbone).not.toHaveBeenCalled();
    expect(resumedDependencies.nodeRefiner.refineNode).toHaveBeenCalledTimes(2);
    expect(resumedDependencies.nodeRefiner.refineNode).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          nodeId: 'worker',
        }),
      }),
    );
  });

  it('keeps one shared advanced thread across the pipeline when stages use the injected prompt runner', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createPromptRunnerBackedAdvancedDependencies();
    const { client, threads } = createSharedAdvancedThreadClient([
      'thread-advanced',
      'thread-backbone-review',
      'thread-final-review',
    ]);

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,

        reasoningEffort: 'max',
      },
      {
        ...dependencies,
        advancedThreadClient: client,
        logger: quietLogger(),
      },
    );

    expect(client.startThread).toHaveBeenCalledTimes(3);
    for (const [threadOptions] of client.startThread.mock.calls) {
      expect(threadOptions).toMatchObject({ modelReasoningEffort: 'max' });
    }
    expect(client.resumeThread).not.toHaveBeenCalled();
    expect(threads[0]?.run).toHaveBeenCalledTimes(4);
    expect(threads[1]?.run).toHaveBeenCalledTimes(1);
    expect(threads[2]?.run).toHaveBeenCalledTimes(1);
    expect(dependencies.usedThreadIds).toHaveLength(6);
    expect(new Set(dependencies.usedThreadIds)).toEqual(
      new Set(['thread-advanced', 'thread-backbone-review', 'thread-final-review']),
    );
    expect(result.threadId).toBe('thread-final-review');

    const metadata = await readJobMetadata(`${outputPath}.job`);
    expect(metadata?.advanced?.currentAdvancedThreadId).toBe('thread-advanced');
    expect(metadata?.reasoningEffort).toBe('max');
  }, 40000);

  it('runs wave-1 review on a separate review thread before the first depth-1 task', async () => {
    const repoRoot = await createGitRepo({
      'package.json': JSON.stringify({ name: 'test-repo' }, null, 2),
      'src/index.ts': 'export const hello = "world";\n',
    });
    const outputPath = path.join(await createTempDir('diagram-worker-out-'), 'diagram.yaml');
    const dependencies = createPromptRunnerBackedAdvancedDependencies();
    dependencies.nodeRefiner.refineNode = vi.fn().mockImplementation(async (input) => {
      if (!input.promptRunner || !input.handoffArtifactPath) {
        throw new Error('shared prompt runner was not provided to node refinement');
      }
      const turn = await input.promptRunner.runPrompt({
        prompt: `refine ${input.task.nodeId}`,
        operation: `node refinement ${input.task.nodeId}`,
        scope: 'node-refinement',
        handoffArtifactPath: input.handoffArtifactPath,
      });
      dependencies.usedThreadIds.push(turn.threadId ?? 'none');
      return {
        result:
          input.task.depth === 0
            ? {
                children: [
                  {
                    localId: 'runtime',
                    name: 'Application runtime',
                    typeId: 'core/web-app.types.service',
                    scope: ['src/index.ts'],
                    evidence: [{ path: 'src/index.ts', reason: 'Runtime' }],
                    queueDecision: 'expand' as const,
                  },
                ],
                relations: [],
                edgeRefinements: [
                  {
                    edgeId: 'browser-calls-app',
                    toChildLocalId: 'runtime',
                  },
                  {
                    edgeId: 'app-calls-backend',
                    fromChildLocalId: 'runtime',
                  },
                ],
              }
            : {
                children: [],
                relations: [],
                edgeRefinements: [],
              },
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
      };
    });
    const { client, threads } = createSharedAdvancedThreadClient();

    const result = await buildDiagram(
      {
        repo: repoRoot,
        schemaSource: fixturePath('schema-repo'),
        out: outputPath,
      },
      {
        ...dependencies,
        advancedThreadClient: client,
        logger: quietLogger(),
      },
    );

    expect(client.startThread).toHaveBeenCalledTimes(4);
    for (const [threadOptions] of client.startThread.mock.calls) {
      expect(threadOptions).toMatchObject({ modelReasoningEffort: 'medium' });
    }
    expect(threads[0]?.run).toHaveBeenCalledTimes(5);
    expect(threads[1]?.run).toHaveBeenCalledTimes(1);
    expect(threads[2]?.run).toHaveBeenCalledTimes(1);
    expect(threads[3]?.run).toHaveBeenCalledTimes(1);
    expect(dependencies.usedThreadIds).toEqual(
      expect.arrayContaining([
        'thread-advanced',
        'thread-backbone-review',
        'thread-wave1-review',
        'thread-final-review',
      ]),
    );
    expect(result.threadId).toBe('thread-final-review');
  }, 40000);
});

describe('stage-owned backbone checkpoints', () => {
  it.each([
    'resume',
    'restart',
    'legacy',
  ] as const)('keeps reviewer changes on %s after node-refinement interruption', async (mode) => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const runtime = true;\n' });
    const out = path.join(await createTempDir('reviewed-resume-'), 'diagram.yaml');
    const first = createAdvancedDependencies();
    first.level0BackboneReviewer.reviewLevel0Backbone.mockImplementation(
      async ({ currentBackboneYaml }) => {
        const rawYaml = currentBackboneYaml.replace(
          'name: Application',
          'name: Reviewed application',
        );
        return {
          rawYaml,
          doc: parseDocument(rawYaml),
          rawResponse: rawYaml,
          threadId: 'review-changed',
        };
      },
    );
    let outputDir = '';
    first.nodeRefiner.refineNode.mockImplementation(async ({ workspace }) => {
      outputDir = workspace.workspaceOutputDir;
      throw new Error('intentional interruption');
    });
    const options = {
      repo,
      out,
      schemaSource: fixturePath('schema-repo'),
    };
    await expect(buildDiagram(options, { ...first, logger: quietLogger() })).rejects.toThrow(
      'intentional interruption',
    );
    if (mode === 'legacy')
      await fs.rm(path.join(outputDir, 'analysis/level0-review.yaml'), { force: true });
    const checkpoint = path.join(outputDir, 'analysis/level0-backbone.pre-review.yaml');
    const rawBefore = await fs.readFile(checkpoint, 'utf8');
    const next = createAdvancedDependencies();
    const names: string[] = [];
    next.nodeRefiner.refineNode.mockImplementation(async ({ workspace }) => {
      const latest = parseDocument(
        await fs.readFile(
          path.join(workspace.workspaceOutputDir, 'analysis/level0-backbone.yaml'),
          'utf8',
        ),
      );
      names.push(latest.entities.find((entity) => entity.id === 'app')?.name ?? '');
      expect(names.at(-1)).toBe('Reviewed application');
      return {
        result: { children: [], relations: [], edgeRefinements: [] },
        rawResponse: '{}',
        threadId: 'resumed-node',
      };
    });
    await buildDiagram(
      { ...options, ...(mode === 'restart' ? { restartFrom: 'node-refinement' as const } : {}) },
      { ...next, logger: quietLogger() },
    );
    expect(names).toContain('Reviewed application');
    expect(await fs.readFile(checkpoint, 'utf8')).toBe(rawBefore);
    expect(next.level0BackboneReviewer.reviewLevel0Backbone).not.toHaveBeenCalled();
  }, 40000);
  it.each([
    'resume',
    'restart',
    'legacy',
  ] as const)('keeps wave-1 changes on %s after deeper refinement interruption', async (mode) => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const runtime = true;\n' });
    const out = path.join(await createTempDir('wave1-resume-'), 'diagram.yaml');
    const first = createAdvancedDependencies();
    first.wave1Reviewer.reviewWave1.mockResolvedValue({
      patch: { rootEdits: [{ rootId: 'app', root: { name: 'Wave-one application' } }] },
      rawResponse: '{}',
      threadId: 'changed-wave1',
    });
    let outputDir = '';
    first.nodeRefiner.refineNode.mockImplementation(async ({ task, workspace }) => {
      outputDir = workspace.workspaceOutputDir;
      if (task.depth > 0) throw new Error('intentional deeper interruption');
      return {
        result: {
          children: [
            {
              localId: 'runtime',
              name: 'Runtime',
              typeId: 'core/web-app.types.service',
              scope: ['src/index.ts'],
              evidence: [{ path: 'src/index.ts', reason: 'Runtime' }],
              queueDecision: 'expand',
            },
          ],
          relations: [],
          edgeRefinements: [
            { edgeId: 'browser-calls-app', toChildLocalId: 'runtime' },
            { edgeId: 'app-calls-backend', fromChildLocalId: 'runtime' },
          ],
        },
        rawResponse: '{}',
        threadId: 'first-root',
      };
    });
    const options = {
      repo,
      out,
      schemaSource: fixturePath('schema-repo'),
    };
    await expect(buildDiagram(options, { ...first, logger: quietLogger() })).rejects.toThrow(
      'intentional deeper interruption',
    );
    expect(first.wave1Reviewer.reviewWave1).toHaveBeenCalledTimes(1);
    if (mode === 'legacy') {
      await fs.rm(path.join(outputDir, 'analysis/level0-review.yaml'), { force: true });
      await fs.rm(path.join(outputDir, 'analysis/level0-wave1.yaml'), { force: true });
    }
    const next = createAdvancedDependencies();
    const names: string[] = [];
    next.nodeRefiner.refineNode.mockImplementation(async ({ workspace }) => {
      const latest = parseDocument(
        await fs.readFile(
          path.join(workspace.workspaceOutputDir, 'analysis/level0-backbone.yaml'),
          'utf8',
        ),
      );
      names.push(latest.entities.find((entity) => entity.id === 'app')?.name ?? '');
      expect(names.at(-1)).toBe('Wave-one application');
      return {
        result: { children: [], relations: [], edgeRefinements: [] },
        rawResponse: '{}',
        threadId: 'resumed-node',
      };
    });
    await buildDiagram(
      { ...options, ...(mode === 'restart' ? { restartFrom: 'node-refinement' as const } : {}) },
      { ...next, logger: quietLogger() },
    );
    expect(names).toContain('Wave-one application');
  }, 40000);
});

describe('restart checkpoint invalidation', () => {
  it('runs refinement fresh after an area-plan restart is interrupted and then resumed', async () => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const runtime = true;\n' });
    const out = path.join(await createTempDir('restart-checkpoints-'), 'diagram.yaml');
    const options = {
      repo,
      out,
      schemaSource: fixturePath('schema-repo'),
    };
    const first = createAdvancedDependencies();
    let outputDir = '';
    const originalRefine = first.nodeRefiner.refineNode.getMockImplementation()!;
    first.nodeRefiner.refineNode.mockImplementation(async (input) => {
      outputDir = input.workspace.workspaceOutputDir;
      return originalRefine(input);
    });
    await buildDiagram(options, { ...first, logger: quietLogger() });
    const oldState = await fs.readFile(
      path.join(outputDir, 'analysis/node-refinement-state.json'),
      'utf8',
    );
    const second = createAdvancedDependencies();
    second.level0BackboneBuilder.buildLevel0Backbone.mockImplementation(async () => {
      const metadata = JSON.parse(
        await fs.readFile(path.join(outputDir, 'job-metadata.json'), 'utf8'),
      );
      expect(metadata.advanced).toMatchObject({
        lastCompletedStage: 'area-plan',
        currentNodeRefinementArtifact: null,
        currentGraphArtifact: null,
        currentGraphResponseArtifact: null,
        currentGraphReviewCompleted: false,
      });
      await expect(
        fs.access(path.join(outputDir, 'analysis/node-refinement-state.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        fs.access(path.join(outputDir, 'analysis/final-graph.yaml')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      throw new Error('interrupted new backbone');
    });
    await expect(
      buildDiagram({ ...options, restartFrom: 'area-plan' }, { ...second, logger: quietLogger() }),
    ).rejects.toThrow('interrupted new backbone');
    const third = createAdvancedDependencies();
    await buildDiagram(options, { ...third, logger: quietLogger() });
    expect(third.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(third.level0BackboneBuilder.buildLevel0Backbone).toHaveBeenCalled();
    expect(third.nodeRefiner.refineNode).toHaveBeenCalled();
    const staleRoot = path.join(outputDir, 'analysis/stale');
    const staleDirs = await fs.readdir(staleRoot);
    const archived = await Promise.all(
      staleDirs.map(async (dir) =>
        fs
          .readFile(path.join(staleRoot, dir, 'node-refinement-state.json'), 'utf8')
          .catch(() => null),
      ),
    );
    expect(archived).toContain(oldState);
  }, 40000);

  it.each([
    false,
    true,
  ])('preserves accepted schemas across resume (corrupt schema checkpoint: %s)', async (corruptSchemaCheckpoint) => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const runtime = true;\n' });
    const out = path.join(await createTempDir('schema-resume-'), 'diagram.yaml');
    const options = {
      repo,
      out,
      schemaSource: fixturePath('schema-repo'),
    };
    const first = createAdvancedDependencies();
    const planned = await first.areaPlanner.planAreas();
    first.areaPlanner.planAreas.mockResolvedValue({
      ...planned,
      plan: {
        ...planned.plan,
        candidateSchemaRefs: [
          {
            schemaRef: 'core/code@0.1',
            suggestedLayer: 1,
            rationale: 'Implementation layer',
            evidence: [{ path: 'src/index.ts', reason: 'Implementation' }],
          },
        ] as never,
      },
    });
    first.nodeRefiner.refineNode.mockImplementation(async ({ task }) => {
      if (task.depth > 0) throw new Error('interrupted after schema acceptance');
      return {
        result: {
          children: [
            {
              localId: 'runtime',
              name: 'Runtime',
              typeId: 'core/web-app.types.service',
              scope: ['src/index.ts'],
              evidence: [{ path: 'src/index.ts', reason: 'Runtime' }],
              queueDecision: 'expand',
            },
          ],
          relations: [],
          edgeRefinements: [
            { edgeId: 'browser-calls-app', toChildLocalId: 'runtime' },
            { edgeId: 'app-calls-backend', fromChildLocalId: 'runtime' },
          ],
          suggestedSchemaRefs: ['core/code@0.1'],
        },
        rawResponse: '{}',
        threadId: 'first-node',
      };
    });
    await expect(buildDiagram(options, { ...first, logger: quietLogger() })).rejects.toThrow(
      'interrupted after schema acceptance',
    );
    const catalog = JSON.parse(
      await fs.readFile(path.join(`${out}.job`, 'out/analysis/schema-flow-catalog.json'), 'utf8'),
    );
    expect(catalog.activeSchemaRefs).toContainEqual({ schema: 'core/code@0.1', layer: 1 });
    if (corruptSchemaCheckpoint) {
      await fs.writeFile(path.join(`${out}.job`, 'out/analysis/schema-set.json'), '{broken');
    }
    const next = createAdvancedDependencies();
    if (corruptSchemaCheckpoint) next.areaPlanner = first.areaPlanner;
    let rootRecomputed = false;
    next.nodeRefiner.refineNode.mockImplementation(async (params) => {
      if (corruptSchemaCheckpoint && params.task.depth === 0) {
        rootRecomputed = true;
        return first.nodeRefiner.refineNode(params);
      }
      const { activeSchemaRefs } = params;
      expect(activeSchemaRefs).toContainEqual({ schema: 'core/code@0.1', layer: 1 });
      return {
        result: { children: [], relations: [], edgeRefinements: [] },
        rawResponse: '{}',
        threadId: 'resumed-node',
      };
    });
    const logger = quietLogger();
    await buildDiagram(options, { ...next, logger });
    expect(rootRecomputed).toBe(corruptSchemaCheckpoint);
    if (corruptSchemaCheckpoint) {
      expect(
        logger.warn.mock.calls.some(
          ([message]) => message.includes('schema-set.json') && message.includes('recomputing'),
        ),
      ).toBe(true);
      expect(next.level0BackboneBuilder.buildLevel0Backbone).toHaveBeenCalled();
    }
    expect(next.nodeRefiner.refineNode).toHaveBeenCalled();
    expect(parseDocument(await fs.readFile(out, 'utf8')).schemaRefs).toContainEqual({
      schema: 'core/code@0.1',
      layer: 1,
    });
  }, 40000);
});

it('preserves the original advanced error cause and thread ID', async () => {
  const repo = await createGitRepo({ 'src/index.ts': 'export const runtime = true;\n' });
  const out = path.join(await createTempDir('advanced-cause-'), 'diagram.yaml');
  const cause = Object.assign(new Error('mock advanced generation failure'), {
    threadId: 'failing-thread',
  });
  const dependencies = createAdvancedDependencies();
  dependencies.areaPlanner.planAreas.mockRejectedValue(cause);
  await expect(
    buildDiagram(
      { repo, out, schemaSource: fixturePath('schema-repo') },
      { ...dependencies, logger: quietLogger() },
    ),
  ).rejects.toMatchObject({
    name: 'BuildDiagramError',
    threadId: 'failing-thread',
    cause: { name: 'AiDiagramServiceError', cause },
  });
});

it.each([
  'invalid',
  'malformed',
  'later-failure',
] as const)('keeps pre-review wave-1 state after %s repairs fail', async (mode) => {
  const repo = await createGitRepo({ 'src/index.ts': 'export const runtime = true;\n' });
  const out = path.join(await createTempDir('wave1-fallback-'), 'diagram.yaml');
  const dependencies = createAdvancedDependencies();
  const planned = await dependencies.areaPlanner.planAreas();
  dependencies.areaPlanner.planAreas.mockResolvedValue({
    ...planned,
    plan: {
      ...planned.plan,
      candidateSchemaRefs: [
        {
          schemaRef: 'core/code@0.1',
          suggestedLayer: 1,
          rationale: 'Implementation',
          evidence: [{ path: 'src/index.ts', reason: 'Implementation' }],
        },
      ] as never,
    },
  });
  const rejectedPatch = {
    suggestedSchemaRefs: ['core/code@0.1'],
    rootEdits: [{ rootId: 'app', root: { typeId: 'missing.type', name: 'Rejected replacement' } }],
  };
  dependencies.wave1Reviewer.reviewWave1.mockResolvedValue({
    patch: rejectedPatch,
    rawResponse: '{}',
    threadId: 'bad-review',
  });
  if (mode === 'malformed')
    dependencies.wave1ReviewerRepairer.repairWave1Review.mockRejectedValue(
      new ModelOutputParseError({
        operation: 'wave1 repair',
        expectedFormat: 'json',
        rawResponse: 'broken',
        threadId: 'bad-repair',
        tokenUsage: emptyTokenUsageTotals(),
        cause: new SyntaxError('bad JSON'),
      }),
    );
  else
    dependencies.wave1ReviewerRepairer.repairWave1Review.mockResolvedValue({
      patch: rejectedPatch,
      rawResponse: '{}',
      threadId: 'bad-repair',
    });
  let outputDir = '';
  dependencies.nodeRefiner.refineNode.mockImplementation(async ({ task, workspace }) => {
    outputDir = workspace.workspaceOutputDir;
    if (task.depth > 0) {
      const checkpoint = JSON.parse(
        await fs.readFile(path.join(outputDir, 'analysis/node-refinement-state.json'), 'utf8'),
      );
      expect(checkpoint.reviewedDepths).toContain(1);
      expect(checkpoint.nodesById.app.name).not.toBe('Rejected replacement');
      expect(checkpoint.nodesById['app/runtime']).toBeDefined();
      expect(checkpoint.budgets.turnsUsed).toBeGreaterThan(1);
      if (mode === 'later-failure') throw new Error('original later failure');
      return {
        result: { children: [], relations: [], edgeRefinements: [] },
        rawResponse: '{}',
        threadId: 'child',
      };
    }
    return {
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.service',
            scope: ['src/index.ts'],
            evidence: [{ path: 'src/index.ts', reason: 'Runtime' }],
            queueDecision: 'expand',
          },
        ],
        relations: [],
        edgeRefinements: [
          { edgeId: 'browser-calls-app', toChildLocalId: 'runtime' },
          { edgeId: 'app-calls-backend', fromChildLocalId: 'runtime' },
        ],
      },
      rawResponse: '{}',
      threadId: 'root',
    };
  });
  const logger = { ...quietLogger(), warn: vi.fn() };
  const build = buildDiagram(
    { repo, out, schemaSource: fixturePath('schema-repo') },
    { ...dependencies, logger },
  );
  if (mode === 'later-failure') {
    await expect(build).rejects.toThrow('original later failure');
    const metadata = JSON.parse(
      await fs.readFile(path.join(outputDir, 'job-metadata.json'), 'utf8'),
    );
    expect(metadata.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'diagram.wave1.review_fallback', severity: 'warning' }),
      ]),
    );
    return;
  }
  const result = await build;
  expect(dependencies.wave1ReviewerRepairer.repairWave1Review).toHaveBeenCalled();
  expect(
    parseDocument(await fs.readFile(out, 'utf8')).schemaRefs.some((ref) =>
      ref.schema.startsWith('core/code@'),
    ),
  ).toBe(false);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'diagram.wave1.review_fallback', severity: 'warning' }),
    ]),
  );
  const metadata = JSON.parse(await fs.readFile(path.join(outputDir, 'job-metadata.json'), 'utf8'));
  expect(metadata.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'diagram.wave1.review_fallback', severity: 'warning' }),
    ]),
  );
  expect(logger.warn).toHaveBeenCalledWith(
    expect.stringContaining('valid pre-review wave-1 state'),
  );
}, 40000);

describe('corrupt checkpoint recovery', () => {
  it.each([
    'analysis/level0-review.yaml',
    'analysis/area-plan.json',
  ])('recomputes %s and warns with its filename', async (checkpoint) => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const runtime = true;\n' });
    const out = path.join(await createTempDir('corrupt-checkpoint-'), 'diagram.yaml');
    const first = createAdvancedDependencies();
    let outputDir = '';
    first.nodeRefiner.refineNode.mockImplementation(async ({ workspace }) => {
      outputDir = workspace.workspaceOutputDir;
      throw new Error('intentional interruption');
    });
    const options = {
      repo,
      out,
      schemaSource: fixturePath('schema-repo'),
    };
    await expect(buildDiagram(options, { ...first, logger: quietLogger() })).rejects.toThrow(
      'intentional interruption',
    );
    await fs.writeFile(path.join(outputDir, checkpoint), '{broken: [');
    const next = createAdvancedDependencies();
    const logger = quietLogger();
    await buildDiagram(options, { ...next, logger });
    expect(
      logger.warn.mock.calls.some(
        ([message]) => message.includes(checkpoint) && message.includes('Recomputing from'),
      ),
    ).toBe(true);
    expect(next.level0BackboneReviewer.reviewLevel0Backbone).toHaveBeenCalled();
    if (checkpoint.endsWith('.json')) expect(next.areaPlanner.planAreas).toHaveBeenCalled();
  }, 40000);

  it('hard refresh replaces corrupt metadata rather than trying to resume it', async () => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const runtime = true;\n' });
    const root = await createTempDir('corrupt-metadata-overwrite-');
    const jobRoot = path.join(root, 'job');
    await fs.mkdir(path.join(jobRoot, 'out'), { recursive: true });
    await fs.writeFile(path.join(jobRoot, 'out', 'job-metadata.json'), '{broken');
    const options = {
      repo,
      out: path.join(root, 'diagram.yaml'),
      jobRoot,
      schemaSource: fixturePath('schema-repo'),
    };
    await expect(
      buildDiagram(options, { ...createAdvancedDependencies(), logger: quietLogger() }),
    ).rejects.toThrow('Job metadata at');
    await buildDiagram(
      { ...options, hardRefresh: true },
      { ...createAdvancedDependencies(), logger: quietLogger() },
    );
    expect(await readJobMetadata(jobRoot)).toMatchObject({ version: 1, status: 'succeeded' });
  }, 40000);
});

it('marks an aborted turn interrupted, retains durable usage and releases the job lock', async () => {
  const repo = await createGitRepo({ 'src/index.ts': 'export const runtime = true;\n' });
  const outputRoot = await createTempDir('interrupted-build-');
  const out = path.join(outputRoot, 'diagram.yaml');
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let received: AbortSignal | undefined;
  const run = vi.fn();
  const runStreamed = vi.fn(async (_prompt: string, options?: { signal?: AbortSignal }) => {
    received = options?.signal;
    async function* events(): AsyncGenerator<import('@openai/codex-sdk').ThreadEvent> {
      yield {
        type: 'turn.completed',
        usage: {
          input_tokens: 21,
          cached_input_tokens: 5,
          cache_write_input_tokens: 0,
          reasoning_output_tokens: 0,
          output_tokens: 3,
        },
      };
      started();
      await new Promise<never>((_resolve, reject) =>
        received?.addEventListener('abort', () => reject(received?.reason), { once: true }),
      );
    }
    return { events: events() };
  });
  const pending = buildDiagram(
    {
      repo,
      out,
      schemaSource: fixturePath('schema-repo'),

      signal: controller.signal,
    },
    {
      logger: quietLogger(),
      aiDiagramService: {
        generateDiagram: async () => {
          await runCodexPrompt({ id: 'cancel-thread', run, runStreamed }, 'test', {
            operation: 'test cancellation',
          });
          throw new Error('must not finish');
        },
      },
    },
  );
  const assertion = expect(pending).rejects.toThrow('SIGINT');
  await ready;
  await expect(
    buildDiagram(
      { repo, out, schemaSource: fixturePath('schema-repo') },
      { logger: quietLogger() },
    ),
  ).rejects.toThrow('another build is using');
  controller.abort(new Error('Build interrupted by SIGINT'));
  await assertion;
  expect(received?.aborted).toBe(true);
  expect(runStreamed).toHaveBeenCalledTimes(1);
  const metadata = await readJobMetadata(`${out}.job`);
  expect(metadata?.status).toBe('interrupted');
  expect(metadata?.usageAccounting?.reportedTurns).toBe(1);
  expect(metadata?.usageAccounting?.lastUsageByThread['cancel-thread']).toMatchObject({
    input_tokens: 21,
    output_tokens: 3,
  });
  await expect(fs.access(path.join(`${out}.job`, '.lock'))).rejects.toThrow();
  await expect(fs.access(out)).rejects.toThrow();
  // A subsequent run can acquire the job and surface its own failure normally.
  await expect(
    buildDiagram(
      { repo, out, schemaSource: fixturePath('schema-repo') },
      {
        logger: quietLogger(),
        aiDiagramService: {
          generateDiagram: async () => {
            throw new Error('next run');
          },
        },
      },
    ),
  ).rejects.toThrow('next run');
  await expect(fs.access(path.join(`${out}.job`, '.lock'))).rejects.toThrow();
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(outputRoot, { recursive: true, force: true });
});

describe('resume input fingerprints', () => {
  it.each([
    ['depth', 'node-refinement'],
    ['graphify', 'repo-census'],
    ['schema', 'area-plan'],
    ['cli', 'repo-census'],
    ['format', 'repo-census'],
  ] as const)(
    'recomputes exactly from the affected stage when %s changes',
    async (change, stage) => {
      const repo = await createGitRepo({
        'src/index.ts': 'export const app = true;\n',
      });
      const dir = await createTempDir('resume-inputs-');
      const source = path.join(dir, 'schemas');
      await fs.cp(fixturePath('schema-repo'), source, { recursive: true });
      const out = path.join(dir, 'diagram.yaml');
      const options = {
        repo,
        out,
        schemaSource: source,

        graphifyHintsMode: 'off' as const,
        nodeRefinementMaxDepth: 2,
      };
      await buildDiagram(options, {
        ...createAdvancedDependencies(),
        logger: quietLogger(),
      });
      const censusFile = path.join(`${out}.job`, 'out/analysis/repo-census.json');
      const before = await fs.readFile(censusFile, 'utf8');
      if (change === 'schema') {
        const files = await fs.readdir(path.join(source, 'src/schemas'));
        const file = files.find((name) => name.endsWith('.yaml'))!;
        await fs.appendFile(
          path.join(source, 'src/schemas', file),
          '\n# changed schema source revision\n',
        );
      }
      if (change === 'cli' || change === 'format') {
        const metadata = (await readJobMetadata(`${out}.job`))!;
        const record = metadata.advanced!.stageRecords!['repo-census']!;
        if (change === 'cli') record.inputs.cliVersion = 'old-cli';
        else record.inputs.checkpointFormat = -1;
        await writeJobMetadata(`${out}.job`, metadata);
      }
      const next = createAdvancedDependencies();
      if (change === 'depth')
        next.nodeRefiner.refineNode.mockImplementation(
          async ({ task }: { task: import('./advanced/types').NodeRefinementTask }) => ({
            result: {
              children: [
                {
                  localId: 'runtime',
                  name: 'Runtime',
                  typeId: 'core/web-app.types.service',
                  scope: ['src/index.ts'],
                  evidence: [{ path: 'src/index.ts', reason: 'Runtime' }],
                  queueDecision: 'expand',
                },
              ],
              relations: [],
              edgeRefinements: [
                ...task.inboundEdges.map(
                  (edge: import('./advanced/types').InheritedNodeEdgeContract) => ({
                    edgeId: edge.id,
                    toChildLocalId: 'runtime',
                  }),
                ),
                ...task.outboundEdges.map(
                  (edge: import('./advanced/types').InheritedNodeEdgeContract) => ({
                    edgeId: edge.id,
                    fromChildLocalId: 'runtime',
                  }),
                ),
              ],
            },
            rawResponse: '{}',
            threadId: 'depth-chain',
          }),
        );
      const log = quietLogger();
      await buildDiagram(
        {
          ...options,
          ...(change === 'depth' ? { nodeRefinementMaxDepth: 4 } : {}),
          ...(change === 'graphify' ? { graphifyHintsMode: 'auto' as const } : {}),
        },
        { ...next, logger: log },
      );
      expect(
        log.info.mock.calls
          .flat()
          .some((message) => message.startsWith(`Recomputing from ${stage}:`)),
      ).toBe(true);
      if (stage === 'node-refinement') {
        expect(next.areaPlanner.planAreas).not.toHaveBeenCalled();
        expect(next.level0BackboneBuilder.buildLevel0Backbone).not.toHaveBeenCalled();
      } else expect(next.areaPlanner.planAreas).toHaveBeenCalled();
      expect(next.nodeRefiner.refineNode).toHaveBeenCalled();
      expect(next.graphCollator.collateGraph).toHaveBeenCalled();
      const after = await fs.readFile(censusFile, 'utf8');
      if (stage === 'repo-census') expect(after).not.toBe(before);
      else expect(after).toBe(before);
      if (change === 'depth') {
        const state = JSON.parse(
          await fs.readFile(
            path.join(`${out}.job`, 'out/analysis/node-refinement-state.json'),
            'utf8',
          ),
        );
        expect(state.budgets.maxDepth).toBe(4);
        expect(state.nodesById['app/runtime/runtime/runtime/runtime']).toBeDefined();
        expect(
          next.nodeRefiner.refineNode.mock.calls.some(([input]) => input.task.depth === 3),
        ).toBe(true);
      }
      await fs.rm(repo, { recursive: true, force: true });
      await fs.rm(dir, { recursive: true, force: true });
    },
    40000,
  );

  it.each([
    'legacy',
    'malformed',
  ])('recomputes an incompatible %s checkpoint without exposing a TypeError', async (kind) => {
    const repo = await createGitRepo({
      'src/index.ts': 'export const app = true;\n',
    });
    const dir = await createTempDir('resume-shape-');
    const options = {
      repo,
      out: path.join(dir, 'diagram.yaml'),
      schemaSource: fixturePath('schema-repo'),

      graphifyHintsMode: 'off' as const,
      stopAfter: 'level0-review' as const,
    };
    await buildDiagram(options, {
      ...createAdvancedDependencies(),
      logger: quietLogger(),
    });
    const analysis = path.join(`${options.out}.job`, 'out/analysis');
    if (kind === 'legacy') await fs.rm(path.join(analysis, 'checkpoint-area-plan.json'));
    else
      await fs.writeFile(
        path.join(analysis, 'area-plan.json'),
        JSON.stringify({
          repoSummary: 'old format',
          initialSchemaActivations: [],
          candidateSchemaRefs: [],
          keyConcepts: [{}],
        }),
      );
    const next = createAdvancedDependencies();
    await buildDiagram(options, { ...next, logger: quietLogger() });
    expect(next.areaPlanner.planAreas).toHaveBeenCalledTimes(1);
    expect((await readJobMetadata(`${options.out}.job`))?.advanced?.lastCompletedStage).toBe(
      'level0-review',
    );
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(dir, { recursive: true, force: true });
  }, 40000);

  it('recomputes a state with malformed nested refinement collections', async () => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;\n' });
    const dir = await createTempDir('resume-nested-');
    const options = {
      repo,
      out: path.join(dir, 'diagram.yaml'),
      schemaSource: fixturePath('schema-repo'),

      graphifyHintsMode: 'off' as const,
    };
    await buildDiagram(options, { ...createAdvancedDependencies(), logger: quietLogger() });
    const file = path.join(`${options.out}.job`, 'out/analysis/node-refinement-state.json');
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    delete state.refinementsByNodeId.app.relations;
    await fs.writeFile(file, JSON.stringify(state));
    const next = createAdvancedDependencies();
    const log = quietLogger();
    await buildDiagram(options, { ...next, logger: log });
    expect(next.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(next.nodeRefiner.refineNode).toHaveBeenCalled();
    expect(
      log.warn.mock.calls
        .flat()
        .some((message) => message.startsWith('Recomputing from node-refinement:')),
    ).toBe(true);
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(dir, { recursive: true, force: true });
  }, 40000);

  it('reuses accepted checkpoints without repairs and retains per-stage model and effort', async () => {
    const repo = await createGitRepo({
      'src/index.ts': 'export const app = true;\n',
    });
    const dir = await createTempDir('resume-model-');
    const options = {
      repo,
      out: path.join(dir, 'diagram.yaml'),
      schemaSource: fixturePath('schema-repo'),

      graphifyHintsMode: 'off' as const,
    };
    await buildDiagram(
      {
        ...options,
        model: 'model-a',
        reasoningEffort: 'low',
        stopAfter: 'level0-review',
      },
      { ...createAdvancedDependencies(), logger: quietLogger() },
    );
    const accepted = (await readJobMetadata(`${options.out}.job`))!.advanced!;
    const repeat = createAdvancedDependencies();
    await buildDiagram(
      {
        ...options,
        model: 'model-b',
        reasoningEffort: 'high',
        stopAfter: 'level0-review',
      },
      { ...repeat, logger: quietLogger() },
    );
    const repeated = (await readJobMetadata(`${options.out}.job`))!.advanced!;
    expect(repeated.lastCompletedStage).toBe(accepted.lastCompletedStage);
    expect(repeated.stageRecords).toEqual(accepted.stageRecords);
    expect(repeat.level0BackboneRepairer.repairLevel0Backbone).not.toHaveBeenCalled();
    expect(repeat.level0BackboneReviewerRepairer.repairLevel0BackboneReview).not.toHaveBeenCalled();
    const next = createAdvancedDependencies();
    const log = quietLogger();
    const result = await buildDiagram(
      { ...options, model: 'model-b', reasoningEffort: 'high' },
      { ...next, logger: log },
    );
    expect(next.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(next.level0BackboneBuilder.buildLevel0Backbone).not.toHaveBeenCalled();
    expect(next.level0BackboneRepairer.repairLevel0Backbone).not.toHaveBeenCalled();
    expect(next.level0BackboneReviewer.reviewLevel0Backbone).not.toHaveBeenCalled();
    expect(next.level0BackboneReviewerRepairer.repairLevel0BackboneReview).not.toHaveBeenCalled();
    expect(result.buildSummary.model).toBe('model-a, model-b');
    expect(result.buildSummary.reasoningEffort).toBe('low, high');
    const metadata = (await readJobMetadata(`${options.out}.job`))!;
    expect(metadata.advanced!.stageRecords!['level0-review']).toMatchObject({
      model: 'model-a',
      reasoningEffort: 'low',
      completed: true,
    });
    expect(metadata.advanced!.stageRecords!['node-refinement']).toMatchObject({
      model: 'model-b',
      reasoningEffort: 'high',
      completed: true,
    });
    expect(
      log.info.mock.calls.flat().some((message) => message.startsWith('Recomputing from')),
    ).toBe(false);
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(dir, { recursive: true, force: true });
  }, 40000);
});

describe('explicit build lifecycle', () => {
  it('continues a stopped build, then reuses completed checkpoints until a fresh build is requested', async () => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;\n' });
    const dir = await createTempDir('build-lifecycle-');
    const out = path.join(dir, 'diagram.yaml');
    const options = {
      repo,
      out,
      schemaSource: fixturePath('schema-repo'),

      graphifyHintsMode: 'off' as const,
    };
    const stopped = await buildDiagram(
      { ...options, stopAfter: 'level0-backbone' },
      { ...createAdvancedDependencies(), logger: quietLogger() },
    );
    expect(stopped.outputPath).toBe(path.join(dir, 'diagram.partial.yaml'));
    await expect(fs.access(out)).rejects.toThrow();
    expect((await readJobMetadata(`${out}.job`))?.status).toBe('stopped');
    const next = createAdvancedDependencies();
    await buildDiagram(options, { ...next, logger: quietLogger() });
    expect(next.level0BackboneBuilder.buildLevel0Backbone).not.toHaveBeenCalled();
    expect(next.level0BackboneReviewer.reviewLevel0Backbone).toHaveBeenCalledOnce();
    await expect(fs.access(stopped.outputPath)).rejects.toThrow();
    await expect(fs.readFile(out, 'utf8')).resolves.toContain('schemaRefs:');
    const reused = createAdvancedDependencies();
    await buildDiagram(options, { ...reused, logger: quietLogger() });
    expect(reused.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(reused.nodeRefiner.refineNode).not.toHaveBeenCalled();
    expect(reused.graphCollator.collateGraph).not.toHaveBeenCalled();
    expect(reused.finalGraphReviewer.reviewFinalGraph).not.toHaveBeenCalled();
    const fresh = createAdvancedDependencies();
    await buildDiagram({ ...options, hardRefresh: true }, { ...fresh, logger: quietLogger() });
    expect(fresh.areaPlanner.planAreas).toHaveBeenCalledOnce();
    expect(fresh.level0BackboneBuilder.buildLevel0Backbone).toHaveBeenCalledOnce();
    expect(fresh.nodeRefiner.refineNode).toHaveBeenCalled();
    expect(fresh.graphCollator.collateGraph).toHaveBeenCalledOnce();
    expect(fresh.finalGraphReviewer.reviewFinalGraph).toHaveBeenCalledOnce();
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(dir, { recursive: true, force: true });
  }, 40000);

  it.each([
    'level0-review',
    'final-review',
  ] as const)('restarts %s and preserves earlier stage outputs', async (restartFrom) => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;\n' });
    const dir = await createTempDir('build-restart-');
    const out = path.join(dir, 'diagram.yaml');
    const options = {
      repo,
      out,
      schemaSource: fixturePath('schema-repo'),

      graphifyHintsMode: 'off' as const,
    };
    const first = createAdvancedDependencies();
    first.finalGraphReviewer.reviewFinalGraph.mockImplementation(
      async ({ currentFinalGraphYaml }) => {
        const doc = parseDocument(currentFinalGraphYaml);
        doc.metadata = { ...doc.metadata, reviewMarker: 'Previously reviewed name' };
        return {
          doc,
          rawYaml: serializeDocument(doc),
          rawResponse: 'reviewed',
          threadId: 'first-review',
        };
      },
    );
    await buildDiagram(options, { ...first, logger: quietLogger() });
    expect(await fs.readFile(out, 'utf8')).toContain('Previously reviewed name');
    const next = createAdvancedDependencies();
    await buildDiagram({ ...options, restartFrom }, { ...next, logger: quietLogger() });
    expect(next.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(next.level0BackboneBuilder.buildLevel0Backbone).not.toHaveBeenCalled();
    if (restartFrom === 'level0-review')
      expect(next.level0BackboneReviewer.reviewLevel0Backbone).toHaveBeenCalledOnce();
    else {
      expect(next.level0BackboneReviewer.reviewLevel0Backbone).not.toHaveBeenCalled();
      expect(next.nodeRefiner.refineNode).not.toHaveBeenCalled();
      expect(next.graphCollator.collateGraph).not.toHaveBeenCalled();
    }
    expect(next.finalGraphReviewer.reviewFinalGraph).toHaveBeenCalledOnce();
    expect(
      next.finalGraphReviewer.reviewFinalGraph.mock.calls[0][0].currentFinalGraphYaml,
    ).not.toContain('Previously reviewed name');
    expect((await readJobMetadata(`${out}.job`))?.status).toBe('succeeded');
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(dir, { recursive: true, force: true });
  }, 40000);
});

it.each([
  ['diagram.yaml', 'diagram.partial.yaml'],
  ['diagram.yml', 'diagram.partial.yml'],
  ['diagram', 'diagram.partial.yaml'],
])('derives partial output for %s', (input, expected) => {
  expect(derivePartialOutputPath(input)).toBe(expected);
});

describe('invocation turn budget', () => {
  it('stops after five SDK turns, checkpoints partial output, and resumes with a fresh allowance', async () => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
    const out = path.join(await createTempDir('turn-budget-'), 'diagram.yaml');
    const logger = quietLogger();
    const dependencies = createAdvancedDependencies();
    const sdk = {
      id: 'canned-sdk',
      run: vi.fn().mockResolvedValue({ finalResponse: '', items: [], usage: null }),
    };
    const wrapped = new Set<unknown>();
    for (const [name, adapter] of Object.entries(dependencies)) {
      if (name === 'graphifyHintsBuilder') continue;
      for (const method of Object.values(adapter)) {
        if (!vi.isMockFunction(method) || wrapped.has(method)) continue;
        wrapped.add(method);
        const original = method.getMockImplementation();
        if (!original) continue;
        method.mockImplementation(async (...args: unknown[]) => {
          await runCodexPrompt(sdk, name, { operation: name });
          return original(...args);
        });
      }
    }
    const options = {
      repo,
      out,
      schemaSource: fixturePath('schema-repo'),

      graphifyHintsMode: 'off' as const,
    };
    const first = await buildDiagram({ ...options, maxTurns: 5 }, { ...dependencies, logger });
    expect(sdk.run).toHaveBeenCalledTimes(5);
    expect(first.outputPath).toBe(out.replace('.yaml', '.partial.yaml'));
    expect((await readJobMetadata(first.workspace.jobRoot))?.status).toBe('budget-exhausted');
    expect(
      parseDocument(await fs.readFile(first.outputPath, 'utf8')).entities.length,
    ).toBeGreaterThan(0);
    expect(logger.info).toHaveBeenCalledWith(
      'Stopped after 5 turns (--max-turns). Run the same command again to continue.',
    );
    await expect(fs.stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
    dependencies.areaPlanner.planAreas.mockClear();
    const final = await buildDiagram(options, { ...dependencies, logger });
    expect(final.outputPath).toBe(out);
    expect((await readJobMetadata(final.workspace.jobRoot))?.status).toBe('succeeded');
    expect(dependencies.areaPlanner.planAreas).not.toHaveBeenCalled();
    expect(sdk.run.mock.calls.length).toBeGreaterThan(5);
    expect(parseDocument(await fs.readFile(out, 'utf8')).entities.length).toBeGreaterThan(0);
  });
});

it('bounds malformed area planning across repeated one-turn invocations', async () => {
  const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
  const out = path.join(await createTempDir('area-retry-budget-'), 'diagram.yaml');
  const dependencies = createAdvancedDependencies();
  const sdk = {
    id: 'canned-area',
    run: vi.fn().mockResolvedValue({ finalResponse: '', items: [], usage: null }),
  };
  dependencies.areaPlanner.planAreas.mockImplementation(async () => {
    await runCodexPrompt(sdk, 'area', { operation: 'area' });
    throw new ModelOutputParseError({
      operation: 'area',
      expectedFormat: 'json',
      rawResponse: 'bad',
      threadId: sdk.id,
      tokenUsage: emptyTokenUsageTotals(),
      cause: new Error('invalid area plan'),
    });
  });
  const options = {
    repo,
    out,
    schemaSource: fixturePath('schema-repo'),

    graphifyHintsMode: 'off' as const,
    maxTurns: 1,
  };
  const first = await buildDiagram(options, { ...dependencies, logger: quietLogger() });
  expect((await readJobMetadata(first.workspace.jobRoot))?.status).toBe('budget-exhausted');
  await buildDiagram(options, { ...dependencies, logger: quietLogger() });
  await expect(buildDiagram(options, { ...dependencies, logger: quietLogger() })).rejects.toThrow(
    'invalid area plan',
  );
  expect(sdk.run).toHaveBeenCalledTimes(3);
});

it('resumes a pending wave-1 repair with the same one-turn limit', async () => {
  const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
  const out = path.join(await createTempDir('wave-retry-budget-'), 'diagram.yaml');
  const dependencies = createAdvancedDependencies();
  const sdk = {
    id: 'canned-wave',
    run: vi.fn().mockResolvedValue({ finalResponse: '', items: [], usage: null }),
  };
  let reviewDrafts = 0;
  let repairTurns = 0;
  dependencies.nodeRefiner.refineNode.mockImplementation(async ({ task }) => {
    if (task.depth > 0)
      return {
        result: { children: [], relations: [], edgeRefinements: [] },
        rawResponse: '{}',
        threadId: 'child',
      };
    return {
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.service',
            scope: ['src/index.ts'],
            evidence: [{ path: 'src/index.ts', reason: 'Runtime' }],
            queueDecision: 'expand',
          },
        ],
        relations: [],
        edgeRefinements: [
          { edgeId: 'browser-calls-app', toChildLocalId: 'runtime' },
          { edgeId: 'app-calls-backend', fromChildLocalId: 'runtime' },
        ],
      },
      rawResponse: '{}',
      threadId: 'root',
    };
  });
  dependencies.wave1Reviewer.reviewWave1.mockImplementation(async () => {
    await runCodexPrompt(sdk, 'wave-review', { operation: 'wave-review' });
    reviewDrafts += 1;
    return {
      patch: { rootEdits: [{ rootId: 'app', root: { typeId: 'missing.type', name: 'Invalid' } }] },
      rawResponse: '{}',
      threadId: sdk.id,
    };
  });
  dependencies.wave1ReviewerRepairer.repairWave1Review.mockImplementation(async () => {
    await runCodexPrompt(sdk, 'wave-repair', { operation: 'wave-repair' });
    repairTurns += 1;
    return { patch: {}, rawResponse: '{}', threadId: sdk.id };
  });
  const options = {
    repo,
    out,
    schemaSource: fixturePath('schema-repo'),

    graphifyHintsMode: 'off' as const,
    maxTurns: 1,
  };
  const first = await buildDiagram(options, { ...dependencies, logger: quietLogger() });
  expect((await readJobMetadata(first.workspace.jobRoot))?.status).toBe('budget-exhausted');
  const second = await buildDiagram(options, { ...dependencies, logger: quietLogger() });
  expect((await readJobMetadata(second.workspace.jobRoot))?.status).toBe('succeeded');
  expect(second.outputPath).toBe(out);
  expect(reviewDrafts).toBe(1);
  expect(repairTurns).toBe(1);
});

it.each([
  'backbone',
  'backbone-review',
  'final-review',
] as const)('resumes pending %s repair across repeated identical one-turn invocations', async (stage) => {
  const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
  const out = path.join(await createTempDir('document-retry-budget-'), 'diagram.yaml');
  const dependencies = createAdvancedDependencies();
  const sdk = {
    id: 'canned-document',
    run: vi.fn().mockResolvedValue({ finalResponse: '', items: [], usage: null }),
  };
  const originalBackbone =
    dependencies.level0BackboneBuilder.buildLevel0Backbone.getMockImplementation()!;
  const initial =
    stage === 'backbone'
      ? dependencies.level0BackboneBuilder.buildLevel0Backbone
      : stage === 'backbone-review'
        ? dependencies.level0BackboneReviewer.reviewLevel0Backbone
        : dependencies.finalGraphReviewer.reviewFinalGraph;
  const repair =
    stage === 'backbone'
      ? dependencies.level0BackboneRepairer.repairLevel0Backbone
      : stage === 'backbone-review'
        ? dependencies.level0BackboneReviewerRepairer.repairLevel0BackboneReview
        : dependencies.finalGraphReviewerRepairer.repairFinalGraphReview;
  initial.mockImplementation(async () => {
    throw new ModelOutputParseError({
      operation: stage,
      expectedFormat: 'yaml',
      rawResponse: 'invalid yaml',
      threadId: sdk.id,
      tokenUsage: emptyTokenUsageTotals(),
      cause: new Error('malformed output'),
    });
  });
  repair.mockImplementation(async () => originalBackbone());
  const wrapped = new Set<unknown>();
  for (const [name, adapter] of Object.entries(dependencies)) {
    if (name === 'graphifyHintsBuilder') continue;
    for (const method of Object.values(adapter)) {
      if (!vi.isMockFunction(method) || wrapped.has(method)) continue;
      wrapped.add(method);
      const original = method.getMockImplementation();
      if (!original) continue;
      method.mockImplementation(async (...args: unknown[]) => {
        await runCodexPrompt(sdk, name, { operation: name });
        return original(...args);
      });
    }
  }
  const options = {
    repo,
    out,
    schemaSource: fixturePath('schema-repo'),

    graphifyHintsMode: 'off' as const,
    maxTurns: 1,
  };
  let completed = false;
  for (let invocation = 0; invocation < 15; invocation++) {
    const before = sdk.run.mock.calls.length;
    const result = await buildDiagram(options, { ...dependencies, logger: quietLogger() });
    expect(sdk.run.mock.calls.length - before).toBeLessThanOrEqual(1);
    if ((await readJobMetadata(result.workspace.jobRoot))?.status === 'succeeded') {
      completed = true;
      break;
    }
  }
  expect(completed, JSON.stringify(sdk.run.mock.calls)).toBe(true);
  // Denied calls can enter the mock wrapper, but only one paid draft and one repair are allowed.
  expect(
    sdk.run.mock.calls.filter(
      ([prompt]) =>
        prompt ===
        (stage === 'backbone'
          ? 'level0BackboneBuilder'
          : stage === 'backbone-review'
            ? 'level0BackboneReviewer'
            : 'finalGraphReviewer'),
    ),
  ).toHaveLength(1);
  expect(parseDocument(await fs.readFile(out, 'utf8')).entities.length).toBeGreaterThan(0);
}, 40000);

describe('output secret redaction integration', () => {
  it.each([
    'final',
    'stop',
    'budget',
  ] as const)('redacts %s output and preserves warning metadata', async (kind) => {
    const secret = 'ghp_' + randomBytes(18).toString('hex');
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
    const out = path.join(await createTempDir('secret-output-'), 'diagram.yaml');
    const document = parseDocument(CANONICAL_EXAMPLE_YAML);
    document.entities[0].description = secret;
    const logger = quietLogger();
    const onSecrets = vi.fn();
    const result = await buildDiagram(
      {
        repo,
        out,
        schemaSource: fixturePath('schema-repo'),
        ...(kind === 'stop' ? { stopAfter: 'repo-census' as const } : {}),
        onSecrets,
      },
      {
        logger,
        aiDiagramService: {
          generateDiagram: async () => {
            if (kind === 'budget') {
              retainPartialDocument(document);
              throw new TurnBudgetExhaustedError(1);
            }
            return {
              document,
              finalYaml: serializeDocument(document),
              threadId: 'fake',
              repaired: false,
              diagnostics: [],
              resolvedSchemaIds: [],
              turnCount: 1,
              tokenUsage: emptyTokenUsageTotals(),
            };
          },
        },
      },
    );
    const raw = await fs.readFile(result.outputPath, 'utf8');
    expect(raw).not.toContain(secret);
    expect(
      validateDiagramYaml({
        yaml: raw,
        schemaRegistry: await loadSchemaRegistry(result.workspace.schemaRepoPath),
      }).ok,
    ).toBe(true);
    expect(parseDocument(raw).entities[0]).toMatchObject({
      id: document.entities[0].id,
      type: document.entities[0].type,
      description: '[REDACTED]',
    });
    expect(result.secrets).toEqual({ maskedInRepo: 0, files: [], redactedFromOutput: 1 });
    expect(onSecrets).toHaveBeenLastCalledWith(result.secrets, undefined);
    const metadata = await readJobMetadata(result.workspace.jobRoot);
    expect(metadata?.secrets).toEqual(result.secrets);
    expect(metadata?.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'diagram.secret_redacted', severity: 'warning' }),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Redacted a possible secret'));
    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('Build failed'));
    if (kind !== 'final') expect(result.outputPath).toBe(derivePartialOutputPath(out));
  });

  it('redacts the schema sidecar and reports zeros for a clean diagram', async () => {
    const secret = 'ghp_' + randomBytes(18).toString('hex');
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
    const outputRoot = await createTempDir('schema-redaction-');
    const artifactPath = path.join(outputRoot, 'generated.yaml');
    await fs.writeFile(
      artifactPath,
      `owner: repo\nname: masking-test\nversion: "0.1"\ndescription: ${secret}\ntypes: []\nrelations: []\n`,
    );
    const out = path.join(outputRoot, 'diagram.yaml');
    const schemaOut = path.join(outputRoot, 'schema.yaml');
    const document = parseDocument(CANONICAL_EXAMPLE_YAML);
    const result = await buildDiagram(
      {
        repo,
        out,
        schemaOut,
        schemaId: 'repo/masking-test',
        schemaSource: fixturePath('schema-repo'),
      },
      {
        logger: quietLogger(),
        generatedSchemaService: {
          prepareGeneratedSchema: async () => ({
            status: 'succeeded',
            schemaId: 'repo/masking-test',
            schemaRef: 'repo/masking-test@0.1',
            artifactPath,
            repaired: false,
            reused: false,
            usedByDiagram: false,
            threadId: null,
            diagnostics: [],
            failureMessage: null,
          }),
        } as never,
        aiDiagramService: {
          generateDiagram: async () => ({
            document,
            finalYaml: serializeDocument(document),
            threadId: null,
            repaired: false,
            diagnostics: [],
            resolvedSchemaIds: [],
            turnCount: 1,
            tokenUsage: emptyTokenUsageTotals(),
          }),
        },
      },
    );
    const written = await fs.readFile(schemaOut, 'utf8');
    expect(written).toContain('[REDACTED]');
    expect(written).not.toContain(secret);
    expect(written).toContain('name: masking-test');
    expect(result.secrets.redactedFromOutput).toBe(1);
    expect((await readJobMetadata(result.workspace.jobRoot))?.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'diagram.secret_redacted' }),
    );
    const clean = await buildDiagram(
      { repo, out: path.join(outputRoot, 'clean.yaml'), schemaSource: fixturePath('schema-repo') },
      {
        logger: quietLogger(),
        aiDiagramService: {
          generateDiagram: async () => ({
            document,
            finalYaml: serializeDocument(document),
            threadId: null,
            repaired: false,
            diagnostics: [],
            resolvedSchemaIds: [],
            turnCount: 1,
            tokenUsage: emptyTokenUsageTotals(),
          }),
        },
      },
    );
    expect(clean.secrets).toEqual({ maskedInRepo: 0, files: [], redactedFromOutput: 0 });
  });
});

it('ignores all resume inputs after masking marker migration', async () => {
  const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
  const out = path.join(await createTempDir('mask-resume-gate-'), 'diagram.yaml');
  const document = parseDocument(CANONICAL_EXAMPLE_YAML);
  const options = { repo, out, schemaSource: fixturePath('schema-repo') };
  await buildDiagram(options, {
    logger: quietLogger(),
    aiDiagramService: {
      generateDiagram: async () => {
        retainPartialDocument(document);
        throw new TurnBudgetExhaustedError(1);
      },
    },
  });
  await fs.rm(path.join(out + '.job', 'target-repo.json'));
  const generateDiagram = vi.fn(
    async (input: import('./ai-diagram-service').GenerateDiagramOptions) => {
      expect(input.resume).toBeUndefined();
      expect(input.workspace.analysisReusable).toBe(false);
      return {
        document,
        finalYaml: serializeDocument(document),
        threadId: null,
        repaired: false,
        diagnostics: [],
        resolvedSchemaIds: [],
        turnCount: 1,
        tokenUsage: emptyTokenUsageTotals(),
      };
    },
  );
  await buildDiagram(options, { logger: quietLogger(), aiDiagramService: { generateDiagram } });
  expect(generateDiagram).toHaveBeenCalledTimes(1);
});

describe('pipeline repair-loop characterization', () => {
  const malformed = (operation: string) =>
    new ModelOutputParseError({
      operation,
      expectedFormat: 'yaml',
      rawResponse: 'malformed candidate',
      threadId: `thread-${operation}`,
      tokenUsage: emptyTokenUsageTotals(),
      cause: new SyntaxError(`invalid ${operation}`),
    });

  it('retries a malformed area plan once and accepts the next structured plan', async () => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
    const out = path.join(await createTempDir('characterize-area-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();
    dependencies.areaPlanner.planAreas.mockRejectedValueOnce(malformed('area-plan'));
    const result = await buildDiagram(
      {
        repo,
        out,
        schemaSource: fixturePath('schema-repo'),
      },
      { ...dependencies, logger: quietLogger() },
    );
    expect(dependencies.areaPlanner.planAreas).toHaveBeenCalledTimes(2);
    expect(dependencies.level0BackboneBuilder.buildLevel0Backbone).toHaveBeenCalledTimes(1);
    expect((await readJobMetadata(result.workspace.jobRoot))?.advanced?.lastCompletedStage).toBe(
      'bundle-compile',
    );
    expect((await readJobMetadata(result.workspace.jobRoot))?.status).toBe('succeeded');
  });

  it.each([
    'backbone',
    'backbone-review',
  ] as const)('gives up %s after its exact repair limit for malformed output', async (stage) => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
    const out = path.join(await createTempDir('characterize-backbone-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();
    const initial =
      stage === 'backbone'
        ? dependencies.level0BackboneBuilder.buildLevel0Backbone
        : dependencies.level0BackboneReviewer.reviewLevel0Backbone;
    const repair =
      stage === 'backbone'
        ? dependencies.level0BackboneRepairer.repairLevel0Backbone
        : dependencies.level0BackboneReviewerRepairer.repairLevel0BackboneReview;
    initial.mockRejectedValue(malformed(stage));
    repair.mockRejectedValue(malformed(`${stage}-repair`));
    await expect(
      buildDiagram(
        { repo, out, schemaSource: fixturePath('schema-repo') },
        { ...dependencies, logger: quietLogger() },
      ),
    ).rejects.toMatchObject({
      message:
        stage === 'backbone'
          ? 'Advanced level-0 backbone did not validate after 3 level-0 repair passes'
          : 'Advanced level-0 backbone review did not validate after 1 review repair pass',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code:
            stage === 'backbone'
              ? 'diagram.document.invalid_backbone_output'
              : 'diagram.document.invalid_backbone_review_output',
        }),
      ]),
    });
    expect(initial).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledTimes(stage === 'backbone' ? 3 : 1);
    expect(dependencies.nodeRefiner.refineNode).not.toHaveBeenCalled();
    expect((await readJobMetadata(`${out}.job`))?.status).toBe('failed');
    await expect(fs.stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    'malformed',
    'runtime-error',
  ] as const)('preserves graph collation %s fallback and failure behavior', async (failure) => {
    const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
    const out = path.join(await createTempDir('characterize-graph-'), 'diagram.yaml');
    const dependencies = createAdvancedDependencies();
    dependencies.graphCollator.collateGraph.mockRejectedValue(
      failure === 'malformed' ? malformed('graph') : new Error('graph runtime failed'),
    );
    let reviewHandoff = '';
    const review = dependencies.finalGraphReviewer.reviewFinalGraph.getMockImplementation()!;
    dependencies.finalGraphReviewer.reviewFinalGraph.mockImplementation(async (input) => {
      reviewHandoff = await fs.readFile(input.handoffArtifactPath!, 'utf8');
      expect(parseDocument(input.currentFinalGraphYaml)).toEqual(input.assembledDoc);
      return review(input);
    });
    const build = buildDiagram(
      { repo, out, schemaSource: fixturePath('schema-repo') },
      { ...dependencies, logger: quietLogger() },
    );
    if (failure === 'malformed') {
      const result = await build;
      expect(result.outputPath).toBe(out);
      expect(reviewHandoff).toContain('diagram.document.invalid_graph_output');
      expect(dependencies.finalGraphReviewer.reviewFinalGraph).toHaveBeenCalledTimes(1);
      expect(
        parseDocument(await fs.readFile(out, 'utf8')).entities.some(
          (entity) => entity.id === 'app',
        ),
      ).toBe(true);
      expect((await readJobMetadata(result.workspace.jobRoot))?.status).toBe('succeeded');
    } else {
      await expect(build).rejects.toThrow('graph runtime failed');
      expect(dependencies.finalGraphReviewer.reviewFinalGraph).not.toHaveBeenCalled();
      expect((await readJobMetadata(`${out}.job`))?.status).toBe('failed');
      await expect(fs.stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(dependencies.graphCollator.collateGraph).toHaveBeenCalledTimes(1);
  });
});

it.each([
  'basic',
  'advanced',
] as const)('handles legacy %s job metadata safely', async (legacyMode) => {
  const repo = await createGitRepo({ 'src/index.ts': 'export const app = true;' });
  const out = path.join(await createTempDir('legacy-mode-'), 'diagram.yaml');
  const dependencies = createAdvancedDependencies();
  const options = {
    repo,
    out,
    schemaSource: fixturePath('schema-repo'),
    stopAfter: 'level0-backbone' as const,
  };
  await buildDiagram(options, { ...dependencies, logger: quietLogger() });
  const metadataPath = path.join(out + '.job', 'out', 'job-metadata.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  await fs.writeFile(metadataPath, JSON.stringify({ ...metadata, mode: legacyMode }));
  await buildDiagram(options, { ...dependencies, logger: quietLogger() });
  expect(dependencies.areaPlanner.planAreas).toHaveBeenCalledTimes(legacyMode === 'basic' ? 2 : 1);
  expect(JSON.parse(await fs.readFile(metadataPath, 'utf8'))).not.toHaveProperty('mode');
});
