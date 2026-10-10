import { describe, expect, it } from 'vitest';
import type { GraphifyHints } from '../advanced/graphify-hints';
import { testGroupSemantics } from '../advanced/refinement-test-context';
import type { SchemaFlowCatalog } from '../advanced/schema-flow-catalog';
import { buildSchemaActivation } from '../semantic';
import { emptyTokenUsageTotals } from '../token-usage';
import {
  buildFinalGraphReviewPrompt,
  buildFinalGraphReviewRepairPrompt,
} from './final-graph-reviewer';
import { GRAPHIFY_HINTS_GUARDRAIL } from './graphify-hints-prompt';

function testSchemaFlowCatalog(): SchemaFlowCatalog {
  return {
    activeSchemaRefs: [buildSchemaActivation('core/web-app@0.3')],
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

describe('CodexFinalGraphReviewer prompt', () => {
  it('includes the candidate final graph, review summary, and canonical artifacts', () => {
    const input = {
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
      graphifyHints: testGraphifyHints(),
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [buildSchemaActivation('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      nodeRefinementState: {
        rootNodeIds: ['app'],
        queue: [],
        tasksByNodeId: {},
        nodesById: {
          app: {
            id: 'app',
            localId: 'app',
            name: 'App',
            typeId: 'core/web-app.types.application',
            scope: ['src/app.ts'],
            evidence: [],
            queueDecision: 'expand' as const,
          },
        },
        refinementsByNodeId: {},
        edgeContracts: [],
        activeEdgeProposals: [],
        reviewedDepths: [1],
        budgets: {
          maxDepth: 2,
          maxTurns: 10,
          maxWorkItems: 10,
          turnsUsed: 1,
          workItemsCreated: 1,
          tokenUsage: emptyTokenUsageTotals(),
        },
      },
      assembledDoc: {
        version: '0.1.0',
        schemaRefs: [{ schema: 'core/web-app@0.3', layer: 0 }],
        entities: [{ id: 'app', type: 'core/web-app.types.application', name: 'App' }],
        relations: [],
      },
      level0Backbone: {
        level0Doc: {
          version: '0.1.0',
          schemaRefs: [],
          entities: [],
          relations: [],
        },
        level0EdgeIds: [],
        activeFrontier: [],
        terminatedNodes: [],
        refinementQueue: [],
        edgeBindings: [],
        visibleResponsibilityIds: ['app'],
      },
      activeSchemaRefs: [buildSchemaActivation('core/web-app@0.3')],
      semantics: testGroupSemantics,
      schemaFlowCatalog: testSchemaFlowCatalog(),
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      primaryDocumentInput: {
        id: 'primary',
        kind: 'git' as const,
        repo: 'https://github.com/example/repo',
        revision: 'abc123',
        role: 'primary' as const,
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      currentFinalGraphYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: App
    description: INLINE_FINAL_GRAPH_SENTINEL
relations: []
`,
      finalReviewSummary: {
        assembledDocument: {
          entityCount: 2,
          relationCount: 1,
        },
        candidateFinalGraph: {
          entityCount: 1,
          relationCount: 0,
        },
        removedEntityIds: ['app/runtime'],
        reparentedEntityIds: [],
        removedRelationIds: ['app-calls-runtime'],
        rewrittenRelationIds: [],
        candidateMissingRelationEndpointIds: [],
      },
    };

    const prompt = buildFinalGraphReviewPrompt(input);

    expect(prompt).toContain('Current candidate final graph YAML:');
    expect(prompt).toContain('INLINE_FINAL_GRAPH_SENTINEL');
    expect(prompt).toContain('Assembled-vs-collated regression summary JSON:');
    expect(prompt).toContain('"removedEntityIds": [');
    expect(prompt).toContain('out/analysis/assembled-refined-document.yaml');
    expect(prompt).toContain('out/analysis/level0-backbone.yaml');
    expect(prompt).toContain('out/analysis/schema-set.json');
    expect(prompt).toContain('out/analysis/schema-flow-catalog.json');
    expect(prompt).toContain('Active schema flow catalogue:');
    expect(prompt).toContain('Graphify deterministic code-structure hints:');
    expect(prompt).toContain(GRAPHIFY_HINTS_GUARDRAIL);
    expect(prompt).toContain('GRAPHIFY_SENTINEL: App calls Api');
    expect(prompt).toContain('out/analysis/final-graph.yaml');
    expect(prompt).toContain('out/analysis/final-review.summary.json');
    expect(prompt).toContain('Never prefix paths with target-repo/ or workspace directories.');
    expect(prompt).toContain('Do not collapse descendant relations back to level-0 relations.');

    const repairPrompt = buildFinalGraphReviewRepairPrompt({
      ...input,
      previousReviewYaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: App
    description: REVIEWED_FINAL_GRAPH_SENTINEL
relations: []
`,
      diagnostics: [],
      attempt: 1,
    });

    expect(repairPrompt).not.toContain('Current candidate final graph YAML:');
    expect(repairPrompt).not.toContain('INLINE_FINAL_GRAPH_SENTINEL');
    expect(repairPrompt).not.toContain('out/analysis/final-graph.yaml');
    expect(repairPrompt).toContain('Current reviewed YAML to repair:');
    expect(repairPrompt).toContain('REVIEWED_FINAL_GRAPH_SENTINEL');
  });
});
