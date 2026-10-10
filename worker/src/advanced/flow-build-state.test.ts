import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type SchemaModule, type SemanticDocument, validateDiagramYaml } from '../semantic';
import { loadSchemaRegistry } from '../semantic/schema-loader';
import {
  buildContinuationAttemptMap,
  buildFlowBuildState,
  buildFlowRepairDiagnostics,
  serializeFlowBuildStateArtifact,
} from './flow-build-state';

const repoPath = (...segments: string[]) => path.resolve(process.cwd(), '..', ...segments);

describe('flow build state', () => {
  it('tracks unresolved flow, may-terminate retries, and descendant edge bindings', async () => {
    const schemaRegistry = await loadSchemaRegistry(repoPath('frontend'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/frontend@0.3
    layer: 0
entities:
  - id: frontend
    type: core/frontend.types.frontend
    provenance:
      locations:
        - input: primary
          path: src/frontend.tsx
  - id: backend
    type: core/web-app.types.api
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
`;
    const validation = validateDiagramYaml({
      yaml,
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
    expect(validation.document).toBeDefined();
    expect(validation.effectiveSchema).toBeDefined();

    const expectations = [
      {
        id: 'edge-1',
        kind: 'calls',
        summary: 'Frontend calls backend',
        confidence: 'high' as const,
        evidence: [{ path: 'src/frontend.tsx', reason: 'Fetch call' }],
        source: {
          responsibilityId: 'frontend',
          status: 'proposed' as const,
          proposal: {
            ownerLocalId: 'app',
            specificity: 'actor' as const,
            depth: 1,
            confidence: 'high' as const,
            rationale: 'Frontend app owns the call.',
            evidence: [{ path: 'src/frontend.tsx', reason: 'Fetch call' }],
          },
        },
        target: {
          responsibilityId: 'backend',
          status: 'proposed' as const,
          proposal: {
            ownerLocalId: 'api',
            specificity: 'actor' as const,
            depth: 1,
            confidence: 'high' as const,
            rationale: 'Backend API receives the call.',
            evidence: [{ path: 'src/backend.ts', reason: 'Route handler' }],
          },
        },
        status: 'matched' as const,
        history: [],
      },
    ];

    const firstPass = buildFlowBuildState({
      level0Doc: validation.document!,
      effectiveSchema: validation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['frontend', 'backend'],
      expectations,
    });

    expect(firstPass.state.visibleResponsibilityIds).toEqual(['backend', 'frontend']);
    expect(firstPass.state.activeFrontier).toEqual([
      expect.objectContaining({
        entityId: 'backend',
        side: 'egress',
        mayTerminate: true,
      }),
    ]);
    expect(firstPass.state.edgeBindings).toEqual([
      expect.objectContaining({
        level0EdgeId: 'edge-1',
        endpoint: 'from',
        localId: 'app',
      }),
      expect.objectContaining({
        level0EdgeId: 'edge-1',
        endpoint: 'to',
        localId: 'api',
      }),
    ]);

    const secondPass = buildFlowBuildState({
      level0Doc: validation.document!,
      effectiveSchema: validation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['frontend', 'backend'],
      expectations,
      continuationAttempts: buildContinuationAttemptMap(new Map(), firstPass.state.activeFrontier),
    });

    expect(secondPass.state.activeFrontier).toEqual([]);
    expect(secondPass.state.terminatedNodes).toEqual([
      expect.objectContaining({
        entityId: 'backend',
        side: 'egress',
        reason: 'boundary',
      }),
    ]);

    expect(serializeFlowBuildStateArtifact(secondPass.state)).toEqual(
      expect.objectContaining({
        level0EdgeIds: ['edge-1'],
        visibleResponsibilityIds: ['backend', 'frontend'],
      }),
    );
  });

  it('flags disconnected top-level grouping nodes for level-0 repair', async () => {
    const schemaRegistry = await loadSchemaRegistry(repoPath('frontend'));
    const yaml = `version: 0.1.0
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
`;
    const validation = validateDiagramYaml({
      yaml,
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

    const analyzed = buildFlowBuildState({
      level0Doc: validation.document!,
      effectiveSchema: validation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['plugin-integrations'],
    });

    const diagnostics = buildFlowRepairDiagnostics({
      flowBuildState: analyzed.state,
      analysis: analyzed.analysis,
      effectiveSchema: validation.effectiveSchema!,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.disconnected_top_level_group',
          entityId: 'plugin-integrations',
          severity: 'error',
        }),
      ]),
    );
  });

  it('flags disconnected preferred top-level boundaries that have no flow semantics', () => {
    const effectiveSchema: SchemaModule = {
      owner: 'core',
      name: 'test',
      version: '0.1',
      traits: [],
      types: [
        {
          id: 'core/test.types.app-wrapper',
          label: 'App Wrapper',
          analysis: {
            topLevelBias: 'prefer',
          },
        },
      ],
      relations: [],
    };
    const document: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [],
      entities: [
        {
          id: 'app-wrapper',
          type: 'core/test.types.app-wrapper',
        },
      ],
      relations: [],
    };

    const analyzed = buildFlowBuildState({
      level0Doc: document,
      effectiveSchema,
      repoOwnedResponsibilityIds: ['app-wrapper'],
    });

    const diagnostics = buildFlowRepairDiagnostics({
      flowBuildState: analyzed.state,
      analysis: analyzed.analysis,
      effectiveSchema,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.disconnected_top_level_boundary',
          entityId: 'app-wrapper',
          severity: 'error',
        }),
      ]),
    );
  });

  it('requires queueing boundaries to have publisher and subscriber flow', async () => {
    const schemaRegistry = await loadSchemaRegistry(repoPath('frontend'));
    const disconnectedYaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: jobs
    type: core/web-app.types.queue
relations: []
`;
    const disconnectedValidation = validateDiagramYaml({
      yaml: disconnectedYaml,
      schemaRegistry,
    });
    expect(disconnectedValidation.ok).toBe(true);

    const disconnected = buildFlowBuildState({
      level0Doc: disconnectedValidation.document!,
      effectiveSchema: disconnectedValidation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['jobs'],
    });

    expect(disconnected.state.activeFrontier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: 'jobs', side: 'ingress' }),
        expect.objectContaining({ entityId: 'jobs', side: 'egress' }),
      ]),
    );
    expect(
      buildFlowRepairDiagnostics({
        flowBuildState: disconnected.state,
        analysis: disconnected.analysis,
        effectiveSchema: disconnectedValidation.effectiveSchema!,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.missing_expected_relations',
          entityId: 'jobs',
          details: {
            expectedRelationIds: [
              'core/software.relations.consumes-from',
              'core/software.relations.publishes-to',
            ],
          },
        }),
      ]),
    );

    const connectedYaml = `version: 0.1.0
schemaRefs:
  - schema: core/frontend@0.3
    layer: 0
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: publisher
    type: core/frontend.types.frontend
  - id: worker-subscription
    type: core/web-app.types.subscription
  - id: jobs
    type: core/web-app.types.queue
relations:
  - id: publisher-publishes-jobs
    type: core/software.relations.publishes-to
    from: publisher
    to: jobs
  - id: worker-consumes-jobs
    type: core/software.relations.consumes-from
    from: worker-subscription
    to: jobs
`;
    const connectedValidation = validateDiagramYaml({
      yaml: connectedYaml,
      schemaRegistry,
    });
    expect(connectedValidation.ok).toBe(true);

    const connected = buildFlowBuildState({
      level0Doc: connectedValidation.document!,
      effectiveSchema: connectedValidation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['jobs'],
    });
    const queueAnalysis = connected.analysis.entitiesById.get('jobs');

    expect(queueAnalysis?.expectations).toMatchObject({
      expectsIngress: true,
      expectsEgress: true,
      flowRole: 'through',
    });
    expect(queueAnalysis?.fulfillment).toMatchObject({
      status: 'fulfilled',
      missingExpectedRelationIds: [],
    });
    expect(connected.state.activeFrontier).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ entityId: 'jobs' })]),
    );
  });

  it('requires topics to have publisher and subscriber flow', async () => {
    const schemaRegistry = await loadSchemaRegistry(repoPath('frontend'));
    const publishOnlyYaml = `version: 0.1.0
schemaRefs:
  - schema: core/frontend@0.3
    layer: 0
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: publisher
    type: core/frontend.types.frontend
  - id: events
    type: core/web-app.types.topic
relations:
  - id: publisher-publishes-events
    type: core/software.relations.publishes-to
    from: publisher
    to: events
`;
    const publishOnlyValidation = validateDiagramYaml({
      yaml: publishOnlyYaml,
      schemaRegistry,
    });
    expect(publishOnlyValidation.ok).toBe(true);

    const publishOnly = buildFlowBuildState({
      level0Doc: publishOnlyValidation.document!,
      effectiveSchema: publishOnlyValidation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['events'],
    });
    const publishOnlyTopic = publishOnly.analysis.entitiesById.get('events');

    expect(publishOnlyTopic?.expectations).toMatchObject({
      expectsIngress: true,
      expectsEgress: true,
      mayTerminate: false,
      flowRole: 'through',
    });
    expect(publishOnly.state.activeFrontier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: 'events', side: 'egress', mayTerminate: false }),
      ]),
    );
    expect(
      buildFlowRepairDiagnostics({
        flowBuildState: publishOnly.state,
        analysis: publishOnly.analysis,
        effectiveSchema: publishOnlyValidation.effectiveSchema!,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.missing_expected_relations',
          entityId: 'events',
          details: {
            expectedRelationIds: ['core/software.relations.consumes-from'],
          },
        }),
      ]),
    );

    const consumeOnlyYaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: worker-subscription
    type: core/web-app.types.subscription
  - id: events
    type: core/web-app.types.topic
relations:
  - id: worker-consumes-events
    type: core/software.relations.consumes-from
    from: worker-subscription
    to: events
`;
    const consumeOnlyValidation = validateDiagramYaml({
      yaml: consumeOnlyYaml,
      schemaRegistry,
    });
    expect(consumeOnlyValidation.ok).toBe(true);

    const consumeOnly = buildFlowBuildState({
      level0Doc: consumeOnlyValidation.document!,
      effectiveSchema: consumeOnlyValidation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['events'],
    });

    expect(consumeOnly.state.activeFrontier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: 'events', side: 'ingress', mayTerminate: false }),
      ]),
    );
    expect(
      buildFlowRepairDiagnostics({
        flowBuildState: consumeOnly.state,
        analysis: consumeOnly.analysis,
        effectiveSchema: consumeOnlyValidation.effectiveSchema!,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.missing_expected_relations',
          entityId: 'events',
          details: {
            expectedRelationIds: ['core/software.relations.publishes-to'],
          },
        }),
      ]),
    );

    const connectedYaml = `version: 0.1.0
schemaRefs:
  - schema: core/frontend@0.3
    layer: 0
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: publisher
    type: core/frontend.types.frontend
  - id: worker-subscription
    type: core/web-app.types.subscription
  - id: events
    type: core/web-app.types.topic
relations:
  - id: publisher-publishes-events
    type: core/software.relations.publishes-to
    from: publisher
    to: events
  - id: worker-consumes-events
    type: core/software.relations.consumes-from
    from: worker-subscription
    to: events
`;
    const connectedValidation = validateDiagramYaml({
      yaml: connectedYaml,
      schemaRegistry,
    });
    expect(connectedValidation.ok).toBe(true);

    const connected = buildFlowBuildState({
      level0Doc: connectedValidation.document!,
      effectiveSchema: connectedValidation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['events'],
    });
    const connectedTopic = connected.analysis.entitiesById.get('events');

    expect(connectedTopic?.fulfillment).toMatchObject({
      status: 'fulfilled',
      missingExpectedRelationIds: [],
    });
    expect(connected.state.activeFrontier).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ entityId: 'events' })]),
    );
  });

  it('treats ingress on a direct child sink as satisfying the refined parent sink boundary', async () => {
    const schemaRegistry = await loadSchemaRegistry(repoPath('frontend'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/data-model@0.3
    layer: 0
entities:
  - id: worker
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: server/worker.ts
  - id: primary-store
    type: core/web-app.types.relational-db
    provenance:
      locations:
        - input: primary
          path: server/storage/index.ts
    children:
      - id: primary-store/users
        type: core/data-model.types.table
        name: users
        provenance:
          locations:
            - input: primary
              path: server/storage/users.ts
relations:
  - id: worker-writes-store
    type: core/software.relations.writes
    from: worker
    to: primary-store/users
    provenance:
      locations:
        - input: primary
          path: server/worker.ts
`;
    const validation = validateDiagramYaml({
      yaml,
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

    const analyzed = buildFlowBuildState({
      level0Doc: validation.document!,
      effectiveSchema: validation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['worker', 'primary-store'],
    });

    const diagnostics = buildFlowRepairDiagnostics({
      flowBuildState: analyzed.state,
      analysis: analyzed.analysis,
      effectiveSchema: validation.effectiveSchema!,
    });

    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.unresolved_ingress',
          entityId: 'primary-store',
        }),
      ]),
    );
    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.refined_sink_parent_ingress_not_internalized',
          entityId: 'primary-store',
        }),
      ]),
    );
  });

  it('warns when a refined sink does not preserve a direct child sink', async () => {
    const schemaRegistry = await loadSchemaRegistry(repoPath('frontend'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: worker
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: server/worker.ts
  - id: primary-store
    type: core/web-app.types.relational-db
    provenance:
      locations:
        - input: primary
          path: server/storage/index.ts
    children:
      - id: primary-store/storage-group
        type: core/web-app.types.group
        props:
          mode: mixed
        provenance:
          locations:
            - input: primary
              path: server/storage/group.ts
relations:
  - id: worker-writes-store
    type: core/software.relations.writes
    from: worker
    to: primary-store
    provenance:
      locations:
        - input: primary
          path: server/worker.ts
`;
    const validation = validateDiagramYaml({
      yaml,
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

    const analyzed = buildFlowBuildState({
      level0Doc: validation.document!,
      effectiveSchema: validation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['worker', 'primary-store'],
    });

    const diagnostics = buildFlowRepairDiagnostics({
      flowBuildState: analyzed.state,
      analysis: analyzed.analysis,
      effectiveSchema: validation.effectiveSchema!,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.refined_sink_without_child_sink',
          entityId: 'primary-store',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('warns when a refined sink keeps external ingress on the parent despite a child sink', async () => {
    const schemaRegistry = await loadSchemaRegistry(repoPath('frontend'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/data-model@0.3
    layer: 0
entities:
  - id: worker
    type: core/web-app.types.service
    provenance:
      locations:
        - input: primary
          path: server/worker.ts
  - id: primary-store
    type: core/web-app.types.relational-db
    provenance:
      locations:
        - input: primary
          path: server/storage/index.ts
    children:
      - id: primary-store/users
        type: core/data-model.types.table
        name: users
        provenance:
          locations:
            - input: primary
              path: server/storage/users.ts
relations:
  - id: worker-writes-store
    type: core/software.relations.writes
    from: worker
    to: primary-store
    provenance:
      locations:
        - input: primary
          path: server/worker.ts
`;
    const validation = validateDiagramYaml({
      yaml,
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

    const analyzed = buildFlowBuildState({
      level0Doc: validation.document!,
      effectiveSchema: validation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['worker', 'primary-store'],
    });

    const diagnostics = buildFlowRepairDiagnostics({
      flowBuildState: analyzed.state,
      analysis: analyzed.analysis,
      effectiveSchema: validation.effectiveSchema!,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.refined_sink_parent_ingress_not_internalized',
          entityId: 'primary-store',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('warns when a refined source does not preserve a direct child source', async () => {
    const schemaRegistry = await loadSchemaRegistry(repoPath('frontend'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/frontend@0.3
    layer: 0
entities:
  - id: frontend
    type: core/frontend.types.frontend
    provenance:
      locations:
        - input: primary
          path: app/frontend.tsx
    children:
      - id: frontend/ui
        type: core/web-app.types.group
        props:
          mode: mixed
        provenance:
          locations:
            - input: primary
              path: app/ui/index.tsx
  - id: backend
    type: core/web-app.types.api
    provenance:
      locations:
        - input: primary
          path: server/api.ts
relations:
  - id: frontend-calls-backend
    type: core/software.relations.calls
    from: frontend
    to: backend
    provenance:
      locations:
        - input: primary
          path: app/frontend.tsx
`;
    const validation = validateDiagramYaml({
      yaml,
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

    const analyzed = buildFlowBuildState({
      level0Doc: validation.document!,
      effectiveSchema: validation.effectiveSchema!,
      repoOwnedResponsibilityIds: ['frontend', 'backend'],
    });

    const diagnostics = buildFlowRepairDiagnostics({
      flowBuildState: analyzed.state,
      analysis: analyzed.analysis,
      effectiveSchema: validation.effectiveSchema!,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.flow.refined_source_without_child_source',
          entityId: 'frontend',
          severity: 'warning',
        }),
      ]),
    );
  });
});
