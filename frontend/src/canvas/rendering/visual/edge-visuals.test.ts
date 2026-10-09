import {
  buildCompiledDiagramEdgeId,
  buildQualifiedSchemaObjectId,
  type CompiledDiagramEdge,
  type SchemaModule,
} from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { buildEdgeVisuals } from './edge-visuals';

const READS_RELATION_ID = buildQualifiedSchemaObjectId('user/test', 'relations', 'reads');
const CALLS_RELATION_ID = buildQualifiedSchemaObjectId('user/test', 'relations', 'calls');

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  types: [],
  relations: [
    {
      id: READS_RELATION_ID,
      label: 'reads',
      display: {
        flowDirection: 'reverse',
      },
    },
    {
      id: CALLS_RELATION_ID,
      label: 'calls',
    },
  ],
};

describe('buildEdgeVisuals', () => {
  it('reverses visual endpoints for relations configured with reverse flow', () => {
    const edges: CompiledDiagramEdge[] = [
      {
        id: buildCompiledDiagramEdgeId('rel-1', 'reader', 'store'),
        relationId: 'rel-1',
        sourceId: 'reader',
        targetId: 'store',
        type: READS_RELATION_ID,
        label: 'read',
      },
    ];

    const [resolved] = buildEdgeVisuals({ schema, edges });

    expect(resolved).toMatchObject({
      id: 'rel-1:reader->store',
      relationId: 'rel-1',
      semanticSourceId: 'reader',
      semanticTargetId: 'store',
      sourceId: 'store',
      targetId: 'reader',
      label: 'read',
    });
  });

  it('keeps visual endpoints forward by default', () => {
    const edges: CompiledDiagramEdge[] = [
      {
        id: buildCompiledDiagramEdgeId('rel-2', 'api', 'service'),
        relationId: 'rel-2',
        sourceId: 'api',
        targetId: 'service',
        type: CALLS_RELATION_ID,
      },
      {
        id: buildCompiledDiagramEdgeId('rel-3', 'job', 'queue'),
        relationId: 'rel-3',
        sourceId: 'job',
        targetId: 'queue',
        type: 'missing',
      },
    ];

    expect(buildEdgeVisuals({ schema, edges })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'rel-2:api->service',
          semanticSourceId: 'api',
          semanticTargetId: 'service',
          sourceId: 'api',
          targetId: 'service',
        }),
        expect.objectContaining({
          id: 'rel-3:job->queue',
          semanticSourceId: 'job',
          semanticTargetId: 'queue',
          sourceId: 'job',
          targetId: 'queue',
        }),
      ]),
    );
  });

  it('collapses duplicate visible endpoint pairs to a single visual edge', () => {
    const schemaWithPriority: SchemaModule = {
      ...schema,
      relations: [
        {
          id: READS_RELATION_ID,
          label: 'reads',
          display: {
            flowDirection: 'reverse',
          },
        },
        {
          id: CALLS_RELATION_ID,
          label: 'calls',
          shortLabel: 'call',
          priority: 1,
        },
      ],
    };
    const edges: CompiledDiagramEdge[] = [
      {
        id: buildCompiledDiagramEdgeId('rel-a', 'checkout', 'ns-checkout'),
        relationId: 'rel-a',
        sourceId: 'checkout',
        targetId: 'ns-checkout',
        type: CALLS_RELATION_ID,
        label: 'deploy',
        solidOverNodeIds: ['checkout', 'runtime-prod'],
      },
      {
        id: buildCompiledDiagramEdgeId('rel-b', 'checkout', 'ns-checkout'),
        relationId: 'rel-b',
        sourceId: 'checkout',
        targetId: 'ns-checkout',
        type: CALLS_RELATION_ID,
        label: 'deploy',
        solidOverNodeIds: ['checkout', 'runtime-prod', 'ns-checkout'],
      },
    ];

    expect(buildEdgeVisuals({ schema: schemaWithPriority, edges })).toEqual([
      expect.objectContaining({
        id: 'rel-a:checkout->ns-checkout',
        relationId: 'rel-a',
        relationIds: ['rel-a', 'rel-b'],
        sourceId: 'checkout',
        targetId: 'ns-checkout',
        label: 'deploy',
        solidOverNodeIds: ['checkout', 'runtime-prod', 'ns-checkout'],
      }),
    ]);
  });
});

describe('opposite visual directions', () => {
  const directed = (
    relationId: string,
    sourceId: string,
    targetId: string,
    type = CALLS_RELATION_ID,
    label?: string,
  ): CompiledDiagramEdge => ({
    id: `${relationId}:${sourceId}->${targetId}`,
    relationId,
    sourceId,
    targetId,
    type,
    label,
  });
  it('groups after flow reversal, keeping each direction primary and the highest-priority style', () => {
    const prioritySchema = {
      ...schema,
      relations: schema.relations.map((r) => ({
        ...r,
        priority: r.id === CALLS_RELATION_ID ? 1 : 2,
      })),
    };
    const [edge] = buildEdgeVisuals({
      schema: prioritySchema,
      edges: [
        directed('z-call', 'a', 'b', CALLS_RELATION_ID, 'call'),
        directed('read', 'a', 'b', READS_RELATION_ID, 'read'),
        directed('a-call', 'a', 'b', CALLS_RELATION_ID, 'call'),
      ],
    });
    expect(edge).toMatchObject({
      relationId: 'a-call',
      type: CALLS_RELATION_ID,
      sourceId: 'a',
      targetId: 'b',
      label: 'call / read',
      relationIds: ['a-call', 'z-call', 'read'],
      directionalLabels: [
        { sourceId: 'a', targetId: 'b', relationId: 'a-call', label: 'call' },
        { sourceId: 'b', targetId: 'a', relationId: 'read', label: 'read' },
      ],
    });
  });
  it('does not invent an opposite direction when reverse flow aligns the endpoints', () => {
    const [edge] = buildEdgeVisuals({
      schema,
      edges: [
        directed('call', 'a', 'b', CALLS_RELATION_ID, 'call'),
        directed('read', 'b', 'a', READS_RELATION_ID, 'read'),
      ],
    });
    expect(edge.directionalLabels).toBeUndefined();
    expect(edge.relationIds).toHaveLength(2);
  });
  it.each([
    [undefined, 'call', 'call'],
    ['call', undefined, 'call'],
    ['call', 'call', 'call'],
    [undefined, undefined, undefined],
  ])('shows blank/equal label pair %s / %s once', (a, b, expected) => {
    const [edge] = buildEdgeVisuals({
      schema,
      edges: [
        directed('a', 'x', 'y', CALLS_RELATION_ID, a),
        directed('b', 'y', 'x', CALLS_RELATION_ID, b),
      ],
    });
    expect(edge.label).toBe(expected);
    expect(edge.directionalLabels?.map((label) => label.relationId)).toEqual(['a', 'b']);
  });
});
