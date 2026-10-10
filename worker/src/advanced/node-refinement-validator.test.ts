import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDefaultSchemaSource } from '../default-assets';
import { buildSchemaActivation, compileSchemaSemantics, validateDiagramYaml } from '../semantic';
import { loadSchemaRegistry } from '../semantic/schema-loader';
import { emptyTokenUsageTotals } from '../token-usage';
import { assembleRefinedDocument } from './node-refinement-engine';
import {
  validateAppliedNodeRefinement,
  validateIntermediateRefinedState,
} from './node-refinement-validator';
import { testGroupSemantics } from './refinement-test-context';
import type { NodeRefinementState, NodeRefinementTask } from './types';

function evidence(path: string, reason = 'Evidence') {
  return [{ path, reason }];
}

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

function createDatastoreStateAndTask(): {
  state: NodeRefinementState;
  task: NodeRefinementTask;
} {
  const task: NodeRefinementTask = {
    nodeId: 'file-storage-boundary',
    nodeTypeId: 'core/web-app.types.datastore',
    nodeName: 'File storage boundary',
    scope: ['storage/index.ts'],
    evidence: evidence('storage/index.ts', 'Storage boundary'),
    depth: 0,
    inboundEdges: [],
    outboundEdges: [],
  };
  return {
    state: {
      rootNodeIds: ['file-storage-boundary'],
      queue: [task],
      tasksByNodeId: {
        'file-storage-boundary': task,
      },
      nodesById: {
        'file-storage-boundary': {
          id: 'file-storage-boundary',
          localId: 'file-storage-boundary',
          name: 'File storage boundary',
          typeId: 'core/web-app.types.datastore',
          scope: ['storage/index.ts'],
          evidence: evidence('storage/index.ts', 'Storage boundary'),
          queueDecision: 'leaf',
        },
      },
      refinementsByNodeId: {},
      edgeContracts: [],
      activeEdgeProposals: [],
      reviewedDepths: [],
      budgets: {
        maxDepth: 8,
        maxTurns: 150,
        maxWorkItems: 256,
        turnsUsed: 0,
        workItemsCreated: 1,
        tokenUsage: emptyTokenUsageTotals(),
      },
    },
    task,
  };
}

describe('validateAppliedNodeRefinement', () => {
  it('allows an empty group child while it is still queued for future expansion', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const primaryDocumentInput = {
      id: 'primary',
      kind: 'git' as const,
      repo: 'https://github.com/example/repo',
      revision: 'abc123abc123abc123abc123abc123abc123abcd',
      role: 'primary' as const,
    };
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: file-storage-boundary
    type: core/web-app.types.datastore
    name: File storage boundary
    provenance:
      locations:
        - input: primary
          path: storage/index.ts
relations: []
`,
      schemaRegistry,
      documentInputs: [primaryDocumentInput],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);
    const { state, task } = createDatastoreStateAndTask();

    const result = await validateAppliedNodeRefinement({
      state,
      task,
      result: {
        children: [
          {
            localId: 'storage-backends',
            name: 'Storage backends',
            typeId: 'core/web-app.types.group',
            scope: ['storage/backends'],
            evidence: evidence('storage/backends.ts', 'Storage backend grouping'),
            queueDecision: 'expand',
            groupMode: 'mixed',
          },
        ],
        relations: [],
        edgeRefinements: [],
      },
      baseDoc: validation.document!,
      schemaContext: {
        activeSchemaRefs: [act('core/web-app@0.3')],
        schema: validation.effectiveSchema!,
        semantics,
      },
      primaryDocumentInput,
    });

    expect(result.nextState.queue.map((queuedTask) => queuedTask.nodeId)).toContain(
      'file-storage-boundary/storage-backends',
    );
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.document.group_like_entity_missing_children',
          entityId: 'file-storage-boundary/storage-backends',
        }),
      ]),
    );
  });

  it('reports an empty group once it is no longer pending expansion', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const primaryDocumentInput = {
      id: 'primary',
      kind: 'git' as const,
      repo: 'https://github.com/example/repo',
      revision: 'abc123abc123abc123abc123abc123abc123abcd',
      role: 'primary' as const,
    };
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: file-storage-boundary
    type: core/web-app.types.datastore
    name: File storage boundary
    provenance:
      locations:
        - input: primary
          path: storage/index.ts
relations: []
`,
      schemaRegistry,
      documentInputs: [primaryDocumentInput],
    });
    expect(validation.ok).toBe(true);
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);
    const { state, task } = createDatastoreStateAndTask();

    const applied = await validateAppliedNodeRefinement({
      state,
      task,
      result: {
        children: [
          {
            localId: 'storage-backends',
            name: 'Storage backends',
            typeId: 'core/web-app.types.group',
            scope: ['storage/backends'],
            evidence: evidence('storage/backends.ts', 'Storage backend grouping'),
            queueDecision: 'expand',
            groupMode: 'mixed',
          },
        ],
        relations: [],
        edgeRefinements: [],
      },
      baseDoc: validation.document!,
      schemaContext: {
        activeSchemaRefs: [act('core/web-app@0.3')],
        schema: validation.effectiveSchema!,
        semantics,
      },
      primaryDocumentInput,
    });

    const stalledState: NodeRefinementState = {
      ...applied.nextState,
      queue: [],
    };
    const stalledDoc = {
      ...assembleRefinedDocument({
        semantics: testGroupSemantics,
        baseDoc: validation.document!,
        state: stalledState,
      }),
      schemaRefs: [act('core/web-app@0.3')],
    };

    const diagnostics = validateIntermediateRefinedState({
      state: stalledState,
      assembledDoc: stalledDoc,
      schemaContext: {
        schema: validation.effectiveSchema!,
        semantics,
      },
      primaryDocumentInput,
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.document.group_like_entity_missing_children',
          entityId: 'file-storage-boundary/storage-backends',
        }),
      ]),
    );
  });
});
