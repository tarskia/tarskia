import { describe, expect, it } from 'vitest';
import { parseNodeRefinementResponse, validateNodeRefinementResultShape } from './node-refinement';
import { formatWithEdgeHandles } from './node-refinement-edge-handles';
import { normalizeEdgeRefinementOrientation } from './node-refinement-engine';
import { testGroupSemantics } from './refinement-test-context';
import type { NodeRefinementTask } from './types';

describe('parseNodeRefinementResponse', () => {
  it('parses short descriptions for the parent, children, and relations', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        description: 'Primary request runtime.',
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            description: 'Core execution path.',
            typeId: 'core/code.types.module',
            scope: ['src/runtime.ts'],
            evidence: [{ path: 'src/runtime.ts', reason: 'Entrypoint' }],
            queueDecision: 'leaf',
          },
        ],
        relations: [
          {
            localId: 'runtime-calls-storage',
            typeId: 'core/software.relations.calls',
            description: 'Persists through the storage adapter.',
            fromLocalId: 'runtime',
            toLocalId: 'runtime',
            evidence: [{ path: 'src/runtime.ts', reason: 'Call path' }],
          },
        ],
        edgeRefinements: [],
      }),
    );

    expect(result.description).toBe('Primary request runtime.');
    expect(result.children[0]?.description).toBe('Core execution path.');
    expect(result.relations[0]?.description).toBe('Persists through the storage adapter.');
  });

  it('preserves child props from the model response', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/code.types.module',
            props: {
              language: 'typescript',
            },
            scope: ['src/runtime.ts'],
            evidence: [{ path: 'src/runtime.ts', reason: 'Entrypoint' }],
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [],
      }),
    );

    expect(result.children[0]?.props).toEqual({
      language: 'typescript',
    });
  });

  it('derives group control metadata from semantic group props', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
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
            evidence: [{ path: 'src/api/index.ts', reason: 'API route family' }],
            queueDecision: 'expand',
          },
        ],
        relations: [],
        edgeRefinements: [],
      }),
    );

    expect(result.children[0]).toEqual(
      expect.objectContaining({
        groupMode: 'typed',
        groupTypeId: 'core/web-app.types.api',
      }),
    );
  });

  it('deduplicates identical edge refinements', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/code.types.module',
            scope: ['src/runtime.ts'],
            evidence: [{ path: 'src/runtime.ts', reason: 'Entrypoint' }],
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
            fromChildLocalId: 'runtime',
          },
        ],
      }),
    );

    expect(result.edgeRefinements).toEqual([
      {
        edgeId: 'app-calls-backend',
        fromChildLocalId: 'runtime',
      },
    ]);
  });

  it('keeps distinct edge refinements when only the refined relation type changes', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/code.types.module',
            scope: ['src/runtime.ts'],
            evidence: [{ path: 'src/runtime.ts', reason: 'Entrypoint' }],
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [
          {
            edgeId: 'app-calls-backend',
            relationTypeId: 'core/software.relations.calls',
            fromChildLocalId: 'runtime',
          },
          {
            edgeId: 'app-calls-backend',
            relationTypeId: 'core/software.relations.reads',
            fromChildLocalId: 'runtime',
          },
        ],
      }),
    );

    expect(result.edgeRefinements).toEqual([
      {
        edgeId: 'app-calls-backend',
        relationTypeId: 'core/software.relations.calls',
        fromChildLocalId: 'runtime',
      },
      {
        edgeId: 'app-calls-backend',
        relationTypeId: 'core/software.relations.reads',
        fromChildLocalId: 'runtime',
      },
    ]);
  });

  it('accepts YAML-shaped refinement responses in addition to JSON', () => {
    const result = parseNodeRefinementResponse(`
children:
  - localId: runtime
    name: Runtime
    typeId: core/code.types.module
    scope:
      - src/runtime.ts
    evidence:
      - path: src/runtime.ts
        reason: Entrypoint
    queueDecision: leaf
relations: []
edgeRefinements:
  - edgeId: app-calls-backend
    fromChildLocalId: runtime
`);

    expect(result.children).toEqual([
      expect.objectContaining({
        localId: 'runtime',
        typeId: 'core/code.types.module',
      }),
    ]);
    expect(result.edgeRefinements).toEqual([
      {
        edgeId: 'app-calls-backend',
        fromChildLocalId: 'runtime',
      },
    ]);
  });

  it('preserves raw child scope and evidence paths from the model response', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/code.types.module',
            scope: ['target-repo/src/runtime.ts'],
            evidence: [{ path: '/tmp/job/target-repo/src/runtime.ts', reason: 'Entrypoint' }],
            queueDecision: 'leaf',
          },
        ],
        relations: [],
        edgeRefinements: [],
      }),
    );

    expect(result.children[0]?.scope).toEqual(['target-repo/src/runtime.ts']);
    expect(result.children[0]?.evidence).toEqual([
      { path: '/tmp/job/target-repo/src/runtime.ts', reason: 'Entrypoint' },
    ]);
  });
});

describe('validateNodeRefinementResultShape', () => {
  it('rejects workspace-prefixed scope and evidence paths', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        children: [
          {
            localId: 'runtime',
            name: 'Runtime',
            typeId: 'core/code.types.module',
            scope: ['target-repo/src/runtime.ts'],
            evidence: [{ path: 'target-repo/src/runtime.ts', reason: 'Entrypoint' }],
            queueDecision: 'leaf',
          },
        ],
        relations: [
          {
            localId: 'runtime-calls-storage',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'runtime',
            toLocalId: 'runtime',
            evidence: [{ path: '/tmp/job/target-repo/src/runtime.ts', reason: 'Call path' }],
          },
        ],
        edgeRefinements: [],
      }),
    );

    expect(
      validateNodeRefinementResultShape({
        result,
        nodeId: 'service-runtime',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_child_scope_path',
          path: 'target-repo/src/runtime.ts',
        }),
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_child_evidence_path',
          path: 'target-repo/src/runtime.ts',
        }),
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_relation_evidence_path',
          path: '/tmp/job/target-repo/src/runtime.ts',
        }),
      ]),
    );
  });
});

describe('task edge handle parsing', () => {
  const task: NodeRefinementTask = {
    nodeId: 'app',
    nodeTypeId: 'module',
    depth: 0,
    scope: [],
    evidence: [],
    inboundEdges: ['real-inbound-one', 'real-inbound-two'].map((id) => ({
      id,
      sourceId: 'source',
      targetId: 'app',
      side: 'ingress',
      evidence: [],
    })),
    outboundEdges: ['real-outbound-one', 'real-outbound-two'].map((id) => ({
      id,
      sourceId: 'app',
      targetId: 'target',
      side: 'egress',
      evidence: [],
    })),
  };
  it('translates diagnostic strings without changing JSON keys or scalar types', () => {
    const edgeTask = {
      ...task,
      inboundEdges: [],
      outboundEdges: [
        { ...task.outboundEdges[0], id: 'true' },
        { ...task.outboundEdges[1], id: 'edge.with[regex]"characters' },
      ],
    };
    const value = {
      true: true,
      message: 'Refer to true',
      details: { edgeId: edgeTask.outboundEdges[1].id },
    };
    expect(JSON.parse(formatWithEdgeHandles(value, edgeTask))).toEqual({
      true: true,
      message: 'Refer to out-1',
      details: { edgeId: 'out-2' },
    });
  });

  it('maps refinements and proposals to real IDs', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        edgeRefinements: [{ edgeId: 'out-2', fromChildLocalId: 'child' }],
        edgeProposals: [{ edgeId: 'in-2', endpoint: 'to', childLocalId: 'child' }],
      }),
      task,
    );
    expect(result.edgeRefinements[0].edgeId).toBe('real-outbound-two');
    expect(result.edgeProposals?.[0].edgeId).toBe('real-inbound-two');
    expect(result.edgeReferenceDiagnostics).toBeUndefined();
  });
  it.each([
    'real-outbound-two',
    'real.outbound.two',
    'out-9',
    'toString',
  ])('rejects unknown reference %s without guessing', (edgeId) => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        edgeRefinements: [{ edgeId, fromChildLocalId: 'child' }],
        edgeProposals: [{ edgeId, endpoint: 'from', childLocalId: 'child' }],
      }),
      task,
    );
    const diagnostics = validateNodeRefinementResultShape({ result, nodeId: 'app' });
    expect(result.edgeRefinements).toEqual([]);
    expect(result.edgeProposals).toEqual([]);
    expect(
      diagnostics
        .filter((entry) => entry.code === 'diagram.node_refinement.invalid_edge_handle')
        .map((entry) => entry.message),
    ).toEqual([
      `Edge reference "${edgeId}" is not one of this task's edges: in-1, in-2, out-1, out-2.`,
      `Edge reference "${edgeId}" is not one of this task's edges: in-1, in-2, out-1, out-2.`,
    ]);
  });
});

describe('node-refinement parser repair diagnostics', () => {
  const evidence = [{ path: 'src/auth.ts', reason: 'Implements authentication' }];
  const child = {
    localId: 'AuthService',
    name: 'Auth service',
    typeId: 'core/software.types.service',
    evidence,
    queueDecision: 'leaf',
  };
  const relation = {
    localId: 'AuthCallsStore',
    typeId: 'core/software.relations.calls',
    fromLocalId: 'AuthService',
    toLocalId: 'Data Store',
    evidence,
  };

  it.each([
    'AuthService',
    'Data Store',
    'Auth/Service',
    '!!!',
  ])('normalizes every child reference consistently for %s', (localId) => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        children: [{ ...child, localId }],
        relations: [{ ...relation, fromLocalId: localId, toLocalId: localId }],
        edgeRefinements: [{ edgeId: 'edge-1', fromChildLocalId: localId, toChildLocalId: localId }],
        edgeProposals: [{ edgeId: 'edge-2', endpoint: 'to', childLocalId: localId }],
      }),
    );
    const normalized = result.children[0].localId;
    expect(result.relations[0]).toMatchObject({ fromLocalId: normalized, toLocalId: normalized });
    expect(result.edgeRefinements[0]).toMatchObject({
      fromChildLocalId: normalized,
      toChildLocalId: normalized,
    });
    expect(result.edgeProposals?.[0].childLocalId).toBe(normalized);
    expect(validateNodeRefinementResultShape({ result, nodeId: 'app' })).toEqual([]);
  });

  it.each([
    'localId',
    'name',
    'typeId',
    'evidence',
    'queueDecision',
  ])('reports a dropped child missing %s', (field) => {
    const item: Record<string, unknown> = { ...child };
    delete item[field];
    const result = parseNodeRefinementResponse(JSON.stringify({ children: [item] }));
    expect(result.children).toEqual([]);
    expect(validateNodeRefinementResultShape({ result, nodeId: 'app' })).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'diagram.node_refinement.invalid_item',
        message: expect.stringContaining(field),
      }),
    ]);
    expect(result.parseDiagnostics?.[0].message).toContain(
      field === 'localId' ? '#1' : 'AuthService',
    );
  });

  it.each([
    'localId',
    'typeId',
    'fromLocalId',
    'toLocalId',
    'evidence',
  ])('reports a dropped relation missing %s', (field) => {
    const item: Record<string, unknown> = { ...relation };
    delete item[field];
    const result = parseNodeRefinementResponse(JSON.stringify({ relations: [item] }));
    expect(result.relations).toEqual([]);
    const diagnostics = validateNodeRefinementResultShape({ result, nodeId: 'app' });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'diagram.node_refinement.invalid_item',
        message: expect.stringContaining(field),
      }),
    ]);
    expect(diagnostics[0].message).toContain('->');
  });

  it('preserves inherited endpoint IDs and resolves absolute direct-child references before boundary inference', () => {
    const task: NodeRefinementTask = {
      nodeId: 'app',
      nodeTypeId: 'module',
      depth: 0,
      scope: [],
      evidence: [],
      inboundEdges: [],
      outboundEdges: [
        {
          id: 'app-to-db',
          sourceId: 'app',
          targetId: 'storage/db',
          relationTypeId: relation.typeId,
          side: 'egress',
          evidence,
        },
      ],
    };
    const parsed = parseNodeRefinementResponse(
      JSON.stringify({
        children: [child],
        relations: [{ ...relation, fromLocalId: 'app/AuthService', toLocalId: 'storage/db' }],
      }),
      task,
    );
    expect(parsed.relations[0]).toMatchObject({
      fromLocalId: 'authservice',
      toLocalId: 'storage/db',
    });
    const normalized = normalizeEdgeRefinementOrientation({
      semantics: testGroupSemantics,
      task,
      result: parsed,
      inferEvidenceMatchedEdgeRefinements: false,
    });
    expect(normalized.relations).toEqual([]);
    expect(normalized.edgeRefinements).toEqual([
      expect.objectContaining({ edgeId: 'app-to-db', fromChildLocalId: 'authservice' }),
    ]);
    const explicit = parseNodeRefinementResponse(
      JSON.stringify({
        children: [child],
        relations: [
          { ...relation, fromLocalId: 'app/AuthService', toLocalId: 'app/AuthService/deeper' },
        ],
        edgeRefinements: [{ edgeId: 'out-1', fromChildLocalId: 'app/AuthService' }],
        edgeProposals: [{ edgeId: 'out-1', endpoint: 'from', childLocalId: 'app/AuthService' }],
      }),
      task,
    );
    expect(explicit.relations[0].toLocalId).toBe('app/AuthService/deeper');
    expect(explicit.edgeRefinements[0].fromChildLocalId).toBe('authservice');
    expect(explicit.edgeProposals?.[0].childLocalId).toBe('authservice');
  });

  it('reports invalid field types without coercing malformed objects', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        children: [
          { ...child, localId: { toString: null }, name: 42, typeId: [], queueDecision: false },
        ],
        relations: [{ ...relation, fromLocalId: { toString: null }, toLocalId: false }],
      }),
    );
    expect(result.children).toEqual([]);
    expect(result.relations).toEqual([]);
    expect(result.parseDiagnostics).toHaveLength(6);
  });

  it('reports every malformed item and rejects an unknown queue decision without silently making it a leaf', () => {
    const result = parseNodeRefinementResponse(
      JSON.stringify({
        children: [
          null,
          [],
          { ...child, queueDecision: 'maybe' },
          { ...child, evidence: [{ path: 'src/auth.ts' }] },
          child,
        ],
        relations: [null, 'not a relation', { ...relation, evidence: [] }],
      }),
    );
    expect(result.children).toHaveLength(1);
    expect(result.relations).toEqual([]);
    const diagnostics = validateNodeRefinementResultShape({ result, nodeId: 'app' });
    expect(diagnostics).toHaveLength(7);
    expect(
      diagnostics.every(
        (item) => item.code === 'diagram.node_refinement.invalid_item' && item.severity === 'error',
      ),
    ).toBe(true);
    expect(
      diagnostics.some(
        (item) => item.message.includes('AuthService') && item.message.includes('queueDecision'),
      ),
    ).toBe(true);
  });
});

it('rewrites complete edge tokens without altering longer words or IDs', () => {
  const task = {
    inboundEdges: [],
    outboundEdges: [
      { id: 'edge-a', sourceId: 'app', targetId: 'db', side: 'egress' as const, evidence: [] },
    ],
  };
  expect(
    JSON.parse(
      formatWithEdgeHandles(
        {
          exact: 'edge-a',
          message: 'Choose (edge-a), then retry edge-a!',
          embedded: 'prefixedge-a edge-asuffix edge-a-extra other/edge-a edge-a/child edge-a.value',
          handle: 'out-1-longer',
        },
        task,
      ),
    ),
  ).toEqual({
    exact: 'out-1',
    message: 'Choose (out-1), then retry out-1!',
    embedded: 'prefixedge-a edge-asuffix edge-a-extra other/edge-a edge-a/child edge-a.value',
    handle: 'out-1-longer',
  });
});
