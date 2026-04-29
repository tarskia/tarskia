import { describe, expect, it } from 'vitest';
import { analyzeDocumentFlow } from './flow-analysis';
import { FREEFORM_RELATION_TYPE } from './schema-ids';
import { buildSchemaActivation } from './schema-ref';
import type { SchemaModule, SemanticDocument } from './types';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const schema: SchemaModule = {
  owner: 'core',
  name: 'test',
  version: '0.1.0',
  traits: [
    {
      id: 'core/test.traits.compute',
      label: 'Compute',
      relationParticipation: [
        { relation: 'core/test.relations.calls', endpoint: 'both' },
        { relation: 'core/test.relations.reads', endpoint: 'from' },
        { relation: 'core/test.relations.writes', endpoint: 'from' },
        { relation: 'core/test.relations.read-writes', endpoint: 'from' },
      ],
      analysis: {
        flowType: 'through',
      },
    },
    {
      id: 'core/test.traits.storage',
      label: 'Storage',
      relationParticipation: [
        { relation: 'core/test.relations.reads', endpoint: 'to' },
        { relation: 'core/test.relations.writes', endpoint: 'to' },
        { relation: 'core/test.relations.read-writes', endpoint: 'to' },
      ],
      analysis: {
        expectedRelationIds: [
          'core/test.relations.reads',
          'core/test.relations.writes',
          'core/test.relations.read-writes',
        ],
        mayTerminate: true,
      },
    },
    {
      id: 'core/test.traits.source',
      label: 'Source',
      relationParticipation: [{ relation: 'core/test.relations.calls', endpoint: 'from' }],
      analysis: {
        flowType: 'source',
      },
    },
  ],
  types: [
    {
      id: 'core/test.types.service',
      label: 'Service',
      traits: ['core/test.traits.compute'],
    },
    {
      id: 'core/test.types.store',
      label: 'Store',
      traits: ['core/test.traits.storage'],
    },
    {
      id: 'core/test.types.client',
      label: 'Client',
      traits: ['core/test.traits.source'],
    },
  ],
  relations: [
    {
      id: 'core/test.relations.calls',
      label: 'Calls',
      analysis: {
        fulfills: {
          from: ['egress'],
          to: ['ingress'],
        },
      },
    },
    {
      id: 'core/test.relations.reads',
      label: 'Reads',
      analysis: {
        fulfills: {
          from: ['ingress'],
          to: ['egress'],
        },
      },
    },
    {
      id: 'core/test.relations.writes',
      label: 'Writes',
      analysis: {
        fulfills: {
          from: ['egress'],
          to: ['ingress'],
        },
      },
    },
    {
      id: 'core/test.relations.read-writes',
      label: 'Read-Writes',
      analysis: {
        fulfills: {
          from: ['ingress', 'egress'],
          to: ['ingress', 'egress'],
        },
      },
    },
  ],
};

describe('analyzeDocumentFlow', () => {
  it('tracks ingress, egress, and expected-relation fulfilment per entity', () => {
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/test@0.1')],
      entities: [
        { id: 'client', type: 'core/test.types.client' },
        { id: 'service', type: 'core/test.types.service' },
        { id: 'store', type: 'core/test.types.store' },
      ],
      relations: [
        {
          id: 'rel-client-service',
          type: 'core/test.relations.calls',
          from: 'client',
          to: 'service',
        },
        {
          id: 'rel-service-store-read-write',
          type: 'core/test.relations.read-writes',
          from: 'service',
          to: 'store',
        },
      ],
    };

    const analysis = analyzeDocumentFlow({ doc, schema });
    const client = analysis.entitiesById.get('client');
    const service = analysis.entitiesById.get('service');
    const store = analysis.entitiesById.get('store');

    expect(client?.fulfillment).toMatchObject({
      ingress: {
        expected: false,
        status: 'not_expected',
      },
      egress: {
        expected: true,
        status: 'fulfilled',
        fulfilledByRelationIds: ['rel-client-service'],
      },
      status: 'fulfilled',
      allExpectationsFulfilled: true,
    });

    expect(service?.fulfillment).toMatchObject({
      ingress: {
        expected: true,
        status: 'fulfilled',
        fulfilledByRelationIds: ['rel-client-service', 'rel-service-store-read-write'],
      },
      egress: {
        expected: true,
        status: 'fulfilled',
        fulfilledByRelationIds: ['rel-service-store-read-write'],
      },
      status: 'fulfilled',
      allExpectationsFulfilled: true,
    });

    expect(store?.fulfillment).toMatchObject({
      ingress: {
        expected: false,
        status: 'not_expected',
      },
      egress: {
        expected: false,
        status: 'not_expected',
      },
      expectedRelations: [
        {
          relationTypeId: 'core/test.relations.read-writes',
          fulfilled: true,
          fulfilledByRelationIds: ['rel-service-store-read-write'],
        },
        {
          relationTypeId: 'core/test.relations.reads',
          fulfilled: false,
          fulfilledByRelationIds: [],
        },
        {
          relationTypeId: 'core/test.relations.writes',
          fulfilled: false,
          fulfilledByRelationIds: [],
        },
      ],
      status: 'partial',
      allExpectationsFulfilled: false,
      missingExpectedRelationIds: ['core/test.relations.reads', 'core/test.relations.writes'],
    });
    expect(store?.expectations.mayTerminate).toBe(true);
  });

  it('does not count inactive, untyped, or endpoint-mismatched relations', () => {
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/test@0.1')],
      entities: [
        { id: 'client', type: 'core/test.types.client' },
        { id: 'service', type: 'core/test.types.service' },
        { id: 'store', type: 'core/test.types.store' },
      ],
      relations: [
        {
          id: 'rel-untyped',
          from: 'client',
          to: 'service',
        },
        {
          id: 'rel-freeform',
          type: FREEFORM_RELATION_TYPE,
          from: 'service',
          to: 'store',
        },
        {
          id: 'rel-state-none',
          type: 'core/test.relations.calls',
          from: 'client',
          to: 'service',
          state: 'none',
        },
        {
          id: 'rel-endpoint-mismatch',
          type: 'core/test.relations.reads',
          from: 'store',
          to: 'service',
        },
      ],
    };

    const analysis = analyzeDocumentFlow({ doc, schema });
    const client = analysis.entitiesById.get('client');
    const relationAnalyses = Array.from(analysis.relationsById.values()).sort((left, right) =>
      left.relationId.localeCompare(right.relationId),
    );

    expect(client?.fulfillment.status).toBe('missing');
    expect(client?.contributingRelationIds).toEqual([]);
    expect(relationAnalyses).toEqual([
      expect.objectContaining({
        relationId: 'rel-endpoint-mismatch',
        countsForExpectationFulfillment: false,
        issues: ['endpoint_mismatch'],
      }),
      expect.objectContaining({
        relationId: 'rel-freeform',
        countsForExpectationFulfillment: false,
        issues: ['unsupported_relation_type'],
      }),
      expect.objectContaining({
        relationId: 'rel-state-none',
        countsForExpectationFulfillment: false,
        issues: ['inactive_relation'],
      }),
      expect.objectContaining({
        relationId: 'rel-untyped',
        countsForExpectationFulfillment: false,
        issues: ['missing_relation_type'],
      }),
    ]);
  });

  it('treats descendant-carried cross-boundary edges as satisfying the parent boundary', () => {
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/test@0.1')],
      entities: [
        { id: 'client', type: 'core/test.types.client' },
        {
          id: 'service',
          type: 'core/test.types.service',
          children: [{ id: 'service/runtime', type: 'core/test.types.service' }],
        },
        { id: 'store', type: 'core/test.types.store' },
      ],
      relations: [
        {
          id: 'rel-client-runtime',
          type: 'core/test.relations.calls',
          from: 'client',
          to: 'service/runtime',
        },
        {
          id: 'rel-runtime-store',
          type: 'core/test.relations.read-writes',
          from: 'service/runtime',
          to: 'store',
        },
      ],
    };

    const analysis = analyzeDocumentFlow({ doc, schema });
    const service = analysis.entitiesById.get('service');
    const runtime = analysis.entitiesById.get('service/runtime');

    expect(service?.fulfillment).toMatchObject({
      ingress: {
        expected: true,
        status: 'fulfilled',
        fulfilledByRelationIds: ['rel-client-runtime', 'rel-runtime-store'],
      },
      egress: {
        expected: true,
        status: 'fulfilled',
        fulfilledByRelationIds: ['rel-runtime-store'],
      },
      status: 'fulfilled',
      allExpectationsFulfilled: true,
    });
    expect(runtime?.fulfillment.status).toBe('fulfilled');
  });

  it('does not let internal child-to-child edges satisfy the parent boundary', () => {
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/test@0.1')],
      entities: [
        {
          id: 'service',
          type: 'core/test.types.service',
          children: [
            { id: 'service/api', type: 'core/test.types.service' },
            { id: 'service/store-adapter', type: 'core/test.types.service' },
          ],
        },
      ],
      relations: [
        {
          id: 'rel-api-adapter',
          type: 'core/test.relations.calls',
          from: 'service/api',
          to: 'service/store-adapter',
        },
      ],
    };

    const analysis = analyzeDocumentFlow({ doc, schema });
    const service = analysis.entitiesById.get('service');

    expect(service?.fulfillment.ingress.status).toBe('missing');
    expect(service?.fulfillment.egress.status).toBe('missing');
    expect(service?.contributingRelationIds).toEqual([]);
  });
});
