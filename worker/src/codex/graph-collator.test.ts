import { describe, expect, it } from 'vitest';
import { testGroupSemantics } from '../advanced/refinement-test-context';
import type { SchemaFlowCatalog } from '../advanced/schema-flow-catalog';
import { buildSchemaActivation } from '../semantic';
import { emptyTokenUsageTotals } from '../token-usage';
import { buildGraphCollationPrompt } from './graph-collator';

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

describe('CodexGraphCollator prompt', () => {
  it('references canonical artifacts instead of inlining the assembled graph or edge contracts', () => {
    const prompt = buildGraphCollationPrompt({
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
            queueDecision: 'expand',
          },
        },
        refinementsByNodeId: {},
        edgeContracts: [
          {
            id: 'edge-contract-sentinel',
            sourceId: 'app',
            targetId: 'storage',
            evidence: [],
          },
        ],
        activeEdgeProposals: [],
        reviewedDepths: [],
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
        entities: [
          {
            id: 'app',
            type: 'core/web-app.types.application',
            name: 'App',
            description: 'INLINE_SENTINEL_CHILDREN_SHOULD_STAY_IN_ARTIFACTS',
          },
          {
            id: 'app/runtime',
            parent: 'app',
            type: 'core/web-app.types.service',
            name: 'Runtime',
          },
        ],
        relations: [
          {
            id: 'app-calls-runtime',
            type: 'core/software.relations.calls',
            from: 'app',
            to: 'app/runtime',
          },
        ],
      },
      level0Backbone: {
        level0Doc: {
          version: '0.1.0',
          schemaRefs: [],
          entities: [],
          relations: [],
        },
        level0EdgeIds: ['level0-edge'],
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
        kind: 'git',
        repo: 'https://github.com/example/repo',
        revision: 'abc123',
        role: 'primary',
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    expect(prompt).toContain('Canonical artifacts to inspect before collating:');
    expect(prompt).toContain('out/analysis/assembled-refined-document.yaml');
    expect(prompt).toContain('out/analysis/node-refinement-state.json');
    expect(prompt).toContain('out/analysis/level0-backbone.yaml');
    expect(prompt).toContain('out/analysis/final-graph.yaml');
    expect(prompt).toContain('Active schema flow catalogue:');
    expect(prompt).toContain('"edgeContractCount": 1');
    expect(prompt).toContain('"childRelationCount": 1');
    expect(prompt).toContain('Do not collapse descendant relations back to level-0 relations.');
    expect(prompt).toContain(
      'Never prefix provenance paths with target-repo/ or other workspace directories.',
    );
    expect(prompt).not.toContain('INLINE_SENTINEL_CHILDREN_SHOULD_STAY_IN_ARTIFACTS');
    expect(prompt).not.toContain('edge-contract-sentinel');
  });
});
