import { describe, expect, it } from 'vitest';
import { diagnosticsToMessages } from './diagnostics';
import { buildEntityIndex } from './entity-tree';
import { buildQualifiedSchemaObjectId } from './schema-ids';
import { buildSchemaActivation, getSchemaModuleRef } from './schema-ref';
import {
  buildNextSchemaActivations,
  buildSchemaLockReasons,
  collectIntroducedValidationErrors,
  resolveSchemaModules,
  type SchemaCatalogEntry,
  sanitizeDanglingRelations,
} from './schema-selection';
import type { SchemaModule, SemanticDocument } from './types';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const BASE_ENDPOINT_TYPE_ID = buildQualifiedSchemaObjectId('user/base', 'types', 'endpoint');
const BASE_SERVICE_TYPE_ID = buildQualifiedSchemaObjectId('user/base', 'types', 'service');
const BASE_CALLS_RELATION_ID = buildQualifiedSchemaObjectId('user/base', 'relations', 'calls');
const DEPLOY_TARGET_TYPE_ID = buildQualifiedSchemaObjectId(
  'user/deployment',
  'types',
  'deploy-target',
);
const DEPLOYS_TO_RELATION_ID = buildQualifiedSchemaObjectId(
  'user/deployment',
  'relations',
  'deploys-to',
);

const baseModule: SchemaModule = {
  owner: 'user',
  name: 'base',
  version: '1',
  traits: [
    {
      id: 'endpoint-like',
      label: 'Endpoint-like',
      relationParticipation: [{ relation: 'calls', endpoint: 'from' }],
    },
    {
      id: 'service-like',
      label: 'Service-like',
      relationParticipation: [{ relation: 'calls', endpoint: 'to' }],
    },
  ],
  types: [
    { id: 'endpoint', label: 'Endpoint', traits: ['endpoint-like'] },
    { id: 'service', label: 'Service', traits: ['service-like'] },
  ],
  relations: [{ id: 'calls', label: 'calls' }],
};

const deploymentModule: SchemaModule = {
  owner: 'user',
  name: 'deployment',
  version: '1',
  use: [{ schema: 'user/base@1.0.0', alias: 'base' }],
  traits: [
    {
      id: 'deployer',
      label: 'Deployer',
      relationParticipation: [{ relation: 'deploys-to', endpoint: 'from' }],
    },
    {
      id: 'deploy-target-like',
      label: 'Deploy Target-like',
      relationParticipation: [{ relation: 'deploys-to', endpoint: 'to' }],
    },
  ],
  types: [{ id: 'deploy-target', label: 'Deploy Target', traits: ['deploy-target-like'] }],
  relations: [{ id: 'deploys-to', label: 'deploys-to' }],
  update: {
    'base.types.service': {
      add: {
        traits: ['user/deployment.traits.deployer'],
      },
    },
  },
};

const buildCallsSchema = (fromTypeId: string, toTypeId: string): SchemaModule => ({
  owner: 'user',
  name: 'calls-schema',
  version: '1',
  traits: [
    {
      id: 'caller',
      label: 'Caller',
      relationParticipation: [{ relation: BASE_CALLS_RELATION_ID, endpoint: 'from' }],
    },
    {
      id: 'callee',
      label: 'Callee',
      relationParticipation: [{ relation: BASE_CALLS_RELATION_ID, endpoint: 'to' }],
    },
  ],
  types: [
    {
      id: BASE_ENDPOINT_TYPE_ID,
      label: BASE_ENDPOINT_TYPE_ID,
      traits: [fromTypeId === BASE_ENDPOINT_TYPE_ID ? 'caller' : 'callee'],
    },
    {
      id: BASE_SERVICE_TYPE_ID,
      label: BASE_SERVICE_TYPE_ID,
      traits: [toTypeId === BASE_SERVICE_TYPE_ID ? 'callee' : 'caller'],
    },
  ],
  relations: [{ id: BASE_CALLS_RELATION_ID, label: 'calls' }],
});

describe('schema-selection helpers', () => {
  it('builds next schema activations while preserving unknown refs and existing pinned versions', () => {
    const schemaCatalog: SchemaCatalogEntry[] = [
      { id: 'core/web-app', owner: 'core', label: 'Web App', version: '0.3' },
      { id: 'core/kubernetes', owner: 'core', label: 'Kubernetes', version: '0.3' },
      { id: 'core/data-model', owner: 'core', label: 'Data Model', version: '0.3' },
    ];
    const next = buildNextSchemaActivations({
      currentActivations: [
        act('core/web-app@0.2.7'),
        act('core/kubernetes@0.3'),
        act('user/custom@1.0.0'),
      ],
      selectedSchemaIds: ['core/web-app', 'core/data-model'],
      schemaCatalog,
    });

    expect(next).toEqual([
      act('core/web-app@0.2.7'),
      act('core/data-model@0.3', 1),
      act('user/custom@1.0.0'),
    ]);
  });

  it('builds lock reasons from entities, relations, and schema dependencies', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'svc-orders', type: BASE_SERVICE_TYPE_ID, name: 'Orders Service' },
        { id: 'deploy-orders', type: DEPLOY_TARGET_TYPE_ID, name: 'orders-deploy' },
      ],
      relations: [
        {
          id: 'rel-deploy-orders',
          type: DEPLOYS_TO_RELATION_ID,
          from: 'svc-orders',
          to: 'deploy-orders',
        },
      ],
    };
    const schemaCatalog: SchemaCatalogEntry[] = [
      { id: 'user/base', owner: 'user', label: 'Base' },
      { id: 'user/deployment', owner: 'user', label: 'Deployment' },
    ];
    const schemaRegistry = new Map<string, SchemaModule>([
      [getSchemaModuleRef(baseModule), baseModule],
      [getSchemaModuleRef(deploymentModule), deploymentModule],
    ]);

    const reasons = buildSchemaLockReasons({
      schemaCatalog,
      schemaRegistry,
      selectedSchemaIds: ['user/base', 'user/deployment'],
      entityIndex: buildEntityIndex(doc.entities),
      relations: doc.relations,
    });

    expect(reasons['user/deployment']).toContain('Entities: Orders Service, orders-deploy');
    expect(reasons['user/deployment']).toContain('Relations: rel-deploy-orders');
    expect(reasons['user/base']).toContain('Schemas: Deployment');
  });

  it('sanitizes dangling relations', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [{ id: 'svc', type: 'service' }],
      relations: [
        { id: 'ok', type: BASE_CALLS_RELATION_ID, from: 'svc', to: 'svc' },
        { id: 'dangling', type: BASE_CALLS_RELATION_ID, from: 'svc', to: 'missing' },
      ],
    };

    const sanitized = sanitizeDanglingRelations(doc);
    expect(sanitized.relations.map((relation) => relation.id)).toEqual(['ok']);
  });

  it('only reports validation errors introduced by candidate schema/doc changes', () => {
    const currentDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'endpoint-a', type: BASE_ENDPOINT_TYPE_ID },
        { id: 'service-a', type: BASE_SERVICE_TYPE_ID },
      ],
      relations: [
        { id: 'rel-1', type: BASE_CALLS_RELATION_ID, from: 'service-a', to: 'service-a' },
      ],
    };
    const candidateDoc: SemanticDocument = {
      ...currentDoc,
      schemaRefs: [act('user/other')],
    };
    const currentSchema: SchemaModule = {
      ...buildCallsSchema(BASE_ENDPOINT_TYPE_ID, BASE_SERVICE_TYPE_ID),
      name: 'current',
    };
    const candidateSchema: SchemaModule = {
      ...buildCallsSchema(BASE_ENDPOINT_TYPE_ID, BASE_SERVICE_TYPE_ID),
      name: 'candidate',
    };

    const { introducedDiagnostics } = collectIntroducedValidationErrors({
      currentDoc,
      candidateDoc,
      currentSchema,
      candidateSchema,
    });
    expect(introducedDiagnostics).toEqual([]);

    const stricterCandidateSchema: SchemaModule = {
      ...buildCallsSchema(BASE_SERVICE_TYPE_ID, BASE_ENDPOINT_TYPE_ID),
      name: 'stricter-candidate',
    };
    const { introducedDiagnostics: strictErrors } = collectIntroducedValidationErrors({
      currentDoc: {
        ...currentDoc,
        relations: [
          { id: 'rel-2', type: BASE_CALLS_RELATION_ID, from: 'endpoint-a', to: 'service-a' },
        ],
      },
      candidateDoc: {
        ...currentDoc,
        relations: [
          { id: 'rel-2', type: BASE_CALLS_RELATION_ID, from: 'endpoint-a', to: 'service-a' },
        ],
      },
      currentSchema: candidateSchema,
      candidateSchema: stricterCandidateSchema,
    });
    expect(diagnosticsToMessages(strictErrors)).toContain(
      `Relation rel-2 has invalid endpoints for ${BASE_CALLS_RELATION_ID}`,
    );
  });

  it('truncates lock reason previews to first four items with overflow count', () => {
    const schemaCatalog: SchemaCatalogEntry[] = [
      { owner: 'user', id: 'user/deployment', label: 'Deployment' },
    ];
    const schemaRegistry = new Map<string, SchemaModule>([
      [getSchemaModuleRef(deploymentModule), deploymentModule],
    ]);
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'svc-1', type: BASE_SERVICE_TYPE_ID, name: 'svc-1' },
        { id: 'svc-2', type: BASE_SERVICE_TYPE_ID, name: 'svc-2' },
        { id: 'svc-3', type: BASE_SERVICE_TYPE_ID, name: 'svc-3' },
        { id: 'svc-4', type: BASE_SERVICE_TYPE_ID, name: 'svc-4' },
        { id: 'svc-5', type: BASE_SERVICE_TYPE_ID, name: 'svc-5' },
        { id: 'd-1', type: DEPLOY_TARGET_TYPE_ID, name: 'd-1' },
      ],
      relations: [
        { id: 'rel-1', type: DEPLOYS_TO_RELATION_ID, from: 'svc-1', to: 'd-1' },
        { id: 'rel-2', type: DEPLOYS_TO_RELATION_ID, from: 'svc-2', to: 'd-1' },
        { id: 'rel-3', type: DEPLOYS_TO_RELATION_ID, from: 'svc-3', to: 'd-1' },
        { id: 'rel-4', type: DEPLOYS_TO_RELATION_ID, from: 'svc-4', to: 'd-1' },
        { id: 'rel-5', type: DEPLOYS_TO_RELATION_ID, from: 'svc-5', to: 'd-1' },
      ],
    };

    const reasons = buildSchemaLockReasons({
      schemaCatalog,
      schemaRegistry,
      selectedSchemaIds: ['user/deployment'],
      entityIndex: buildEntityIndex(doc.entities),
      relations: doc.relations,
    });

    const reason = reasons['user/deployment'];
    expect(reason).toContain('+2 more');
    expect(reason).toContain('Relations: rel-1, rel-2, rel-3, rel-4, +1 more');
  });

  it('locks the owning schema even when another selected schema defines the same local id', () => {
    const aliasModule: SchemaModule = {
      owner: 'user',
      name: 'alias',
      version: '1',
      types: [{ id: 'deploy-target', label: 'Alias Deploy Target' }],
      relations: [],
    };
    const schemaCatalog: SchemaCatalogEntry[] = [
      { id: 'user/deployment', owner: 'user', label: 'Deployment' },
      { id: 'user/alias', owner: 'user', label: 'Alias' },
    ];
    const schemaRegistry = new Map<string, SchemaModule>([
      [getSchemaModuleRef(deploymentModule), deploymentModule],
      [getSchemaModuleRef(aliasModule), aliasModule],
    ]);
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [{ id: 'd-1', type: DEPLOY_TARGET_TYPE_ID, name: 'd-1' }],
      relations: [],
    };

    const reasons = buildSchemaLockReasons({
      schemaCatalog,
      schemaRegistry,
      selectedSchemaIds: ['user/deployment', 'user/alias'],
      entityIndex: buildEntityIndex(doc.entities),
      relations: doc.relations,
    });

    expect(reasons['user/deployment']).toContain('Entities: d-1');
    expect(reasons['user/alias']).toBeUndefined();
  });

  it('resolves selected schemas with transitive dependencies ordered first', () => {
    const leafModule: SchemaModule = {
      owner: 'user',
      name: 'leaf',
      version: '1',
      use: [{ schema: 'user/deployment@1' }],
      types: [{ id: 'leaf-type', label: 'Leaf Type' }],
      relations: [],
    };
    const registry = new Map<string, SchemaModule>([
      [getSchemaModuleRef(baseModule), baseModule],
      [getSchemaModuleRef(deploymentModule), deploymentModule],
      [getSchemaModuleRef(leafModule), leafModule],
    ]);
    const resolution = resolveSchemaModules({
      schemaRegistry: registry,
      selectedSchemaIds: ['user/leaf'],
    });

    expect(resolution.diagnostics).toEqual([]);
    expect(resolution.resolvedSchemaIds).toEqual(['user/base', 'user/deployment', 'user/leaf']);
  });

  it('reports dependency cycles during schema resolution', () => {
    const cycA: SchemaModule = {
      owner: 'user',
      name: 'a',
      version: '1',
      use: [{ schema: 'user/b@1' }],
      types: [],
      relations: [],
    };
    const cycB: SchemaModule = {
      owner: 'user',
      name: 'b',
      version: '1',
      use: [{ schema: 'user/a@1' }],
      types: [],
      relations: [],
    };
    const registry = new Map<string, SchemaModule>([
      [getSchemaModuleRef(cycA), cycA],
      [getSchemaModuleRef(cycB), cycB],
    ]);

    const resolution = resolveSchemaModules({
      schemaRegistry: registry,
      selectedSchemaIds: ['user/a'],
    });

    expect(diagnosticsToMessages(resolution.diagnostics)[0]).toContain(
      'Schema dependency cycle detected',
    );
  });
});
