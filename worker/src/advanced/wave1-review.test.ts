import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileSchemaSemantics,
  parseDocument,
  serializeDocument,
  validateDiagramYaml,
} from '../semantic';
import { loadSchemaRegistry } from '../semantic/schema-loader';
import {
  applyNodeRefinementResult,
  buildInitialNodeRefinementState,
} from './node-refinement-engine';
import { testGroupSemantics } from './refinement-test-context';
import {
  applyWave1ReviewPatch,
  parseWave1ReviewPatchResponse,
  validateWave1ReviewPatchContract,
} from './wave1-review';

function evidence(path: string, reason = 'Evidence') {
  return [{ path, reason }];
}

function createLevel0Doc() {
  return parseDocument(`version: 0.1.0
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
    type: core/web-app.types.service
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
`);
}

function createAreaPlan() {
  return {
    repoSummary: 'Test repo',
    initialSchemaActivations: [],
    candidateSchemaRefs: [],
    areas: [],
  };
}

const repoPath = (...segments: string[]) => path.resolve(process.cwd(), '..', ...segments);

async function loadSchemaContextFor(level0Doc: ReturnType<typeof createLevel0Doc>) {
  const schemaRegistry = await loadSchemaRegistry(repoPath('frontend'));
  const validation = validateDiagramYaml({
    yaml: serializeDocument(level0Doc),
    schemaRegistry,
  });
  expect(validation.effectiveSchema).toBeDefined();
  expect(validation.document).toBeDefined();
  return {
    activeSchemaRefs: validation.document!.schemaRefs,
    schema: validation.effectiveSchema!,
    semantics: compileSchemaSemantics(validation.effectiveSchema!),
  };
}

describe('wave1-review', () => {
  it('rebuilds first-level queue ownership when a child moves across roots', () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });

    let state = applyNodeRefinementResult({
      state: initialState,
      task: initialState.tasksByNodeId.app!,
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'App runtime',
            typeId: 'core/web-app.types.service',
            scope: ['src/app.ts'],
            evidence: evidence('src/app.ts', 'Runtime'),
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
      },
    });

    state = applyNodeRefinementResult({
      state,
      task: initialState.tasksByNodeId.backend!,
      result: {
        children: [],
        relations: [],
        edgeRefinements: [],
      },
    });

    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: state,
      patch: {
        rootEdits: [
          {
            rootId: 'app',
            refinement: {
              children: [],
              relations: [],
              edgeRefinements: [],
            },
          },
          {
            rootId: 'backend',
            refinement: {
              children: [
                {
                  localId: 'runtime',
                  name: 'Backend runtime',
                  typeId: 'core/web-app.types.service',
                  scope: ['src/backend.ts'],
                  evidence: evidence('src/backend.ts', 'Runtime'),
                  queueDecision: 'expand',
                },
              ],
              relations: [],
              edgeRefinements: [
                {
                  edgeId: 'app-calls-backend',
                  toChildLocalId: 'runtime',
                },
              ],
            },
          },
        ],
      },
    });

    expect(reviewed.rebuiltState.nodesById['backend/runtime']).toBeDefined();
    expect(reviewed.rebuiltState.nodesById['app/runtime']).toBeUndefined();
    expect(reviewed.rebuiltState.queue.map((task) => task.nodeId)).toEqual(['backend/runtime']);
    expect(reviewed.rebuiltState.tasksByNodeId['backend/runtime']).toEqual(
      expect.objectContaining({
        nodeId: 'backend/runtime',
        parentNodeId: 'backend',
      }),
    );
    expect(reviewed.rebuiltState.reviewedDepths).toContain(1);
  });

  it('preserves group control metadata when wave-1 emits semantic group props', () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });

    const patch = parseWave1ReviewPatchResponse(
      JSON.stringify({
        rootEdits: [
          {
            rootId: 'app',
            refinement: {
              children: [
                {
                  localId: 'api-family',
                  name: 'API Family',
                  typeId: 'core/web-app.types.group',
                  props: {
                    mode: 'typed',
                    groupType: 'core/web-app.types.api',
                  },
                  scope: ['src/api'],
                  evidence: evidence('src/api/index.ts', 'API route family'),
                  queueDecision: 'expand',
                },
              ],
              relations: [],
              edgeRefinements: [],
            },
          },
        ],
      }),
    );

    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: initialState,
      patch,
    });

    expect(reviewed.rebuiltState.nodesById['app/api-family']).toEqual(
      expect.objectContaining({
        groupMode: 'typed',
        groupTypeId: 'core/web-app.types.api',
      }),
    );
    expect(reviewed.rebuiltState.tasksByNodeId['app/api-family']).toEqual(
      expect.objectContaining({
        groupMode: 'typed',
        groupTypeId: 'core/web-app.types.api',
      }),
    );
  });

  it('preserves proposals and rebuilds depth-1 task edges after visible relation edits', () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });

    let state = applyNodeRefinementResult({
      state: initialState,
      task: initialState.tasksByNodeId.app!,
      result: {
        children: [
          {
            localId: 'runtime',
            name: 'App runtime',
            typeId: 'core/web-app.types.service',
            scope: ['src/app.ts'],
            evidence: evidence('src/app.ts', 'Runtime'),
            queueDecision: 'expand',
          },
        ],
        relations: [],
        edgeRefinements: [],
        edgeProposals: [
          {
            edgeId: 'app-calls-backend',
            endpoint: 'from',
            childLocalId: 'runtime',
          },
        ],
      },
    });

    state = applyNodeRefinementResult({
      state,
      task: initialState.tasksByNodeId.backend!,
      result: {
        children: [],
        relations: [],
        edgeRefinements: [],
      },
    });

    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: state,
      patch: {
        addVisibleRelations: [
          {
            id: 'runtime-calls-backend',
            typeId: 'core/software.relations.calls',
            fromId: 'app/runtime',
            toId: 'backend',
            evidence: evidence('src/app.ts', 'Runtime calls backend'),
          },
        ],
      },
    });

    expect(reviewed.rebuiltState.activeEdgeProposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeId: 'app-calls-backend',
          childId: 'app/runtime',
          ownerNodeId: 'app',
        }),
      ]),
    );
    expect(reviewed.rebuiltState.tasksByNodeId['app/runtime']?.outboundEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'runtime-calls-backend',
          sourceId: 'app/runtime',
          targetId: 'backend',
        }),
      ]),
    );
  });

  it('preserves omitted refinement arrays when a wave-1 root edit updates children', () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });

    let state = applyNodeRefinementResult({
      state: initialState,
      task: initialState.tasksByNodeId.app!,
      result: {
        children: [
          {
            localId: 'client',
            name: 'Client',
            typeId: 'core/web-app.types.service',
            scope: ['src/app.ts'],
            evidence: evidence('src/app.ts', 'Client'),
            queueDecision: 'leaf',
          },
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.service',
            scope: ['src/app.ts'],
            evidence: evidence('src/app.ts', 'Runtime'),
            queueDecision: 'expand',
          },
        ],
        relations: [
          {
            localId: 'client-calls-runtime',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'client',
            toLocalId: 'runtime',
            evidence: evidence('src/app.ts', 'Client calls runtime'),
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

    state = applyNodeRefinementResult({
      state,
      task: initialState.tasksByNodeId.backend!,
      result: {
        children: [],
        relations: [],
        edgeRefinements: [],
      },
    });

    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: state,
      patch: {
        rootEdits: [
          {
            rootId: 'app',
            refinement: {
              description: 'Reviewed app split.',
              children: [
                {
                  localId: 'client',
                  name: 'Client API',
                  typeId: 'core/web-app.types.service',
                  scope: ['src/app.ts'],
                  evidence: evidence('src/app.ts', 'Client'),
                  queueDecision: 'leaf',
                },
                {
                  localId: 'runtime',
                  name: 'Runtime',
                  typeId: 'core/web-app.types.service',
                  scope: ['src/app.ts'],
                  evidence: evidence('src/app.ts', 'Runtime'),
                  queueDecision: 'expand',
                },
              ],
            },
          },
        ],
      },
    });

    expect(reviewed.rebuiltState.refinementsByNodeId.app?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'calls--client--to--runtime',
          sourceId: 'app/client',
          targetId: 'app/runtime',
        }),
      ]),
    );
    expect(reviewed.rebuiltState.refinementsByNodeId.app?.edgeRefinements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeId: 'app-calls-backend',
          sourceId: 'app/runtime',
          targetId: 'backend',
        }),
      ]),
    );
    expect(reviewed.rebuiltState.tasksByNodeId['app/runtime']?.inboundEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'calls--client--to--runtime',
          sourceId: 'app/client',
          targetId: 'app/runtime',
        }),
      ]),
    );
    expect(reviewed.rebuiltState.tasksByNodeId['app/runtime']?.outboundEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'app-calls-backend',
          sourceId: 'app/runtime',
          targetId: 'backend',
        }),
      ]),
    );
  });

  it('treats explicitly empty refinement arrays as replacement clears', () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });

    let state = applyNodeRefinementResult({
      state: initialState,
      task: initialState.tasksByNodeId.app!,
      result: {
        children: [
          {
            localId: 'client',
            name: 'Client',
            typeId: 'core/web-app.types.service',
            scope: ['src/app.ts'],
            evidence: evidence('src/app.ts', 'Client'),
            queueDecision: 'leaf',
          },
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/web-app.types.service',
            scope: ['src/app.ts'],
            evidence: evidence('src/app.ts', 'Runtime'),
            queueDecision: 'expand',
          },
        ],
        relations: [
          {
            localId: 'client-calls-runtime',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'client',
            toLocalId: 'runtime',
            evidence: evidence('src/app.ts', 'Client calls runtime'),
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

    state = applyNodeRefinementResult({
      state,
      task: initialState.tasksByNodeId.backend!,
      result: {
        children: [],
        relations: [],
        edgeRefinements: [],
      },
    });

    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: state,
      patch: {
        rootEdits: [
          {
            rootId: 'app',
            refinement: {
              relations: [],
              edgeRefinements: [],
            },
          },
        ],
      },
    });

    expect(
      reviewed.rebuiltState.refinementsByNodeId.app?.children.map((child) => child.id),
    ).toEqual(['app/client', 'app/runtime']);
    expect(reviewed.rebuiltState.refinementsByNodeId.app?.relations).toEqual([]);
    expect(reviewed.rebuiltState.refinementsByNodeId.app?.edgeRefinements).toEqual([]);
    expect(reviewed.rebuiltState.tasksByNodeId['app/runtime']?.inboundEdges).toEqual([]);
    expect(reviewed.rebuiltState.tasksByNodeId['app/runtime']?.outboundEdges).toEqual([]);
  });

  it('normalizes inherited edge orientation while replaying wave-1 refinements', () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });

    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: initialState,
      patch: {
        rootEdits: [
          {
            rootId: 'backend',
            refinement: {
              children: [
                {
                  localId: 'runtime',
                  name: 'Backend Runtime',
                  typeId: 'core/web-app.types.service',
                  scope: ['src/backend.ts'],
                  evidence: evidence('src/backend.ts', 'Runtime'),
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
            },
          },
        ],
      },
    });

    expect(reviewed.rebuiltState.refinementsByNodeId.backend?.edgeRefinements).toEqual([
      expect.objectContaining({
        edgeId: 'app-calls-backend',
        sourceId: 'app',
        targetId: 'backend/runtime',
      }),
    ]);
    expect(reviewed.wave1Document.relations).toEqual([
      expect.objectContaining({
        id: 'app-calls-backend',
        from: 'app',
        to: 'backend/runtime',
      }),
    ]);
  });

  it('ignores empty root relation replacement and preserves level-0 edges', () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });

    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: initialState,
      patch: {
        replaceRootRelations: [],
      },
    });

    expect(reviewed.reviewedLevel0Doc.relations.map((relation) => relation.id)).toEqual([
      'app-calls-backend',
    ]);
    expect(reviewed.rebuiltState.edgeContracts.map((edge) => edge.id)).toContain(
      'app-calls-backend',
    );
  });

  it('reports edited root refinements that create leaf group children', async () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });
    const patch = {
      rootEdits: [
        {
          rootId: 'app',
          refinement: {
            children: [
              {
                localId: 'feature-groups',
                name: 'Feature Groups',
                typeId: 'core/web-app.types.group',
                scope: ['src/app.ts'],
                evidence: evidence('src/app.ts', 'Grouping app features'),
                queueDecision: 'leaf' as const,
              },
            ],
            relations: [],
            edgeRefinements: [],
          },
        },
      ],
    };
    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: initialState,
      patch,
    });
    const diagnostics = validateWave1ReviewPatchContract({
      patch,
      previousState: initialState,
      rebuiltState: reviewed.rebuiltState,
      schemaContext: await loadSchemaContextFor(level0Doc),
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.leaf_group_child',
          entityId: 'app',
          targetId: 'feature-groups',
        }),
      ]),
    );
  });

  it('reports visible relation endpoints that target non-wave-1 descendants', async () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });
    const patch = {
      addVisibleRelations: [
        {
          id: 'deep-runtime-calls-backend',
          typeId: 'core/software.relations.calls',
          fromId: 'app/runtime/handler',
          toId: 'backend',
          evidence: evidence('src/app.ts', 'Too deep for wave 1'),
        },
      ],
    };
    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: initialState,
      patch,
    });
    const diagnostics = validateWave1ReviewPatchContract({
      patch,
      previousState: initialState,
      rebuiltState: reviewed.rebuiltState,
      schemaContext: await loadSchemaContextFor(level0Doc),
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.wave1_review.relation_endpoint_too_deep',
          relationId: 'deep-runtime-calls-backend',
          targetId: 'app/runtime/handler',
        }),
        expect.objectContaining({
          code: 'diagram.wave1_review.relation_endpoint_not_visible',
          relationId: 'deep-runtime-calls-backend',
          targetId: 'app/runtime/handler',
        }),
      ]),
    );
  });

  it('parses a bounded wave-1 patch response from JSON', () => {
    const patch = parseWave1ReviewPatchResponse(`{
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
            "edgeRefinements": []
          }
        }
      ],
      "removeVisibleRelationIds": ["old-edge"]
    }`);

    expect(patch.rootEdits?.[0]?.rootId).toBe('app');
    expect(patch.rootEdits?.[0]?.refinement?.children?.[0]?.localId).toBe('runtime');
    expect(patch.removeVisibleRelationIds).toEqual(['old-edge']);
  });

  it('parses omitted refinement arrays as absent patch fields', () => {
    const patch = parseWave1ReviewPatchResponse(`{
      "rootEdits": [
        {
          "rootId": "app",
          "refinement": {
            "description": "Only updating description"
          }
        }
      ]
    }`);

    const refinement = patch.rootEdits?.[0]?.refinement;
    expect(refinement?.description).toBe('Only updating description');
    expect(refinement && 'children' in refinement).toBe(false);
    expect(refinement && 'relations' in refinement).toBe(false);
    expect(refinement && 'edgeRefinements' in refinement).toBe(false);
  });

  it('parses empty root relation replacement as an omitted patch field', () => {
    const patch = parseWave1ReviewPatchResponse(`{
      "replaceRootRelations": [],
      "addVisibleRelations": []
    }`);

    expect('replaceRootRelations' in patch).toBe(false);
    expect(patch.addVisibleRelations).toEqual([]);
  });
});

describe('compact edge ID review round-trip', () => {
  it('reapplies existing splits and internal relations with identical IDs', () => {
    const level0Doc = createLevel0Doc();
    const areaPlan = createAreaPlan();
    const initialState = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      maxDepth: 8,
    });
    const state = applyNodeRefinementResult({
      state: initialState,
      task: initialState.tasksByNodeId.app!,
      result: {
        children: ['runtime', 'client'].map((localId) => ({
          localId,
          name: localId,
          typeId: 'core/web-app.types.service',
          scope: [],
          evidence: [],
          queueDecision: 'leaf' as const,
        })),
        relations: [
          {
            localId: 'original-model-local-id',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'client',
            toLocalId: 'runtime',
            evidence: [],
          },
        ],
        edgeRefinements: ['runtime', 'client'].map((fromChildLocalId) => ({
          edgeId: 'app-calls-backend',
          fromChildLocalId,
        })),
      },
    });
    const reviewed = applyWave1ReviewPatch({
      semantics: testGroupSemantics,
      level0Doc,
      areaPlan,
      visibleResponsibilityIds: ['app', 'backend'],
      previousState: state,
      patch: { rootEdits: [] },
    });
    expect(state.refinementsByNodeId.app.relations[0].id).toBe('calls--client--to--runtime');
    expect(reviewed.rebuiltState.edgeContracts.map((edge) => edge.id)).toEqual(
      state.edgeContracts.map((edge) => edge.id),
    );
    expect(reviewed.rebuiltState.refinementsByNodeId.app.relations).toEqual(
      state.refinementsByNodeId.app.relations,
    );
  });
});
