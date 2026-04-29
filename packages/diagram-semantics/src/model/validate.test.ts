import { describe, expect, it } from 'vitest';
import { CORE_CONTAINS_RELATION_ID } from './schema-ids';
import { buildSchemaActivation } from './schema-ref';
import type { SchemaModule, SemanticDocument } from './types';
import { STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS, validateDocument } from './validate';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

function buildSchema(): SchemaModule {
  return {
    owner: 'core',
    name: 'test',
    version: '0.1.0',
    traits: [
      {
        id: 'core/test.traits.compute',
        label: 'Compute',
        relationParticipation: [{ relation: 'core/test.relations.calls', endpoint: 'from' }],
      },
      {
        id: 'core/test.traits.api-like',
        label: 'API-like',
        relationParticipation: [{ relation: 'core/test.relations.serves', endpoint: 'from' }],
      },
      {
        id: 'core/test.traits.app-surface',
        label: 'App surface',
        relationParticipation: [
          { relation: 'core/test.relations.calls', endpoint: 'to' },
          { relation: 'core/test.relations.serves', endpoint: 'to' },
        ],
      },
    ],
    types: [
      {
        id: 'core/test.types.module',
        label: 'Module',
        traits: ['core/test.traits.compute'],
      },
      {
        id: 'core/test.types.api',
        label: 'API',
        traits: ['core/test.traits.api-like'],
      },
      {
        id: 'core/test.types.frontend',
        label: 'Frontend',
        traits: ['core/test.traits.app-surface'],
      },
      {
        id: 'core/test.types.group',
        label: 'Group',
      },
    ],
    relations: [
      {
        id: CORE_CONTAINS_RELATION_ID,
        label: 'Contains',
      },
      {
        id: 'core/test.relations.calls',
        label: 'Calls',
      },
      {
        id: 'core/test.relations.serves',
        label: 'Serves',
      },
    ],
  };
}

function buildDocument(params: {
  fromType: string;
  toType: string;
  relationType: string;
}): SemanticDocument {
  return {
    version: '0.1.0',
    schemaRefs: [act('core/test@0.1.0')],
    entities: [
      { id: 'from', type: params.fromType },
      { id: 'to', type: params.toType },
    ],
    relations: [
      {
        id: 'rel-1',
        type: params.relationType,
        from: 'from',
        to: 'to',
      },
    ],
  };
}

describe('validateDocument invalid relation endpoint guidance', () => {
  it('reports valid alternative relation types for the chosen endpoint pair', () => {
    const diagnostics = validateDocument(
      buildDocument({
        fromType: 'core/test.types.api',
        toType: 'core/test.types.frontend',
        relationType: 'core/test.relations.calls',
      }),
      buildSchema(),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'diagram.document.invalid_relation_endpoints',
        relationId: 'rel-1',
        hint: 'Chosen endpoints from (core/test.types.api) -> to (core/test.types.frontend) can use: core/test.relations.serves. Keep the endpoints and choose one of those relation types.',
        details: {
          relationAnalysis: {
            fromRef: 'from',
            fromType: 'core/test.types.api',
            toRef: 'to',
            toType: 'core/test.types.frontend',
            selectedType: 'core/test.relations.calls',
            validRelationTypes: ['core/test.relations.serves'],
            requiresEndpointChange: false,
          },
        },
      }),
    ]);
  });

  it('requires endpoint changes when no legal relation types exist for the pair', () => {
    const diagnostics = validateDocument(
      buildDocument({
        fromType: 'core/test.types.api',
        toType: 'core/test.types.group',
        relationType: 'core/test.relations.calls',
      }),
      buildSchema(),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'diagram.document.invalid_relation_endpoints',
        relationId: 'rel-1',
        hint: 'Chosen endpoints from (core/test.types.api) -> to (core/test.types.group) admit no legal relation types; choose different endpoints.',
        details: {
          relationAnalysis: {
            fromRef: 'from',
            fromType: 'core/test.types.api',
            toRef: 'to',
            toType: 'core/test.types.group',
            selectedType: 'core/test.relations.calls',
            validRelationTypes: [],
            requiresEndpointChange: true,
          },
        },
      }),
    ]);
  });

  it('does not emit endpoint guidance for an already valid relation', () => {
    const diagnostics = validateDocument(
      buildDocument({
        fromType: 'core/test.types.module',
        toType: 'core/test.types.frontend',
        relationType: 'core/test.relations.calls',
      }),
      buildSchema(),
    );

    expect(diagnostics).toEqual([]);
  });

  it('rejects authored contains relations because containment is structural', () => {
    const diagnostics = validateDocument(
      {
        version: '0.1.0',
        schemaRefs: [act('core/test@0.1.0')],
        entities: [
          { id: 'container', type: 'core/test.types.module' },
          { id: 'child', type: 'core/test.types.frontend' },
        ],
        relations: [
          {
            id: 'rel-contains',
            type: CORE_CONTAINS_RELATION_ID,
            from: 'container',
            to: 'child',
          },
        ],
      },
      buildSchema(),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'diagram.document.authored_contains_relation_not_allowed',
        relationId: 'rel-contains',
      }),
    ]);
  });

  it('rejects worker workspace-prefixed provenance paths in strict mode', () => {
    const diagnostics = validateDocument(
      {
        version: '0.1.0',
        schemaRefs: [act('core/test@0.1.0')],
        inputs: [
          {
            id: 'primary',
            kind: 'git',
            repo: 'https://github.com/example/repo',
            revision: '0123456789abcdef0123456789abcdef01234567',
            role: 'primary',
          },
        ],
        entities: [
          {
            id: 'from',
            type: 'core/test.types.module',
            provenance: {
              locations: [{ input: 'primary', path: 'target-repo/src/from.ts' }],
            },
          },
          {
            id: 'to',
            type: 'core/test.types.frontend',
            provenance: {
              locations: [{ input: 'primary', path: 'src/to.ts' }],
            },
          },
        ],
        relations: [
          {
            id: 'rel-1',
            type: 'core/test.relations.calls',
            from: 'from',
            to: 'to',
            provenance: {
              locations: [{ input: 'primary', path: 'src/rel.ts' }],
            },
          },
        ],
      },
      buildSchema(),
      STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.document.invalid_provenance_location_path',
          entityId: 'from',
          path: 'target-repo/src/from.ts',
          message:
            'Entity from provenance path must be repo-relative to the input root and must not start with target-repo/',
        }),
      ]),
    );
  });
});
