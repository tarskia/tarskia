import { describe, expect, it } from 'vitest';
import baseRaw from '../schemas/base.yaml?raw';
import codeRaw from '../schemas/code.yaml?raw';
import frontendRaw from '../schemas/frontend.yaml?raw';
import softwareRaw from '../schemas/software.yaml?raw';
import webAppRaw from '../schemas/web-app.yaml?raw';
import { parseSchema } from '../util/serialization';
import { diagnosticsToMessages } from './diagnostics';
import { buildQualifiedSchemaObjectId } from './schema-ids';
import { buildSchemaActivation } from './schema-ref';
import { buildRawSchemaSet, buildSchemaRuntime, buildSchemaSelection } from './schema-runtime';
import type { SchemaModule } from './types';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const BASE_SERVICE_TYPE_ID = buildQualifiedSchemaObjectId('user/base', 'types', 'service');
const DEPENDENT_ENDPOINT_TYPE_ID = buildQualifiedSchemaObjectId(
  'user/dependent',
  'types',
  'endpoint',
);
const WEB_API_ENDPOINT_TYPE_ID = buildQualifiedSchemaObjectId('user/web', 'types', 'api-endpoint');
const WEB_OLD_CALLS_RELATION_ID = buildQualifiedSchemaObjectId(
  'user/web',
  'relations',
  'old-calls',
);
const WEB_CALLS_HTTP_RELATION_ID = buildQualifiedSchemaObjectId(
  'user/web',
  'relations',
  'calls-http',
);
const ALIAS_CALLER_TRAIT_ID = buildQualifiedSchemaObjectId(
  'user/alias-relations',
  'traits',
  'alias-caller',
);
const CORE_CODE_TRAIT_ID = buildQualifiedSchemaObjectId('core/code', 'traits', 'code-like');
const CORE_CODE_MODULE_TYPE_ID = buildQualifiedSchemaObjectId('core/code', 'types', 'module');
const CORE_FRONTEND_TYPE_ID = buildQualifiedSchemaObjectId('core/frontend', 'types', 'frontend');
const CORE_WEB_API_TYPE_ID = buildQualifiedSchemaObjectId('core/web-app', 'types', 'api');
const CORE_WEB_APPLICATION_TYPE_ID = buildQualifiedSchemaObjectId(
  'core/web-app',
  'types',
  'application',
);
const CORE_WEB_API_ENDPOINT_TYPE_ID = buildQualifiedSchemaObjectId(
  'core/web-app',
  'types',
  'api-endpoint',
);
const CORE_WEB_SERVICE_TYPE_ID = buildQualifiedSchemaObjectId('core/web-app', 'types', 'service');
const CORE_SOFTWARE_CALLS_RELATION_ID = buildQualifiedSchemaObjectId(
  'core/software',
  'relations',
  'calls',
);
const CORE_BASE_CONTAINER_TRAIT_ID = buildQualifiedSchemaObjectId(
  'core/base',
  'traits',
  'container',
);

const baseModule: SchemaModule = {
  owner: 'user',
  name: 'base',
  version: '1.0.0',
  types: [{ id: 'service', label: 'Service' }],
  relations: [],
};

const dependentModule: SchemaModule = {
  owner: 'user',
  name: 'dependent',
  version: '1.0.0',
  use: [{ schema: 'user/base@1.0.0', alias: 'base' }],
  types: [{ id: 'endpoint', label: 'Endpoint' }],
  relations: [],
};

const webModule: SchemaModule = {
  owner: 'user',
  name: 'web',
  version: '1.0.0',
  traits: [{ id: 'service-like', label: 'Service-like' }],
  tags: [{ id: 'service', label: 'Service' }],
  types: [
    {
      id: 'api-endpoint',
      label: 'Endpoint',
      traits: ['service-like'],
      properties: [{ id: 'legacyFlag', type: 'boolean' }],
      display: { primaryTag: 'service' },
    },
  ],
  relations: [
    { id: 'old-calls', label: 'Old Calls' },
    {
      id: 'calls-http',
      label: 'Calls',
      properties: [{ id: 'method', type: 'enum', values: ['GET', 'POST'] }],
    },
  ],
};

const patchModule: SchemaModule = {
  owner: 'user',
  name: 'patch',
  version: '1.0.0',
  use: [{ schema: 'user/web@1.0.0', alias: 'web' }],
  types: [],
  relations: [],
  update: {
    'web.types.api-endpoint': {
      set: {
        label: 'API Endpoint',
      },
      add: {
        properties: [{ id: 'auth_mode', type: 'enum', values: ['none', 'api-key'] }],
      },
      remove: {
        traits: ['service-like'],
      },
    },
    'web.types.api-endpoint.properties.auth_mode': {
      set: {
        description: 'Authentication mode',
      },
      remove: {
        values: ['none'],
      },
    },
    'web.relations.calls-http': {
      add: {
        properties: [{ id: 'requestSchema', type: 'string' }],
      },
    },
    'web.relations.calls-http.properties.method': {
      remove: {
        values: ['GET'],
      },
    },
  },
  remove: {
    'web.relations': ['old-calls'],
    'web.relations.calls-http.properties': ['requestSchema'],
    'web.types.api-endpoint.properties': ['legacyFlag'],
  },
};

const traitRemovalBaseModule: SchemaModule = {
  owner: 'user',
  name: 'trait-removal-base',
  version: '1.0.0',
  traits: [
    {
      id: 'compute',
      label: 'Compute',
      relationParticipation: [
        { relation: 'calls', endpoint: 'from' },
        { relation: 'reads', endpoint: 'from' },
      ],
    },
  ],
  types: [{ id: 'service', label: 'Service', traits: ['compute'] }],
  relations: [
    { id: 'calls', label: 'Calls' },
    { id: 'reads', label: 'Reads' },
  ],
};

const traitRemovalPatchModule: SchemaModule = {
  owner: 'user',
  name: 'trait-removal-patch',
  version: '1.0.0',
  use: [{ schema: 'user/trait-removal-base@1.0.0', alias: 'base' }],
  types: [],
  relations: [],
  update: {
    'base.traits.compute': {
      remove: {
        relationParticipation: [{ relation: 'reads', endpoint: 'from' }],
      },
    },
  },
};

const aliasRelationModule: SchemaModule = {
  owner: 'user',
  name: 'alias-relations',
  version: '1.0.0',
  use: [{ schema: 'user/web@1.0.0', alias: 'web' }],
  traits: [
    {
      id: 'alias-caller',
      label: 'Alias Caller',
      relationParticipation: [{ relation: 'web.calls-http', endpoint: 'from' }],
      analysis: {
        mayTerminate: true,
        expectedRelationIds: ['web.calls-http'],
      },
    },
  ],
  types: [{ id: 'client', label: 'Client', traits: ['alias-caller'] }],
  relations: [
    {
      id: 'client-calls',
      label: 'Calls',
    },
  ],
};

describe('schema-runtime', () => {
  it('builds selection from refs and resolves transitive dependencies', () => {
    const raw = buildRawSchemaSet([baseModule, dependentModule]);
    const selection = buildSchemaSelection({
      raw,
      activations: [act('user/dependent@1.0.0')],
    });
    const runtime = buildSchemaRuntime({ raw, selection });

    expect(runtime.selection.rootModuleIds).toEqual(['user/dependent']);
    expect(runtime.resolved.resolvedModuleIds).toEqual(['user/base', 'user/dependent']);
    expect(runtime.resolved.effectiveSchema.types.map((type) => type.id)).toEqual([
      BASE_SERVICE_TYPE_ID,
      DEPENDENT_ENDPOINT_TYPE_ID,
    ]);
    expect(runtime.indexes.typesById.has(BASE_SERVICE_TYPE_ID)).toBe(true);
    expect(runtime.indexes.typesById.has(DEPENDENT_ENDPOINT_TYPE_ID)).toBe(true);
  });

  it('defaults to all modules when refs are omitted', () => {
    const raw = buildRawSchemaSet([baseModule, dependentModule]);
    const selection = buildSchemaSelection({ raw });
    expect(selection.rootModuleIds).toEqual(['user/base', 'user/dependent']);
  });

  it('applies update/remove operations from selected modules', () => {
    const raw = buildRawSchemaSet([webModule, patchModule]);
    const selection = buildSchemaSelection({
      raw,
      activations: [act('user/patch@1.0.0')],
    });
    const runtime = buildSchemaRuntime({ raw, selection });

    const endpoint = runtime.indexes.typesById.get(WEB_API_ENDPOINT_TYPE_ID);
    expect(endpoint?.label).toBe('API Endpoint');
    expect(endpoint?.traits ?? []).toEqual([]);
    expect(endpoint?.properties?.map((property) => property.id)).toEqual(['auth_mode']);
    expect(endpoint?.properties?.[0]?.description).toBe('Authentication mode');
    expect(endpoint?.properties?.[0]?.values).toEqual(['api-key']);
    expect(runtime.indexes.relationsById.has(WEB_OLD_CALLS_RELATION_ID)).toBe(false);
    const relation = runtime.indexes.relationsById.get(WEB_CALLS_HTTP_RELATION_ID);
    expect(relation?.properties?.map((property) => property.id)).toEqual(['method']);
    expect(relation?.properties?.[0]?.values).toEqual(['POST']);
    expect(runtime.resolved.diagnostics).toEqual([]);
  });

  it('removes object-valued trait participation entries structurally', () => {
    const raw = buildRawSchemaSet([traitRemovalBaseModule, traitRemovalPatchModule]);
    const selection = buildSchemaSelection({
      raw,
      activations: [act('user/trait-removal-patch@1.0.0')],
    });
    const runtime = buildSchemaRuntime({ raw, selection });

    expect(
      runtime.indexes.traitsById.get('user/trait-removal-base.traits.compute')
        ?.relationParticipation,
    ).toEqual([{ relation: 'user/trait-removal-base.relations.calls', endpoint: 'from' }]);
  });

  it('normalizes alias-qualified references in trait participation metadata', () => {
    const raw = buildRawSchemaSet([webModule, aliasRelationModule]);
    const selection = buildSchemaSelection({
      raw,
      activations: [act('user/alias-relations@1.0.0')],
    });
    const runtime = buildSchemaRuntime({ raw, selection });
    const trait = runtime.indexes.traitsById.get(ALIAS_CALLER_TRAIT_ID);

    expect(trait?.relationParticipation).toEqual([
      { relation: WEB_CALLS_HTTP_RELATION_ID, endpoint: 'from' },
    ]);
    expect(trait?.analysis?.mayTerminate).toBe(true);
    expect(trait?.analysis?.expectedRelationIds).toEqual([WEB_CALLS_HTTP_RELATION_ID]);
  });

  it('reports selector errors without crashing resolution', () => {
    const badPatch: SchemaModule = {
      owner: 'user',
      name: 'bad-patch',
      version: '1.0.0',
      use: [{ schema: 'user/web@1.0.0', alias: 'web' }],
      types: [],
      relations: [],
      update: {
        'web.types.missing-type': {
          set: {
            label: 'Nope',
          },
        },
      },
      remove: {
        'web.types.missing-type.properties': ['legacyFlag'],
      },
    };
    const raw = buildRawSchemaSet([webModule, badPatch]);
    const selection = buildSchemaSelection({
      raw,
      activations: [act('user/bad-patch@1.0.0')],
    });
    const runtime = buildSchemaRuntime({ raw, selection });

    expect(runtime.indexes.typesById.has(WEB_API_ENDPOINT_TYPE_ID)).toBe(true);
    const messages = diagnosticsToMessages(runtime.resolved.diagnostics);
    expect(messages).toContain('Update selector target not found: web.types.missing-type');
    expect(messages).toContain(
      'Remove selector target not found: web.types.missing-type.properties',
    );
  });

  it('resolves core/code transitively through core/software', () => {
    const raw = buildRawSchemaSet([
      parseSchema(baseRaw),
      parseSchema(softwareRaw),
      parseSchema(codeRaw),
      parseSchema(webAppRaw),
    ]);
    const selection = buildSchemaSelection({
      raw,
      activations: [act('core/code@0.1')],
    });
    const runtime = buildSchemaRuntime({ raw, selection });

    expect(runtime.selection.rootModuleIds).toEqual(['core/code']);
    expect(runtime.resolved.resolvedModuleIds).toEqual(['core/base', 'core/software', 'core/code']);
    expect(runtime.indexes.typesById.has(CORE_CODE_MODULE_TYPE_ID)).toBe(true);
    expect(runtime.indexes.typesById.has(CORE_WEB_SERVICE_TYPE_ID)).toBe(false);
    expect(runtime.resolved.diagnostics).toEqual([]);
  });

  it('preserves schema-owned containment while layered activations stay external to the schema', () => {
    const raw = buildRawSchemaSet([
      parseSchema(baseRaw),
      parseSchema(softwareRaw),
      parseSchema(webAppRaw),
      parseSchema(codeRaw),
      parseSchema(frontendRaw),
    ]);
    const selection = buildSchemaSelection({
      raw,
      activations: [act('core/web-app@0.3'), act('core/frontend@0.3'), act('core/code@0.1', 1)],
    });
    const runtime = buildSchemaRuntime({ raw, selection });
    const application = runtime.indexes.typesById.get(CORE_WEB_APPLICATION_TYPE_ID);
    const service = runtime.indexes.typesById.get(CORE_WEB_SERVICE_TYPE_ID);
    const api = runtime.indexes.typesById.get(CORE_WEB_API_TYPE_ID);
    const endpoint = runtime.indexes.typesById.get(CORE_WEB_API_ENDPOINT_TYPE_ID);
    const frontend = runtime.indexes.typesById.get(CORE_FRONTEND_TYPE_ID);
    const module = runtime.indexes.typesById.get(CORE_CODE_MODULE_TYPE_ID);

    expect(application?.containment?.allowedChildTraits).not.toEqual(
      expect.arrayContaining([CORE_CODE_TRAIT_ID]),
    );
    expect(service?.containment?.allowedChildTraits).not.toEqual(
      expect.arrayContaining([CORE_CODE_TRAIT_ID]),
    );
    expect(api?.containment?.allowedChildTraits).not.toEqual(
      expect.arrayContaining([CORE_CODE_TRAIT_ID]),
    );
    expect(frontend?.containment?.allowedChildTraits).not.toEqual(
      expect.arrayContaining([CORE_CODE_TRAIT_ID]),
    );
    expect(endpoint?.containment?.allowedChildTraits).not.toEqual(
      expect.arrayContaining([CORE_CODE_TRAIT_ID]),
    );
    expect(module?.traits).toEqual(
      expect.arrayContaining([CORE_CODE_TRAIT_ID, CORE_BASE_CONTAINER_TRAIT_ID]),
    );
    expect(
      runtime.semantics.typesById.get(CORE_CODE_MODULE_TYPE_ID)?.relationParticipation,
    ).toEqual(
      expect.arrayContaining([
        { relationId: CORE_SOFTWARE_CALLS_RELATION_ID, from: true, to: true },
      ]),
    );
    expect(runtime.semantics.typesById.get(CORE_WEB_SERVICE_TYPE_ID)?.expectations.flowRole).toBe(
      'through',
    );
    expect(runtime.semantics.relationsById.get(CORE_SOFTWARE_CALLS_RELATION_ID)).toEqual(
      expect.objectContaining({
        fulfills: {
          from: ['egress'],
          to: ['ingress'],
        },
      }),
    );
  });
});
