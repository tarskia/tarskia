import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ModelOutputParseError } from '../codex/model-output-error';
import { runCodexPrompt } from '../codex/run-codex-prompt';
import { TurnPolicy, withTurnPolicy } from '../codex/turn-policy';
import { resolveDefaultSchemaSource } from '../default-assets';
import { schemaRepoFixture } from '../schema-repo-fixture';
import { buildSchemaActivation, compileSchemaSemantics, validateDiagramYaml } from '../semantic';
import { loadSchemaRegistry } from '../semantic/schema-loader';
import { emptyTokenUsageTotals } from '../token-usage';
import { loadNodeRefinementCheckpoint } from './checkpoints';
import type { CachedNodeRefinementEntry } from './node-refinement-cache';
import {
  applyNodeRefinementResult,
  assembleRefinedDocument,
  findDisconnectedExpandableGroupNodes,
  normalizeEdgeRefinementOrientation,
  pruneInvalidEdgeRefinements,
  pruneInvalidLocalRelations,
  runNodeRefinement,
  shouldRepairNodeRefinementDiagnostics,
  validateNodeRefinementSemantics,
} from './node-refinement-engine';
import { testGroupSemantics } from './refinement-test-context';
import { buildSchemaFlowCatalog } from './schema-flow-catalog';
import type { NodeRefinementResult, NodeRefinementState, NodeRefinementTask } from './types';

function evidence(path: string, reason = 'Evidence') {
  return [{ path, reason }];
}

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

function createBaseState(): NodeRefinementState {
  return {
    rootNodeIds: ['app', 'backend'],
    queue: [],
    tasksByNodeId: {},
    nodesById: {
      app: {
        id: 'app',
        localId: 'app',
        name: 'App',
        typeId: 'core/web-app.types.group',
        scope: ['src/app.ts'],
        evidence: evidence('src/app.ts', 'App root'),
        queueDecision: 'leaf',
      },
      backend: {
        id: 'backend',
        localId: 'backend',
        name: 'Backend',
        typeId: 'core/web-app.types.external-api',
        scope: ['src/backend.ts'],
        evidence: evidence('src/backend.ts', 'Backend root'),
        queueDecision: 'leaf',
      },
    },
    refinementsByNodeId: {},
    edgeContracts: [
      {
        id: 'app-calls-backend',
        relationTypeId: 'core/software.relations.calls',
        sourceId: 'app',
        sourceTypeId: 'core/web-app.types.group',
        targetId: 'backend',
        targetTypeId: 'core/web-app.types.external-api',
        evidence: evidence('src/app.ts', 'App calls backend'),
      },
    ],
    activeEdgeProposals: [],
    reviewedDepths: [],
    budgets: {
      maxDepth: 8,
      maxTurns: 150,
      maxWorkItems: 256,
      turnsUsed: 0,
      workItemsCreated: 0,
      tokenUsage: emptyTokenUsageTotals(),
    },
  };
}

function createOutboundTask(): NodeRefinementTask {
  return {
    nodeId: 'app',
    nodeTypeId: 'core/web-app.types.group',
    nodeName: 'App',
    scope: ['src/app.ts'],
    evidence: evidence('src/app.ts', 'App root'),
    depth: 0,
    inboundEdges: [],
    outboundEdges: [
      {
        id: 'app-calls-backend',
        relationTypeId: 'core/software.relations.calls',
        sourceId: 'app',
        sourceTypeId: 'core/web-app.types.group',
        targetId: 'backend',
        targetTypeId: 'core/web-app.types.external-api',
        evidence: evidence('src/app.ts', 'App calls backend'),
        side: 'egress',
      },
    ],
  };
}

function quietLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createRepoCensus() {
  return {
    repoUrl: 'https://github.com/example/repo',
    requestedRef: 'main',
    repoRevision: 'abc123',
    repoRoot: '/tmp/job/target-repo',
    generatedAt: '2026-01-01T00:00:00.000Z',
    summary: {
      totalFiles: 4,
      totalDirectories: 2,
      totalLines: 100,
      languages: { go: 100 },
      topLevelPaths: [],
    },
    directories: [],
    manifests: [],
    signals: [],
    files: [],
  };
}

function createStorageRootRefinementResult(
  overrides: Partial<NodeRefinementResult> = {},
): NodeRefinementResult {
  return {
    children: [
      {
        localId: 'storage-runtime',
        name: 'Storage Runtime',
        typeId: 'core/code.types.module',
        scope: ['pkg/services/store/service.go'],
        evidence: evidence('pkg/services/store/service.go', 'Storage runtime implementation'),
        queueDecision: 'expand',
      },
      {
        localId: 'sql-storage',
        name: 'SQL Storage',
        typeId: 'core/web-app.types.relational-db',
        scope: ['pkg/services/sqlstore'],
        evidence: evidence('pkg/services/sqlstore/db.go', 'SQL storage backend'),
        queueDecision: 'leaf',
      },
      {
        localId: 'disk-storage',
        name: 'Disk Storage',
        typeId: 'core/web-app.types.object-store',
        scope: ['pkg/services/store/disk'],
        evidence: evidence('pkg/services/store/disk/files.go', 'Disk storage backend'),
        queueDecision: 'leaf',
      },
    ],
    relations: [
      {
        localId: 'storage-runtime-read-writes-sql-storage',
        typeId: 'core/software.relations.read-writes',
        fromLocalId: 'storage-runtime',
        toLocalId: 'sql-storage',
        evidence: evidence('pkg/services/store/service.go', 'Runtime dispatches to SQL storage'),
      },
      {
        localId: 'storage-runtime-read-writes-disk-storage',
        typeId: 'core/software.relations.read-writes',
        fromLocalId: 'storage-runtime',
        toLocalId: 'disk-storage',
        evidence: evidence('pkg/services/store/service.go', 'Runtime dispatches to disk storage'),
      },
    ],
    edgeRefinements: [],
    ...overrides,
  };
}

async function createStorageRootRefinementContext() {
  const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
  const validation = validateDiagramYaml({
    yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/code@0.1
    layer: 1
entities:
  - id: repo-sync
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: pkg/services/provisioning/repository.go
  - id: storage-root
    type: core/web-app.types.datastore
    provenance:
      locations:
        - input: primary
          path: pkg/services/store/service.go
relations:
  - id: repo-sync-read-writes-storage
    type: core/software.relations.read-writes
    from: repo-sync
    to: storage-root
    provenance:
      locations:
        - input: primary
          path: pkg/services/store/service.go
`,
    schemaRegistry,
    documentInputs: [
      {
        id: 'primary',
        kind: 'git',
        repo: 'https://github.com/example/repo',
        revision: 'abc123abc123abc123abc123abc123abc123abcd',
        role: 'primary',
      },
    ],
  });
  expect(validation.ok).toBe(true);
  const semantics = compileSchemaSemantics(validation.effectiveSchema!);
  const task: NodeRefinementTask = {
    nodeId: 'storage-root',
    nodeTypeId: 'core/web-app.types.datastore',
    nodeName: 'Storage root',
    scope: ['pkg/services/store/service.go'],
    evidence: evidence('pkg/services/store/service.go', 'Storage root'),
    depth: 0,
    inboundEdges: [
      {
        id: 'repo-sync-read-writes-storage',
        relationTypeId: 'core/software.relations.read-writes',
        sourceId: 'repo-sync',
        sourceTypeId: 'core/web-app.types.service',
        targetId: 'storage-root',
        targetTypeId: 'core/web-app.types.datastore',
        evidence: evidence('pkg/services/store/service.go', 'Repository sync storage access'),
        side: 'ingress',
      },
    ],
    outboundEdges: [],
  };

  return {
    validation,
    semantics,
    task,
    schemaContext: {
      activeSchemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
      candidateSchemaRefs: [],
      schema: validation.effectiveSchema!,
      semantics,
      schemaFlowCatalog: buildSchemaFlowCatalog({
        schema: validation.effectiveSchema!,
        semantics,
        activeSchemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
      }),
    },
  };
}

describe('applyNodeRefinementResult', () => {
  it('replaces one coarse edge with multiple refined descendant edges', () => {
    const nextState = applyNodeRefinementResult({
      state: createBaseState(),
      task: createOutboundTask(),
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.application',
            scope: ['src/runtime.ts'],
            evidence: evidence('src/runtime.ts', 'Runtime'),
            queueDecision: 'leaf',
          },
          {
            localId: 'fallback',
            name: 'Fallback runtime',
            typeId: 'core/web-app.types.application',
            scope: ['src/fallback.ts'],
            evidence: evidence('src/fallback.ts', 'Fallback runtime'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-calls-backend',
            fromChildLocalId: 'runtime',
          },
          {
            edgeId: 'app-calls-backend',
            fromChildLocalId: 'fallback',
          },
        ],
      },
    });

    const assembled = assembleRefinedDocument({
      semantics: testGroupSemantics,
      baseDoc: {
        version: '0.1.0',
        schemaRefs: [act('core/web-app@0.3')],
        entities: [],
        relations: [],
      },
      state: nextState,
    });

    expect(assembled.relations).toHaveLength(2);
    expect(assembled.relations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'app-calls-backend',
          from: 'app',
          to: 'backend',
        }),
      ]),
    );
    expect(assembled.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'app/runtime',
          to: 'backend',
        }),
        expect.objectContaining({
          from: 'app/fallback',
          to: 'backend',
        }),
      ]),
    );
    expect(nextState.refinementsByNodeId.app.edgeRefinements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeId: 'app-calls-backend',
          sourceId: 'app/runtime',
          targetId: 'backend',
        }),
        expect.objectContaining({
          edgeId: 'app-calls-backend',
          sourceId: 'app/fallback',
          targetId: 'backend',
        }),
      ]),
    );
  });

  it('assembles node and relation descriptions into the refined document', () => {
    const nextState = applyNodeRefinementResult({
      state: createBaseState(),
      task: createOutboundTask(),
      result: {
        description: 'Primary application runtime.',
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            description: 'Handles request orchestration.',
            typeId: 'core/web-app.types.application',
            scope: ['src/runtime.ts'],
            evidence: evidence('src/runtime.ts', 'Runtime'),
            queueDecision: 'leaf',
          },
        ],
        relations: [
          {
            localId: 'runtime-calls-backend',
            typeId: 'core/software.relations.calls',
            description: 'Delegates external work to the backend.',
            fromLocalId: 'runtime',
            toLocalId: 'runtime',
            evidence: evidence('src/runtime.ts', 'Runtime call path'),
          },
        ],
        edgeRefinements: [],
      },
    });

    const assembled = assembleRefinedDocument({
      semantics: testGroupSemantics,
      baseDoc: {
        version: '0.1.0',
        schemaRefs: [act('core/web-app@0.3')],
        entities: [],
        relations: [],
      },
      state: nextState,
    });

    expect(assembled.entities.find((entity) => entity.id === 'app')?.description).toBe(
      'Primary application runtime.',
    );
    expect(
      assembled.entities
        .find((entity) => entity.id === 'app')
        ?.children?.find((entity) => entity.id === 'app/runtime')?.description,
    ).toBe('Handles request orchestration.');
    expect(
      assembled.relations.find((relation) => relation.id === 'calls--runtime--to--runtime')
        ?.description,
    ).toBe('Delegates external work to the backend.');
  });

  it('preserves child props into the assembled refined document', () => {
    const nextState = applyNodeRefinementResult({
      state: createBaseState(),
      task: createOutboundTask(),
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/code.types.module',
            props: {
              language: 'typescript',
            },
            scope: ['src/runtime.ts'],
            evidence: evidence('src/runtime.ts', 'Runtime'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [],
      },
    });

    const assembled = assembleRefinedDocument({
      semantics: testGroupSemantics,
      baseDoc: {
        version: '0.1.0',
        schemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
        entities: [],
        relations: [],
      },
      state: nextState,
    });

    expect(
      assembled.entities
        .find((entity) => entity.id === 'app')
        ?.children?.find((entity) => entity.id === 'app/runtime')?.props,
    ).toEqual({
      language: 'typescript',
    });
  });

  it('allows later refinement of the opposite endpoint of a refined edge', () => {
    const afterSourceRefinement = applyNodeRefinementResult({
      state: createBaseState(),
      task: createOutboundTask(),
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.application',
            scope: ['src/runtime.ts'],
            evidence: evidence('src/runtime.ts', 'Runtime'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-calls-backend',
            fromChildLocalId: 'runtime',
          },
        ],
      },
    });

    const backendTask: NodeRefinementTask = {
      nodeId: 'backend',
      nodeTypeId: 'core/web-app.types.external-api',
      nodeName: 'Backend',
      scope: ['src/backend.ts'],
      evidence: evidence('src/backend.ts', 'Backend root'),
      depth: 0,
      inboundEdges: [
        {
          id: 'app-calls-backend',
          relationTypeId: 'core/software.relations.calls',
          sourceId: 'app/runtime',
          sourceTypeId: 'core/web-app.types.application',
          targetId: 'backend',
          targetTypeId: 'core/web-app.types.external-api',
          evidence: evidence('src/app.ts', 'App runtime calls backend'),
          side: 'ingress',
        },
      ],
      outboundEdges: [],
    };

    const finalState = applyNodeRefinementResult({
      state: afterSourceRefinement,
      task: backendTask,
      result: {
        children: [
          {
            localId: 'api',
            name: 'Backend API',
            typeId: 'core/web-app.types.api',
            scope: ['src/backend.ts'],
            evidence: evidence('src/backend.ts', 'Backend API'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-calls-backend',
            toChildLocalId: 'api',
          },
        ],
      },
    });

    const assembled = assembleRefinedDocument({
      semantics: testGroupSemantics,
      baseDoc: {
        version: '0.1.0',
        schemaRefs: [act('core/web-app@0.3')],
        entities: [],
        relations: [],
      },
      state: finalState,
    });

    expect(assembled.relations).toEqual([
      expect.objectContaining({
        id: 'app-calls-backend',
        from: 'app/runtime',
        to: 'backend/api',
      }),
    ]);
  });

  it('allows inherited edge refinements to override the relation type', () => {
    const nextState = applyNodeRefinementResult({
      state: createBaseState(),
      task: createOutboundTask(),
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.application',
            scope: ['src/runtime.ts'],
            evidence: evidence('src/runtime.ts', 'Runtime'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-calls-backend',
            relationTypeId: 'core/software.relations.reads',
            fromChildLocalId: 'runtime',
          },
        ],
      },
    });

    const assembled = assembleRefinedDocument({
      semantics: testGroupSemantics,
      baseDoc: {
        version: '0.1.0',
        schemaRefs: [act('core/web-app@0.3')],
        entities: [],
        relations: [],
      },
      state: nextState,
    });

    expect(assembled.relations).toEqual([
      expect.objectContaining({
        id: 'app-calls-backend',
        type: 'core/software.relations.reads',
        from: 'app/runtime',
        to: 'backend',
      }),
    ]);
  });

  it('normalizes one-sided edge refinements onto the endpoint owned by the task', () => {
    const outboundTask = createOutboundTask();
    expect(
      normalizeEdgeRefinementOrientation({
        semantics: testGroupSemantics,
        task: outboundTask,
        result: {
          children: [],
          relations: [],
          edgeRefinements: [
            {
              edgeId: 'app-calls-backend',
              toChildLocalId: 'runtime',
            },
          ],
        },
      }).edgeRefinements,
    ).toEqual([
      {
        edgeId: 'app-calls-backend',
        fromChildLocalId: 'runtime',
      },
    ]);

    const inboundTask: NodeRefinementTask = {
      nodeId: 'backend',
      nodeTypeId: 'core/web-app.types.external-api',
      nodeName: 'Backend',
      scope: ['src/backend.ts'],
      evidence: evidence('src/backend.ts', 'Backend root'),
      depth: 0,
      inboundEdges: [
        {
          id: 'app-calls-backend',
          relationTypeId: 'core/software.relations.calls',
          sourceId: 'app',
          sourceTypeId: 'core/web-app.types.group',
          targetId: 'backend',
          targetTypeId: 'core/web-app.types.external-api',
          evidence: evidence('src/app.ts', 'App calls backend'),
          side: 'ingress',
        },
      ],
      outboundEdges: [],
    };

    expect(
      normalizeEdgeRefinementOrientation({
        semantics: testGroupSemantics,
        task: inboundTask,
        result: {
          children: [],
          relations: [],
          edgeRefinements: [
            {
              edgeId: 'app-calls-backend',
              fromChildLocalId: 'api',
            },
          ],
        },
      }).edgeRefinements,
    ).toEqual([
      {
        edgeId: 'app-calls-backend',
        toChildLocalId: 'api',
      },
    ]);
  });

  it('drops unowned endpoints from one-sided inherited edge refinements', () => {
    const outboundTask = createOutboundTask();
    expect(
      normalizeEdgeRefinementOrientation({
        semantics: testGroupSemantics,
        task: outboundTask,
        result: {
          children: [
            {
              localId: 'runtime',
              name: 'Runtime',
              typeId: 'core/code.types.module',
              scope: ['src/app.ts'],
              evidence: evidence('src/app.ts', 'Runtime'),
              queueDecision: 'leaf',
            },
            {
              localId: 'local-backend',
              name: 'Local Backend',
              typeId: 'core/web-app.types.external-api',
              scope: ['src/backend.ts'],
              evidence: evidence('src/backend.ts', 'Local backend'),
              queueDecision: 'leaf',
            },
          ],
          relations: [],
          edgeRefinements: [
            {
              edgeId: 'app-calls-backend',
              fromChildLocalId: 'runtime',
              toChildLocalId: 'local-backend',
            },
          ],
        },
      }).edgeRefinements,
    ).toEqual([
      {
        edgeId: 'app-calls-backend',
        fromChildLocalId: 'runtime',
      },
    ]);

    const inboundTask: NodeRefinementTask = {
      nodeId: 'backend',
      nodeTypeId: 'core/web-app.types.external-api',
      nodeName: 'Backend',
      scope: ['src/backend.ts'],
      evidence: evidence('src/backend.ts', 'Backend root'),
      depth: 0,
      inboundEdges: [
        {
          id: 'app-calls-backend',
          relationTypeId: 'core/software.relations.calls',
          sourceId: 'app',
          sourceTypeId: 'core/web-app.types.group',
          targetId: 'backend',
          targetTypeId: 'core/web-app.types.external-api',
          evidence: evidence('src/app.ts', 'App calls backend'),
          side: 'ingress',
        },
      ],
      outboundEdges: [],
    };

    expect(
      normalizeEdgeRefinementOrientation({
        semantics: testGroupSemantics,
        task: inboundTask,
        result: {
          children: [
            {
              localId: 'remote-app',
              name: 'Remote App',
              typeId: 'core/web-app.types.group',
              scope: ['src/app.ts'],
              evidence: evidence('src/app.ts', 'Remote app'),
              queueDecision: 'leaf',
            },
            {
              localId: 'api',
              name: 'API',
              typeId: 'core/web-app.types.external-api',
              scope: ['src/backend.ts'],
              evidence: evidence('src/backend.ts', 'API'),
              queueDecision: 'leaf',
            },
          ],
          relations: [],
          edgeRefinements: [
            {
              edgeId: 'app-calls-backend',
              fromChildLocalId: 'remote-app',
              toChildLocalId: 'api',
            },
          ],
        },
      }).edgeRefinements,
    ).toEqual([
      {
        edgeId: 'app-calls-backend',
        toChildLocalId: 'api',
      },
    ]);
  });

  it('infers inherited edge refinements for disconnected expandable children from evidence overlap', () => {
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task: {
        ...createOutboundTask(),
        outboundEdges: [
          {
            id: 'app-calls-backend',
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'app',
            sourceTypeId: 'core/web-app.types.group',
            targetId: 'backend',
            targetTypeId: 'core/web-app.types.external-api',
            evidence: [
              ...evidence('src/providers/messaging.ts', 'Messaging provider call'),
              ...evidence('enterprise/providers/voice.ts', 'Voice provider call'),
            ],
            side: 'egress',
          },
        ],
      },
      result: {
        children: [
          {
            localId: 'messaging-adapters',
            name: 'Messaging adapters',
            typeId: 'core/web-app.types.group',
            scope: ['src/providers/messaging.ts'],
            evidence: evidence('src/providers/messaging.ts', 'Messaging adapters'),
            queueDecision: 'expand',
            groupMode: 'typed',
            groupTypeId: 'core/code.types.module',
          },
          {
            localId: 'voice-adapters',
            name: 'Voice adapters',
            typeId: 'core/web-app.types.group',
            scope: ['enterprise/providers/voice.ts'],
            evidence: evidence('enterprise/providers/voice.ts', 'Voice adapters'),
            queueDecision: 'expand',
            groupMode: 'typed',
            groupTypeId: 'core/code.types.module',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-calls-backend',
            fromChildLocalId: 'messaging-adapters',
          },
        ],
      },
    });

    expect(normalized.edgeRefinements).toEqual([
      {
        edgeId: 'app-calls-backend',
        fromChildLocalId: 'messaging-adapters',
      },
      {
        edgeId: 'app-calls-backend',
        fromChildLocalId: 'voice-adapters',
      },
    ]);
  });

  it('synthesizes concrete typed children for an empty typed group refinement', () => {
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task: {
        nodeId: 'app/voice-adapters/twilio-voice-adapter',
        nodeName: 'Twilio voice adapter',
        groupMode: 'typed',
        groupTypeId: 'core/code.types.module',
        scope: [
          'app/services/twilio/send_on_twilio_service.rb',
          'enterprise/app/services/voice/provider/twilio/conference_service.rb',
        ],
        evidence: [
          ...evidence('app/services/twilio/send_on_twilio_service.rb', 'Twilio send service'),
          ...evidence(
            'enterprise/app/services/voice/provider/twilio/conference_service.rb',
            'Twilio conference service',
          ),
        ],
        inboundEdges: [],
        outboundEdges: [
          {
            id: 'voice-calls-provider',
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'app/voice-adapters/twilio-voice-adapter',
            sourceTypeId: 'core/web-app.types.group',
            targetId: 'twilio',
            targetTypeId: 'core/web-app.types.external-api',
            evidence: [
              ...evidence('app/services/twilio/send_on_twilio_service.rb', 'Twilio send call'),
              ...evidence(
                'enterprise/app/services/voice/provider/twilio/conference_service.rb',
                'Twilio conference call',
              ),
            ],
            side: 'egress',
          },
        ],
      },
      result: {
        children: [],
        relations: [],
        edgeRefinements: [],
        edgeProposals: [],
      },
    });

    expect(normalized.children).toEqual([
      expect.objectContaining({
        localId: 'send-on-twilio-service',
        typeId: 'core/code.types.module',
        queueDecision: 'leaf',
      }),
      expect.objectContaining({
        localId: 'conference-service',
        typeId: 'core/code.types.module',
        queueDecision: 'leaf',
      }),
    ]);
    expect(normalized.edgeRefinements).toEqual([
      {
        edgeId: 'voice-calls-provider',
        fromChildLocalId: 'send-on-twilio-service',
        relationTypeId: undefined,
        toChildLocalId: undefined,
      },
      {
        edgeId: 'voice-calls-provider',
        fromChildLocalId: 'conference-service',
        relationTypeId: undefined,
        toChildLocalId: undefined,
      },
    ]);
  });

  it('collapses single same-typed group wrappers into concrete typed children', () => {
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task: {
        nodeId: 'app/voice-adapters',
        nodeName: 'Voice adapters',
        groupMode: 'typed',
        groupTypeId: 'core/code.types.module',
        scope: [
          'app/services/twilio/send_on_twilio_service.rb',
          'enterprise/app/services/voice/provider/twilio/conference_service.rb',
        ],
        evidence: evidence('app/services/twilio/send_on_twilio_service.rb', 'Voice adapter'),
        inboundEdges: [],
        outboundEdges: [
          {
            id: 'voice-calls-provider',
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'app/voice-adapters',
            sourceTypeId: 'core/web-app.types.group',
            targetId: 'twilio',
            targetTypeId: 'core/web-app.types.external-api',
            evidence: evidence('app/services/twilio/send_on_twilio_service.rb', 'Twilio call'),
            side: 'egress',
          },
        ],
      },
      result: {
        children: [
          {
            localId: 'twilio-voice-adapter',
            name: 'Twilio voice adapter',
            typeId: 'core/web-app.types.group',
            scope: [
              'app/services/twilio/send_on_twilio_service.rb',
              'enterprise/app/services/voice/provider/twilio/conference_service.rb',
            ],
            evidence: [
              ...evidence('app/services/twilio/send_on_twilio_service.rb', 'Twilio send service'),
              ...evidence(
                'enterprise/app/services/voice/provider/twilio/conference_service.rb',
                'Twilio conference service',
              ),
            ],
            queueDecision: 'expand',
            groupMode: 'typed',
            groupTypeId: 'core/code.types.module',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'voice-calls-provider',
            fromChildLocalId: 'twilio-voice-adapter',
          },
        ],
        edgeProposals: [],
      },
    });

    expect(normalized.children.map((child) => child.localId)).toEqual([
      'send-on-twilio-service',
      'conference-service',
    ]);
    expect(normalized.edgeRefinements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeId: 'voice-calls-provider',
          fromChildLocalId: 'send-on-twilio-service',
        }),
        expect.objectContaining({
          edgeId: 'voice-calls-provider',
          fromChildLocalId: 'conference-service',
        }),
      ]),
    );
  });

  it('converts cross-boundary child relations that duplicate inherited edges', () => {
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task: createOutboundTask(),
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.application',
            scope: ['src/runtime.ts'],
            evidence: evidence('src/runtime.ts', 'Runtime'),
            queueDecision: 'leaf',
          },
        ],
        relations: [
          {
            localId: 'runtime-calls-backend',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'runtime',
            toLocalId: 'backend',
            evidence: evidence('src/runtime.ts', 'Runtime calls backend'),
          },
        ],
        edgeRefinements: [
          {
            edgeId: 'app-calls-backend',
            fromChildLocalId: 'runtime',
          },
        ],
      },
    });

    expect(normalized.relations).toEqual([]);
    expect(normalized.edgeRefinements).toEqual([
      {
        edgeId: 'app-calls-backend',
        fromChildLocalId: 'runtime',
      },
    ]);
  });

  it('normalizes absolute ids for direct child relation endpoints only', () => {
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task: createOutboundTask(),
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/code.types.module',
            scope: ['src/runtime.ts'],
            evidence: evidence('src/runtime.ts', 'Runtime'),
            queueDecision: 'leaf',
          },
          {
            localId: 'helper',
            name: 'Helper',
            typeId: 'core/code.types.module',
            scope: ['src/helper.ts'],
            evidence: evidence('src/helper.ts', 'Helper'),
            queueDecision: 'leaf',
          },
        ],
        relations: [
          {
            localId: 'runtime-calls-helper',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'app/runtime',
            toLocalId: 'helper',
            evidence: evidence('src/runtime.ts', 'Runtime calls helper'),
          },
          {
            localId: 'runtime-calls-missing',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'runtime',
            toLocalId: 'app/runtime/deeper',
            evidence: evidence('src/runtime.ts', 'Runtime calls missing'),
          },
        ],
        edgeRefinements: [],
      },
    });

    expect(
      normalized.relations.map((relation) => [relation.fromLocalId, relation.toLocalId]),
    ).toEqual([
      ['runtime', 'helper'],
      ['runtime', 'app/runtime/deeper'],
    ]);
  });

  it('does not guess unique namespaced inherited edge id suffixes', () => {
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task: {
        nodeId: 'sidekiq-async-plane/worker-process-group',
        inboundEdges: [
          {
            id: 'sidekiq-async-plane--worker-process-group--redis-backs-worker-process',
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'sidekiq-async-plane/redis-config-module',
            targetId: 'sidekiq-async-plane/worker-process-group',
            evidence: evidence('lib/redis/config.rb', 'Redis backing'),
            side: 'ingress',
          },
        ],
        outboundEdges: [
          {
            id: 'sidekiq-async-plane--worker-process-group--worker-calls-integrations',
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'sidekiq-async-plane/worker-process-group',
            targetId: 'integrations',
            evidence: evidence('app/jobs/application_job.rb', 'Worker calls integrations'),
            side: 'egress',
          },
        ],
      },
      result: {
        children: [
          {
            localId: 'worker-bootstrap',
            name: 'Worker bootstrap',
            typeId: 'core/code.types.module',
            scope: ['Procfile'],
            evidence: evidence('Procfile', 'Worker bootstrap'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'redis-backs-worker-process',
            fromChildLocalId: 'worker-bootstrap',
          },
        ],
        edgeProposals: [
          {
            edgeId: 'worker-calls-integrations',
            endpoint: 'from',
            childLocalId: 'worker-bootstrap',
          },
        ],
      },
    });

    expect(normalized.edgeRefinements).toEqual([
      {
        edgeId: 'redis-backs-worker-process',
        fromChildLocalId: 'worker-bootstrap',
      },
    ]);
    expect(normalized.edgeProposals).toEqual([
      {
        edgeId: 'worker-calls-integrations',
        endpoint: 'from',
        childLocalId: 'worker-bootstrap',
      },
    ]);
  });

  it('prunes duplicate inherited boundary children from typed groups', () => {
    const inboundEdgeId =
      'plugin-surface--slack-manifest-file--rel-slack-manifest-metadata-calls-slack-manifest-package';
    const outboundEdgeId =
      'plugin-surface--slack-manifest--rel-slack-manifest-file-calls-slack-plugin';
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task: {
        nodeId: 'plugin-surface/slack-manifest-file/slack-manifest-package',
        groupMode: 'typed',
        groupTypeId: 'core/code.types.module',
        inboundEdges: [
          {
            id: inboundEdgeId,
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'plugin-surface/slack-manifest-file/slack-manifest-metadata',
            targetId: 'plugin-surface/slack-manifest-file/slack-manifest-package',
            evidence: evidence('plugins/slack/plugin.json', 'Manifest metadata'),
            side: 'ingress',
          },
        ],
        outboundEdges: [
          {
            id: outboundEdgeId,
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'plugin-surface/slack-manifest-file/slack-manifest-package',
            targetId: 'plugin-surface/slack-plugin',
            evidence: evidence('plugins/slack/plugin.json', 'Slack plugin boundary'),
            side: 'egress',
          },
        ],
      },
      result: {
        children: [
          {
            localId: 'slack-manifest-package-module',
            name: 'Slack manifest package module',
            typeId: 'core/code.types.module',
            scope: ['plugins/slack/plugin.json'],
            evidence: evidence('plugins/slack/plugin.json', 'Manifest package module'),
            queueDecision: 'leaf',
          },
          {
            localId: 'slack-plugin',
            name: 'Slack plugin',
            typeId: 'core/web-app.types.application',
            scope: ['plugins/slack/plugin.json'],
            evidence: evidence('plugins/slack/plugin.json', 'Duplicate inherited plugin boundary'),
            queueDecision: 'leaf',
          },
        ],
        relations: [
          {
            localId: 'rel-package-calls-plugin',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'slack-manifest-package-module',
            toLocalId: 'slack-plugin',
            evidence: evidence('plugins/slack/plugin.json', 'Package materializes plugin'),
          },
        ],
        edgeRefinements: [
          {
            edgeId: inboundEdgeId,
            toChildLocalId: 'slack-manifest-package-module',
          },
          {
            edgeId: outboundEdgeId,
            fromChildLocalId: 'slack-manifest-package-module',
          },
        ],
      },
    });

    expect(normalized.children.map((child) => child.localId)).toEqual([
      'slack-manifest-package-module',
    ]);
    expect(normalized.relations).toEqual([]);
    expect(normalized.edgeRefinements).toEqual([
      {
        edgeId: inboundEdgeId,
        toChildLocalId: 'slack-manifest-package-module',
      },
      {
        edgeId: outboundEdgeId,
        fromChildLocalId: 'slack-manifest-package-module',
      },
    ]);
  });

  it('does not normalize ambiguous inherited edge id suffixes', () => {
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task: {
        ...createOutboundTask(),
        outboundEdges: [
          {
            id: 'one--shared-edge',
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'app',
            targetId: 'backend-one',
            evidence: evidence('src/app.ts', 'First backend'),
            side: 'egress',
          },
          {
            id: 'two--shared-edge',
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'app',
            targetId: 'backend-two',
            evidence: evidence('src/app.ts', 'Second backend'),
            side: 'egress',
          },
        ],
      },
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.application',
            scope: ['src/runtime.ts'],
            evidence: evidence('src/runtime.ts', 'Runtime'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'shared-edge',
            fromChildLocalId: 'runtime',
          },
        ],
      },
    });

    expect(normalized.edgeRefinements).toEqual([
      {
        edgeId: 'shared-edge',
        fromChildLocalId: 'runtime',
      },
    ]);
  });

  it('repairs empty and degenerate grouping refinements', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: plugin-integrations
    type: core/web-app.types.group
    props:
      mode: mixed
    provenance:
      locations:
        - input: primary
          path: plugins/index.ts
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const task: NodeRefinementTask = {
      nodeId: 'plugin-integrations',
      nodeTypeId: 'core/web-app.types.group',
      nodeName: 'Plugin integrations',
      scope: ['plugins'],
      evidence: evidence('plugins/index.ts', 'Plugin entrypoint'),
      depth: 0,
      inboundEdges: [],
      outboundEdges: [],
      groupMode: 'mixed',
    };

    const emptyGroupDiagnostics = validateNodeRefinementSemantics({
      task,
      result: {
        children: [],
        relations: [],
        edgeRefinements: [],
      },
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });
    expect(emptyGroupDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'diagram.node_refinement.empty_group' }),
      ]),
    );
    expect(shouldRepairNodeRefinementDiagnostics(emptyGroupDiagnostics)).toBe(true);

    const singleChildDiagnostics = validateNodeRefinementSemantics({
      task,
      result: {
        children: [
          {
            localId: 'notion',
            name: 'Notion',
            typeId: 'core/web-app.types.external-api',
            scope: ['plugins/notion'],
            evidence: evidence('plugins/notion/index.ts', 'Notion integration'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [],
      },
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });
    expect(singleChildDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'diagram.node_refinement.single_child_group' }),
      ]),
    );
    expect(shouldRepairNodeRefinementDiagnostics(singleChildDiagnostics)).toBe(true);
  });

  it('treats one-sided edge proposals as provisional when the opposite endpoint is unresolved', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.group
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: integration
    type: core/web-app.types.group
    provenance:
      locations:
        - input: primary
          path: src/integration.ts
relations:
  - id: app-calls-integration
    type: core/software.relations.calls
    from: app
    to: integration
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const diagnostics = validateNodeRefinementSemantics({
      task: {
        nodeId: 'app',
        nodeTypeId: 'core/web-app.types.group',
        nodeName: 'App',
        scope: ['src'],
        evidence: evidence('src/app.ts', 'App root'),
        depth: 0,
        inboundEdges: [],
        outboundEdges: [
          {
            id: 'app-calls-integration',
            relationTypeId: 'core/software.relations.calls',
            sourceId: 'app',
            sourceTypeId: 'core/web-app.types.group',
            targetId: 'integration',
            targetTypeId: 'core/web-app.types.group',
            evidence: evidence('src/app.ts', 'App calls integration'),
            side: 'egress',
          },
        ],
      },
      result: {
        children: [
          {
            localId: 'api',
            name: 'API',
            typeId: 'core/web-app.types.api',
            scope: ['src/api'],
            evidence: evidence('src/api/index.ts', 'API surface'),
            queueDecision: 'leaf',
          },
          {
            localId: 'service',
            name: 'Service',
            typeId: 'core/web-app.types.service',
            scope: ['src/service'],
            evidence: evidence('src/service/index.ts', 'Service runtime'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [],
        edgeProposals: [
          {
            edgeId: 'app-calls-integration',
            endpoint: 'from',
            childLocalId: 'api',
            relationTypeId: 'core/software.relations.calls',
          },
        ],
      },
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          code: 'diagram.node_refinement.pending_edge_proposal_relation_type',
        }),
      ]),
    );
    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'diagram.node_refinement.invalid_edge_proposal_relation_type',
        }),
      ]),
    );
    expect(shouldRepairNodeRefinementDiagnostics(diagnostics)).toBe(false);
  });

  it('repairs leaf group children that would become empty wrappers', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: src/app.ts
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const diagnostics = validateNodeRefinementSemantics({
      task: {
        nodeId: 'app',
        nodeTypeId: 'core/web-app.types.service',
        nodeName: 'App',
        scope: ['src'],
        evidence: evidence('src/app.ts', 'Service root'),
        depth: 0,
        inboundEdges: [],
        outboundEdges: [],
      },
      result: {
        children: [
          {
            localId: 'plugin-integrations',
            name: 'Plugin integrations',
            typeId: 'core/web-app.types.group',
            scope: ['plugins'],
            evidence: evidence('plugins/index.ts', 'Grouping plugin integrations'),
            queueDecision: 'leaf',
            groupMode: 'mixed',
          },
        ],
        relations: [],
        edgeRefinements: [],
      },
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.leaf_group_child',
          severity: 'error',
        }),
      ]),
    );
    expect(shouldRepairNodeRefinementDiagnostics(diagnostics)).toBe(true);
  });

  it('repairs disconnected expandable group children before queuing them', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: src/app.ts
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const diagnostics = validateNodeRefinementSemantics({
      task: {
        nodeId: 'app',
        nodeTypeId: 'core/web-app.types.service',
        nodeName: 'App',
        scope: ['src/app.ts'],
        evidence: evidence('src/app.ts', 'Service root'),
        depth: 0,
        inboundEdges: [],
        outboundEdges: [],
      },
      result: {
        children: [
          {
            localId: 'notification-jobs',
            name: 'Notification Jobs',
            typeId: 'core/web-app.types.group',
            scope: ['src/jobs/notification'],
            evidence: evidence('src/jobs/notification/slack.ts', 'Notification job family'),
            queueDecision: 'expand',
            groupMode: 'mixed',
          },
        ],
        relations: [],
        edgeRefinements: [],
      },
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.expand_child_not_flow_justified',
          severity: 'error',
        }),
      ]),
    );
    expect(shouldRepairNodeRefinementDiagnostics(diagnostics)).toBe(true);
  });

  it('finds stale checkpointed expandable groups that are disconnected from parent flow', () => {
    const state: NodeRefinementState = {
      ...createBaseState(),
      rootNodeIds: ['parent'],
      nodesById: {
        parent: {
          id: 'parent',
          localId: 'parent',
          name: 'Parent',
          typeId: 'core/web-app.types.group',
          scope: ['src'],
          evidence: evidence('src/index.ts', 'Parent'),
          queueDecision: 'expand',
        },
        'parent/disconnected': {
          id: 'parent/disconnected',
          parentId: 'parent',
          localId: 'disconnected',
          name: 'Disconnected',
          typeId: 'core/web-app.types.group',
          scope: ['src/disconnected'],
          evidence: evidence('src/disconnected/index.ts', 'Disconnected group'),
          queueDecision: 'expand',
          groupMode: 'mixed',
        },
        'parent/connected': {
          id: 'parent/connected',
          parentId: 'parent',
          localId: 'connected',
          name: 'Connected',
          typeId: 'core/web-app.types.group',
          scope: ['src/connected'],
          evidence: evidence('src/connected/index.ts', 'Connected group'),
          queueDecision: 'expand',
          groupMode: 'mixed',
        },
      },
      refinementsByNodeId: {
        parent: {
          nodeId: 'parent',
          children: [],
          relations: [],
          edgeRefinements: [
            {
              edgeId: 'parent-calls-backend',
              refinedEdgeId: 'parent-calls-backend',
              relationTypeId: 'core/software.relations.calls',
              sourceId: 'parent/connected',
              targetId: 'backend',
            },
          ],
          edgeProposals: [],
          openQuestions: [],
        },
      },
    };

    expect(findDisconnectedExpandableGroupNodes(state, testGroupSemantics)).toEqual([
      'parent/disconnected',
    ]);
  });

  it('marks explicit leaf group children expandable before accepting a refinement', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: backend
    type: core/web-app.types.external-api
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
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);
    const task: NodeRefinementTask = {
      nodeId: 'app',
      nodeTypeId: 'core/web-app.types.service',
      nodeName: 'App',
      scope: ['src/app.ts'],
      evidence: evidence('src/app.ts', 'Service root'),
      depth: 0,
      inboundEdges: [],
      outboundEdges: [
        {
          id: 'app-calls-backend',
          relationTypeId: 'core/software.relations.calls',
          sourceId: 'app',
          sourceTypeId: 'core/web-app.types.service',
          targetId: 'backend',
          targetTypeId: 'core/web-app.types.external-api',
          evidence: evidence('src/app.ts', 'App calls backend'),
          side: 'egress',
        },
      ],
    };
    const initialState: NodeRefinementState = {
      rootNodeIds: ['app', 'backend'],
      queue: [task],
      tasksByNodeId: { app: task },
      nodesById: {
        app: {
          id: 'app',
          localId: 'app',
          name: 'App',
          typeId: 'core/web-app.types.service',
          scope: ['src/app.ts'],
          evidence: evidence('src/app.ts', 'Service root'),
          queueDecision: 'expand',
        },
        backend: {
          id: 'backend',
          localId: 'backend',
          name: 'Backend',
          typeId: 'core/web-app.types.external-api',
          scope: ['src/backend.ts'],
          evidence: evidence('src/backend.ts', 'Backend dependency'),
          queueDecision: 'leaf',
        },
      },
      refinementsByNodeId: {},
      edgeContracts: [
        {
          id: 'app-calls-backend',
          relationTypeId: 'core/software.relations.calls',
          sourceId: 'app',
          sourceTypeId: 'core/web-app.types.service',
          targetId: 'backend',
          targetTypeId: 'core/web-app.types.external-api',
          evidence: evidence('src/app.ts', 'App calls backend'),
        },
      ],
      activeEdgeProposals: [],
      reviewedDepths: [],
      budgets: {
        maxDepth: 4,
        maxTurns: 10,
        maxWorkItems: 10,
        turnsUsed: 0,
        workItemsCreated: 1,
        tokenUsage: emptyTokenUsageTotals(),
      },
    };
    const refiner = {
      refineNode: vi.fn().mockResolvedValue({
        result: {
          children: [
            {
              localId: 'feature-group',
              name: 'Feature Group',
              typeId: 'core/web-app.types.group',
              scope: ['src/features'],
              evidence: evidence('src/features/index.ts', 'Feature grouping'),
              queueDecision: 'leaf' as const,
              groupMode: 'mixed' as const,
            },
          ],
          relations: [],
          edgeRefinements: [],
          edgeProposals: [
            {
              edgeId: 'app-calls-backend',
              endpoint: 'from' as const,
              childLocalId: 'feature-group',
            },
          ],
        },
        rawResponse: '{"children":[]}',
        threadId: 'thread-node',
      }),
    };
    const logger = quietLogger();

    const result = await runNodeRefinement({
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
          totalFiles: 2,
          totalDirectories: 1,
          totalLines: 10,
          languages: { typescript: 10 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger,
      initialState,
      refiner,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3')],
        }),
      }),
      stopBeforeDepth: 1,
    });

    expect(result.nodesById['app/feature-group']?.queueDecision).toBe('expand');
    expect(result.queue.map((queuedTask) => queuedTask.nodeId)).toEqual(['app/feature-group']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('leaf groups would become empty wrappers'),
    );
  });

  it('allows structural groups under code nodes', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/code@0.1
    layer: 1
entities: []
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const diagnostics = validateNodeRefinementSemantics({
      task: {
        nodeId: 'realtime-service-init',
        nodeTypeId: 'core/code.types.module',
        nodeName: 'Realtime Service Init',
        scope: ['server/services/websockets.ts'],
        evidence: evidence('server/services/websockets.ts', 'Realtime init module'),
        depth: 0,
        inboundEdges: [],
        outboundEdges: [],
      },
      result: {
        children: [
          {
            localId: 'realtime-stack',
            name: 'Realtime Stack',
            typeId: 'core/web-app.types.group',
            scope: ['server/services/websockets.ts'],
            evidence: evidence('server/services/websockets.ts', 'Illegal runtime regrouping'),
            queueDecision: 'expand',
            groupMode: 'mixed',
          },
        ],
        relations: [],
        edgeRefinements: [],
      },
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });

    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_child_type',
        }),
      ]),
    );
  });

  it('allows subgroup wrappers inside typed groups', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/code@0.1
    layer: 1
entities: []
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const diagnostics = validateNodeRefinementSemantics({
      task: {
        nodeId: 'document-route-family',
        nodeTypeId: 'core/web-app.types.group',
        nodeName: 'Document Route Family',
        groupMode: 'typed',
        groupTypeId: 'core/code.types.module',
        scope: ['server/routes/api/documents'],
        evidence: evidence('server/routes/api/documents/documents.ts', 'Document route family'),
        depth: 0,
        inboundEdges: [],
        outboundEdges: [],
      },
      result: {
        children: [
          {
            localId: 'documents-read-endpoints',
            name: 'Document Read Endpoints',
            typeId: 'core/web-app.types.group',
            scope: ['server/routes/api/documents'],
            evidence: evidence(
              'server/routes/api/documents/documents.ts',
              'Read endpoint subgroup',
            ),
            queueDecision: 'expand',
            groupMode: 'typed',
            groupTypeId: 'core/web-app.types.api-endpoint',
          },
        ],
        relations: [],
        edgeRefinements: [],
      },
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });

    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.typed_group_child_mismatch',
        }),
      ]),
    );
  });

  it('rejects invalid overridden relation types on inherited edge refinements', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: datastore
    type: core/web-app.types.datastore
    provenance:
      locations:
        - input: primary
          path: server/storage.ts
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const diagnostics = validateNodeRefinementSemantics({
      task: {
        nodeId: 'datastore',
        nodeTypeId: 'core/web-app.types.datastore',
        nodeName: 'Datastore',
        scope: ['server/storage.ts'],
        evidence: evidence('server/storage.ts', 'Storage root'),
        depth: 0,
        inboundEdges: [
          {
            id: 'service-reads-datastore',
            relationTypeId: 'core/software.relations.reads',
            sourceId: 'service',
            sourceTypeId: 'core/web-app.types.service',
            targetId: 'datastore',
            targetTypeId: 'core/web-app.types.datastore',
            evidence: evidence('server/storage.ts', 'Service reads datastore'),
            side: 'ingress',
          },
        ],
        outboundEdges: [],
      },
      result: {
        children: [
          {
            localId: 'models',
            name: 'Models',
            typeId: 'core/web-app.types.group',
            scope: ['server/models'],
            evidence: evidence('server/models/index.ts', 'Model layer'),
            queueDecision: 'expand',
            groupMode: 'mixed',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'service-reads-datastore',
            relationTypeId: 'core/software.relations.reads',
            toChildLocalId: 'models',
          },
        ],
      },
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_edge_refinement_relation_type',
          details: expect.objectContaining({
            relationAnalysis: expect.objectContaining({
              fromType: 'core/web-app.types.service',
              toType: 'core/web-app.types.group',
              selectedType: 'core/software.relations.reads',
              validRelationTypes: ['core/software.relations.calls'],
            }),
          }),
        }),
      ]),
    );
  });

  it('suggests deferred containment when a runtime child tries to call a code sibling it could contain', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/code@0.1
    layer: 1
entities:
  - id: backend-api-domain
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: server/index.ts
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const diagnostics = validateNodeRefinementSemantics({
      task: {
        nodeId: 'backend-api-domain',
        nodeTypeId: 'core/web-app.types.service',
        nodeName: 'Backend API domain',
        scope: ['server'],
        evidence: evidence('server/index.ts', 'Service root'),
        depth: 0,
        inboundEdges: [],
        outboundEdges: [],
      },
      result: {
        children: [
          {
            localId: 'backend-http-surface',
            name: 'Backend HTTP Surface',
            typeId: 'core/web-app.types.api',
            scope: ['server/routes'],
            evidence: evidence('server/routes/index.ts', 'HTTP surface'),
            queueDecision: 'expand',
          },
          {
            localId: 'document-domain-ops',
            name: 'Document Domain Operations',
            typeId: 'core/code.types.module',
            scope: ['server/policies/document.ts'],
            evidence: evidence('server/policies/document.ts', 'Document domain module'),
            queueDecision: 'leaf',
          },
        ],
        relations: [
          {
            localId: 'rel-http-surface-calls-document-domain-ops',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'backend-http-surface',
            toLocalId: 'document-domain-ops',
            evidence: evidence('server/routes/index.ts', 'HTTP surface delegates to domain code'),
          },
        ],
        edgeRefinements: [],
      },
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_relation_type',
          details: expect.objectContaining({
            relationAnalysis: expect.objectContaining({
              preferredContainmentOwner: expect.objectContaining({
                ownerLocalId: 'backend-http-surface',
                childLocalId: 'document-domain-ops',
              }),
              remedy: expect.objectContaining({
                kind: 'containment',
                ownerLocalId: 'backend-http-surface',
                childLocalId: 'document-domain-ops',
                deferToChildRefinement: true,
              }),
            }),
          }),
        }),
      ]),
    );
    expect(
      diagnostics.find(
        (diagnostic) => diagnostic.code === 'diagram.node_refinement.invalid_relation_type',
      )?.message,
    ).toContain(
      'backend-http-surface should usually contain document-domain-ops in a later refinement',
    );
  });

  it('can prune unsupported local relations while preserving their child nodes', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: workspace-bridge
    type: core/web-app.types.group
    props:
      mode: mixed
    provenance:
      locations:
        - input: primary
          path: src/workspace.ts
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);
    const task: NodeRefinementTask = {
      nodeId: 'workspace-bridge',
      nodeTypeId: 'core/web-app.types.group',
      nodeName: 'Workspace bridge',
      groupMode: 'mixed',
      scope: ['src/workspace.ts'],
      evidence: evidence('src/workspace.ts', 'Workspace bridge'),
      depth: 0,
      inboundEdges: [],
      outboundEdges: [],
    };
    const result = {
      children: [
        {
          localId: 'workspace-api',
          name: 'Workspace API',
          typeId: 'core/web-app.types.api',
          scope: ['src/workspace.ts'],
          evidence: evidence('src/workspace.ts', 'API wrapper'),
          queueDecision: 'leaf' as const,
        },
        {
          localId: 'remote-workspace-store',
          name: 'Remote Workspace Store',
          typeId: 'core/web-app.types.datastore',
          scope: ['src/workspace.ts'],
          evidence: evidence('src/workspace.ts', 'Remote state'),
          queueDecision: 'leaf' as const,
        },
      ],
      relations: [
        {
          localId: 'workspace-api-read-writes-remote-workspace-store',
          typeId: 'core/software.relations.read-writes',
          fromLocalId: 'workspace-api',
          toLocalId: 'remote-workspace-store',
          evidence: evidence('src/workspace.ts', 'API state access'),
        },
      ],
      edgeRefinements: [],
    };

    expect(
      validateNodeRefinementSemantics({
        task,
        result,
        schema: validation.effectiveSchema!,
        semantics,
        schemaActivations: validation.document!.schemaRefs,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_relation_type',
        }),
      ]),
    );

    const pruned = pruneInvalidLocalRelations({
      result,
      schema: validation.effectiveSchema!,
      semantics,
    });

    expect(pruned.children.map((child) => child.localId)).toEqual([
      'workspace-api',
      'remote-workspace-store',
    ]);
    expect(pruned.relations).toEqual([]);
    expect(
      validateNodeRefinementSemantics({
        task,
        result: pruned,
        schema: validation.effectiveSchema!,
        semantics,
        schemaActivations: validation.document!.schemaRefs,
      }),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_relation_type',
        }),
      ]),
    );
  });

  it('converts invalid inherited edge refinements to generic groups into proposals', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: primary-database
    type: core/web-app.types.relational-db
    provenance:
      locations:
        - input: primary
          path: packages/db/src/index.ts
relations:
  - id: app-read-writes-primary-database
    type: core/software.relations.read-writes
    from: app
    to: primary-database
    provenance:
      locations:
        - input: primary
          path: packages/db/src/index.ts
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);
    const task: NodeRefinementTask = {
      nodeId: 'primary-database',
      nodeTypeId: 'core/web-app.types.relational-db',
      nodeName: 'Primary database',
      scope: ['packages/db/src/index.ts'],
      evidence: evidence('packages/db/src/index.ts', 'Database package'),
      depth: 0,
      inboundEdges: [
        {
          id: 'app-read-writes-primary-database',
          relationTypeId: 'core/software.relations.read-writes',
          sourceId: 'app',
          sourceTypeId: 'core/web-app.types.service',
          targetId: 'primary-database',
          targetTypeId: 'core/web-app.types.relational-db',
          evidence: evidence('packages/db/src/index.ts', 'Service persists records'),
          side: 'ingress',
        },
      ],
      outboundEdges: [],
    };

    const normalized = pruneInvalidEdgeRefinements({
      task,
      result: {
        children: [
          {
            localId: 'persistence-surface',
            name: 'Persistence Surface',
            typeId: 'core/web-app.types.group',
            scope: ['packages/db/src'],
            evidence: evidence('packages/db/src/index.ts', 'Database package grouping'),
            queueDecision: 'expand',
            groupMode: 'mixed',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-read-writes-primary-database',
            toChildLocalId: 'persistence-surface',
          },
        ],
      },
      schema: validation.effectiveSchema!,
      semantics,
    });

    expect(normalized.children.map((child) => child.localId)).toEqual(['persistence-surface']);
    expect(normalized.edgeRefinements).toEqual([]);
    expect(normalized.edgeProposals).toEqual([
      {
        edgeId: 'app-read-writes-primary-database',
        endpoint: 'to',
        childLocalId: 'persistence-surface',
      },
    ]);
    const diagnostics = validateNodeRefinementSemantics({
      task,
      result: normalized,
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });
    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_edge_refinement_relation_type',
        }),
        expect.objectContaining({
          code: 'diagram.node_refinement.expand_child_not_flow_justified',
        }),
      ]),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.pending_edge_proposal_relation_type',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('preserves relation type overrides when an active proposal supplies the opposite endpoint', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: storage-boundary
    type: core/web-app.types.relational-db
    provenance:
      locations:
        - input: primary
          path: storage/index.ts
relations:
  - id: app-read-writes-storage-boundary
    type: core/software.relations.read-writes
    from: app
    to: storage-boundary
    provenance:
      locations:
        - input: primary
          path: storage/index.ts
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);
    const task: NodeRefinementTask = {
      nodeId: 'app',
      nodeTypeId: 'core/web-app.types.service',
      nodeName: 'App',
      scope: ['src/app.ts'],
      evidence: evidence('src/app.ts', 'App root'),
      depth: 0,
      inboundEdges: [],
      outboundEdges: [
        {
          id: 'app-read-writes-storage-boundary',
          relationTypeId: 'core/software.relations.read-writes',
          sourceId: 'app',
          sourceTypeId: 'core/web-app.types.service',
          targetId: 'storage-boundary',
          targetTypeId: 'core/web-app.types.relational-db',
          evidence: evidence('storage/index.ts', 'Service persists records'),
          side: 'egress',
        },
      ],
    };
    const activeEdgeProposals = [
      {
        edgeId: 'app-read-writes-storage-boundary',
        endpoint: 'to' as const,
        childId: 'storage-boundary/storage-group',
        childLocalId: 'storage-group',
        childTypeId: 'core/web-app.types.group',
        ownerNodeId: 'storage-boundary',
      },
    ];
    const result = {
      children: [
        {
          localId: 'runtime',
          name: 'Runtime',
          typeId: 'core/web-app.types.service',
          scope: ['src/app.ts'],
          evidence: evidence('src/app.ts', 'App runtime'),
          queueDecision: 'leaf' as const,
        },
      ],
      relations: [],
      edgeRefinements: [
        {
          edgeId: 'app-read-writes-storage-boundary',
          relationTypeId: 'core/software.relations.calls',
          fromChildLocalId: 'runtime',
        },
      ],
    };

    const pruned = pruneInvalidEdgeRefinements({
      task,
      result,
      schema: validation.effectiveSchema!,
      semantics,
      activeEdgeProposals,
    });

    expect(pruned.edgeRefinements).toEqual([
      {
        edgeId: 'app-read-writes-storage-boundary',
        relationTypeId: 'core/software.relations.calls',
        fromChildLocalId: 'runtime',
      },
    ]);
    expect(
      validateNodeRefinementSemantics({
        task,
        result: pruned,
        schema: validation.effectiveSchema!,
        semantics,
        schemaActivations: validation.document!.schemaRefs,
        activeEdgeProposals,
      }),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_edge_refinement_relation_type',
        }),
      ]),
    );

    const state = createBaseState();
    state.rootNodeIds = ['app', 'storage-boundary'];
    state.nodesById = {
      app: {
        id: 'app',
        localId: 'app',
        name: 'App',
        typeId: 'core/web-app.types.service',
        scope: ['src/app.ts'],
        evidence: evidence('src/app.ts', 'App root'),
        queueDecision: 'leaf',
      },
      'storage-boundary': {
        id: 'storage-boundary',
        localId: 'storage-boundary',
        name: 'Storage boundary',
        typeId: 'core/web-app.types.relational-db',
        scope: ['storage/index.ts'],
        evidence: evidence('storage/index.ts', 'Storage root'),
        queueDecision: 'leaf',
      },
      'storage-boundary/storage-group': {
        id: 'storage-boundary/storage-group',
        parentId: 'storage-boundary',
        localId: 'storage-group',
        name: 'Storage group',
        typeId: 'core/web-app.types.group',
        scope: ['storage/index.ts'],
        evidence: evidence('storage/index.ts', 'Storage group'),
        queueDecision: 'expand',
        groupMode: 'mixed',
      },
    };
    state.edgeContracts = [
      {
        id: 'app-read-writes-storage-boundary',
        relationTypeId: 'core/software.relations.read-writes',
        sourceId: 'app',
        sourceTypeId: 'core/web-app.types.service',
        targetId: 'storage-boundary',
        targetTypeId: 'core/web-app.types.relational-db',
        evidence: evidence('storage/index.ts', 'Service persists records'),
      },
    ];
    state.activeEdgeProposals = activeEdgeProposals;

    const nextState = applyNodeRefinementResult({
      state,
      task,
      result: pruned,
    });

    expect(nextState.edgeContracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'app-read-writes-storage-boundary',
          relationTypeId: 'core/software.relations.calls',
          sourceId: 'app/runtime',
          targetId: 'storage-boundary/storage-group',
        }),
      ]),
    );
  });

  it('preserves valid inherited storage edge refinements to storage children', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: storage-boundary
    type: core/web-app.types.datastore
    provenance:
      locations:
        - input: primary
          path: storage/index.ts
relations:
  - id: app-read-writes-storage-boundary
    type: core/software.relations.read-writes
    from: app
    to: storage-boundary
    provenance:
      locations:
        - input: primary
          path: storage/index.ts
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);
    const task: NodeRefinementTask = {
      nodeId: 'storage-boundary',
      nodeTypeId: 'core/web-app.types.datastore',
      nodeName: 'Storage boundary',
      scope: ['storage/index.ts'],
      evidence: evidence('storage/index.ts', 'Storage package'),
      depth: 0,
      inboundEdges: [
        {
          id: 'app-read-writes-storage-boundary',
          relationTypeId: 'core/software.relations.read-writes',
          sourceId: 'app',
          sourceTypeId: 'core/web-app.types.service',
          targetId: 'storage-boundary',
          targetTypeId: 'core/web-app.types.datastore',
          evidence: evidence('storage/index.ts', 'Service persists records'),
          side: 'ingress',
        },
      ],
      outboundEdges: [],
    };

    const pruned = pruneInvalidEdgeRefinements({
      task,
      result: {
        children: [
          {
            localId: 'primary-db',
            name: 'Primary DB',
            typeId: 'core/web-app.types.relational-db',
            scope: ['storage/postgres.ts'],
            evidence: evidence('storage/postgres.ts', 'Primary database adapter'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-read-writes-storage-boundary',
            toChildLocalId: 'primary-db',
          },
        ],
      },
      schema: validation.effectiveSchema!,
      semantics,
    });

    expect(pruned.children.map((child) => child.localId)).toEqual(['primary-db']);
    expect(pruned.edgeRefinements).toEqual([
      {
        edgeId: 'app-read-writes-storage-boundary',
        toChildLocalId: 'primary-db',
      },
    ]);
  });

  it('warns when an evidence-matched storage runtime leaves an inherited edge unrefined', async () => {
    const { validation, semantics, task } = await createStorageRootRefinementContext();
    const diagnostics = validateNodeRefinementSemantics({
      task,
      result: createStorageRootRefinementResult(),
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });

    const warning = diagnostics.find(
      (diagnostic) => diagnostic.code === 'diagram.node_refinement.unrefined_inherited_edge',
    );
    expect(warning).toEqual(
      expect.objectContaining({
        severity: 'warning',
        relationId: 'repo-sync-read-writes-storage',
      }),
    );
    expect(warning?.details).toEqual(
      expect.objectContaining({
        suggestedEdgeRefinements: expect.arrayContaining([
          expect.objectContaining({
            edgeId: 'repo-sync-read-writes-storage',
            endpoint: 'to',
            childLocalId: 'storage-runtime',
            toChildLocalId: 'storage-runtime',
            matchingPath: 'pkg/services/store/service.go',
            relationTypeId: 'core/software.relations.calls',
          }),
        ]),
      }),
    );
    expect(shouldRepairNodeRefinementDiagnostics(diagnostics)).toBe(true);
  });

  it('does not warn about evidence-matched inherited edges that are already refined or proposed', async () => {
    const { validation, semantics, task } = await createStorageRootRefinementContext();

    for (const result of [
      createStorageRootRefinementResult({
        edgeRefinements: [
          {
            edgeId: 'repo-sync-read-writes-storage',
            relationTypeId: 'core/software.relations.calls',
            toChildLocalId: 'storage-runtime',
          },
        ],
      }),
      createStorageRootRefinementResult({
        edgeProposals: [
          {
            edgeId: 'repo-sync-read-writes-storage',
            endpoint: 'to',
            childLocalId: 'storage-runtime',
            relationTypeId: 'core/software.relations.calls',
          },
        ],
      }),
    ]) {
      expect(
        validateNodeRefinementSemantics({
          task,
          result,
          schema: validation.effectiveSchema!,
          semantics,
          schemaActivations: validation.document!.schemaRefs,
        }),
      ).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'diagram.node_refinement.unrefined_inherited_edge',
          }),
        ]),
      );
    }
  });

  it('does not warn about unrefined inherited edges without child evidence overlap', async () => {
    const { validation, semantics, task } = await createStorageRootRefinementContext();
    const diagnostics = validateNodeRefinementSemantics({
      task,
      result: createStorageRootRefinementResult({
        children: [
          {
            localId: 'storage-runtime',
            name: 'Storage Runtime',
            typeId: 'core/code.types.module',
            scope: ['pkg/services/runtime/other.go'],
            evidence: evidence('pkg/services/runtime/other.go', 'Unrelated runtime code'),
            queueDecision: 'leaf',
          },
        ],
        relations: [],
      }),
      schema: validation.effectiveSchema!,
      semantics,
      schemaActivations: validation.document!.schemaRefs,
    });

    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.unrefined_inherited_edge',
        }),
      ]),
    );
  });

  it('repairs unrefined inherited edge warnings before accepting a node refinement', async () => {
    const { validation, semantics, task, schemaContext } =
      await createStorageRootRefinementContext();
    const initialState = createBaseState();
    initialState.rootNodeIds = ['repo-sync', 'storage-root'];
    initialState.nodesById = {
      'repo-sync': {
        id: 'repo-sync',
        localId: 'repo-sync',
        name: 'Repository Sync',
        typeId: 'core/web-app.types.service',
        scope: ['pkg/services/provisioning/repository.go'],
        evidence: evidence('pkg/services/provisioning/repository.go', 'Repository sync'),
        queueDecision: 'leaf',
      },
      'storage-root': {
        id: 'storage-root',
        localId: 'storage-root',
        name: 'Storage root',
        typeId: 'core/web-app.types.datastore',
        scope: ['pkg/services/store/service.go'],
        evidence: evidence('pkg/services/store/service.go', 'Storage root'),
        queueDecision: 'expand',
      },
    };
    initialState.edgeContracts = [
      {
        id: 'repo-sync-read-writes-storage',
        relationTypeId: 'core/software.relations.read-writes',
        sourceId: 'repo-sync',
        sourceTypeId: 'core/web-app.types.service',
        targetId: 'storage-root',
        targetTypeId: 'core/web-app.types.datastore',
        evidence: evidence('pkg/services/store/service.go', 'Repository sync storage access'),
      },
    ];
    initialState.queue = [task];
    initialState.tasksByNodeId = { 'storage-root': task };

    const missedResult = createStorageRootRefinementResult();
    const repairedResult = createStorageRootRefinementResult({
      edgeRefinements: [
        {
          edgeId: 'repo-sync-read-writes-storage',
          relationTypeId: 'core/software.relations.calls',
          toChildLocalId: 'storage-runtime',
        },
      ],
    });
    const refiner = {
      refineNode: vi.fn().mockResolvedValue({
        result: missedResult,
        rawResponse: JSON.stringify(missedResult),
        threadId: 'thread-node',
      }),
    };
    const repairer = {
      repairNode: vi.fn().mockResolvedValue({
        result: repairedResult,
        rawResponse: JSON.stringify(repairedResult),
        threadId: 'thread-node-repair',
      }),
    };

    const result = await runNodeRefinement({
      workspace: {
        jobRoot: '/tmp/job',
        targetRepoPath: '/tmp/job/target-repo',
        schemaRepoPath: '/tmp/job/schema-repo',
        workspaceOutputDir: '/tmp/job/out',
        repoRevision: 'abc123',
      },
      repo: 'https://github.com/example/repo',
      ref: 'main',
      repoCensus: createRepoCensus(),
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger: quietLogger(),
      initialState,
      refiner,
      repairer,
      getSchemaContext: () => schemaContext,
      stopBeforeDepth: 1,
    });

    expect(repairer.repairNode).toHaveBeenCalledTimes(1);
    expect(repairer.repairNode.mock.calls[0]?.[0].diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.unrefined_inherited_edge',
        }),
      ]),
    );
    expect(result.edgeContracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'repo-sync-read-writes-storage',
          relationTypeId: 'core/software.relations.calls',
          sourceId: 'repo-sync',
          targetId: 'storage-root/storage-runtime',
        }),
      ]),
    );
  });

  it('repairs a node using newly introduced global diagnostics from the assembled document', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: App
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
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const initialState = createBaseState();
    initialState.nodesById.app = {
      ...initialState.nodesById.app,
      typeId: 'core/web-app.types.application',
      name: 'App',
    };
    const task: NodeRefinementTask = {
      ...createOutboundTask(),
      nodeTypeId: 'core/web-app.types.application',
      nodeName: 'App',
    };
    initialState.queue = [task];
    initialState.tasksByNodeId = { app: task };

    const baselineWarning = {
      domain: 'diagram' as const,
      phase: 'document' as const,
      severity: 'warning' as const,
      code: 'diagram.flow.missing_expected_relations',
      entityId: 'backend',
      message: 'Backend is missing expected relation types: reads',
    };
    const introducedError = {
      domain: 'diagram' as const,
      phase: 'document' as const,
      severity: 'error' as const,
      code: 'diagram.document.invalid_relation_endpoints',
      relationId: 'app-calls-backend',
      message: 'Relation app-calls-backend has invalid endpoints for core/software.relations.calls',
    };
    const introducedWarning = {
      domain: 'diagram' as const,
      phase: 'document' as const,
      severity: 'warning' as const,
      code: 'diagram.flow.unresolved_egress',
      entityId: 'app/runtime',
      message: 'app/runtime is missing outgoing flow at level 0',
    };

    let globalValidationCalls = 0;
    const refiner = {
      refineNode: vi.fn().mockResolvedValue({
        result: {
          children: [
            {
              localId: 'runtime',
              name: 'Runtime',
              typeId: 'core/web-app.types.service',
              scope: ['src/runtime.ts'],
              evidence: evidence('src/runtime.ts', 'Runtime'),
              queueDecision: 'leaf' as const,
            },
          ],
          relations: [],
          edgeRefinements: [
            {
              edgeId: 'app-calls-backend',
              fromChildLocalId: 'runtime',
            },
          ],
        },
        rawResponse: '{"children":[]}',
        threadId: 'thread-node',
      }),
    };
    const repairer = {
      repairNode: vi.fn().mockResolvedValue({
        result: {
          children: [
            {
              localId: 'runtime',
              name: 'Runtime',
              typeId: 'core/web-app.types.service',
              scope: ['src/runtime.ts'],
              evidence: evidence('src/runtime.ts', 'Runtime'),
              queueDecision: 'leaf' as const,
            },
          ],
          relations: [],
          edgeRefinements: [],
        },
        rawResponse: '{"children":[]}',
        threadId: 'thread-node-repair',
      }),
    };

    const result = await runNodeRefinement({
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
          totalFiles: 2,
          totalDirectories: 1,
          totalLines: 10,
          languages: { typescript: 10 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger: quietLogger(),
      initialState,
      refiner,
      repairer,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3')],
        }),
      }),
      validateAppliedState: () => {
        globalValidationCalls += 1;
        if (globalValidationCalls === 1) {
          return [baselineWarning];
        }
        if (globalValidationCalls === 2) {
          return [baselineWarning, introducedError, introducedWarning];
        }
        return [baselineWarning];
      },
    });

    expect(repairer.repairNode).toHaveBeenCalled();
    const repairDiagnostics = repairer.repairNode.mock.calls[0]?.[0].diagnostics ?? [];
    expect(repairDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: introducedError.code }),
        expect.objectContaining({ code: introducedWarning.code }),
      ]),
    );
    expect(repairDiagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ message: baselineWarning.message })]),
    );
    expect(result.edgeContracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'app-calls-backend',
          sourceId: 'app',
          targetId: 'backend',
        }),
      ]),
    );
  });

  it('does not fail node refinement when only advisory flow diagnostics remain after repair', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: App
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
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const initialState = createBaseState();
    initialState.nodesById.app = {
      ...initialState.nodesById.app,
      typeId: 'core/web-app.types.application',
      name: 'App',
    };
    const task: NodeRefinementTask = {
      ...createOutboundTask(),
      nodeTypeId: 'core/web-app.types.application',
      nodeName: 'App',
    };
    initialState.queue = [task];
    initialState.tasksByNodeId = { app: task };

    const unresolvedFlow = {
      domain: 'diagram' as const,
      phase: 'document' as const,
      severity: 'error' as const,
      code: 'diagram.flow.unresolved_egress',
      entityId: 'app/runtime',
      message: 'app/runtime is missing outgoing flow at level 0',
    };

    const refiner = {
      refineNode: vi.fn().mockResolvedValue({
        result: {
          children: [
            {
              localId: 'runtime',
              name: 'Runtime',
              typeId: 'core/web-app.types.service',
              scope: ['src/runtime.ts'],
              evidence: evidence('src/runtime.ts', 'Runtime'),
              queueDecision: 'leaf' as const,
            },
          ],
          relations: [],
          edgeRefinements: [],
        },
        rawResponse: '{"children":[]}',
        threadId: 'thread-node',
      }),
    };
    const repairer = {
      repairNode: vi.fn().mockImplementation(async ({ previousResult }) => ({
        result: previousResult,
        rawResponse: JSON.stringify(previousResult),
        threadId: 'thread-node-repair',
      })),
    };

    const result = await runNodeRefinement({
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
          totalFiles: 2,
          totalDirectories: 1,
          totalLines: 10,
          languages: { typescript: 10 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger: quietLogger(),
      initialState,
      refiner,
      repairer,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3')],
        }),
      }),
      validateAppliedState: () => [unresolvedFlow],
    });

    expect(repairer.repairNode).not.toHaveBeenCalled();
    expect(result.queue).toEqual([]);
    expect(result.refinementsByNodeId.app).toBeDefined();
  });

  it('salvages invalid local relations after repair attempts instead of aborting the node', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: App
    provenance:
      locations:
        - input: primary
          path: src/app.ts
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);
    const task: NodeRefinementTask = {
      nodeId: 'app',
      nodeTypeId: 'core/web-app.types.group',
      nodeName: 'App',
      groupMode: 'mixed',
      scope: ['src/app.ts'],
      evidence: evidence('src/app.ts', 'App root'),
      depth: 0,
      inboundEdges: [],
      outboundEdges: [],
    };
    const initialState = createBaseState();
    initialState.rootNodeIds = ['app'];
    initialState.nodesById = {
      app: {
        id: 'app',
        localId: 'app',
        name: 'App',
        typeId: 'core/web-app.types.group',
        scope: ['src/app.ts'],
        evidence: evidence('src/app.ts', 'App root'),
        queueDecision: 'expand',
        groupMode: 'mixed',
      },
    };
    initialState.edgeContracts = [];
    initialState.queue = [task];
    initialState.tasksByNodeId = { app: task };
    const invalidResult = {
      children: [
        {
          localId: 'workspace-api',
          name: 'Workspace API',
          typeId: 'core/web-app.types.api',
          scope: ['src/workspace.ts'],
          evidence: evidence('src/workspace.ts', 'API wrapper'),
          queueDecision: 'leaf' as const,
        },
        {
          localId: 'remote-workspace-store',
          name: 'Remote Workspace Store',
          typeId: 'core/web-app.types.datastore',
          scope: ['src/workspace.ts'],
          evidence: evidence('src/workspace.ts', 'Remote state'),
          queueDecision: 'leaf' as const,
        },
      ],
      relations: [
        {
          localId: 'workspace-api-read-writes-remote-workspace-store',
          typeId: 'core/software.relations.read-writes',
          fromLocalId: 'workspace-api',
          toLocalId: 'remote-workspace-store',
          evidence: evidence('src/workspace.ts', 'API state access'),
        },
      ],
      edgeRefinements: [],
    };
    const refiner = {
      refineNode: vi.fn().mockResolvedValue({
        result: invalidResult,
        rawResponse: JSON.stringify(invalidResult),
        threadId: 'thread-node',
      }),
    };
    const repairer = {
      repairNode: vi.fn().mockImplementation(async ({ previousResult }) => ({
        result: previousResult,
        rawResponse: JSON.stringify(previousResult),
        threadId: 'thread-node-repair',
      })),
    };
    const logger = quietLogger();

    const result = await runNodeRefinement({
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
          totalFiles: 2,
          totalDirectories: 1,
          totalLines: 10,
          languages: { typescript: 10 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger,
      initialState,
      refiner,
      repairer,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3')],
        }),
      }),
    });

    expect(repairer.repairNode).toHaveBeenCalledTimes(2);
    expect(result.refinementsByNodeId.app?.relations).toEqual([]);
    expect(result.nodesById['app/workspace-api']).toBeDefined();
    expect(result.nodesById['app/remote-workspace-store']).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Dropping 1 invalid local relation under app after repair attempts'),
    );
  });

  it('repairs malformed node-refinement model output instead of aborting immediately', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: App
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
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
inputs:
  - id: primary
    kind: git
    repo: https://github.com/example/repo
    revision: abc123abc123abc123abc123abc123abc123abcd
    role: primary
`,
      schemaRegistry,
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const initialState = createBaseState();
    initialState.queue = [createOutboundTask()];
    initialState.tasksByNodeId = { app: createOutboundTask() };

    const refiner = {
      refineNode: vi.fn().mockRejectedValue(
        new ModelOutputParseError({
          operation: 'advanced node refinement for app',
          expectedFormat: 'json',
          rawResponse: 'children:\n  - bad: true\n',
          threadId: 'thread-node',
          tokenUsage: emptyTokenUsageTotals(),
          cause: new SyntaxError("Unexpected token 'c'"),
        }),
      ),
    };
    const repairer = {
      repairNode: vi.fn().mockResolvedValue({
        result: {
          children: [
            {
              localId: 'runtime',
              name: 'Runtime',
              typeId: 'core/web-app.types.service',
              scope: ['src/runtime.ts'],
              evidence: evidence('src/runtime.ts', 'Runtime'),
              queueDecision: 'leaf' as const,
            },
          ],
          relations: [],
          edgeRefinements: [
            {
              edgeId: 'app-calls-backend',
              fromChildLocalId: 'runtime',
            },
          ],
        },
        rawResponse: '{"children":[]}',
        threadId: 'thread-node-repair',
      }),
    };

    const result = await runNodeRefinement({
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
          totalFiles: 2,
          totalDirectories: 1,
          totalLines: 10,
          languages: { typescript: 10 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger: quietLogger(),
      initialState,
      refiner,
      repairer,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3')],
        }),
      }),
      validateAppliedState: () => [],
    });

    expect(repairer.repairNode).toHaveBeenCalled();
    expect(repairer.repairNode.mock.calls[0]?.[0].diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_model_output',
        }),
      ]),
    );
    expect(result.nodesById['app/runtime']).toEqual(
      expect.objectContaining({
        typeId: 'core/web-app.types.service',
      }),
    );
  });
  it.each([
    'malformed',
    'worse',
    'latest',
    'no-acceptable',
    'checkpoint-failure',
  ] as const)('retains the last acceptable refinement on %s repair failures', async (mode) => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: App
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
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
inputs:
  - id: primary
    kind: git
    repo: https://github.com/example/repo
    revision: abc123abc123abc123abc123abc123abc123abcd
    role: primary
`,
      schemaRegistry,
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const initialState = createBaseState();
    initialState.queue = [createOutboundTask()];
    initialState.tasksByNodeId = { app: createOutboundTask() };

    const acceptable: NodeRefinementResult = {
      children: [
        {
          localId: 'runtime',
          name: 'Runtime',
          typeId: 'core/web-app.types.service',
          scope: ['src/app.ts'],
          evidence: evidence('src/app.ts'),
          queueDecision: 'leaf',
        },
      ],
      relations: [],
      edgeRefinements: [],
    };
    const invalid: NodeRefinementResult = {
      ...acceptable,
      children: [{ ...acceptable.children[0], typeId: 'missing.type' }],
    };
    const malformed = new ModelOutputParseError({
      operation: 'repair',
      expectedFormat: 'json',
      rawResponse: 'broken',
      threadId: 'repair',
      tokenUsage: emptyTokenUsageTotals(),
      cause: new SyntaxError('bad json'),
    });
    const refiner = {
      refineNode: vi.fn().mockResolvedValue({
        result: mode === 'no-acceptable' || mode === 'checkpoint-failure' ? invalid : acceptable,
        rawResponse: 'accepted response',
        threadId: 'initial',
      }),
    };
    const repairer = {
      repairNode:
        mode === 'worse'
          ? vi.fn().mockResolvedValue({
              result: invalid,
              rawResponse: 'invalid response',
              threadId: 'repair',
            })
          : vi.fn().mockRejectedValue(malformed),
    };
    if (mode === 'latest')
      repairer.repairNode.mockResolvedValueOnce({
        result: {
          ...acceptable,
          children: [{ ...acceptable.children[0], name: 'Improved runtime' }],
        },
        rawResponse: 'latest accepted response',
        threadId: 'latest',
      });
    const onCheckpoint = vi.fn();
    const onFailure = vi.fn().mockImplementation(() => {
      if (mode === 'checkpoint-failure') throw new Error('disk unavailable');
    });
    const logger = { ...quietLogger(), warn: vi.fn() };
    const promise = runNodeRefinement({
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
          totalFiles: 2,
          totalDirectories: 1,
          totalLines: 10,
          languages: { typescript: 10 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger,
      onCheckpoint,
      onFailure,
      initialState,
      refiner,
      repairer,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3')],
        }),
      }),
      validateAppliedState: () => [],
    });

    if (mode === 'no-acceptable' || mode === 'checkpoint-failure') {
      await expect(promise).rejects.toThrow('failed validation');
      expect(onCheckpoint).not.toHaveBeenCalled();
      return;
    }
    const result = await promise;
    expect(result.nodesById['app/runtime'].typeId).toBe('core/web-app.types.service');
    expect(result.nodesById['app/runtime'].name).toBe(
      mode === 'latest' ? 'Improved runtime' : 'Runtime',
    );
    expect(result.budgets.turnsUsed).toBe(mode === 'malformed' ? 2 : 3);
    expect(onCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        rawResponse: mode === 'latest' ? 'latest accepted response' : 'accepted response',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'diagram.node_refinement.repair_fallback',
            severity: 'warning',
          }),
        ]),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('last acceptable refinement'));
    expect(repairer.repairNode).toHaveBeenCalled();
  });

  it('replays a cached node refinement without consuming a model turn', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.group
    name: App
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
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const initialState = createBaseState();
    const task = createOutboundTask();
    initialState.queue = [task];
    initialState.tasksByNodeId = { app: task };

    const cachedEntry = {
      version: 2,
      nodeId: 'app',
      taskFingerprint: 'task',
      schemaContextFingerprint: 'schema',
      stateFingerprint: 'state',
      task,
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.application',
            scope: ['src/runtime.ts'],
            evidence: evidence('src/runtime.ts', 'Runtime'),
            queueDecision: 'leaf' as const,
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-calls-backend',
            fromChildLocalId: 'runtime',
          },
        ],
      },
      rawResponse: '{"cached":true}',
      diagnostics: [],
      repairAttemptCount: 0,
      appliedAtTurn: 1,
      cachedAt: '2026-01-01T00:00:00.000Z',
    } satisfies CachedNodeRefinementEntry;

    const refiner = {
      refineNode: vi.fn(),
    };
    const checkpoint = vi.fn();

    const result = await runNodeRefinement({
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
          totalFiles: 2,
          totalDirectories: 1,
          totalLines: 10,
          languages: { typescript: 10 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger: quietLogger(),
      initialState,
      refiner,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3')],
        }),
      }),
      loadCachedResult: () => cachedEntry,
      validateAppliedState: () => [],
      onCheckpoint: checkpoint,
    });

    expect(refiner.refineNode).not.toHaveBeenCalled();
    expect(result.budgets.turnsUsed).toBe(0);
    expect(result.refinementsByNodeId.app).toBeDefined();
    expect(checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        completedTask: expect.objectContaining({ nodeId: 'app' }),
        source: 'cached',
      }),
    );
  });

  it('recomputes a node when its cached refinement no longer validates', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.group
    name: App
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
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const initialState = createBaseState();
    const task = createOutboundTask();
    initialState.queue = [task];
    initialState.tasksByNodeId = { app: task };

    const cachedEntry = {
      version: 2,
      nodeId: 'app',
      taskFingerprint: 'task',
      schemaContextFingerprint: 'schema',
      stateFingerprint: 'state',
      task,
      result: {
        children: [],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-calls-backend',
            fromChildLocalId: 'missing-child',
          },
        ],
      },
      rawResponse: '{"cached":true}',
      diagnostics: [],
      repairAttemptCount: 0,
      appliedAtTurn: 1,
      cachedAt: '2026-01-01T00:00:00.000Z',
    } satisfies CachedNodeRefinementEntry;

    const refiner = {
      refineNode: vi.fn().mockResolvedValue({
        result: {
          children: [
            {
              localId: 'runtime',
              name: 'Runtime',
              typeId: 'core/web-app.types.application',
              scope: ['src/runtime.ts'],
              evidence: evidence('src/runtime.ts', 'Runtime'),
              queueDecision: 'leaf' as const,
            },
          ],
          relations: [],
          edgeRefinements: [
            {
              edgeId: 'app-calls-backend',
              fromChildLocalId: 'runtime',
            },
          ],
        },
        rawResponse: '{"fresh":true}',
        threadId: 'thread-node',
      }),
    };
    const checkpoint = vi.fn();

    const result = await runNodeRefinement({
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
          totalFiles: 2,
          totalDirectories: 1,
          totalLines: 10,
          languages: { typescript: 10 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger: quietLogger(),
      initialState,
      refiner,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3')],
        }),
      }),
      loadCachedResult: () => cachedEntry,
      validateAppliedState: () => [],
      onCheckpoint: checkpoint,
    });

    expect(refiner.refineNode).toHaveBeenCalledTimes(1);
    expect(result.budgets.turnsUsed).toBe(1);
    expect(checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        completedTask: expect.objectContaining({ nodeId: 'app' }),
        source: 'computed',
      }),
    );
  });

  it('passes surrounding modeled context into each node refinement turn', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.group
    name: App
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
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const state = createBaseState();
    state.rootNodeIds = ['app'];
    state.nodesById = {
      app: {
        id: 'app',
        localId: 'app',
        name: 'App',
        typeId: 'core/web-app.types.group',
        scope: ['src'],
        evidence: evidence('src/app.ts', 'App root'),
        queueDecision: 'leaf',
      },
      'app/storage': {
        id: 'app/storage',
        parentId: 'app',
        localId: 'storage',
        name: 'Storage runtime',
        typeId: 'core/code.types.module',
        scope: ['src/Storages'],
        evidence: evidence('src/Storages', 'Storage subtree'),
        queueDecision: 'leaf',
      },
      'app/query': {
        id: 'app/query',
        parentId: 'app',
        localId: 'query',
        name: 'Query runtime',
        typeId: 'core/code.types.module',
        scope: ['src/Query'],
        evidence: evidence('src/Query', 'Query subtree'),
        queueDecision: 'leaf',
      },
      'app/storage/merge-tree': {
        id: 'app/storage/merge-tree',
        parentId: 'app/storage',
        localId: 'merge-tree',
        name: 'MergeTree implementations',
        typeId: 'core/code.types.module',
        scope: ['src/Storages/MergeTree'],
        evidence: evidence('src/Storages/MergeTree', 'MergeTree subtree'),
        queueDecision: 'leaf',
      },
      'app/storage/catalog': {
        id: 'app/storage/catalog',
        parentId: 'app/storage',
        localId: 'catalog',
        name: 'Storage catalog',
        typeId: 'core/code.types.module',
        scope: ['src/Storages/Catalog'],
        evidence: evidence('src/Storages/Catalog', 'Catalog subtree'),
        queueDecision: 'leaf',
      },
      'app/query/merge-tree': {
        id: 'app/query/merge-tree',
        parentId: 'app/query',
        localId: 'merge-tree',
        name: 'MergeTree implementations',
        typeId: 'core/code.types.module',
        scope: ['src/Storages/MergeTree/Readers'],
        evidence: evidence(
          'src/Storages/MergeTree/Readers',
          'Query path overlapping MergeTree scope',
        ),
        queueDecision: 'leaf',
      },
    };
    state.refinementsByNodeId = {
      app: {
        nodeId: 'app',
        description: undefined,
        children: [state.nodesById['app/storage'], state.nodesById['app/query']],
        relations: [],
        edgeRefinements: [],
        edgeProposals: [],
        openQuestions: [],
      },
      'app/storage': {
        nodeId: 'app/storage',
        description: undefined,
        children: [
          state.nodesById['app/storage/merge-tree'],
          state.nodesById['app/storage/catalog'],
        ],
        relations: [],
        edgeRefinements: [],
        edgeProposals: [],
        openQuestions: [],
      },
      'app/query': {
        nodeId: 'app/query',
        description: undefined,
        children: [state.nodesById['app/query/merge-tree']],
        relations: [],
        edgeRefinements: [],
        edgeProposals: [],
        openQuestions: [],
      },
    };
    state.queue = [
      {
        nodeId: 'app/storage/merge-tree',
        nodeTypeId: 'core/code.types.module',
        nodeName: 'MergeTree implementations',
        parentNodeId: 'app/storage',
        scope: ['src/Storages/MergeTree'],
        evidence: evidence('src/Storages/MergeTree', 'MergeTree subtree'),
        depth: 2,
        inboundEdges: [],
        outboundEdges: [],
      },
    ];
    state.tasksByNodeId = { 'app/storage/merge-tree': state.queue[0]! };

    const refiner = {
      refineNode: vi.fn().mockResolvedValue({
        result: {
          children: [],
          relations: [],
          edgeRefinements: [],
        },
        rawResponse: '{"children":[],"relations":[],"edgeRefinements":[]}',
        threadId: 'thread-node',
      }),
    };

    await runNodeRefinement({
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
          totalFiles: 4,
          totalDirectories: 2,
          totalLines: 100,
          languages: { cpp: 100 },
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
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger: quietLogger(),
      initialState: state,
      refiner,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
        }),
      }),
      validateAppliedState: () => [],
    });

    expect(refiner.refineNode).toHaveBeenCalledTimes(1);
    expect(refiner.refineNode).toHaveBeenCalledWith(
      expect.objectContaining({
        surroundingContext: {
          ancestorChain: [
            {
              id: 'app',
              name: 'App',
              typeId: 'core/web-app.types.group',
              scope: ['src'],
              directChildren: [
                {
                  id: 'app/storage',
                  name: 'Storage runtime',
                  typeId: 'core/code.types.module',
                },
                {
                  id: 'app/query',
                  name: 'Query runtime',
                  typeId: 'core/code.types.module',
                },
              ],
            },
            {
              id: 'app/storage',
              name: 'Storage runtime',
              typeId: 'core/code.types.module',
              scope: ['src/Storages'],
              directChildren: [
                {
                  id: 'app/storage/merge-tree',
                  name: 'MergeTree implementations',
                  typeId: 'core/code.types.module',
                },
                {
                  id: 'app/storage/catalog',
                  name: 'Storage catalog',
                  typeId: 'core/code.types.module',
                },
              ],
            },
          ],
          acceptedSiblings: [
            {
              id: 'app/storage/catalog',
              name: 'Storage catalog',
              typeId: 'core/code.types.module',
            },
          ],
          nearbyAcceptedConcepts: [
            {
              id: 'app/query/merge-tree',
              name: 'MergeTree implementations',
              typeId: 'core/code.types.module',
              scope: ['src/Storages/MergeTree/Readers'],
              reasons: [
                'matching concept name',
                'overlapping scope/evidence: src/Storages/MergeTree',
              ],
            },
          ],
        },
      }),
    );
  });

  it('stops before processing the next BFS depth when stopBeforeDepth is set', async () => {
    const schemaRegistry = await loadSchemaRegistry(schemaRepoFixture());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.group
    name: App
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
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`,
      schemaRegistry,
    });
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);
    const rootTask = createOutboundTask();
    const initialState = {
      ...createBaseState(),
      queue: [rootTask],
      tasksByNodeId: {
        app: rootTask,
      },
    };
    const refiner = {
      refineNode: vi.fn().mockImplementation(async ({ task }) => ({
        result:
          task.nodeId === 'app'
            ? {
                children: [
                  {
                    localId: 'runtime',
                    name: 'Runtime',
                    typeId: 'core/web-app.types.application',
                    scope: ['src/runtime.ts'],
                    evidence: evidence('src/runtime.ts', 'Runtime'),
                    queueDecision: 'expand',
                  },
                ],
                relations: [],
                edgeRefinements: [
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
        rawResponse: '{}',
        threadId: 'thread-stop-before-depth',
      })),
    };

    const result = await runNodeRefinement({
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
          totalFiles: 2,
          totalDirectories: 1,
          totalLines: 20,
          languages: { typescript: 20 },
          topLevelPaths: [],
        },
        directories: [],
        manifests: [],
        signals: [],
        files: [],
      },
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
      baseDoc: validation.document!,
      promptPackage: {
        contract: { schemaCatalog: [] } as never,
        renderedContract: 'Validation-backed contract:',
        metaOntologyMarkdown: '# Meta ontology',
        schemaCatalogJson: '[]',
      },
      logger: quietLogger(),
      initialState,
      refiner,
      stopBeforeDepth: 1,
      getSchemaContext: () => ({
        activeSchemaRefs: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        schema: validation.effectiveSchema!,
        semantics,
        schemaFlowCatalog: buildSchemaFlowCatalog({
          schema: validation.effectiveSchema!,
          semantics,
          activeSchemaRefs: [act('core/web-app@0.3')],
        }),
      }),
      validateAppliedState: () => [],
    });

    expect(refiner.refineNode).toHaveBeenCalledTimes(1);
    expect(result.queue.map((task) => task.nodeId)).toEqual(['app/runtime']);
    expect(result.tasksByNodeId['app/runtime']).toEqual(
      expect.objectContaining({
        nodeId: 'app/runtime',
        depth: 1,
      }),
    );
  });
});

describe('compact refinement edge IDs', () => {
  const relationTypeId = 'core/software.relations.calls';
  const child = (localId: string) => ({
    localId,
    name: localId,
    typeId: 'core/code.types.module',
    scope: [],
    evidence: [],
    queueDecision: 'leaf' as const,
  });
  const splitResult = (
    edgeId: string,
    leaf = 'storefront-catalog-routes',
  ): NodeRefinementResult => ({
    children: [child(leaf), child('other')],
    relations: [],
    edgeRefinements: [
      { edgeId, fromChildLocalId: leaf },
      { edgeId, fromChildLocalId: 'other' },
    ],
  });

  it('keeps split IDs bounded over successive depths and records immediate lineage', () => {
    let state = createBaseState();
    let edge = { ...state.edgeContracts[0], sourceId: 'a/b/c', targetId: 'billing-backend-api' };
    state.edgeContracts = [edge];
    const ids: string[] = [];
    for (const leaf of [
      'storefront-catalog-routes',
      'storefront-catalog-route1',
      'storefront-catalog-route2',
      'storefront-catalog-route3',
    ]) {
      state = applyNodeRefinementResult({
        state,
        task: { ...createOutboundTask(), nodeId: edge.sourceId },
        result: splitResult(edge.id, leaf),
      });
      const next = state.edgeContracts.find(
        (candidate) => candidate.sourceId === `${edge.sourceId}/${leaf}`,
      )!;
      expect(next.id).toBe(`calls--${leaf}--to--billing-backend-api`);
      expect(next.id).not.toContain(edge.id);
      expect(next.refines).toBe(edge.id);
      ids.push(next.id);
      edge = next;
    }
    expect(new Set(ids.map((id) => id.length)).size).toBe(1);
  });

  it('reserves retained IDs before split allocation and deterministically hashes collisions', () => {
    const state = createBaseState();
    const baseId = 'calls--storefront-catalog-routes--to--backend';
    // This retained edge comes after the split edge, so allocation must reserve it first.
    const retained = {
      ...state.edgeContracts[0],
      id: baseId,
      sourceId: 'elsewhere/storefront-catalog-routes',
    };
    state.edgeContracts.push(retained);
    const params = { state, task: createOutboundTask(), result: splitResult('app-calls-backend') };
    const next = applyNodeRefinementResult(params);
    const hash = createHash('sha256')
      .update(`${relationTypeId}|app/storefront-catalog-routes|backend`)
      .digest('hex')
      .slice(0, 8);
    expect(next.edgeContracts.find((edge) => edge.sourceId === retained.sourceId)?.id).toBe(baseId);
    expect(
      next.edgeContracts.find((edge) => edge.sourceId === 'app/storefront-catalog-routes')?.id,
    ).toBe(`${baseId}--${hash}`);
    expect(applyNodeRefinementResult(params).edgeContracts).toEqual(next.edgeContracts);
    expect(new Set(next.edgeContracts.map((edge) => edge.id)).size).toBe(next.edgeContracts.length);
  });

  it('keeps IDs unique when a retained ID occupies the hash fallback too', () => {
    const state = createBaseState();
    const baseId = 'calls--storefront-catalog-routes--to--backend';
    const hash = createHash('sha256')
      .update(`${relationTypeId}|app/storefront-catalog-routes|backend`)
      .digest('hex')
      .slice(0, 8);
    state.edgeContracts.push(
      { ...state.edgeContracts[0], id: baseId, sourceId: 'one/storefront-catalog-routes' },
      {
        ...state.edgeContracts[0],
        id: `${baseId}--${hash}`,
        sourceId: 'two/storefront-catalog-routes',
      },
    );
    const params = { state, task: createOutboundTask(), result: splitResult('app-calls-backend') };
    const next = applyNodeRefinementResult(params);
    expect(
      next.edgeContracts.find((edge) => edge.sourceId === 'app/storefront-catalog-routes')?.id,
    ).toBe(`${baseId}--${hash}--2`);
    expect(new Set(next.edgeContracts.map((edge) => edge.id)).size).toBe(next.edgeContracts.length);
    expect(applyNodeRefinementResult(params).edgeContracts).toEqual(next.edgeContracts);
  });

  it('hashes collisions between two newly split edges', () => {
    const state = createBaseState();
    state.edgeContracts.push({
      ...state.edgeContracts[0],
      id: 'second-parent-edge',
      targetId: 'elsewhere/backend',
    });
    const result = splitResult('app-calls-backend');
    result.edgeRefinements.push(...splitResult('second-parent-edge').edgeRefinements);
    const params = { state, task: createOutboundTask(), result };
    const next = applyNodeRefinementResult(params);
    const baseId = 'calls--storefront-catalog-routes--to--backend';
    const hash = createHash('sha256')
      .update(`${relationTypeId}|app/storefront-catalog-routes|elsewhere/backend`)
      .digest('hex')
      .slice(0, 8);
    expect(next.edgeContracts.map((edge) => edge.id)).toContain(baseId);
    expect(next.edgeContracts.map((edge) => edge.id)).toContain(`${baseId}--${hash}`);
    expect(new Set(next.edgeContracts.map((edge) => edge.id)).size).toBe(4);
    expect(applyNodeRefinementResult(params).edgeContracts).toEqual(next.edgeContracts);
  });

  it('keeps an unsplit ID and preserves its existing lineage', () => {
    const state = createBaseState();
    state.edgeContracts[0].refines = 'earlier-parent';
    const result = splitResult('app-calls-backend');
    result.edgeRefinements = result.edgeRefinements.slice(0, 1);
    const next = applyNodeRefinementResult({ state, task: createOutboundTask(), result });
    expect(next.edgeContracts[0].id).toBe('app-calls-backend');
    expect(next.edgeContracts[0].refines).toBe('earlier-parent');
  });

  it('uses compact internal IDs and shares collision allocation with inherited edges', () => {
    const state = createBaseState();
    const baseId = 'calls--runtime--to--backend';
    state.edgeContracts[0] = {
      ...state.edgeContracts[0],
      id: baseId,
      sourceId: 'elsewhere/runtime',
    };
    const next = applyNodeRefinementResult({
      state,
      task: createOutboundTask(),
      result: {
        children: [child('runtime'), child('backend')],
        relations: [
          {
            localId: 'model-local-id',
            typeId: relationTypeId,
            fromLocalId: 'runtime',
            toLocalId: 'backend',
            evidence: [],
          },
        ],
        edgeRefinements: [],
      },
    });
    const internal = next.refinementsByNodeId.app.relations[0];
    const hash = createHash('sha256')
      .update(`${relationTypeId}|app/runtime|app/backend`)
      .digest('hex')
      .slice(0, 8);
    expect(internal.id).toBe(`${baseId}--${hash}`);
    expect(internal.refines).toBeUndefined();
  });

  it('omits a missing relation type and sanitizes local segments', () => {
    const state = createBaseState();
    state.edgeContracts[0].relationTypeId = undefined;
    state.edgeContracts[0].targetId = 'elsewhere/back.end!';
    const next = applyNodeRefinementResult({
      state,
      task: createOutboundTask(),
      result: splitResult('app-calls-backend', 'run.time!'),
    });
    expect(next.edgeContracts[0].id).toBe('run-time---to--back-end-');
  });
});

describe('type-aware cross-boundary relation inference', () => {
  function candidate(typeId = 'core/software.relations.writes'): NodeRefinementResult {
    return {
      children: [
        {
          localId: 'repo',
          name: 'Repository',
          typeId: 'core/web-app.types.service',
          scope: ['src/repo.ts'],
          evidence: evidence('src/repo.ts'),
          queueDecision: 'leaf',
        },
      ],
      relations: [
        {
          localId: 'child-access',
          typeId,
          fromLocalId: 'repo',
          toLocalId: 'backend',
          evidence: evidence('src/repo.ts'),
        },
      ],
      edgeRefinements: [],
    };
  }
  it.each([
    'outbound',
    'inbound',
  ] as const)('preserves reads while refining writes for %s edges', (direction) => {
    const task = createOutboundTask();
    const source = task.outboundEdges[0];
    task.outboundEdges = [
      { ...source, id: 'p-reads-db', relationTypeId: 'core/software.relations.reads' },
      { ...source, id: 'p-writes-db', relationTypeId: 'core/software.relations.writes' },
    ];
    const result = candidate();
    if (direction === 'inbound') {
      task.inboundEdges = task.outboundEdges.map((edge) => ({
        ...edge,
        sourceId: 'backend',
        targetId: 'app',
        sourceTypeId: edge.targetTypeId,
        targetTypeId: edge.sourceTypeId,
        side: 'ingress',
      }));
      task.outboundEdges = [];
      result.relations[0].fromLocalId = 'backend';
      result.relations[0].toLocalId = 'repo';
    }
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task,
      result,
    });
    expect(normalized.relations).toEqual([]);
    expect(normalized.edgeRefinements).toEqual([
      {
        edgeId: 'p-writes-db',
        relationTypeId: undefined,
        ...(direction === 'outbound' ? { fromChildLocalId: 'repo' } : { toChildLocalId: 'repo' }),
      },
    ]);
    const state = createBaseState();
    state.edgeContracts = [...task.inboundEdges, ...task.outboundEdges];
    const applied = applyNodeRefinementResult({ state, task, result: normalized });
    expect(applied.edgeContracts.find((edge) => edge.id === 'p-reads-db')).toEqual(
      state.edgeContracts[0],
    );
    expect(
      applied.edgeContracts.some(
        (edge) =>
          edge.relationTypeId === 'core/software.relations.writes' &&
          (direction === 'outbound' ? edge.sourceId : edge.targetId) === 'app/repo',
      ),
    ).toBe(true);
  });

  it('allows a type override only when the endpoint match is unique', () => {
    const task = createOutboundTask();
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task,
      result: candidate(),
    });
    expect(normalized.edgeRefinements).toEqual([
      {
        edgeId: task.outboundEdges[0].id,
        relationTypeId: 'core/software.relations.writes',
        fromChildLocalId: 'repo',
      },
    ]);
  });

  it.each([
    'same-type',
    'no-type-match',
  ] as const)('reports candidate handles rather than guessing among %s edges', async (mode) => {
    const task = createOutboundTask();
    task.outboundEdges = ['a', 'b'].map((id) => ({
      ...task.outboundEdges[0],
      id,
      relationTypeId:
        mode === 'same-type' ? 'core/software.relations.writes' : 'core/software.relations.reads',
    }));
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task,
      result: candidate(),
    });
    expect(normalized.edgeRefinements).toEqual([]);
    expect(normalized.relations).toHaveLength(1);
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validated = validateDiagramYaml({
      yaml: 'version: 0.1.0\nschemaRefs:\n  - schema: core/web-app@0.3\n    layer: 0\nentities: []\nrelations: []\n',
      schemaRegistry,
    });
    const diagnostics = validateNodeRefinementSemantics({
      task,
      result: normalized,
      schema: validated.effectiveSchema!,
      semantics: compileSchemaSemantics(validated.effectiveSchema!),
      schemaActivations: [act('core/web-app@0.3')],
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'diagram.node_refinement.ambiguous_inherited_edge',
        severity: 'error',
        details: { candidateHandles: ['out-1', 'out-2'] },
      }),
    );
    expect(shouldRepairNodeRefinementDiagnostics(diagnostics)).toBe(true);
  });
});

it('resumes pending node repairs with the same one-turn allowance without redrafting', async () => {
  const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
  const validation = validateDiagramYaml({
    yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: App
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
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/app.ts
inputs:
  - id: primary
    kind: git
    repo: https://github.com/example/repo
    revision: abc123abc123abc123abc123abc123abc123abcd
    role: primary
`,
    schemaRegistry,
  });
  expect(validation.ok).toBe(true);
  const semantics = compileSchemaSemantics(validation.effectiveSchema!);

  const initialState = createBaseState();
  initialState.queue = [createOutboundTask()];
  initialState.tasksByNodeId = { app: createOutboundTask() };

  const acceptable: NodeRefinementResult = {
    children: [
      {
        localId: 'runtime',
        name: 'Runtime',
        typeId: 'core/web-app.types.service',
        scope: ['src/app.ts'],
        evidence: evidence('src/app.ts'),
        queueDecision: 'leaf',
      },
    ],
    relations: [],
    edgeRefinements: [],
  };
  const invalid: NodeRefinementResult = {
    ...acceptable,
    children: [{ ...acceptable.children[0], typeId: 'missing.type' }],
  };
  const calls: string[] = [];
  const invoke = async (operation: string, result: NodeRefinementResult) => {
    await runCodexPrompt(
      {
        id: 'fake',
        run: async () => {
          calls.push(operation);
          return { finalResponse: '', items: [], usage: null };
        },
      },
      operation,
      { operation },
    );
    return { result, rawResponse: operation, threadId: 'fake' };
  };
  const refiner = { refineNode: vi.fn(() => invoke('draft', invalid)) };
  const repairer = { repairNode: vi.fn(() => invoke('repair', acceptable)) };
  const onCheckpoint = vi.fn();
  let saved: NodeRefinementState | undefined;
  const checkpointRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'node-pending-'));
  const checkpointWorkspace = {
    jobRoot: checkpointRoot,
    targetRepoPath: checkpointRoot,
    schemaRepoPath: checkpointRoot,
    workspaceOutputDir: checkpointRoot,
    repoRevision: 'abc123',
  };
  const onFailure = vi.fn(async ({ state }) => {
    await fs.writeFile(
      path.join(checkpointRoot, 'node-refinement-state.json'),
      JSON.stringify(state),
    );
    saved = await loadNodeRefinementCheckpoint({
      workspace: checkpointWorkspace,
      artifactPath: 'node-refinement-state.json',
    });
  });
  const logger = { ...quietLogger(), warn: vi.fn() };
  const run = (state: NodeRefinementState) =>
    withTurnPolicy(new TurnPolicy(1), () =>
      runNodeRefinement({
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
            totalFiles: 2,
            totalDirectories: 1,
            totalLines: 10,
            languages: { typescript: 10 },
            topLevelPaths: [],
          },
          directories: [],
          manifests: [],
          signals: [],
          files: [],
        },
        areaPlan: {
          repoSummary: 'Test repo',
          initialSchemaActivations: [act('core/web-app@0.3')],
          candidateSchemaRefs: [],
          areas: [],
        },
        baseDoc: validation.document!,
        promptPackage: {
          contract: { schemaCatalog: [] } as never,
          renderedContract: 'Validation-backed contract:',
          metaOntologyMarkdown: '# Meta ontology',
          schemaCatalogJson: '[]',
        },
        logger,
        onCheckpoint,
        onFailure,
        initialState: state,
        refiner,
        repairer,
        getSchemaContext: () => ({
          activeSchemaRefs: [act('core/web-app@0.3')],
          candidateSchemaRefs: [],
          schema: validation.effectiveSchema!,
          semantics,
          schemaFlowCatalog: buildSchemaFlowCatalog({
            schema: validation.effectiveSchema!,
            semantics,
            activeSchemaRefs: [act('core/web-app@0.3')],
          }),
        }),
        validateAppliedState: () => [],
      }),
    );
  await expect(run(initialState)).rejects.toThrow('Stopped after 1 turns');
  expect(calls).toEqual(['draft']);
  expect(saved?.pendingRepair?.repairAttempt).toBe(0);
  await expect(run(saved!)).rejects.toThrow('Stopped after 1 turns');
  expect(calls).toEqual(['draft', 'repair']);
  expect(saved?.pendingRepair?.repairAttempt).toBe(1);
  const completed = await run(saved!);
  expect(calls).toEqual(['draft', 'repair', 'repair']);
  expect(refiner.refineNode).toHaveBeenCalledTimes(1);
  expect(completed.pendingRepair).toBeUndefined();
  expect(completed.refinementsByNodeId.app.children[0].name).toBe('Runtime');
  expect(completed.budgets.turnsUsed).toBe(initialState.budgets.turnsUsed + 3);
  await fs.rm(checkpointRoot, { recursive: true, force: true });
});
