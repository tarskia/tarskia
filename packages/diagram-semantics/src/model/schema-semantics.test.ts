import { describe, expect, it } from 'vitest';
import { CORE_GROUP_TYPE_ID } from './schema-ids';
import { buildSchemaActivation } from './schema-ref';
import {
  canContainEntity,
  compileSchemaSemantics,
  evaluateContainment,
  getAllowedChildTypeIds,
  getResolvedRelationSemantics,
  getResolvedTypeSemantics,
  isAllowedChildType,
  typedGroupAllowsChild,
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

describe('shared containment evaluation', () => {
  const layered: SchemaModule = {
    owner: 'test',
    name: 'containment',
    version: '1.0',
    relations: [],
    traits: [
      { id: 'core/base.traits.container', label: 'Container' },
      { id: 'core/base.traits.containable', label: 'Containable' },
      { id: 'core/base.traits.group-like', label: 'Group' },
    ],
    types: [
      {
        id: 'parent',
        label: 'Parent',
        originSchemaId: 'test/parent@1',
        containment: { allowedChildTypes: ['explicit', 'group'] },
      },
      {
        id: 'generic',
        label: 'Generic',
        originSchemaId: 'test/parent@1',
        traits: ['core/base.traits.container'],
      },
      { id: 'empty', label: 'Empty', originSchemaId: 'test/parent@1' },
      { id: 'explicit', label: 'Explicit', originSchemaId: 'test/child@1' },
      {
        id: 'containable',
        label: 'Containable',
        originSchemaId: 'test/child@1',
        traits: ['core/base.traits.containable'],
      },
      {
        id: 'group',
        label: 'Group',
        originSchemaId: 'test/child@1',
        traits: ['core/base.traits.group-like'],
      },
    ],
  };
  const activations = (delta: number) => [
    buildSchemaActivation('test/parent@1', 1),
    buildSchemaActivation('test/child@1', 1 + delta),
  ];
  it.each([
    ['parent', 'explicit', 0, true, undefined],
    ['parent', 'explicit', 1, true, undefined],
    ['generic', 'containable', 1, true, undefined],
    ['parent', 'explicit', 2, false, 'invalid_parent'],
    ['parent', 'explicit', -1, false, 'invalid_parent'],
    ['parent', 'group', 2, true, undefined],
    ['parent', 'group', -1, true, undefined],
    ['empty', 'explicit', 0, false, 'invalid_parent'],
    ['parent', 'containable', 0, false, 'invalid_child'],
  ] as const)('%s → %s at layer delta %s', (parentTypeId, childTypeId, delta, allowed, failure) => {
    expect(
      evaluateContainment({
        schema: layered,
        parentTypeId,
        childTypeId,
        schemaActivations: activations(delta),
      }),
    ).toMatchObject({ allowed, failure, parentLayer: 1, childLayer: 1 + delta });
  });
  it('retains explicit and generic reasons independently', () => {
    expect(
      evaluateContainment({
        schema: layered,
        parentTypeId: 'parent',
        childTypeId: 'explicit',
        schemaActivations: activations(1),
      }),
    ).toMatchObject({
      allowed: true,
      explicitContainmentOk: true,
      genericCrossLayerContainmentOk: false,
    });
    expect(
      evaluateContainment({
        schema: layered,
        parentTypeId: 'generic',
        childTypeId: 'containable',
        schemaActivations: activations(1),
      }),
    ).toMatchObject({
      allowed: true,
      explicitContainmentOk: false,
      genericCrossLayerContainmentOk: true,
    });
  });
  it.each([-1, 0, 1, 2])('lists exactly the accepted types at layer delta %s', (delta) => {
    for (const parent of layered.types) {
      const args = {
        schema: layered,
        parentTypeId: parent.id,
        schemaActivations: activations(delta),
      };
      expect(getAllowedChildTypeIds(args)).toEqual(
        layered.types
          .filter((child) => evaluateContainment({ ...args, childTypeId: child.id }).allowed)
          .map((child) => child.id)
          .sort(),
      );
    }
  });
});

describe('typed group containment', () => {
  const groupSchema: SchemaModule = {
    ...schema,
    types: [...schema.types, { id: CORE_GROUP_TYPE_ID, label: 'Group', containment: {} }],
  };
  const service = 'core/test.types.service';
  const store = 'core/test.types.store';
  it.each([
    [service, { mode: 'typed', groupType: service }, store, true],
    [CORE_GROUP_TYPE_ID, {}, store, true],
    [CORE_GROUP_TYPE_ID, { mode: 'typed' }, store, true],
    [CORE_GROUP_TYPE_ID, { mode: 'typed', groupType: '' }, store, true],
    [CORE_GROUP_TYPE_ID, { groupType: 'unknown' }, store, true],
    [CORE_GROUP_TYPE_ID, { groupType: service }, service, true],
    [CORE_GROUP_TYPE_ID, { groupType: service }, CORE_GROUP_TYPE_ID, true],
    [CORE_GROUP_TYPE_ID, { groupType: service }, store, false],
    [CORE_GROUP_TYPE_ID, { mode: 'typed', groupType: service }, store, false],
  ] as const)('checks %s with %j and child %s', (type, props, childTypeId, allowed) => {
    expect(
      typedGroupAllowsChild({ schema: groupSchema, parent: { type, props }, childTypeId }),
    ).toBe(allowed);
  });
  it('combines type-level and typed-group restrictions', () => {
    const parent = { type: CORE_GROUP_TYPE_ID, props: { groupType: service } };
    expect(canContainEntity({ schema: groupSchema, parent, childTypeId: service })).toBe(true);
    expect(canContainEntity({ schema: groupSchema, parent, childTypeId: store })).toBe(false);
    expect(
      canContainEntity({ schema: groupSchema, parent: { type: service }, childTypeId: service }),
    ).toBe(false);
  });
});
