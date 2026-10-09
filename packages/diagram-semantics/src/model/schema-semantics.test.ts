import { describe, expect, it } from 'vitest';
import { buildSchemaActivation } from './schema-ref';
import {
  compileSchemaSemantics,
  getAllowedChildTypeIds,
  getResolvedRelationSemantics,
  getResolvedTypeSemantics,
  isAllowedChildType,
} from './schema-semantics';
import type { EntityTypeDef, SchemaModule } from './types';

const schema: SchemaModule = {
  owner: 'core',
  name: 'test',
  version: '0.1.0',
  traits: [
    {
      id: 'core/test.traits.caller',
      label: 'Caller',
      relationParticipation: [{ relation: 'core/test.relations.calls', endpoint: 'from' }],
      analysis: {
        flowType: 'source',
      },
    },
    {
      id: 'core/test.traits.store-client',
      label: 'Store Client',
      extends: 'core/test.traits.caller',
      relationParticipation: [
        { relation: 'core/test.relations.reads', endpoint: 'from' },
        { relation: 'core/test.relations.writes', endpoint: 'from' },
      ],
      analysis: {
        expectedRelationIds: ['core/test.relations.reads', 'core/test.relations.writes'],
      },
    },
    {
      id: 'core/test.traits.receiver',
      label: 'Receiver',
      relationParticipation: [{ relation: 'core/test.relations.calls', endpoint: 'to' }],
      analysis: {
        flowType: 'sink',
        mayTerminate: true,
      },
    },
  ],
  types: [
    {
      id: 'core/test.types.service',
      label: 'Service',
      traits: ['core/test.traits.store-client', 'core/test.traits.receiver'],
    },
    {
      id: 'core/test.types.store',
      label: 'Store',
      traits: ['core/test.traits.receiver'],
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
  ],
};

describe('compileSchemaSemantics', () => {
  it('resolves trait closure and unions relation participation', () => {
    const semantics = compileSchemaSemantics(schema);
    const service = getResolvedTypeSemantics(semantics, 'core/test.types.service');

    expect(service?.traitClosure).toEqual(
      expect.arrayContaining([
        'core/test.traits.caller',
        'core/test.traits.receiver',
        'core/test.traits.store-client',
      ]),
    );
    expect(service?.relationParticipation).toEqual(
      expect.arrayContaining([
        { relationId: 'core/test.relations.calls', from: true, to: true },
        { relationId: 'core/test.relations.reads', from: true, to: false },
        { relationId: 'core/test.relations.writes', from: true, to: false },
      ]),
    );
  });

  it('accumulates positive expectations and derives the resolved flow role', () => {
    const semantics = compileSchemaSemantics(schema);
    const service = getResolvedTypeSemantics(semantics, 'core/test.types.service');

    expect(service?.expectations).toEqual({
      expectsIngress: true,
      expectsEgress: true,
      mayTerminate: true,
      expectedRelationIds: ['core/test.relations.reads', 'core/test.relations.writes'],
      flowRole: 'through',
    });
  });

  it('retains relation fulfilment semantics on relation definitions', () => {
    const semantics = compileSchemaSemantics(schema);
    expect(getResolvedRelationSemantics(semantics, 'core/test.relations.reads')).toEqual({
      relationId: 'core/test.relations.reads',
      fulfills: {
        from: ['ingress'],
        to: ['egress'],
      },
    });
  });

  it('allows explicit structural groups even when their activated layer is lower than the parent', () => {
    const layeredSchema: SchemaModule = {
      owner: 'core',
      name: 'layered',
      version: '0.1.0',
      traits: [
        {
          id: 'core/base.traits.container',
          label: 'Container',
        },
        {
          id: 'core/base.traits.containable',
          label: 'Containable',
        },
        {
          id: 'core/base.traits.group-like',
          label: 'Group',
          extends: 'core/base.traits.containable',
        },
        {
          id: 'core/code.traits.code-like',
          label: 'Code',
          extends: 'core/base.traits.containable',
        },
      ],
      types: [
        {
          id: 'core/code.types.module',
          label: 'Module',
          originSchemaId: 'core/code@0.1',
          traits: ['core/base.traits.container', 'core/code.traits.code-like'],
          containment: {
            allowedChildTraits: ['core/code.traits.code-like', 'core/base.traits.group-like'],
          },
        },
        {
          id: 'core/web-app.types.group',
          label: 'Group',
          originSchemaId: 'core/web-app@0.3',
          traits: ['core/base.traits.group-like', 'core/base.traits.container'],
        },
      ],
      relations: [],
    };

    expect(
      getAllowedChildTypeIds({
        schema: layeredSchema,
        parentTypeId: 'core/code.types.module',
        schemaActivations: [
          buildSchemaActivation('core/web-app@0.3', 0),
          buildSchemaActivation('core/code@0.1', 1),
        ],
      }),
    ).toContain('core/web-app.types.group');
  });
});

describe('explicit containment alternatives', () => {
  const cases: { name: string; containment: EntityTypeDef['containment']; allowed: string[] }[] = [
    { name: 'no containment', containment: undefined, allowed: [] },
    {
      name: 'neither list',
      containment: {},
      allowed: ['parent', 'typed', 'traited', 'both', 'neither'],
    },
    {
      name: 'empty lists',
      containment: { allowedChildTypes: [], allowedChildTraits: [] },
      allowed: ['parent', 'typed', 'traited', 'both', 'neither'],
    },
    {
      name: 'types only',
      containment: { allowedChildTypes: ['typed'] },
      allowed: ['typed', 'both'],
    },
    {
      name: 'types with empty traits',
      containment: { allowedChildTypes: ['typed'], allowedChildTraits: [] },
      allowed: ['typed', 'both'],
    },
    {
      name: 'traits only',
      containment: { allowedChildTraits: ['allowed'] },
      allowed: ['traited', 'both'],
    },
    {
      name: 'traits with empty types',
      containment: { allowedChildTypes: [], allowedChildTraits: ['allowed'] },
      allowed: ['traited', 'both'],
    },
    {
      name: 'both lists',
      containment: { allowedChildTypes: ['typed'], allowedChildTraits: ['allowed'] },
      allowed: ['typed', 'traited', 'both'],
    },
  ];

  it.each(cases)('$name', ({ containment, allowed }) => {
    const containmentSchema: SchemaModule = {
      owner: 'core',
      name: 'containment',
      version: '0.1.0',
      traits: [{ id: 'allowed', label: 'Allowed' }],
      types: [
        { id: 'parent', label: 'Parent', containment },
        { id: 'typed', label: 'Typed' },
        { id: 'traited', label: 'Traited', traits: ['allowed'] },
        { id: 'both', label: 'Both', extends: 'typed', traits: ['allowed'] },
        { id: 'neither', label: 'Neither' },
      ],
      relations: [],
    };
    expect(getAllowedChildTypeIds({ schema: containmentSchema, parentTypeId: 'parent' })).toEqual(
      [...allowed].sort(),
    );
    for (const child of containmentSchema.types) {
      expect(
        isAllowedChildType({
          schema: containmentSchema,
          parentTypeId: 'parent',
          childTypeId: child.id,
        }),
        child.id,
      ).toBe(allowed.includes(child.id));
    }
  });
});
